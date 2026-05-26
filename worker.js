// ── ADMIN CRYPTO UTILS ───────────────────────────────────────
async function _hashPw(password, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({name:"PBKDF2",salt:enc.encode(salt),iterations:100000,hash:"SHA-256"}, key, 256);
  return [...new Uint8Array(bits)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function _hashTok(t) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
function _genTok() { return [...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,"0")).join(""); }
function _genId()  { return [...crypto.getRandomValues(new Uint8Array(16))].map(b=>b.toString(16).padStart(2,"0")).join(""); }
function _jsonR(data, status=200) {
  return new Response(JSON.stringify(data), {status, headers:{"Content-Type":"application/json","Access-Control-Allow-Origin":"*"}});
}
async function _auditLog(env, who, action, details, ip) {
  try { await env.DB.prepare("INSERT INTO admin_audit_log (id,admin_id,action,details_json,ip,created_at) VALUES (?,?,?,?,?,?)").bind(_genId(),who||"env",action,details?JSON.stringify(details):null,ip||"",Date.now()).run(); } catch(_e){}
  if (env.DISCORD_ADMIN_AUDIT_LOG_WEBHOOK) {
    const embed = { title:"📋 Admin Action", color:0xa78bfa, fields:[
      { name:"Action",  value:String(action).slice(0,100),                                 inline:true  },
      { name:"By",      value:String(who||"env").slice(0,50),                              inline:true  },
      { name:"IP",      value:String(ip||"—").slice(0,50),                                 inline:true  },
      { name:"Details", value:(details?JSON.stringify(details).slice(0,400):"—"),          inline:false },
    ], footer:{ text:"MoneyMeKa Pro • Audit Log" }, timestamp:new Date().toISOString() };
    fetch(env.DISCORD_ADMIN_AUDIT_LOG_WEBHOOK,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"MoneyMeKa Pro",embeds:[embed]})}).catch(()=>{});
  }
}
async function _sendSecEmail(env, action, requestedBy, ip, token) {
  const to = env.OWNER_SECURITY_EMAIL;
  if (!env.RESEND_API_KEY || !to) return {ok:false,error:"RESEND_API_KEY or OWNER_SECURITY_EMAIL not configured"};
  const labels = {add_admin:"Add Admin",change_password:"Change Password",change_username:"Change Username",disable_admin:"Disable Admin"};
  const label = labels[action]||action;
  const approveUrl = `https://moneymekapro.com/api/admin/verify-action?token=${token}`;
  const html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#f8fafc">
<h2 style="color:#7c3aed;margin:0 0 8px">MoneyMeKa Pro — Admin Security Alert</h2>
<p style="color:#475569;margin:0 0 20px">A sensitive admin action requires your approval before it takes effect.</p>
<table style="width:100%;border-collapse:collapse;margin-bottom:24px;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0">
<tr style="background:#f1f5f9"><td style="padding:10px 16px;color:#64748b;font-size:13px;width:140px">Action</td><td style="padding:10px 16px;font-weight:700;color:#0f172a">${label}</td></tr>
<tr><td style="padding:10px 16px;color:#64748b;font-size:13px">Requested by</td><td style="padding:10px 16px;color:#0f172a">${requestedBy}</td></tr>
<tr style="background:#f1f5f9"><td style="padding:10px 16px;color:#64748b;font-size:13px">IP Address</td><td style="padding:10px 16px;color:#0f172a">${ip}</td></tr>
<tr><td style="padding:10px 16px;color:#64748b;font-size:13px">Time (UTC)</td><td style="padding:10px 16px;color:#0f172a">${new Date().toUTCString()}</td></tr>
<tr style="background:#fff7ed"><td style="padding:10px 16px;color:#92400e;font-size:13px">Expires</td><td style="padding:10px 16px;color:#92400e;font-weight:600">15 minutes from now</td></tr>
</table>
<p style="margin:0 0 20px"><a href="${approveUrl}" style="display:inline-block;background:#7c3aed;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">Approve This Change →</a></p>
<p style="color:#94a3b8;font-size:12px;line-height:1.6">If you did not request this change, ignore this email. The approval link expires in 15 minutes and is single-use only. Never share this link.</p>
</div>`;
  try {
    const r = await fetch("https://api.resend.com/emails", {method:"POST",headers:{"Authorization":`Bearer ${env.RESEND_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({from:env.OWNER_FROM_EMAIL||"MoneyMeKa Pro <onboarding@resend.dev>",to:[to],subject:`[Action Required] ${label} — MoneyMeKa Pro Admin`,html})});
    const d = await r.json(); return r.ok?{ok:true}:{ok:false,error:d?.message||"Email send failed"};
  } catch(e){return{ok:false,error:e.message};}
}
function _verifyHtml(ok, message) {
  const col=ok?"#19c37d":"#ef4444";
  return new Response(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Admin Verification — MoneyMeKa Pro</title><style>body{margin:0;font-family:sans-serif;background:#0a0a14;display:flex;align-items:center;justify-content:center;min-height:100vh;color:#e2e8f0}.c{background:#12121f;border:1px solid ${col}44;border-radius:16px;padding:40px 36px;max-width:440px;text-align:center}h2{color:${col};margin:0 0 12px}p{color:#94a3b8;font-size:14px;line-height:1.6;margin:8px 0}a{color:#a78bfa;font-size:13px}</style></head><body><div class="c"><div style="font-size:48px;margin-bottom:16px">${ok?"✅":"❌"}</div><h2>${ok?"Change Approved":"Verification Failed"}</h2><p>${message}</p><p style="margin-top:20px"><a href="/admin">← Back to Admin</a></p></div></body></html>`,
  {status:ok?200:400,headers:{"Content-Type":"text/html;charset=UTF-8","Cache-Control":"no-store","Pragma":"no-cache"}});
}

async function _discordSignal(env, market, claude, gpt, agreed, source) {
  try { const p = await env.DB.prepare("SELECT value FROM config WHERE key='discord_relay_paused'").first(); if (p?.value === "1") return; } catch(_){}
  const labels = { over123:"DIGIT OVER 3", under876:"DIGIT UNDER 6", odd:"DIGIT ODD", even:"DIGIT EVEN", hitrun:"HIT & RUN" };
  const color = agreed ? 0x19c37d : (gpt?.recommendation && gpt.recommendation !== "none" ? 0xf59e0b : 0x4f8cff);
  const consensus = agreed
    ? "✅ Claude + GPT agree"
    : (gpt?.recommendation && gpt.recommendation !== "none"
      ? `⚠️ GPT says ${(labels[gpt.recommendation]||gpt.recommendation).toUpperCase()}`
      : "🔵 Claude only");
  const sourceLabel = source === "casino" ? "🎰 Casino" : "🤖 Bot";
  const embed = {
    title: `📊 ${labels[claude.recommendation]||claude.recommendation.toUpperCase()} Signal`,
    color,
    fields: [
      { name: "Market",     value: String(market),                     inline: true  },
      { name: "Confidence", value: `${claude.confidence}%`,            inline: true  },
      { name: "Source",     value: sourceLabel,                        inline: true  },
      { name: "Consensus",  value: consensus,                          inline: false },
      { name: "Analysis",   value: (claude.reason||"—").slice(0,1024), inline: false },
    ],
    footer: { text: "MoneyMeKa Pro • Live Signal" },
    timestamp: new Date().toISOString(),
  };
  const payload = JSON.stringify({ username: "MoneyMeKa Pro", embeds: [embed] });
  const targets = [
    env.DISCORD_COMBINED_SIGNALS_WEBHOOK,
    env.DISCORD_AI_SIGNALS_WEBHOOK,
    env.DISCORD_CLAUDE_SIGNALS_WEBHOOK,
    agreed ? env.DISCORD_GPT_SIGNALS_WEBHOOK : null,
    source === "casino" ? env.DISCORD_CASINO_SIGNALS_WEBHOOK : null,
    claude.confidence >= 85 ? env.DISCORD_MARKET_WATCH_WEBHOOK : null,
    (claude.confidence >= 88 && agreed) ? env.DISCORD_VIP_SIGNALS_WEBHOOK : null,
  ].filter(Boolean);
  await Promise.allSettled(targets.map(url =>
    fetch(url, { method:"POST", headers:{"Content-Type":"application/json"}, body:payload }).catch(()=>{})
  ));
}

async function _discordAdminLog(env, market, claude, gpt, agreed, source) {
  const webhook = env.DISCORD_ADMIN_LOG_WEBHOOK;
  if (!webhook) return;
  const labels = { over123:"DIGIT OVER 3", under876:"DIGIT UNDER 6", odd:"DIGIT ODD", even:"DIGIT EVEN", hitrun:"HIT & RUN", none:"NONE" };
  const isSignal = claude.recommendation !== "none" && claude.confidence >= 72;
  const color = isSignal ? (agreed ? 0x19c37d : 0x4f8cff) : 0x374151;
  const embed = {
    title: `🔍 Scan — ${labels[claude.recommendation]||claude.recommendation.toUpperCase()}`,
    color,
    fields: [
      { name:"Market",      value:String(market),                                                    inline:true  },
      { name:"Source",      value:source||"bot",                                                     inline:true  },
      { name:"Claude Conf", value:`${claude.confidence}%`,                                           inline:true  },
      { name:"Claude Rec",  value:labels[claude.recommendation]||claude.recommendation,              inline:true  },
      { name:"GPT Rec",     value:gpt?(labels[gpt.recommendation]||gpt.recommendation):"—",         inline:true  },
      { name:"Agreement",   value:agreed?"✅ Yes":"❌ No",                                           inline:true  },
      { name:"Reason",      value:(claude.reason||"—").slice(0,500),                                 inline:false },
    ],
    footer: { text:`MoneyMeKa Pro • Admin Signal Log • ${isSignal?"RELAYED":"filtered"}` },
    timestamp: new Date().toISOString(),
  };
  await fetch(webhook,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"MoneyMeKa Pro",embeds:[embed]})}).catch(()=>{});
}

async function _discordDisagreement(env, market, claude, gpt, source) {
  const webhook = env.DISCORD_ADMIN_DISAGREEMENTS_WEBHOOK;
  if (!webhook) return;
  const labels = { over123:"DIGIT OVER 3", under876:"DIGIT UNDER 6", odd:"DIGIT ODD", even:"DIGIT EVEN", hitrun:"HIT & RUN", none:"NONE" };
  const embed = {
    title: "⚠️ AI Disagreement",
    color: 0xf59e0b,
    fields: [
      { name:"Market",       value:String(market),                                                                        inline:true  },
      { name:"Source",       value:source||"bot",                                                                         inline:true  },
      { name:"Claude",       value:`${labels[claude.recommendation]||claude.recommendation} (${claude.confidence}%)`,     inline:true  },
      { name:"GPT",          value:`${labels[gpt.recommendation]||gpt.recommendation} (${gpt.confidence||0}%)`,          inline:true  },
      { name:"Claude Reason",value:(claude.reason||"—").slice(0,400),                                                     inline:false },
    ],
    footer: { text:"MoneyMeKa Pro • Signal Disagreements" },
    timestamp: new Date().toISOString(),
  };
  await fetch(webhook,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"MoneyMeKa Pro",embeds:[embed]})}).catch(()=>{});
}

