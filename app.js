/* ─────────────────────────────────────────────────────────────
   MoneyMaker Pro — Deriv Advanced Trading Terminal
   ───────────────────────────────────────────────────────────── */

const SESSION_ID = "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function _genTradeId() { return "t" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8); }

// ── CONSTANTS ──────────────────────────────────────────────
const MARKETS = {
  R_10:"Volatility 10",R_25:"Volatility 25",R_50:"Volatility 50",
  R_75:"Volatility 75",R_100:"Volatility 100",
  "1HZ10V":"Volatility 10 (1s)","1HZ25V":"Volatility 25 (1s)",
  "1HZ50V":"Volatility 50 (1s)","1HZ75V":"Volatility 75 (1s)",
  "1HZ100V":"Volatility 100 (1s)",
};
const CONTRACT_LABELS = {
  DIGITEVEN:"Even",DIGITODD:"Odd",DIGITOVER:"Over",DIGITUNDER:"Under",
  DIGITMATCH:"Matches",DIGITDIFF:"Differs",CALL:"Rise",PUT:"Fall",
};

// ── CONSTANTS ────────────────────────────────────────────────
const DERIV_APP_ID           = "33jYDBwLAZ4xeAL6eYmkP"; // OAuth2 client_id + Deriv-App-ID header
const OAUTH_CLIENT_ID        = DERIV_APP_ID;             // alias used in OAuth URL construction
const DERIV_WS_APP_ID        = DERIV_APP_ID;             // same app_id for WebSocket
const AFFILIATE_SIGNUP_URL   = null;                     // disabled — was routing through Deriv's own platform

// ── ADMIN SESSION HELPERS (localStorage + 8-hour TTL) ───────
const _ADMIN_TTL = 8 * 60 * 60 * 1000;
function _admGet(k) {
  const exp = Number(localStorage.getItem(k + "_exp") || 0);
  if (exp && Date.now() > exp) { localStorage.removeItem(k); localStorage.removeItem(k + "_exp"); return null; }
  return localStorage.getItem(k);
}
function _admSet(k, v) { localStorage.setItem(k, v); localStorage.setItem(k + "_exp", Date.now() + _ADMIN_TTL); }
function _admClear(k) { localStorage.removeItem(k); localStorage.removeItem(k + "_exp"); }

// ── STATE ───────────────────────────────────────────────────
const st = {
  appId: localStorage.getItem("mm.appId") || "1089",
  token: localStorage.getItem("mm.token") || "",
  markup: Number(localStorage.getItem("mm.markup") ?? 3),
  ws: null, wsReady: false, isAuthorized: false, usingOptionsApi: false,
  isDemo: false,
  isAdmin: _admGet("mm.admin") === "1",
  vpsMode: localStorage.getItem("mm.vpsMode") === "1",
  _vpsSessionId: null, _vpsPollTimer: null, _vpsArmTimer: null, _vpsDaemonError: null,
  _vpsSeenTradeIds: {},
  _reconnectAttempts: 0, _reconnectTimer: null,
  config: {
    claude_gate: "1",
    show_auto_trade_to_clients: "0",
    show_bot: "1",
    show_analysis: "1",
    require_ai_claude_agreement: "1",
    min_ai_confidence: "60",
    min_claude_confidence: "60",
    min_historical_win_rate: "55",
    min_historical_sample: "10",
    allow_live_execution: "0",
    allow_paper_execution: "1",
  },
  autoTrade: { running: false, pl: 0, wins: 0, losses: 0, stake: 1, maxStake: 2, target: 25, lossLimit: 50, sessionPL: 0, sessionTarget: 0, sessionLimit: 0, lastRotationAt: 0 },
  loginId: "", currency: "USD",
  balance: 10000, paperBalance: 10000,
  symbol: localStorage.getItem("mm.symbol") || "1HZ10V",
  contractType: "DIGITEVEN",
  stake: 1, duration: 1, durationUnit: "t", barrier: "4",

  // tick storage — keyed by symbol
  ticksAll: {},
  tickWindow: 1000,

  openTrades: [],
  journal: JSON.parse(localStorage.getItem("mm.journal") || "[]"),
  nextReqId: 1,
  proposal: null,
  simulationTimer: null,
  chartView: "ticks",
  currentTab: "analysis",

  // strategy engine
  strategyState: {
    lastDigit: null,
    triggerBuffer: [],      // rolling window for entry triggers
    watchFor: null,         // { type, condition, expiresAfter }
  },

  // bot
  bot: {
    running: false,
    market: "1HZ10V",
    tradeType: "digits_ou",
    stake: 1, stake2: 1, currentStake: 1,
    lossLimit: 50, targetProfit: 25,
    duration: 1, durationUnit: "t",
    useStrategy: true,
    strategy: "over123",
    martingale: 1,
    maxLoss: 4,
    resetOnWin: true,
    runs: 0, wins: 0, losses: 0, pl: 0,
    worstPL: 0,
    consecutiveLosses: 0,
    stopRequested: false,
    pendingTrade: null,
    pendingEntryTick: false,
    liveContract: null,
    settlingContracts: [],
    lastBuyAt: 0,
    entryWatch: null,
  },
  aiRec: null,          // { recommended, confidence, scores, mood }
  claudeLastScan: null, // { rec, conf, reason, col, market, ts, agreed }
  gptLastScan: null,   // { rec, conf, reason } from GPT-4o-mini dual scan
};

function ticks(sym) {
  sym = sym || st.symbol;
  if (!st.ticksAll[sym]) st.ticksAll[sym] = [];
  return st.ticksAll[sym];
}

function windowTicks(sym) {
  const all = ticks(sym);
  return all.slice(-st.tickWindow);
}

// ── DOM REFS ────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const el = {
  connectBtn: $("connectButton"),
  switchAccountBtn: $("switchAccountButton"),
  disconnectBtn: $("disconnectButton"),
  topbarBalance: $("topbarBalance"),
  topbarBalanceValue: $("topbarBalanceValue"),
  accountStatus: $("accountStatus"),
  streamBadge: $("streamBadge"),
  statusDot: $("statusDot"),
  streamStateLabel: $("streamStateLabel"),
  liveIndicator: $("liveIndicator"),
  settingsBtn: $("settingsButton"),
  settingsDialog: $("settingsDialog"),
  appIdInput: $("appIdInput"),
  tokenInput: $("tokenInput"),
  markupInput: $("markupInput"),
  feeDisplay: $("feeDisplay"),
  oauthBtn: $("oauthButton"),
  saveSettingsBtn: $("saveSettingsButton"),
  marketSelect: $("marketSelect"),
  lastPriceBig: $("lastPriceBig"),
  priceChange: $("priceChange"),
  lastDigitDisplay: $("lastDigitDisplay"),
  tickCountDisplay: $("tickCountDisplay"),
  tickWindowRange: $("tickWindowRange"),
  tickWindowInput: $("tickWindowInput"),
  windowSizeLabel: $("windowSizeLabel"),
  windowLabel: $("windowLabel"),
  signalList: $("signalList"),
  modeLabel: $("modeLabel"),
  balanceValue: $("balanceValue"),
  realToggle: $("realExecutionToggle"),
  chartTitle: $("chartTitle"),
  chartSubtitle: $("chartSubtitle"),
  tickCanvas: $("tickCanvas"),
  pricePulse: $("pricePulse"),
  tickTime: $("tickTime"),
  digitCircles: $("digitCircles"),
  digitBarsGrid: $("digitBarsGrid"),
  evenCount: $("evenCount"), evenPct: $("evenPct"), evenBar: $("evenBar"),
  oddCount: $("oddCount"),   oddPct: $("oddPct"),   oddBar: $("oddBar"),
  over4Pct: $("over4Pct"),   over4Bar: $("over4Bar"),
  under5Pct: $("under5Pct"), under5Bar: $("under5Bar"),
  over1Pct: $("over1Pct"),   over1Bar: $("over1Bar"),
  under8Pct: $("under8Pct"), under8Bar: $("under8Bar"),
  contractGrid: $("contractGrid"),
  selectedContract: $("selectedContract"),
  ticketProposal: null,
  proposalValue: $("proposalValue"),
  proposalMeta: $("proposalMeta"),
  stakeInput: $("stakeInput"),
  durationInput: $("durationInput"),
  durationUnitSelect: $("durationUnitSelect"),
  barrierSelect: $("barrierSelect"),
  digitBarrierField: $("digitBarrierField"),
  buyButton: $("buyButton"),
  openTrades: $("openTrades"),
  openCount: $("openCount"),
  activityLog: $("activityLog"),
  clearLogBtn: $("clearLogButton"),
  // bot
  botMarket: $("botMarket"),
  botTradeType: $("botTradeType"),
  botStake: $("botStake"),
  botStake2: $("botStake2"),
  botLossLimit: $("botLossLimit"),
  botTargetProfit: $("botTargetProfit"),
  botDuration: $("botDuration"),
  botDurationUnit: $("botDurationUnit"),
  botUseStrategy: $("botUseStrategy"),
  botStrategyPicker: $("botStrategyPicker"),
  botMartingale: $("botMartingale"),
  botMaxLoss: $("botMaxLoss"),
  botResetOnWin: $("botResetOnWin"),
  botStatusLabel: $("botStatusLabel"),
  botRunCount: $("botRunCount"),
  botWinCount: $("botWinCount"),
  botLossCount: $("botLossCount"),
  botPL: $("botPL"),
  botBalance: $("botBalance"),
  botRunBtn: $("botRunBtn"),
  botStopBtn: $("botStopBtn"),
  botResetBtn: $("botResetBtn"),
  botLog: $("botLog"),
  clearBotLog: $("clearBotLog"),
  botDigitFeed: $("botDigitFeed"),
  botDigitBars: $("botDigitBars"),
  botSignalStatus: $("botSignalStatus"),
  botWindow: $("botWindow"),
  // strategies
  // calculator
  calcCapital: $("calcCapital"),
  calcStake: $("calcStake"),
  calcTakeProfit: $("calcTakeProfit"),
  calcStopLoss: $("calcStopLoss"),
  calcMaxStake: $("calcMaxStake"),
  calcDrawdown: $("calcDrawdown"),
  martingaleTable: $("martingaleTable"),
  // journal
  jTotal: $("jTotal"), jWins: $("jWins"), jLosses: $("jLosses"),
  jWinRate: $("jWinRate"), jPL: $("jPL"), jAvgStake: $("jAvgStake"),
  journalTable: $("journalTable"),
  exportJournal: $("exportJournal"),
  clearJournal: $("clearJournal"),
  // AI advisor
  aiMoodBadge: $("aiMoodBadge"),
  aiRecStrategy: $("aiRecStrategy"),
  aiConfidenceFill: $("aiConfidenceFill"),
  aiConfidenceText: $("aiConfidenceText"),
  aiScoresGrid: $("aiScoresGrid"),
};

// ── HELPERS ─────────────────────────────────────────────────
function fmt(v, cur) {
  cur = cur || st.currency;
  return `${Number(v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} ${cur}`;
}

function lastDig(price) {
  const s = Number(price).toFixed(2).replace(".","");
  return Number(s[s.length-1]);
}

function reqId() { return ++st.nextReqId; }

function marketName(sym) { return MARKETS[sym||st.symbol] || sym || st.symbol; }

function log(msg, type) {
  type = type || "info";
  const d = document.createElement("div");
  d.className = `log-item ${type}`;
  d.textContent = `${new Date().toLocaleTimeString()} ${msg}`;
  el.activityLog.prepend(d);
  while (el.activityLog.children.length > 80) el.activityLog.lastChild.remove();
}

function botLog(msg, type) {
  type = type || "info";
  const d = document.createElement("div");
  d.className = `bot-log-item ${type}`;
  d.textContent = `${new Date().toLocaleTimeString()} ${msg}`;
  el.botLog.prepend(d);
  while (el.botLog.children.length > 120) el.botLog.lastChild.remove();
}

// Returns correct market field for WS messages — Options API uses underlying_symbol, legacy uses symbol
function _sym(sym) { return st.usingOptionsApi ? { underlying_symbol: sym } : { symbol: sym }; }

// ── WEBSOCKET ────────────────────────────────────────────────
function send(payload) {
  if (!st.ws || st.ws.readyState !== WebSocket.OPEN) return null;
  const id = payload.req_id || reqId();
  st.ws.send(JSON.stringify({...payload, req_id: id}));
  return id;
}

function setStreamState(label, mode) {
  // mode: "live" | "demo" | "offline"
  el.streamStateLabel.textContent = label;
  el.statusDot.className = "status-dot " + (mode || "");
  el.liveIndicator.className = "live-dot " + (mode === "live" ? "online" : "");
}

// ── NEW DERIV OPTIONS API ────────────────────────────────────
async function getDerivOptionsWsUrl() {
  if (!st.token) return null;
  try {
    _diagStep("options_accounts", "/api/options/accounts", "pending", "");
    const acctRes = await fetch("/api/deriv-options/accounts", {
      headers: { "Authorization": "Bearer " + st.token, "Content-Type": "application/json" }
    });
    const acctBody = await acctRes.text();
    console.log("[Options API] accounts status:", acctRes.status, "body:", acctBody);
    localStorage.setItem("mm_last_options_accounts", JSON.stringify({ status: acctRes.status, body: acctBody, ts: Date.now() }));
    _diagStep("options_accounts", "/api/options/accounts", acctRes.ok ? "ok" : "fail", acctRes.status + ": " + acctBody.slice(0, 120));
    if (acctRes.status === 401) {
      // Token expired — clear it and send user to fresh login
      st.token = "";
      localStorage.removeItem("mm.token");
      log("Deriv session expired. Please log in again.", "warn");
      redirectToOAuth(false, true); // force fresh login
      return null;
    }
    if (!acctRes.ok) {
      // For old accounts, check migration status to give a helpful message
      if (acctRes.status === 404 || acctRes.status === 403) {
        try {
          const migRes = await fetch("/api/deriv-options/migration-status", {
            headers: { "Authorization": "Bearer " + st.token }
          });
          const migData = await migRes.json().catch(() => ({}));
          const migStatus = migData?.data?.status || migData?.status || "unknown";
          console.log("[Options API] migration status:", migStatus);
          if (migStatus !== "completed") {
            log("Your Deriv account hasn't been migrated to the new trading system yet. Please log in at deriv.com and complete any pending account upgrade steps, then try again.", "warn");
            _diagStep("migration", "Account Migration", "fail", "Status: " + migStatus + " — account not yet on Options API");
            return null;
          }
        } catch (_) {}
      }
      throw new Error("accounts " + acctRes.status + " — " + acctBody);
    }
    const acctData = JSON.parse(acctBody);
    const rawAccounts = acctData.data ?? acctData.accounts ?? acctData;
    const accounts = Array.isArray(rawAccounts) ? rawAccounts : (rawAccounts ? [rawAccounts] : []);
    const isDemoAccount = a =>
      a?.is_virtual === 1 ||
      a?.is_virtual === true ||
      String(a?.account_type || a?.type || "").toLowerCase() === "demo";
    // Prefer real account regardless of the live-execution toggle.
    // The toggle controls whether trades execute live, not which Deriv account connects.
    const realAccount = accounts.find(a => !isDemoAccount(a));
    const account = realAccount || accounts[0];
    const accountId = account?.account_id || account?.id;
    if (!accountId) throw new Error("No Options account found in: " + JSON.stringify(accounts));
    _diagStep("options_otp", "/api/options/otp", "pending", "");
    const otpRes = await fetch("/api/deriv-options/otp", {
      method: "POST",
      headers: { "Authorization": "Bearer " + st.token, "Content-Type": "application/json" },
      body: JSON.stringify({ account_id: accountId })
    });
    const otpBody = await otpRes.text();
    console.log("[Options API] otp status:", otpRes.status, "body:", otpBody);
    localStorage.setItem("mm_last_options_otp", JSON.stringify({ status: otpRes.status, body: otpBody, account_id: accountId, ts: Date.now() }));
    _diagStep("options_otp", "/api/options/otp", otpRes.ok ? "ok" : "fail", otpRes.status + ": " + otpBody.slice(0, 120));
    if (!otpRes.ok) throw new Error("OTP " + otpRes.status + " — " + otpBody);
    const otpData = JSON.parse(otpBody);
    const wsUrl = otpData.url || otpData.data?.url || otpData.data?.websocket_url || otpData.data?.ws_url;
    if (!wsUrl) throw new Error("No WS URL in OTP response: " + JSON.stringify(otpData));
    log("Deriv Options API: authenticated WebSocket obtained.");
    // Return WS URL plus account details so connectDeriv can set auth state directly
    // without needing the { authorize } WS message (OTP URL already proves auth)
    return {
      wsUrl,
      loginId:   account?.login_id   || account?.loginid    || accountId,
      isVirtual: isDemoAccount(account),
      currency:  account?.currency   || "USD",
    };
  } catch (err) {
    console.log("[Options API] FAILED:", err.message);
    log("Deriv Options API unavailable (" + err.message + ") — legacy WebSocket fallback.", "warn");
    return null;
  }
}

async function checkDerivMigrationStatus() {
  if (!st.token) return;
  try {
    const res = await fetch("https://api.derivws.com/trading/v1/options/legacy/migration-status", {
      headers: { "Deriv-App-ID": DERIV_APP_ID, "Authorization": "Bearer " + st.token }
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.status && data.status !== "completed") {
      log("Deriv account migration pending — live trading may be limited.", "warn");
    }
  } catch (_) {}
}

async function connectDeriv() {
  disconnectDeriv(false);
  stopSim();
  const inputId = el.appIdInput.value.trim();
  st.appId = inputId || "1089";
  localStorage.setItem("mm.appId", st.appId);

  // Only pull from the input if the user actually typed something new.
  // Never let an empty input field overwrite a valid saved token.
  const _inputToken = el.tokenInput?.value?.trim() || "";
  if (_inputToken) {
    if (_inputToken !== st.token) {
      st.token = _inputToken;
      localStorage.setItem("mm.token", st.token);
      log("Saved Deriv token.");
    }
  } else if (st.token) {
    log("Reconnecting saved Deriv session…");
  }

  setStreamState("Connecting…", "");
  log("Connecting to Deriv…");

  // Ory tokens (ory_at_...) use new Options API; legacy tokens go straight to legacy WS.
  let wsUrl = null;
  let optionsAccount = null; // { loginId, isVirtual, currency } from REST — used to set auth state directly
  if (st.token && st.token.startsWith("ory_at_")) {
    optionsAccount = await getDerivOptionsWsUrl();
    wsUrl = optionsAccount?.wsUrl || null;
    st.usingOptionsApi = !!wsUrl;
    if (wsUrl) checkDerivMigrationStatus();
  }
  if (!wsUrl) {
    // Legacy WS requires a numeric app_id — use st.appId if numeric, else "1089" (Deriv's demo app_id)
    const wsAppId = /^\d+$/.test(st.appId) ? st.appId : "1089";
    wsUrl = `wss://ws.derivws.com/websockets/v3?app_id=${wsAppId}`;
  }
  console.log("[WS] connecting to:", wsUrl);

  try {
    st.ws = new WebSocket(wsUrl);
  } catch(e) {
    log("WebSocket init failed: " + e.message, "error");
    startSim(); return;
  }

  st.ws.onopen = () => {
    st.wsReady = true;
    st._reconnectAttempts = 0;
    clearTimeout(st._reconnectTimer);
    setStreamState("Live ticks", "live");
    log("Connected to Deriv price stream.");
    subscribeTicks(st.symbol);
    send(st.usingOptionsApi ? { active_symbols:"brief" } : { active_symbols:"brief", product_type:"basic" });
    if (optionsAccount?.wsUrl) {
      // OTP URL already proves authentication — set auth state directly from REST account data.
      // Do NOT send { authorize: ory_at_token } — that message expects a Deriv API token, not OAuth Bearer.
      st.isAuthorized = true;
      st.loginId   = optionsAccount.loginId;
      st.isDemo    = optionsAccount.isVirtual;
      st.currency  = optionsAccount.currency || st.currency;
      log(`Authorized (Options API): ${st.loginId}${st.isDemo ? " (Demo)" : ""}`);
      pingVisitor(st.loginId, st.isDemo);
      applyClaudeGate();
      applyStrategyGate();
      send({ balance: 1, subscribe: 1 });
      updateModeUi();
      refreshProposal();
      _diagSuccess();
    } else if (st.token && st.token.startsWith("ory_at_")) {
      log("OAuth token received, but Options API WebSocket failed. Staying in paper mode.", "warn");
      _diagStep("mode", "Final Mode", "fail", "Options API unavailable — ory_at_ cannot be used on legacy WS");
    } else if (st.token) {
      send({ authorize: st.token });
    }
    setTimeout(subscribeTickerSyms, 1500);
    startClaudeAutoScan();
  };

  st.ws.onmessage = ev => {
    try { handleMsg(JSON.parse(ev.data)); } catch(e) {}
  };

  st.ws.onclose = () => {
    st.wsReady = false; st.isAuthorized = false; st.usingOptionsApi = false; st.proposal = null;
    setStreamState("Offline", "");
    updateModeUi();
    if (st.token && st._reconnectAttempts < 5) {
      st._reconnectAttempts++;
      const delay = Math.min(30000, 3000 * Math.pow(2, st._reconnectAttempts - 1));
      log(`Connection lost — reconnecting in ${delay / 1000}s… (${st._reconnectAttempts}/5)`, "warn");
      clearTimeout(st._reconnectTimer);
      st._reconnectTimer = setTimeout(() => { if (!st.wsReady && st.token) connectDeriv(); }, delay);
    } else {
      log("Connection closed — demo stream started.", "warn");
      startSim();
    }
  };

  st.ws.onerror = () => log("WebSocket error.", "error");
}

function disconnectDeriv(announce) {
  if (st.ws) { st.ws.onclose = null; st.ws.close(); st.ws = null; }
  st.wsReady = false; st.isAuthorized = false;
  // Clear Claude auto-scan so reconnect re-arms it
  if (_claudeAutoScanTimer) { clearInterval(_claudeAutoScanTimer); _claudeAutoScanTimer = null; }
  _claudeAutoScanStarted = false;
  if (announce !== false) log("Disconnected from Deriv.");
  updateModeUi();
}

function handleMsg(m) {
  if (m.error) {
    console.log("[WS:error] msg_type:", m.msg_type, "| error:", JSON.stringify(m.error));
    log(m.error.message || "API error", "error");
    if (m.msg_type === "buy") {
      const errMsg = m.error.message || m.error.code || "Buy failed";
      if (st.bot.liveContract && !st.bot.liveContract.contractId) {
        // Error arrived while slot was still live
        botLog(`Buy error: ${errMsg} — clearing live slot`, "warn");
        st.bot.liveContract = null;
      } else {
        // Error arrived after tick-advance moved slot to settlingContracts
        const _staleIdx = st.bot.settlingContracts.findIndex(t => !t.contractId);
        if (_staleIdx >= 0) {
          botLog(`Buy error (late): ${errMsg} — clearing stale settling slot`, "warn");
          st.bot.settlingContracts.splice(_staleIdx, 1);
        } else if (st.bot.pendingTrade) {
          st.bot.pendingTrade = null;
        }
      }
    }
    return;
  }
  switch (m.msg_type) {
    case "authorize":
      console.log("[WS:authorize] response:", JSON.stringify(m.authorize));
      st.isAuthorized = true;
      st.loginId = m.authorize.loginid;
      st.currency = m.authorize.currency || st.currency;
      st.isDemo = m.authorize.is_virtual === 1;
      log(`Authorized: ${st.loginId}${st.isDemo ? " (Demo)" : ""}`);
      pingVisitor(st.loginId, st.isDemo);
      applyClaudeGate();
      applyStrategyGate();
      send({ balance:1, subscribe:1 });
      updateModeUi(); refreshProposal(); break;
    case "balance":
      if (m.balance) {
        st.balance = Number(m.balance.balance);
        st.currency = m.balance.currency || st.currency;
        updateModeUi();
      } break;
    case "active_symbols":
      hydrateMarkets(m.active_symbols || []); break;
    case "tick":
      if (m.tick) onTick(Number(m.tick.quote), m.tick.symbol, m.tick.epoch*1000); break;
    case "history":
      hydrateHistory(m); break;
    case "proposal":
      st.proposal = m.proposal; renderProposal(); break;
    case "buy":
      handleLiveBuy(m.buy); break;
    case "proposal_open_contract":
      handleOpenContract(m.proposal_open_contract); break;
  }
}

function subscribeTicks(sym, opts = {}) {
  if (!st.wsReady) return;
  send({ forget_all: "ticks" });
  send({ ticks: sym, subscribe: 1 });
  send({
    ticks_history: sym,
    adjust_start_time: 1,
    count: Math.min(st.tickWindow + 50, 5000),
    end: "latest",
    start: 1,
    style: "ticks"
  });
  if (opts.clear !== false) {
    ticks(sym).length = 0;
  }
  setTimeout(() => subscribeTickerSyms(), 500);
}

function hydrateHistory(m) {
  const h = m.history;
  if (!h || !Array.isArray(h.prices)) return;
  const sym = m.echo_req?.ticks_history || st.symbol;
  st.ticksAll[sym] = h.prices.map((p, i) => ({
    price: Number(p),
    timestamp: Number(h.times?.[i] || Date.now() / 1000) * 1000,
  })).filter(t => isFinite(t.price));
  renderAll();
  const b = st.bot;
  if (b.running && !b.stopRequested && sym === b.market && !b.liveContract && !b.pendingTrade) {
    const last = st.ticksAll[sym].at(-1);
    if (last) runBotEngine(last.price);
  }
}

function hydrateMarkets(syms) {
  const synths = syms.filter(s => s.market==="synthetic_index" && s.symbol).slice(0,80);
  if (!synths.length) return;
  synths.forEach(s => { MARKETS[s.symbol] = s.display_name; });
  const cur = st.symbol;
  el.marketSelect.innerHTML = "";
  synths.forEach(s => {
    const o = document.createElement("option");
    o.value = s.symbol; o.textContent = s.display_name;
    el.marketSelect.append(o);
  });
  el.marketSelect.value = MARKETS[cur] ? cur : synths[0].symbol;
  st.symbol = el.marketSelect.value;
  updateMarketUi();
}

// ── TICK PROCESSING ──────────────────────────────────────────
function onTick(price, sym, ts) {
  if (!isFinite(price)) return;
  sym = sym || st.symbol;
  if (!st.ticksAll[sym]) st.ticksAll[sym] = [];
  const arr = st.ticksAll[sym];
  arr.push({ price, timestamp: ts || Date.now() });
  // keep max 6000 ticks per symbol
  if (arr.length > 6000) arr.shift();

  if (sym === st.symbol) {
    settlePaperTrades(price);
    runStrategyEngine(price);
    renderAll();
    if (st.wsReady && !st.bot.running) refreshProposal();
  }
  // Run bot engine only on ticks from the bot's own market
  if (st.bot.running && sym === st.bot.market) {
    runBotEngine(price);
  }
  if (sym === st.bot.market) updateBotDigitFeed(price);
  scheduleTickerUpdate();
}

// ── RENDERING ────────────────────────────────────────────────
function renderAll() {
  const w = windowTicks();
  const latest = w[w.length-1];
  if (!latest) return;

  const dig = lastDig(latest.price);

  // price header
  const prev = w[w.length-2];
  const change = prev ? latest.price - prev.price : 0;
  el.lastPriceBig.textContent = latest.price.toFixed(2);
  el.priceChange.textContent = (change >= 0 ? "+" : "") + change.toFixed(2);
  el.priceChange.className = "price-change " + (change >= 0 ? "up" : "down");
  el.lastDigitDisplay.textContent = String(dig);
  el.tickCountDisplay.textContent = String(ticks().length);
  el.pricePulse.textContent = latest.price.toFixed(2);
  el.tickTime.textContent = new Date(latest.timestamp).toLocaleTimeString();
  el.chartSubtitle.textContent = `${w.length} ticks in window | ${ticks().length} total`;

  drawChart(w);
  renderDigitAnalysis(w, dig);
  renderEvenOdd(w);
  renderOverUnder(w);

  renderOpenTrades();
  updateModeUi();
}

function drawChart(w) {
  const canvas = el.tickCanvas;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0,0,W,H);

  // background
  const isLight = document.body.classList.contains("light");
  ctx.fillStyle = isLight ? "#f8f9fb" : "#05080d";
  ctx.fillRect(0,0,W,H);

  // grid
  ctx.strokeStyle = isLight ? "rgba(180,195,215,.7)" : "rgba(36,46,63,.6)"; ctx.lineWidth = 1;
  for (let x=0; x<W; x+=60) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  for (let y=0; y<H; y+=40) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

  const vis = w.slice(-120);
  if (vis.length < 2) { ctx.fillStyle="#8a97ad"; ctx.font="14px system-ui"; ctx.fillText("Waiting for ticks…",24,36); return; }

  if (st.chartView === "digits") { drawDigitView(ctx, vis, W, H); return; }

  const prices = vis.map(t => t.price);
  const mn = Math.min(...prices), mx = Math.max(...prices), rng = mx-mn || 1;
  const pad = 28;
  const yFor = p => H-pad-((p-mn)/rng)*(H-pad*2);
  const xFor = i => pad+(i/(vis.length-1))*(W-pad*2);

  // area fill
  const g = ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0,"rgba(79,140,255,.18)"); g.addColorStop(1,"transparent");
  ctx.beginPath();
  vis.forEach((t,i) => { const x=xFor(i),y=yFor(t.price); i===0?ctx.moveTo(x,y):ctx.lineTo(x,y); });
  ctx.lineTo(xFor(vis.length-1),H); ctx.lineTo(xFor(0),H); ctx.closePath();
  ctx.fillStyle = g; ctx.fill();

  // line
  const lg = ctx.createLinearGradient(0,0,W,0);
  lg.addColorStop(0,"#4f8cff"); lg.addColorStop(1,"#19c37d");
  ctx.beginPath();
  vis.forEach((t,i) => { const x=xFor(i),y=yFor(t.price); i===0?ctx.moveTo(x,y):ctx.lineTo(x,y); });
  ctx.strokeStyle=lg; ctx.lineWidth=2.5; ctx.stroke();

  // current dot
  const lx=xFor(vis.length-1), ly=yFor(vis[vis.length-1].price);
  ctx.fillStyle="#19c37d"; ctx.beginPath(); ctx.arc(lx,ly,5,0,Math.PI*2); ctx.fill();
  ctx.fillStyle="rgba(25,195,125,.25)"; ctx.beginPath(); ctx.arc(lx,ly,10,0,Math.PI*2); ctx.fill();

  // price labels
  ctx.fillStyle = isLight ? "#5a6474" : "#8a97ad"; ctx.font="11px system-ui";
  ctx.fillText(mx.toFixed(2),8,20); ctx.fillText(mn.toFixed(2),8,H-10);
}

function drawDigitView(ctx, vis, W, H) {
  const digits = vis.map(t => lastDig(t.price));
  const cw = W/Math.max(digits.length,1);
  digits.forEach((d,i) => {
    const x = i*cw;
    const isEven = d%2===0;
    ctx.fillStyle = isEven ? `rgba(25,195,125,${0.15+d*0.04})` : `rgba(245,184,75,${0.15+d*0.04})`;
    const barH = 20 + d*22;
    ctx.fillRect(x, H-barH, Math.max(2,cw-1), barH);
    if (i===digits.length-1) {
      ctx.strokeStyle="#4f8cff"; ctx.lineWidth=2;
      ctx.strokeRect(x,H-barH,Math.max(2,cw-1),barH);
    }
  });
  ctx.fillStyle = document.body.classList.contains("light") ? "#0d1117" : "#eef3fb"; ctx.font="13px system-ui"; ctx.fillText("Digit view",16,24);
}

