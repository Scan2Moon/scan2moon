/* ============================================================
   Scan2Moon – dashboard.js  (V1.0 — structure + fake data)
   Full real-data wiring comes in V1.1 when Safe Ape moves here.
   ============================================================ */

import { renderNav }           from "./nav.js";
import { applyTranslations }   from "./i18n.js";

const SIM_API = "/.netlify/functions/simulator";
const SOL_LOGO = "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png";

/* ── Security helpers ─────────────────────────────────────── */
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function isValidSolanaAddress(addr) {
  return typeof addr === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
}

/* ── Badge definitions (mirrors safe-ape-profile.js) ─────── */
const BADGE_DEFS = [
  { id: "first_profit",         img: "/badges/First_Profit.png",    icon: "🏆", name: "First Profit",         reward: 0.1  },
  { id: "win_streak_5",         img: "/badges/win_streak_5.png",    icon: "🔥", name: "Win Streak ×5",        reward: 0.1  },
  { id: "safe_trader",          img: "/badges/Safe_Trader.png",     icon: "🛡️", name: "Safe Trader",          reward: 0.1  },
  { id: "diamond_hands",        img: "/badges/Diamond_Hands.png",   icon: "💎", name: "Diamond Hands",        reward: 0.1  },
  { id: "degen_survivor",       img: "/badges/Degen_Survivor.png",  icon: "🦍", name: "Degen Survivor",       reward: 0.1  },
  { id: "portfolio_100",        img: "/badges/portfolio_100.png",   icon: "📈", name: "100% Growth",          reward: 0.1  },
  { id: "wins_25",              img: "/badges/Wins_25.png",         icon: "⭐", name: "25 Safe Wins",         reward: 0.1  },
  { id: "wins_50",              img: "/badges/Wins_50.png",         icon: "🌟", name: "50 Safe Wins",         reward: 0.5  },
  { id: "wins_100",             img: "/badges/Wins_100.png",        icon: "💫", name: "100 Safe Wins",        reward: 1.0  },
  { id: "wins_500",             img: "/badges/Wins_500.png",        icon: "🚀", name: "500 Safe Wins",        reward: 2.0  },
  { id: "wins_1000",            img: "/badges/Wins_1000.png",       icon: "🐐", name: "1000 Safe Wins",       reward: 5.0  },
  { id: "sol2moon_millionaire", img: "/badges/Sol2Moon.png",        icon: "🌙", name: "Sol2Moon Millionaire", reward: 500.0 },
];

/* ── XP / Level system (fake for now, real data V1.1) ─────── */
/*
  XP formula (planned):
    +10 XP per scan
    +25 XP per trade closed
    +50 XP per badge earned
    +5  XP per day streak
  Level thresholds: 0, 100, 250, 500, 900, 1400, 2050, 2850, 3800, 5000, …
*/
const XP_THRESHOLDS = [0, 100, 250, 500, 900, 1400, 2050, 2850, 3800, 5000, 6500, 8500, 11000];

function calcLevel(xp) {
  let lvl = 1;
  for (let i = 1; i < XP_THRESHOLDS.length; i++) {
    if (xp >= XP_THRESHOLDS[i]) lvl = i + 1;
    else break;
  }
  return lvl;
}

function xpForLevel(lvl) { return XP_THRESHOLDS[lvl - 1] || 0; }
function xpForNextLevel(lvl) { return XP_THRESHOLDS[lvl] || XP_THRESHOLDS[XP_THRESHOLDS.length - 1]; }

/* ── Rank badge ───────────────────────────────────────────── */
function rankLabel(pnl) {
  if (pnl > 50)      return "🌕 Sol2Moon Legend";
  if (pnl > 10)      return "💎 Diamond Trader";
  if (pnl > 1)       return "🧠 Smart Money";
  if (pnl > 0)       return "📈 Profitable Ape";
  if (pnl > -2)      return "🎓 Learning Ape";
  return "💀 Rugged Survivor";
}

/* ── State ────────────────────────────────────────────────── */
let wallet  = null;
let profile = null;

