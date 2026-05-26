#!/usr/bin/env node
// MoneyMeKa Pro — VPS Bot Executor
//
// Polls /api/vps/session for a start command from the browser, connects to
// Deriv WebSocket, executes 1-tick live trades, and reports EVERY result to
// the same backend endpoints (/api/trade, /api/signal-event, /api/session-relay)
// used by browser execution.  Data schema is identical — D1, Discord, Claude
// tuning, admin analytics, and daily/weekly reports all receive the same data.
//
// Run with: pm2 start ecosystem.config.cjs --only moneymeka-vps-bot

import { existsSync, readFileSync } from 'node:fs';
import WebSocket from 'ws';

function loadEnvFile(path) {
  if (!path || !existsSync(path)) return;
  try {
    const raw = readFileSync(path, 'utf8');
    raw.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const idx = trimmed.indexOf('=');
      if (idx <= 0) return;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    });
  } catch (e) {
    console.warn(`[vps-bot:WARN] env load failed: ${e.message}`);
  }
}

loadEnvFile(process.env.MONEYMEKA_ENV || 'C:\\Users\\nelso\\Desktop\\moneymeka-secrets\\discord.env');

// ── CONFIG ────────────────────────────────────────────────────
const API_BASE   = process.env.API_BASE || 'https://moneymekapro.com';
const DERIV_WS   = 'wss://ws.derivws.com/websockets/v3?app_id=';
const OAUTH_CLIENT_ID = process.env.DERIV_OAUTH_CLIENT_ID || '33jYDBwLAZ4xeAL6eYmkP';
const LEGACY_WS_APP_ID = process.env.DERIV_LEGACY_WS_APP_ID || '1089';
const POLL_MS    = 3000;   // config poll — how often to check for new session
const PING_MS    = 10000;  // heartbeat — browser reads this for live stats
const AI_MS      = 25000;  // Claude signal refresh (KV TTL is 30s, so 25s is safe)
const TICK_WIN   = 300;    // rolling tick buffer per market

const MARKET_NAMES = {
  R_10:'Volatility 10 Index',      R_25:'Volatility 25 Index',
  R_50:'Volatility 50 Index',      R_75:'Volatility 75 Index',
  R_100:'Volatility 100 Index',
  '1HZ10V':'Volatility 10 (1s) Index',  '1HZ25V':'Volatility 25 (1s) Index',
  '1HZ50V':'Volatility 50 (1s) Index',  '1HZ75V':'Volatility 75 (1s) Index',
  '1HZ100V':'Volatility 100 (1s) Index',
};

const CONTRACT_LABELS = {
  DIGITEVEN: 'Even', DIGITODD: 'Odd',
  DIGITOVER: 'Over', DIGITUNDER: 'Under',
  DIGITMATCH: 'Matches', DIGITDIFF: 'Differs',
  CALL: 'Rise', PUT: 'Fall',
};

// ── PROCESS STATE ─────────────────────────────────────────────
let session = null;   // current KV config blob
let bot     = null;   // bot runtime state
let ws      = null;   // Deriv WebSocket
let wsReady = false;
let usingOptionsApi = false;
let _pollTimer = null, _pingTimer = null;

const tickStore = {}; // { [symbol]: [{price, timestamp}] }

// ── LOGGING ───────────────────────────────────────────────────
function ts() { return new Date().toISOString().slice(11, 19); }
function log(msg)   { console.log(`[vps-bot] ${ts()}  ${msg}`); }
function warn(msg)  { console.warn(`[vps-bot:WARN] ${ts()}  ${msg}`); }
function err(msg)   { console.error(`[vps-bot:ERR] ${ts()}  ${msg}`); }

// ── HTTP HELPER ───────────────────────────────────────────────
const VPS_SECRET = process.env.VPS_SECRET || '';

function _sym(sym) {
  return usingOptionsApi ? { underlying_symbol: sym } : { symbol: sym };
}