// ── DIGIT ANALYSIS ───────────────────────────────────────────
function computeDigitStats(w) {
  const counts = Array(10).fill(0);
  w.forEach(t => counts[lastDig(t.price)]++);
  const total = w.length || 1;
  const pcts = counts.map(c => (c/total)*100);
  // rank: index sorted by count descending
  const sorted = counts.map((c,i)=>({c,i})).sort((a,b)=>b.c-a.c);
  const rankOf = Array(10);
  sorted.forEach((item,rank) => { rankOf[item.i] = rank+1; }); // rank 1 = most
  return { counts, pcts, total, rankOf };
}

function renderDigitAnalysis(w, currentDig) {
  const { counts, pcts, rankOf } = computeDigitStats(w);
  const maxCount = Math.max(...counts,1);

  // circles
  el.digitCircles.innerHTML = "";
  for (let d=0; d<10; d++) {
    const rank = rankOf[d];
    let cls = "";
    if (rank===1) cls="rank-1";
    else if (rank===2) cls="rank-2";
    else if (rank===10) cls="rank-10";
    else if (rank===9) cls="rank-9";
    const isCurrent = d===currentDig;

    const wrap = document.createElement("div");
    wrap.className = "d-circle";
    wrap.innerHTML = `
      <div class="d-circle-badge ${cls}${isCurrent?" current":""}">${d}</div>
      <span class="d-pct">${pcts[d].toFixed(1)}%</span>
    `;
    el.digitCircles.append(wrap);
  }

  // bars
  el.digitBarsGrid.innerHTML = "";
  for (let d=0; d<10; d++) {
    const rank = rankOf[d];
    let fillCls = "";
    if (rank===1) fillCls="rank-1";
    else if (rank===2) fillCls="rank-2";
    else if (rank===10) fillCls="rank-10";
    else if (rank===9) fillCls="rank-9";

    const row = document.createElement("div");
    row.className = "digit-bar-row";
    row.innerHTML = `
      <span>${d}</span>
      <div class="dbar-track"><div class="dbar-fill ${fillCls}" style="width:${(counts[d]/maxCount)*100}%"></div></div>
      <span class="dbar-pct">${pcts[d].toFixed(1)}%</span>
    `;
    el.digitBarsGrid.append(row);
  }

  // update window label
  el.windowLabel.textContent = String(st.tickWindow);
  el.botWindow.textContent = `${st.tickWindow} ticks`;

  // bot mirror bars
  renderBotDigitBars(counts, pcts, rankOf);
}

function renderBotDigitBars(counts, pcts, rankOf) {
  if (!el.botDigitBars) return;
  el.botDigitBars.innerHTML = "";
  const maxC = Math.max(...counts,1);
  for (let d=0; d<10; d++) {
    const rank = rankOf[d];
    let cls = "";
    if (rank===1) cls="rank-1";
    else if (rank===2) cls="rank-2";
    else if (rank===10) cls="rank-10";
    else if (rank===9) cls="rank-9";
    const row = document.createElement("div");
    row.className = "digit-bar-row";
    row.innerHTML = `<span>${d}</span><div class="dbar-track"><div class="dbar-fill ${cls}" style="width:${(counts[d]/maxC)*100}%"></div></div><span class="dbar-pct">${pcts[d].toFixed(1)}%</span>`;
    el.botDigitBars.append(row);
  }
}

function renderEvenOdd(w) {
  let even=0, odd=0;
  w.forEach(t => { const d=lastDig(t.price); d%2===0?even++:odd++; });
  const tot = w.length||1;
  const ep = (even/tot)*100, op = (odd/tot)*100;
  el.evenCount.textContent = String(even);
  el.oddCount.textContent = String(odd);
  el.evenPct.textContent = ep.toFixed(1)+"%";
  el.oddPct.textContent = op.toFixed(1)+"%";
  el.evenBar.style.width = ep+"%";
  el.oddBar.style.width = op+"%";
}

function renderOverUnder(w) {
  const tot = w.length||1;
  const digits = w.map(t => lastDig(t.price));
  const over1 = digits.filter(d=>d>1).length/tot*100;
  const over4 = digits.filter(d=>d>4).length/tot*100;
  const under5 = digits.filter(d=>d<5).length/tot*100;
  const under8 = digits.filter(d=>d<8).length/tot*100;
  el.over4Pct.textContent = over4.toFixed(1)+"%";
  el.under5Pct.textContent = under5.toFixed(1)+"%";
  el.over1Pct.textContent = over1.toFixed(1)+"%";
  el.under8Pct.textContent = under8.toFixed(1)+"%";
  el.over4Bar.style.width = over4+"%";
  el.under5Bar.style.width = under5+"%";
  el.over1Bar.style.width = over1+"%";
  el.under8Bar.style.width = under8+"%";
}

// ── STRATEGY ENGINE ──────────────────────────────────────────
function checkOver123(stats) {
  const { pcts, rankOf } = stats;
  const lowDigits = [0,1,2,3];
  const highDigits = [4,5,6,7,8,9];
  const lowBelowTen = lowDigits.filter(d => pcts[d] < 10);
  const hasRedOrAmber = lowDigits.some(d => rankOf[d]===10||rankOf[d]===9);
  const highAbove11 = highDigits.filter(d => pcts[d] >= 11);
  const greenBlueSameRange = (() => {
    const g = rankOf.indexOf(1), b = rankOf.indexOf(2);
    return highDigits.includes(g) && highDigits.includes(b);
  })();
  if (lowBelowTen.length >= 4 && hasRedOrAmber && highAbove11.length >= 2 && greenBlueSameRange)
    return "ready";
  if (lowBelowTen.length >= 2 && highAbove11.length >= 1) return "partial";
  return "fail";
}

function checkUnder876(stats) {
  const { pcts, rankOf } = stats;
  const highDigits = [6,7,8,9];
  const lowDigits = [0,1,2,3,4,5];
  const highBelowTen = highDigits.filter(d => pcts[d] < 10);
  const hasRedOrAmber = highDigits.some(d => rankOf[d]===10||rankOf[d]===9);
  const lowAbove11 = lowDigits.filter(d => pcts[d] >= 11);
  const greenBlueSameRange = (() => {
    const g = rankOf.indexOf(1), b = rankOf.indexOf(2);
    return lowDigits.includes(g) && lowDigits.includes(b);
  })();
  if (highBelowTen.length >= 4 && hasRedOrAmber && lowAbove11.length >= 2 && greenBlueSameRange)
    return "ready";
  if (highBelowTen.length >= 2 && lowAbove11.length >= 1) return "partial";
  return "fail";
}

function checkOdd(stats) {
  const { pcts, rankOf } = stats;
  const oddDigits = [1,3,5,7,9];
  const evenDigits = [0,2,4,6,8];
  // Aggregate gate: total odd % must exceed house edge margin
  const totalOddPct = oddDigits.reduce((s, d) => s + pcts[d], 0);
  if (totalOddPct < 53) return "fail";
  const gIdx = rankOf.indexOf(1), bIdx = rankOf.indexOf(2);
  const rIdx = rankOf.indexOf(10), yIdx = rankOf.indexOf(9);
  const gOnOdd = oddDigits.includes(gIdx) && pcts[gIdx] >= 11;
  const bOnOdd = oddDigits.includes(bIdx) && pcts[bIdx] >= 11;
  const rOnEven = evenDigits.includes(rIdx) && pcts[rIdx] <= 8.6;
  const yOnEven = evenDigits.includes(yIdx) && pcts[yIdx] <= 9.5;
  if (gOnOdd && bOnOdd && rOnEven && yOnEven) return "ready";
  if ((gOnOdd || bOnOdd) && (rOnEven || yOnEven)) return "partial";
  return "fail";
}

function checkEven(stats) {
  const { pcts, rankOf } = stats;
  const evenDigits = [0,2,4,6,8];
  const oddDigits = [1,3,5,7,9];
  // Aggregate gate: total even % must exceed house edge margin
  const totalEvenPct = evenDigits.reduce((s, d) => s + pcts[d], 0);
  if (totalEvenPct < 53) return "fail";
  const gIdx = rankOf.indexOf(1), bIdx = rankOf.indexOf(2);
  const rIdx = rankOf.indexOf(10), yIdx = rankOf.indexOf(9);
  const gOnEven = evenDigits.includes(gIdx) && pcts[gIdx] >= 11;
  const bOnEven = evenDigits.includes(bIdx) && pcts[bIdx] >= 11;
  // Parity fix: rare digits (rank 9, 10) must be ODD for Even setup to be valid
  const rOnOdd = oddDigits.includes(rIdx) && pcts[rIdx] <= 8.6;
  const yOnOdd = oddDigits.includes(yIdx) && pcts[yIdx] <= 9.5;
  if (gOnEven && bOnEven && rOnOdd && yOnOdd) return "ready";
  if ((gOnEven || bOnEven) && (rOnOdd || yOnOdd)) return "partial";
  return "fail";
}

function checkHitRun(stats) {
  const { pcts } = stats;
  const overReady = pcts[0] < 10 && pcts[1] < 10;
  const underReady = pcts[8] < 10 && pcts[9] < 10;
  return { over: overReady ? "ready" : "fail", under: underReady ? "ready" : "fail" };
}

function runStrategyEngine(price) {
  const w = windowTicks();
  if (w.length < 50) return;
  const stats = computeDigitStats(w);
  const dig = lastDig(price);

  // update strategy tab live badges
  updateStrategyBadge("live-over123", checkOver123(stats));
  updateStrategyBadge("live-under876", checkUnder876(stats));
  updateStrategyBadge("live-odd", checkOdd(stats));
  updateStrategyBadge("live-even", checkEven(stats));
  const hr = checkHitRun(stats);
  updateStrategyBadge("live-hitrun-over", hr.over);
  updateStrategyBadge("live-hitrun-under", hr.under);

  // push signals to sidebar
  const signals = [];
  if (checkOver123(stats)==="ready") signals.push({type:"over",label:"Over 1/2/3 — conditions met"});
  if (checkUnder876(stats)==="ready") signals.push({type:"under",label:"Under 8/7/6 — conditions met"});
  if (checkOdd(stats)==="ready") signals.push({type:"odd",label:"Odd — entry conditions ready"});
  if (checkEven(stats)==="ready") signals.push({type:"even",label:"Even — entry conditions ready"});
  if (hr.over==="ready") signals.push({type:"hit",label:"Hit&Run Over 1 — ready"});
  if (hr.under==="ready") signals.push({type:"hit",label:"Hit&Run Under 8 — ready"});

  el.signalList.innerHTML = "";
  if (!signals.length) {
    el.signalList.innerHTML = `<div class="signal-empty">No active signals — monitoring…</div>`;
  } else {
    signals.forEach(s => {
      const d = document.createElement("div");
      d.className = `signal-item ${s.type}`;
      d.textContent = s.label;
      el.signalList.append(d);
    });
  }

  // bot signal status panel
  updateBotSignalStatus(stats);
  renderAIAdvisor(stats, w);
}

function updateStrategyBadge(id, state) {
  const el2 = $(id);
  if (!el2) return;
  const badges = { ready:"ENTRY READY ✓", partial:"Partial match…", fail:"Not met" };
  const cls = { ready:"ready", partial:"partial", fail:"fail" };
  el2.innerHTML = `<span class="cond-badge ${cls[state]||"neutral"}">${badges[state]||state}</span>`;
}

function updateBotSignalStatus(stats) {
  if (!el.botSignalStatus) return;
  const checks = [
    {label:"Over 1/2/3", state: checkOver123(stats)},
    {label:"Under 8/7/6", state: checkUnder876(stats)},
    {label:"Odd", state: checkOdd(stats)},
    {label:"Even", state: checkEven(stats)},
  ];
  el.botSignalStatus.innerHTML = "";
  checks.forEach(c => {
    const clsMap = {ready:"pass",partial:"wait",fail:"fail"};
    const row = document.createElement("div");
    row.className = "ss-row";
    row.innerHTML = `<span class="ss-label">${c.label}</span><span class="ss-badge ${clsMap[c.state]||"wait"}">${c.state}</span>`;
    el.botSignalStatus.append(row);
  });
}

// ── AI ADVISOR ───────────────────────────────────────────────
function computeStrategyScore(strat, stats) {
  const { pcts, rankOf } = stats;
  let score = 0;
  if (strat === "over123") {
    const lowD = [0,1,2,3], hiD = [4,5,6,7,8,9];
    const lowBelow = lowD.filter(d => pcts[d] < 10).length;
    score += (lowBelow / 4) * 30;
    const avgMargin = lowD.reduce((s,d) => s + Math.max(0, 10 - pcts[d]), 0) / 4;
    score += Math.min(avgMargin / 4, 1) * 10;
    const hiAbove = hiD.filter(d => pcts[d] >= 11).length;
    score += (Math.min(hiAbove, 3) / 3) * 25;
    const g = rankOf.indexOf(1), b = rankOf.indexOf(2);
    if (hiD.includes(g)) score += 15;
    if (hiD.includes(b)) score += 10;
    if (lowD.some(d => rankOf[d]===10||rankOf[d]===9)) score += 10;
  } else if (strat === "under876") {
    const hiD = [6,7,8,9], lowD = [0,1,2,3,4,5];
    const hiBelow = hiD.filter(d => pcts[d] < 10).length;
    score += (hiBelow / 4) * 30;
    const avgMargin = hiD.reduce((s,d) => s + Math.max(0, 10 - pcts[d]), 0) / 4;
    score += Math.min(avgMargin / 4, 1) * 10;
    const lowAbove = lowD.filter(d => pcts[d] >= 11).length;
    score += (Math.min(lowAbove, 3) / 3) * 25;
    const g = rankOf.indexOf(1), b = rankOf.indexOf(2);
    if (lowD.includes(g)) score += 15;
    if (lowD.includes(b)) score += 10;
    if (hiD.some(d => rankOf[d]===10||rankOf[d]===9)) score += 10;
  } else if (strat === "odd") {
    const oddD = [1,3,5,7,9], evenD = [0,2,4,6,8];
    const totalOddPct = oddD.reduce((s, d) => s + pcts[d], 0);
    if (totalOddPct < 51) return 0; // no edge — don't recommend
    // Aggregate pct is primary driver (up to 40 pts for 54%+ odd)
    score += Math.min(Math.max(totalOddPct - 50, 0) * 13, 40);
    const g = rankOf.indexOf(1), b = rankOf.indexOf(2);
    const r = rankOf.indexOf(10), y = rankOf.indexOf(9);
    if (oddD.includes(g) && pcts[g] >= 11) score += 20; else if (oddD.includes(g)) score += 8;
    if (oddD.includes(b) && pcts[b] >= 11) score += 20; else if (oddD.includes(b)) score += 8;
    if (evenD.includes(r) && pcts[r] <= 8.6) score += 10; else if (evenD.includes(r)) score += 4;
    if (evenD.includes(y) && pcts[y] <= 9.5) score += 10; else if (evenD.includes(y)) score += 4;
  } else if (strat === "even") {
    const evenD = [0,2,4,6,8], oddD = [1,3,5,7,9];
    const totalEvenPct = evenD.reduce((s, d) => s + pcts[d], 0);
    if (totalEvenPct < 51) return 0; // no edge — don't recommend
    // Aggregate pct is primary driver (up to 40 pts for 54%+ even)
    score += Math.min(Math.max(totalEvenPct - 50, 0) * 13, 40);
    const g = rankOf.indexOf(1), b = rankOf.indexOf(2);
    const r = rankOf.indexOf(10), y = rankOf.indexOf(9);
    if (evenD.includes(g) && pcts[g] >= 11) score += 20; else if (evenD.includes(g)) score += 8;
    if (evenD.includes(b) && pcts[b] >= 11) score += 20; else if (evenD.includes(b)) score += 8;
    // Rare digits must be ODD for even setup — parity fix carries into score
    if (oddD.includes(r) && pcts[r] <= 8.6) score += 10; else if (oddD.includes(r)) score += 4;
    if (oddD.includes(y) && pcts[y] <= 9.5) score += 10; else if (oddD.includes(y)) score += 4;
  } else if (strat === "hitrun") {
    score += Math.max(0, (10 - pcts[0]) / 10) * 25;
    score += Math.max(0, (10 - pcts[1]) / 10) * 25;
    score += Math.max(0, (10 - pcts[8]) / 10) * 25;
    score += Math.max(0, (10 - pcts[9]) / 10) * 25;
  }
  return Math.round(Math.min(Math.max(score, 0), 100));
}

function computeMarketMood(w) {
  if (w.length < 30) return "neutral";
  const prices = w.slice(-30).map(t => t.price);
  let ups = 0, downs = 0;
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] > prices[i-1]) ups++;
    else if (prices[i] < prices[i-1]) downs++;
  }
  const ratio = ups / (ups + downs || 1);
  if (ratio > 0.62) return "uptrend";
  if (ratio < 0.38) return "downtrend";
  const { pcts } = computeDigitStats(w.slice(-50));
  const variance = pcts.reduce((s, p) => s + Math.pow(p - 10, 2), 0) / 10;
  return variance < 5 ? "ranging" : "volatile";
}

function getBestMarketForStrat(strat) {
  let bestSym = null, bestScore = -1;
  for (const [sym, arr] of Object.entries(st.ticksAll)) {
    if (!arr || arr.length < 50) continue;
    const w2 = arr.slice(-Math.min(arr.length, st.tickWindow));
    const sc = computeStrategyScore(strat, computeDigitStats(w2));
    if (sc > bestScore) { bestScore = sc; bestSym = sym; }
  }
  if (!bestSym) return null;
  return { sym: bestSym, name: MARKETS[bestSym] || bestSym, score: bestScore };
}

// ── MARKET SCAN ANIMATION ────────────────────────────────────
let scanRunning = false;
async function runMarketScan() {
  if (scanRunning) return;
  scanRunning = true;

  const scanList = $("aiScanList");
  const scanStatus = $("aiScanStatus");
  if (scanStatus) scanStatus.textContent = "Scanning…";
  if (scanList) scanList.innerHTML = "";

  const strats = ["over123", "under876", "odd", "even", "hitrun"];
  const candidates = Object.keys(st.ticksAll).filter(sym => {
    const arr = st.ticksAll[sym];
    return arr && arr.length >= 50;
  });

  if (!candidates.length) {
    if (scanStatus) scanStatus.textContent = "Waiting for data…";
    scanRunning = false;
    return;
  }

  const results = [];

  for (const sym of candidates) {
    const name = MARKETS[sym] || sym;
    if (scanList) {
      const row = document.createElement("div");
      row.className = "asp-item scanning";
      row.dataset.sym = sym;
      row.innerHTML = `<span class="asp-sym">${name}</span><span class="asp-score">—</span><span></span>`;
      scanList.appendChild(row);
    }
    await new Promise(r => setTimeout(r, 140));

    const arr = st.ticksAll[sym];
    if (!arr || arr.length < 50) continue;
    const scanLen = Math.min(arr.length, 300);
    const stats = computeDigitStats(arr.slice(-scanLen));

    let bestScore = 0;
    strats.forEach(s => {
      const sc = computeStrategyScore(s, stats);
      if (sc > bestScore) bestScore = sc;
    });
    bestScore = Math.round(bestScore);
    results.push({ sym, name, score: bestScore });

    if (scanList) {
      const row = scanList.querySelector(`[data-sym="${sym}"]`);
      if (row) {
        const cls = bestScore >= 70 ? "high" : bestScore >= 45 ? "med" : "low";
        row.className = "asp-item";
        row.innerHTML = `<span class="asp-sym">${name}</span><span class="asp-score ${cls}">${bestScore}%</span><span></span>`;
      }
    }
  }

  results.sort((a, b) => b.score - a.score);
  const winner = results[0];

  if (winner && scanList) {
    const row = scanList.querySelector(`[data-sym="${winner.sym}"]`);
    if (row) {
      row.className = "asp-item winner";
      row.innerHTML = `<span class="asp-sym">${winner.name}</span><span class="asp-score high">${winner.score}%</span><span class="asp-winner-badge">BEST</span>`;
    }
  }

  if (winner) {
    if (!st.aiRec) st.aiRec = {};
    st.aiRec.bestMarket = { sym: winner.sym, name: winner.name, score: winner.score };
    const aiMarketRow = $("aiMarketRow");
    const aiRecMarket = $("aiRecMarket");
    if (aiMarketRow) aiMarketRow.style.display = "";
    if (aiRecMarket) aiRecMarket.textContent = winner.name;
    // Immediately re-render AI Advisor using winner's ticks so scores update now
    const wTicks = st.ticksAll[winner.sym];
    if (wTicks && wTicks.length >= 50) {
      const wSlice = wTicks.slice(-Math.min(st.tickWindow || 1000, wTicks.length));
      renderAIAdvisor(computeDigitStats(wSlice), wSlice);
    }
  }

  if (scanStatus) scanStatus.textContent = winner ? `Best: ${winner.name} (${winner.score}%)` : "No clear winner";
  scanRunning = false;
}

function checkOddEvenMultiWindow(w) {
  // Requires 100, 300, and (if available) 1000-tick windows to ALL show >= 53% for odd/even
  const oddDigits = [1,3,5,7,9], evenDigits = [0,2,4,6,8];
  const windows = [100, 300, 1000].filter(sz => w.length >= sz);
  if (windows.length < 2) return { odd: false, even: false };
  let allOdd = true, allEven = true;
  for (const sz of windows) {
    const s = computeDigitStats(w.slice(-sz));
    const op = oddDigits.reduce((sum, d) => sum + s.pcts[d], 0);
    const ep = evenDigits.reduce((sum, d) => sum + s.pcts[d], 0);
    if (op < 53) allOdd = false;
    if (ep < 53) allEven = false;
  }
  return { odd: allOdd, even: allEven };
}

function _aiJournalStats() {
  const result = {};
  ["over123","under876","odd","even","hitrun"].forEach(s => {
    const entries = (st.journal || []).filter(e => e.signalSource === "ai_advisor" && e.strategy === s).slice(-50);
    const n = entries.length;
    const wins = entries.filter(e => e.result === "Win").length;
    result[s] = { n, wr: n >= 5 ? Math.round(100 * wins / n) : null };
  });
  return result;
}

function _aiAdaptiveMultiplier(strat, jStats) {
  const s = jStats[strat];
  if (!s || s.n < 10 || s.wr === null) return 1.0;
  if (s.wr >= 70) return 1.15;
  if (s.wr >= 60) return 1.08;
  if (s.wr >= 50) return 1.0;
  if (s.wr >= 45) return 0.90;
  if (s.wr >= 40) return 0.80;
  return 0.70;
}

function _aiSequenceMomentum(w, strat) {
  const r10 = w.slice(-10);
  const r5  = w.slice(-5);
  if (r10.length < 10) return 0;
  if (strat === "over123") {
    const cnt = r10.filter(d => d >= 4).length;
    let delta = cnt >= 8 ? 12 : cnt >= 7 ? 6 : cnt <= 3 ? -10 : 0;
    if (r5.every(d => d >= 4)) delta -= 4;
    return delta;
  }
  if (strat === "under876") {
    const cnt = r10.filter(d => d <= 5).length;
    let delta = cnt >= 8 ? 12 : cnt >= 7 ? 6 : cnt <= 3 ? -10 : 0;
    if (r5.every(d => d <= 5)) delta -= 4;
    return delta;
  }
  if (strat === "odd") {
    const cnt = r10.filter(d => d % 2 !== 0).length;
    return cnt >= 8 ? 12 : cnt >= 7 ? 6 : cnt <= 3 ? -10 : 0;
  }
  if (strat === "even") {
    const cnt = r10.filter(d => d % 2 === 0).length;
    return cnt >= 8 ? 12 : cnt >= 7 ? 6 : cnt <= 3 ? -10 : 0;
  }
  if (strat === "hitrun") {
    const counts = {};
    r10.forEach(d => { counts[d] = (counts[d] || 0) + 1; });
    const maxCnt = Math.max(...Object.values(counts));
    return maxCnt >= 3 ? 8 : maxCnt <= 1 ? -8 : 0;
  }
  return 0;
}

function getAIRecommendation(stats, w) {
  const strats = ["over123","under876","odd","even","hitrun"];
  const scores = {};
  strats.forEach(s => { scores[s] = computeStrategyScore(s, stats); });
  // Multi-window confirmation: zero out odd/even if windows disagree
  const mw = checkOddEvenMultiWindow(w);
  if (!mw.odd)  scores["odd"]  = 0;
  if (!mw.even) scores["even"] = 0;
  // Self-improvement: apply sequence momentum then adaptive multiplier from journal
  const jStats = _aiJournalStats();
  strats.forEach(s => {
    if (scores[s] === 0) return;
    scores[s] = Math.round(Math.min(100, Math.max(0, scores[s] + _aiSequenceMomentum(w, s))));
    scores[s] = Math.round(Math.min(100, scores[s] * _aiAdaptiveMultiplier(s, jStats)));
  });
  const mood = computeMarketMood(w);
  const sorted = [...strats].sort((a, b) => scores[b] - scores[a]);
  let recommended = sorted[0];
  if ((mood === "uptrend" || mood === "downtrend") && scores["hitrun"] >= 50) recommended = "hitrun";
  else if (mood === "ranging") {
    const best = scores["odd"] >= scores["even"] ? "odd" : "even";
    if (scores[best] >= 55) recommended = best;
  }
  const bestMarket = getBestMarketForStrat(recommended);
  return { recommended, confidence: scores[recommended], scores, mood, bestMarket, jStats };
}

function renderAIAdvisor(stats, w) {
  if (!el.aiMoodBadge) return;

  // If the scan found a winner with ticks available, score that market instead of
  // the currently viewed symbol — gives accurate signal breakdown for best market
  const scanWinner = st.aiRec?.bestMarket;
  if (scanWinner && scanWinner.sym !== st.symbol) {
    const wTicks = st.ticksAll[scanWinner.sym];
    if (wTicks && wTicks.length >= 50) {
      const wSlice = wTicks.slice(-Math.min(st.tickWindow || 1000, wTicks.length));
      stats = computeDigitStats(wSlice);
      w = wSlice;
    }
  }

  const rec = getAIRecommendation(stats, w);
  // Preserve bestMarket from scan — getAIRecommendation may overwrite with current symbol
  if (scanWinner) rec.bestMarket = scanWinner;
  st.aiRec = rec;
  const moodLabels = { ranging:"Ranging", uptrend:"Uptrend", downtrend:"Downtrend", volatile:"Volatile", neutral:"Neutral" };
  const stratLabels = { over123:"Over 1/2/3", under876:"Under 8/7/6", odd:"Odd", even:"Even", hitrun:"Hit & Run" };
  el.aiMoodBadge.textContent = moodLabels[rec.mood] || rec.mood;
  el.aiMoodBadge.className = `mood-badge ${rec.mood}`;
  el.aiRecStrategy.textContent = stratLabels[rec.recommended] || rec.recommended;
  el.aiConfidenceFill.style.width = rec.confidence + "%";
  el.aiConfidenceText.textContent = rec.confidence + "%";

  // Best market for recommended signal
  const mktEl = $("aiRecMarket");
  const mktRow = $("aiMarketRow");
  if (rec.bestMarket && mktEl) {
    mktEl.textContent = rec.bestMarket.name;
    const isCurrent = rec.bestMarket.sym === st.symbol;
    mktEl.style.color = isCurrent ? "var(--muted)" : "var(--amber)";
    if (mktRow) mktRow.style.display = isCurrent ? "none" : "";
  }

  el.aiScoresGrid.innerHTML = "";
  const adaptArrow = (s) => {
    const js = rec.jStats?.[s];
    if (!js || js.n < 10) return "";
    if (js.wr >= 60) return ` <span style="color:var(--green);font-size:9px">▲${js.wr}%</span>`;
    if (js.wr < 50)  return ` <span style="color:var(--red);font-size:9px">▼${js.wr}%</span>`;
    return ` <span style="color:var(--muted);font-size:9px">~${js.wr}%</span>`;
  };
  ["over123","under876","odd","even","hitrun"].forEach(s => {
    const sc = rec.scores[s];
    const cls = sc >= 70 ? "high" : sc >= 45 ? "med" : "low";
    const row = document.createElement("div");
    row.className = "ai-score-row";
    const isBest = s === rec.recommended;
    row.innerHTML = `<span class="ai-score-label" style="${isBest?"color:var(--green)":""}">${stratLabels[s]}${adaptArrow(s)}</span><div class="ai-score-track"><div class="ai-score-fill ${cls}" style="width:${sc}%"></div></div><span class="ai-score-val">${sc}%</span>`;
    el.aiScoresGrid.append(row);
  });
  const learnEl = $("aiLearnStatus");
  if (learnEl && rec.jStats) {
    const total = Object.values(rec.jStats).reduce((sum, s) => sum + s.n, 0);
    const adapted = Object.values(rec.jStats).filter(s => s.n >= 10).length;
    learnEl.textContent = total >= 10
      ? `Learning: ${total} AI trades tracked — ${adapted}/5 adapted`
      : `Learning: ${total} AI trades tracked — need more data to adapt`;
  }
}

// ── LANDING ──────────────────────────────────────────────────
function showLanding() {
  const o = $("landingOverlay");
  if (o) o.classList.remove("hidden");
}

function hideLanding() {
  const o = $("landingOverlay");
  if (o) o.classList.add("hidden");
}

// ── BOT ENGINE ───────────────────────────────────────────────
function runBotEngine(price) {
  const b = st.bot;
  b._tickReceivedAt = Date.now();
  if (!b.running || b.stopRequested) return;
  // VPS mode: VPS holds the Deriv WS and sends buys — browser only displays status
  if (st.vpsMode && el.realToggle.checked && st.isAuthorized) return;

  try {
    const dig = lastDig(price);
    const w = windowTicks(b.market);
    if (w.length < 10) return;

    const stats = computeDigitStats(w);

    // Paper mode: settle pending trade by tick counting
    if (b.pendingTrade) {
      settleBotTrade(b.pendingTrade, price, dig);
      return;
    }

    // Live fast-settle: free slot when contract duration elapses — don't block on POC callback
    if (el.realToggle.checked && st.isAuthorized && b.liveContract !== null) {
      b.liveContract.ticksElapsed = (b.liveContract.ticksElapsed || 0) + 1;
      if (b.liveContract.ticksElapsed >= b.liveContract.ticksToExpiry) {
        if (!b.liveContract.contractId) {
          // Buy response hasn't arrived yet — keep slot in settlingContracts so the
          // late response can still be matched by handleLiveBuy's fallback path
          botLog("Buy response late — holding slot until confirmation arrives", "warn");
          b.settlingContracts.push({ ...b.liveContract });
          b.liveContract = null;
          // fall through to next entry
        } else {
          // Duration elapsed — hand to async settling and free slot immediately
          // POC subscription was already sent in handleLiveBuy; do NOT re-subscribe here
          b.settlingContracts.push({ ...b.liveContract });
          b.liveContract = null;
          // fall through — allow next entry on this tick
        }
      } else {
        return; // still within contract duration
      }
    }

    // Block new entry while any buy confirmation is still pending — prevents stacking
    // unconfirmed slots that would trigger the worst-case stop loss check prematurely
    if (b.settlingContracts.some(t => !t.contractId)) return;

    // Stop loss: check settled P/L AND worst-case from all still-settling contracts
    const _pendingStakes = b.settlingContracts.reduce((s, c) => s + (c.stake || 0), 0);
    const _worstCasePL = b.pl - _pendingStakes;
    if (b.pl <= -b.lossLimit || _worstCasePL <= -b.lossLimit) {
      botLog(`Loss limit hit ($${b.lossLimit}). Bot stopped. P/L: ${b.pl.toFixed(2)}, exposure: $${_pendingStakes.toFixed(2)}`, "warn");
      stopBot(); showBotResult(false); return;
    }
    if (b.pl >= b.targetProfit) {
      botLog(`Target profit reached ($${b.targetProfit}). Bot stopped.`, "win");
      stopBot(); showBotResult(true); return;
    }

    // Always enforce locked strategy and market — never change mid-session
    if (b.lockedStrategy) b.strategy = b.lockedStrategy;
    if (b.lockedMarket) b.market = b.lockedMarket;

    const bypassStrategyGate = b.fastAutoplay || b.forceImmediateEntry;
    if (b.useStrategy && !bypassStrategyGate) {
      if (!checkBotStrategy(b.strategy, stats, dig)) {
        b.entryWatch = null;
        b.watchRetryCount = 0;
        return;
      }
    }
    if (b.forceImmediateEntry) {
      b.forceImmediateEntry = false;
    }
    if (b.fastAutoplay) {
      b.entryWatch = null;
      b.watchRetryCount = 0;
    }

    executeBotTrade(dig, stats);

  } catch(err) {
    botLog(`Bot engine error: ${err.message}`, "warn");
  }
}