async function _discordError(env, context, err) {
  const webhook = env.DISCORD_ADMIN_ERRORS_WEBHOOK;
  if (!webhook) return;
  const embed = {
    title: "🚨 Worker Error",
    color: 0xef4444,
    fields: [
      { name:"Context", value:String(context).slice(0,256),                    inline:false },
      { name:"Error",   value:String(err?.message||err||"unknown").slice(0,512), inline:false },
    ],
    footer: { text:"MoneyMeKa Pro • Admin Errors" },
    timestamp: new Date().toISOString(),
  };
  await fetch(webhook,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"MoneyMeKa Pro",embeds:[embed]})}).catch(()=>{});
}

async function _discordClientActivity(env, session_id, login_id, is_demo) {
  const webhook = env.DISCORD_ADMIN_CLIENT_ACTIVITY_WEBHOOK;
  if (!webhook) return;
  const acctType = is_demo ? "Demo" : "Real";
  const embed = {
    title: `👤 Client Connected — ${acctType} Account`,
    color: is_demo ? 0xf59e0b : 0x19c37d,
    fields: [
      { name:"Login ID",     value:String(login_id),                    inline:true },
      { name:"Account Type", value:acctType,                            inline:true },
      { name:"Session",      value:String(session_id||"").slice(0,16), inline:true },
    ],
    footer: { text:"MoneyMeKa Pro • Client Activity" },
    timestamp: new Date().toISOString(),
  };
  await fetch(webhook,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"MoneyMeKa Pro",embeds:[embed]})}).catch(()=>{});
}

async function _discordSession(env, type, action, stats) {
  const isBot = type === "bot";
  const webhook = isBot ? env.DISCORD_ADMIN_BOT_SESSIONS_WEBHOOK : env.DISCORD_ADMIN_CASINO_SESSIONS_WEBHOOK;
  if (!webhook) return;
  const typeLabel = isBot ? "Bot" : "Casino";
  const isStart = action === "start";
  const emoji = isBot ? "🤖" : "🎰";
  const fields = [
    { name:"Type",   value:typeLabel,                       inline:true },
    { name:"Action", value:isStart?"▶ Started":"⏹ Stopped", inline:true },
  ];
  if (!isStart && stats) {
    const n = stats.trades ?? stats.spins ?? 0;
    const wr = n > 0 ? Math.round(100*(stats.wins||0)/n) : 0;
    const pl = Number(stats.pl||0).toFixed(2);
    fields.push(
      { name:"Trades",   value:String(n),                          inline:true },
      { name:"Win Rate", value:`${wr}%`,                           inline:true },
      { name:"P/L",      value:`${Number(pl)>=0?"+":""}$${pl}`,   inline:true },
    );
  }
  const embed = {
    title: `${emoji} ${typeLabel} Session ${isStart?"Started":"Ended"}`,
    color: isStart ? 0x19c37d : 0x64748b,
    fields,
    footer: { text:"MoneyMeKa Pro • Session Log" },
    timestamp: new Date().toISOString(),
  };
  await fetch(webhook,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"MoneyMeKa Pro",embeds:[embed]})}).catch(()=>{});
}

async function _discordDailyReport(env) {
  const webhook = env.DISCORD_DAILY_REPORT_WEBHOOK;
  if (!webhook) return;
  try {
    const cutoff = Date.now() - 86400000;
    const [trades, visitors, sigs] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) as n, SUM(won) as wins, ROUND(SUM(profit),2) as pl FROM trades WHERE settled_at>=?").bind(cutoff).first(),
      env.DB.prepare("SELECT COUNT(*) as n FROM visitors WHERE last_seen>=?").bind(cutoff).first(),
      env.DB.prepare("SELECT COUNT(*) as n FROM signal_events WHERE created_at>=?").bind(cutoff).first(),
    ]);
    const n = trades?.n||0, wins = trades?.wins||0, pl = trades?.pl||0;
    const wr = n>0?Math.round(100*wins/n):0;
    const embed = {
      title: "📅 Daily Performance Report",
      color: pl>=0?0x19c37d:0xef4444,
      fields: [
        { name:"Total Trades",       value:String(n),                                      inline:true },
        { name:"Win Rate",           value:`${wr}%`,                                       inline:true },
        { name:"P/L",                value:`${pl>=0?"+":""}$${Number(pl).toFixed(2)}`,     inline:true },
        { name:"Active Sessions",    value:String(visitors?.n||0),                         inline:true },
        { name:"Signals Generated",  value:String(sigs?.n||0),                             inline:true },
      ],
      footer: { text:"MoneyMeKa Pro • Daily Report" },
      timestamp: new Date().toISOString(),
    };
    await fetch(webhook,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"MoneyMeKa Pro",embeds:[embed]})}).catch(()=>{});
  } catch(_) {}
}