/* ═══════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", () => {
  renderNav();
  applyTranslations();

  const saved = localStorage.getItem("sa_wallet");
  if (saved && isValidSolanaAddress(saved)) {
    wallet = saved;
    loadDashboard();
  }

  document.getElementById("dashConnectBtn").addEventListener("click", connectWallet);

  // Share button
  document.getElementById("dashShareBtn")?.addEventListener("click", () => {
    const url = `${window.location.origin}/dashboard.html`;
    navigator.clipboard.writeText(url).then(() => showToast("🔗 Dashboard link copied!"));
  });
});

/* ═══════════════════════════════════════════════════════
   WALLET CONNECT
═══════════════════════════════════════════════════════ */
async function connectWallet() {
  const btn = document.getElementById("dashConnectBtn");
  document.getElementById("dashConnectText").textContent = "⏳ Connecting…";
  btn.disabled = true;
  try {
    const phantom = window.solana;
    if (!phantom?.isPhantom) {
      alert("Phantom wallet not found!\n\nPlease install Phantom from phantom.app and refresh.");
      return;
    }
    const resp = await phantom.connect();
    wallet = resp.publicKey.toString();
    localStorage.setItem("sa_wallet", wallet);
    await loadDashboard();
  } catch (e) {
    alert("Wallet connection cancelled or failed.");
  } finally {
    document.getElementById("dashConnectText").textContent = "🔗 Connect Phantom Wallet";
    btn.disabled = false;
  }
}

/* ═══════════════════════════════════════════════════════
   DEMO / FAKE PROFILE  (used when API is unavailable)
═══════════════════════════════════════════════════════ */
const DEMO_PROFILE = {
  accountName:  "Demo Ape",
  balance:      14.75,
  totalPnL:     4.75,
  winCount:     18,
  lossCount:    7,
  loginStreak:  5,
  badges:       ["first_profit", "win_streak_5", "safe_trader"],
  holdings:     {},
  trades: [
    { type:"sell", symbol:"BONK",  name:"Bonk",      pnl:  1.24, pnlPct:"38.5", timestamp: Date.now() - 3_600_000 },
    { type:"buy",  symbol:"WIF",   name:"dogwifhat", pnl: undefined,             timestamp: Date.now() - 7_200_000 },
    { type:"sell", symbol:"POPCAT",name:"Popcat",    pnl: -0.31, pnlPct:"-9.2",  timestamp: Date.now() - 86_400_000 },
    { type:"sell", symbol:"MEW",   name:"cat in a dogs world", pnl: 2.10, pnlPct:"67.2", timestamp: Date.now() - 172_800_000 },
  ],
};

/* ═══════════════════════════════════════════════════════
   LOAD DASHBOARD  (with 503 retry + demo fallback)
═══════════════════════════════════════════════════════ */
async function loadDashboard() {
  showToast("⏳ Loading dashboard…");

  /* ── Retry up to 4× on 503 ── */
  let data;
  const MAX_RETRIES = 4;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(`${SIM_API}?wallet=${wallet}`);

      if (resp.status === 503) {
        if (attempt < MAX_RETRIES) {
          const delay = Math.min((attempt + 1) * 2000, 8000);
          showToast(`⏳ Storage reconnecting… (${attempt + 1}/${MAX_RETRIES})`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        /* All retries exhausted — fall back to demo data */
        console.warn("Dashboard: API unavailable after retries, using demo data.");
        profile = { ...DEMO_PROFILE, accountName: "Demo Mode" };
        showDashboard(true);
        return;
      }

      data = await resp.json();
      if (data.error) throw new Error(data.error);
      break; // success
    } catch (e) {
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      /* Network failure — show demo data */
      console.warn("Dashboard: Network error, using demo data:", e);
      profile = { ...DEMO_PROFILE, accountName: "Demo Mode" };
      showDashboard(true);
      return;
    }
  }

  profile = data.profile;
  showDashboard(false);
}

function showDashboard(isDemo = false) {
  document.getElementById("dashGate").style.display = "none";
  document.getElementById("dashApp").style.display  = "block";

  if (isDemo) {
    /* Add a subtle demo banner */
    const existing = document.getElementById("demoBanner");
    if (!existing) {
      const banner = document.createElement("div");
      banner.id = "demoBanner";
      banner.style.cssText = "background:rgba(255,180,50,0.1);border:1px solid rgba(255,180,50,0.3);border-radius:10px;padding:8px 16px;font-size:12px;font-weight:600;color:#ffb432;text-align:center;margin-bottom:14px;";
      banner.textContent = "⚠️ Storage temporarily unavailable — showing demo preview. Your real data will load once the connection restores.";
      document.getElementById("dashApp").prepend(banner);
    }
  }

  renderHero();
  renderStatsRow();
  renderBadges();
  renderApeStats();
  renderActivityFeed();
}