function checkBotStrategy(strat, stats, dig) {
  if (strat === "aiAuto")   return st.aiRec ? st.aiRec.confidence >= 45 : false;
  if (strat === "odd")      return checkOdd(stats) !== "fail";
  if (strat === "even")     return checkEven(stats) !== "fail";
  if (strat === "over123")  return checkOver123(stats) !== "fail";
  if (strat === "under876") return checkUnder876(stats) !== "fail";
  return true;
}

function buildEntryWatch(strat, currentDig, stats) {
  // Returns a watch object that delays entry until trigger, or null for immediate
  const { rankOf, pcts } = stats;
  switch (strat) {
    case "over123": {
      const leastAmong123 = [1,2,3].reduce((a,b) => pcts[a]<pcts[b]?a:b);
      if (currentDig === leastAmong123) {
        return { type:"over123", leastDig: leastAmong123, ticksElapsed:0, maxTicks:2 };
      }
      return null;
    }
    case "under876": {
      const leastAmong876 = [6,7,8].reduce((a,b) => pcts[a]<pcts[b]?a:b);
      if (currentDig === leastAmong876) {
        return { type:"under876", leastDig: leastAmong876, ticksElapsed:0, maxTicks:2 };
      }
      return null;
    }
    case "odd": {
      const rIdx=rankOf.indexOf(10), yIdx=rankOf.indexOf(9);
      if (currentDig===rIdx||currentDig===yIdx) {
        return { type:"odd", ticksElapsed:0, maxTicks:5, consecutiveOdd:0, needed:2 };
      }
      return null;
    }
    case "even": {
      const rIdx=rankOf.indexOf(10);
      const oddDigits=[1,3,5,7,9];
      if (oddDigits.includes(currentDig) && (currentDig===rIdx||rankOf[currentDig]>=9)) {
        return { type:"even", ticksElapsed:0, maxTicks:3 };
      }
      return null;
    }
    case "aiAuto": {
      const rec = st.aiRec?.recommended;
      if (rec && rec !== "aiAuto") return buildEntryWatch(rec, currentDig, stats);
      return null;
    }
    default: return null;
  }
}

function evaluateEntryTrigger(watch, dig, stats) {
  switch (watch.type) {
    case "over123":
      return dig >= 4;
    case "under876":
      return dig <= 4;
    case "odd":
      if (dig%2===1) watch.consecutiveOdd++;
      else watch.consecutiveOdd=0;
      return watch.consecutiveOdd >= watch.needed;
    case "even":
      return dig%2===0;
    default:
      return true;
  }
}

function executeBotTrade(dig, stats) {
  const b = st.bot;
  if (!b.running || b.stopRequested) return;
  const contractType = getBotContractType(b.strategy, stats, dig);
  const barrier = getBotBarrier(b.strategy, stats);
  const trade = {
    id: `BOT-${Date.now()}`,
    mode: "bot",
    contractType,
    label: CONTRACT_LABELS[contractType] || contractType,
    stake: b.currentStake,
    barrier: String(barrier),
    entryDigit: dig,
    entryTick: ticks(b.market).length,
    ticksToExpiry: b.durationUnit==="t" ? b.duration : b.duration*2,
    remainingTicks: b.durationUnit==="t" ? b.duration : b.duration*2,
    status: "open",
    openedAt: Date.now(),
  };
  if (el.realToggle.checked && !st.isAuthorized) {
    // Real toggle on but WS disconnected — pause; do NOT fall through to paper mode mid-live-session
    botLog("WS reconnecting — pausing entry until connection restored.", "warn");
    return;
  }
  if (el.realToggle.checked && st.isAuthorized) {
    // Pre-send stop loss: check if THIS stake would push worst-case past the limit
    const _settlingExp = b.settlingContracts.reduce((s, c) => s + (c.stake || 0), 0);
    if (b.pl - _settlingExp - trade.stake <= -b.lossLimit) {
      botLog(`Stop loss guard: stake $${trade.stake.toFixed(2)} + exposure $${_settlingExp.toFixed(2)} would exceed limit. Bot stopped.`, "warn");
      stopBot(); showBotResult(false); return;
    }
    // Duplicate-buy guard — suppress if a buy was sent <400ms ago (same-tick re-fire)
    const _buyNow = Date.now();
    if (_buyNow - (b.lastBuyAt || 0) < 400) {
      botLog("Duplicate buy suppressed (<400ms since last buy)", "warn");
      return;
    }
    // Always 1-tick duration for fastest execution
    b.liveContract = {
      id: trade.id, contractId: null,
      contractType, label: trade.label,
      stake: trade.stake, barrier: String(barrier ?? ""),
      entryDigit: dig,
      ticksElapsed: 0,
      ticksToExpiry: 1,
      _openedAt: _buyNow,
    };
    b._decisionAt = _buyNow;
    botLog(`Placing: ${trade.label} barrier=${barrier ?? "n/a"} stake=${fmt(trade.stake).split(" ")[0]}`, "signal");
    const payload = {
      buy: 1, subscribe: 1,
      price: trade.stake,
      parameters: {
        amount: trade.stake, basis: "stake",
        contract_type: contractType,
        currency: st.currency,
        duration: 1,
        duration_unit: "t",
        ..._sym(b.market),
      },
    };
    if (barrier !== null) payload.parameters.barrier = String(barrier);
    if (st.markup > 0) payload.passthrough = { markup: st.markup };
    if (!b.running || b.stopRequested) return;
    b.lastBuyAt = Date.now();
    b._buySentAt = Date.now();
    console.log(`[MekaBot] tick_to_decision_ms=${b._decisionAt - (b._tickReceivedAt || b._decisionAt)} decision_to_buy_ms=${b._buySentAt - b._decisionAt}`);
    send(payload);
  } else {
    // Paper mode
    b.pendingTrade = trade;
    botLog(`Entry: ${trade.label} barrier=${barrier ?? "n/a"} stake=${fmt(trade.stake).split(" ")[0]}`, "signal");
  }
}

function getBotContractType(strat, stats, dig) {
  switch (strat) {
    case "over123": return "DIGITOVER";
    case "under876": return "DIGITUNDER";
    case "odd": return "DIGITODD";
    case "even": return "DIGITEVEN";
    case "hitrun": {
      const hr = checkHitRun(stats);
      return hr.over==="ready" ? "DIGITOVER" : "DIGITUNDER";
    }
    case "aiAuto": {
      const rec = st.aiRec?.recommended || "over123";
      return getBotContractType(rec, stats, dig);
    }
    default: return "DIGITEVEN";
  }
}

function getBotBarrier(strat, stats) {
  switch (strat) {
    case "over123": {
      const { pcts } = stats;
      // find lowest among 1,2,3
      return [1,2,3].reduce((a,b)=>pcts[a]<pcts[b]?a:b);
    }
    case "under876": {
      const { pcts } = stats;
      return [6,7,8].reduce((a,b)=>pcts[a]>pcts[b]?a:b);
    }
    case "hitrun": {
      const hr = checkHitRun(stats);
      return hr.over==="ready" ? 1 : 8;
    }
    case "aiAuto": {
      const rec = st.aiRec?.recommended || "over123";
      return getBotBarrier(rec, stats);
    }
    default: return null;
  }
}

function settleBotTrade(trade, price, dig) {
  const b = st.bot;

  trade.remainingTicks--;
  if (trade.remainingTicks > 0) return;

  const barrier = Number(trade.barrier);
  let won = false;
  if (trade.contractType==="DIGITEVEN") won = dig%2===0;
  else if (trade.contractType==="DIGITODD") won = dig%2===1;
  else if (trade.contractType==="DIGITOVER") won = dig > barrier;
  else if (trade.contractType==="DIGITUNDER") won = dig < barrier;
  else if (trade.contractType==="DIGITMATCH") won = dig===barrier;
  else if (trade.contractType==="DIGITDIFF") won = dig!==barrier;
  else if (trade.contractType==="CALL") won = price > trade.entryPrice;
  else if (trade.contractType==="PUT") won = price < trade.entryPrice;

  trade.status = won ? "won" : "lost";

  // Paper mode only — live trades are settled by handleOpenContract via Deriv POC
  const approxPayout = won ? trade.stake * 1.87 : 0;
  const profit = approxPayout - trade.stake;
  trade.profit = profit;
  b.pl += profit;
  if (b.pl < b.worstPL) b.worstPL = b.pl;
  b.pendingTrade = null;

  if (won) {
    b.wins++; b.consecutiveLosses = 0;
    if (b.resetOnWin) b.currentStake = b.stake;
    else b.currentStake = b.stake2;
    el.botWinCount.textContent = String(b.wins);
    botLog(`WIN +${fmt(profit).split(" ")[0]} | P/L: ${fmt(b.pl).split(" ")[0]}`, "win");
  } else {
    b.losses++; b.consecutiveLosses++;
    if (b.consecutiveLosses >= b.maxLoss) {
      b.currentStake = b.stake;
      b.consecutiveLosses = 0;
      botLog("Max consecutive losses — resetting stake.", "warn");
    } else {
      const _remaining = Math.max(b.stake, b.lossLimit + b.pl);
      b.currentStake = Math.min(b.currentStake * b.martingale, _remaining);
    }
    el.botLossCount.textContent = String(b.losses);
    botLog(`LOSS ${fmt(-trade.stake).split(" ")[0]} | P/L: ${fmt(b.pl).split(" ")[0]}`, "loss");
  }

  el.botPL.textContent = fmt(b.pl).split(" ")[0];
  el.botPL.className = b.pl >= 0 ? "profit" : "loss";
  el.botPL.classList.remove("pl-pop");
  void el.botPL.offsetWidth;
  el.botPL.classList.add("pl-pop");

  addBotTradeCard(won, trade.label, trade.stake, profit, b.pl);
  updateBotProgressBars();
  playSound(won ? "win" : "loss");
  showCelebration(Math.abs(profit), won);

  addJournalEntry({
    time: new Date().toLocaleTimeString(),
    market: marketName(b.market),
    market_sym: b.market,
    type: trade.label,
    stake: trade.stake,
    barrier: trade.barrier,
    exitDigit: dig,
    result: won ? "Win" : "Loss",
    profit,
    mode: "paper",
    strategy: b.strategy,
    ..._resolveSignalCtx(true),
  });

  if (b.running) {
    const eTP = b.targetProfit + Math.abs(Math.min(0, b.worstPL));
    if (b.pl <= -b.lossLimit) { botLog(`Loss limit hit. Bot stopped.`, "warn"); stopBot(); showBotResult(false); }
    else if (b.pl >= eTP) {
      const msg = eTP > b.targetProfit ? `Target reached (recovered + $${b.targetProfit}). Bot stopped.` : `Target reached. Bot stopped.`;
      botLog(msg, "win"); stopBot(); showBotResult(true);
    } else if (!b.stopRequested && !b.liveContract && !b.pendingTrade) {
      const last = (st.ticksAll[b.market] || []).at(-1);
      if (last) queueMicrotask(() => runBotEngine(last.price));
    }
  }
}

// ── BOT DIGIT FEED ───────────────────────────────────────────
function updateBotDigitFeed(price) {
  const dig = lastDig(price);
  const chip = document.createElement("div");
  const isEven = dig%2===0;
  // remove previous latest
  const prev = el.botDigitFeed.querySelector(".latest");
  if (prev) prev.classList.remove("latest");
  chip.className = `df-chip ${isEven?"even":"odd"} latest`;
  chip.textContent = String(dig);
  el.botDigitFeed.prepend(chip);
  const chips = el.botDigitFeed.querySelectorAll(".df-chip");
  if (chips.length > 40) chips[chips.length-1].remove();
}

// ── PAPER TRADING ────────────────────────────────────────────
function buyTrade() {
  st.stake = Number(el.stakeInput.value||1);
  st.duration = Number(el.durationInput.value||1);
  st.durationUnit = el.durationUnitSelect.value;
  st.barrier = el.barrierSelect.value;

  if (el.realToggle.checked && st.isAuthorized) {
    if (!st.proposal?.id) { refreshProposal(); log("Waiting for proposal…","warn"); return; }
    send({ buy: st.proposal.id, price: st.stake });
    log(`Live buy: ${CONTRACT_LABELS[st.contractType]} ${fmt(st.stake)}`);
    return;
  }
  createPaperTrade();
}

function createPaperTrade() {
  const all = ticks();
  if (!all.length) { log("No ticks yet.","warn"); return; }
  const latest = all[all.length-1];
  const ticksToExpiry = st.durationUnit==="t" ? st.duration : Math.max(2, Math.round(st.duration*2));
  const trade = {
    id: `P-${Date.now()}`, mode:"paper",
    symbol: st.symbol,
    contractType: st.contractType,
    label: CONTRACT_LABELS[st.contractType],
    stake: st.stake, entryPrice: latest.price,
    entryDigit: lastDig(latest.price),
    barrier: st.barrier,
    remainingTicks: ticksToExpiry,
    status:"open", openedAt: Date.now(),
  };
  st.openTrades.unshift(trade);
  st.paperBalance -= st.stake;
  log(`Paper: ${trade.label} on ${marketName()} for ${fmt(st.stake)}`);
  renderAll();
}

function settlePaperTrades(price) {
  st.openTrades.forEach(trade => {
    if (trade.status !== "open" || trade.mode !== "paper") return;
    trade.remainingTicks--;
    if (trade.remainingTicks > 0) return;
    const dig = lastDig(price);
    const barrier = Number(trade.barrier);
    let won = false;
    if (trade.contractType==="DIGITEVEN") won = dig%2===0;
    else if (trade.contractType==="DIGITODD") won = dig%2===1;
    else if (trade.contractType==="DIGITOVER") won = dig > barrier;
    else if (trade.contractType==="DIGITUNDER") won = dig < barrier;
    else if (trade.contractType==="DIGITMATCH") won = dig===barrier;
    else if (trade.contractType==="DIGITDIFF") won = dig!==barrier;
    else if (trade.contractType==="CALL") won = price > trade.entryPrice;
    else if (trade.contractType==="PUT") won = price < trade.entryPrice;
    const payout = won ? trade.stake*1.87 : 0;
    trade.status = won?"won":"lost";
    trade.exitPrice = price;
    trade.exitDigit = dig;
    trade.profit = payout - trade.stake;
    st.paperBalance += payout;
    log(`${won?"WIN":"LOSS"} ${trade.label} P/L ${fmt(trade.profit)}`, won?"profit":"loss");
    showCelebration(Math.abs(trade.profit), won);
    addJournalEntry({
      time: new Date().toLocaleTimeString(),
      market: marketName(trade.symbol),
      market_sym: trade.symbol,
      type: trade.label, stake: trade.stake,
      barrier: trade.barrier, exitDigit: dig,
      result: won?"Win":"Loss", profit: trade.profit,
      mode: "paper",
      strategy: "manual",
      ..._resolveSignalCtx(true),
    });
  });
}

function handleLiveBuy(buy) {
  if (!buy) return;
  const b = st.bot;
  if (b.stopRequested || !b.running) {
    if (buy?.contract_id && st.wsReady) {
      send({ proposal_open_contract: 1, contract_id: buy.contract_id, subscribe: 1 });
      send({ balance: 1 });
    }
    botLog("Late buy confirmation ignored — bot is stopped.", "warn");
    return;
  }

  // Bot live buy confirmed — assign contractId and subscribe to settlement
  if (buy.contract_id) {
    b._buyConfirmedAt = Date.now();
    if (b._buySentAt) console.log(`[MekaBot] buy_confirm_ms=${b._buyConfirmedAt - b._buySentAt}`);
    // Primary: buy response arrived before duration elapsed
    if (b.liveContract && !b.liveContract.contractId) {
      b.liveContract.contractId = String(buy.contract_id);
      b.runs++;
      el.botRunCount.textContent = String(b.runs);
      send({ proposal_open_contract: 1, contract_id: buy.contract_id, subscribe: 1 });
      return;
    }
    // Fallback: buy response arrived after duration elapsed (already in settlingContracts)
    const settling = b.settlingContracts.find(t => !t.contractId);
    if (settling) {
      settling.contractId = String(buy.contract_id);
      b.runs++;
      el.botRunCount.textContent = String(b.runs);
      send({ proposal_open_contract: 1, contract_id: buy.contract_id, subscribe: 1 });
      return;
    }
  }

  // Manual trade
  const trade = {
    id: String(buy.contract_id || Date.now()),
    mode: "live", symbol: st.symbol,
    contractType: st.contractType,
    label: CONTRACT_LABELS[st.contractType],
    stake: Number(buy.buy_price || st.stake),
    status: "open", openedAt: Date.now(),
  };
  st.openTrades.unshift(trade);
  if (buy.contract_id) send({ proposal_open_contract: 1, contract_id: buy.contract_id, subscribe: 1 });
  log(`Live trade opened: ${trade.label} #${trade.id}`);
  renderAll();
}

function handleOpenContract(c) {
  const b = st.bot;
  if (b.stopRequested || !b.running) {
    if (c?.is_sold && st.wsReady) send({ balance: 1 });
    return;
  }
  const cid = String(c.contract_id);

  // Find matching bot contract in liveContract or settlingContracts
  let lc = null;
  if (b.liveContract?.contractId === cid && c.is_sold) {
    lc = b.liveContract;
    b.liveContract = null;
  } else if (c.is_sold) {
    const idx = b.settlingContracts.findIndex(t => t.contractId === cid);
    if (idx >= 0) {
      lc = b.settlingContracts[idx];
      b.settlingContracts.splice(idx, 1);
    }
  }

  if (lc) {
    b._contractSoldAt = Date.now();
    if (lc._openedAt) console.log(`[MekaBot] settlement_delay_ms=${b._contractSoldAt - lc._openedAt}`);
    const realProfit = Number(c.profit || 0);
    const realWon = realProfit >= 0;

    b.pl += realProfit;
    if (b.pl < b.worstPL) b.worstPL = b.pl;

    if (realWon) {
      b.wins++;
      if (b.resetOnWin) b.currentStake = b.stake;
      else b.currentStake = b.stake2;
      b.consecutiveLosses = 0;
      el.botWinCount.textContent = String(b.wins);
      botLog(`WIN +${realProfit.toFixed(2)} | P/L: ${b.pl.toFixed(2)}`, "win");
    } else {
      b.losses++;
      b.consecutiveLosses++;
      if (b.consecutiveLosses >= b.maxLoss) {
        b.currentStake = b.stake;
        b.consecutiveLosses = 0;
        botLog("Max consecutive losses — resetting stake.", "warn");
      } else {
        // Cap at remaining loss budget so a single martingale trade cannot exceed the limit
        const _remaining = Math.max(b.stake, b.lossLimit + b.pl);
        b.currentStake = Math.min(b.currentStake * b.martingale, _remaining);
      }
      el.botLossCount.textContent = String(b.losses);
      botLog(`LOSS ${realProfit.toFixed(2)} | P/L: ${b.pl.toFixed(2)}`, "loss");
    }

    el.botPL.textContent = fmt(b.pl).split(" ")[0];
    el.botPL.className = b.pl >= 0 ? "profit" : "loss";
    el.botPL.classList.remove("pl-pop");
    void el.botPL.offsetWidth;
    el.botPL.classList.add("pl-pop");

    addBotTradeCard(realWon, lc.label, lc.stake, realProfit, b.pl);
    updateBotProgressBars();
    playSound(realWon ? "win" : "loss");
    showCelebration(Math.abs(realProfit), realWon);

    const exitDig = c.exit_tick_display_value ? String(c.exit_tick_display_value).slice(-1) : "";
    addJournalEntry({
      time: new Date().toLocaleTimeString(),
      market: marketName(b.market),
      market_sym: b.market,
      type: lc.label, stake: lc.stake,
      barrier: lc.barrier, exitDigit: exitDig,
      result: realWon ? "Win" : "Loss",
      profit: realProfit,
      mode: st.isDemo ? "demo" : "live",
      strategy: b.strategy,
      ..._resolveSignalCtx(true),
    });

    if (st.wsReady) send({ balance: 1 });

    if (b.running) {
      // Re-check including remaining settling exposure so stop fires before next entry
      const _rem = b.settlingContracts.reduce((s, c) => s + (c.stake || 0), 0);
      if (b.pl <= -b.lossLimit || b.pl - _rem <= -b.lossLimit) {
        botLog(`Loss limit hit. Bot stopped. P/L: ${b.pl.toFixed(2)}`, "warn");
        stopBot(); showBotResult(false);
      } else if (b.pl >= b.targetProfit) {
        botLog(`Target profit reached ($${b.targetProfit}). Bot stopped.`, "win");
        stopBot(); showBotResult(true);
      } else if (!b.stopRequested && !b.liveContract && !b.pendingTrade && b.settlingContracts.length === 0) {
        // Only allow next entry when ALL settling contracts have resolved — no phantom exposure
        const last = (st.ticksAll[b.market] || []).at(-1);
        if (last) queueMicrotask(() => runBotEngine(last.price));
      }
    }
    return;
  }

  // Manual trade result
  const trade = st.openTrades.find(t => t.id === String(c.contract_id));
  if (!trade) return;
  trade.status = c.is_sold ? (Number(c.profit) >= 0 ? "won" : "lost") : "open";
  trade.profit = Number(c.profit || 0);
  if (c.is_sold) log(`Contract closed P/L ${fmt(trade.profit)}`, trade.profit >= 0 ? "profit" : "loss");
  renderAll();
}

function renderOpenTrades() {
  const active = st.openTrades.filter(t=>t.status==="open");
  el.openCount.textContent = String(active.length);
  if (!st.openTrades.length) {
    el.openTrades.className = "trade-list empty-state";
    el.openTrades.textContent = "No open trades yet."; return;
  }
  el.openTrades.className = "trade-list";
  el.openTrades.innerHTML = "";
  st.openTrades.slice(0,10).forEach(trade => {
    const d = document.createElement("div");
    const sc = trade.status==="won"?"profit":trade.status==="lost"?"loss":"";
    d.className = "trade-item";
    d.innerHTML = `<strong>${trade.label} <span class="${sc}">${trade.status}</span></strong>
      <span>${marketName(trade.symbol)} | ${fmt(trade.stake)}</span>
      <span>${trade.mode==="paper"&&trade.status==="open" ? `${trade.remainingTicks} ticks left` : `P/L ${fmt(trade.profit||0)}`}</span>`;
    el.openTrades.append(d);
  });
}

// ── PROPOSAL ─────────────────────────────────────────────────
function refreshProposal() {
  if (!st.wsReady||!st.isAuthorized) return;
  const needsBarrier = ["DIGITOVER","DIGITUNDER","DIGITMATCH","DIGITDIFF"].includes(st.contractType);
  const payload = { proposal:1, amount:st.stake, basis:"stake", contract_type:st.contractType,
    currency:st.currency, duration:st.duration, duration_unit:st.durationUnit, ..._sym(st.symbol) };
  if (needsBarrier) payload.barrier = st.barrier;
  if (st.markup > 0) payload.passthrough = { markup: st.markup };
  send(payload);
}

function renderProposal() {
  if (!st.proposal) { el.proposalValue.textContent="Paper estimate"; el.proposalMeta.textContent="Payout updates after connection"; return; }
  const payout = Number(st.proposal.payout||0);
  const ask = Number(st.proposal.ask_price||st.stake);
  el.proposalValue.textContent = `${fmt(payout)} payout`;
  el.proposalMeta.textContent = `Cost ${fmt(ask)} | ID ${st.proposal.id}`;
}

// ── MODE UI ──────────────────────────────────────────────────
function updateModeUi() {
  const realReady = el.realToggle.checked && st.isAuthorized;
  el.modeLabel.textContent = realReady?"real":"paper";
  el.accountStatus.textContent = st.isAuthorized ? (st.loginId||"Deriv connected") : "Demo mode";
  el.buyButton.classList.toggle("real-ready", realReady);
  el.balanceValue.textContent = fmt(realReady ? st.balance : st.paperBalance);
  el.botBalance.textContent = st.isAuthorized ? fmt(st.balance) : "Paper";
  if (el.topbarBalance && el.topbarBalanceValue) {
    const lbl = el.topbarBalance.querySelector(".topbar-balance-label");
    if (st.isAuthorized) {
      el.topbarBalanceValue.textContent = fmt(st.balance);
      if (lbl) lbl.textContent = "Balance";
      el.topbarBalance.style.display = "";
      el.connectBtn.style.display = "none";
      if (el.switchAccountBtn) el.switchAccountBtn.style.display = "";
      if (el.disconnectBtn) el.disconnectBtn.style.display = "";
    } else {
      el.topbarBalanceValue.textContent = fmt(st.paperBalance);
      if (lbl) lbl.textContent = "Paper";
      el.topbarBalance.style.display = "";
      el.connectBtn.style.display = "";
      if (el.switchAccountBtn) el.switchAccountBtn.style.display = "none";
      if (el.disconnectBtn) el.disconnectBtn.style.display = "none";
    }
  }
}

function updateMarketUi() {
  el.chartTitle.textContent = marketName();
  el.marketSelect.value = st.symbol;
  localStorage.setItem("mm.symbol", st.symbol);
}

function updateFeeDisplay() {
  if (el.markupInput) el.markupInput.value = String(st.markup);
}

function initTheme() {
  const saved = localStorage.getItem("mm.theme") || "dark";
  if (saved === "light") document.body.classList.add("light");
  updateThemeIcon();
}

function toggleTheme() {
  const isLight = document.body.classList.toggle("light");
  localStorage.setItem("mm.theme", isLight ? "light" : "dark");
  updateThemeIcon();
}

function updateThemeIcon() {
  const icon = $("themeIcon");
  if (!icon) return;
  const isLight = document.body.classList.contains("light");
  icon.innerHTML = isLight
    ? '<path d="M8 3v1M8 12v1M3 8H2M14 8h-1M4.9 4.9l-.7-.7M11.8 11.8l-.7-.7M4.9 11.1l-.7.7M11.8 4.2l-.7.7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="8" cy="8" r="2.5" fill="currentColor"/>'
    : '<path d="M13 8a5 5 0 0 1-6.9 4.6A5 5 0 0 0 10.5 3c.1 0 .2 0 .3.01A5 5 0 0 1 13 8z" fill="currentColor"/>';
}

// ── RISK CALCULATOR ──────────────────────────────────────────
function calcMartingale() {
  const cap = Number(el.calcCapital.value||0);
  if (!cap || cap < 1) { clearCalc(); return; }
  const stake = cap * 0.02;
  const tp = stake * 5;
  const sl = stake * 4; // 4 consecutive losses
  const maxStk = stake * Math.pow(2,3); // 4 steps doubles
  const drawdown = stake + stake*2 + stake*4 + stake*8;

  el.calcStake.textContent = fmt(stake,"").trim();
  el.calcTakeProfit.textContent = fmt(tp,"").trim();
  el.calcStopLoss.textContent = fmt(sl,"").trim();
  el.calcMaxStake.textContent = fmt(maxStk,"").trim();
  el.calcDrawdown.textContent = fmt(drawdown,"").trim();

  // sequence table
  el.martingaleTable.innerHTML = "";
  let cum = 0;
  for (let i=1; i<=6; i++) {
    const s = stake * Math.pow(2, i-1);
    cum += s;
    const row = document.createElement("div");
    const danger = i > 4;
    row.className = `mart-row${danger?" critical":""}`;
    row.innerHTML = `<span>Step ${i}</span><span class="mart-step">${fmt(s,"").trim()}</span><span class="mart-cum">Cum: ${fmt(cum,"").trim()}</span>`;
    el.martingaleTable.append(row);
  }
}

function clearCalc() {
  ["calcStake","calcTakeProfit","calcStopLoss","calcMaxStake","calcDrawdown"].forEach(id=>$(id).textContent="--");
  el.martingaleTable.innerHTML="";
}

// ── JOURNAL ──────────────────────────────────────────────────
function _resolveSignalCtx(allowClaude = true) {
  if (allowClaude && st.claudeLastScan?.rec) {
    return { signalSource: "claude", signalConf: st.claudeLastScan.conf ?? null, signalRec: st.claudeLastScan.rec ?? null };
  }
  if (st.aiRec?.recommended) {
    return { signalSource: "ai_advisor", signalConf: st.aiRec.confidence ?? null, signalRec: st.aiRec.recommended ?? null };
  }
  return { signalSource: "none", signalConf: null, signalRec: null };
}

function saveTradeToDB(data) {
  fetch("/api/trade", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  }).catch(() => {});
}

function _saveSignalEvent(result, traded = false, tradeId = null) {
  fetch("/api/signal-event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: SESSION_ID,
      market: result.market,
      signal_source: "claude",
      strategy: result.rec || null,
      confidence: result.conf ?? null,
      reason: result.reason || null,
      traded,
      trade_id: tradeId,
      created_at: Date.now()
    })
  }).catch(() => {});
}

function addJournalEntry(entry) {
  const tradeId = _genTradeId();
  st.journal.unshift(entry);
  if (st.journal.length > 500) st.journal.pop();
  localStorage.setItem("mm.journal", JSON.stringify(st.journal));
  renderJournal();
  saveTradeToDB({
    trade_id: tradeId,
    session_id: SESSION_ID,
    login_id: st.loginId || null,
    source: entry.source || "bot",
    market: entry.market_sym || entry.market || st.symbol,
    market_name: entry.market || null,
    contract: entry.type || "UNKNOWN",
    barrier: entry.barrier || null,
    stake: Number(entry.stake) || 0,
    profit: Number(entry.profit) || 0,
    won: entry.result === "Win" ? 1 : 0,
    exit_digit: entry.exitDigit != null ? String(entry.exitDigit) : null,
    strategy: entry.strategy || null,
    signal_source: entry.signalSource || null,
    signal_conf: entry.signalConf != null ? Number(entry.signalConf) : null,
    signal_rec: entry.signalRec || null,
    mode: entry.mode || null,
    opened_at: entry.openedAt || (Date.now() - 2000),
    settled_at: Date.now()
  });
}