async function _discordWeeklyReport(env) {
  const webhook = env.DISCORD_WEEKLY_REPORT_WEBHOOK;
  if (!webhook) return;
  try {
    const cutoff = Date.now() - 7*86400000;
    const [trades, visitors, topMkt, topStrat] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) as n, SUM(won) as wins, ROUND(SUM(profit),2) as pl FROM trades WHERE settled_at>=?").bind(cutoff).first(),
      env.DB.prepare("SELECT COUNT(*) as n FROM visitors WHERE last_seen>=?").bind(cutoff).first(),
      env.DB.prepare("SELECT market, COUNT(*) as n, SUM(won) as wins FROM trades WHERE settled_at>=? GROUP BY market ORDER BY n DESC LIMIT 1").bind(cutoff).first(),
      env.DB.prepare("SELECT COALESCE(signal_rec,strategy) as s, COUNT(*) as n, SUM(won) as wins FROM trades WHERE settled_at>=? AND (signal_rec IS NOT NULL OR strategy IS NOT NULL) GROUP BY s ORDER BY n DESC LIMIT 1").bind(cutoff).first(),
    ]);
    const n = trades?.n||0, wins = trades?.wins||0, pl = trades?.pl||0;
    const wr = n>0?Math.round(100*wins/n):0;
    const topStratWr = topStrat?.n>0?Math.round(100*topStrat.wins/topStrat.n):0;
    const embed = {
      title: "📊 Weekly Performance Report",
      color: pl>=0?0x19c37d:0xef4444,
      fields: [
        { name:"Total Trades",  value:String(n),                                           inline:true },
        { name:"Win Rate",      value:`${wr}%`,                                            inline:true },
        { name:"Total P/L",     value:`${pl>=0?"+":""}$${Number(pl).toFixed(2)}`,          inline:true },
        { name:"Active Users",  value:String(visitors?.n||0),                              inline:true },
        { name:"Top Market",    value:topMkt?`${topMkt.market} (${topMkt.n} trades)`:"—", inline:true },
        { name:"Top Strategy",  value:topStrat?`${topStrat.s} (${topStrat.n} trades, ${topStratWr}% WR)`:"—", inline:true },
      ],
      footer: { text:"MoneyMeKa Pro • Weekly Report" },
      timestamp: new Date().toISOString(),
    };
    await fetch(webhook,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"MoneyMeKa Pro",embeds:[embed]})}).catch(()=>{});
  } catch(_) {}
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    // ── ADMIN LOGIN PAGE ─────────────────────────────────────
    if (path === "/admin" && request.method === "GET") {
      const noCache = { "Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache" };
      const loginHtml = `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>MoneyMeKa Admin Login</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.card{background:#12121f;border:1px solid rgba(124,58,237,.35);border-radius:16px;padding:40px 36px;width:100%;max-width:400px;box-shadow:0 0 40px rgba(124,58,237,.15)}
.logo{display:flex;align-items:center;gap:12px;margin-bottom:28px}
.logo h1{font-size:20px;font-weight:700;color:#e2e8f0}.logo h1 span{color:#19c37d}
.logo p{font-size:12px;color:#64748b;margin-top:2px}
.badge{background:rgba(124,58,237,.2);border:1px solid rgba(124,58,237,.4);border-radius:6px;padding:2px 8px;font-size:10px;color:#a78bfa;font-weight:700;margin-left:6px}
label{display:block;font-size:12px;font-weight:600;color:#94a3b8;margin-bottom:6px;margin-top:16px}
input{width:100%;padding:10px 14px;background:#1e1e30;border:1px solid rgba(124,58,237,.3);border-radius:8px;color:#e2e8f0;font-size:14px;outline:none;transition:.2s}
input:focus{border-color:#7c3aed;box-shadow:0 0 0 3px rgba(124,58,237,.15)}
button{width:100%;margin-top:24px;padding:12px;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer}
button:hover{opacity:.9}
.err{margin-top:14px;padding:10px 14px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.35);border-radius:8px;color:#f87171;font-size:13px;display:none}
</style></head><body>
<div class="card">
  <div class="logo">
    <svg width="32" height="32" viewBox="0 0 48 48" fill="none"><path d="M24 2L43 13V35L24 46L5 35V13Z" fill="#0d0d1a" stroke="#7c3aed" stroke-width="1.5"/><polyline points="10,36 15,30 19,33 24,24 29,20 33,23 38,14" stroke="#19c37d" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="38" cy="14" r="3.5" fill="#19c37d" opacity="0.2"/><circle cx="38" cy="14" r="2.2" fill="#19c37d"/><circle cx="38" cy="14" r="0.9" fill="white" opacity="0.9"/></svg>
    <div><h1>MoneyMeKa <span>Pro</span><span class="badge">ADMIN</span></h1><p>Admin Dashboard — Sign in to continue</p></div>
  </div>
  <label for="u">Username</label>
  <input id="u" type="text" autocomplete="username" placeholder="Admin username"/>
  <label for="p">Password</label>
  <input id="p" type="password" autocomplete="current-password" placeholder="Admin password"/>
  <button id="btn" onclick="login()">Sign in to Admin</button>
  <div class="err" id="err"></div>
</div>
<script>
document.getElementById('p').addEventListener('keydown',e=>{if(e.key==='Enter')login();});
async function login(){
  const btn=document.getElementById('btn'),err=document.getElementById('err');
  btn.textContent='Signing in…';btn.disabled=true;err.style.display='none';
  try{
    const res=await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username:document.getElementById('u').value,password:document.getElementById('p').value})});
    const data=await res.json();
    if(data.token){
      sessionStorage.setItem('mm.adminToken',data.token);
      sessionStorage.setItem('mm.admin','1');
      window.location.href='/admin/dashboard';
    }else{
      err.textContent=data.error||'Login failed';err.style.display='block';
      btn.textContent='Sign in to Admin';btn.disabled=false;
    }
  }catch(e){err.textContent='Network error';err.style.display='block';btn.textContent='Sign in to Admin';btn.disabled=false;}
}
</script></body></html>`;
      return new Response(loginHtml, { status: 200, headers: { "Content-Type": "text/html;charset=UTF-8", ...noCache } });
    }

    // ── ADMIN DASHBOARD ───────────────────────────────────────
    if (path === "/admin/dashboard" && request.method === "GET") {
      const noCache = { "Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache" };
      const dashHtml = `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>MoneyMeKa Admin Dashboard</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0a14;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh}
.topbar{display:flex;align-items:center;justify-content:space-between;padding:14px 28px;background:#12121f;border-bottom:1px solid rgba(124,58,237,.3);position:sticky;top:0;z-index:100}
.brand{display:flex;align-items:center;gap:10px}
.brand h1{font-size:17px;font-weight:700;color:#e2e8f0}.brand h1 span{color:#19c37d}
.brand p{font-size:11px;color:#64748b}
.badge{background:rgba(124,58,237,.2);border:1px solid rgba(124,58,237,.4);border-radius:5px;padding:2px 7px;font-size:10px;color:#a78bfa;font-weight:700;margin-left:6px}
.topbar-actions{display:flex;gap:10px;align-items:center}
.btn{padding:8px 18px;border-radius:8px;border:none;cursor:pointer;font-size:13px;font-weight:600;transition:.15s;text-decoration:none;display:inline-block}
.btn-green{background:linear-gradient(135deg,#19c37d,#0ea66b);color:#000}
.btn-purple{background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff}
.btn-red{background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.4);color:#f87171}
.btn:hover{opacity:.85}
main{padding:24px 28px;max-width:1400px;margin:0 auto}
.stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px}
.stat-card{background:#12121f;border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:20px 22px}
.stat-card.green{border-color:rgba(25,195,125,.3)}
.stat-card.amber{border-color:rgba(245,158,11,.3)}
.stat-card.purple{border-color:rgba(124,58,237,.3)}
.stat-label{font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px}
.stat-value{font-size:34px;font-weight:800}
.stat-card.green .stat-value{color:#19c37d}
.stat-card.amber .stat-value{color:#f59e0b}
.stat-card.purple .stat-value{color:#a78bfa}
.section{background:#12121f;border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:20px 22px;margin-bottom:20px}
.section-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.section-title{font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em}
.refresh{background:none;border:1px solid rgba(255,255,255,.1);color:#64748b;border-radius:6px;padding:3px 10px;font-size:11px;cursor:pointer}
.refresh:hover{color:#a78bfa;border-color:rgba(124,58,237,.4)}
.toggle-row{display:flex;align-items:center;gap:16px;padding:10px 0}
.toggle-label{font-size:14px;font-weight:600;color:#e2e8f0}
.toggle-desc{font-size:12px;color:#64748b;margin-top:3px}
.switch{position:relative;display:inline-block;width:48px;height:26px;flex-shrink:0;cursor:pointer}
.switch input{opacity:0;width:0;height:0;position:absolute}
.slider{position:absolute;inset:0;background:#374151;border-radius:13px;transition:.3s;cursor:pointer}
.slider::before{content:'';position:absolute;width:20px;height:20px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.3s;box-shadow:0 1px 3px rgba(0,0,0,.4)}
input:checked+.slider{background:#7c3aed}
input:checked+.slider::before{transform:translateX(22px)}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;padding:8px 12px;color:#475569;font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid rgba(255,255,255,.06)}
td{padding:9px 12px;border-bottom:1px solid rgba(255,255,255,.04);color:#cbd5e1;vertical-align:middle}
tr:last-child td{border-bottom:none}
tr:hover td{background:rgba(255,255,255,.025)}
.pill{border-radius:4px;padding:2px 7px;font-size:10px;font-weight:700}
.pill-real{background:rgba(25,195,125,.15);color:#19c37d;border:1px solid rgba(25,195,125,.3)}
.pill-demo{background:rgba(245,158,11,.15);color:#f59e0b;border:1px solid rgba(245,158,11,.3)}
.pill-anon{background:rgba(100,116,139,.15);color:#64748b;border:1px solid rgba(100,116,139,.3)}
.pill-win{background:rgba(25,195,125,.15);color:#19c37d}
.pill-loss{background:rgba(239,68,68,.15);color:#ef4444}
.mono{font-family:monospace;font-size:11px}
.empty{color:#475569;text-align:center;padding:20px}
.loading-msg{color:#64748b;text-align:center;padding:40px;font-size:14px}
@media(max-width:900px){.stats-grid{grid-template-columns:repeat(2,1fr)}}
</style></head><body>
<div class="topbar">
  <div class="brand">
    <svg width="26" height="26" viewBox="0 0 48 48" fill="none"><path d="M24 2L43 13V35L24 46L5 35V13Z" fill="#0d0d1a" stroke="#7c3aed" stroke-width="1.5"/><polyline points="10,36 15,30 19,33 24,24 29,20 33,23 38,14" stroke="#19c37d" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="38" cy="14" r="3.5" fill="#19c37d" opacity="0.2"/><circle cx="38" cy="14" r="2.2" fill="#19c37d"/><circle cx="38" cy="14" r="0.9" fill="white" opacity="0.9"/></svg>
    <div><h1>MoneyMeKa <span>Pro</span><span class="badge">ADMIN</span></h1><p>Admin Dashboard</p></div>
  </div>
  <div class="topbar-actions">
    <a href="/?adminReady=1" class="btn btn-green">Open Trading Terminal</a>
    <button class="btn btn-red" onclick="logout()">Logout</button>
  </div>
</div>
<main id="main"><div class="loading-msg" id="loadMsg">Loading dashboard…</div></main>
<script>
const tok=sessionStorage.getItem('mm.adminToken');
if(!tok){window.location.href='/admin';}

function logout(){sessionStorage.removeItem('mm.admin');sessionStorage.removeItem('mm.adminToken');window.location.href='/admin';}

function fmt(ts){if(!ts)return'—';const d=new Date(ts);return d.toLocaleDateString()+' '+d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});}
function ago(ts){if(!ts)return'—';const s=Math.floor((Date.now()-ts)/1000);if(s<60)return s+'s ago';if(s<3600)return Math.floor(s/60)+'m ago';if(s<86400)return Math.floor(s/3600)+'h ago';return Math.floor(s/86400)+'d ago';}
function esc(v){return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;');}

async function load(){
  try{
    const r=await fetch('/api/admin/stats',{headers:{'Authorization':'Bearer '+tok}});
    if(r.status===401){window.location.href='/admin';return;}
    render(await r.json());
  }catch(e){document.getElementById('loadMsg').textContent='Load error: '+e.message;}
}

function render(d){
  const {stats,visitors,trades,config}=d;
  document.getElementById('main').innerHTML=
    '<div class="stats-grid">'+
    sc('Total Visitors','',stats.total_visitors)+
    sc('Real Accounts','green',stats.real_accounts)+
    sc('Demo Accounts','amber',stats.demo_accounts)+
    sc('Trades Today','purple',stats.trades_today)+
    '</div>'+
    '<div class="section">'+
      '<div class="section-head"><div class="section-title">👁 Feature Visibility</div></div>'+
      '<div class="toggle-row">'+
        '<label class="switch"><input type="checkbox" id="sb"'+(config.show_bot==='1'||config.show_bot===undefined?' checked':'')+'><span class="slider"></span></label>'+
        '<div><div class="toggle-label">Show MekaAiBot to clients</div>'+
        '<div class="toggle-desc" id="sbDesc">'+(config.show_bot!=='0'?'ON — Bot tab visible to all users':'OFF — Bot tab hidden from clients')+'</div></div>'+
      '</div>'+
      '<div class="toggle-row">'+
        '<label class="switch"><input type="checkbox" id="san"'+(config.show_analysis==='1'||config.show_analysis===undefined?' checked':'')+'><span class="slider"></span></label>'+
        '<div><div class="toggle-label">Show Analysis Tool to clients</div>'+
        '<div class="toggle-desc" id="sanDesc">'+(config.show_analysis!=='0'?'ON — Analysis tab visible to all users':'OFF — Analysis tab hidden from clients')+'</div></div>'+
      '</div>'+
    '</div>'+
    '<div class="section">'+
      '<div class="section-head"><div class="section-title">🤖 Claude AI Gate</div></div>'+
      '<div class="toggle-row">'+
        '<label class="switch"><input type="checkbox" id="cg"'+(config.claude_gate==='1'?' checked':'')+'><span class="slider"></span></label>'+
        '<div><div class="toggle-label">Block demo users from Claude</div>'+
        '<div class="toggle-desc" id="cgDesc">'+(config.claude_gate==='1'?'ON — Only real Deriv accounts can use Claude':'OFF — All users (including demo) can use Claude')+'</div></div>'+
      '</div>'+
    '</div>'+
    '<div class="section">'+
      '<div class="section-head"><div class="section-title">Recent Sessions / Visitors</div><button class="refresh" onclick="load()">↻ Refresh</button></div>'+
      (visitors.length?visTable(visitors):'<div class="empty">No sessions recorded yet. Visitors appear here after connecting.</div>')+
    '</div>'+
    '<div class="section">'+
      '<div class="section-head"><div class="section-title">Recent Trades</div></div>'+
      (trades.length?tTable(trades):'<div class="empty">No trades yet.</div>')+
    '</div>';

  const _tog=(id,key,onTxt,offTxt,descId)=>{
    const el=document.getElementById(id);
    if(!el)return;
    el.addEventListener('change',async()=>{
      const val=el.checked?'1':'0';
      const desc=document.getElementById(descId);
      if(desc)desc.textContent='Saving…';
      try{
        const r=await fetch('/api/admin/config',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},body:JSON.stringify({key,value:val})});
        const j=await r.json();
        if(j.ok&&desc)desc.textContent=el.checked?onTxt:offTxt;
        else{if(desc)desc.textContent='Save failed';el.checked=!el.checked;}
      }catch(e){if(desc)desc.textContent='Error';el.checked=!el.checked;}
    });
  };
  _tog('sb','show_bot','ON — Bot tab visible to all users','OFF — Bot tab hidden from clients','sbDesc');
  _tog('san','show_analysis','ON — Analysis tab visible to all users','OFF — Analysis tab hidden from clients','sanDesc');
  const cg=document.getElementById('cg');
  if(cg)cg.addEventListener('change',async()=>{
    const val=cg.checked?'1':'0';
    const desc=document.getElementById('cgDesc');
    if(desc)desc.textContent='Saving…';
    try{
      const r=await fetch('/api/admin/config',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},body:JSON.stringify({key:'claude_gate',value:val})});
      const j=await r.json();
      if(j.ok&&desc)desc.textContent=val==='1'?'ON — Only real Deriv accounts can use Claude':'OFF — All users (including demo) can use Claude';
      else{if(desc)desc.textContent='Save failed';cg.checked=!cg.checked;}
    }catch(e){if(desc)desc.textContent='Error';cg.checked=!cg.checked;}
  });
}

function sc(label,cls,val){return'<div class="stat-card '+cls+'"><div class="stat-label">'+label+'</div><div class="stat-value">'+val+'</div></div>';}

function visTable(rows){
  return'<table><thead><tr><th>Session</th><th>Deriv Login</th><th>Account Type</th><th>First Seen</th><th>Last Active</th></tr></thead><tbody>'+
  rows.map(r=>'<tr>'+
    '<td class="mono">'+esc(r.session_id).slice(0,14)+'…</td>'+
    '<td>'+(r.login_id?esc(r.login_id):'<span style="color:#475569">—</span>')+'</td>'+
    '<td>'+(r.login_id?(r.is_demo?'<span class="pill pill-demo">Demo</span>':'<span class="pill pill-real">Real</span>'):'<span class="pill pill-anon">Not linked</span>')+'</td>'+
    '<td>'+fmt(r.first_seen)+'</td>'+
    '<td>'+ago(r.last_seen)+'</td>'+
  '</tr>').join('')+'</tbody></table>';
}

function tTable(rows){
  return'<table><thead><tr><th>Source</th><th>Market</th><th>Contract</th><th>Stake</th><th>P/L</th><th>Result</th><th>Time</th></tr></thead><tbody>'+
  rows.map(r=>'<tr>'+
    '<td><span class="pill '+(r.source==='casino'?'pill-demo':'pill-real')+'">'+esc(r.source)+'</span></td>'+
    '<td>'+esc(r.market)+'</td>'+
    '<td>'+esc(r.contract)+(r.barrier?' ('+esc(r.barrier)+')':'')+'</td>'+
    '<td>$'+Number(r.stake).toFixed(2)+'</td>'+
    '<td style="color:'+(r.profit>=0?'#19c37d':'#ef4444');font-weight:700">'+(r.profit>=0?'+':'')+Number(r.profit).toFixed(2)+'</td>'+
    '<td><span class="pill '+(r.won?'pill-win':'pill-loss')+'">'+(r.won?'Win':'Loss')+'</span></td>'+
    '<td>'+ago(r.settled_at)+'</td>'+
  '</tr>').join('')+'</tbody></table>';
}

load();
setInterval(load,30000);
</script></body></html>`;
      return new Response(dashHtml, { status: 200, headers: { "Content-Type": "text/html;charset=UTF-8", ...noCache } });
    }

    if (url.pathname === "/api/admin/login" && request.method === "POST") {
      try {
        const { username, password } = await request.json();
        const ip = request.headers.get("CF-Connecting-IP") || "unknown";
        let loginOk = false, adminId = "env";
        // Check D1 admin_users first
        try {
          const user = await env.DB.prepare("SELECT * FROM admin_users WHERE username=? AND status='active'").bind(username).first();
          if (user) {
            const hash = await _hashPw(password, user.password_salt);
            if (hash === user.password_hash) {
              loginOk = true; adminId = user.id;
              await env.DB.prepare("UPDATE admin_users SET last_login_at=? WHERE id=?").bind(Date.now(), user.id).run();
            }
          }
        } catch(_e) {}
        // Fallback to env credentials
        if (!loginOk && username === env.ADMIN_USERNAME && password === env.ADMIN_PASSWORD) { loginOk = true; }
        if (loginOk) {
          await _auditLog(env, adminId, "login", {username}, ip);
          return new Response(JSON.stringify({ ok: true, token: env.ADMIN_KEY, username }), {
            status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        }
        return new Response(JSON.stringify({ error: "Invalid username or password" }), {
          status: 401, headers: { "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500, headers: { "Content-Type": "application/json" }
        });
      }
    }

    // Explicit SPA handler for /callback — Ory redirects here with ?code=&state=
    // We must serve index.html at this URL so the JS can read window.location.search
    if (url.pathname === "/callback") {
      const rootReq = new Request(new URL("/", request.url).toString(), {
        headers: request.headers,
        cf: request.cf
      });
      const resp = await env.ASSETS.fetch(rootReq);
      return new Response(resp.body, {
        status: 200,
        headers: resp.headers
      });
    }

    if (url.pathname === "/api/token-exchange" && request.method === "POST") {
      try {
        const { code, code_verifier, redirect_uri } = await request.json();
        const response = await fetch("https://auth.deriv.com/oauth2/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: "33jYDBwLAZ4xeAL6eYmkP",
            code,
            code_verifier,
            redirect_uri
          }).toString()
        });
        const data = await response.json();
        return new Response(JSON.stringify(data), {
          status: response.status,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    // ── DERIV OPTIONS API PROXY ───────────────────────────────
    // Proxied server-side to avoid CORS restrictions on api.derivws.com
    if (url.pathname === "/api/deriv-options/accounts" && request.method === "GET") {
      try {
        const auth = request.headers.get("Authorization");
        if (!auth) return new Response(JSON.stringify({ error: "No Authorization header" }), { status: 401, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
        const resp = await fetch("https://api.derivws.com/trading/v1/options/accounts", {
          headers: { "Authorization": auth, "Deriv-App-ID": "33jYDBwLAZ4xeAL6eYmkP", "Content-Type": "application/json" }
        });
        const body = await resp.text();
        return new Response(body, { status: resp.status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      }
    }

    if (url.pathname === "/api/deriv-options/otp" && request.method === "POST") {
      try {
        const auth = request.headers.get("Authorization");
        const { account_id } = await request.json();
        if (!auth || !account_id) return new Response(JSON.stringify({ error: "Missing Authorization or account_id" }), { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
        const resp = await fetch(`https://api.derivws.com/trading/v1/options/accounts/${account_id}/otp`, {
          method: "POST",
          headers: { "Authorization": auth, "Deriv-App-ID": "33jYDBwLAZ4xeAL6eYmkP", "Content-Type": "application/json" }
        });
        const body = await resp.text();
        return new Response(body, { status: resp.status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      }
    }

    if (url.pathname === "/api/deriv-options/migration-status" && request.method === "GET") {
      try {
        const auth = request.headers.get("Authorization");
        if (!auth) return new Response(JSON.stringify({ error: "No Authorization header" }), { status: 401, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
        const resp = await fetch("https://api.derivws.com/trading/v1/options/legacy/migration-status", {
          headers: { "Authorization": auth, "Deriv-App-ID": "33jYDBwLAZ4xeAL6eYmkP", "Content-Type": "application/json" }
        });
        const body = await resp.text();
        return new Response(body, { status: resp.status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      }
    }

    if (url.pathname === "/api/ai-scan" && request.method === "POST") {
      try {
        const { market, ticks, source } = await request.json();
        if (!ticks || ticks.length < 100) {
          return new Response(JSON.stringify({ recommendation: "none", confidence: 0, reason: "Not enough ticks" }), {
            status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        }
        const counts = new Array(10).fill(0);
        const digits = ticks.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 9);
        if (digits.length < 100) {
          return new Response(JSON.stringify({ recommendation: "none", confidence: 0, reason: "Not enough valid digit ticks" }), {
            status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
          });
        }

        // KV cache check — serve cached signal instantly if < 3s old
        const _cacheKey = `signal:${market}`;
        if (env.SIGNAL_CACHE) {
          try {
            const _cached = await env.SIGNAL_CACHE.get(_cacheKey, { type: "json" });
            if (_cached) {
              return new Response(JSON.stringify(_cached), {
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "X-Signal-Cache": "HIT" }
              });
            }
          } catch (_) {}
        }

        for (const d of digits) counts[d]++;
        const total = digits.length;
        const pcts = counts.map(c => (c / total * 100).toFixed(1));
        const oddPct    = (([1,3,5,7,9].reduce((s,d) => s + counts[d], 0) / total) * 100).toFixed(1);
        const evenPct   = (([0,2,4,6,8].reduce((s,d) => s + counts[d], 0) / total) * 100).toFixed(1);
        const over4Pct  = (([4,5,6,7,8,9].reduce((s,d) => s + counts[d], 0) / total) * 100).toFixed(1);
        const under5Pct = (([0,1,2,3,4,5].reduce((s,d) => s + counts[d], 0) / total) * 100).toFixed(1);
        const maxDig = counts.indexOf(Math.max(...counts));
        const maxPct = pcts[maxDig];
        const oddDigitBreakdown  = [1,3,5,7,9].map(d => `${d}:${pcts[d]}%`).join(", ");
        const evenDigitBreakdown = [0,2,4,6,8].map(d => `${d}:${pcts[d]}%`).join(", ");
        const oddDominantCount  = [1,3,5,7,9].filter(d => counts[d]/total*100 > 10.5).length;
        const evenDominantCount = [0,2,4,6,8].filter(d => counts[d]/total*100 > 10.5).length;

        // Fetch historical win rates + recent streak from D1 for this market
        let histContext = "No historical data yet for this market.";
        let streakContext = "";
        try {
          const cutoff30d = Date.now() - 30 * 86400000;
          const cutoff24h  = Date.now() -      86400000;
          const [histRows, recentRows] = await Promise.all([
            env.DB.prepare(
              `SELECT COALESCE(signal_rec, strategy) AS strat,
                      COUNT(*) AS n,
                      ROUND(100.0 * SUM(won) / COUNT(*), 1) AS win_rate,
                      ROUND(SUM(profit), 2) AS pl
               FROM trades
               WHERE market = ? AND settled_at >= ?
                 AND (signal_rec IS NOT NULL OR strategy IS NOT NULL)
               GROUP BY strat ORDER BY n DESC LIMIT 8`
            ).bind(market, cutoff30d).all(),
            env.DB.prepare(
              `SELECT COALESCE(signal_rec, strategy) AS strat, won, settled_at
               FROM trades
               WHERE market = ? AND settled_at >= ?
                 AND (signal_rec IS NOT NULL OR strategy IS NOT NULL)
               ORDER BY settled_at DESC LIMIT 30`
            ).bind(market, cutoff24h).all(),
          ]);

          const histData = histRows?.results || [];
          if (histData.length > 0) {
            const lines = histData.map(r =>
              `  ${r.strat}: ${r.win_rate}% win rate over ${r.n} trades (P/L $${r.pl})`
            ).join("\n");
            histContext = `Historical performance on ${market} (last 30 days):\n${lines}`;
          }

          // Compute per-strategy streak from recent 24h trades
          const recent = recentRows?.results || [];
          if (recent.length > 0) {
            const byStrat = {};
            for (const r of recent) {
              if (!byStrat[r.strat]) byStrat[r.strat] = [];
              byStrat[r.strat].push(r.won);
            }
            const streakLines = [];
            for (const [strat, results] of Object.entries(byStrat)) {
              if (results.length < 2) continue;
              let streak = 1, dir = results[0];
              for (let i = 1; i < results.length; i++) {
                if (results[i] === dir) streak++; else break;
              }
              const label = dir ? `${streak}-WIN streak` : `${streak}-LOSS streak`;
              streakLines.push(`  ${strat}: ${label} (last ${results.length} trades today)`);
            }
            if (streakLines.length > 0) {
              streakContext = `\nRecent momentum (last 24h on ${market}):\n${streakLines.join("\n")}`;
            }
          }
        } catch (_) {}

        const prompt = `You are analyzing Deriv synthetic index last-digit tick data for market: ${market}.
Last ${total} ticks digit distribution:
${counts.map((c,d) => `Digit ${d}: ${c} (${pcts[d]}%)`).join(" | ")}

STEP 1 — Evaluate each strategy independently using the data below. Do NOT skip any strategy.

ODD/EVEN analysis (HIGHEST PAYOUT — prioritize these when confidence is tied):
- Odd digits (1,3,5,7,9): ${oddPct}% — breakdown: ${oddDigitBreakdown}
  → ${oddDominantCount} of 5 odd digits individually exceed 10.5% (≥2 indicates genuine odd bias)
- Even digits (0,2,4,6,8): ${evenPct}% — breakdown: ${evenDigitBreakdown}
  → ${evenDominantCount} of 5 even digits individually exceed 10.5% (≥2 indicates genuine even bias)
- Trigger threshold: odd% or even% ≥ 52% qualifies as a valid signal

OVER/UNDER analysis:
- Digits 4-9 (Over 1/2/3): ${over4Pct}% — trigger if >65%
- Digits 0-5 (Under 8/7/6): ${under5Pct}% — trigger if >65%

HIT & RUN analysis:
- Most frequent digit: ${maxDig} at ${maxPct}% — trigger only if >17% AND no other signal qualifies

${histContext}${streakContext}

STEP 2 — Signal quality adjustments:
- Historical ≥60% win rate with ≥10 trades AND tick bias aligns → +10-15 confidence
- Historical <45% win rate with ≥10 trades → -10-15 confidence regardless of bias
- 3+ WIN streak AND bias aligns → +5-8 confidence
- 3+ LOSS streak → -10-15 confidence; 5+ LOSS streak → prefer "none" for that strategy
- No history or <10 trades → rely on tick bias alone

STEP 3 — Pick ONE best strategy using this priority order when confidence scores are within 5 points:
  odd/even  >  over123/under876  >  hitrun
(Odd and Even have the highest payouts on Deriv; prefer them when the edge is comparable)

Reply with JSON only:
{"recommendation":"over123"|"under876"|"odd"|"even"|"hitrun"|"none","confidence":0-100,"reason":"one concise sentence"}`;

        // Check if fine-tuned model is active
        const [oaiModelRow, oaiEnabledRow] = await Promise.all([
          env.DB.prepare("SELECT value FROM config WHERE key='openai_finetune_model'").first().catch(()=>null),
          env.DB.prepare("SELECT value FROM config WHERE key='openai_scan_enabled'").first().catch(()=>null),
        ]);
        const oaiModel = oaiModelRow?.value || null;
        const oaiEnabled = oaiEnabledRow?.value === "1";

        // Fine-tuned model path: use exclusively when ready
        if (oaiEnabled && oaiModel && env.OPENAI_API_KEY) {
          const oaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: oaiModel, max_tokens: 150,
              messages: [
                { role: "system", content: "You are a Deriv digit trading signal evaluator for MoneyMaker Pro. Reply with JSON only: {\"recommendation\":\"over123\"|\"under876\"|\"odd\"|\"even\"|\"hitrun\"|\"none\",\"confidence\":0-100,\"reason\":\"one sentence\"}" },
                { role: "user", content: prompt }
              ]
            })
          });
          const oaiData = await oaiRes.json();
          const oaiText = oaiData.choices?.[0]?.message?.content || "";
          const oaiMatch = oaiText.match(/\{[\s\S]*\}/);
          const result = oaiMatch ? JSON.parse(oaiMatch[0]) : { recommendation: "none", confidence: 0, reason: "OpenAI parse error" };
          if (env.SIGNAL_CACHE && result.recommendation !== "none") {
            ctx.waitUntil(env.SIGNAL_CACHE.put(_cacheKey, JSON.stringify(result), { expirationTtl: 30 }));
          }
          return new Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
        }

        // Dual scan: Claude + GPT-4o-mini in parallel
        const gptSysMsg = "You are a Deriv digit trading signal evaluator. Reply with JSON only: {\"recommendation\":\"over123\"|\"under876\"|\"odd\"|\"even\"|\"hitrun\"|\"none\",\"confidence\":0-100,\"reason\":\"one sentence\"}";
        const [claudeRes, gptResRaw] = await Promise.all([
          fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": env.CLAUDE_API_KEY, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 150, messages: [{ role: "user", content: prompt }] })
          }),
          env.OPENAI_API_KEY ? fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model: "gpt-4o-mini", max_tokens: 150, messages: [{ role: "system", content: gptSysMsg }, { role: "user", content: prompt }] })
          }) : Promise.resolve(null),
        ]);

        const claudeData = await claudeRes.json();
        const _claudeOk = claudeRes.ok && claudeData.content?.[0]?.text;
        const claudeText = _claudeOk ? claudeData.content[0].text : "";
        const claudeMatch = claudeText.match(/\{[\s\S]*\}/);
        let claudeResult = claudeMatch ? JSON.parse(claudeMatch[0]) : null;
        const _claudeFailed = !claudeResult;
        if (!claudeResult) {
          const _errMsg = claudeData.error?.message || (!claudeRes.ok ? `HTTP ${claudeRes.status}` : "Parse error");
          claudeResult = { recommendation: "none", confidence: 0, reason: _errMsg };
        }

        let gptResult = null;
        if (gptResRaw) {
          try {
            const gptData = await gptResRaw.json();
            const gptText = gptData.choices?.[0]?.message?.content || "";
            const gptMatch = gptText.match(/\{[\s\S]*\}/);
            if (gptMatch) gptResult = JSON.parse(gptMatch[0]);
          } catch(_) {}
        }

        let result;
        // Claude unavailable/depleted but GPT succeeded — promote GPT as primary signal
        if (_claudeFailed && gptResult && gptResult.recommendation !== "none") {
          result = {
            recommendation: gptResult.recommendation,
            confidence: gptResult.confidence,
            reason: `[GPT only] ${gptResult.reason}`,
            gpt_rec: gptResult.recommendation,
            gpt_conf: gptResult.confidence,
            gpt_reason: gptResult.reason,
            agreed: false,
          };
          if (gptResult.confidence >= 72) {
            ctx.waitUntil(_discordSignal(env, market, result, null, false, source));
          }
        } else {
          const agreed = !!(gptResult && claudeResult.recommendation !== "none" && gptResult.recommendation !== "none" && claudeResult.recommendation === gptResult.recommendation);
          await _discordAdminLog(env, market, claudeResult, gptResult, agreed, source);
          if (gptResult && claudeResult.recommendation !== "none" && gptResult.recommendation !== "none" && claudeResult.recommendation !== gptResult.recommendation) {
            ctx.waitUntil(_discordDisagreement(env, market, claudeResult, gptResult, source));
          }
          if (claudeResult.recommendation !== "none" && claudeResult.confidence >= 72) {
            ctx.waitUntil(_discordSignal(env, market, claudeResult, gptResult, agreed, source));
          }
          result = {
            ...claudeResult,
            gpt_rec: gptResult?.recommendation || null,
            gpt_conf: gptResult?.confidence || null,
            gpt_reason: gptResult?.reason || null,
            agreed,
          };
        }
        if (env.SIGNAL_CACHE && result.recommendation !== "none") {
          ctx.waitUntil(env.SIGNAL_CACHE.put(_cacheKey, JSON.stringify(result), { expirationTtl: 30 }));
        }
        return new Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      } catch (err) {
        ctx.waitUntil(_discordError(env, "ai-scan", err));
        return new Response(JSON.stringify({ recommendation: "none", confidence: 0, reason: err.message }), {
          status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    // ── VISITOR TRACKING ─────────────────────────────────────
    if (url.pathname === "/api/visitor" && request.method === "POST") {
      try {
        const { session_id, login_id, is_demo } = await request.json();
        if (!session_id) return new Response(JSON.stringify({ ok: false }), { status: 400, headers: { "Content-Type": "application/json" } });
        const now = Date.now();
        if (login_id) {
          const existing = await env.DB.prepare("SELECT login_id FROM visitors WHERE session_id=?").bind(session_id).first();
          if (!existing?.login_id) ctx.waitUntil(_discordClientActivity(env, session_id, login_id, is_demo));
        }
        await env.DB.prepare(
          `INSERT INTO visitors (session_id, login_id, is_demo, first_seen, last_seen) VALUES (?,?,?,?,?)
           ON CONFLICT(session_id) DO UPDATE SET
             login_id = CASE WHEN excluded.login_id IS NOT NULL THEN excluded.login_id ELSE visitors.login_id END,
             is_demo  = CASE WHEN excluded.login_id IS NOT NULL THEN excluded.is_demo  ELSE visitors.is_demo  END,
             last_seen = excluded.last_seen`
        ).bind(session_id, login_id || null, is_demo ? 1 : 0, now, now).run();
        return new Response(JSON.stringify({ ok: true }), {
          status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    // ── ADMIN STATS ───────────────────────────────────────────
    if (url.pathname === "/api/admin/stats" && request.method === "GET") {
      const auth = request.headers.get("Authorization") || "";
      if (auth !== `Bearer ${env.ADMIN_KEY}`) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { "Content-Type": "application/json" }
        });
      }
      try {
        const todayStart = new Date(); todayStart.setHours(0,0,0,0);
        const AT_DEFS = { claude_gate:"1", show_auto_trade_to_clients:"0", require_ai_claude_agreement:"1", min_ai_confidence:"60", min_claude_confidence:"60", min_historical_win_rate:"55", min_historical_sample:"10", allow_live_execution:"0", allow_paper_execution:"1", show_bot:"1", show_analysis:"1" };
        const [total, real, demo, tradesToday, visitors, trades, cfgRows, sigBySource, sigByRec, sigByConf] = await Promise.all([
          env.DB.prepare("SELECT COUNT(*) as n FROM visitors").first(),
          env.DB.prepare("SELECT COUNT(*) as n FROM visitors WHERE login_id IS NOT NULL AND is_demo=0").first(),
          env.DB.prepare("SELECT COUNT(*) as n FROM visitors WHERE login_id IS NOT NULL AND is_demo=1").first(),
          env.DB.prepare("SELECT COUNT(*) as n FROM trades WHERE settled_at>=?").bind(todayStart.getTime()).first(),
          env.DB.prepare("SELECT * FROM visitors ORDER BY last_seen DESC LIMIT 25").all(),
          env.DB.prepare("SELECT * FROM trades ORDER BY settled_at DESC LIMIT 25").all(),
          env.DB.prepare("SELECT key,value FROM config WHERE key IN ('claude_gate','casino_type','show_auto_trade_to_clients','require_ai_claude_agreement','min_ai_confidence','min_claude_confidence','min_historical_win_rate','min_historical_sample','allow_live_execution','allow_paper_execution')").all(),
          env.DB.prepare("SELECT signal_source, COUNT(*) as total, SUM(won) as wins FROM trades WHERE signal_source IS NOT NULL GROUP BY signal_source ORDER BY total DESC").all(),
          env.DB.prepare("SELECT signal_rec, COUNT(*) as total, SUM(won) as wins FROM trades WHERE signal_rec IS NOT NULL GROUP BY signal_rec ORDER BY total DESC LIMIT 10").all(),
          env.DB.prepare(`SELECT CASE WHEN signal_conf>=90 THEN '90-100%' WHEN signal_conf>=80 THEN '80-89%' WHEN signal_conf>=70 THEN '70-79%' WHEN signal_conf>=60 THEN '60-69%' ELSE '<60%' END as bucket, COUNT(*) as total, SUM(won) as wins FROM trades WHERE signal_conf IS NOT NULL GROUP BY bucket ORDER BY MIN(signal_conf) DESC`).all(),
        ]);
        const cfg = {};
        (cfgRows?.results||[]).forEach(r => { cfg[r.key] = r.value; });
        Object.keys(AT_DEFS).forEach(k => { if (!(k in cfg)) cfg[k] = AT_DEFS[k]; });
        return new Response(JSON.stringify({
          stats: { total_visitors: total?.n||0, real_accounts: real?.n||0, demo_accounts: demo?.n||0, trades_today: tradesToday?.n||0 },
          visitors: visitors?.results||[],
          trades: trades?.results||[],
          config: cfg,
          signal_accuracy: {
            by_source: sigBySource?.results||[],
            by_rec:    sigByRec?.results||[],
            by_conf:   sigByConf?.results||[]
          }
        }), { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500, headers: { "Content-Type": "application/json" }
        });
      }
    }

    // ── CONFIG ───────────────────────────────────────────────
    if (url.pathname === "/api/config" && request.method === "GET") {
      const AT_DEFAULTS = {
        claude_gate: "1",
        show_auto_trade_to_clients: "0",
        require_ai_claude_agreement: "1",
        min_ai_confidence: "60",
        min_claude_confidence: "60",
        min_historical_win_rate: "55",
        min_historical_sample: "10",
        allow_live_execution: "0",
        allow_paper_execution: "1",
        openai_scan_enabled: "0",
        openai_finetune_model: "",
        openai_finetune_job_id: "",
        show_bot: "1",
        show_analysis: "1",
      };
      try {
        const keys = Object.keys(AT_DEFAULTS);
        const rows = await Promise.all(keys.map(k => env.DB.prepare("SELECT value FROM config WHERE key=?").bind(k).first()));
        const cfg = {};
        keys.forEach((k, i) => { cfg[k] = rows[i]?.value ?? AT_DEFAULTS[k]; });
        return new Response(JSON.stringify(cfg), { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      } catch (err) {
        return new Response(JSON.stringify({ claude_gate: "1", show_auto_trade_to_clients: "0", require_ai_claude_agreement: "1", min_ai_confidence: "60", min_claude_confidence: "60", min_historical_win_rate: "55", min_historical_sample: "10", allow_live_execution: "0", allow_paper_execution: "1", show_bot: "1", show_analysis: "1" }), {
          status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    if (url.pathname === "/api/admin/config" && request.method === "POST") {
      const auth = request.headers.get("Authorization") || "";
      if (auth !== `Bearer ${env.ADMIN_KEY}`) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { "Content-Type": "application/json" }
        });
      }
      try {
        const { key, value } = await request.json();
        await env.DB.prepare("INSERT OR REPLACE INTO config (key,value) VALUES (?,?)").bind(key, String(value)).run();
        return new Response(JSON.stringify({ ok: true }), {
          status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500, headers: { "Content-Type": "application/json" }
        });
      }
    }

    // ── D1 TRADE HISTORY ─────────────────────────────────────
    if (url.pathname === "/api/trade" && request.method === "POST") {
      try {
        const t = await request.json();
        const _src  = t.source==="casino_paper"?"casino":t.source==="bot_paper"?"bot":(t.source||"bot");
        const _mode = t.mode || (String(t.source||"").includes("paper") ? "paper" : null);
        // Normalize contract name so short labels ("Over","Odd") and DIGIT* names group together
        const _ctNorm = (c) => ({Even:"DIGITEVEN",Odd:"DIGITODD",Over:"DIGITOVER",Under:"DIGITUNDER",
          Matches:"DIGITMATCH",Differs:"DIGITDIFF",Rise:"CALL",Fall:"PUT"}[c]||c);
        const writePromise = env.DB.prepare(
          `INSERT OR IGNORE INTO trades (trade_id,session_id,login_id,source,market,market_name,contract,barrier,stake,profit,won,exit_digit,strategy,signal_source,signal_conf,signal_rec,mode,opened_at,settled_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).bind(t.trade_id||null, t.session_id, t.login_id||null, _src, t.market, t.market_name||null,
               _ctNorm(t.contract), t.barrier||null, t.stake, t.profit, t.won?1:0,
               t.exit_digit||null, t.strategy||null,
               t.signal_source||null, t.signal_conf!=null?Number(t.signal_conf):null, t.signal_rec||null,
               _mode, t.opened_at, t.settled_at).run();
        ctx.waitUntil(writePromise);
        return _jsonR({ ok: true });
      } catch (err) { return _jsonR({ error: err.message }, 500); }
    }

    if (url.pathname === "/api/signal-event" && request.method === "POST") {
      try {
        const e = await request.json();
        await env.DB.prepare(
          `INSERT INTO signal_events (session_id,market,signal_source,strategy,contract,barrier,confidence,reason,traded,trade_id,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`
        ).bind(e.session_id, e.market, e.signal_source||"none", e.strategy||null, e.contract||null,
               e.barrier||null, e.confidence!=null?Number(e.confidence):null, e.reason||null,
               e.traded?1:0, e.trade_id||null, e.created_at||Date.now()).run();
        return _jsonR({ ok: true });
      } catch(err) { return _jsonR({ error: err.message }, 500); }
    }

    if (url.pathname === "/api/trades" && request.method === "GET") {
      try {
        const sid = url.searchParams.get("session_id");
        const lid = url.searchParams.get("login_id");
        const limit = Math.min(Number(url.searchParams.get("limit") || 200), 500);
        const result = lid
          ? await env.DB.prepare("SELECT * FROM trades WHERE login_id=? ORDER BY settled_at DESC LIMIT ?").bind(lid, limit).all()
          : sid
          ? await env.DB.prepare("SELECT * FROM trades WHERE session_id=? ORDER BY settled_at DESC LIMIT ?").bind(sid, limit).all()
          : await env.DB.prepare("SELECT * FROM trades ORDER BY settled_at DESC LIMIT ?").bind(limit).all();
        return new Response(JSON.stringify(result.results), {
          status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    if (url.pathname === "/api/sessions" && request.method === "GET") {
      try {
        const result = await env.DB.prepare(
          `SELECT session_id, source, COUNT(*) as trades, SUM(won) as wins,
                  ROUND(SUM(profit),2) as pl, MIN(opened_at) as started_at, MAX(settled_at) as ended_at
           FROM trades GROUP BY session_id ORDER BY MAX(settled_at) DESC LIMIT 50`
        ).all();
        return new Response(JSON.stringify(result.results), {
          status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    // ── ADMIN USER MANAGEMENT ─────────────────────────────────
    if (url.pathname === "/api/admin/users" && request.method === "GET") {
      if ((request.headers.get("Authorization")||"") !== `Bearer ${env.ADMIN_KEY}`) return _jsonR({error:"Unauthorized"},401);
      try {
        const r = await env.DB.prepare("SELECT id,username,email,role,status,created_at,last_login_at FROM admin_users ORDER BY created_at ASC").all();
        return _jsonR(r.results||[]);
      } catch(e){return _jsonR({error:e.message},500);}
    }

    if (url.pathname === "/api/admin/users/add" && request.method === "POST") {
      if ((request.headers.get("Authorization")||"") !== `Bearer ${env.ADMIN_KEY}`) return _jsonR({error:"Unauthorized"},401);
      const ip = request.headers.get("CF-Connecting-IP")||"unknown";
      try {
        const {username,email,password,requested_by} = await request.json();
        if (!username||!email||!password) return _jsonR({error:"username, email, password required"},400);
        const existing = await env.DB.prepare("SELECT id FROM admin_users WHERE username=?").bind(username).first();
        if (existing) return _jsonR({error:"Username already exists"},409);
        const salt=_genId(), hash=await _hashPw(password,salt);
        const token=_genTok(), tokenHash=await _hashTok(token), actionId=_genId();
        await env.DB.prepare("INSERT INTO pending_admin_actions (id,action_type,requested_by,payload_json,token_hash,expires_at,created_at) VALUES (?,?,?,?,?,?,?)").bind(actionId,"add_admin",requested_by||"unknown",JSON.stringify({username,email,password_hash:hash,password_salt:salt,role:"admin"}),tokenHash,Date.now()+15*60*1000,Date.now()).run();
        const em=await _sendSecEmail(env,"add_admin",requested_by||"unknown",ip,token);
        if(!em.ok) return _jsonR({error:"Action queued but email failed: "+em.error},500);
        return _jsonR({ok:true,message:"Verification email sent. Click the link in your email to approve."});
      } catch(e){return _jsonR({error:e.message},500);}
    }

    if (url.pathname === "/api/admin/users/change-password" && request.method === "POST") {
      if ((request.headers.get("Authorization")||"") !== `Bearer ${env.ADMIN_KEY}`) return _jsonR({error:"Unauthorized"},401);
      const ip = request.headers.get("CF-Connecting-IP")||"unknown";
      try {
        const {username,current_password,new_password,requested_by} = await request.json();
        if (!username||!current_password||!new_password) return _jsonR({error:"username, current_password, new_password required"},400);
        let verified=false, userId=null;
        const user=await env.DB.prepare("SELECT * FROM admin_users WHERE username=? AND status='active'").bind(username).first();
        if(user){const h=await _hashPw(current_password,user.password_salt);if(h===user.password_hash){verified=true;userId=user.id;}}
        if(!verified&&username===env.ADMIN_USERNAME&&current_password===env.ADMIN_PASSWORD){verified=true;userId="env";}
        if(!verified) return _jsonR({error:"Current password is incorrect"},401);
        const salt=_genId(), hash=await _hashPw(new_password,salt);
        const token=_genTok(), tokenHash=await _hashTok(token), actionId=_genId();
        await env.DB.prepare("INSERT INTO pending_admin_actions (id,action_type,requested_by,payload_json,token_hash,expires_at,created_at) VALUES (?,?,?,?,?,?,?)").bind(actionId,"change_password",requested_by||username,JSON.stringify({username,user_id:userId,password_hash:hash,password_salt:salt}),tokenHash,Date.now()+15*60*1000,Date.now()).run();
        const em=await _sendSecEmail(env,"change_password",requested_by||username,ip,token);
        if(!em.ok) return _jsonR({error:"Action queued but email failed: "+em.error},500);
        return _jsonR({ok:true,message:"Verification email sent. Click the link in your email to approve."});
      } catch(e){return _jsonR({error:e.message},500);}
    }

    if (url.pathname === "/api/admin/users/change-username" && request.method === "POST") {
      if ((request.headers.get("Authorization")||"") !== `Bearer ${env.ADMIN_KEY}`) return _jsonR({error:"Unauthorized"},401);
      const ip = request.headers.get("CF-Connecting-IP")||"unknown";
      try {
        const {username,current_password,new_username,requested_by} = await request.json();
        if (!username||!current_password||!new_username) return _jsonR({error:"username, current_password, new_username required"},400);
        let verified=false, userId=null;
        const user=await env.DB.prepare("SELECT * FROM admin_users WHERE username=? AND status='active'").bind(username).first();
        if(user){const h=await _hashPw(current_password,user.password_salt);if(h===user.password_hash){verified=true;userId=user.id;}}
        if(!verified) return _jsonR({error:"Current password is incorrect"},401);
        if(!userId) return _jsonR({error:"Username changes only work for D1 accounts (not the env fallback account)"},400);
        const existing=await env.DB.prepare("SELECT id FROM admin_users WHERE username=?").bind(new_username).first();
        if(existing) return _jsonR({error:"Username already taken"},409);
        const token=_genTok(), tokenHash=await _hashTok(token), actionId=_genId();
        await env.DB.prepare("INSERT INTO pending_admin_actions (id,action_type,requested_by,payload_json,token_hash,expires_at,created_at) VALUES (?,?,?,?,?,?,?)").bind(actionId,"change_username",requested_by||username,JSON.stringify({old_username:username,new_username,user_id:userId}),tokenHash,Date.now()+15*60*1000,Date.now()).run();
        const em=await _sendSecEmail(env,"change_username",requested_by||username,ip,token);
        if(!em.ok) return _jsonR({error:"Action queued but email failed: "+em.error},500);
        return _jsonR({ok:true,message:"Verification email sent. Click the link in your email to approve."});
      } catch(e){return _jsonR({error:e.message},500);}
    }

    if (url.pathname === "/api/admin/users/disable" && request.method === "POST") {
      if ((request.headers.get("Authorization")||"") !== `Bearer ${env.ADMIN_KEY}`) return _jsonR({error:"Unauthorized"},401);
      const ip = request.headers.get("CF-Connecting-IP")||"unknown";
      try {
        const {target_username,requested_by} = await request.json();
        if (!target_username) return _jsonR({error:"target_username required"},400);
        const user=await env.DB.prepare("SELECT id FROM admin_users WHERE username=? AND status='active'").bind(target_username).first();
        if(!user) return _jsonR({error:"Admin not found or already disabled"},404);
        const token=_genTok(), tokenHash=await _hashTok(token), actionId=_genId();
        await env.DB.prepare("INSERT INTO pending_admin_actions (id,action_type,requested_by,payload_json,token_hash,expires_at,created_at) VALUES (?,?,?,?,?,?,?)").bind(actionId,"disable_admin",requested_by||"unknown",JSON.stringify({target_username,user_id:user.id}),tokenHash,Date.now()+15*60*1000,Date.now()).run();
        const em=await _sendSecEmail(env,"disable_admin",requested_by||"unknown",ip,token);
        if(!em.ok) return _jsonR({error:"Action queued but email failed: "+em.error},500);
        return _jsonR({ok:true,message:"Verification email sent. Click the link in your email to approve."});
      } catch(e){return _jsonR({error:e.message},500);}
    }

    if (url.pathname === "/api/admin/verify-action" && request.method === "GET") {
      const token = url.searchParams.get("token");
      if (!token) return _verifyHtml(false,"Missing verification token.");
      try {
        const tokenHash=await _hashTok(token);
        const action=await env.DB.prepare("SELECT * FROM pending_admin_actions WHERE token_hash=? AND used_at IS NULL AND expires_at > ?").bind(tokenHash,Date.now()).first();
        if(!action) return _verifyHtml(false,"This link is invalid, expired, or has already been used.");
        const payload=JSON.parse(action.payload_json);
        if(action.action_type==="add_admin"){
          await env.DB.prepare("INSERT INTO admin_users (id,username,email,password_hash,password_salt,role,status,created_at) VALUES (?,?,?,?,?,?,?,?)").bind(_genId(),payload.username,payload.email,payload.password_hash,payload.password_salt,payload.role||"admin","active",Date.now()).run();
        } else if(action.action_type==="change_password"&&payload.user_id&&payload.user_id!=="env"){
          await env.DB.prepare("UPDATE admin_users SET password_hash=?,password_salt=? WHERE id=?").bind(payload.password_hash,payload.password_salt,payload.user_id).run();
        } else if(action.action_type==="change_username"&&payload.user_id){
          await env.DB.prepare("UPDATE admin_users SET username=? WHERE id=?").bind(payload.new_username,payload.user_id).run();
        } else if(action.action_type==="disable_admin"&&payload.user_id){
          await env.DB.prepare("UPDATE admin_users SET status='disabled' WHERE id=?").bind(payload.user_id).run();
        }
        await env.DB.prepare("UPDATE pending_admin_actions SET used_at=? WHERE id=?").bind(Date.now(),action.id).run();
        await _auditLog(env,action.requested_by,action.action_type+"_approved",payload,"email-verify");
        const labels={add_admin:"Admin account created successfully.",change_password:"Password updated successfully.",change_username:"Username updated successfully.",disable_admin:"Admin account disabled."};
        return _verifyHtml(true,labels[action.action_type]||"Change applied successfully.");
      } catch(e){return _verifyHtml(false,"Server error: "+e.message);}
    }

    if (url.pathname === "/api/admin/audit-log" && request.method === "GET") {
      if ((request.headers.get("Authorization")||"") !== `Bearer ${env.ADMIN_KEY}`) return _jsonR({error:"Unauthorized"},401);
      try {
        const r=await env.DB.prepare("SELECT * FROM admin_audit_log ORDER BY created_at DESC LIMIT 50").all();
        return _jsonR(r.results||[]);
      } catch(e){return _jsonR({error:e.message},500);}
    }

    // ── ADMIN SIGNAL ANALYTICS ───────────────────────────────
    if (url.pathname === "/api/admin/signal-analytics" && request.method === "GET") {
      if ((request.headers.get("Authorization")||"") !== `Bearer ${env.ADMIN_KEY}`) return _jsonR({error:"Unauthorized"},401);
      try {
        const range   = url.searchParams.get("range")   || "7d";
        const mkt     = url.searchParams.get("market")  || "";
        const srcFlt  = url.searchParams.get("source")  || "";   // bot | casino
        const modeFlt = url.searchParams.get("mode")    || "";   // paper | live | demo
        const sigFlt  = url.searchParams.get("signal")  || "";   // claude | ai_advisor | none
        let cutoff = 0;
        if (range === "today") { const d=new Date(); d.setHours(0,0,0,0); cutoff=d.getTime(); }
        else if (range === "7d")  cutoff = Date.now() - 7  * 86400000;
        else if (range === "30d") cutoff = Date.now() - 30 * 86400000;

        // Build parameterised WHERE clause
        const clauses = ["settled_at >= ?"];
        const params  = [cutoff];
        if (mkt)     { clauses.push("market = ?");       params.push(mkt); }
        if (srcFlt)  { clauses.push("source = ?");       params.push(srcFlt); }
        if (modeFlt) { clauses.push("mode = ?");         params.push(modeFlt); }
        if (sigFlt)  { clauses.push("signal_source = ?"); params.push(sigFlt); }
        const wh = clauses.join(" AND ");
        const b  = (q) => env.DB.prepare(q).bind(...params);

        // Normalise contract column so short labels (Over/Odd) and DIGIT* names group together
        const ctNorm = `CASE contract WHEN 'Even' THEN 'DIGITEVEN' WHEN 'Odd' THEN 'DIGITODD' WHEN 'Over' THEN 'DIGITOVER' WHEN 'Under' THEN 'DIGITUNDER' WHEN 'Matches' THEN 'DIGITMATCH' WHEN 'Differs' THEN 'DIGITDIFF' WHEN 'Rise' THEN 'CALL' WHEN 'Fall' THEN 'PUT' ELSE contract END`;

        // Daily breakdown always uses last 7 days (independent of range filter) for sparklines
        const cutoff7d = Date.now() - 7 * 86400000;
        const [meta, byMkt, byCt, bySt, bySrc, byConf, bySigEvt, byDay] = await Promise.all([
          b(`SELECT COUNT(*) AS total_count, MAX(settled_at) AS last_trade_at FROM trades WHERE ${wh}`).first(),
          b(`SELECT market, COALESCE(market_name,market) AS market_name, COUNT(*) AS total, SUM(won) AS wins, ROUND(SUM(profit),2) AS pl, ROUND(AVG(profit),4) AS avg_profit FROM trades WHERE ${wh} GROUP BY market ORDER BY total DESC LIMIT 20`).all(),
          b(`SELECT ${ctNorm} AS contract_norm, barrier, COUNT(*) AS total, SUM(won) AS wins, ROUND(SUM(profit),2) AS pl FROM trades WHERE ${wh} GROUP BY contract_norm, barrier ORDER BY total DESC LIMIT 20`).all(),
          b(`SELECT COALESCE(strategy,'(none)') AS strategy, COUNT(*) AS total, SUM(won) AS wins, ROUND(SUM(profit),2) AS pl FROM trades WHERE ${wh} GROUP BY strategy ORDER BY total DESC LIMIT 20`).all(),
          b(`SELECT COALESCE(signal_source,'none') AS signal_source, COUNT(*) AS total, SUM(won) AS wins, ROUND(SUM(profit),2) AS pl FROM trades WHERE ${wh} GROUP BY signal_source ORDER BY total DESC`).all(),
          b(`SELECT CASE WHEN signal_conf IS NULL THEN 'none' WHEN signal_conf>=90 THEN '90-100' WHEN signal_conf>=80 THEN '80-89' WHEN signal_conf>=70 THEN '70-79' WHEN signal_conf>=60 THEN '60-69' WHEN signal_conf>=50 THEN '50-59' ELSE '0-49' END AS band, COUNT(*) AS total, SUM(won) AS wins, ROUND(SUM(profit),2) AS pl FROM trades WHERE ${wh} GROUP BY band ORDER BY MIN(COALESCE(signal_conf,-1)) DESC`).all(),
          env.DB.prepare(`SELECT COUNT(*) AS sig_total, SUM(traded) AS sig_traded FROM signal_events WHERE created_at >= ?`).bind(cutoff).first(),
          env.DB.prepare(
            `SELECT COALESCE(strategy,'(none)') AS strategy,
                    CAST((settled_at - ?) / 86400000 AS INTEGER) AS day_idx,
                    COUNT(*) AS n, SUM(won) AS wins
             FROM trades WHERE settled_at >= ? AND (strategy IS NOT NULL OR signal_rec IS NOT NULL)
             GROUP BY strategy, day_idx ORDER BY strategy, day_idx`
          ).bind(cutoff7d, cutoff7d).all(),
        ]);
        return _jsonR({
          range, filters: { market:mkt, source:srcFlt, mode:modeFlt, signal:sigFlt },
          meta: { total_count: meta?.total_count||0, last_trade_at: meta?.last_trade_at||null, refreshed_at: Date.now() },
          sig_events: { total: bySigEvt?.sig_total||0, traded: bySigEvt?.sig_traded||0 },
          by_market:        byMkt?.results||[],
          by_contract:      byCt?.results||[],
          by_strategy:      bySt?.results||[],
          by_signal_source: bySrc?.results||[],
          by_conf_band:     byConf?.results||[],
          by_day:           byDay?.results||[],
        });
      } catch(err) { return _jsonR({error:err.message},500); }
    }

    // ── AI TRAINING ENDPOINTS ─────────────────────────────────
    if (url.pathname === "/api/admin/training-data" && request.method === "GET") {
      if ((request.headers.get("Authorization")||"") !== `Bearer ${env.ADMIN_KEY}`) return _jsonR({error:"Unauthorized"},401);
      try {
        const [total, byStrat, modelRow, jobRow] = await Promise.all([
          env.DB.prepare(`SELECT COUNT(*) AS n FROM trades WHERE signal_source IN ('claude','ai_advisor') AND COALESCE(signal_rec,strategy) IS NOT NULL`).first(),
          env.DB.prepare(`SELECT COALESCE(signal_rec,strategy) AS strat, COUNT(*) AS n, ROUND(100.0*SUM(won)/COUNT(*),1) AS wr FROM trades WHERE signal_source IN ('claude','ai_advisor') AND COALESCE(signal_rec,strategy) IS NOT NULL GROUP BY strat ORDER BY n DESC`).all(),
          env.DB.prepare(`SELECT value FROM config WHERE key='openai_finetune_model'`).first(),
          env.DB.prepare(`SELECT value FROM config WHERE key='openai_finetune_job_id'`).first(),
        ]);
        return _jsonR({ total: total?.n||0, by_strategy: byStrat?.results||[], current_model: modelRow?.value||null, current_job_id: jobRow?.value||null, ready: (total?.n||0) >= 10 });
      } catch(err) { return _jsonR({error:err.message},500); }
    }

    if (url.pathname === "/api/admin/start-finetune" && request.method === "POST") {
      if ((request.headers.get("Authorization")||"") !== `Bearer ${env.ADMIN_KEY}`) return _jsonR({error:"Unauthorized"},401);
      if (!env.OPENAI_API_KEY) return _jsonR({error:"OPENAI_API_KEY not configured as Cloudflare secret"},500);
      try {
        const { results: trades } = await env.DB.prepare(
          `SELECT market, COALESCE(signal_rec,strategy) AS strat, signal_conf, signal_source, won, settled_at
           FROM trades WHERE signal_source IN ('claude','ai_advisor') AND COALESCE(signal_rec,strategy) IS NOT NULL
           ORDER BY settled_at ASC LIMIT 1000`
        ).all();
        if (!trades || trades.length < 10) return _jsonR({error:`Not enough data: ${trades?.length||0} records (need ≥10)`},400);

        const sysmsg = "You are a Deriv digit trading signal evaluator for MoneyMaker Pro. Analyze the market, strategy, and historical context to determine the ideal recommendation. Reply with JSON only: {\"recommendation\":\"over123\"|\"under876\"|\"odd\"|\"even\"|\"hitrun\"|\"none\",\"confidence\":0-100,\"reason\":\"one sentence\"}";
        const rolling = {};
        for (const t of trades) {
          if (!rolling[t.strat]) rolling[t.strat] = [];
          rolling[t.strat].push({ ts: t.settled_at, won: t.won });
        }
        const examples = trades.map(t => {
          const conf = t.signal_conf || 65;
          const prior = (rolling[t.strat]||[]).filter(r => r.ts < t.settled_at);
          const histN = prior.length;
          const histWr = histN >= 3 ? Math.round(100 * prior.filter(r=>r.won).length / histN) : null;
          const histStr = histN >= 5 ? `Historical win rate for ${t.strat}: ${histWr}% over ${histN} trades` : `Historical data: ${histN} trades (not enough for pattern yet)`;
          const userContent = `Market: ${t.market}\nStrategy recommended: ${t.strat}\nSignal confidence: ${conf}%\n${histStr}`;
          let rec, adjConf, reason;
          if (t.won) {
            rec = t.strat;
            adjConf = Math.min(100, conf + (histWr !== null && histWr >= 60 ? 8 : 0));
            reason = histWr !== null && histWr >= 60
              ? `Strong historical win rate (${histWr}%) confirms ${t.strat} edge on ${t.market}`
              : `Signal confirmed — ${t.strat} performed as expected on ${t.market}`;
          } else {
            rec = "none";
            adjConf = histWr !== null && histWr < 45 && histN >= 8 ? 20 : Math.max(0, conf - 30);
            reason = histWr !== null && histWr < 45 && histN >= 8
              ? `Poor historical win rate (${histWr}%) on ${t.strat} — edge unreliable on ${t.market}`
              : `${t.strat} did not confirm on ${t.market} — signal insufficient`;
          }
          return JSON.stringify({ messages: [
            { role: "system", content: sysmsg },
            { role: "user", content: userContent },
            { role: "assistant", content: JSON.stringify({ recommendation: rec, confidence: adjConf, reason }) }
          ]});
        });

        const jsonl = examples.join("\n");
        const formData = new FormData();
        formData.append("file", new Blob([jsonl], { type: "application/jsonl" }), "training.jsonl");
        formData.append("purpose", "fine-tune");
        const uploadRes = await fetch("https://api.openai.com/v1/files", {
          method: "POST", headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}` }, body: formData
        });
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok) return _jsonR({error:`Upload failed: ${uploadData.error?.message||"unknown"}`},500);

        const ftRes = await fetch("https://api.openai.com/v1/fine_tuning/jobs", {
          method: "POST",
          headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ training_file: uploadData.id, model: "gpt-4o-mini-2024-07-18" })
        });
        const ftData = await ftRes.json();
        if (!ftRes.ok) return _jsonR({error:`Fine-tune failed: ${ftData.error?.message||"unknown"}`},500);

        await env.DB.prepare("INSERT OR REPLACE INTO config (key,value) VALUES ('openai_finetune_job_id',?)").bind(ftData.id).run();
        await _auditLog(env, "admin", "start_finetune", { job_id: ftData.id, examples: examples.length }, request.headers.get("CF-Connecting-IP")||"");
        return _jsonR({ ok: true, job_id: ftData.id, examples: examples.length, status: ftData.status });
      } catch(err) { return _jsonR({error:err.message},500); }
    }

    if (url.pathname === "/api/admin/finetune-status" && request.method === "GET") {
      if ((request.headers.get("Authorization")||"") !== `Bearer ${env.ADMIN_KEY}`) return _jsonR({error:"Unauthorized"},401);
      if (!env.OPENAI_API_KEY) return _jsonR({error:"OPENAI_API_KEY not configured"},500);
      try {
        const jobRow = await env.DB.prepare("SELECT value FROM config WHERE key='openai_finetune_job_id'").first();
        if (!jobRow?.value) return _jsonR({error:"No fine-tune job found. Start one first."},404);
        const res = await fetch(`https://api.openai.com/v1/fine_tuning/jobs/${jobRow.value}`, {
          headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}` }
        });
        const data = await res.json();
        if (!res.ok) return _jsonR({error:data.error?.message||"Status check failed"},500);
        if (data.status === "succeeded" && data.fine_tuned_model) {
          await env.DB.prepare("INSERT OR REPLACE INTO config (key,value) VALUES ('openai_finetune_model',?)").bind(data.fine_tuned_model).run();
          await env.DB.prepare("INSERT OR REPLACE INTO config (key,value) VALUES ('openai_scan_enabled','1')").run();
          await _auditLog(env, "admin", "finetune_complete", { model: data.fine_tuned_model }, null);
        }
        return _jsonR({ job_id: data.id, status: data.status, model: data.fine_tuned_model||null, trained_tokens: data.trained_tokens||null, created_at: data.created_at, finished_at: data.finished_at||null });
      } catch(err) { return _jsonR({error:err.message},500); }
    }

    if (url.pathname === "/api/session-relay" && request.method === "POST") {
      try {
        const { type, action, session_id, stats } = await request.json();
        if (!type || !action) return _jsonR({ error: "type and action required" }, 400);
        ctx.waitUntil(_discordSession(env, type, action, stats));
        return _jsonR({ ok: true });
      } catch (err) {
        return _jsonR({ error: err.message }, 500);
      }
    }

    // ── VPS BOT SESSION ─────────────────────────────────────────
    // Session config stored in KV under vps:session:__active__ (one active session).
    // VPS polls this key; browser writes it on start and marks _running:false on stop.

    if (url.pathname === "/api/vps/session" && request.method === "POST") {
      if (!env.SIGNAL_CACHE) return _jsonR({ error: "KV not configured" }, 503);
      try {
        const body = await request.json();
        if (!body.session_id || !body.deriv_token) return _jsonR({ error: "session_id and deriv_token required" }, 400);
        const payload = { ...body, _running: true, _started_at: Date.now() };
        await env.SIGNAL_CACHE.put("vps:session:__active__", JSON.stringify(payload), { expirationTtl: 3600 });
        return _jsonR({ ok: true, session_id: body.session_id });
      } catch (err) { return _jsonR({ error: err.message }, 500); }
    }

    if (url.pathname === "/api/vps/session" && request.method === "GET") {
      if (!env.SIGNAL_CACHE) return _jsonR({ error: "KV not configured" }, 503);
      try {
        const data = await env.SIGNAL_CACHE.get("vps:session:__active__", { type: "json" });
        if (!data) return _jsonR({ error: "no active session" }, 404);
        // Require VPS_SECRET header — never expose deriv_token to public requests
        const callerSecret = request.headers.get("X-VPS-Secret") || "";
        if (env.VPS_SECRET && callerSecret !== env.VPS_SECRET) {
          return _jsonR({ error: "invalid VPS_SECRET" }, 401);
        }
        return _jsonR(data);
      } catch (err) { return _jsonR({ error: err.message }, 500); }
    }

    if (url.pathname === "/api/vps/session" && request.method === "DELETE") {
      if (!env.SIGNAL_CACHE) return _jsonR({ error: "KV not configured" }, 503);
      try {
        const existing = await env.SIGNAL_CACHE.get("vps:session:__active__", { type: "json" });
        if (existing) {
          await env.SIGNAL_CACHE.put(
            "vps:session:__active__",
            JSON.stringify({ ...existing, _running: false, _stopped_at: Date.now() }),
            { expirationTtl: 60 }
          );
        }
        return _jsonR({ ok: true });
      } catch (err) { return _jsonR({ error: err.message }, 500); }
    }

    if (url.pathname === "/api/vps/ping" && request.method === "POST") {
      if (!env.SIGNAL_CACHE) return _jsonR({ error: "KV not configured" }, 503);
      try {
        const body = await request.json();
        if (!body.session_id) return _jsonR({ error: "session_id required" }, 400);
        await env.SIGNAL_CACHE.put(
          "vps:status:__active__",
          JSON.stringify({ ...body, _pinged_at: Date.now() }),
          { expirationTtl: 60 }
        );
        return _jsonR({ ok: true });
      } catch (err) { return _jsonR({ error: err.message }, 500); }
    }

    if (url.pathname === "/api/vps/status" && request.method === "GET") {
      if (!env.SIGNAL_CACHE) return _jsonR({ running: false });
      try {
        const data = await env.SIGNAL_CACHE.get("vps:status:__active__", { type: "json" });
        return _jsonR(data || { running: false });
      } catch (err) { return _jsonR({ error: err.message }, 500); }
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" }
      });
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(_discordDailyReport(env));
    if (new Date().getDay() === 0) {
      ctx.waitUntil(_discordWeeklyReport(env));
    }
  }
};