/* ═══════════════════════════════════════════════════════
   HERO PANEL
═══════════════════════════════════════════════════════ */
function renderHero() {
  const short = wallet.slice(0, 6) + "…" + wallet.slice(-6);
  const pnl   = profile.totalPnL || 0;

  document.getElementById("dashName").textContent        = esc(profile.accountName || "Ape Trader");
  document.getElementById("dashWalletShort").textContent = short;
  document.getElementById("dashRankBadge").textContent   = rankLabel(pnl);
}

/* ═══════════════════════════════════════════════════════
   STATS ROW
═══════════════════════════════════════════════════════ */
function renderStatsRow() {
  const trades  = (profile.trades || []).length;
  const badges  = (profile.badges || []).length;
  const streak  = profile.loginStreak || 0;
  const wins    = profile.winCount   || 0;
  const losses  = profile.lossCount  || 0;

  /* ── XP (fake formula until real scan data available) ── */
  const xp      = (trades * 25) + (badges * 50) + (streak * 5);
  const lvl     = calcLevel(xp);
  const xpCur   = xp - xpForLevel(lvl);
  const xpRange = xpForNextLevel(lvl) - xpForLevel(lvl);
  const xpPct   = xpRange > 0 ? Math.min(100, Math.round((xpCur / xpRange) * 100)) : 100;

  document.getElementById("dashLvl").textContent      = lvl;
  document.getElementById("dashXpText").textContent   = `${xp.toLocaleString()} / ${xpForNextLevel(lvl).toLocaleString()} XP`;
  document.getElementById("dashXpFill").style.width   = xpPct + "%";

  /* ── Scans (fake — placeholder until scan tracking) ── */
  const fakeScans = trades + 12; // placeholder: trades + some bonus
  document.getElementById("dashScans").textContent = fakeScans;

  /* ── Rank (fake — placeholder until leaderboard integration) ── */
  document.getElementById("dashRank").textContent = `${Math.max(1, 2400 - wins * 3)} / 17k`;

  /* ── Streak ── */
  document.getElementById("dashStreak").textContent = `${streak}d`;
}

/* ═══════════════════════════════════════════════════════
   BADGES
═══════════════════════════════════════════════════════ */
function renderBadges() {
  const earned   = new Set(profile.badges || []);
  const count    = earned.size;
  const total    = BADGE_DEFS.length;
  const pct      = total > 0 ? Math.round((count / total) * 100) : 0;
  const solTotal = [...earned].reduce((s, id) => {
    const b = BADGE_DEFS.find(b => b.id === id);
    return s + (b?.reward || 0.1);
  }, 0);

  document.getElementById("dashBadgesCount").textContent     = `${count} / ${total} earned`;
  document.getElementById("dashBadgesPct").textContent       = `${pct}% complete`;
  document.getElementById("dashBadgesBarFill").style.width   = pct + "%";
  document.getElementById("dashBadgesSolEarned").textContent = `+${formatSol(solTotal)} earned`;

  const grid = document.getElementById("dashBadgesGrid");
  grid.innerHTML = BADGE_DEFS.map(b => {
    const isEarned = earned.has(b.id);
    const cls  = isEarned ? "earned" : "locked";
    const statusCls  = isEarned ? "status-earned" : "status-locked";
    const statusText = isEarned ? "✅ EARNED" : "🔒 LOCKED";

    return `
      <div class="dash-badge-card ${cls}">
        <div class="dash-badge-reward">+${b.reward >= 1 ? b.reward.toFixed(1) : b.reward.toFixed(2)} SOL</div>
        <div class="dash-badge-img-wrap">
          <img class="dash-badge-img" src="${b.img}" alt="${b.name}"
            onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
          <span class="dash-badge-emoji" style="display:none">${b.icon}</span>
        </div>
        <div class="dash-badge-name">${esc(b.name)}</div>
        <div class="dash-badge-status ${statusCls}">${statusText}</div>
      </div>`;
  }).join("");
}