function renderJournal() {
  const j = st.journal;
  const wins = j.filter(e=>e.result==="Win").length;
  const losses = j.filter(e=>e.result==="Loss").length;
  const pl = j.reduce((s,e)=>s+Number(e.profit||0),0);
  const avgStake = j.length ? j.reduce((s,e)=>s+Number(e.stake||0),0)/j.length : 0;
  el.jTotal.textContent = String(j.length);
  el.jWins.textContent = String(wins);
  el.jLosses.textContent = String(losses);
  el.jWinRate.textContent = j.length ? `${Math.round((wins/j.length)*100)}%` : "--";
  el.jPL.textContent = fmt(pl,"").trim();
  el.jPL.className = pl>=0?"profit":"loss";
  el.jAvgStake.textContent = j.length ? fmt(avgStake,"").trim() : "--";

  if (!j.length) { el.journalTable.innerHTML = `<div class="journal-empty">No trades recorded yet.</div>`; return; }
  el.journalTable.innerHTML = "";
  const header = document.createElement("div");
  header.className = "j-row header";
  header.innerHTML = "<span>Time</span><span>Market</span><span>Type</span><span>Stake</span><span>Barrier</span><span>Exit</span><span>Result</span><span>P/L</span>";
  el.journalTable.append(header);
  j.slice(0,200).forEach(e=>{
    const row = document.createElement("div");
    const rc = e.result==="Win"?"profit":"loss";
    row.className = "j-row";
    row.innerHTML = `<span>${e.time}</span><span>${e.market||"--"}</span><span>${e.type}</span><span>${fmt(e.stake,"").trim()}</span><span>${e.barrier||"--"}</span><span>${e.exitDigit??""}</span><span class="${rc}">${e.result}</span><span class="${rc}">${(e.profit>=0?"+":"")+(fmt(e.profit,"").trim())}</span>`;
    el.journalTable.append(row);
  });
}

function exportCSV() {
  const rows = [["Time","Market","Type","Source","Stake","Barrier","Exit Digit","Result","Profit/Loss"]];
  st.journal.forEach(e=>rows.push([e.time,e.market,e.type,e.source||"bot",e.stake,e.barrier,e.exitDigit,e.result,e.profit]));
  const csv = rows.map(r=>r.map(v=>`"${v??""}`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
  a.download = `moneymaker-journal-${Date.now()}.csv`;
  a.click();
}

async function loadCloudHistory() {
  const btn = $("loadCloudHistory");
  if (btn) { btn.disabled = true; btn.textContent = "Loading…"; }
  try {
    const loginFilter = st.loginId ? `&login_id=${encodeURIComponent(st.loginId)}` : `&session_id=${SESSION_ID}`;
    const res = await fetch(`/api/trades?limit=200${loginFilter}`);
    const trades = await res.json();
    if (!Array.isArray(trades) || !trades.length) {
      if (btn) { btn.disabled = false; btn.textContent = "☁ Cloud History"; }
      log("No cloud trade history found.", "warn"); return;
    }
    const entries = trades.map(t => ({
      source: t.source,
      time: new Date(t.settled_at).toLocaleTimeString(),
      market: t.market,
      type: t.contract,
      stake: t.stake,
      barrier: t.barrier,
      exitDigit: t.exit_digit,
      result: t.won ? "Win" : "Loss",
      profit: t.profit,
      strategy: t.strategy,
      openedAt: t.opened_at,
    }));
    st.journal = entries;
    localStorage.setItem("mm.journal", JSON.stringify(st.journal));
    renderJournal();
    log(`Loaded ${entries.length} trades from cloud.`, "signal");
  } catch (err) {
    log("Cloud history load failed: " + err.message, "error");
  }
  if (btn) { btn.disabled = false; btn.textContent = "☁ Cloud History"; }
}

// ── SIMULATION ───────────────────────────────────────────────
function startSim() {
  if (st.simulationTimer) return;
  setStreamState("Paper stream", "demo");

  // Pre-fill 250 ticks for every known market so AI Advisor, Claude, and the bot
  // all have analysable data the moment the sim starts (no 45-100s cold-start wait).
  const allSyms = Object.keys(MARKETS);
  const now = Date.now();
  allSyms.forEach(sym => {
    const have = st.ticksAll[sym]?.length || 0;
    const need = Math.max(0, 250 - have);
    if (!need) return;
    let base = have ? st.ticksAll[sym][have - 1].price : 1000 + Math.random() * 200;
    const added = [];
    for (let i = need; i > 0; i--) {
      base = Math.max(100, base + (Math.random() - 0.49) * 2.4);
      added.push({ price: base, timestamp: now - i * 1000 });
    }
    if (!st.ticksAll[sym]) st.ticksAll[sym] = [];
    st.ticksAll[sym] = [...added, ...st.ticksAll[sym]].slice(-6000);
  });

  // Build per-symbol random-walk state from latest stored price
  const bases = {};
  allSyms.forEach(sym => {
    const arr = st.ticksAll[sym];
    bases[sym] = arr?.length ? arr[arr.length - 1].price : 1000 + Math.random() * 200;
  });

  st.simulationTimer = setInterval(() => {
    const active = new Set(
      [st.symbol, st.bot.market].filter(Boolean)
    );
    active.forEach(sym => {
      if (!(sym in bases)) bases[sym] = st.ticksAll[sym]?.at(-1)?.price || 1000 + Math.random() * 200;
      bases[sym] = Math.max(100, bases[sym] + (Math.random() - 0.49) * 2.4);
      onTick(bases[sym], sym, Date.now());
    });
  }, 800);

  log("Paper tick stream started.");
}

function stopSim() {
  if (!st.simulationTimer) return;
  clearInterval(st.simulationTimer);
  st.simulationTimer = null;
}

// ── VPS BOT MODE ─────────────────────────────────────────────
// When VPS mode is on, the VPS daemon holds the Deriv WS and sends live buys.
// The browser just displays status polled from /api/vps/status.
// All data flows (D1, Discord, Claude tuning) are identical to browser execution.

function _vpsBotConfig() {
  const b = st.bot;
  return {
    session_id:    SESSION_ID,
    deriv_token:   st.token,
    app_id:        st.appId,
    login_id:      st.loginId || null,
    currency:      st.currency || "USD",
    market:        b.market,
    strategy:      b.strategy,
    stake:         b.stake,
    stake2:        b.stake2,
    martingale:    b.martingale,
    max_loss:      b.maxLoss,
    reset_on_win:  b.resetOnWin,
    loss_limit:    b.lossLimit,
    target_profit: b.targetProfit,
    mode:          st.isDemo ? "demo" : "live",
  };
}

async function _getVpsHealth() {
  try {
    const res = await fetch("/api/vps/status?ts=" + Date.now(), { cache: "no-store" });
    if (!res.ok) return { online: false, reason: "HTTP " + res.status };
    const data = await res.json();
    const pingedAt = Number(data?._pinged_at || 0);
    const age = pingedAt ? Date.now() - pingedAt : Infinity;
    return { online: !!data?.daemon_online && age < 20000, age, data };
  } catch (e) {
    return { online: false, reason: e.message };
  }
}

async function _startVpsBot() {
  const cfg = _vpsBotConfig();
  botLog("Starting VPS executor…", "signal");
  try {
    const health = await _getVpsHealth();
    if (!health.online) {
      const ageInfo = health.age && isFinite(health.age) ? ` (last ping ${Math.round(health.age / 1000)}s ago)` : "";
      botLog(`VPS daemon offline${ageInfo}. Run: pm2 start ecosystem.config.cjs --only moneymeka-vps-bot`, "warn");
      return false;
    }
    const res = await fetch("/api/vps/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg),
    });
    const data = await res.json();
    if (!data.ok) { botLog("VPS session start failed: " + (data.error || "unknown"), "warn"); return false; }
    st._vpsSessionId = cfg.session_id;
    botLog(`VPS executor armed — waiting for VPS to connect (session ${cfg.session_id.slice(0,10)}…)`, "signal");
    clearInterval(st._vpsPollTimer);
    st._vpsPollTimer = setInterval(_vpsPollStatus, 2000);
    _vpsPollStatus();
    // Confirm daemon picks up the session within 7 seconds
    clearTimeout(st._vpsArmTimer);
    st._vpsArmTimer = setTimeout(async () => {
      if (!st.bot.running || !st._vpsSessionId) return;
      try {
        const chk = await fetch("/api/vps/status?ts=" + Date.now(), { cache: "no-store" });
        if (!chk.ok) return;
        const d = await chk.json();
        if (d.session_id === st._vpsSessionId && (d.ws_ready || d.running)) {
          botLog(`VPS connected — ${d.ws_ready ? "WS ready" : "running"}, trades will begin.`, "signal");
        } else {
          const _armErr = d.daemon_error ? `: ${d.daemon_error}` : " — check pm2 logs on VPS server";
          botLog(`VPS did not confirm session within 7s${_armErr}`, "warn");
          stopBot();
        }
      } catch (_) {}
    }, 7000);
    return true;
  } catch (e) { botLog("VPS session error: " + e.message, "warn"); return false; }
}

async function _stopVpsBot() {
  clearInterval(st._vpsPollTimer);
  st._vpsPollTimer = null;
  clearTimeout(st._vpsArmTimer);
  st._vpsArmTimer = null;
  if (!st._vpsSessionId) return;
  fetch("/api/vps/session", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: st._vpsSessionId }),
  }).catch(() => {});
  st._vpsSessionId = null;
}

async function _vpsPollStatus() {
  try {
    const res = await fetch("/api/vps/status");
    if (!res.ok) return;
    const data = await res.json();
    if (!data || !data.session_id) return;
    const b = st.bot;

    // Surface VPS daemon errors (e.g. VPS_SECRET mismatch) once per unique message
    if (data.daemon_error) {
      if (data.daemon_error !== st._vpsDaemonError) {
        st._vpsDaemonError = data.daemon_error;
        botLog(`VPS daemon error: ${data.daemon_error}`, "warn");
      }
    } else {
      st._vpsDaemonError = null;
    }

    // Only sync counters when status belongs to our session — idle daemon pings (session_id:'daemon-idle')
    // carry zeroed counters that would overwrite live stats.
    const _sessionMatch = !st._vpsSessionId || data.session_id === st._vpsSessionId;
    const prevRuns = b.runs;
    if (_sessionMatch) {
      b.runs   = data.runs   || 0;
      b.wins   = data.wins   || 0;
      b.losses = data.losses || 0;
      b.pl     = data.pl     || 0;
    }

    if (_sessionMatch) {
      if (el.botRunCount)  el.botRunCount.textContent  = String(b.runs);
      if (el.botWinCount)  el.botWinCount.textContent  = String(b.wins);
      if (el.botLossCount) el.botLossCount.textContent = String(b.losses);
      if (el.botPL) {
        el.botPL.textContent = (b.pl >= 0 ? "+" : "") + b.pl.toFixed(2);
        el.botPL.className   = b.pl >= 0 ? "profit" : "loss";
      }
      updateBotProgressBars();

      const vpsTrades = Array.isArray(data.recent_trades)
        ? data.recent_trades.slice().reverse()
        : (data.last_trade ? [data.last_trade] : []);
      vpsTrades.forEach(t => {
        if (!t || !t.id || st._vpsSeenTradeIds[t.id]) return;
        st._vpsSeenTradeIds[t.id] = 1;
        const label = t.label || CONTRACT_LABELS[t.contract_type] || t.contract_type || "VPS trade";
        const won = !!t.won;
        const profit = Number(t.profit || 0);
        addBotTradeCard(won, label, Number(t.stake || 0), profit, Number(t.pl ?? b.pl));
        const isFreshVpsTrade = !t.ts || Date.now() - Number(t.ts) < 15000;
        if (b.running && isFreshVpsTrade) {
          playSound(won ? "win" : "loss");
          showCelebration(Math.abs(profit), won);
        }
      });

      // Animate P/L pop on new trade
      if (data.runs > prevRuns && el.botPL) {
        el.botPL.classList.remove("pl-pop");
        void el.botPL.offsetWidth;
        el.botPL.classList.add("pl-pop");
      }
    }

    // Stop loss / target check on VPS-reported P/L
    if (b.running && data.running !== false) {
      if (b.pl <= -b.lossLimit) {
        botLog(`VPS loss limit hit ($${b.lossLimit}). Stopping.`, "warn");
        stopBot(); showBotResult(false);
        return;
      } else if (b.pl >= b.targetProfit) {
        botLog(`VPS target profit reached ($${b.targetProfit}). Stopping.`, "win");
        stopBot(); showBotResult(true);
        return;
      }
    }

    // VPS reported it stopped — only act if this status belongs to our current session.
    // The daemon sends session_id:'daemon-idle' while idle; ignoring that prevents
    // the bot from being killed by the daemon's pre-session heartbeat.
    if (data.running === false) {
      if (st._vpsSessionId && data.session_id !== st._vpsSessionId) return;
      botLog(`VPS executor stopped — Trades:${b.runs} W/L:${b.wins}/${b.losses} P/L:${b.pl.toFixed(2)}`);
      if (b.running) {
        const reason = data.stop_reason || (b.pl >= b.targetProfit ? "target" : b.pl <= -b.lossLimit ? "loss" : "manual");
        stopBot();
        if (reason === "target") {
          botLog(`VPS target profit reached ($${b.targetProfit}).`, "win");
          showBotResult(true);
        } else if (reason === "loss") {
          botLog(`VPS loss limit hit ($${b.lossLimit}).`, "warn");
          showBotResult(false);
        }
      }
    }
  } catch (_) {}
}

function toggleVpsMode(on) {
  st.vpsMode = on !== undefined ? on : !st.vpsMode;
  localStorage.setItem("mm.vpsMode", st.vpsMode ? "1" : "0");
  const badge = $("vpsBadge");
  if (badge) {
    badge.textContent = st.vpsMode ? "⚡ VPS Execute" : "🖥 Browser Execute";
    badge.style.color = st.vpsMode ? "var(--green)" : "var(--muted)";
    badge.title = st.vpsMode
      ? "VPS mode: VPS daemon sends buys. Click to switch to browser mode."
      : "Browser mode: browser sends buys. Click to switch to VPS mode.";
  }
  botLog(st.vpsMode ? "VPS execution enabled — live buys routed to VPS." : "Browser execution enabled.", "signal");
}

// ── BOT CONTROLS ─────────────────────────────────────────────
async function startBot(opts = {}) {
  const b = st.bot;
  // Block live execution if balance is below stake
  if (el.realToggle.checked && st.isAuthorized) {
    const stakeVal = Number(el.botStake.value || 1);
    if (st.balance < stakeVal) {
      botLog(`⚠ Insufficient balance ($${st.balance.toFixed(2)}). Top up — minimum stake is $${stakeVal.toFixed(2)}.`, "warn");
      return;
    }
  }
  b.market = el.botMarket.value;
  b.tradeType = el.botTradeType.value;
  b.stake = Number(el.botStake.value||1);
  b.stake2 = Number(el.botStake2.value||1);
  b.currentStake = b.stake;
  // Reset session P/L so previous runs don't trigger stop conditions immediately
  b.pl = 0; b.worstPL = 0; b.runs = 0; b.wins = 0; b.losses = 0; b.consecutiveLosses = 0;
  b.stopRequested = false;
  b.liveContract = null; b.settlingContracts = [];
  st._vpsSeenTradeIds = {};
  if (el.botRunCount) el.botRunCount.textContent = "0";
  if (el.botWinCount) el.botWinCount.textContent = "0";
  if (el.botLossCount) el.botLossCount.textContent = "0";
  if (el.botPL) { el.botPL.textContent = "0.00"; el.botPL.className = ""; }
  const feed = $("botTradeFeed");
  if (feed) feed.innerHTML = `<div class="btf-empty">No trades yet — start the bot to see live results</div>`;
  b.lossLimit = Number(el.botLossLimit.value||50);
  b.targetProfit = Number(el.botTargetProfit.value||25);
  b.duration = Number(el.botDuration.value||1);
  b.durationUnit = el.botDurationUnit.value;
  b.useStrategy = el.botUseStrategy.checked;
  b.strategy = document.querySelector("input[name=botStrat]:checked")?.value || "over123";
  b.lockedStrategy = b.strategy; // locked for entire session — Apply AI Pick can't change mid-run
  b.lockedMarket = b.market;
  b.martingale = Number(el.botMartingale.value||1);
  b.maxLoss = Number(el.botMaxLoss.value||4);
  b.resetOnWin = el.botResetOnWin.checked;
  b.running = true;
  b.pendingTrade = null;
  b.entryWatch = null;
  b.instantEntry = true;
  b.forceImmediateEntry = !!opts.forceImmediateEntry;
  b.fastAutoplay = !!opts.fastAutoplay;
  b._hb = 0;
  el.botRunBtn.disabled = true;
  el.botStopBtn.disabled = false;
  el.botStatusLabel.textContent = "Running";
  el.botStatusLabel.style.color = "var(--green)";
  botLog(`Bot started. Strategy: ${b.strategy} | Market: ${marketName(b.market)}`, "signal");
  updateBotFlow();
  updateBotProgressBars();
  startSessionTimer();

  // VPS mode: delegate live execution to VPS daemon; /api/session-relay is called by VPS
  if (st.vpsMode && el.realToggle.checked && st.isAuthorized) {
    const vpsStarted = await _startVpsBot();
    if (!vpsStarted) {
      botLog("VPS delegation failed — no live trade was placed.", "warn");
      stopBot();
      return;
    }
    botLog("Live execution delegated to VPS — browser displays status only.", "signal");
    return;
  }

  fetch("/api/session-relay", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ type:"bot", action:"start", session_id: SESSION_ID }) }).catch(()=>{});

  // ensure ticks are flowing for bot market — preserve existing tick history
  if (st.wsReady && b.market !== st.symbol) subscribeTicks(b.market, { clear: false });
  else if (!st.wsReady && !st.simulationTimer) startSim();

  // Fire immediately on last known tick — don't wait for the next tick to arrive
  const mTicks = st.ticksAll[b.market];
  if (mTicks && mTicks.length >= 10) {
    runBotEngine(mTicks[mTicks.length - 1].price);
  }
}

function stopBot() {
  const b = st.bot;
  b.stopRequested = true;
  b.running = false;
  b.pendingTrade = null;
  b.pendingEntryTick = false;
  b.entryWatch = null;
  b.instantEntry = false;
  b.fastAutoplay = false;
  b.forceImmediateEntry = false;

  // VPS mode: send stop command to VPS daemon
  if (st._vpsSessionId) _stopVpsBot();

  if (st.wsReady) send({ balance: 1 });

  el.botRunBtn.disabled = false;
  el.botStopBtn.disabled = true;
  el.botStatusLabel.textContent = "Stopped";
  el.botStatusLabel.style.color = "var(--muted)";

  botLog("Bot stopped. No new trades will be placed.");
  updateBotFlow();
  updateBotProgressBars();
  stopSessionTimer();
  fetch("/api/session-relay", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ type:"bot", action:"stop", session_id: SESSION_ID, stats:{ trades: st.bot.runs, wins: st.bot.wins, losses: st.bot.losses, pl: st.bot.pl } }) }).catch(()=>{});
}

function resetBotStats() {
  const b = st.bot;
  b.runs=0; b.wins=0; b.losses=0; b.pl=0; b.worstPL=0; b.consecutiveLosses=0; b.currentStake=b.stake; b.liveContract=null; b.settlingContracts=[]; b.fastAutoplay=false; b.forceImmediateEntry=false;
  el.botRunCount.textContent="0"; el.botWinCount.textContent="0";
  el.botLossCount.textContent="0"; el.botPL.textContent="0.00"; el.botPL.className="";
  const feed = $("botTradeFeed");
  if (feed) feed.innerHTML = `<div class="btf-empty">No trades yet — start the bot to see live results</div>`;
  const timer = $("botSessionTimer");
  if (timer) timer.textContent = "00:00:00";
  updateBotProgressBars();
  botLog("Stats reset.");
}

// ── OAUTH ─────────────────────────────────────────────────────
async function generatePKCE() {
  const array = crypto.getRandomValues(new Uint8Array(64));
  const codeVerifier = Array.from(array)
    .map(v => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"[v % 66])
    .join("");
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const state = crypto.getRandomValues(new Uint8Array(16))
    .reduce((s, b) => s + b.toString(16).padStart(2, "0"), "");
  return { codeVerifier, codeChallenge, state };
}

function clearOAuthAttempt() {
  sessionStorage.removeItem("oauth_state");
  sessionStorage.removeItem("pkce_code_verifier");
  localStorage.removeItem("mm_oauth_state");
  localStorage.removeItem("mm_pkce_cv");
  localStorage.removeItem("mm_oauth_relay");
}

async function redirectToOAuth(signup, forceLogin) {
  // New Ory/PKCE flow using the registered MoneyMeKa OAuth client.
  clearOAuthAttempt();
  const pkce = await generatePKCE();
  sessionStorage.setItem("pkce_code_verifier", pkce.codeVerifier);
  sessionStorage.setItem("oauth_state", pkce.state);
  localStorage.setItem("mm_pkce_cv", pkce.codeVerifier);
  localStorage.setItem("mm_oauth_state", pkce.state);
  const params = {
    client_id: DERIV_APP_ID,
    response_type: "code",
    redirect_uri: "https://moneymekapro.com/callback",
    scope: "trade account_manage",
    state: pkce.state,
    code_challenge: pkce.codeChallenge,
    code_challenge_method: "S256",
  };
  if (signup) params.prompt = "registration";
  else if (forceLogin) params.prompt = "login";
  const authUrl = "https://auth.deriv.com/oauth2/auth?" + new URLSearchParams(params);
  localStorage.setItem("mm_oauth_started_at", new Date().toISOString());
  localStorage.setItem("mm_oauth_started_url", authUrl);

  // Step-by-step diagnostic logging
  console.log("[OAuth] STEP 1 — attempt started:", new Date().toISOString());
  console.log("[OAuth] STEP 2 — state saved:", pkce.state ? pkce.state.slice(0, 8) + "…" : "MISSING");
  console.log("[OAuth] STEP 3 — code_verifier saved:", pkce.codeVerifier ? "present (" + pkce.codeVerifier.length + " chars)" : "MISSING");
  console.log("[OAuth] STEP 4 — authorize URL:", authUrl);
  console.assert(authUrl.includes("client_id=33jYDBwLAZ4xeAL6eYmkP"), "[OAuth] WARN: client_id missing or wrong");
  console.assert(!authUrl.includes("61554"),   "[OAuth] WARN: forbidden app_id 61554 present");
  console.assert(!authUrl.includes("redirect=home"), "[OAuth] WARN: forbidden redirect=home present");
  console.assert(authUrl.includes("redirect_uri=https%3A%2F%2Fmoneymekapro.com%2Fcallback"), "[OAuth] WARN: redirect_uri mismatch");
  console.log("[OAuth] scope:", params.scope);
  console.log("[OAuth] signup:", !!signup, "forceLogin:", !!forceLogin);

  log("Redirecting to Deriv login…");
  window.location.href = authUrl;
}


window.mmDerivSameTabLogin = async function () {
  return redirectToOAuth();
};

function handleLegacyToken(token, loginId, currency) {
  st.token = token;
  localStorage.setItem("mm.token", token);
  if (loginId) st.loginId = loginId;
  if (currency) st.currency = currency;
  hideLanding();
  log("Token obtained. Connecting…");
  connectDeriv();
}

async function handleOAuthCode(code, returnedState) {
  if (_oauthCodeExchanged) return;
  _oauthCodeExchanged = true;
  const storedState = sessionStorage.getItem("oauth_state") || localStorage.getItem("mm_oauth_state");
  const codeVerifier = sessionStorage.getItem("pkce_code_verifier") || localStorage.getItem("mm_pkce_cv");
  console.log("[OAuth:handleOAuthCode] code:", code ? code.slice(0, 12) + "…" : "MISSING");
  console.log("[OAuth:handleOAuthCode] returnedState:", returnedState);
  console.log("[OAuth:handleOAuthCode] storedState:", storedState);
  console.log("[OAuth:handleOAuthCode] codeVerifier:", codeVerifier ? "present" : "MISSING");
  console.log("[OAuth:handleOAuthCode] stateMatch:", storedState ? (returnedState === storedState ? "OK" : "MISMATCH") : "no stored state (skip check)");
  if (storedState && returnedState !== storedState) { log("OAuth state mismatch — aborting."); return; }
  log("Authorization code received. Exchanging for token…");
  try {
    const resp = await fetch("/api/token-exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, code_verifier: codeVerifier, redirect_uri: "https://moneymekapro.com/callback" })
    });
    const data = await resp.json();
    console.log("[OAuth] token exchange response:", JSON.stringify(data));
    localStorage.setItem("mm_last_token_exchange", JSON.stringify(data));
  if (data.access_token) {
      clearOAuthAttempt();
      st.token = data.access_token;
      localStorage.setItem("mm.token", data.access_token);
      hideLanding();
      log("Token obtained. Connecting…");
      connectDeriv();
    } else {
      log("Token exchange failed: " + (data.error_description || data.error || JSON.stringify(data)));
      console.log("[OAuth] FULL failure response:", JSON.stringify(data));
      showOAuthDiagnostic("Token Exchange Failed", JSON.stringify(data, null, 2));
    }
  } catch (err) {
    log("Token exchange error: " + err.message);
    localStorage.setItem("mm_last_token_exchange", JSON.stringify({ fetch_error: err.message }));
  }
}

function relayOAuthToMain(msg) {
  const payload = { ...msg, ts: Date.now() };
  try { localStorage.setItem("mm_oauth_relay", JSON.stringify(payload)); } catch (_) {}
  try { const bc = new BroadcastChannel("mm_oauth"); bc.postMessage(payload); bc.close(); } catch (_) {}
  if (window.opener && !window.opener.closed) {
    try { window.opener.postMessage(payload, location.origin); } catch (_) {}
  }
  document.body.innerHTML = "<p style='font-family:sans-serif;padding:24px'>Authorization received. Returning to MoneyMeKa...</p>";
  setTimeout(() => window.close(), 1200);
}

async function handleOAuthRelayMessage(msg) {
  if (!msg || !msg.type) return;
  if (msg.type === "mm_oauth_code") {
    localStorage.removeItem("mm_oauth_relay");
    await handleOAuthCode(msg.code, msg.state);
  } else if (msg.type === "mm_oauth_token") {
    localStorage.removeItem("mm_oauth_relay");
    handleLegacyToken(msg.token1, msg.acct1, msg.cur1);
  } else if (msg.type === "mm_oauth_error") {
    localStorage.removeItem("mm_oauth_relay");
    log("OAuth failed: " + (msg.error_description || msg.error || "Unknown OAuth error"), "error");
  }
}

function showOAuthDiagnostic(title, detail) {
  try {
    const box = document.createElement("div");
    box.id = "oauthDiagnostic";
    box.style.cssText = "position:fixed;left:12px;right:12px;bottom:12px;z-index:99999;background:#111827;color:#f9fafb;border:1px solid #f59e0b;border-radius:10px;padding:14px 16px;font:13px system-ui;box-shadow:0 12px 30px rgba(0,0,0,.35);max-height:42vh;overflow:auto";
    box.innerHTML = `<strong style="display:block;color:#fbbf24;margin-bottom:6px">${title}</strong><pre style="white-space:pre-wrap;margin:0;color:#d1d5db">${detail}</pre>`;
    document.body.appendChild(box);
  } catch (_) {}
}

// ── CALLBACK DIAGNOSTIC PANEL ────────────────────────────────
// Steps are buffered silently. Panel is only created when a failure occurs.
// On success the buffer is discarded and a plain log message is shown.
let _diagBuf = [];
let _oauthCodeExchanged = false; // guard: only one path may exchange the auth code
function _diagCreate() { _diagBuf = []; } // reset buffer at start of callback flow

function _diagStep(key, label, status, detail) {
  try {
    // Update or append to buffer
    const idx = _diagBuf.findIndex(s => s.key === key);
    if (idx >= 0) _diagBuf[idx] = { key, label, status, detail };
    else _diagBuf.push({ key, label, status, detail });

    const panel = document.getElementById("oauthCallbackDiag");
    if (panel) {
      _diagRender(key, label, status, detail); // update existing panel
    } else if (status === "fail") {
      _diagShowPanel(); // create panel only on first failure
    }
  } catch (_) {}
}

function _diagShowPanel() {
  if (document.getElementById("oauthCallbackDiag")) return;
  const p = document.createElement("div");
  p.id = "oauthCallbackDiag";
  p.style.cssText = "position:fixed;top:60px;left:12px;right:12px;z-index:99999;background:#0d1117;color:#f9fafb;border:1px solid #ef4444;border-radius:10px;padding:14px 16px;font:12px/1.6 system-ui;box-shadow:0 12px 30px rgba(0,0,0,.45);max-height:55vh;overflow:auto";
  p.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><strong style="color:#ef4444;font-size:13px">OAuth Error — Diagnostics</strong><button onclick="document.getElementById(\'oauthCallbackDiag\').remove()" style="background:none;border:none;color:#6b7280;cursor:pointer;font-size:18px;line-height:1;padding:0">✕</button></div><div id="_oauthDiagSteps"></div>';
  document.body.appendChild(p);
  for (const s of _diagBuf) _diagRender(s.key, s.label, s.status, s.detail);
}

function _diagRender(key, label, status, detail) {
  const steps = document.getElementById("_oauthDiagSteps");
  if (!steps) return;
  let row = document.getElementById("_od_" + key);
  if (!row) {
    row = document.createElement("div");
    row.id = "_od_" + key;
    row.style.cssText = "padding:5px 0;border-bottom:1px solid #1f2937";
    steps.appendChild(row);
  }
  const colors = { ok:"#19c37d", fail:"#ef4444", pending:"#f59e0b", info:"#60a5fa" };
  const icons  = { ok:"✓", fail:"✗", pending:"…", info:"•" };
  const c = colors[status] || "#9ca3af";
  const i = icons[status] || "•";
  const safeDetail = detail ? String(detail).replace(/</g,"&lt;").replace(/>/g,"&gt;") : "";
  row.innerHTML = `<div style="display:flex;gap:8px"><span style="color:${c};font-weight:700;min-width:14px">${i}</span><span style="flex:1;color:#e5e7eb">${label}</span><span style="color:${c};font-size:11px;font-weight:600">${status.toUpperCase()}</span></div>${safeDetail ? `<div style="margin-left:22px;color:#9ca3af;font-size:11px;word-break:break-all;max-height:80px;overflow:auto;white-space:pre-wrap">${safeDetail}</div>` : ""}`;
}

function _diagSuccess() {
  _diagBuf = [];
  try { document.getElementById("oauthCallbackDiag")?.remove(); } catch (_) {}
  log("Deriv connected successfully.");
}