async function api(path, opts = {}) {
  try {
    return await fetch(`${API_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json', 'X-VPS-Secret': VPS_SECRET },
      signal: AbortSignal.timeout(15000),
      ...opts,
    });
  } catch (e) { warn(`api ${path}: ${e.message}`); return null; }
}

function post(path, body) {
  return api(path, { method: 'POST', body: JSON.stringify(body) });
}

// New Deriv OAuth tokens are ory_at_ Bearer tokens. They cannot be sent to the
// legacy { authorize } WS message, so the VPS daemon must obtain an Options API
// OTP websocket URL the same way the browser does.
async function getDerivOptionsWsUrl(token) {
  const accountsRes = await fetch(`${API_BASE}/api/deriv-options/accounts`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Deriv-App-ID': OAUTH_CLIENT_ID,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(15000),
  });
  const accountsBody = await accountsRes.text();
  if (!accountsRes.ok) throw new Error(`Options accounts ${accountsRes.status}: ${accountsBody.slice(0, 160)}`);

  const accountsJson = JSON.parse(accountsBody);
  const rawAccounts = accountsJson.data ?? accountsJson.accounts ?? accountsJson;
  const accounts = Array.isArray(rawAccounts) ? rawAccounts : (rawAccounts ? [rawAccounts] : []);
  const isDemoAccount = account =>
    account?.is_virtual === 1 ||
    account?.is_virtual === true ||
    String(account?.account_type || account?.type || '').toLowerCase() === 'demo';
  const account = accounts.find(a => !isDemoAccount(a)) || accounts[0];
  const accountId = account?.account_id || account?.id;
  if (!accountId) throw new Error(`No Options account in response: ${accountsBody.slice(0, 160)}`);

  const otpRes = await fetch(`${API_BASE}/api/deriv-options/otp`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Deriv-App-ID': OAUTH_CLIENT_ID,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ account_id: accountId }),
    signal: AbortSignal.timeout(15000),
  });
  const otpBody = await otpRes.text();
  if (!otpRes.ok) throw new Error(`Options OTP ${otpRes.status}: ${otpBody.slice(0, 160)}`);
  const otpJson = JSON.parse(otpBody);
  const wsUrl = otpJson.url || otpJson.data?.url || otpJson.data?.websocket_url || otpJson.data?.ws_url;
  if (!wsUrl) throw new Error(`No Options websocket URL in OTP response: ${otpBody.slice(0, 160)}`);

  return {
    wsUrl,
    loginId: account?.login_id || account?.loginid || accountId,
    isVirtual: isDemoAccount(account),
    currency: account?.currency || 'USD',
  };
}

// ── ID GENERATORS (same format as browser) ────────────────────
function genTradeId() {
  return 'v' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

// ── DIGIT / STATS (exact copy of app.js logic) ────────────────
function lastDig(price) {
  const s = Number(price).toFixed(2).replace('.', '');
  return Number(s[s.length - 1]);
}

function computeDigitStats(ticks) {
  const counts = Array(10).fill(0);
  ticks.forEach(t => { const d = lastDig(t.price); if (d >= 0 && d <= 9) counts[d]++; });
  const total = ticks.length || 1;
  const pcts  = counts.map(c => (c / total) * 100);
  const sorted = counts.map((c, i) => ({ c, i })).sort((a, b) => b.c - a.c);
  const rankOf = Array(10);
  sorted.forEach((item, rank) => { rankOf[item.i] = rank + 1; });
  return { counts, pcts, total, rankOf };
}

// ── STRATEGY CHECKS (verbatim from app.js) ────────────────────
function checkOver123(stats) {
  const { pcts, rankOf } = stats;
  const low = [0,1,2,3], high = [4,5,6,7,8,9];
  const g = rankOf.indexOf(1), b = rankOf.indexOf(2);
  const lowBelowTen    = low.filter(d => pcts[d] < 10);
  const hasRedOrAmber  = low.some(d => rankOf[d] === 10 || rankOf[d] === 9);
  const highAbove11    = high.filter(d => pcts[d] >= 11);
  const greenBlueSame  = high.includes(g) && high.includes(b);
  if (lowBelowTen.length >= 4 && hasRedOrAmber && highAbove11.length >= 2 && greenBlueSame) return 'ready';
  if (lowBelowTen.length >= 2 && highAbove11.length >= 1) return 'partial';
  return 'fail';
}

function checkUnder876(stats) {
  const { pcts, rankOf } = stats;
  const high = [6,7,8,9], low = [0,1,2,3,4,5];
  const g = rankOf.indexOf(1), b = rankOf.indexOf(2);
  const highBelowTen   = high.filter(d => pcts[d] < 10);
  const hasRedOrAmber  = high.some(d => rankOf[d] === 10 || rankOf[d] === 9);
  const lowAbove11     = low.filter(d => pcts[d] >= 11);
  const greenBlueSame  = low.includes(g) && low.includes(b);
  if (highBelowTen.length >= 4 && hasRedOrAmber && lowAbove11.length >= 2 && greenBlueSame) return 'ready';
  if (highBelowTen.length >= 2 && lowAbove11.length >= 1) return 'partial';
  return 'fail';
}

function checkOdd(stats) {
  const { pcts, rankOf } = stats;
  const odd = [1,3,5,7,9], even = [0,2,4,6,8];
  if (odd.reduce((s, d) => s + pcts[d], 0) < 53) return 'fail';
  const g = rankOf.indexOf(1), b = rankOf.indexOf(2);
  const r = rankOf.indexOf(10), y = rankOf.indexOf(9);
  const gOnOdd  = odd.includes(g)  && pcts[g] >= 11;
  const bOnOdd  = odd.includes(b)  && pcts[b] >= 11;
  const rOnEven = even.includes(r) && pcts[r] <= 8.6;
  const yOnEven = even.includes(y) && pcts[y] <= 9.5;
  if (gOnOdd && bOnOdd && rOnEven && yOnEven) return 'ready';
  if ((gOnOdd || bOnOdd) && (rOnEven || yOnEven)) return 'partial';
  return 'fail';
}

function checkEven(stats) {
  const { pcts, rankOf } = stats;
  const even = [0,2,4,6,8], odd = [1,3,5,7,9];
  if (even.reduce((s, d) => s + pcts[d], 0) < 53) return 'fail';
  const g = rankOf.indexOf(1), b = rankOf.indexOf(2);
  const r = rankOf.indexOf(10), y = rankOf.indexOf(9);
  const gOnEven = even.includes(g) && pcts[g] >= 11;
  const bOnEven = even.includes(b) && pcts[b] >= 11;
  const rOnOdd  = odd.includes(r)  && pcts[r] <= 8.6;
  const yOnOdd  = odd.includes(y)  && pcts[y] <= 9.5;
  if (gOnEven && bOnEven && rOnOdd && yOnOdd) return 'ready';
  if ((gOnEven || bOnEven) && (rOnOdd || yOnOdd)) return 'partial';
  return 'fail';
}

function checkHitRun(stats) {
  const { pcts } = stats;
  return {
    over:  pcts[0] < 10 && pcts[1] < 10 ? 'ready' : 'fail',
    under: pcts[8] < 10 && pcts[9] < 10 ? 'ready' : 'fail',
  };
}

function checkStrategy(strategy, stats, aiRec) {
  if (strategy === 'aiAuto')   return !!(aiRec && aiRec.confidence >= 45);
  if (strategy === 'over123')  return checkOver123(stats)  !== 'fail';
  if (strategy === 'under876') return checkUnder876(stats) !== 'fail';
  if (strategy === 'odd')      return checkOdd(stats)      !== 'fail';
  if (strategy === 'even')     return checkEven(stats)     !== 'fail';
  if (strategy === 'hitrun')   { const hr = checkHitRun(stats); return hr.over === 'ready' || hr.under === 'ready'; }
  return true;
}

function getContractType(strategy, stats, aiRec) {
  switch (strategy) {
    case 'over123':  return 'DIGITOVER';
    case 'under876': return 'DIGITUNDER';
    case 'odd':      return 'DIGITODD';
    case 'even':     return 'DIGITEVEN';
    case 'hitrun':   return checkHitRun(stats).over === 'ready' ? 'DIGITOVER' : 'DIGITUNDER';
    case 'aiAuto':   return getContractType(aiRec?.recommended || 'even', stats, null);
    default:         return 'DIGITEVEN';
  }
}

function getBarrier(strategy, stats, aiRec) {
  switch (strategy) {
    case 'over123':  { const { pcts } = stats; return [1,2,3].reduce((a,b) => pcts[a] < pcts[b] ? a : b); }
    case 'under876': { const { pcts } = stats; return [6,7,8].reduce((a,b) => pcts[a] > pcts[b] ? a : b); }
    case 'hitrun':   return checkHitRun(stats).over === 'ready' ? 1 : 8;
    case 'aiAuto':   return getBarrier(aiRec?.recommended || 'even', stats, null);
    default:         return null;
  }
}

// ── CLAUDE SIGNAL REFRESH ─────────────────────────────────────
// Reads pre-warmed KV cache via /api/ai-scan (same endpoint as browser + prewarmer).
// The KV hit fires the Discord signal relay inside the worker — no change needed there.
async function refreshSignal() {
  if (!bot) return;
  const now = Date.now();
  if (now - (bot._aiAt || 0) < AI_MS) return;

  const tBuf = (tickStore[bot.market] || []).slice(-300);
  if (tBuf.length < 100) return;

  try {
    const res = await post('/api/ai-scan', {
      market: bot.market,
      ticks:  tBuf.map(t => lastDig(t.price)),
      source: 'vps-bot',
    });
    if (!res || !res.ok) return;
    const data = await res.json();
    if (data.recommendation && data.recommendation !== 'none') {
      const prev = bot.aiRec?.recommended;
      bot.aiRec = { recommended: data.recommendation, confidence: data.confidence, reason: data.reason, agreed: data.agreed };
      bot._aiAt = now;
      if (prev !== data.recommendation) {
        log(`Claude: ${data.recommendation.toUpperCase()} conf=${data.confidence}%${data.agreed ? ' [agreed]' : ''}`);
      }
      // Record signal event — same as browser _saveSignalEvent
      post('/api/signal-event', {
        session_id:    bot.sessionId,
        market:        bot.market,
        signal_source: 'claude',
        strategy:      data.recommendation,
        confidence:    data.confidence,
        reason:        data.reason,
        traded:        0,
        trade_id:      null,
        created_at:    now,
      }).catch(() => {});
    }
  } catch (e) { warn(`Signal refresh: ${e.message}`); }
}

// ── TRADE REPORTING ───────────────────────────────────────────
// Posts to /api/trade with the same 19-field schema as addJournalEntry+saveTradeToDB.
// This feeds D1, admin analytics, Claude tuning history, and daily/weekly Discord reports.
async function reportTrade(lc, profit, won, exitDigit) {
  const now     = Date.now();
  const tradeId = lc.tradeId;
  const aiRec   = bot.aiRec;
  const payload = {
    trade_id:      tradeId,
    session_id:    bot.sessionId,
    login_id:      bot.loginId  || null,
    source:        'bot',
    market:        bot.market,
    market_name:   MARKET_NAMES[bot.market] || bot.market,
    contract:      lc.contractType,
    barrier:       lc.barrier   || null,
    stake:         lc.stake,
    profit:        Number(profit) || 0,
    won:           won ? 1 : 0,
    exit_digit:    exitDigit != null ? String(exitDigit) : null,
    strategy:      bot.strategy,
    signal_source: aiRec ? 'claude'              : 'none',
    signal_conf:   aiRec ? aiRec.confidence      : null,
    signal_rec:    aiRec ? aiRec.recommended     : null,
    mode:          bot.mode     || 'live',
    opened_at:     lc._openedAt || (now - 1000),
    settled_at:    now,
  };
  const res = await post('/api/trade', payload);
  if (!res || !res.ok) warn(`Trade report failed for ${lc.contractId}`);

  const latency = lc._buySentAt ? now - lc._buySentAt : '?';
  log(`${won ? 'WIN' : 'LOSS'} ${profit >= 0 ? '+' : ''}${Number(profit).toFixed(2)} | P/L:${bot.pl.toFixed(2)} | settle_ms=${latency}`);
  bot._lastTradeAt = now;
}

// ── DERIV WEBSOCKET ───────────────────────────────────────────
function wsSend(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function subscribeBotMarket() {
  if (!bot) return;
  wsSend({ forget_all: 'ticks' });
  wsSend({ ticks: bot.market, subscribe: 1 });
  wsSend({
    ticks_history: bot.market,
    adjust_start_time: 1,
    count: 300,
    end: 'latest',
    start: 1,
    style: 'ticks',
  });
}

async function connectDeriv() {
  if (!session) return;
  const token = session.deriv_token || '';
  let wsUrl = '';
  let optionsAccount = null;
  usingOptionsApi = false;

  if (token.startsWith('ory_at_')) {
    log('Connecting to Deriv Options API websocket...');
    try {
      optionsAccount = await getDerivOptionsWsUrl(token);
      wsUrl = optionsAccount.wsUrl;
      usingOptionsApi = true;
      if (bot) {
        bot.loginId = optionsAccount.loginId || bot.loginId;
        bot.currency = optionsAccount.currency || bot.currency;
      }
    } catch (e) {
      err(`Options API auth failed: ${e.message}`);
      await stopSession();
      return;
    }
  } else {
    const appId = /^\d+$/.test(session.app_id) ? session.app_id : LEGACY_WS_APP_ID;
    wsUrl = `${DERIV_WS}${appId}`;
    log(`Connecting to Deriv legacy WS (app_id=${appId})...`);
  }
  ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    wsReady = true;
    if (usingOptionsApi && optionsAccount) {
      log(`Authorised (Options API): ${optionsAccount.loginId}${optionsAccount.isVirtual ? ' (Demo)' : ''}`);
      subscribeBotMarket();
      pingStatus(true);
      return;
    }
    log('Deriv WS connected - authorising...');
    wsSend({ authorize: token });
  });

  ws.on('message', raw => {
    try { handleMsg(JSON.parse(raw)); } catch (_) {}
  });

  ws.on('close', () => {
    wsReady = false;
    warn('Deriv WS closed');
    if (bot && bot.running) setTimeout(() => connectDeriv().catch(e => err(`Reconnect failed: ${e.message}`)), 5000);
  });

  ws.on('error', e => err(`WS: ${e.message}`));
}

function disconnectDeriv() {
  wsReady = false;
  usingOptionsApi = false;
  if (ws) { ws.removeAllListeners(); try { ws.close(); } catch (_) {} ws = null; }
}

function handleMsg(msg) {
  if (msg.error) {
    warn(`Deriv [${msg.msg_type}]: ${msg.error.message}`);
    if (msg.msg_type === 'authorize') { err('Auth failed — stopping VPS bot'); stopSession(); }
    if (msg.msg_type === 'buy') {
      if (bot?.liveContract && !bot.liveContract.contractId) {
        warn(`Buy error — clearing liveContract`);
        bot.liveContract = null;
      } else if (bot) {
        // Error arrived after tick-advance moved slot to settlingContracts
        const _si = bot.settlingContracts.findIndex(t => !t.contractId);
        if (_si >= 0) { warn(`Buy error (late) — removing stale settling slot`); bot.settlingContracts.splice(_si, 1); }
      }
    }
    return;
  }
  switch (msg.msg_type) {
    case 'authorize':
      log(`Authorised: ${msg.authorize.loginid}${msg.authorize.is_virtual ? ' (Demo)' : ''}`);
      if (bot) {
        bot.loginId = msg.authorize.loginid || bot.loginId;
        bot.currency = msg.authorize.currency || bot.currency;
      }
      subscribeBotMarket();
      pingStatus(true);
      break;
    case 'tick':
      if (msg.tick) {
        const symbol = msg.tick.symbol || msg.tick.underlying_symbol || bot?.market;
        if (symbol === bot?.market) onTick({ ...msg.tick, symbol });
      }
      break;
    case 'history':
      hydrateHistory(msg);
      break;
    case 'buy':
      onBuyResponse(msg.buy);
      break;
    case 'proposal_open_contract':
      if (msg.proposal_open_contract?.is_sold) onPoc(msg.proposal_open_contract);
      break;
  }
}

// ── TICK PROCESSING ───────────────────────────────────────────
function hydrateHistory(msg) {
  const history = msg.history;
  if (!history || !Array.isArray(history.prices) || !bot) return;
  const sym = msg.echo_req?.ticks_history || msg.echo_req?.underlying_symbol || bot.market;
  tickStore[sym] = history.prices.map((price, idx) => ({
    price: Number(price),
    timestamp: Number(history.times?.[idx] || Date.now() / 1000) * 1000,
  })).filter(t => Number.isFinite(t.price)).slice(-TICK_WIN);
  log(`History loaded: ${sym} (${tickStore[sym].length} ticks)`);
}

function onTick(tick) {
  const { symbol, quote, epoch } = tick;
  if (!tickStore[symbol]) tickStore[symbol] = [];
  const arr = tickStore[symbol];
  arr.push({ price: Number(quote), timestamp: Number(epoch) * 1000 });
  if (arr.length > TICK_WIN) arr.shift();
  if (!bot || !bot.running) return;
  runBotEngine(Number(quote), Date.now());
}

// ── BOT ENGINE (mirrors app.js runBotEngine + fast-settle) ───
function runBotEngine(price, tickNow) {
  if (!bot || !bot.running) return;

  const tBuf = tickStore[bot.market] || [];
  if (tBuf.length < 10) return;

  const stats = computeDigitStats(tBuf);

  // Fast-settle: advance tick counter, free slot when 1-tick duration elapses
  if (bot.liveContract !== null) {
    bot.liveContract.ticksElapsed = (bot.liveContract.ticksElapsed || 0) + 1;
    if (bot.liveContract.ticksElapsed >= 1) {
      if (!bot.liveContract.contractId) {
        // Keep slot in settlingContracts so late buy response can still be matched
        warn('Buy response late — holding slot until confirmation arrives');
        bot.settlingContracts.push({ ...bot.liveContract });
        bot.liveContract = null;
        // fall through
      } else {
        // POC subscription already sent in onBuyResponse — do NOT re-subscribe
        bot.settlingContracts.push({ ...bot.liveContract });
        bot.liveContract = null;
        // fall through — enter next trade on this tick
      }
    } else {
      return;
    }
  }

  // Block new entry while any buy confirmation is still pending
  if (bot.settlingContracts.some(t => !t.contractId)) return;

  // P/L guards — include worst-case pending exposure
  const _ps = bot.settlingContracts.reduce((s, c) => s + (c.stake || 0), 0);
  if (bot.pl <= -bot.lossLimit) {
    bot._stopReason = 'loss';
    log(`Loss limit hit (P/L:${bot.pl.toFixed(2)}). Stopping.`);
    stopSession(); return;
  }
  if (bot.pl - _ps <= -bot.lossLimit) {
    if (!bot._exposurePausedAt || Date.now() - bot._exposurePausedAt > 3000) {
      bot._exposurePausedAt = Date.now();
      log(`Exposure cap reached (P/L:${bot.pl.toFixed(2)} exposure:$${_ps.toFixed(2)}). Waiting for settlement.`);
    }
    return;
  }
  if (bot.pl >= bot.targetProfit) { bot._stopReason = 'target'; log(`Target reached. Stopping.`); stopSession(); return; }

  // Strategy gate
  if (!checkStrategy(bot.strategy, stats, bot.aiRec)) return;

  executeTrade(stats, tickNow);
}

// ── TRADE EXECUTION ───────────────────────────────────────────
function executeTrade(stats, tickNow) {
  if (!bot || !bot.running) return;

  const now = Date.now();
  // Duplicate-buy guard — same 400ms window as app.js
  if (now - (bot.lastBuyAt || 0) < 400) return;

  // Pre-send stop loss: check if THIS stake would push worst-case past the limit
  const _exp = bot.settlingContracts.reduce((s, c) => s + (c.stake || 0), 0);
  if (bot.pl - _exp - bot.currentStake <= -bot.lossLimit) {
    if (!bot._exposurePausedAt || now - bot._exposurePausedAt > 3000) {
      bot._exposurePausedAt = now;
      log(`Exposure cap: stake $${bot.currentStake.toFixed(2)} + exposure $${_exp.toFixed(2)} would exceed limit. Waiting.`);
    }
    return;
  }

  const contractType = getContractType(bot.strategy, stats, bot.aiRec);
  const barrier      = getBarrier(bot.strategy, stats, bot.aiRec);
  const tradeId      = genTradeId();

  bot.liveContract = {
    tradeId,
    contractId:    null,
    contractType,
    stake:         bot.currentStake,
    barrier:       barrier != null ? String(barrier) : null,
    ticksElapsed:  0,
    _openedAt:     now,
    _buySentAt:    now,
  };

  const payload = {
    buy: 1, subscribe: 1,
    price: bot.currentStake,
    parameters: {
      amount:        bot.currentStake,
      basis:         'stake',
      contract_type: contractType,
      currency:      bot.currency,
      duration:      1,
      duration_unit: 't',
      ..._sym(bot.market),
    },
  };
  if (barrier != null) payload.parameters.barrier = String(barrier);

  bot.lastBuyAt = now;
  console.log(`[MekaBot-VPS] ${contractType} barrier=${barrier ?? 'n/a'} stake=${bot.currentStake} tick_to_buy_ms=${now - (tickNow || now)}`);
  wsSend(payload);
}

// ── BUY RESPONSE ─────────────────────────────────────────────
function onBuyResponse(buy) {
  if (!bot || !buy?.contract_id) return;
  const cid = String(buy.contract_id);
  const now = Date.now();

  if (bot.liveContract && !bot.liveContract.contractId) {
    bot.liveContract.contractId = cid;
    bot.runs++;
    if (bot.liveContract._buySentAt) {
      console.log(`[MekaBot-VPS] buy_confirm_ms=${now - bot.liveContract._buySentAt}`);
    }
    // buy:subscribe=1 already opens the POC stream; do not subscribe again.
    return;
  }
  // Buy response arrived after fast-settle already moved it to settlingContracts
  const settling = bot.settlingContracts.find(t => !t.contractId);
  if (settling) {
    settling.contractId = cid;
    bot.runs++;
    // buy:subscribe=1 already opens the POC stream; do not subscribe again.
  }
}

// ── CONTRACT SETTLEMENT ───────────────────────────────────────
function onPoc(c) {
  if (!bot) return;
  const cid = String(c.contract_id);

  let lc = null;
  if (bot.liveContract?.contractId === cid) {
    lc = bot.liveContract; bot.liveContract = null;
  } else {
    const idx = bot.settlingContracts.findIndex(t => t.contractId === cid);
    if (idx >= 0) { lc = bot.settlingContracts[idx]; bot.settlingContracts.splice(idx, 1); }
  }
  if (!lc) return;

  const realProfit = Number(c.profit || 0);
  const realWon    = realProfit >= 0;
  const exitDigit  = c.exit_tick_display_value ? String(c.exit_tick_display_value).slice(-1) : null;
  const settledAt  = Date.now();

  bot.pl += realProfit;
  if (realWon) {
    bot.wins++;
    bot.currentStake     = bot.resetOnWin ? bot.stake : bot.stake2;
    bot.consecutiveLosses = 0;
  } else {
    bot.losses++;
    bot.consecutiveLosses++;
    if (bot.consecutiveLosses >= bot.maxLoss) {
      bot.currentStake      = bot.stake;
      bot.consecutiveLosses = 0;
    } else {
      // Cap at remaining loss budget — one trade must not alone exceed the loss limit
      const _rem = Math.max(bot.stake, bot.lossLimit + bot.pl);
      bot.currentStake = Math.min(bot.currentStake * bot.martingale, _rem);
    }
  }

  // Report to backend — identical schema to browser execution
  bot._lastTradeAt = settledAt;
  bot._lastTrade = {
    id: cid,
    won: realWon,
    label: CONTRACT_LABELS[lc.contractType] || lc.contractType,
    contract_type: lc.contractType,
    barrier: lc.barrier || null,
    stake: Number(lc.stake || 0),
    profit: realProfit,
    pl: bot.pl,
    exit_digit: exitDigit,
    ts: settledAt,
  };
  bot._recentTrades = [bot._lastTrade, ...(bot._recentTrades || [])].slice(0, 12);
  pingStatus(true);

  reportTrade(lc, realProfit, realWon, exitDigit).catch(e => warn(`reportTrade: ${e.message}`));
}

// ── SESSION LIFECYCLE ─────────────────────────────────────────
function freshBot(cfg) {
  return {
    running:          true,
    sessionId:        cfg.session_id,
    loginId:          cfg.login_id  || null,
    market:           cfg.market    || '1HZ10V',
    strategy:         cfg.strategy  || 'even',
    stake:            Number(cfg.stake)              || 1,
    stake2:           Number(cfg.stake2 || cfg.stake) || 1,
    currentStake:     Number(cfg.stake)              || 1,
    martingale:       Number(cfg.martingale)         || 1,
    maxLoss:          Number(cfg.max_loss)           || 4,
    resetOnWin:       cfg.reset_on_win !== false,
    lossLimit:        Number(cfg.loss_limit)         || 50,
    targetProfit:     Number(cfg.target_profit)      || 25,
    currency:         cfg.currency  || 'USD',
    mode:             cfg.mode      || 'live',
    runs: 0, wins: 0, losses: 0, pl: 0,
    consecutiveLosses: 0,
    liveContract:      null,
    settlingContracts: [],
    lastBuyAt:         0,
    _exposurePausedAt: 0,
    aiRec:             null,
    _aiAt:             0,
    _lastTradeAt:      null,
    _lastTrade:        null,
    _recentTrades:     [],
    _stopReason:       null,
  };
}

async function startSession(cfg) {
  session = cfg;
  bot     = freshBot(cfg);
  log(`Session started: market=${bot.market} strategy=${bot.strategy} stake=${bot.stake} target=${bot.targetProfit} limit=${bot.lossLimit}`);

  connectDeriv().catch(e => {
    err(`Connect failed: ${e.message}`);
    stopSession();
  });

  // Notify backend — triggers Discord bot-session embed (same as browser stopBot/startBot)
  post('/api/session-relay', { type: 'bot', action: 'start', session_id: bot.sessionId, stats: {} }).catch(() => {});

  // Start heartbeat pinger — browser reads this for live stats
  clearInterval(_pingTimer);
  _pingTimer = setInterval(pingStatus, PING_MS);
  pingStatus(true);

  // Refresh Claude signal immediately
  setTimeout(refreshSignal, 5000);
}

async function stopSession() {
  if (!bot) return;
  bot.running = false;
  const { sessionId, runs, wins, losses, pl } = bot;
  const stats = { trades: runs, wins, losses, pl };
  if (!bot._stopReason) {
    if (pl >= bot.targetProfit) bot._stopReason = 'target';
    else if (pl <= -bot.lossLimit) bot._stopReason = 'loss';
    else bot._stopReason = 'manual';
  }

  log(`Session stopped — Trades:${runs} W/L:${wins}/${losses} P/L:${pl.toFixed(2)}`);
  disconnectDeriv();
  clearInterval(_pingTimer);

  // Notify backend — triggers Discord bot-session embed
  post('/api/session-relay', { type: 'bot', action: 'stop', session_id: sessionId, stats }).catch(() => {});

  // Mark session stopped in KV (browser status poll will see running:false)
  pingStatus(false);

  // Signal KV to stop (so browser sees it stopped even if browser initiated)
  api('/api/vps/session', { method: 'DELETE', body: JSON.stringify({ session_id: sessionId }) }).catch(() => {});

  session = null;
  bot     = null;
}

// ── STATUS HEARTBEAT ─────────────────────────────────────────
function pingStatus(running = true) {
  const b = bot || {};
  const isRunning = !!(bot && running);
  post('/api/vps/ping', {
    session_id:    b.sessionId || (session?.session_id || 'daemon-idle'),
    running:       isRunning,
    daemon_online: true,
    ws_ready:      wsReady,
    options_api:   usingOptionsApi,
    runs:          b.runs          || 0,
    wins:          b.wins          || 0,
    losses:        b.losses        || 0,
    pl:            b.pl            || 0,
    market:        b.market        || null,
    strategy:      b.strategy      || null,
    last_trade_at: b._lastTradeAt  || null,
    last_trade:    b._lastTrade    || null,
    recent_trades: b._recentTrades || [],
    stop_reason:   b._stopReason   || null,
  }).catch(() => {});
}

// ── CONFIG POLL LOOP ─────────────────────────────────────────
// VPS polls /api/vps/session every POLL_MS.
// - If no active session: check for a new start command (_running=true).
// - If active session:   check for a stop command (_running=false).
// Also refreshes Claude signal while session is running.
async function pollConfig() {
  try {
    const res = await api('/api/vps/session');
    if (!res) return;

    if (res.status === 404) {
      // No session in KV — idle
      if (bot) { warn('Session removed from KV — stopping'); await stopSession(); }
      pingStatus(false);
      return;
    }
    if (res.status === 401) {
      err('VPS_SECRET mismatch. Set the same VPS_SECRET in Worker and daemon env.');
      post('/api/vps/ping', {
        session_id:    'daemon-idle',
        running:       false,
        daemon_online: true,
        ws_ready:      false,
        daemon_error:  'VPS_SECRET mismatch — set matching VPS_SECRET in Worker and daemon env',
      }).catch(() => {});
      return;
    }
    if (!res.ok) {
      warn(`Session poll failed: HTTP ${res.status}`);
      pingStatus(false);
      return;
    }
    const cfg = await res.json();

    if (!bot) {
      // No active session locally — check if browser started one
      if (cfg._running && cfg.deriv_token) {
        await startSession(cfg);
      } else if (cfg._running && !cfg.deriv_token) {
        warn('Active VPS session is missing deriv_token. If VPS_SECRET is set in Worker, set the same VPS_SECRET in the daemon env.');
        pingStatus(false);
      } else {
        pingStatus(false);
      }
      return;
    }

    // Active session — check for stop command
    if (cfg._running === false) {
      log('Stop command received from browser');
      await stopSession();
      return;
    }

    // Session running — refresh Claude signal
    await refreshSignal();

  } catch (e) { warn(`Poll: ${e.message}`); }
}

// ── MAIN ──────────────────────────────────────────────────────
log('MoneyMeKa Pro VPS Bot Executor starting…');
log(`Polling ${API_BASE}/api/vps/session every ${POLL_MS}ms`);

_pollTimer = setInterval(pollConfig, POLL_MS);
pollConfig(); // immediate first check

process.on('SIGTERM', async () => { log('SIGTERM — stopping session'); await stopSession(); process.exit(0); });
process.on('SIGINT',  async () => { log('SIGINT — stopping session');  await stopSession(); process.exit(0); });
