/* ─────────────────────────────────────────────────────────────
   MoneyMaker Pro — Deriv Advanced Trading Terminal
   ───────────────────────────────────────────────────────────── */

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

// ── STATE ───────────────────────────────────────────────────
const st = {
  appId: localStorage.getItem("mm.appId") || "33j3KnddANLxl1PUwgCYq",
  token: localStorage.getItem("mm.token") || "",
  markup: Number(localStorage.getItem("mm.markup") ?? 3),
  ws: null, wsReady: false, isAuthorized: false,
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
    consecutiveLosses: 0,
    pendingTrade: null,
    entryWatch: null,   // waiting for entry trigger
  },
  aiRec: null,          // { recommended, confidence, scores, mood }
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

function connectDeriv() {
  disconnectDeriv(false);
  stopSim();
  st.appId = el.appIdInput.value.trim() || "1089";
  st.token = el.tokenInput.value.trim() || st.token;
  localStorage.setItem("mm.appId", st.appId);
  if (st.token) localStorage.setItem("mm.token", st.token);

  setStreamState("Connecting…", "");
  log("Connecting to Deriv…");
  try {
    st.ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(st.appId)}`);
  } catch(e) {
    log("WebSocket init failed: " + e.message, "error");
    startSim(); return;
  }

  st.ws.onopen = () => {
    st.wsReady = true;
    setStreamState("Live ticks", "live");
    log("Connected to Deriv price stream.");
    subscribeTicks(st.symbol);
    send({ active_symbols:"brief", product_type:"basic" });
    if (st.token) send({ authorize: st.token });
    setTimeout(subscribeTickerSyms, 1500);
  };

  st.ws.onmessage = ev => {
    try { handleMsg(JSON.parse(ev.data)); } catch(e) {}
  };

  st.ws.onclose = () => {
    st.wsReady = false; st.isAuthorized = false; st.proposal = null;
    setStreamState("Offline", "");
    updateModeUi();
    log("Connection closed — demo stream started.", "warn");
    startSim();
  };

  st.ws.onerror = () => log("WebSocket error.", "error");
}

function disconnectDeriv(announce) {
  if (st.ws) { st.ws.onclose = null; st.ws.close(); st.ws = null; }
  st.wsReady = false; st.isAuthorized = false;
  if (announce !== false) log("Disconnected from Deriv.");
  updateModeUi();
}

function handleMsg(m) {
  if (m.error) { log(m.error.message || "API error", "error"); return; }
  switch (m.msg_type) {
    case "authorize":
      st.isAuthorized = true;
      st.loginId = m.authorize.loginid;
      st.currency = m.authorize.currency || st.currency;
      log(`Authorized: ${st.loginId}`);
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
      hydrateHistory(m.history); break;
    case "proposal":
      st.proposal = m.proposal; renderProposal(); break;
    case "buy":
      handleLiveBuy(m.buy); break;
    case "proposal_open_contract":
      handleOpenContract(m.proposal_open_contract); break;
  }
}

function subscribeTicks(sym) {
  if (!st.wsReady) return;
  send({ forget_all:"ticks" });
  send({ ticks: sym, subscribe:1 });
  send({ ticks_history: sym, adjust_start_time:1, count:Math.min(st.tickWindow+50,5000), end:"latest", start:1, style:"ticks" });
  ticks(sym).length = 0;
  // Resubscribe ticker extra symbols
  setTimeout(() => subscribeTickerSyms(), 500);
}

function hydrateHistory(h) {
  if (!h || !Array.isArray(h.prices)) return;
  const sym = st.symbol;
  st.ticksAll[sym] = h.prices.map((p,i) => ({
    price: Number(p),
    timestamp: Number(h.times?.[i] || Date.now()/1000)*1000,
  })).filter(t => isFinite(t.price));
  renderAll();
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
    runBotEngine(price);
    renderAll();
    if (st.wsReady) refreshProposal();
  }
  updateBotDigitFeed(price);
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
  renderSignals();
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
  const gIdx = rankOf.indexOf(1), bIdx = rankOf.indexOf(2);
  const rIdx = rankOf.indexOf(10), yIdx = rankOf.indexOf(9);
  const gOnEven = evenDigits.includes(gIdx) && pcts[gIdx] >= 11;
  const bOnEven = evenDigits.includes(bIdx) && pcts[bIdx] >= 11;
  const rLow = pcts[rIdx] <= 8.6;
  const yLow = pcts[yIdx] <= 9.5;
  if (gOnEven && bOnEven && rLow && yLow) return "ready";
  if ((gOnEven || bOnEven) && (rLow || yLow)) return "partial";
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
    const g = rankOf.indexOf(1), b = rankOf.indexOf(2);
    const r = rankOf.indexOf(10), y = rankOf.indexOf(9);
    if (oddD.includes(g) && pcts[g] >= 11) score += 30; else if (oddD.includes(g)) score += 15;
    if (oddD.includes(b) && pcts[b] >= 11) score += 30; else if (oddD.includes(b)) score += 15;
    if (evenD.includes(r) && pcts[r] <= 8.6) score += 20; else if (evenD.includes(r)) score += 10;
    if (evenD.includes(y) && pcts[y] <= 9.5) score += 20; else if (evenD.includes(y)) score += 10;
  } else if (strat === "even") {
    const evenD = [0,2,4,6,8];
    const g = rankOf.indexOf(1), b = rankOf.indexOf(2);
    const r = rankOf.indexOf(10), y = rankOf.indexOf(9);
    if (evenD.includes(g) && pcts[g] >= 11) score += 30; else if (evenD.includes(g)) score += 15;
    if (evenD.includes(b) && pcts[b] >= 11) score += 30; else if (evenD.includes(b)) score += 15;
    if (pcts[r] <= 8.6) score += 20; else if (pcts[r] <= 9.5) score += 10;
    if (pcts[y] <= 9.5) score += 20; else if (pcts[y] <= 10) score += 10;
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
    if (!arr || arr.length < 100) continue;
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
    return arr && arr.length >= 100;
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
    if (!arr || arr.length < 100) continue;
    const stats = computeDigitStats(arr.slice(-100));

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
  }

  if (scanStatus) scanStatus.textContent = winner ? `Best: ${winner.name} (${winner.score}%)` : "No clear winner";
  scanRunning = false;
}

function getAIRecommendation(stats, w) {
  const strats = ["over123","under876","odd","even","hitrun"];
  const scores = {};
  strats.forEach(s => { scores[s] = computeStrategyScore(s, stats); });
  const mood = computeMarketMood(w);
  const sorted = [...strats].sort((a, b) => scores[b] - scores[a]);
  let recommended = sorted[0];
  if ((mood === "uptrend" || mood === "downtrend") && scores["hitrun"] >= 50) recommended = "hitrun";
  else if (mood === "ranging") {
    const best = scores["odd"] >= scores["even"] ? "odd" : "even";
    if (scores[best] >= 55) recommended = best;
  }
  const bestMarket = getBestMarketForStrat(recommended);
  return { recommended, confidence: scores[recommended], scores, mood, bestMarket };
}

function renderAIAdvisor(stats, w) {
  if (!el.aiMoodBadge) return;
  const rec = getAIRecommendation(stats, w);
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
  ["over123","under876","odd","even","hitrun"].forEach(s => {
    const sc = rec.scores[s];
    const cls = sc >= 70 ? "high" : sc >= 45 ? "med" : "low";
    const row = document.createElement("div");
    row.className = "ai-score-row";
    const isBest = s === rec.recommended;
    row.innerHTML = `<span class="ai-score-label" style="${isBest?"color:var(--green)":""}">${stratLabels[s]}</span><div class="ai-score-track"><div class="ai-score-fill ${cls}" style="width:${sc}%"></div></div><span class="ai-score-val">${sc}%</span>`;
    el.aiScoresGrid.append(row);
  });
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
  if (!b.running) return;

  const dig = lastDig(price);
  const w = windowTicks(b.market);
  if (w.length < 50) return;
  const stats = computeDigitStats(w);

  // settle pending trade
  if (b.pendingTrade) {
    settleBotTrade(b.pendingTrade, price, dig);
    return;
  }

  // check stop conditions
  if (b.pl <= -b.lossLimit) {
    botLog(`Loss limit hit ($${b.lossLimit}). Bot stopped.`,"warn");
    stopBot(); return;
  }
  if (b.pl >= b.targetProfit) {
    botLog(`Target profit reached ($${b.targetProfit}). Bot stopped.`,"win");
    stopBot(); return;
  }

  // AI Auto: auto-switch to best market every 20 ticks when idle
  if (b.strategy === "aiAuto" && !b.pendingTrade && !b.entryWatch) {
    b._aiSwitchCooldown = (b._aiSwitchCooldown || 0) - 1;
    if (b._aiSwitchCooldown <= 0 && st.aiRec?.bestMarket) {
      const bestSym = st.aiRec.bestMarket.sym;
      if (bestSym !== b.market) {
        b.market = bestSym;
        b._aiSwitchCooldown = 20;
        botLog(`AI switching market → ${st.aiRec.bestMarket.name} (${st.aiRec.confidence}% confidence)`, "signal");
        updateBotFlow();
        if (st.wsReady && bestSym !== st.symbol) {
          send({ ticks: bestSym, subscribe: 1 });
        }
      }
    }
  }

  // check entry
  if (b.entryWatch) {
    const w2 = b.entryWatch;
    w2.ticksElapsed++;
    const entryNow = evaluateEntryTrigger(w2, dig, stats);
    if (entryNow) {
      executeBotTrade(dig, stats);
      b.entryWatch = null;
    } else if (w2.ticksElapsed >= w2.maxTicks) {
      b.entryWatch = null; // expired
    }
    return;
  }

  // check if strategy conditions met
  const stratOk = checkBotStrategy(b.strategy, stats, dig);
  if (stratOk) {
    b.entryWatch = buildEntryWatch(b.strategy, dig, stats);
    if (!b.entryWatch) executeBotTrade(dig, stats); // immediate
  }
}

function checkBotStrategy(strat, stats, dig) {
  if (!st.bot.useStrategy || strat === "manual") return true;
  switch (strat) {
    case "over123": return checkOver123(stats) === "ready";
    case "under876": return checkUnder876(stats) === "ready";
    case "odd":     return checkOdd(stats) === "ready";
    case "even":    return checkEven(stats) === "ready";
    case "hitrun":  { const hr=checkHitRun(stats); return hr.over==="ready"||hr.under==="ready"; }
    case "aiAuto":  return st.aiRec ? st.aiRec.confidence >= 50 : false;
    default: return true;
  }
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
  b.pendingTrade = trade;
  b.runs++;
  el.botRunCount.textContent = String(b.runs);
  botLog(`Entry: ${trade.label} barrier=${barrier} stake=${fmt(trade.stake).split(" ")[0]}`, "signal");

  // real execution path
  if (el.realToggle.checked && st.isAuthorized) {
    const payload = {
      buy: 1, subscribe:1,
      price: trade.stake,
      parameters: {
        amount: trade.stake, basis:"stake",
        contract_type: trade.contractType,
        currency: st.currency,
        duration: b.duration,
        duration_unit: b.durationUnit,
        symbol: b.market,
      },
    };
    if (barrier !== null) payload.parameters.barrier = String(barrier);
    if (st.markup > 0) payload.passthrough = { markup: st.markup };
    send(payload);
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

  const payout = won ? trade.stake * 1.87 : 0;
  const profit = payout - trade.stake;
  trade.status = won ? "won" : "lost";
  trade.profit = profit;
  b.pl += profit;
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
      b.currentStake = Math.min(b.currentStake * b.martingale, b.lossLimit);
    }
    el.botLossCount.textContent = String(b.losses);
    botLog(`LOSS ${fmt(-trade.stake).split(" ")[0]} | P/L: ${fmt(b.pl).split(" ")[0]}`, "loss");
  }

  // update P/L display with pop animation
  el.botPL.textContent = fmt(b.pl).split(" ")[0];
  el.botPL.className = b.pl >= 0 ? "profit" : "loss";
  el.botPL.classList.remove("pl-pop");
  void el.botPL.offsetWidth;
  el.botPL.classList.add("pl-pop");

  // live trade card + progress bars + sound
  addBotTradeCard(won, trade.label, trade.stake, profit, b.pl);
  updateBotProgressBars();
  playSound(won ? "win" : "loss");
  showCelebration(Math.abs(profit), won);

  // add to journal
  addJournalEntry({
    time: new Date().toLocaleTimeString(),
    market: marketName(b.market),
    type: trade.label,
    stake: trade.stake,
    barrier: trade.barrier,
    exitDigit: dig,
    result: won ? "Win" : "Loss",
    profit,
  });
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
      type: trade.label, stake: trade.stake,
      barrier: trade.barrier, exitDigit: dig,
      result: won?"Win":"Loss", profit: trade.profit,
    });
  });
}

function handleLiveBuy(buy) {
  if (!buy) return;
  const trade = {
    id: String(buy.contract_id || Date.now()),
    mode:"live", symbol: st.symbol,
    contractType: st.contractType,
    label: CONTRACT_LABELS[st.contractType],
    stake: Number(buy.buy_price||st.stake),
    status:"open", openedAt: Date.now(),
  };
  st.openTrades.unshift(trade);
  if (buy.contract_id) send({ proposal_open_contract:1, contract_id:buy.contract_id, subscribe:1 });
  log(`Live trade opened: ${trade.label} #${trade.id}`);
  renderAll();
}