async function extractOauthToken() {
  const q = new URLSearchParams(window.location.search);
  const code = q.get("code");
  const returnedState = q.get("state");
  const errCode = q.get("error");
  const errDesc = q.get("error_description");
  console.log("[OAuth] STEP 5 — callback URL received:", window.location.href);
  console.log("[OAuth] STEP 6 — code present:", code ? "YES (" + code.slice(0, 12) + "…)" : "NO");
  console.log("[OAuth] STEP 7 — error present:", errCode ? "YES: " + errCode : "NO");
  console.log("[OAuth] STEP 8 — state in URL:", returnedState ? returnedState.slice(0, 8) + "…" : "none");

  if (errCode) {
    const payload = { error: errCode, error_description: errDesc, url: window.location.href, ts: Date.now() };
    localStorage.setItem("mm_last_oauth_error", JSON.stringify(payload));
    clearOAuthAttempt();
    const staleConsent = /consent verifier has already been used/i.test(errDesc || "");
    if (staleConsent) {
      ["mm_pkce_cv","mm_oauth_state"].forEach(k => localStorage.removeItem(k));
      ["pkce_code_verifier","oauth_state"].forEach(k => sessionStorage.removeItem(k));
      window.history.replaceState({}, document.title, "/");
      log("That Deriv login link expired. Click Connect again.", "warn");
      // No big diagnostic panel — just the log message
    } else {
      log("OAuth error from Deriv: " + (errDesc || errCode), "error");
      showOAuthDiagnostic("Deriv OAuth Error", JSON.stringify(payload, null, 2));
    }
    return;
  }

  if (code) {
    if (_oauthCodeExchanged) return; // relay path already handled this code
    _oauthCodeExchanged = true;
    _diagCreate();
    _diagStep("code", "Code Received", "ok", code.slice(0, 20) + "…");
    const storedState = sessionStorage.getItem("oauth_state") || localStorage.getItem("mm_oauth_state");
    const codeVerifier = sessionStorage.getItem("pkce_code_verifier") || localStorage.getItem("mm_pkce_cv");
    console.log("[OAuth:extractOauthToken] code:", code ? code.slice(0, 12) + "…" : "MISSING");
    console.log("[OAuth:extractOauthToken] returnedState:", returnedState);
    console.log("[OAuth:extractOauthToken] storedState:", storedState);
    console.log("[OAuth:extractOauthToken] codeVerifier:", codeVerifier ? "present" : "MISSING");
    console.log("[OAuth:extractOauthToken] stateMatch:", storedState ? (returnedState === storedState ? "OK" : "MISMATCH") : "no stored state (skip check)");
    if (storedState && returnedState !== storedState) {
      _diagStep("state", "State Verified", "fail", "Returned: " + returnedState + " | Stored: " + storedState);
      log("OAuth state mismatch — aborting.");
      return;
    }
    _diagStep("state", "State Verified", storedState ? "ok" : "info", storedState ? "Match" : "No stored state (skipped)");
    _diagStep("exchange", "Token Exchange", "pending", "");

    log("OAuth code received. Exchanging for token…");
    try {
      const resp = await fetch("/api/token-exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, code_verifier: codeVerifier, redirect_uri: "https://moneymekapro.com/callback" })
      });
      const data = await resp.json();
      console.log("[OAuth:extractOauthToken] token exchange response:", JSON.stringify(data));
      localStorage.setItem("mm_last_token_exchange", JSON.stringify(data));
      if (data.access_token) {
        clearOAuthAttempt();
        window.history.replaceState({}, document.title, "/");
        st.token = data.access_token;
        localStorage.setItem("mm.token", data.access_token);
        _diagBuf = [];
        try { document.getElementById("oauthCallbackDiag")?.remove(); } catch (_) {}
        hideLanding();
        log("Deriv connected successfully.");
        connectDeriv();
        // mark so init()'s deferred `if (st.token) connectDeriv()` does not double-connect
        st._connectCalledFromOAuth = true;
      } else {
        _diagStep("exchange", "Token Exchange", "fail", "HTTP " + resp.status + ": " + (data.error_description || data.error || JSON.stringify(data)));
        log("Token exchange failed: " + (data.error_description || data.error || JSON.stringify(data)));
        console.log("[OAuth:extractOauthToken] FULL failure response:", JSON.stringify(data));
        showOAuthDiagnostic("Token Exchange Failed", JSON.stringify(data, null, 2));
      }
    } catch (err) {
      _diagStep("exchange", "Token Exchange", "fail", "Fetch error: " + err.message);
      console.log("[OAuth:extractOauthToken] fetch error:", err.message);
      log("Token exchange error: " + err.message);
      localStorage.setItem("mm_last_token_exchange", JSON.stringify({ fetch_error: err.message }));
    }
    return;
  }

  if (location.pathname === "/callback" && !q.get("token1") && !window.location.hash.includes("token1")) {
    const detail = {
      callback_url: window.location.href,
      started_url: localStorage.getItem("mm_oauth_started_url"),
      started_at: localStorage.getItem("mm_oauth_started_at"),
      note: "Deriv returned to /callback without code, token1, or error.",
    };
    localStorage.setItem("mm_last_oauth_error", JSON.stringify(detail));
    console.log("[OAuth] STEP 9 — no code returned. Deriv sent back to /callback with no authorization.");
    console.log("[OAuth] detail:", JSON.stringify(detail));
    log("Deriv did not return authorization to MoneyMeKa Pro. Please log out of Deriv and try in incognito mode, or contact Deriv to confirm this account supports new OAuth apps.", "warn");
    window.history.replaceState({}, document.title, "/");
  }

  // Legacy fallback
  const h = new URLSearchParams(window.location.hash.replace(/^#/,""));
  const token = q.get("token1")||h.get("token1");
  const login = q.get("acct1")||h.get("acct1");
  const cur = q.get("cur1")||h.get("cur1");
  if (token) {
    st.token = token;
    localStorage.setItem("mm.token", token);
    if (login) st.loginId = login;
    if (cur) st.currency = cur;
    window.history.replaceState({},document.title,window.location.pathname);
    log("OAuth token received. Connecting…");
    // connectDeriv() is called by init() after this returns — do not call it here
  }
}

// ── EVENT BINDING ────────────────────────────────────────────
function bindEvents() {
  // brand dropdown
  const _chevron = $("brandMark");
  const _menu    = $("brandMenu");
  if (_chevron && _menu) {
    _chevron.addEventListener("click", e => {
      e.stopPropagation();
      const open = _menu.style.display !== "none";
      _menu.style.display = open ? "none" : "block";
    });
    document.addEventListener("click", () => { _menu.style.display = "none"; });
    const _menuLogin  = $("menuLogin");
    const _menuSignup = $("menuSignup");
    const _menuApi    = $("menuApiConnect");
    if (_menuLogin)  _menuLogin.addEventListener("click",  () => { _menu.style.display="none"; redirectToOAuth(); });
    if (_menuSignup) _menuSignup.addEventListener("click", () => { _menu.style.display="none"; redirectToOAuth(true); });
    if (_menuApi)    _menuApi.addEventListener("click",    () => { _menu.style.display="none"; el.settingsDialog.showModal(); setTimeout(() => el.tokenInput?.focus(), 50); });
  }

  // nav tabs
  document.querySelectorAll(".nav-tab").forEach(btn=>{
    btn.addEventListener("click",()=>{
      document.querySelectorAll(".nav-tab").forEach(b=>b.classList.remove("active"));
      document.querySelectorAll(".tab-view").forEach(v=>v.classList.remove("active"));
      btn.classList.add("active");
      $("tab-"+btn.dataset.tab)?.classList.add("active");
      st.currentTab = btn.dataset.tab;
      localStorage.setItem("mm.tab", btn.dataset.tab);
      if (btn.dataset.tab==="journal") renderJournal();
    });
  });

  // landing overlay
  const landingOauthBtn = $("landingOauthBtn");
  const landingDemoBtn  = $("landingDemoBtn");
  if (landingOauthBtn) landingOauthBtn.addEventListener("click", () => redirectToOAuth());
  if (landingDemoBtn) landingDemoBtn.addEventListener("click", () => {
    localStorage.setItem("mm.demo", "1");
    hideLanding();
    log("Demo mode active. All trades are paper trades.");
  });

  // AI apply button — sets strategy, market, trade type only (no bot start)
  const aiApplyBtn = $("aiApplyBtn");
  if (aiApplyBtn) aiApplyBtn.addEventListener("click", () => {
    if (st.bot.running) {
      botLog("Stop the bot before changing AI pick.", "warn");
      return;
    }
    applyAiPickToBot();
  });

  // Auto Play — applies AI pick then immediately starts the bot
  const aiAutoPlayBtn = $("aiAutoPlayBtn");
  if (aiAutoPlayBtn) aiAutoPlayBtn.addEventListener("click", () => {
    if (st.bot.running) {
      botLog("Bot is already running.", "warn");
      return;
    }
    const applied = applyAiPickToBot();
    if (!applied) return;
    startBot({ forceImmediateEntry: true, fastAutoplay: true });
  });

  // Claude Deep Scan
  const claudeDeepScanBtn = $("claudeDeepScanBtn");
  if (claudeDeepScanBtn) claudeDeepScanBtn.addEventListener("click", runClaudeDeepScan);

  // Bot tab — Auto Play Claude Pick Now
  const claudeApplyBotBtn = $("claudeApplyBotBtn");
  if (claudeApplyBotBtn) claudeApplyBotBtn.addEventListener("click", () => {
    if (st.bot.running) { botLog("Bot is already running.", "warn"); return; }
    if (applyClaudePickToBot()) startBot({ forceImmediateEntry: true, fastAutoplay: true });
  });

  // Bot tab — Auto Play Agreement Now (only fires when Claude + GPT agree)
  const agreeAutoPlayBtn = $("agreeAutoPlayBtn");
  if (agreeAutoPlayBtn) agreeAutoPlayBtn.addEventListener("click", () => {
    if (st.bot.running) { botLog("Bot is already running.", "warn"); return; }
    if (!st.claudeLastScan?.agreed) { botLog("No agreement signal yet — wait for Claude + GPT to agree.", "warn"); return; }
    if (applyClaudePickToBot()) startBot({ forceImmediateEntry: true, fastAutoplay: true });
  });

  // theme toggle
  const themeToggle = $("themeToggle");
  if (themeToggle) themeToggle.addEventListener("click", toggleTheme);

  // connection
  el.settingsBtn.addEventListener("click",()=>el.settingsDialog.showModal());
  el.connectBtn.addEventListener("click", () => redirectToOAuth());
  if (el.switchAccountBtn) el.switchAccountBtn.addEventListener("click", () => redirectToOAuth(false, true));
  if (el.disconnectBtn) el.disconnectBtn.addEventListener("click",()=>{
    st.token = ""; st.isAuthorized = false; st.loginId = "";
    localStorage.removeItem("mm.token");
    localStorage.removeItem("mm.demo");
    disconnectDeriv(true);
    updateModeUi();
    showLanding();
  });
  if (el.oauthBtn) el.oauthBtn.addEventListener("click", () => { log("Redirecting to Deriv OAuth…"); redirectToOAuth(); });
  el.saveSettingsBtn.addEventListener("click",()=>{
    const rawId = el.appIdInput.value.trim();
    st.appId = rawId || "1089";
    // Only update token if user typed a new one.
    // If the input is empty (browser masked/cleared the password field), keep the saved token.
    const newToken = el.tokenInput.value.trim();
    if (newToken) {
      st.token = newToken;
      localStorage.setItem("mm.token", st.token);
    }
    // Note: clearing the token is intentional only via the Disconnect button.
    if (el.markupInput) {
      st.markup = Math.min(3, Math.max(0, Number(el.markupInput.value) || 3));
      localStorage.setItem("mm.markup", String(st.markup));
    }
    localStorage.setItem("mm.appId", st.appId);
    log("Settings saved. Connecting to Deriv...");
    connectDeriv();
  });

  // market
  el.marketSelect.addEventListener("change",()=>{
    st.symbol = el.marketSelect.value;
    updateMarketUi();
    if (st.wsReady) subscribeTicks(st.symbol);
    else { stopSim(); startSim(); }
    refreshProposal();
  });

  // tick window
  el.tickWindowRange.addEventListener("input",()=>{
    st.tickWindow = Number(el.tickWindowRange.value);
    el.tickWindowInput.value = String(st.tickWindow);
    el.windowSizeLabel.textContent = String(st.tickWindow);
    renderAll();
  });
  el.tickWindowInput.addEventListener("input",()=>{
    const v = Math.max(50,Math.min(5000,Number(el.tickWindowInput.value)||1000));
    st.tickWindow = v;
    el.tickWindowRange.value = String(v);
    el.windowSizeLabel.textContent = String(v);
    renderAll();
  });

  // contract selection
  el.contractGrid.addEventListener("click",ev=>{
    const btn = ev.target.closest("[data-contract]");
    if (!btn) return;
    st.contractType = btn.dataset.contract;
    document.querySelectorAll(".ctype-btn").forEach(b=>b.classList.toggle("active",b===btn));
    el.selectedContract.textContent = CONTRACT_LABELS[st.contractType]||st.contractType;
    el.buyButton.textContent = `Buy ${CONTRACT_LABELS[st.contractType]||st.contractType}`;
    const showBarrier = ["DIGITOVER","DIGITUNDER","DIGITMATCH","DIGITDIFF"].includes(st.contractType);
    el.digitBarrierField.style.display = showBarrier?"block":"none";
    refreshProposal();
  });

  // chart views
  document.querySelectorAll("[data-view]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      st.chartView = btn.dataset.view;
      document.querySelectorAll("[data-view]").forEach(b=>b.classList.toggle("active",b===btn));
      renderAll();
    });
  });

  // trade inputs
  [el.stakeInput,el.durationInput,el.durationUnitSelect,el.barrierSelect].forEach(inp=>{
    inp.addEventListener("input",()=>{
      st.stake = Number(el.stakeInput.value||1);
      st.duration = Number(el.durationInput.value||1);
      st.durationUnit = el.durationUnitSelect.value;
      st.barrier = el.barrierSelect.value;
      refreshProposal();
    });
  });

  el.buyButton.addEventListener("click", buyTrade);
  el.realToggle.addEventListener("change", updateModeUi);
  el.clearLogBtn.addEventListener("click",()=>el.activityLog.innerHTML="");

  // bot controls
  el.botRunBtn.addEventListener("click", startBot);
  el.botStopBtn.addEventListener("click", stopBot);
  el.botResetBtn.addEventListener("click", resetBotStats);
  el.clearBotLog.addEventListener("click",()=>el.botLog.innerHTML="");

  // auto-trade controls
  const atStartBtn = $("atStartBtn"), atStopBtn = $("atStopBtn");
  if (atStartBtn) atStartBtn.addEventListener("click", startAutoTrade);
  if (atStopBtn)  atStopBtn.addEventListener("click",  stopAutoTrade);

  // risk calculator
  el.calcCapital.addEventListener("input", calcMartingale);

  // journal
  el.exportJournal.addEventListener("click", exportCSV);
  el.clearJournal.addEventListener("click",()=>{
    st.journal=[]; localStorage.removeItem("mm.journal"); renderJournal();
  });
  const loadCloudBtn = $("loadCloudHistory");
  if (loadCloudBtn) loadCloudBtn.addEventListener("click", loadCloudHistory);

  // wallet placeholder
  const walletDepositBtn = $("walletDepositBtn");
  const walletWithdrawBtn = $("walletWithdrawBtn");
  const walletComingSoon = $("walletComingSoon");
  function showWalletSoon() {
    if (walletComingSoon) {
      walletComingSoon.hidden = false;
      walletComingSoon.textContent = "Coming soon...";
    }
    log("MekaBank coming soon.");
  }
  if (walletDepositBtn) walletDepositBtn.addEventListener("click", showWalletSoon);
  if (walletWithdrawBtn) walletWithdrawBtn.addEventListener("click", showWalletSoon);

  // client compact controls → mirror to actual bot inputs (both directions)
  const _cliSync = (srcId, dstId) => {
    const src = $(srcId), dst = $(dstId);
    if (!src || !dst) return;
    src.addEventListener("input", () => { dst.value = src.value; dst.dispatchEvent(new Event("input")); });
    dst.addEventListener("input", () => { if (!st.isAdmin) src.value = dst.value; });
  };
  _cliSync("cliStake",     "botStake");
  _cliSync("cliStake2",    "botStake2");
  _cliSync("cliLossLimit", "botLossLimit");
  _cliSync("cliTarget",    "botTargetProfit");
}

// ── TICKER RIBBON ────────────────────────────────────────────
const TICKER_EXTRA_SYMS = ["R_10","R_25","R_50","R_75","R_100","1HZ25V","1HZ50V","1HZ75V","1HZ100V"];

function subscribeTickerSyms() {
  if (!st.wsReady) return;
  TICKER_EXTRA_SYMS.filter(s => s !== st.symbol).forEach(s => {
    send({ ticks: s, subscribe: 1 });
  });
}

let tickerUpdatePending = false;
function scheduleTickerUpdate() {
  if (tickerUpdatePending) return;
  tickerUpdatePending = true;
  setTimeout(() => { tickerUpdatePending = false; updateTickerRibbon(); }, 2000);
}

let cryptoPrices = {};
async function fetchCryptoPrices() {
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true");
    if (!r.ok) return;
    const d = await r.json();
    if (d.bitcoin) cryptoPrices["BTC/USD"] = { price: d.bitcoin.usd, change: d.bitcoin.usd_24h_change || 0 };
    if (d.ethereum) cryptoPrices["ETH/USD"] = { price: d.ethereum.usd, change: d.ethereum.usd_24h_change || 0 };
    updateTickerRibbon();
  } catch(e) {}
}

function updateTickerRibbon() {
  const inner = $("tickerInner");
  if (!inner) return;

  const items = [];

  // Crypto prices
  for (const [key, val] of Object.entries(cryptoPrices)) {
    if (!val?.price) continue;
    const chg = val.change || 0;
    items.push({
      sym: key,
      price: val.price > 1000 ? val.price.toLocaleString(undefined, {maximumFractionDigits: 0}) : val.price.toFixed(4),
      chg: (chg >= 0 ? "+" : "") + chg.toFixed(2) + "%",
      up: chg >= 0
    });
  }

  // Deriv volatility indices from live ticks
  const symLabels = {
    "R_10": "Vol 10", "R_25": "Vol 25", "R_50": "Vol 50",
    "R_75": "Vol 75", "R_100": "Vol 100",
    "1HZ10V": "Vol 10 (1s)", "1HZ25V": "Vol 25 (1s)", "1HZ50V": "Vol 50 (1s)",
    "1HZ75V": "Vol 75 (1s)", "1HZ100V": "Vol 100 (1s)"
  };
  for (const sym of [...TICKER_EXTRA_SYMS, st.symbol]) {
    const arr = st.ticksAll[sym];
    if (!arr || arr.length < 2) continue;
    const last = arr[arr.length - 1]?.price;
    const prev = arr[arr.length - 2]?.price;
    if (!last || !prev) continue;
    const chg = last - prev;
    items.push({
      sym: symLabels[sym] || sym,
      price: last.toFixed(2),
      chg: (chg >= 0 ? "+" : "") + chg.toFixed(2),
      up: chg >= 0
    });
  }

  if (!items.length) return;

  // Duplicate for seamless loop
  const html = [...items, ...items].map(it =>
    `<div class="ticker-item">
      <span class="ticker-sym">${it.sym}</span>
      <span class="ticker-price">${it.price}</span>
      <span class="ticker-chg ${it.up ? "up" : "down"}">${it.chg}</span>
    </div>`
  ).join("");

  inner.innerHTML = html;
}

// ── GOAT SOUND ───────────────────────────────────────────────
function playGoatSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(530, t);
    osc.frequency.linearRampToValueAtTime(490, t + 0.12);
    osc.frequency.linearRampToValueAtTime(540, t + 0.28);
    osc.frequency.linearRampToValueAtTime(460, t + 0.55);
    osc.frequency.linearRampToValueAtTime(420, t + 0.75);
    lfo.type = "sine";
    lfo.frequency.value = 8;
    lfoGain.gain.value = 30;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.28, t + 0.04);
    gain.gain.setValueAtTime(0.28, t + 0.45);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    lfo.start(t); lfo.stop(t + 0.8);
    osc.start(t); osc.stop(t + 0.8);
  } catch(e) {}
}

// ── BOT SESSION END POPUP ────────────────────────────────────
function showBotResult(won) {
  const b = st.bot;
  const backdrop = $("botResultBackdrop");
  _atOnBotStopped(won);
  if (!backdrop) return;
  const pl = b.pl;
  $("brEmoji").textContent   = won ? "🐐🎉🐐" : "😬";
  $("brTitle").textContent   = won ? "You're the GOAT! Target Reached! 🐐" : "Oops! Loss Limit Hit";
  $("brSub").textContent     = `${b.runs} trades · ${b.wins}W / ${b.losses}L`;
  $("brAmount").textContent  = (pl >= 0 ? "+" : "") + "$" + Math.abs(pl).toFixed(2);
  $("brDetail").textContent  = won ? "GOAT behaviour — well done! 🐐" : "Better luck next time.";
  backdrop.classList.toggle("loss", !won);
  backdrop.classList.add("show");
  if (won) playGoatSound();
}

// ── WIN / LOSS CELEBRATION ───────────────────────────────────
let celebTimer = null;
function showCelebration(profit, won) {
  const toast = $("celebrationToast");
  if (!toast) return;
  clearTimeout(celebTimer);

  const icon   = $("ctIcon");
  const title  = $("ctTitle");
  const amount = $("ctAmount");
  const sub    = $("ctSub");

  if (won) {
    if (icon)   icon.textContent    = "🐐🎉";
    if (title)  { title.textContent = "Congratulations! You're the GOAT! 🐐"; title.className = "ct-title"; }
    if (amount) { amount.textContent = "+" + fmt(profit); amount.className = "ct-amount"; }
    toast.className = "celebration-toast";
  } else {
    if (icon)   icon.textContent    = "📉";
    if (title)  { title.textContent = "Trade Closed"; title.className = "ct-title loss"; }
    if (amount) { amount.textContent = "-" + fmt(Math.abs(profit)); amount.className = "ct-amount loss"; }
    toast.className = "celebration-toast loss-toast";
  }
  if (sub) sub.textContent = "MoneyMeKa Pro";

  setTimeout(() => toast.classList.add("show"), 10);
  celebTimer = setTimeout(() => toast.classList.remove("show"), 3800);
}

// ── SESSION TIMER ────────────────────────────────────────────
let sessionTimer = null, sessionStart = 0;
function startSessionTimer() {
  sessionStart = Date.now();
  clearInterval(sessionTimer);
  sessionTimer = setInterval(() => {
    const el2 = $("botSessionTimer");
    if (!el2) return;
    const s = Math.floor((Date.now() - sessionStart) / 1000);
    const h = String(Math.floor(s / 3600)).padStart(2, "0");
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const sec = String(s % 60).padStart(2, "0");
    el2.textContent = `${h}:${m}:${sec}`;
  }, 1000);
}
function stopSessionTimer() {
  clearInterval(sessionTimer);
  sessionTimer = null;
}

// ── SOUND ALERTS (casino style) ──────────────────────────────
function playSound(type) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;

    if (type === "win") {
      // Slot machine jackpot: rapid ascending coin dings → triumphant chord
      const coinFreqs = [784, 880, 988, 1047, 1175, 1319];
      coinFreqs.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.connect(g); g.connect(ctx.destination);
        osc.type = "square";
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0.13, t + i * 0.07);
        g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.07 + 0.14);
        osc.start(t + i * 0.07);
        osc.stop(t + i * 0.07 + 0.18);
      });
      // Triumphant C-major chord swell
      [523, 659, 784, 1047].forEach(freq => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.connect(g); g.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0, t + 0.52);
        g.gain.linearRampToValueAtTime(0.09, t + 0.58);
        g.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
        osc.start(t + 0.52);
        osc.stop(t + 1.55);
      });

    } else {
      // Sad trombone: classic wah wah waaaah (4-note descending, sawtooth + filter)
      const osc = ctx.createOscillator();
      const filt = ctx.createBiquadFilter();
      const g = ctx.createGain();
      osc.connect(filt); filt.connect(g); g.connect(ctx.destination);
      osc.type = "sawtooth";
      filt.type = "bandpass";
      filt.Q.value = 4;
      // Pitch: Eb → Db → Bb → G (descending)
      osc.frequency.setValueAtTime(311, t);
      osc.frequency.linearRampToValueAtTime(277, t + 0.28);
      osc.frequency.linearRampToValueAtTime(233, t + 0.55);
      osc.frequency.linearRampToValueAtTime(185, t + 0.80);
      // Filter wah sweep (brass "wah" resonance)
      filt.frequency.setValueAtTime(900, t);
      filt.frequency.linearRampToValueAtTime(350, t + 0.28);
      filt.frequency.linearRampToValueAtTime(700, t + 0.55);
      filt.frequency.linearRampToValueAtTime(200, t + 1.05);
      g.gain.setValueAtTime(0.22, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
      osc.start(t);
      osc.stop(t + 1.15);
    }
  } catch(e) {}
}

// ── LIVE TRADE FEED ──────────────────────────────────────────
function addBotTradeCard(won, tradeLabel, stake, profit, cumPL) {
  const feed = $("botTradeFeed");
  if (!feed) return;
  const empty = feed.querySelector(".btf-empty");
  if (empty) empty.remove();

  const card = document.createElement("div");
  card.className = `btf-card ${won ? "win" : "loss"}`;
  const plSign = won ? "+" : "-";
  card.innerHTML = `
    <div class="btf-badge ${won ? "win" : "loss"}">${won ? "WIN" : "LOSS"}</div>
    <div class="btf-info"><strong>${tradeLabel}</strong> Stake: ${fmt(stake).split(" ")[0]}</div>
    <div class="btf-pl ${won ? "win" : "loss"}">${plSign}${fmt(Math.abs(profit)).split(" ")[0]}</div>
    <div class="btf-cumpl">P/L<br>${cumPL >= 0 ? "+" : ""}${fmt(cumPL).split(" ")[0]}</div>`;
  feed.prepend(card);
  if (feed.children.length > 30) feed.lastChild.remove();
}

// ── BOT PROGRESS BARS ────────────────────────────────────────
function updateBotProgressBars() {
  const b = st.bot;
  const tPct = Math.min(100, b.targetProfit > 0 ? (Math.max(0, b.pl) / b.targetProfit) * 100 : 0);
  const lPct = Math.min(100, b.lossLimit > 0 ? (Math.max(0, -b.pl) / b.lossLimit) * 100 : 0);
  const tBar = $("botTargetBar"), lBar = $("botLossBar");
  const tPctEl = $("botTargetPct"), lPctEl = $("botLossPct");
  if (tBar) tBar.style.width = tPct.toFixed(1) + "%";
  if (lBar) lBar.style.width = lPct.toFixed(1) + "%";
  if (tPctEl) tPctEl.textContent = tPct.toFixed(0) + "%";
  if (lPctEl) lPctEl.textContent = lPct.toFixed(0) + "%";
}

// ── BOT FLOW UPDATER ─────────────────────────────────────────
const STRAT_LABELS = {
  over123: "Over 1/2/3", under876: "Under 8/7/6",
  odd: "Odd", even: "Even", hitrun: "Hit & Run",
  manual: "Any tick", aiAuto: "AI Auto"
};

function updateBotFlow() {
  const b = st.bot;
  const setVal = (id, v) => { const e = $(id); if (e) e.textContent = v; };
  const setActive = (id, on) => { const e = $(id); if (e) e.classList.toggle("active", on); };
  setVal("bfbMarketVal",  MARKETS[b.market] || b.market);
  setVal("bfbSignalVal",  b.useStrategy ? (STRAT_LABELS[b.strategy] || b.strategy) : "Any tick");
  setVal("bfbEntryVal",   "$" + (b.currentStake || b.stake).toFixed(2));
  setVal("bfbRiskVal",    "$" + b.lossLimit);
  setVal("bfbStatusVal",  b.running ? "Running" : "Idle");
  setActive("bfbStatusBlock", b.running);
  setActive("bfbMarket",  b.running);
  setActive("bfbSignal",  b.running && b.useStrategy);
}

function applyAiPickToBot() {
  if (!st.aiRec) {
    botLog("AI pick not ready yet. Wait for Pair Scan to finish.", "warn");
    return false;
  }
  const strat = st.aiRec.recommended || "over123";
  document.querySelectorAll("input[name=botStrat]").forEach(r => { r.checked = r.value === strat; });
  st.bot.strategy = strat;
  const typeMap = { over123:"digits_ou", under876:"digits_ou", odd:"digits_eo", even:"digits_eo", hitrun:"digits_match" };
  if (el.botTradeType) el.botTradeType.value = typeMap[strat] || "digits_ou";
  const bm = st.aiRec.bestMarket;
  if (bm) {
    if (el.botMarket) el.botMarket.value = bm.sym;
    st.bot.market = bm.sym;
    botLog(`AI applied: ${STRAT_LABELS[strat] || strat} on ${bm.name} (${bm.score || st.aiRec.confidence}% confidence)`, "signal");
  } else {
    botLog(`AI applied: ${STRAT_LABELS[strat] || strat} (${st.aiRec.confidence}% confidence)`, "signal");
  }
  updateBotFlow();
  return true;
}

async function executeClaudeScan(market, ticks) {
  try {
    const source = "bot";
    const res = await fetch("/api/ai-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ market, ticks, source })
    });
    const data = await res.json();
    const colMap = { odd: "var(--green)", even: "var(--amber)", over123: "var(--green)", under876: "var(--green)", hitrun: "var(--amber)", none: "var(--red)" };
    const rec = data.recommendation || "none";
    const conf = data.confidence || 0;
    const reason = data.reason || "—";
    const col = colMap[rec] || "var(--muted)";
    const agreed = data.agreed || false;
    const result = { rec, conf, reason, col, market, ts: Date.now(), agreed };
    st.claudeLastScan = result;
    if (data.gpt_rec) {
      st.gptLastScan = { rec: data.gpt_rec, conf: data.gpt_conf || 0, reason: data.gpt_reason || "—" };
    }
    updateBotClaudeBadge(rec, conf, reason, col, data.gpt_rec, data.gpt_conf, agreed);
    _saveSignalEvent(result, false, null);
    _atOnScanResult();
    return result;
  } catch (err) {
    return { error: err.message };
  }
}