/* ═══════════════════════════════════════════════════════
   APE SIMULATOR QUICK STATS
═══════════════════════════════════════════════════════ */
function renderApeStats() {
  const wins    = profile.winCount   || 0;
  const losses  = profile.lossCount  || 0;
  const total   = wins + losses;
  const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : "0";
  const pnl     = profile.totalPnL   || 0;
  const pnlSign = pnl >= 0 ? "+" : "";
  const pnlCls  = pnl >= 0 ? "#2cffc9" : "#ff4d6d";
  const bal     = profile.balance    || 10;

  const cards = [
    { label: "BALANCE",    val: formatSol(bal),              color: "#ffb432" },
    { label: "ALL-TIME P/L", val: `${pnlSign}${formatSol(pnl)}`, color: pnlCls },
    { label: "WIN RATE",   val: `${winRate}%`,               color: parseFloat(winRate) >= 50 ? "#2cffc9" : "#ff4d6d" },
    { label: "TRADES",     val: total,                       color: "#cffff4" },
  ];

  document.getElementById("dashApeStats").innerHTML = cards.map(c => `
    <div class="dash-qs-card">
      <div class="dash-qs-label">${c.label}</div>
      <div class="dash-qs-val" style="color:${c.color}">${c.val}</div>
    </div>`).join("");
}

/* ═══════════════════════════════════════════════════════
   RECENT ACTIVITY FEED  (fake — real data V1.1)
═══════════════════════════════════════════════════════ */
function renderActivityFeed() {
  const trades   = (profile.trades || []).slice(0, 4);
  const earnedBadges = profile.badges || [];

  const feed = [];

  // last trades as activity items
  for (const tr of trades) {
    const isBuy = tr.type === "buy";
    const pnlStr = !isBuy && tr.pnl !== undefined
      ? ` · ${tr.pnl >= 0 ? '+' : ''}${formatSol(tr.pnl)}`
      : "";
    feed.push({
      icon: isBuy ? "🟢" : "🔴",
      text: `${isBuy ? "Bought" : "Sold"} <strong>${esc(tr.symbol || tr.name)}</strong>${pnlStr}`,
      time: timeAgo(tr.timestamp),
    });
  }

  // last badge earned
  if (earnedBadges.length) {
    const lastBadgeId = earnedBadges[earnedBadges.length - 1];
    const b = BADGE_DEFS.find(x => x.id === lastBadgeId);
    if (b) {
      feed.unshift({
        icon: "🏅",
        text: `Badge unlocked: <strong>${esc(b.name)}</strong>`,
        time: "recently",
      });
    }
  }

  if (!feed.length) {
    document.getElementById("dashActivityFeed").innerHTML =
      `<div style="text-align:center;padding:20px;opacity:0.4;font-size:13px;">No activity yet — start scanning!</div>`;
    return;
  }

  document.getElementById("dashActivityFeed").innerHTML = feed.map(item => `
    <div class="dash-activity-item">
      <span class="dash-activity-icon">${item.icon}</span>
      <span class="dash-activity-text">${item.text}</span>
      <span class="dash-activity-time">${item.time}</span>
    </div>`).join("");
}

/* ═══════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════ */
function formatSol(n) {
  if (n === null || n === undefined || isNaN(n)) return "0 SOL";
  const abs = Math.abs(n);
  if (abs === 0)   return "0 SOL";
  if (abs < 0.001) return n.toFixed(6) + " SOL";
  if (abs < 0.1)   return n.toFixed(4) + " SOL";
  if (abs < 10)    return n.toFixed(3) + " SOL";
  return n.toFixed(2) + " SOL";
}

function timeAgo(ts) {
  if (!ts) return "";
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)   return "just now";
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function showToast(msg) {
  let toast = document.getElementById("saToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "saToast";
    toast.style.cssText = `position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:rgba(6,32,26,0.97);border:1px solid rgba(44,255,201,0.4);border-radius:10px;padding:12px 24px;font-size:14px;font-weight:600;color:#cffff4;z-index:9999;box-shadow:0 0 30px rgba(44,255,201,0.2);transition:opacity 0.3s;white-space:nowrap;`;
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = "1";
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.opacity = "0"; }, 3500);
}