function handleOpenContract(c) {
  const trade = st.openTrades.find(t=>t.id===String(c.contract_id));
  if (!trade) return;
  trade.status = c.is_sold ? (Number(c.profit)>=0?"won":"lost") : "open";
  trade.profit = Number(c.profit||0);
  if (c.is_sold) log(`Contract closed P/L ${fmt(trade.profit)}`, trade.profit>=0?"profit":"loss");
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
    currency:st.currency, duration:st.duration, duration_unit:st.durationUnit, symbol:st.symbol };
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
      if (el.disconnectBtn) el.disconnectBtn.style.display = "";
    } else {
      el.topbarBalanceValue.textContent = fmt(st.paperBalance);
      if (lbl) lbl.textContent = "Paper";
      el.topbarBalance.style.display = "";
      el.connectBtn.style.display = "";
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
  if (el.feeDisplay) el.feeDisplay.textContent = st.markup.toFixed(1) + "%";
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
function addJournalEntry(entry) {
  st.journal.unshift(entry);
  if (st.journal.length > 500) st.journal.pop();
  localStorage.setItem("mm.journal", JSON.stringify(st.journal));
  renderJournal();
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
  const rows = [["Time","Market","Type","Stake","Barrier","Exit Digit","Result","Profit/Loss"]];
  st.journal.forEach(e=>rows.push([e.time,e.market,e.type,e.stake,e.barrier,e.exitDigit,e.result,e.profit]));
  const csv = rows.map(r=>r.map(v=>`"${v??""}`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
  a.download = `moneymaker-journal-${Date.now()}.csv`;
  a.click();
}

// ── SIMULATION ───────────────────────────────────────────────
function startSim() {
  if (st.simulationTimer) return;
  setStreamState("Demo stream","demo");
  const all = ticks();
  let base = all[all.length-1]?.price || 1000 + Math.random()*200;
  st.simulationTimer = setInterval(()=>{
    const d = (Math.random()-0.49)*2.4;
    base = Math.max(100, base+d);
    onTick(base, st.symbol, Date.now());
  }, 1000);
  log("Demo tick stream started.");
}

function stopSim() {
  if (!st.simulationTimer) return;
  clearInterval(st.simulationTimer);
  st.simulationTimer = null;
}

// ── BOT CONTROLS ─────────────────────────────────────────────
function startBot() {
  const b = st.bot;
  b.market = el.botMarket.value;
  b.tradeType = el.botTradeType.value;
  b.stake = Number(el.botStake.value||1);
  b.stake2 = Number(el.botStake2.value||1);
  b.currentStake = b.stake;
  // Reset session P/L so previous runs don't trigger stop conditions immediately
  b.pl = 0; b.runs = 0; b.wins = 0; b.losses = 0; b.consecutiveLosses = 0;
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
  b.martingale = Number(el.botMartingale.value||1);
  b.maxLoss = Number(el.botMaxLoss.value||4);
  b.resetOnWin = el.botResetOnWin.checked;
  b.running = true;
  b.pendingTrade = null;
  b.entryWatch = null;
  el.botRunBtn.disabled = true;
  el.botStopBtn.disabled = false;
  el.botStatusLabel.textContent = "Running";
  el.botStatusLabel.style.color = "var(--green)";
  botLog(`Bot started. Strategy: ${b.strategy} | Market: ${marketName(b.market)}`, "signal");
  updateBotFlow();
  updateBotProgressBars();
  startSessionTimer();

  // ensure ticks are flowing for bot market
  if (st.wsReady && b.market !== st.symbol) subscribeTicks(b.market);
  else if (!st.wsReady && !st.simulationTimer) startSim();
}

function stopBot() {
  st.bot.running = false; st.bot.pendingTrade = null; st.bot.entryWatch = null;
  el.botRunBtn.disabled = false;
  el.botStopBtn.disabled = true;
  el.botStatusLabel.textContent = "Stopped";
  el.botStatusLabel.style.color = "var(--muted)";
  botLog("Bot stopped.");
  updateBotFlow();
  stopSessionTimer();
}

function resetBotStats() {
  const b = st.bot;
  b.runs=0; b.wins=0; b.losses=0; b.pl=0; b.consecutiveLosses=0; b.currentStake=b.stake;
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

async function redirectToOAuth() {
  const { codeVerifier, codeChallenge, state } = await generatePKCE();
  sessionStorage.setItem("pkce_code_verifier", codeVerifier);
  sessionStorage.setItem("oauth_state", state);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: st.appId,
    redirect_uri: "https://moneymekapro.com/callback",
    scope: "trade account_manage",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256"
  });
  window.location.href = `https://auth.deriv.com/oauth2/auth?${params}`;
}

async function extractOauthToken() {
  const q = new URLSearchParams(window.location.search);
  const code = q.get("code");
  const returnedState = q.get("state");

  if (code) {
    const storedState = sessionStorage.getItem("oauth_state");
    const codeVerifier = sessionStorage.getItem("pkce_code_verifier");
    window.history.replaceState({}, document.title, window.location.pathname);
    sessionStorage.removeItem("oauth_state");
    sessionStorage.removeItem("pkce_code_verifier");

    if (storedState && returnedState !== storedState) {
      log("OAuth state mismatch — aborting.");
      return;
    }

    log("OAuth code received. Exchanging for token…");
    try {
      const resp = await fetch("/.netlify/functions/token-exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, code_verifier: codeVerifier, redirect_uri: "https://moneymekapro.com/callback" })
      });
      const data = await resp.json();
      if (data.access_token) {
        st.token = data.access_token;
        localStorage.setItem("mm.token", data.access_token);
        log("Token obtained. Connecting…");
        connectDeriv();
      } else {
        log("Token exchange failed: " + (data.error_description || data.error || JSON.stringify(data)));
      }
    } catch (err) {
      log("Token exchange error: " + err.message);
    }
    return;
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
    connectDeriv();
  }
}

// ── EVENT BINDING ────────────────────────────────────────────
function bindEvents() {
  // nav tabs
  document.querySelectorAll(".nav-tab").forEach(btn=>{
    btn.addEventListener("click",()=>{
      document.querySelectorAll(".nav-tab").forEach(b=>b.classList.remove("active"));
      document.querySelectorAll(".tab-view").forEach(v=>v.classList.remove("active"));
      btn.classList.add("active");
      $("tab-"+btn.dataset.tab)?.classList.add("active");
      st.currentTab = btn.dataset.tab;
      if (btn.dataset.tab==="journal") renderJournal();
    });
  });

  // landing overlay
  const landingOauthBtn = $("landingOauthBtn");
  const landingDemoBtn  = $("landingDemoBtn");
  if (landingOauthBtn) landingOauthBtn.addEventListener("click", () => redirectToOAuth());
  if (landingDemoBtn) landingDemoBtn.addEventListener("click", () => {
    hideLanding();
    log("Demo mode active. All trades are paper trades.");
  });

  // AI apply button — sets strategy, market, trade type, and bot state
  const aiApplyBtn = $("aiApplyBtn");
  if (aiApplyBtn) aiApplyBtn.addEventListener("click", () => {
    if (!st.aiRec) { runMarketScan(); return; }
    const strat = st.aiRec.recommended || "over123";
    // Strategy radio + bot state
    document.querySelectorAll("input[name=botStrat]").forEach(r => { r.checked = r.value === strat; });
    st.bot.strategy = strat;
    // Trade type dropdown
    const typeMap = { over123:"digits_ou", under876:"digits_ou", odd:"digits_eo", even:"digits_eo", hitrun:"digits_match" };
    if (el.botTradeType) el.botTradeType.value = typeMap[strat] || "digits_ou";
    // Market dropdown + bot state
    const bm = st.aiRec.bestMarket;
    if (bm) {
      if (el.botMarket) el.botMarket.value = bm.sym;
      st.bot.market = bm.sym;
      botLog(`AI applied: ${STRAT_LABELS[strat] || strat} on ${bm.name} (${bm.score || st.aiRec.confidence}% confidence)`, "signal");
    } else {
      botLog(`AI applied: ${STRAT_LABELS[strat] || strat} (${st.aiRec.confidence}% confidence) — run scan for best market`, "signal");
    }
    updateBotFlow();
  });

  // theme toggle
  const themeToggle = $("themeToggle");
  if (themeToggle) themeToggle.addEventListener("click", toggleTheme);

  // connection
  el.settingsBtn.addEventListener("click",()=>el.settingsDialog.showModal());
  el.connectBtn.addEventListener("click", () => redirectToOAuth());
  if (el.disconnectBtn) el.disconnectBtn.addEventListener("click",()=>{
    st.token = ""; st.isAuthorized = false; st.loginId = "";
    localStorage.removeItem("mm.token");
    disconnectDeriv(true);
    updateModeUi();
    showLanding();
  });
  el.oauthBtn.addEventListener("click", () => { redirectToOAuth(); log("Redirecting to Deriv OAuth…"); });
  el.saveSettingsBtn.addEventListener("click",()=>{
    st.appId = el.appIdInput.value.trim()||"1089";
    st.token = el.tokenInput.value.trim();
    st.markup = Math.min(3, Math.max(0, Number(el.markupInput.value)||3));
    localStorage.setItem("mm.appId",st.appId);
    localStorage.setItem("mm.markup",String(st.markup));
    if (st.token) localStorage.setItem("mm.token",st.token);
    else localStorage.removeItem("mm.token");
    updateFeeDisplay();
    log(`Settings saved. Platform markup: ${st.markup}%`);
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

  // risk calculator
  el.calcCapital.addEventListener("input", calcMartingale);

  // journal
  el.exportJournal.addEventListener("click", exportCSV);
  el.clearJournal.addEventListener("click",()=>{
    st.journal=[]; localStorage.removeItem("mm.journal"); renderJournal();
  });
}

// ── TICKER RIBBON ────────────────────────────────────────────
const TICKER_EXTRA_SYMS = ["R_10", "1HZ25V", "1HZ50V", "R_100", "1HZ100V"];

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
    if (icon)   icon.textContent    = "🎉";
    if (title)  { title.textContent = "Congratulations! You Won!"; title.className = "ct-title"; }
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
  // Remove empty state
  const empty = feed.querySelector(".btf-empty");
  if (empty) empty.remove();

  const card = document.createElement("div");
  card.className = `btf-card ${won ? "win" : "loss"}`;
  const plSign = won ? "+" : "-";
  card.innerHTML = `
    <div class="btf-badge ${won ? "win" : "loss"}">${won ? "WIN" : "LOSS"}</div>
    <div class="btf-info"><strong>${tradeLabel}</strong>Stake: ${fmt(stake).split(" ")[0]}</div>
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

// ── INIT ──────────────────────────────────────────────────────
async function init() {
  await extractOauthToken();
  initTheme();
  if (st.token) {
    hideLanding();
    connectDeriv();
  } else {
    showLanding();
  }
  el.appIdInput.value = st.appId;
  el.tokenInput.value = st.token;
  el.marketSelect.value = st.symbol;
  updateFeeDisplay();
  updateMarketUi();
  updateModeUi();

  // init digit circles placeholder
  for (let d=0;d<10;d++) {
    const wrap = document.createElement("div");
    wrap.className = "d-circle";
    wrap.innerHTML = `<div class="d-circle-badge">${d}</div><span class="d-pct">0%</span>`;
    el.digitCircles.append(wrap);
  }

  bindEvents();
  renderJournal();
  updateBotFlow();
  startSim();

  fetchCryptoPrices();
  setInterval(fetchCryptoPrices, 60000);

  setTimeout(() => runMarketScan(), 3000);
  setInterval(() => runMarketScan(), 15000);

  log("MoneyMaker Pro loaded. Demo stream active.");
}

init();