async function runClaudeDeepScan() {
  const resultEl = $("claudeDeepResult");
  const btn = $("claudeDeepScanBtn");
  if (!resultEl || !btn) return;

  const market = st.aiRec?.bestMarket?.sym || st.symbol;
  const w = windowTicks(market);
  if (w.length < 100) {
    resultEl.style.display = "block";
    resultEl.innerHTML = '<span style="color:var(--amber)">Need at least 100 ticks — wait a moment and try again.</span>';
    return;
  }

  btn.disabled = true;
  btn.textContent = "🤖 Scanning…";
  resultEl.style.display = "block";
  resultEl.innerHTML = '<span style="opacity:0.5">Sending 300 ticks to Claude AI…</span>';

  const ticks = w.slice(-300)
    .map(t => lastDig(t.price))
    .filter(d => Number.isInteger(d) && d >= 0 && d <= 9);
  if (ticks.length < 100) {
    resultEl.style.display = "block";
    resultEl.innerHTML = '<span style="color:var(--amber)">Need at least 100 ticks — wait a moment and try again.</span>';
    btn.disabled = false;
    btn.textContent = "🤖 Claude Deep Scan Now";
    return;
  }
  const result = await executeClaudeScan(market, ticks);

  if (result.error) {
    resultEl.innerHTML = `<span style="color:var(--red)">Scan failed: ${result.error}</span>`;
  } else {
    const { rec, conf, reason, col } = result;
    const labelMap = { odd: "ODD", even: "EVEN", over123: "OVER 1/2/3", under876: "UNDER 8/7/6", hitrun: "HIT & RUN", none: "NO BIAS" };
    resultEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-weight:700;color:${col};font-size:14px">${labelMap[rec] || rec.toUpperCase()}</span>
        <span style="color:${col};font-weight:600">${conf}% confidence</span>
      </div>
      <div style="color:var(--muted);font-size:11px">${reason}</div>
      <div style="margin-top:6px;font-size:10px;opacity:0.5">Market: ${market} · ${ticks.length} ticks · Claude Haiku</div>`;
  }
  btn.disabled = false;
  btn.textContent = "🤖 Claude Deep Scan Now";
}

function applyClaudePickToBot() {
  const scan = st.claudeLastScan;
  if (!scan || scan.rec === "none") return false;
  const strat = scan.rec === "hitrun" ? "hitrun" : scan.rec;
  document.querySelectorAll("input[name=botStrat]").forEach(r => { r.checked = r.value === strat; });
  st.bot.strategy = strat;
  const typeMap = { over123: "digits_ou", under876: "digits_ou", odd: "digits_eo", even: "digits_eo", hitrun: "digits_match" };
  if (el.botTradeType) el.botTradeType.value = typeMap[strat] || "digits_eo";
  if (el.botMarket && scan.market) { el.botMarket.value = scan.market; st.bot.market = scan.market; }
  botLog(`Claude pick loaded: ${strat.toUpperCase()} on ${(typeof MARKETS !== "undefined" && MARKETS[scan.market]) || scan.market} (${scan.conf}% confidence)`, "signal");
  updateBotFlow();
  return true;
}

// ── CLAUDE GATE (demo accounts) ───────────────────────────
const CLAUDE_GATE_ELEMENTS = ["claudeDeepScanBtn","claudeApplyBotBtn","agreeAutoPlayBtn","aiAutoPlayBtn","aiApplyBtn"];
const CLAUDE_GATE_CLASSES  = [".bot-claude-scan"];

function applyClaudeGate() {
  // ON = only real linked Deriv accounts can use Claude
  // OFF = everyone (including demo) can use Claude
  const realAccount = st.isAuthorized && !st.isDemo;
  const blocked = st.config.claude_gate === "1" && !realAccount && !st.isAdmin;
  CLAUDE_GATE_ELEMENTS.forEach(id => {
    const el = $(id);
    if (el) el.style.display = blocked ? "none" : "";
  });
  CLAUDE_GATE_CLASSES.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => { el.style.display = blocked ? "none" : ""; });
  });
  const note = $("demoClaudeNote");
  if (note) note.style.display = blocked ? "block" : "none";
}

function applyBotClientView() {
  const isClient = !st.isAdmin;
  const botLeft     = $("botLeft");
  const cliControls = $("botClientControls");
  const botLayout   = document.querySelector(".bot-layout");

  if (isClient) {
    // Hide full parameter panels; show compact client row
    if (botLeft)     botLeft.style.display     = "none";
    if (cliControls) cliControls.style.display = "";
    if (botLayout)   botLayout.classList.add("client-mode");

    // Set safe defaults on the hidden bot inputs
    const set = (id, val) => { const el = $(id); if (el && !el._clientDefaultSet) { el.value = val; el._clientDefaultSet = true; } };
    set("botDuration",     "1");
    set("botDurationUnit", "t");
    set("botMartingale",   "1");
    set("botMaxLoss",      "4");
    const botUseStrategy = $("botUseStrategy");
    if (botUseStrategy && !botUseStrategy._clientDefaultSet) { botUseStrategy.checked = true; botUseStrategy._clientDefaultSet = true; }
    const aiAutoRadio = document.querySelector('input[name="botStrat"][value="aiAuto"]');
    if (aiAutoRadio && !aiAutoRadio._clientDefaultSet) { aiAutoRadio.checked = true; aiAutoRadio._clientDefaultSet = true; }
    const botResetOnWin = $("botResetOnWin");
    if (botResetOnWin && !botResetOnWin._clientDefaultSet) { botResetOnWin.checked = true; botResetOnWin._clientDefaultSet = true; }

    // Sync client inputs from current bot values
    const sync = (cliId, srcId) => { const c = $(cliId), s = $(srcId); if (c && s) c.value = s.value; };
    sync("cliStake",     "botStake");
    sync("cliStake2",    "botStake2");
    sync("cliLossLimit", "botLossLimit");
    sync("cliTarget",    "botTargetProfit");
  } else {
    // Admin: show full panels, hide compact row
    if (botLeft)     botLeft.style.display     = "";
    if (cliControls) cliControls.style.display = "none";
    if (botLayout)   botLayout.classList.remove("client-mode");
  }
}

// ── AUTO-TRADE VISIBILITY ─────────────────────────────────────
function applyAutoTradeVisibility() {
  const panel = $("autoTradePanel");
  if (!panel) return;
  // Admin always sees Auto-Trade regardless of the client-visibility toggle
  const visible = st.isAdmin || st.config.show_auto_trade_to_clients === "1";
  panel.style.display = visible ? "" : "none";
}

// ── BOT / ANALYSIS VISIBILITY ──────────────────────────────
function applyFeatureVisibility() {
  if (st.isAdmin) return;
  const showBot      = st.config.show_bot      !== "0";
  const showAnalysis = st.config.show_analysis !== "0";
  const botTab       = document.querySelector('.nav-tab[data-tab="bot"]');
  const analysisTab  = document.querySelector('.nav-tab[data-tab="analysis"]');
  const botPanel     = $("tab-bot");
  const analysisPanel = $("tab-analysis");
  if (botTab)       botTab.style.display      = showBot      ? "" : "none";
  if (analysisTab)  analysisTab.style.display = showAnalysis ? "" : "none";
  if (botPanel)     botPanel.style.display    = showBot      ? "" : "none";
  if (analysisPanel) analysisPanel.style.display = showAnalysis ? "" : "none";
  const activeTab = document.querySelector('.nav-tab.active');
  if (activeTab) {
    const cur = activeTab.dataset.tab;
    const hiddenNow = (cur === "bot" && !showBot) || (cur === "analysis" && !showAnalysis);
    if (hiddenNow) {
      const fallback = showAnalysis ? "analysis" : "bot";
      document.querySelector(`.nav-tab[data-tab="${fallback}"]`)?.click();
    }
  }
}

// ── AUTO-TRADE ENGINE ─────────────────────────────────────────
function _atLog(msg, type = "") {
  const log = $("atLog");
  if (!log) return;
  const div = document.createElement("div");
  div.className = "at-log-entry" + (type ? " " + type : "");
  div.textContent = new Date().toLocaleTimeString() + " — " + msg;
  log.prepend(div);
  if (log.children.length > 40) log.lastChild?.remove();
}

function _atStatus(msg, type = "") {
  const el = $("atStatus");
  if (!el) return;
  el.textContent = msg;
  el.className = "at-status" + (type ? " at-status-" + type : "");
}

function _atCheckSignal() {
  const cfg = st.config;
  const ai = st.aiRec;
  const cl = st.claudeLastScan;
  const minAiConf  = Number(cfg.min_ai_confidence  || 60);
  const minClConf  = Number(cfg.min_claude_confidence || 60);
  const requireAgr = cfg.require_ai_claude_agreement === "1";

  if (!ai || !ai.recommended) return { ok: false, reason: "Waiting for AI Advisor signal" };
  if (ai.confidence < minAiConf) return { ok: false, reason: `AI confidence ${ai.confidence}% < threshold ${minAiConf}%` };
  if (!cl || !cl.rec || cl.rec === "none") return { ok: false, reason: "Waiting for Claude signal" };
  if (cl.conf < minClConf) return { ok: false, reason: `Claude confidence ${cl.conf}% < threshold ${minClConf}%` };
  if (requireAgr && ai.recommended !== cl.rec) return { ok: false, reason: `AI (${ai.recommended}) and Claude (${cl.rec}) disagree` };
  // GPT veto: if GPT has a signal and it disagrees with Claude, block
  const gpt = st.gptLastScan;
  if (gpt && gpt.rec && gpt.rec !== "none" && cl.rec !== "none" && gpt.rec !== cl.rec) {
    return { ok: false, reason: `Claude (${cl.rec}) and GPT (${gpt.rec}) disagree — waiting for alignment` };
  }

  // Historical win-rate check using local journal
  const minWR  = Number(cfg.min_historical_win_rate  || 55);
  const minN   = Number(cfg.min_historical_sample || 10);
  const strat  = cl.rec;
  const hist   = st.journal.filter(e => e.strategy === strat);
  if (hist.length >= minN) {
    const wr = Math.round(100 * hist.filter(e => e.result === "Win").length / hist.length);
    if (wr < minWR) return { ok: false, reason: `Historical win rate ${wr}% < threshold ${minWR}% (${hist.length} trades)` };
  }

  return { ok: true, rec: cl.rec, market: cl.market || ai.bestMarket?.sym || st.symbol, aiConf: ai.confidence, clConf: cl.conf };
}

function _atOnScanResult() {
  const at = st.autoTrade;
  if (!at.running) return;
  if (st.bot.running) return;

  const check = _atCheckSignal();
  if (!check.ok) {
    _atStatus("Watching — " + check.reason, "watch");

    // Market rotation: try AI Advisor's best market if current fails, 90s cooldown
    const now = Date.now();
    if (now - at.lastRotationAt > 90000) {
      const bestSym = st.aiRec?.bestMarket?.sym;
      const scannedSym = st.claudeLastScan?.market || st.symbol;
      if (bestSym && bestSym !== scannedSym) {
        const w = (st.ticksAll[bestSym] || []).slice(-300).map(t => lastDig(t.price)).filter(d => Number.isInteger(d) && d >= 0 && d <= 9);
        if (w.length >= 100) {
          at.lastRotationAt = now;
          _atLog(`Rotating to ${MARKETS[bestSym] || bestSym} (AI Advisor pick)`, "");
          _atStatus(`Rotating to ${MARKETS[bestSym] || bestSym}…`, "watch");
          executeClaudeScan(bestSym, w);
        }
      }
    }
    return;
  }

  // Signal approved
  _atLog(`Signal approved: ${check.rec.toUpperCase()} on ${MARKETS[check.market] || check.market} (AI ${check.aiConf}% / Claude ${check.clConf}%)`, "ok");
  _atStatus("Signal approved — placing trade…", "active");

  // Confidence-based stake sizing: scales from base stake at min threshold → max stake at 100%
  const atBaseStake = Number($("atStake")?.value || at.stake);
  const atMaxStake  = Number($("atMaxStake")?.value || at.maxStake || atBaseStake * 2);
  const atTarget    = Number($("atTarget")?.value || at.target);
  const atLossLimit = Number($("atLossLimit")?.value || at.lossLimit);
  const minConf = Number(st.config.min_claude_confidence || 60);
  const confFraction = Math.min(1, Math.max(0, (check.clConf - minConf) / Math.max(1, 100 - minConf)));
  const effectiveStake = Math.max(0.35, parseFloat((atBaseStake + (atMaxStake - atBaseStake) * confFraction).toFixed(2)));

  _atLog(`Stake: $${effectiveStake} (${check.clConf}% confidence → ${Math.round(confFraction * 100)}% of stake range)`, "");

  // Apply signal to bot
  const applyOk = applyClaudePickToBot();
  if (!applyOk) {
    _atLog("Failed to apply signal — retry next scan", "warn");
    _atStatus("Watching — retry next scan", "watch");
    return;
  }

  // Set bot inputs
  const elStake = $("botStake"), elStake2 = $("botStake2");
  const elTarget = $("botTargetProfit"), elLimit = $("botLossLimit");
  if (elStake)  elStake.value  = effectiveStake;
  if (elStake2) elStake2.value = effectiveStake;
  if (elTarget) elTarget.value = atTarget;
  if (elLimit)  elLimit.value  = atLossLimit;

  // Enforce paper/live from admin config
  const realToggle = $("realExecutionToggle");
  if (realToggle && st.config.allow_live_execution !== "1") realToggle.checked = false;

  startBot({ forceImmediateEntry: true, fastAutoplay: true });
  at.pl = 0; at.wins = 0; at.losses = 0;
}

function startAutoTrade() {
  const at = st.autoTrade;
  if (at.running) return;
  const atStake        = Number($("atStake")?.value || 1);
  const atMaxStake     = Number($("atMaxStake")?.value || atStake * 2);
  const atTarget       = Number($("atTarget")?.value || 25);
  const atLossLimit    = Number($("atLossLimit")?.value || 50);
  const atSessionTarget = Number($("atSessionTarget")?.value || 0);
  const atSessionLimit  = Number($("atSessionLimit")?.value || 0);

  if (isNaN(atStake) || atStake <= 0) { _atLog("Invalid stake", "warn"); return; }
  if (isNaN(atMaxStake) || atMaxStake < atStake) { _atLog("Max stake must be ≥ base stake", "warn"); return; }
  if (isNaN(atTarget) || atTarget <= 0) { _atLog("Invalid target profit", "warn"); return; }
  if (isNaN(atLossLimit) || atLossLimit <= 0) { _atLog("Invalid loss limit", "warn"); return; }
  if (st.config.allow_paper_execution !== "1" && st.config.allow_live_execution !== "1") {
    _atLog("Auto-Trade is disabled by admin (paper and live both off)", "warn"); return;
  }

  at.running = true;
  at.stake = atStake; at.maxStake = atMaxStake;
  at.target = atTarget; at.lossLimit = atLossLimit;
  at.sessionPL = 0; at.sessionTarget = atSessionTarget; at.sessionLimit = atSessionLimit;
  at.lastRotationAt = 0;

  const startBtn = $("atStartBtn"), stopBtn = $("atStopBtn");
  if (startBtn) startBtn.disabled = true;
  if (stopBtn)  stopBtn.disabled  = false;

  _atStatus("Watching for signal…", "watch");
  const sessionInfo = atSessionTarget > 0 || atSessionLimit > 0
    ? ` | Session: +$${atSessionTarget || "∞"} / -$${atSessionLimit || "∞"}`
    : "";
  _atLog(`Auto-Trade started — Base $${atStake}→Max $${atMaxStake}, Target $${atTarget}, Limit $${atLossLimit}${sessionInfo}`);
  _atOnScanResult();
}

function stopAutoTrade() {
  const at = st.autoTrade;
  at.running = false;
  if (st.bot.running) stopBot();
  const startBtn = $("atStartBtn"), stopBtn = $("atStopBtn");
  if (startBtn) startBtn.disabled = false;
  if (stopBtn)  stopBtn.disabled  = true;
  _atStatus("Stopped");
  _atLog("Auto-Trade stopped by user", "warn");
}

// Called from showBotResult() when bot finishes — accumulates session P/L then re-enters watch loop
function _atOnBotStopped(won) {
  const at = st.autoTrade;
  if (!at.running) return;

  const runPL = st.bot.pl || 0;
  at.sessionPL += runPL;
  _atLog(`Run ended: ${won ? "WIN" : "LOSS"} $${runPL >= 0 ? "+" : ""}${runPL.toFixed(2)} | Session P/L: $${at.sessionPL >= 0 ? "+" : ""}${at.sessionPL.toFixed(2)}`, won ? "ok" : "warn");

  // Session P/L cap checks
  if (at.sessionLimit > 0 && at.sessionPL <= -at.sessionLimit) {
    _atLog(`Session loss limit hit ($${Math.abs(at.sessionPL).toFixed(2)}). Auto-Trade stopped for today.`, "warn");
    stopAutoTrade(); return;
  }
  if (at.sessionTarget > 0 && at.sessionPL >= at.sessionTarget) {
    _atLog(`Session target reached (+$${at.sessionPL.toFixed(2)}). Auto-Trade stopped. Great session!`, "ok");
    stopAutoTrade(); return;
  }

  _atStatus(`Watching — Session P/L $${at.sessionPL >= 0 ? "+" : ""}${at.sessionPL.toFixed(2)}`, "watch");
}

function applyStrategyGate() {
  const hide = !st.isAdmin;

  // Hide Strategies tab from non-admins
  const strategiesTab = document.querySelector('.nav-tab[data-tab="strategies"]');
  if (strategiesTab) strategiesTab.style.display = hide ? "none" : "";
  const strategiesContent = $("tab-strategies");
  if (strategiesContent) strategiesContent.style.display = hide ? "none" : "";

  // Analysis tab visibility is governed by show_analysis admin toggle via applyFeatureVisibility.
  // Only hide it here when config hasn't loaded yet (show_analysis still default "1" means show).
  const showAnalysis = st.config.show_analysis !== "0";
  const hideAnalysis = hide && !showAnalysis;
  const analysisTab = document.querySelector('.nav-tab[data-tab="analysis"]');
  if (analysisTab) analysisTab.style.display = hideAnalysis ? "none" : "";
  const analysisContent = $("tab-analysis");
  if (analysisContent) analysisContent.style.display = hideAnalysis ? "none" : "";

  // If a non-admin is on a hidden tab, redirect to Bot
  if (hide && (st.currentTab === "strategies" || (st.currentTab === "analysis" && hideAnalysis) || !st.currentTab)) {
    const botTab = document.querySelector('.nav-tab[data-tab="bot"]');
    if (botTab) botTab.click();
  }

  applyBotClientView();
}

function pingVisitor(loginId, isDemo) {
  fetch("/api/visitor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: SESSION_ID, login_id: loginId || null, is_demo: isDemo ? 1 : 0 })
  }).catch(() => {});
}

const AT_CONFIG_KEYS = ["show_auto_trade_to_clients","require_ai_claude_agreement","min_ai_confidence","min_claude_confidence","min_historical_win_rate","min_historical_sample","allow_live_execution","allow_paper_execution","openai_scan_enabled","openai_finetune_model","openai_finetune_job_id","show_bot","show_analysis"];

async function loadRemoteConfig() {
  try {
    const res = await fetch("/api/config?ts=" + Date.now(), { cache: "no-store" });
    const data = await res.json();
    st.config.claude_gate = data.claude_gate ?? "1";
    AT_CONFIG_KEYS.forEach(k => { if (data[k] !== undefined) st.config[k] = data[k]; });
  } catch (_) {}
  applyClaudeGate();
  applyStrategyGate();
  applyAutoTradeVisibility();
  applyFeatureVisibility();
}

async function refreshRemoteConfig() {
  try {
    const res = await fetch("/api/config?ts=" + Date.now(), { cache: "no-store" });
    const data = await res.json();
    const oldGate = st.config.claude_gate;
    const oldShowAt = st.config.show_auto_trade_to_clients;
    const oldShowBot = st.config.show_bot;
    const oldShowAnalysis = st.config.show_analysis;
    AT_CONFIG_KEYS.forEach(k => { if (data[k] !== undefined) st.config[k] = data[k]; });
    if (oldShowAt !== st.config.show_auto_trade_to_clients) applyAutoTradeVisibility();
    if (oldShowBot !== st.config.show_bot || oldShowAnalysis !== st.config.show_analysis) applyFeatureVisibility();
    if (oldGate !== st.config.claude_gate) {
      applyClaudeGate();
      const realAccount = st.isAuthorized && !st.isDemo;
      const blocked = st.config.claude_gate === "1" && !realAccount && !st.isAdmin;
      if (blocked) {
        const deepBtn = $("claudeDeepScanBtn");
        const applyBtn = $("claudeApplyBotBtn");
        if (deepBtn) deepBtn.style.display = "none";
        if (applyBtn) applyBtn.style.display = "none";
        document.querySelectorAll(".bot-claude-scan").forEach(el => { el.style.display = "none"; });
        st.claudeLastScan = null;
      }
    }
  } catch (_) {}
}

// ── ADMIN MODE INIT ───────────────────────────────────────
// Admin dashboard is now at /admin/dashboard (separate page).
// The trading terminal activates admin mode via ?adminReady=1
// ONLY when mm.adminToken is already in sessionStorage from the real login.
function initAdminPanel() {
  const _aq = new URLSearchParams(window.location.search);
  if (_aq.get("adminReady") === "1" && _admGet("mm.adminToken")) {
    st.isAdmin = true;
    _admSet("mm.admin", "1");
    window.history.replaceState({}, "", window.location.pathname);
  }
  // Also activate admin if token is present from a previous login in this session
  if (!st.isAdmin && _admGet("mm.adminToken")) {
    st.isAdmin = true;
    _admSet("mm.admin", "1");
  }
  updateAdminNav();
  if (st.isAdmin) {
    applyStrategyGate();
    applyClaudeGate();
  }
}

function updateAdminNav() {
  const btn = $("adminDashboardBtn");
  if (!btn) return;
  btn.style.display = st.isAdmin ? "" : "none";
  btn.onclick = () => { window.location.href = "/admin"; };
}

let _claudeAutoScanTimer = null;
let _claudeAutoScanStarted = false;

function startClaudeAutoScan() {
  if (_claudeAutoScanStarted) return;
  _claudeAutoScanStarted = true;
  const statusEl = $("claudeScanStatus");
  // Admin in paper mode gets pre-filled tick data, so first scan can fire in 2s.
  // Normal users need real ticks to accumulate first.
  const delay = (st.isAdmin && !st.wsReady) ? 2000 : 45000;
  if (statusEl) statusEl.textContent = delay < 5000 ? "🤖 Admin scan in 2s…" : "🤖 First scan in 45s…";
  setTimeout(() => {
    triggerClaudeAutoScan();
    _claudeAutoScanTimer = setInterval(triggerClaudeAutoScan, 120000);
  }, delay);
}

async function triggerClaudeAutoScan() {
  // Admin can scan on simulated paper ticks; regular users need a live WS connection
  if (!st.wsReady && !st.isAdmin) return;
  const realAccount = st.isAuthorized && !st.isDemo;
  if (st.config.claude_gate === "1" && !realAccount && !st.isAdmin) {
    applyClaudeGate();
    return;
  }
  const market = st.aiRec?.bestMarket?.sym || st.symbol;
  const w = windowTicks(market);
  if (w.length < 100) return;
  const statusEl = $("claudeScanStatus");
  if (statusEl) statusEl.textContent = "🤖 Scanning…";
  const ticks = w.slice(-300)
    .map(t => lastDig(t.price))
    .filter(d => Number.isInteger(d) && d >= 0 && d <= 9);
  if (ticks.length < 100) return;
  await executeClaudeScan(market, ticks);
}

function updateBotClaudeBadge(rec, conf, reason, col, gptRec, gptConf, agreed) {
  const statusEl = $("claudeScanStatus");
  const recEl = $("botClaudeRec");
  const confEl = $("botClaudeConf");
  const reasonEl = $("botClaudeReason");
  const applyBtn = $("claudeApplyBotBtn");
  const agreeBtn = $("agreeAutoPlayBtn");
  const gptRow = $("botGptRow");
  const gptRecEl = $("botGptRec");
  const gptConfEl = $("botGptConf");
  const gptAgreedEl = $("botGptAgreed");
  const labelMap = { odd: "ODD BIAS", even: "EVEN BIAS", over123: "OVER 1/2/3", under876: "UNDER 8/7/6", hitrun: "HIT & RUN", none: "NO BIAS" };
  const strong = rec !== "none" && conf >= 55;
  const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (statusEl) statusEl.textContent = `🤖 Claude + GPT scan: ${now} · Next in 2 min`;
  if (recEl) { recEl.textContent = labelMap[rec] || rec.toUpperCase() || "—"; recEl.style.color = col; }
  if (confEl) confEl.textContent = conf + "%";
  if (reasonEl) reasonEl.textContent = reason;
  if (applyBtn) applyBtn.style.display = strong ? "block" : "none";
  if (agreeBtn) agreeBtn.style.display = (strong && agreed) ? "block" : "none";
  if (gptRec && gptRow) {
    gptRow.style.display = "";
    if (gptRecEl) { gptRecEl.textContent = "GPT: " + (labelMap[gptRec] || gptRec.toUpperCase()); gptRecEl.style.color = agreed ? "var(--green)" : "var(--amber)"; }
    if (gptConfEl) { gptConfEl.textContent = (gptConf || 0) + "%"; gptConfEl.style.color = agreed ? "var(--green)" : "var(--amber)"; }
    if (gptAgreedEl) { gptAgreedEl.textContent = agreed ? "✓ AGREE" : "≠ DIFFER"; gptAgreedEl.style.color = agreed ? "var(--green)" : "var(--red)"; }
  } else if (gptRow) { gptRow.style.display = "none"; }
}

// ── ADMIN SPA ─────────────────────────────────────────────────
function renderAdminLoginOrDashboard() {
  const tok = _admGet("mm.adminToken");
  document.body.innerHTML = "";
  document.body.style.cssText = "margin:0;padding:0;background:#0a0a14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e2e8f0;min-height:100vh";

  if (!tok) {
    _renderAdminLogin();
  } else {
    _renderAdminDash(tok);
  }
}

function _adminCSS() {
  if (document.getElementById("_adminStyle")) return;
  const s = document.createElement("style");
  s.id = "_adminStyle";
  s.textContent = `
*{box-sizing:border-box;margin:0;padding:0}
.adm-topbar{display:flex;align-items:center;justify-content:space-between;padding:14px 28px;background:#12121f;border-bottom:1px solid rgba(124,58,237,.3);position:sticky;top:0;z-index:100}
.adm-brand h1{font-size:17px;font-weight:700;color:#e2e8f0}.adm-brand h1 span{color:#19c37d}
.adm-brand p{font-size:11px;color:#64748b}
.adm-badge{background:rgba(124,58,237,.2);border:1px solid rgba(124,58,237,.4);border-radius:5px;padding:2px 7px;font-size:10px;color:#a78bfa;font-weight:700;margin-left:6px}
.adm-btn{padding:8px 18px;border-radius:8px;border:none;cursor:pointer;font-size:13px;font-weight:600;transition:.15s;text-decoration:none;display:inline-block}
.adm-btn-green{background:linear-gradient(135deg,#19c37d,#0ea66b);color:#000}
.adm-btn-red{background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.4);color:#f87171}
.adm-btn:hover{opacity:.85}
.adm-main{padding:24px 28px;max-width:1400px;margin:0 auto}
.adm-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px}
.adm-card{background:#12121f;border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:20px 22px}
.adm-card.green{border-color:rgba(25,195,125,.3)}
.adm-card.amber{border-color:rgba(245,158,11,.3)}
.adm-card.purple{border-color:rgba(124,58,237,.3)}
.adm-label{font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px}
.adm-value{font-size:34px;font-weight:800}
.adm-card.green .adm-value{color:#19c37d}
.adm-card.amber .adm-value{color:#f59e0b}
.adm-card.purple .adm-value{color:#a78bfa}
.adm-section{background:#12121f;border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:20px 22px;margin-bottom:20px}
.adm-section-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.adm-section-title{font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em}
.adm-refresh{background:none;border:1px solid rgba(255,255,255,.1);color:#64748b;border-radius:6px;padding:3px 10px;font-size:11px;cursor:pointer}
.adm-refresh:hover{color:#a78bfa;border-color:rgba(124,58,237,.4)}
.adm-toggle-row{display:flex;align-items:center;gap:16px;padding:10px 0}
.adm-toggle-label{font-size:14px;font-weight:600;color:#e2e8f0}
.adm-toggle-desc{font-size:12px;color:#64748b;margin-top:3px}
.adm-switch{position:relative;display:inline-block;width:48px;height:26px;flex-shrink:0;cursor:pointer}
.adm-switch input{opacity:0;width:0;height:0;position:absolute}
.adm-slider{position:absolute;inset:0;background:#374151;border-radius:13px;transition:.3s;cursor:pointer}
.adm-slider::before{content:'';position:absolute;width:20px;height:20px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.3s;box-shadow:0 1px 3px rgba(0,0,0,.4)}
.adm-switch input:checked+.adm-slider{background:#7c3aed}
.adm-switch input:checked+.adm-slider::before{transform:translateX(22px)}
.adm-table{width:100%;border-collapse:collapse;font-size:12px}
.adm-table th{text-align:left;padding:8px 12px;color:#475569;font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid rgba(255,255,255,.06)}
.adm-table td{padding:9px 12px;border-bottom:1px solid rgba(255,255,255,.04);color:#cbd5e1;vertical-align:middle}
.adm-table tr:last-child td{border-bottom:none}
.adm-table tr:hover td{background:rgba(255,255,255,.025)}
.adm-pill{border-radius:4px;padding:2px 7px;font-size:10px;font-weight:700}
.adm-real{background:rgba(25,195,125,.15);color:#19c37d;border:1px solid rgba(25,195,125,.3)}
.adm-demo{background:rgba(245,158,11,.15);color:#f59e0b;border:1px solid rgba(245,158,11,.3)}
.adm-anon{background:rgba(100,116,139,.15);color:#64748b;border:1px solid rgba(100,116,139,.3)}
.adm-win{background:rgba(25,195,125,.15);color:#19c37d}
.adm-loss{background:rgba(239,68,68,.15);color:#ef4444}
.adm-mono{font-family:monospace;font-size:11px}
.adm-empty{color:#475569;text-align:center;padding:20px}
.adm-msg{color:#64748b;text-align:center;padding:40px;font-size:14px}
.adm-login-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a14}
.adm-login-card{background:#12121f;border:1px solid rgba(124,58,237,.35);border-radius:16px;padding:40px 36px;width:100%;max-width:400px;box-shadow:0 0 40px rgba(124,58,237,.15)}
.adm-login-logo{display:flex;align-items:center;gap:12px;margin-bottom:28px}
.adm-login-logo h1{font-size:20px;font-weight:700;color:#e2e8f0}.adm-login-logo h1 span{color:#19c37d}
.adm-login-logo p{font-size:12px;color:#64748b;margin-top:2px}
.adm-flabel{display:block;font-size:12px;font-weight:600;color:#94a3b8;margin-bottom:6px;margin-top:16px}
.adm-finput{width:100%;padding:10px 14px;background:#1e1e30;border:1px solid rgba(124,58,237,.3);border-radius:8px;color:#e2e8f0;font-size:14px;outline:none;transition:.2s}
.adm-finput:focus{border-color:#7c3aed;box-shadow:0 0 0 3px rgba(124,58,237,.15)}
.adm-submit{width:100%;margin-top:24px;padding:12px;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer}
.adm-submit:hover{opacity:.9}
.adm-err{margin-top:14px;padding:10px 14px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.35);border-radius:8px;color:#f87171;font-size:13px;display:none}
@media(max-width:900px){.adm-grid{grid-template-columns:repeat(2,1fr)}}
.adm-form{margin-top:16px;padding:18px;background:rgba(0,0,0,.2);border:1px solid rgba(255,255,255,.06);border-radius:8px}
.adm-form-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:4px}
.adm-form-btn{padding:10px 20px;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;margin-top:12px}
.adm-form-btn:hover{opacity:.9}
.adm-form-btn.danger{background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.4);color:#f87171;padding:4px 10px;font-size:11px;margin-top:0}
.adm-form-btn.danger:hover{background:rgba(239,68,68,.25)}
.adm-expand-btn{background:none;border:1px solid rgba(124,58,237,.35);color:#a78bfa;border-radius:6px;padding:4px 12px;font-size:12px;cursor:pointer}
.adm-expand-btn:hover{background:rgba(124,58,237,.12)}
.adm-range-btn{background:none;border:1px solid rgba(255,255,255,.1);color:#64748b;border-radius:6px;padding:3px 10px;font-size:11px;cursor:pointer;transition:.15s}
.adm-range-btn:hover{color:#a78bfa;border-color:rgba(124,58,237,.4)}
.adm-range-btn.active{background:rgba(124,58,237,.15);border-color:rgba(124,58,237,.5);color:#a78bfa}
.adm-filter-btn{background:none;border:1px solid rgba(255,255,255,.08);color:#475569;border-radius:5px;padding:2px 8px;font-size:10px;cursor:pointer;transition:.15s;margin-left:2px}
.adm-filter-btn:hover{color:#94a3b8;border-color:rgba(255,255,255,.2)}
.adm-filter-btn.active{background:rgba(15,186,255,.12);border-color:rgba(15,186,255,.4);color:#38bdf8}
.adm-sa-meta{display:flex;gap:16px;flex-wrap:wrap;font-size:11px;color:#64748b;padding:8px 2px;margin-bottom:4px}
.adm-sa-meta span{display:flex;align-items:center;gap:4px}
.adm-sa-note{font-size:10px;color:#475569;background:rgba(255,255,255,.03);border-left:2px solid rgba(255,255,255,.08);padding:4px 8px;margin-bottom:10px;border-radius:0 4px 4px 0}
.adm-sa-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}
.adm-sa-sub{font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px}
.adm-low{font-size:10px;color:#64748b;background:#1e293b;padding:1px 5px;border-radius:3px;margin-left:4px}
.adm-strong{font-size:10px;color:#19c37d;background:rgba(25,195,125,.1);padding:1px 5px;border-radius:3px;margin-left:4px}
.adm-at-thresh{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px}
.adm-at-thresh-row{display:flex;flex-direction:column;gap:4px}
.adm-at-thresh-row label{font-size:11px;color:#64748b}
.adm-at-inp{background:#1e293b;border:1px solid rgba(255,255,255,.1);border-radius:6px;color:#e2e8f0;font-size:13px;padding:5px 8px;width:100%;box-sizing:border-box}
.at-status{font-size:12px;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);color:#64748b;text-align:center;margin-top:6px}
.at-status-watch{color:#f59e0b;border-color:rgba(245,158,11,.35);background:rgba(245,158,11,.06)}
.at-status-active{color:#19c37d;border-color:rgba(25,195,125,.35);background:rgba(25,195,125,.06)}
.at-log{margin-top:8px;max-height:120px;overflow-y:auto;font-size:10px}
.at-log-entry{padding:2px 4px;border-bottom:1px solid rgba(255,255,255,.04);color:#64748b;line-height:1.5}
.at-log-entry.ok{color:#19c37d}
.at-log-entry.warn{color:#f59e0b}
.adm-sparkline{display:inline-flex;align-items:flex-end;gap:2px;height:14px;margin-left:8px;vertical-align:middle;opacity:.85}
.adm-spark-bar{display:inline-block;width:5px;border-radius:1px;min-height:1px;transition:opacity .2s}
.adm-status{margin-top:12px;padding:10px 14px;border-radius:8px;font-size:13px;display:none}
.adm-status.ok{background:rgba(25,195,125,.1);border:1px solid rgba(25,195,125,.3);color:#19c37d}
.adm-status.err{background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.35);color:#f87171}
.adm-cred-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
@media(max-width:700px){.adm-cred-grid,.adm-form-row{grid-template-columns:1fr}}
  `;
  document.head.appendChild(s);
}

function _renderAdminLogin() {
  _adminCSS();
  document.body.innerHTML = `
<div class="adm-login-wrap">
  <div class="adm-login-card">
    <div class="adm-login-logo">
      <svg width="32" height="32" viewBox="0 0 48 48" fill="none"><path d="M24 2L43 13V35L24 46L5 35V13Z" fill="#0d0d1a" stroke="#7c3aed" stroke-width="1.5"/><polyline points="10,36 15,30 19,33 24,24 29,20 33,23 38,14" stroke="#19c37d" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="38" cy="14" r="3.5" fill="#19c37d" opacity="0.2"/><circle cx="38" cy="14" r="2.2" fill="#19c37d"/><circle cx="38" cy="14" r="0.9" fill="white" opacity="0.9"/></svg>
      <div><h1>MoneyMeKa <span>Pro</span><span class="adm-badge">ADMIN</span></h1><p>Sign in to Admin Dashboard</p></div>
    </div>
    <label class="adm-flabel" for="adm_u">Username</label>
    <input class="adm-finput" id="adm_u" type="text" autocomplete="username" placeholder="Admin username"/>
    <label class="adm-flabel" for="adm_p">Password</label>
    <input class="adm-finput" id="adm_p" type="password" autocomplete="current-password" placeholder="Admin password"/>
    <button class="adm-submit" id="adm_btn" onclick="_admLogin()">Sign in to Admin</button>
    <div class="adm-err" id="adm_err"></div>
  </div>
</div>`;
  document.getElementById("adm_p").addEventListener("keydown", e => { if (e.key === "Enter") _admLogin(); });
}

async function _admLogin() {
  const btn = document.getElementById("adm_btn");
  const err = document.getElementById("adm_err");
  btn.textContent = "Signing in…"; btn.disabled = true;
  if (err) err.style.display = "none";
  try {
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: document.getElementById("adm_u").value, password: document.getElementById("adm_p").value })
    });
    const data = await res.json();
    if (data.token) {
      _admSet("mm.adminToken", data.token);
      _admSet("mm.admin", "1");
      if (data.username) _admSet("mm.adminUser", data.username);
      window.history.replaceState({}, "", "/admin");
      _renderAdminDash(data.token);
    } else {
      if (err) { err.textContent = data.error || "Login failed"; err.style.display = "block"; }
      btn.textContent = "Sign in to Admin"; btn.disabled = false;
    }
  } catch (e) {
    if (err) { err.textContent = "Network error"; err.style.display = "block"; }
    btn.textContent = "Sign in to Admin"; btn.disabled = false;
  }
}

function _admToggleVpsMode(on) {
  localStorage.setItem("mm.vpsMode", on ? "1" : "0");
  st.vpsMode = !!on;
  const desc = document.getElementById("adm_vps_desc");
  if (desc) desc.textContent = on
    ? "ON — VPS daemon executes trades. Browser displays status only."
    : "OFF — Browser sends buy orders directly to Deriv.";

  if (!on) {
    // Turning VPS OFF: immediately kill any active KV session so VPS stops trading now
    fetch("/api/vps/session", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: "__active__" }),
    }).catch(() => {});
    clearInterval(st._vpsPollTimer);
    st._vpsPollTimer = null;
    st._vpsSessionId = null;
    botLog("VPS execution disabled — existing session terminated.", "warn");
  } else {
    // Turning VPS ON: start polling so any already-running session surfaces in UI immediately
    clearInterval(st._vpsPollTimer);
    st._vpsPollTimer = setInterval(_vpsPollStatus, 5000);
    botLog("VPS execution enabled — live buys will be routed to VPS on next Run.", "signal");
  }
}

async function _admKillVps() {
  const btn = document.querySelector('[onclick="_admKillVps()"]');
  if (btn) btn.disabled = true;
  try {
    await fetch("/api/vps/session", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: "__active__" }) });
    const tok = _admGet("mm.adminToken");
    if (tok) setTimeout(() => _admLoadStats(tok), 1500);
  } catch (_) {}
}

function _admLogout() {
  _admClear("mm.admin");
  _admClear("mm.adminToken");
  _admClear("mm.adminUser");
  _renderAdminLogin();
}

function _admEsc(v) { return String(v || "").replace(/&/g, "&amp;").replace(/</g, "&lt;"); }
function _admFmt(ts) { if (!ts) return "—"; const d = new Date(ts); return d.toLocaleDateString() + " " + d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}); }
function _admAgo(ts) { if (!ts) return "—"; const s = Math.floor((Date.now()-ts)/1000); if (s<60) return s+"s ago"; if (s<3600) return Math.floor(s/60)+"m ago"; if (s<86400) return Math.floor(s/3600)+"h ago"; return Math.floor(s/86400)+"d ago"; }

function _renderAdminDash(tok) {
  _adminCSS();
  document.body.innerHTML = `
<div class="adm-topbar">
  <div class="adm-brand" style="display:flex;align-items:center;gap:10px">
    <svg width="26" height="26" viewBox="0 0 48 48" fill="none"><path d="M24 2L43 13V35L24 46L5 35V13Z" fill="#0d0d1a" stroke="#7c3aed" stroke-width="1.5"/><polyline points="10,36 15,30 19,33 24,24 29,20 33,23 38,14" stroke="#19c37d" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="38" cy="14" r="3.5" fill="#19c37d" opacity="0.2"/><circle cx="38" cy="14" r="2.2" fill="#19c37d"/><circle cx="38" cy="14" r="0.9" fill="white" opacity="0.9"/></svg>
    <div><h1>MoneyMeKa <span>Pro</span><span class="adm-badge">ADMIN</span></h1><p>Admin Dashboard</p></div>
  </div>
  <div style="display:flex;gap:10px;align-items:center">
    <a href="/?adminReady=1" class="adm-btn adm-btn-green">Open Trading Terminal</a>
    <button class="adm-btn adm-btn-red" onclick="_admLogout()">Logout</button>
  </div>
</div>
<div class="adm-main" id="adm_main"><div class="adm-msg" id="adm_load">Loading dashboard…</div></div>`;
  _admLoadStats(tok);
  window._admStatsInterval = setInterval(() => _admLoadStats(tok), 30000);
}

async function _admLoadStats(tok) {
  try {
    const [r1, r2, r3, r4] = await Promise.all([
      fetch("/api/admin/stats",     { headers: { "Authorization": "Bearer " + tok } }),
      fetch("/api/admin/users",     { headers: { "Authorization": "Bearer " + tok } }),
      fetch("/api/admin/audit-log", { headers: { "Authorization": "Bearer " + tok } }),
      fetch("/api/vps/status"),
    ]);
    if (r1.status === 401) { _admLogout(); return; }
    const [stats, users, audit, vpsStatus] = await Promise.all([
      r1.json(), r2.ok ? r2.json() : [], r3.ok ? r3.json() : [], r4.ok ? r4.json() : { running: false }
    ]);
    _admRenderStats(stats, users, audit, tok, vpsStatus);
  } catch (e) {
    const loadEl = document.getElementById("adm_load");
    if (loadEl) loadEl.textContent = "Load error: " + e.message;
  }
}

function _admSigAccuracySection(sa) {
  if (!sa) return "";
  const srcLabel = { claude: "Claude AI", ai_advisor: "AI Advisor", none: "No Signal" };
  const recLabel = { under876:"Under 8/7/6", over123:"Over 1/2/3", hitrun:"Hit & Run", odd:"Odd", even:"Even", match:"Match" };
  const pct = (wins, total) => total ? Math.round((wins/total)*100) : 0;
  const bar = (wins, total) => {
    const p = pct(wins, total);
    const col = p >= 60 ? "#19c37d" : p >= 50 ? "#f59e0b" : "#ef4444";
    return `<div style="height:6px;border-radius:3px;background:#1e293b;margin-top:4px"><div style="height:100%;border-radius:3px;background:${col};width:${p}%"></div></div>`;
  };
  const bySource = (sa.by_source||[]).map(r => `<tr>
    <td>${srcLabel[r.signal_source]||r.signal_source}</td>
    <td style="text-align:center">${r.total}</td>
    <td style="text-align:center">${r.wins}</td>
    <td style="text-align:right;padding-right:8px">
      <span style="font-weight:800;color:${pct(r.wins,r.total)>=55?'#19c37d':'#ef4444'}">${pct(r.wins,r.total)}%</span>
      ${bar(r.wins,r.total)}
    </td>
  </tr>`).join("") || `<tr><td colspan="4" style="text-align:center;color:#475569;padding:12px">No signal data yet — start trading to collect data</td></tr>`;
  const byRec = (sa.by_rec||[]).map(r => `<tr>
    <td>${recLabel[r.signal_rec]||r.signal_rec}</td>
    <td style="text-align:center">${r.total}</td>
    <td style="text-align:center">${r.wins}</td>
    <td style="text-align:right;padding-right:8px">
      <span style="font-weight:800;color:${pct(r.wins,r.total)>=55?'#19c37d':'#ef4444'}">${pct(r.wins,r.total)}%</span>
      ${bar(r.wins,r.total)}
    </td>
  </tr>`).join("") || `<tr><td colspan="4" style="text-align:center;color:#475569;padding:12px">No strategy data yet</td></tr>`;
  const byConf = (sa.by_conf||[]).map(r => `<tr>
    <td>${r.bucket}</td>
    <td style="text-align:center">${r.total}</td>
    <td style="text-align:center">${r.wins}</td>
    <td style="text-align:right;padding-right:8px">
      <span style="font-weight:800;color:${pct(r.wins,r.total)>=55?'#19c37d':'#ef4444'}">${pct(r.wins,r.total)}%</span>
      ${bar(r.wins,r.total)}
    </td>
  </tr>`).join("") || `<tr><td colspan="4" style="text-align:center;color:#475569;padding:12px">No confidence data yet</td></tr>`;
  const tHead = `<thead><tr><th>—</th><th style="text-align:center">Trades</th><th style="text-align:center">Wins</th><th style="text-align:right;padding-right:8px">Win Rate</th></tr></thead>`;
  return `
<div class="adm-section">
  <div class="adm-section-head"><div class="adm-section-title">📊 Signal Accuracy</div></div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px">
    <div>
      <div style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#64748b;text-transform:uppercase;margin-bottom:6px">By Signal Source</div>
      <table class="adm-table">${tHead}<tbody>${bySource}</tbody></table>
    </div>
    <div>
      <div style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#64748b;text-transform:uppercase;margin-bottom:6px">By Strategy</div>
      <table class="adm-table">${tHead}<tbody>${byRec}</tbody></table>
    </div>
    <div>
      <div style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#64748b;text-transform:uppercase;margin-bottom:6px">By Confidence</div>
      <table class="adm-table">${tHead}<tbody>${byConf}</tbody></table>
    </div>
  </div>
</div>`;
}

// ── SIGNAL ANALYTICS (admin-only) ────────────────────────────
let _saToken = "";
let _saRange  = "7d";
let _saFilters = { source: "", mode: "", signal: "" };

function _admSignalAnalyticsHtml() {
  const ranges = [["today","Today"],["7d","7 Days"],["30d","30 Days"],["all","All Time"]];
  const btnHtml = ranges.map(([r,label]) =>
    `<button class="adm-range-btn${r==="7d"?" active":""}" data-range="${r}" onclick="_admSetSaRange('${r}')">${label}</button>`
  ).join("");
  const filterGroup = (label, key, opts) => {
    const chips = opts.map(([v,l]) =>
      `<button class="adm-filter-btn${_saFilters[key]===v?" active":""}" onclick="_admSetSaFilter('${key}','${v}')">${l}</button>`
    ).join("");
    return `<span style="font-size:11px;color:#64748b;margin-left:10px">${label}:</span>${chips}`;
  };
  return `
<div class="adm-section">
  <div class="adm-section-head">
    <div class="adm-section-title">📈 Signal Analytics</div>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      <span style="font-size:11px;color:#64748b">Range:</span>${btnHtml}
      ${filterGroup("Source","source",[["","All"],["bot","Bot"],["casino","Casino"]])}
      ${filterGroup("Mode","mode",[["","All"],["paper","Paper"],["demo","Demo"],["live","Live"]])}
      ${filterGroup("Signal","signal",[["","All"],["claude","Claude"],["ai_advisor","AI Advisor"],["none","None"]])}
    </div>
  </div>
  <div id="admSaBody"><div class="adm-msg">Loading analytics…</div></div>
</div>`;
}

function _admSetSaRange(range) {
  _saRange = range;
  document.querySelectorAll(".adm-range-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.range === range)
  );
  _loadSa(_saToken, range);
}

function _admSetSaFilter(key, value) {
  _saFilters[key] = value;
  document.querySelectorAll(`.adm-filter-btn[onclick*="'${key}'"]`).forEach(b =>
    b.classList.toggle("active", b.textContent.trim() === ["All","Bot","Casino","Paper","Demo","Live","Claude","AI Advisor","None"][["","bot","casino","paper","demo","live","claude","ai_advisor","none"].indexOf(value)])
  );
  // Re-render filter chips to reflect new active state
  const wrap = document.getElementById("admSaBody");
  if (wrap) {
    // Rebuild the whole analytics section header by toggling button classes
    document.querySelectorAll(".adm-filter-btn").forEach(b => {
      const onclick = b.getAttribute("onclick") || "";
      const m = onclick.match(/_admSetSaFilter\('(\w+)','([^']*)'\)/);
      if (m) b.classList.toggle("active", _saFilters[m[1]] === m[2]);
    });
  }
  _loadSa(_saToken, _saRange);
}

async function _loadSa(tok, range) {
  _saToken = tok;
  const body = document.getElementById("admSaBody");
  if (!body) return;
  body.innerHTML = '<div class="adm-msg">Loading…</div>';
  try {
    const qs = new URLSearchParams({ range });
    if (_saFilters.source) qs.set("source", _saFilters.source);
    if (_saFilters.mode)   qs.set("mode",   _saFilters.mode);
    if (_saFilters.signal) qs.set("signal",  _saFilters.signal);
    const r = await fetch(`/api/admin/signal-analytics?${qs}`, { headers: { "Authorization": "Bearer " + tok } });
    if (r.status === 401) { body.innerHTML = '<div class="adm-msg">Unauthorized</div>'; return; }
    const data = await r.json();
    body.innerHTML = _admRenderSa(data);
  } catch (e) {
    body.innerHTML = `<div class="adm-msg">Load error: ${_admEsc(e.message)}</div>`;
  }
}

function _admRenderSa(d) {
  const pct   = (w, t) => t ? Math.round(100 * w / t) : 0;
  const fmtPL = (n) => { const v = Number(n||0); return (v>=0?"+":"")+v.toFixed(2); };
  const fmtTs = (ms) => ms ? new Date(ms).toLocaleString() : "—";
  const rc    = (p) => p >= 60 ? "#19c37d" : p >= 50 ? "#f59e0b" : "#ef4444";
  const plc   = (n) => Number(n||0) >= 0 ? "#19c37d" : "#ef4444";
  const tag   = (n) => n < 10 ? `<span class="adm-low">low sample</span>` : n >= 30 ? `<span class="adm-strong">strong</span>` : "";
  const empty = (cols) => `<tr><td colspan="${cols}" class="adm-empty">No data yet for this range.</td></tr>`;

  // Build sparkline map: strategy → array[7] of win rates (day 0=oldest, day 6=today)
  const sparkMap = {};
  (d.by_day||[]).forEach(r => {
    if (!sparkMap[r.strategy]) sparkMap[r.strategy] = {};
    const idx = Math.min(6, Math.max(0, r.day_idx));
    sparkMap[r.strategy][idx] = r.n > 0 ? Math.round(100 * r.wins / r.n) : null;
  });
  const sparkline = (strat) => {
    const days = sparkMap[strat];
    if (!days || Object.keys(days).length < 2) return "";
    const bars = Array.from({length:7}, (_,i) => {
      const v = days[i];
      if (v == null) return `<span class="adm-spark-bar" style="opacity:.15;height:3px"></span>`;
      const col = v >= 60 ? "#19c37d" : v >= 50 ? "#f59e0b" : "#ef4444";
      return `<span class="adm-spark-bar" style="height:${Math.round(v*0.14)+1}px;background:${col}" title="Day ${i+1}: ${v}%"></span>`;
    }).join("");
    return `<span class="adm-sparkline" title="7-day win rate trend">${bars}</span>`;
  };

  // Contract label map — DIGIT* → display name
  const ctLabel = { DIGITEVEN:"Even",DIGITODD:"Odd",DIGITOVER:"Over",DIGITUNDER:"Under",DIGITMATCH:"Match",DIGITDIFF:"Differ",CALL:"Rise",PUT:"Fall" };
  // Barrier shown only for contracts that use it
  const ctHasBarrier = new Set(["DIGITOVER","DIGITUNDER","DIGITMATCH","DIGITDIFF"]);

  // Metadata header
  const meta = d.meta || {};
  const sig  = d.sig_events || {};
  const scanToTrade = sig.total ? `${sig.traded||0}/${sig.total} scans traded` : null;
  const metaHtml = `<div class="adm-sa-meta">
    <span>${meta.total_count||0} settled trades</span>
    <span>Last: ${fmtTs(meta.last_trade_at)}</span>
    <span>Refreshed: ${fmtTs(meta.refreshed_at)}</span>
    ${scanToTrade ? `<span>${scanToTrade}</span>` : ""}
  </div>
  <div class="adm-sa-note">Analytics based on settled trades/spins — every scan is not necessarily a trade.</div>`;

  // Markets
  const mkRows = (d.by_market||[]).map(r => {
    const p = pct(r.wins, r.total);
    return `<tr><td>${_admEsc(r.market_name||r.market)}${tag(r.total)}</td><td style="text-align:center">${r.total}</td><td style="text-align:center;color:#19c37d">${r.wins}</td><td style="text-align:center;color:#ef4444">${r.total-r.wins}</td><td style="text-align:center;color:${rc(p)};font-weight:700">${p}%</td><td style="text-align:right;color:${plc(r.pl)};font-weight:700">${fmtPL(r.pl)}</td><td style="text-align:right;color:${plc(r.avg_profit)}">${Number(r.avg_profit||0).toFixed(3)}</td></tr>`;
  }).join("") || empty(7);

  // Contracts — normalize name, show barrier only where relevant
  const ctRows = (d.by_contract||[]).map(r => {
    const ct = r.contract_norm || r.contract || "";
    const label = ctLabel[ct] || ct;
    const barrierCell = ctHasBarrier.has(ct) ? (r.barrier || "—") : "—";
    const p = pct(r.wins, r.total);
    return `<tr><td>${_admEsc(label)}</td><td style="text-align:center">${barrierCell}</td><td style="text-align:center">${r.total}${tag(r.total)}</td><td style="text-align:center;color:${rc(p)};font-weight:700">${p}%</td><td style="text-align:right;color:${plc(r.pl)};font-weight:700">${fmtPL(r.pl)}</td></tr>`;
  }).join("") || empty(5);

  // Strategies — show "(none)" group as "No Strategy" + sparkline trend
  const stRows = (d.by_strategy||[]).map(r => {
    const p = pct(r.wins, r.total);
    const name = r.strategy === "(none)" ? "No Strategy" : _admEsc(r.strategy || "—");
    const spark = sparkline(r.strategy || "(none)");
    return `<tr><td>${name}${spark}</td><td style="text-align:center">${r.total}${tag(r.total)}</td><td style="text-align:center;color:${rc(p)};font-weight:700">${p}%</td><td style="text-align:right;color:${plc(r.pl)};font-weight:700">${fmtPL(r.pl)}</td></tr>`;
  }).join("") || empty(4);

  // Signal Sources
  const srcLabel = { claude:"Claude AI", ai_advisor:"AI Advisor", combined:"Combined", none:"No Signal" };
  const ssRows = (d.by_signal_source||[]).map(r => {
    const p = pct(r.wins, r.total);
    return `<tr><td>${srcLabel[r.signal_source]||_admEsc(r.signal_source||"Unknown")}</td><td style="text-align:center">${r.total}${tag(r.total)}</td><td style="text-align:center;color:${rc(p)};font-weight:700">${p}%</td><td style="text-align:right;color:${plc(r.pl)};font-weight:700">${fmtPL(r.pl)}</td></tr>`;
  }).join("") || empty(4);

  // Confidence Bands (sorted high→low)
  const bandOrder = ["90-100","80-89","70-79","60-69","50-59","0-49","none"];
  const bandMap = {};
  (d.by_conf_band||[]).forEach(r => { bandMap[r.band] = r; });
  const cbRows = bandOrder.map(band => {
    const r = bandMap[band]; if (!r) return "";
    const p = pct(r.wins, r.total);
    return `<tr><td>${band==="none"?"No confidence":band+"%"}</td><td style="text-align:center">${r.total}${tag(r.total)}</td><td style="text-align:center;color:${rc(p)};font-weight:700">${p}%</td><td style="text-align:right;color:${plc(r.pl)};font-weight:700">${fmtPL(r.pl)}</td></tr>`;
  }).join("") || empty(4);

  const tbl4 = (head, rows) => `<table class="adm-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;

  return `${metaHtml}<div class="adm-sa-grid">
  <div>
    <div class="adm-sa-sub">🌐 Best Markets</div>
    ${tbl4("<th>Market</th><th style='text-align:center'>Trades</th><th style='text-align:center'>W</th><th style='text-align:center'>L</th><th style='text-align:center'>Win %</th><th style='text-align:right'>P/L</th><th style='text-align:right'>Avg</th>", mkRows)}
  </div>
  <div>
    <div class="adm-sa-sub">📜 Best Contracts</div>
    ${tbl4("<th>Contract</th><th style='text-align:center'>Barrier</th><th style='text-align:center'>Trades</th><th style='text-align:center'>Win %</th><th style='text-align:right'>P/L</th>", ctRows)}
  </div>
  <div>
    <div class="adm-sa-sub">🎯 Best Strategies</div>
    ${tbl4("<th>Strategy</th><th style='text-align:center'>Trades</th><th style='text-align:center'>Win %</th><th style='text-align:right'>P/L</th>", stRows)}
  </div>
  <div>
    <div class="adm-sa-sub">🤖 Signal Sources</div>
    ${tbl4("<th>Source</th><th style='text-align:center'>Trades</th><th style='text-align:center'>Win %</th><th style='text-align:right'>P/L</th>", ssRows)}
  </div>
  <div>
    <div class="adm-sa-sub">📊 Confidence Bands</div>
    ${tbl4("<th>Confidence</th><th style='text-align:center'>Trades</th><th style='text-align:center'>Win %</th><th style='text-align:right'>P/L</th>", cbRows)}
  </div>
</div>`;
}

function _admRenderStats(d, users, audit, tok, vpsStatus) {
  const { stats, visitors, trades, config, signal_accuracy } = d;
  const vps = vpsStatus || { running: false };
  const main = document.getElementById("adm_main");
  if (!main) return;
  const vpsOn   = localStorage.getItem("mm.vpsMode") === "1";
  const vpsAge  = vps._pinged_at ? Math.round((Date.now() - vps._pinged_at) / 1000) : null;
  const vpsFresh = vpsAge !== null && vpsAge < 25; // within two ping cycles (10s each)
  const vpsRunning = vps.running && vpsFresh;
  const plSign  = (vps.pl || 0) >= 0 ? "+" : "";
  const plColor = (vps.pl || 0) >= 0 ? "#19c37d" : "#ef4444";
  main.innerHTML = `
<div class="adm-section" style="border-color:${vpsOn ? "rgba(25,195,125,.35)" : "rgba(255,255,255,.07)"}">
  <div class="adm-section-head">
    <div class="adm-section-title">⚡ VPS Bot Executor</div>
    <div style="display:flex;gap:8px;align-items:center">
      <span style="font-size:11px;color:${vpsFresh ? "#19c37d" : "#64748b"}">${vpsFresh ? "● LIVE" : "○ IDLE"}</span>
      <button class="adm-refresh" onclick="_admKillVps()" style="color:#ef4444;border-color:rgba(239,68,68,.3)" ${!vpsRunning ? "disabled" : ""}>Kill Session</button>
      <button class="adm-refresh" onclick="_admLoadStats('${tok}')">↻ Refresh</button>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:14px">
    <div class="adm-card${vpsRunning ? " green" : ""}"><div class="adm-label">Status</div><div class="adm-value" style="font-size:16px">${vpsRunning ? "Running" : vps.running ? "Stale" : "Idle"}</div></div>
    <div class="adm-card"><div class="adm-label">Market</div><div class="adm-value" style="font-size:14px">${vps.market || "—"}</div></div>
    <div class="adm-card"><div class="adm-label">Strategy</div><div class="adm-value" style="font-size:14px">${vps.strategy || "—"}</div></div>
    <div class="adm-card"><div class="adm-label">Trades</div><div class="adm-value">${vps.runs || 0}</div></div>
    <div class="adm-card${(vps.wins||0) > (vps.losses||0) ? " green" : ""}"><div class="adm-label">W / L</div><div class="adm-value" style="font-size:14px">${vps.wins || 0} / ${vps.losses || 0}</div></div>
    <div class="adm-card${(vps.pl||0) >= 0 ? " green" : " amber"}"><div class="adm-label">P / L</div><div class="adm-value" style="color:${plColor}">${plSign}$${Number(vps.pl || 0).toFixed(2)}</div></div>
  </div>
  <div class="adm-toggle-row">
    <label class="adm-switch"><input type="checkbox" id="adm_vps_mode" ${vpsOn ? "checked" : ""} onchange="_admToggleVpsMode(this.checked)"><span class="adm-slider"></span></label>
    <div>
      <div class="adm-toggle-label">Route live bot buys through VPS</div>
      <div class="adm-toggle-desc" id="adm_vps_desc">${vpsOn ? "ON — VPS daemon executes trades. Browser displays status only." : "OFF — Browser sends buy orders directly to Deriv."}</div>
    </div>
  </div>
  ${vpsAge !== null ? `<div style="font-size:10px;color:#475569;margin-top:8px">Last VPS heartbeat: ${vpsAge}s ago${vps.last_trade_at ? " | Last trade: " + Math.round((Date.now()-vps.last_trade_at)/1000) + "s ago" : ""}</div>` : ""}
</div>
<div class="adm-grid">
  <div class="adm-card"><div class="adm-label">Total Visitors</div><div class="adm-value">${stats.total_visitors}</div></div>
  <div class="adm-card green"><div class="adm-label">Real Accounts</div><div class="adm-value">${stats.real_accounts}</div></div>
  <div class="adm-card amber"><div class="adm-label">Demo Accounts</div><div class="adm-value">${stats.demo_accounts}</div></div>
  <div class="adm-card purple"><div class="adm-label">Trades Today</div><div class="adm-value">${stats.trades_today}</div></div>
</div>
<div class="adm-section">
  <div class="adm-section-head"><div class="adm-section-title">👁 Feature Visibility</div></div>
  <div class="adm-toggle-row" style="margin-bottom:10px">
    <label class="adm-switch"><input type="checkbox" id="adm_show_bot"${config.show_bot!=="0"?" checked":""}><span class="adm-slider"></span></label>
    <div>
      <div class="adm-toggle-label">Show MekaAiBot to clients</div>
      <div class="adm-toggle-desc" id="adm_show_bot_desc">${config.show_bot!=="0"?"ON — Bot tab visible to all users":"OFF — Bot tab hidden from clients"}</div>
    </div>
  </div>
  <div class="adm-toggle-row">
    <label class="adm-switch"><input type="checkbox" id="adm_show_analysis"${config.show_analysis!=="0"?" checked":""}><span class="adm-slider"></span></label>
    <div>
      <div class="adm-toggle-label">Show Analysis Tool to clients</div>
      <div class="adm-toggle-desc" id="adm_show_analysis_desc">${config.show_analysis!=="0"?"ON — Analysis tab visible to all users":"OFF — Analysis tab hidden from clients"}</div>
    </div>
  </div>
</div>
<div class="adm-section">
  <div class="adm-section-head"><div class="adm-section-title">🤖 Claude AI Gate</div></div>
  <div class="adm-toggle-row">
    <label class="adm-switch"><input type="checkbox" id="adm_cg"${config.claude_gate==="1"?" checked":""}><span class="adm-slider"></span></label>
    <div>
      <div class="adm-toggle-label">Block demo users from Claude</div>
      <div class="adm-toggle-desc" id="adm_cgdesc">${config.claude_gate==="1"?"ON — Only real Deriv accounts can use Claude":"OFF — All users (including demo) can use Claude"}</div>
    </div>
  </div>
</div>
<div class="adm-section">
  <div class="adm-section-head"><div class="adm-section-title">🤖 Auto-Trade Settings</div></div>
  <div class="adm-toggle-row" style="margin-bottom:10px">
    <label class="adm-switch"><input type="checkbox" id="adm_at_show"${config.show_auto_trade_to_clients==="1"?" checked":""}><span class="adm-slider"></span></label>
    <div>
      <div class="adm-toggle-label">Show Auto-Trade panel to clients</div>
      <div class="adm-toggle-desc" id="adm_at_showdesc">${config.show_auto_trade_to_clients==="1"?"ON — Clients can see and use Auto-Trade":"OFF — Auto-Trade hidden from clients"}</div>
    </div>
  </div>
  <div class="adm-toggle-row" style="margin-bottom:10px">
    <label class="adm-switch"><input type="checkbox" id="adm_at_agr"${config.require_ai_claude_agreement==="1"?" checked":""}><span class="adm-slider"></span></label>
    <div>
      <div class="adm-toggle-label">Require AI + Claude agreement</div>
      <div class="adm-toggle-desc" id="adm_at_agrdesc">${config.require_ai_claude_agreement==="1"?"ON — Both signals must agree on the same strategy":"OFF — Either signal alone can trigger a trade"}</div>
    </div>
  </div>
  <div class="adm-toggle-row" style="margin-bottom:10px">
    <label class="adm-switch"><input type="checkbox" id="adm_at_live"${config.allow_live_execution==="1"?" checked":""}><span class="adm-slider"></span></label>
    <div>
      <div class="adm-toggle-label">Allow live execution</div>
      <div class="adm-toggle-desc" id="adm_at_livedesc">${config.allow_live_execution==="1"?"ON — Auto-Trade can place real money trades":"OFF — Live execution blocked"}</div>
    </div>
  </div>
  <div class="adm-toggle-row" style="margin-bottom:14px">
    <label class="adm-switch"><input type="checkbox" id="adm_at_paper"${config.allow_paper_execution==="1"?" checked":""}><span class="adm-slider"></span></label>
    <div>
      <div class="adm-toggle-label">Allow paper execution</div>
      <div class="adm-toggle-desc" id="adm_at_paperdesc">${config.allow_paper_execution==="1"?"ON — Auto-Trade runs in paper/simulation mode":"OFF — Paper execution blocked"}</div>
    </div>
  </div>
  <div class="adm-at-thresh">
    <div class="adm-at-thresh-row"><label>Min AI confidence (%)</label><input class="adm-at-inp" id="adm_at_ai" type="number" min="0" max="100" value="${config.min_ai_confidence||60}"></div>
    <div class="adm-at-thresh-row"><label>Min Claude confidence (%)</label><input class="adm-at-inp" id="adm_at_cl" type="number" min="0" max="100" value="${config.min_claude_confidence||60}"></div>
    <div class="adm-at-thresh-row"><label>Min historical win rate (%)</label><input class="adm-at-inp" id="adm_at_wr" type="number" min="0" max="100" value="${config.min_historical_win_rate||55}"></div>
    <div class="adm-at-thresh-row"><label>Min historical sample (trades)</label><input class="adm-at-inp" id="adm_at_ns" type="number" min="0" value="${config.min_historical_sample||10}"></div>
    <button class="adm-form-btn" id="adm_at_save" style="margin-top:8px">Save thresholds</button>
    <span id="adm_at_save_status" style="font-size:11px;color:#64748b;margin-left:8px"></span>
  </div>
</div>
<div class="adm-section">
  <div class="adm-section-head">
    <div class="adm-section-title">🧠 AI Training (OpenAI)</div>
    <button class="adm-refresh" onclick="_admTrainingRefresh('${tok}')">↻ Refresh</button>
  </div>
  <div id="adm_training_status" style="font-size:12px;color:#94a3b8;margin-bottom:12px">Click Refresh to load training data info.</div>
  <div class="adm-toggle-row" style="margin-bottom:12px">
    <label class="adm-switch"><input type="checkbox" id="adm_oai_enabled"${config.openai_scan_enabled==="1"?" checked":""}><span class="adm-slider"></span></label>
    <div>
      <div class="adm-toggle-label">Use fine-tuned OpenAI model for scans</div>
      <div class="adm-toggle-desc" id="adm_oai_desc">${config.openai_scan_enabled==="1"?`ON — Model: ${config.openai_finetune_model||"(none set)"}` : "OFF — Using Claude for all scans"}</div>
    </div>
  </div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
    <button class="adm-form-btn" onclick="_admStartFinetune('${tok}')">▶ Start Fine-tune Job</button>
    <button class="adm-form-btn" onclick="_admFinetuneStatus('${tok}')">⟳ Check Job Status</button>
  </div>
  <div id="adm_ft_log" style="font-size:11px;color:#64748b;margin-top:8px;white-space:pre-wrap;font-family:monospace;background:#0a0a14;padding:8px;border-radius:6px;display:none"></div>
</div>
${_admSignalAnalyticsHtml()}
<div class="adm-section">
  <div class="adm-section-head"><div class="adm-section-title">Recent Sessions / Visitors</div><button class="adm-refresh" onclick="_admLoadStats('${tok}')">↻ Refresh</button></div>
  ${visitors.length ? _admVisTable(visitors) : '<div class="adm-empty">No sessions recorded yet.</div>'}
</div>
<div class="adm-section">
  <div class="adm-section-head"><div class="adm-section-title">Recent Trades</div></div>
  ${trades.length ? _admTradeTable(trades) : '<div class="adm-empty">No trades yet.</div>'}
</div>
${_admUsersSection(users||[])}
${_admCredSection()}
${_admAuditSection(audit||[])}`;

  const cg = document.getElementById("adm_cg");
  if (cg) cg.addEventListener("change", async () => {
    const val = cg.checked ? "1" : "0";
    const desc = document.getElementById("adm_cgdesc");
    if (desc) desc.textContent = "Saving…";
    try {
      const r2 = await fetch("/api/admin/config", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok },
        body: JSON.stringify({ key: "claude_gate", value: val })
      });
      const j = await r2.json();
      if (j.ok && desc) desc.textContent = val==="1" ? "ON — Only real Deriv accounts can use Claude" : "OFF — All users (including demo) can use Claude";
      else { if (desc) desc.textContent = "Save failed"; cg.checked = !cg.checked; }
    } catch (_) { if (desc) desc.textContent = "Error"; cg.checked = !cg.checked; }
  });

  // Auto-Trade toggle helpers
  const _atToggle = (elId, key, onDesc, offDesc, descId) => {
    const el = document.getElementById(elId);
    if (!el) return;
    el.addEventListener("change", async () => {
      const val = el.checked ? "1" : "0";
      const desc = document.getElementById(descId);
      if (desc) desc.textContent = "Saving…";
      try {
        const r = await fetch("/api/admin/config", { method:"POST", headers:{"Content-Type":"application/json","Authorization":"Bearer "+tok}, body: JSON.stringify({key, value:val}) });
        const j = await r.json();
        if (j.ok && desc) desc.textContent = el.checked ? onDesc : offDesc;
        else { if (desc) desc.textContent = "Save failed"; el.checked = !el.checked; }
      } catch(_) { if (document.getElementById(descId)) document.getElementById(descId).textContent = "Error"; el.checked = !el.checked; }
    });
  };
  _atToggle("adm_show_bot",      "show_bot",      "ON — Bot tab visible to all users",      "OFF — Bot tab hidden from clients",      "adm_show_bot_desc");
  _atToggle("adm_show_analysis", "show_analysis", "ON — Analysis tab visible to all users", "OFF — Analysis tab hidden from clients", "adm_show_analysis_desc");
  _atToggle("adm_at_show",  "show_auto_trade_to_clients",  "ON — Clients can see and use Auto-Trade",        "OFF — Auto-Trade hidden from clients",        "adm_at_showdesc");
  _atToggle("adm_at_agr",   "require_ai_claude_agreement", "ON — Both signals must agree on the same strategy","OFF — Either signal alone can trigger a trade", "adm_at_agrdesc");
  _atToggle("adm_at_live",  "allow_live_execution",        "ON — Auto-Trade can place real money trades",     "OFF — Live execution blocked",                "adm_at_livedesc");
  _atToggle("adm_at_paper", "allow_paper_execution",       "ON — Auto-Trade runs in paper/simulation mode",  "OFF — Paper execution blocked",               "adm_at_paperdesc");

  const atSaveBtn = document.getElementById("adm_at_save");
  if (atSaveBtn) atSaveBtn.addEventListener("click", async () => {
    const status = document.getElementById("adm_at_save_status");
    if (status) status.textContent = "Saving…";
    const vals = [
      { key: "min_ai_confidence",     id: "adm_at_ai" },
      { key: "min_claude_confidence", id: "adm_at_cl" },
      { key: "min_historical_win_rate", id: "adm_at_wr" },
      { key: "min_historical_sample", id: "adm_at_ns" },
    ];
    try {
      await Promise.all(vals.map(v => {
        const inp = document.getElementById(v.id);
        if (!inp) return Promise.resolve();
        return fetch("/api/admin/config", { method:"POST", headers:{"Content-Type":"application/json","Authorization":"Bearer "+tok}, body: JSON.stringify({key:v.key, value:inp.value}) });
      }));
      if (status) { status.textContent = "Saved ✓"; setTimeout(() => { if (status) status.textContent = ""; }, 2000); }
    } catch(_) { if (status) status.textContent = "Error saving"; }
  });

  const oaiEl = document.getElementById("adm_oai_enabled");
  if (oaiEl) oaiEl.addEventListener("change", async () => {
    const val = oaiEl.checked ? "1" : "0";
    const desc = document.getElementById("adm_oai_desc");
    if (desc) desc.textContent = "Saving…";
    try {
      const r2 = await fetch("/api/admin/config", { method:"POST", headers:{"Content-Type":"application/json","Authorization":"Bearer "+tok}, body: JSON.stringify({key:"openai_scan_enabled",value:val}) });
      const j = await r2.json();
      if (j.ok && desc) {
        const modelRow = await fetch("/api/admin/training-data", { headers:{"Authorization":"Bearer "+tok} }).then(r=>r.json()).catch(()=>({current_model:null}));
        desc.textContent = val==="1" ? `ON — Model: ${modelRow.current_model||"(none set)"}` : "OFF — Using Claude for all scans";
      } else { if (desc) desc.textContent = "Save failed"; oaiEl.checked = !oaiEl.checked; }
    } catch(_) { if (desc) desc.textContent = "Error"; oaiEl.checked = !oaiEl.checked; }
  });

  // Load signal analytics asynchronously (non-blocking)
  setTimeout(() => _loadSa(tok, _saRange), 0);
}

async function _admTrainingRefresh(tok) {
  const el = document.getElementById("adm_training_status");
  if (el) el.textContent = "Loading…";
  try {
    const r = await fetch("/api/admin/training-data", { headers: { "Authorization": "Bearer " + tok } });
    const d = await r.json();
    if (!r.ok) { if (el) el.textContent = "Error: " + d.error; return; }
    const byStr = (d.by_strategy||[]).map(s => `${s.strat}: ${s.n} trades @ ${s.wr}% WR`).join(" | ");
    if (el) el.innerHTML = `<span style="color:${d.ready?"#19c37d":"#f59e0b"}">${d.total} signal-annotated trades</span> (min 10 needed to train)${d.current_model?`<br><span style="color:#a78bfa;font-size:10px">Active model: ${d.current_model}</span>`:""}${byStr?`<br><span style="color:#64748b;font-size:10px">${byStr}</span>`:""}`;
  } catch(e) { if (el) el.textContent = "Error: " + e.message; }
}

async function _admStartFinetune(tok) {
  const log = document.getElementById("adm_ft_log");
  if (!confirm("Start a fine-tune job? This sends your trade data to OpenAI. Takes 15–60 min.")) return;
  if (log) { log.style.display = ""; log.textContent = "Uploading training data to OpenAI…"; }
  try {
    const r = await fetch("/api/admin/start-finetune", { method: "POST", headers: { "Authorization": "Bearer " + tok } });
    const d = await r.json();
    if (!r.ok) { if (log) log.textContent = "Error: " + d.error; return; }
    if (log) log.textContent = `Job started!\nJob ID: ${d.job_id}\nExamples: ${d.examples}\nStatus: ${d.status}\n\nUse "Check Job Status" in a few minutes.`;
  } catch(e) { if (log) log.textContent = "Error: " + e.message; }
}

async function _admFinetuneStatus(tok) {
  const log = document.getElementById("adm_ft_log");
  if (log) { log.style.display = ""; log.textContent = "Checking status…"; }
  try {
    const r = await fetch("/api/admin/finetune-status", { headers: { "Authorization": "Bearer " + tok } });
    const d = await r.json();
    if (!r.ok) { if (log) log.textContent = "Error: " + d.error; return; }
    let msg = `Job ID: ${d.job_id}\nStatus: ${d.status}`;
    if (d.model) msg += `\n\nModel ready: ${d.model}`;
    if (d.trained_tokens) msg += `\nTokens trained: ${d.trained_tokens.toLocaleString()}`;
    if (d.finished_at) msg += `\nFinished: ${new Date(d.finished_at*1000).toLocaleString()}`;
    if (d.status === "succeeded") msg += "\n\nToggle the OpenAI switch above to activate it for scans.";
    if (log) log.textContent = msg;
  } catch(e) { if (log) log.textContent = "Error: " + e.message; }
}

function _admVisTable(rows) {
  return `<table class="adm-table"><thead><tr><th>Session</th><th>Deriv Login</th><th>Account Type</th><th>First Seen</th><th>Last Active</th></tr></thead><tbody>${
    rows.map(r => `<tr>
      <td class="adm-mono">${_admEsc(r.session_id).slice(0,14)}…</td>
      <td>${r.login_id ? _admEsc(r.login_id) : '<span style="color:#475569">—</span>'}</td>
      <td>${r.login_id ? (r.is_demo ? '<span class="adm-pill adm-demo">Demo</span>' : '<span class="adm-pill adm-real">Real</span>') : '<span class="adm-pill adm-anon">Not linked</span>'}</td>
      <td>${_admFmt(r.first_seen)}</td>
      <td>${_admAgo(r.last_seen)}</td>
    </tr>`).join("")
  }</tbody></table>`;
}

function _admTradeTable(rows) {
  return `<table class="adm-table"><thead><tr><th>Source</th><th>Market</th><th>Contract</th><th>Stake</th><th>P/L</th><th>Result</th><th>Time</th></tr></thead><tbody>${
    rows.map(r => `<tr>
      <td><span class="adm-pill ${r.source==="casino"?"adm-demo":"adm-real"}">${_admEsc(r.source)}</span></td>
      <td>${_admEsc(r.market)}</td>
      <td>${_admEsc(r.contract)}${r.barrier ? " ("+_admEsc(r.barrier)+")" : ""}</td>
      <td>$${Number(r.stake).toFixed(2)}</td>
      <td style="color:${r.profit>=0?"#19c37d":"#ef4444"};font-weight:700">${r.profit>=0?"+":""}${Number(r.profit).toFixed(2)}</td>
      <td><span class="adm-pill ${r.won?"adm-win":"adm-loss"}">${r.won?"Win":"Loss"}</span></td>
      <td>${_admAgo(r.settled_at)}</td>
    </tr>`).join("")
  }</tbody></table>`;
}

// ── ADMIN ACCOUNT MANAGEMENT SECTIONS ────────────────────────
function _admUsersSection(users) {
  const myUser = _admGet("mm.adminUser") || "";
  const rows = users.length
    ? users.map(u => `<tr>
        <td><strong>${_admEsc(u.username)}</strong>${u.username===myUser?' <span style="color:#a78bfa;font-size:10px">(you)</span>':''}</td>
        <td>${_admEsc(u.email||"—")}</td>
        <td><span class="adm-pill adm-real">${u.role||"admin"}</span></td>
        <td><span class="adm-pill ${u.status==="active"?"adm-real":"adm-loss"}">${u.status}</span></td>
        <td>${u.last_login_at ? _admAgo(u.last_login_at) : "Never"}</td>
        <td>${u.status==="active"&&u.username!==myUser?`<button class="adm-form-btn danger" onclick="_admDisableAdminReq('${_admEsc(u.username)}')">Disable</button>`:"—"}</td>
      </tr>`).join("")
    : `<tr><td colspan="6" class="adm-empty">No D1 admin accounts yet. Add one below to enable full account management.</td></tr>`;
  return `<div class="adm-section">
  <div class="adm-section-head">
    <div class="adm-section-title">👤 Admin Accounts</div>
    <button class="adm-expand-btn" onclick="const f=document.getElementById('adm_addform');f.style.display=f.style.display==='none'?'block':'none'">+ Add Admin</button>
  </div>
  <table class="adm-table"><thead><tr><th>Username</th><th>Email</th><th>Role</th><th>Status</th><th>Last Login</th><th></th></tr></thead><tbody>${rows}</tbody></table>
  <div id="adm_addform" style="display:none" class="adm-form">
    <div style="font-size:13px;font-weight:700;color:#a78bfa;margin-bottom:14px">Add New Admin — requires email verification</div>
    <div class="adm-form-row">
      <div><label class="adm-flabel">Username</label><input class="adm-finput" id="adm_nu" placeholder="New username"/></div>
      <div><label class="adm-flabel">Email</label><input class="adm-finput" id="adm_ne" type="email" placeholder="Admin email"/></div>
    </div>
    <div class="adm-form-row">
      <div><label class="adm-flabel">Initial Password</label><input class="adm-finput" id="adm_np" type="password" placeholder="Set password (min 8 chars)"/></div>
      <div><label class="adm-flabel">Confirm Password</label><input class="adm-finput" id="adm_np2" type="password" placeholder="Confirm password"/></div>
    </div>
    <button class="adm-form-btn" onclick="_admAddAdminSubmit()">Send Verification Email</button>
    <div class="adm-status" id="adm_add_st"></div>
  </div>
</div>`;
}

function _admCredSection() {
  const myUser = _admGet("mm.adminUser") || "";
  return `<div class="adm-section">
  <div class="adm-section-head"><div class="adm-section-title">🔑 My Credentials</div><span style="font-size:11px;color:#475569">All changes require email verification</span></div>
  <div class="adm-cred-grid">
    <div>
      <div style="font-size:13px;font-weight:600;color:#e2e8f0;margin-bottom:14px">Change Password</div>
      <label class="adm-flabel">Current Password</label>
      <input class="adm-finput" id="adm_cp_cur" type="password" placeholder="Current password"/>
      <label class="adm-flabel">New Password</label>
      <input class="adm-finput" id="adm_cp_new" type="password" placeholder="New password (min 8 chars)"/>
      <label class="adm-flabel">Confirm New Password</label>
      <input class="adm-finput" id="adm_cp_new2" type="password" placeholder="Confirm new password"/>
      <button class="adm-form-btn" style="width:100%;margin-top:14px" onclick="_admChangePasswordSubmit()">Send Verification Email</button>
      <div class="adm-status" id="adm_cp_st"></div>
    </div>
    <div>
      <div style="font-size:13px;font-weight:600;color:#e2e8f0;margin-bottom:14px">Change Username</div>
      <div style="font-size:12px;color:#64748b;margin-bottom:12px">Current: <strong style="color:#a78bfa">${_admEsc(myUser)||"(env fallback — not changeable)"}</strong></div>
      <label class="adm-flabel">Current Password</label>
      <input class="adm-finput" id="adm_cu_pw" type="password" placeholder="Current password"/>
      <label class="adm-flabel">New Username</label>
      <input class="adm-finput" id="adm_cu_new" placeholder="New username"/>
      <button class="adm-form-btn" style="width:100%;margin-top:14px" onclick="_admChangeUsernameSubmit()">Send Verification Email</button>
      <div class="adm-status" id="adm_cu_st"></div>
    </div>
  </div>
</div>`;
}

function _admAuditSection(audit) {
  const rows = audit.length
    ? audit.map(a => `<tr>
        <td class="adm-mono">${_admEsc(a.admin_id||"").slice(0,10)}…</td>
        <td>${_admEsc(a.action)}</td>
        <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#64748b">${_admEsc(a.ip||"—")}</td>
        <td>${_admAgo(a.created_at)}</td>
      </tr>`).join("")
    : `<tr><td colspan="4" class="adm-empty">No audit entries yet.</td></tr>`;
  return `<div class="adm-section">
  <div class="adm-section-head">
    <div class="adm-section-title">📋 Audit Log</div>
    <button class="adm-refresh" onclick="const b=document.getElementById('adm_audit_b');b.style.display=b.style.display==='none'?'':'none'">Toggle</button>
  </div>
  <div id="adm_audit_b">
    <table class="adm-table"><thead><tr><th>Admin</th><th>Action</th><th>IP</th><th>When</th></tr></thead><tbody>${rows}</tbody></table>
  </div>
</div>`;
}

function _admShowStatus(el, type, msg) {
  if (!el) return;
  el.className = "adm-status " + type;
  el.textContent = msg;
  el.style.display = "block";
}

async function _admAddAdminSubmit() {
  const tok = _admGet("mm.adminToken");
  const myUser = _admGet("mm.adminUser") || "admin";
  const st2 = document.getElementById("adm_add_st");
  const user = document.getElementById("adm_nu")?.value.trim();
  const email = document.getElementById("adm_ne")?.value.trim();
  const pw = document.getElementById("adm_np")?.value;
  const pw2 = document.getElementById("adm_np2")?.value;
  if (!user || !email || !pw) { _admShowStatus(st2, "err", "All fields required."); return; }
  if (pw !== pw2) { _admShowStatus(st2, "err", "Passwords do not match."); return; }
  if (pw.length < 8) { _admShowStatus(st2, "err", "Password must be at least 8 characters."); return; }
  _admShowStatus(st2, "ok", "Sending…");
  try {
    const r = await fetch("/api/admin/users/add", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok }, body: JSON.stringify({ username: user, email, password: pw, requested_by: myUser }) });
    const d = await r.json();
    if (d.ok) {
      _admShowStatus(st2, "ok", "✓ " + d.message);
      ["adm_nu","adm_ne","adm_np","adm_np2"].forEach(id => { const el2 = document.getElementById(id); if (el2) el2.value = ""; });
    } else { _admShowStatus(st2, "err", d.error || "Failed"); }
  } catch(_e) { _admShowStatus(st2, "err", "Network error"); }
}

async function _admChangePasswordSubmit() {
  const tok = _admGet("mm.adminToken");
  const myUser = _admGet("mm.adminUser") || "";
  const st2 = document.getElementById("adm_cp_st");
  const cur = document.getElementById("adm_cp_cur")?.value;
  const nw = document.getElementById("adm_cp_new")?.value;
  const nw2 = document.getElementById("adm_cp_new2")?.value;
  if (!myUser) { _admShowStatus(st2, "err", "No D1 username in session. Log out and log in again."); return; }
  if (!cur || !nw) { _admShowStatus(st2, "err", "All fields required."); return; }
  if (nw !== nw2) { _admShowStatus(st2, "err", "New passwords do not match."); return; }
  if (nw.length < 8) { _admShowStatus(st2, "err", "New password must be at least 8 characters."); return; }
  _admShowStatus(st2, "ok", "Sending…");
  try {
    const r = await fetch("/api/admin/users/change-password", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok }, body: JSON.stringify({ username: myUser, current_password: cur, new_password: nw, requested_by: myUser }) });
    const d = await r.json();
    if (d.ok) {
      _admShowStatus(st2, "ok", "✓ " + d.message);
      ["adm_cp_cur","adm_cp_new","adm_cp_new2"].forEach(id => { const el2 = document.getElementById(id); if (el2) el2.value = ""; });
    } else { _admShowStatus(st2, "err", d.error || "Failed"); }
  } catch(_e) { _admShowStatus(st2, "err", "Network error"); }
}

async function _admChangeUsernameSubmit() {
  const tok = _admGet("mm.adminToken");
  const myUser = _admGet("mm.adminUser") || "";
  const st2 = document.getElementById("adm_cu_st");
  const pw = document.getElementById("adm_cu_pw")?.value;
  const newUn = document.getElementById("adm_cu_new")?.value.trim();
  if (!myUser) { _admShowStatus(st2, "err", "No D1 username found. Username changes only work for D1 accounts."); return; }
  if (!pw || !newUn) { _admShowStatus(st2, "err", "All fields required."); return; }
  _admShowStatus(st2, "ok", "Sending…");
  try {
    const r = await fetch("/api/admin/users/change-username", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok }, body: JSON.stringify({ username: myUser, current_password: pw, new_username: newUn, requested_by: myUser }) });
    const d = await r.json();
    if (d.ok) {
      _admShowStatus(st2, "ok", "✓ " + d.message);
      ["adm_cu_pw","adm_cu_new"].forEach(id => { const el2 = document.getElementById(id); if (el2) el2.value = ""; });
    } else { _admShowStatus(st2, "err", d.error || "Failed"); }
  } catch(_e) { _admShowStatus(st2, "err", "Network error"); }
}

async function _admDisableAdminReq(username) {
  if (!confirm(`Disable admin "${username}"?\n\nThis requires email verification before it takes effect.`)) return;
  const tok = _admGet("mm.adminToken");
  const myUser = _admGet("mm.adminUser") || "admin";
  try {
    const r = await fetch("/api/admin/users/disable", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok }, body: JSON.stringify({ target_username: username, requested_by: myUser }) });
    const d = await r.json();
    alert(d.ok ? "✓ " + d.message : "Error: " + (d.error || "Failed"));
  } catch(_e) { alert("Network error"); }
}

// ── INIT ──────────────────────────────────────────────────────
async function init() {
  // Save raw callback URL immediately — before any redirect handling or history.replaceState
  if (location.pathname === "/callback") {
    localStorage.setItem("mm_last_callback_url", location.href);
    console.log("[CALLBACK RAW URL]", location.href);
  }

  // Admin SPA route — intercept before any trading UI loads
  const _admPath = location.pathname.replace(/\/+$/, "") || "/";
  if (_admPath === "/admin" || _admPath === "/admin/dashboard") {
    renderAdminLoginOrDashboard();
    return;
  }

  // If callback params are in the URL, relay to parent (popup flow) or handle locally (same-tab).
  const _pq = new URLSearchParams(window.location.search);
  const _pc = _pq.get("code");
  const _pt = _pq.get("token1");
  const _pe = _pq.get("error");
  const _ped = _pq.get("error_description");
  // Always log full callback URL for diagnosis
  if (_pc || _pt || _pe || location.pathname === "/callback") {
    console.log("[CALLBACK FULL URL]", window.location.href);
  }
  if (_pe) {
    console.log("[OAuth:error]", _pe, _ped || "");
    log("OAuth error from Deriv: " + _pe + (_ped ? " — " + _ped : ""), "error");
  } else if (_pc) {
    console.log("[OAuth:code] OAuth code received. code:", _pc.slice(0, 12) + "…", "state:", _pq.get("state"));
  } else if (_pt) {
    console.log("[OAuth:token1] Legacy token received. token1:", _pt.slice(0, 8) + "…");
  } else if (location.pathname === "/callback") {
    console.log("[OAuth:callback] OAuth callback reached without code, token, or error. Raw URL saved in mm_last_callback_url.");
    log("OAuth callback reached but no code was received. Check console and mm_last_callback_url.", "warn");
  }
  if (_pc || _pt || _pe) {
    const _isPopup = window.name && window.name.startsWith("mm_deriv_auth_");
    console.log("[OAuth:popup-relay]", _pc ? "code" : _pt ? "token1" : "error", "found. isPopup:", _isPopup, "window.name:", window.name);
    if (_isPopup) {
      if (_pc) relayOAuthToMain({ type: "mm_oauth_code", code: _pc, state: _pq.get("state") });
      else if (_pt) relayOAuthToMain({ type: "mm_oauth_token", token1: _pt, acct1: _pq.get("acct1"), cur1: _pq.get("cur1") });
      else relayOAuthToMain({ type: "mm_oauth_error", error: _pe, error_description: _ped });
      return;
    }
    // same-tab flow: fall through to extractOauthToken below
  }

  // Listen for token relayed from popup via BroadcastChannel, postMessage, or localStorage fallback
  let _oauthHandled = false;
  const _guardedRelay = async (msg) => {
    if (_oauthHandled) return;
    _oauthHandled = true;
    await handleOAuthRelayMessage(msg);
  };
  try {
    const _bcIn = new BroadcastChannel("mm_oauth");
    _bcIn.onmessage = (ev) => {
      if (!ev.data?.type) return;
      _bcIn.close();
      _guardedRelay(ev.data);
    };
  } catch (_) {}
  window.addEventListener("message", (ev) => {
    if (ev.origin !== location.origin || !ev.data?.type) return;
    _guardedRelay(ev.data);
  });
  // localStorage fallback: catches relay written by popup before BroadcastChannel fires
  window.addEventListener("storage", (ev) => {
    if (ev.key !== "mm_oauth_relay" || !ev.newValue) return;
    try { _guardedRelay(JSON.parse(ev.newValue)); } catch (_) {}
  });
  // Check if a relay was already written before this tab's listeners were ready
  try {
    const _pending = JSON.parse(localStorage.getItem("mm_oauth_relay") || "null");
    if (_pending && _pending.type && Date.now() - (_pending.ts || 0) < 600000) {
      _guardedRelay(_pending);
    }
  } catch (_) {}

  // Hide landing immediately for returning users — before any async gap
  if (st.token || localStorage.getItem("mm.demo") === "1") hideLanding();

  await extractOauthToken();
  initTheme();
  loadRemoteConfig();
  initAdminPanel();
  pingVisitor(null, false); // anonymous page-load ping
  if (!st.token) {
    localStorage.setItem("mm.demo", "1");
  } else {
    log("Restored saved Deriv token.");
    el.tokenInput.value = st.token;
  }
  hideLanding();
  el.appIdInput.value = st.appId;
  if (st.token && !st._connectCalledFromOAuth) connectDeriv();
  el.marketSelect.value = st.symbol;
  updateFeeDisplay();
  updateMarketUi();
  updateModeUi();

  // Restore last active tab
  const savedTab = localStorage.getItem("mm.tab");
  if (savedTab) {
    const tabBtn = document.querySelector(`.nav-tab[data-tab="${savedTab}"]`);
    if (tabBtn) {
      document.querySelectorAll(".nav-tab").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-view").forEach(v => v.classList.remove("active"));
      tabBtn.classList.add("active");
      $("tab-" + savedTab)?.classList.add("active");
      st.currentTab = savedTab;
    }
  }

  // init digit circles placeholder
  for (let d=0;d<10;d++) {
    const wrap = document.createElement("div");
    wrap.className = "d-circle";
    wrap.innerHTML = `<div class="d-circle-badge">${d}</div><span class="d-pct">0%</span>`;
    el.digitCircles.append(wrap);
  }

  bindEvents();
  applyStrategyGate(); // hide admin-only tabs immediately on load, before async config fetch
  renderJournal();
  updateBotFlow();
  startSim();
  // Admin in paper mode: start Claude scanning immediately using pre-filled tick data
  if (st.isAdmin && !st.wsReady) startClaudeAutoScan();

  fetchCryptoPrices();
  setInterval(fetchCryptoPrices, 60000);

  setTimeout(() => runMarketScan(), 3000);
  setInterval(() => runMarketScan(), 15000);

  setInterval(refreshRemoteConfig, 5000);

  log("MoneyMaker Pro loaded. Demo stream active.");
}

init();
