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

/* ── Badge categories ─────────────────────────────────────── */
const BADGE_CATEGORIES = [
  { id: "trading", icon: "🦍", label: "Safe Ape Trading", color: "#2cffc9",  bgColor: "rgba(44,255,201,0.12)",  borderColor: "rgba(44,255,201,0.35)"  },
  { id: "academy", icon: "🎓", label: "Academy",          color: "#ffb432",  bgColor: "rgba(255,180,50,0.12)",  borderColor: "rgba(255,180,50,0.35)"  },
  { id: "other",   icon: "🌟", label: "Other",            color: "#c084fc",  bgColor: "rgba(192,132,252,0.12)", borderColor: "rgba(192,132,252,0.35)" },
  { id: "pro",     icon: "💎", label: "PRO",              color: "#60a5fa",  bgColor: "rgba(96,165,250,0.12)",  borderColor: "rgba(96,165,250,0.35)"  },
];

/* ── Badge definitions ────────────────────────────────────── */
const BADGE_DEFS = [
  /* ── Safe Ape Trading ── */
  { id: "first_profit",         cat: "trading", img: "/badges/First_Profit.png",    icon: "🏆", name: "First Profit",          desc: "Close your very first profitable trade in the Safe Ape Simulator.",          reward: 0.1   },
  { id: "win_streak_5",         cat: "trading", img: "/badges/win_streak_5.png",    icon: "🔥", name: "Win Streak ×5",         desc: "Win 5 consecutive trades in a row without a loss in between.",               reward: 0.1   },
  { id: "safe_trader",          cat: "trading", img: "/badges/Safe_Trader.png",     icon: "🛡️", name: "Safe Trader",           desc: "Buy 10 different tokens that each had an entry risk score of 65 or higher.", reward: 0.1   },
  { id: "diamond_hands",        cat: "trading", img: "/badges/Diamond_Hands.png",   icon: "💎", name: "Diamond Hands",         desc: "Hold a token position open for 7 days or more before selling.",              reward: 0.1   },
  { id: "degen_survivor",       cat: "trading", img: "/badges/Degen_Survivor.png",  icon: "🦍", name: "Degen Survivor",        desc: "Make a 10× profit on a token that had a risk score below 45 at entry.",      reward: 0.1   },
  { id: "portfolio_100",        cat: "trading", img: "/badges/portfolio_100.png",   icon: "📈", name: "100% Growth",           desc: "Double your starting balance of 10 SOL — reach 20 SOL or more.",            reward: 0.1   },
  { id: "wins_25",              cat: "trading", img: "/badges/Wins_25.png",         icon: "⭐", name: "25 Safe Wins",          desc: "Close a total of 25 profitable trades in the simulator.",                    reward: 0.1   },
  { id: "wins_50",              cat: "trading", img: "/badges/Wins_50.png",         icon: "🌟", name: "50 Safe Wins",          desc: "Close a total of 50 profitable trades. You're on a roll!",                  reward: 0.5   },
  { id: "wins_100",             cat: "trading", img: "/badges/Wins_100.png",        icon: "💫", name: "100 Safe Wins",         desc: "Close 100 profitable trades. The market has nothing on you.",               reward: 1.0   },
  { id: "wins_500",             cat: "trading", img: "/badges/Wins_500.png",        icon: "🚀", name: "500 Safe Wins",         desc: "500 wins — you are an elite Scan2Moon trader.",                             reward: 2.0   },
  { id: "wins_1000",            cat: "trading", img: "/badges/Wins_1000.png",       icon: "🐐", name: "1000 Safe Wins — GOAT", desc: "1000 profitable trades. You are the absolute Greatest Of All Time.",        reward: 5.0   },
  { id: "sol2moon_millionaire", cat: "trading", img: "/badges/Sol2Moon.png",        icon: "🌙", name: "Sol2Moon Millionaire",  desc: "Grow your simulator balance to 10,000 SOL. Legendary status.",              reward: 500.0 },

  /* ── Academy ── */
  { id: "lesson_1",      cat: "academy", img: "/badges/lesson_1.png",      icon: "🎯", name: "First Lesson",      desc: "Complete your very first lesson in the Scan2Moon Academy.",                        reward: 0.1  },
  { id: "risk_master",   cat: "academy", img: "/badges/risk_master.png",   icon: "📊", name: "Risk Master",       desc: "Score 100% on the Risk Scanner knowledge quiz. Perfect understanding!",           reward: 0.25 },
  { id: "scanner_pro",   cat: "academy", img: "/badges/scanner_pro.png",   icon: "🛡️", name: "Scanner Pro",       desc: "Complete the full Risk Scanner deep-dive course from start to finish.",           reward: 0.5  },
  { id: "chart_reader",  cat: "academy", img: "/badges/chart_reader.png",  icon: "📈", name: "Chart Reader",      desc: "Pass the Chart Reading & Candle Analysis challenge with 80%+ accuracy.",          reward: 0.25 },
  { id: "whale_watcher", cat: "academy", img: "/badges/whale_watcher.png", icon: "🐋", name: "Whale Watcher",     desc: "Complete the Whale DNA module and learn how to track smart money.",                reward: 0.25 },
  { id: "defi_graduate", cat: "academy", img: "/badges/defi_graduate.png", icon: "🏛️", name: "DeFi Graduate",     desc: "Complete every module in the Scan2Moon Academy. Full graduate status!",           reward: 1.0  },

  /* ── Other ── */
  { id: "early_adopter",  cat: "other", img: "/badges/early_adopter.png",  icon: "⚡", name: "Early Adopter",   desc: "Joined Scan2Moon before the V2 public launch. OG status forever.",              reward: 0.5  },
  { id: "community_og",   cat: "other", img: "/badges/community_og.png",   icon: "🐦", name: "Community OG",    desc: "Followed @Scan2Moon on X and joined the community from the start.",             reward: 0.1  },
  { id: "streak_7",       cat: "other", img: "/badges/streak_7.png",       icon: "🔥", name: "7-Day Streak",    desc: "Log in 7 days in a row. Consistency is the edge most traders don't have.",      reward: 0.15 },
  { id: "watchlist_pro",  cat: "other", img: "/badges/watchlist_pro.png",  icon: "⭐", name: "Watchlist Pro",   desc: "Add 10 or more tokens to your personal Scan2Moon Watchlist.",                   reward: 0.1  },
  { id: "sharer",         cat: "other", img: "/badges/sharer.png",         icon: "📢", name: "Alpha Sharer",    desc: "Share a risk scan result on X. Spreading real data, not hype.",                 reward: 0.1  },

  /* ── PRO ── */
  { id: "pro_scanner",   cat: "pro", img: "/badges/pro_scanner.png",   icon: "🛡️", name: "Pro Scanner",     desc: "Run 100 total risk scans. You have seen enough charts to know the difference.", reward: 0.5  },
  { id: "alpha_caller",  cat: "pro", img: "/badges/alpha_caller.png",  icon: "🎯", name: "Alpha Caller",    desc: "Correctly predict 3 tokens that go 10× before they pump. Real alpha.",          reward: 2.0  },
  { id: "whale_analyst", cat: "pro", img: "/badges/whale_analyst.png", icon: "🐋", name: "Whale Analyst",   desc: "Successfully identify 5 whale wallet patterns using Whale DNA scanner.",         reward: 1.0  },
  { id: "top_10",        cat: "pro", img: "/badges/top_10.png",        icon: "🏆", name: "Top 10",          desc: "Reach the top 10 on the Scan2Moon Leaderboard. Elite trader confirmed.",         reward: 5.0  },
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

/* ── Badge progress (for "Next to Unlock" strip) ─────────── */
function badgeProgress(id) {
  const wins   = profile.winCount    || 0;
  const bal    = profile.balance     || 10;
  const streak = profile.loginStreak || 0;
  switch (id) {
    case "wins_25":              return { cur: wins,                  max: 25,    label: `${wins} wins`          };
    case "wins_50":              return { cur: wins,                  max: 50,    label: `${wins} wins`          };
    case "wins_100":             return { cur: wins,                  max: 100,   label: `${wins} wins`          };
    case "wins_500":             return { cur: wins,                  max: 500,   label: `${wins} wins`          };
    case "wins_1000":            return { cur: wins,                  max: 1000,  label: `${wins} wins`          };
    case "portfolio_100":        return { cur: Math.max(0, bal - 10), max: 10,    label: `${formatSol(bal)} bal` };
    case "sol2moon_millionaire": return { cur: bal,                   max: 10000, label: `${formatSol(bal)} bal` };
    case "streak_7":             return { cur: streak,                max: 7,     label: `${streak}d streak`     };
    default:                     return null;
  }
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
  holdings: {
    "WIFxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx1": {
      name:"dogwifhat",  symbol:"WIF",  amount:15000, totalCostSol:2.10, logo:"" },
    "SAMOxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx2": {
      name:"Samoyedcoin",symbol:"SAMO", amount:8500,  totalCostSol:1.50, logo:"" },
  },
  trades: [
    { type:"sell", symbol:"BONK",   name:"Bonk",                 pnl:  1.24, pnlPct: "38.5", totalReceivedSol:4.45, timestamp: Date.now() -   3_600_000 },
    { type:"buy",  symbol:"WIF",    name:"dogwifhat",                                         totalCostSol:2.10,     timestamp: Date.now() -   7_200_000 },
    { type:"sell", symbol:"POPCAT", name:"Popcat",                pnl: -0.31, pnlPct: "-9.2", totalReceivedSol:3.04, timestamp: Date.now() -  86_400_000 },
    { type:"sell", symbol:"MEW",    name:"cat in a dogs world",   pnl:  2.10, pnlPct: "67.2", totalReceivedSol:5.25, timestamp: Date.now() - 172_800_000 },
    { type:"buy",  symbol:"SAMO",   name:"Samoyedcoin",                                       totalCostSol:1.50,     timestamp: Date.now() - 259_200_000 },
    { type:"sell", symbol:"JUP",    name:"Jupiter",               pnl:  0.88, pnlPct: "23.1", totalReceivedSol:4.69, timestamp: Date.now() - 345_600_000 },
    { type:"sell", symbol:"PYTH",   name:"Pyth Network",          pnl: -0.55, pnlPct:"-18.0", totalReceivedSol:2.51, timestamp: Date.now() - 432_000_000 },
    { type:"sell", symbol:"RAY",    name:"Raydium",               pnl:  0.42, pnlPct: "15.3", totalReceivedSol:3.17, timestamp: Date.now() - 518_400_000 },
    { type:"sell", symbol:"ORCA",   name:"Orca",                  pnl:  1.67, pnlPct: "44.6", totalReceivedSol:5.41, timestamp: Date.now() - 604_800_000 },
    { type:"buy",  symbol:"FOXY",   name:"Famous Fox",                                        totalCostSol:0.80,     timestamp: Date.now() - 691_200_000 },
    { type:"sell", symbol:"MNGO",   name:"Mango",                 pnl: -0.22, pnlPct: "-8.1", totalReceivedSol:2.49, timestamp: Date.now() - 777_600_000 },
    { type:"sell", symbol:"ATLAS",  name:"Star Atlas",            pnl:  3.40, pnlPct: "82.1", totalReceivedSol:7.54, timestamp: Date.now() - 864_000_000 },
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
  renderHighlightStats();
  renderNextBadges();
  renderBadges();
  renderApeStats();
  renderActivityFeed();
  renderPnlChart();
  renderTradeHistory();
  renderHoldings();
  renderLeaderboard();
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
   BADGES — CATEGORISED ACCORDION
═══════════════════════════════════════════════════════ */
function renderBadges() {
  const earned   = new Set(profile.badges || []);
  const count    = earned.size;
  const total    = BADGE_DEFS.length;
  const pct      = total > 0 ? Math.round((count / total) * 100) : 0;
  const solTotal = [...earned].reduce((s, id) => {
    const b = BADGE_DEFS.find(x => x.id === id);
    return s + (b?.reward || 0.1);
  }, 0);

  /* Overall header */
  document.getElementById("dashBadgesCount").textContent     = `${count} / ${total} earned`;
  document.getElementById("dashBadgesPct").textContent       = `${pct}% complete`;
  document.getElementById("dashBadgesBarFill").style.width   = pct + "%";
  document.getElementById("dashBadgesSolEarned").textContent = `+${formatSol(solTotal)} earned`;

  /* Build accordion categories */
  const container = document.getElementById("dashBadgesGrid");
  container.className = "dash-badge-categories";
  container.innerHTML = BADGE_CATEGORIES.map((cat, catIdx) => {
    const catBadges  = BADGE_DEFS.filter(b => b.cat === cat.id);
    const catEarned  = catBadges.filter(b => earned.has(b.id)).length;
    const catSol     = catBadges.filter(b => earned.has(b.id)).reduce((s, b) => s + b.reward, 0);
    const isOpen     = catIdx === 0; // first category open by default

    const cardsHtml = catBadges.map(b => {
      const isEarned   = earned.has(b.id);
      const rewardStr  = b.reward >= 1 ? b.reward.toFixed(1) : b.reward.toFixed(2);
      return `
        <div class="dash-badge-card ${isEarned ? 'earned' : 'locked'}"
             onclick="window.openBadgeModal('${b.id}')"
             title="${esc(b.name)}">
          <div class="dash-badge-reward">+${rewardStr} SOL</div>
          <div class="dash-badge-img-wrap">
            <img class="dash-badge-img" src="${b.img}" alt="${esc(b.name)}"
              onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
            <span class="dash-badge-emoji" style="display:none">${b.icon}</span>
          </div>
          <div class="dash-badge-name">${esc(b.name)}</div>
          <div class="dash-badge-status ${isEarned ? 'status-earned' : 'status-locked'}">
            ${isEarned ? '✅ EARNED' : '🔒 LOCKED'}
          </div>
        </div>`;
    }).join("");

    return `
      <div class="dash-cat-wrap ${isOpen ? 'open' : ''}" id="dash-cat-${cat.id}">
        <div class="dash-cat-header" onclick="window.toggleBadgeCat('${cat.id}')">
          <div class="dash-cat-color-bar" style="background:${cat.color};"></div>
          <span class="dash-cat-icon">${cat.icon}</span>
          <span class="dash-cat-title">${cat.label}</span>
          <span class="dash-cat-pill"
            style="background:${cat.bgColor};border:1px solid ${cat.borderColor};color:${cat.color};">
            ${catEarned} / ${catBadges.length}
          </span>
          ${catSol > 0 ? `<span class="dash-cat-sol">
            <img src="${SOL_LOGO}" style="width:13px;height:13px;border-radius:50%;">
            +${formatSol(catSol)}
          </span>` : ''}
          <span class="dash-cat-chevron">▼</span>
        </div>
        <div class="dash-cat-body">
          <div class="dash-badges-grid">${cardsHtml}</div>
        </div>
      </div>`;
  }).join("");
}

/* ── Toggle accordion category ───────────────────────────── */
window.toggleBadgeCat = function(catId) {
  const wrap = document.getElementById(`dash-cat-${catId}`);
  if (wrap) wrap.classList.toggle("open");
};

/* ═══════════════════════════════════════════════════════
   NEXT BADGES TO UNLOCK
═══════════════════════════════════════════════════════ */
function renderNextBadges() {
  const el     = document.getElementById("dashNextBadges");
  if (!el) return;
  const earned = new Set(profile.badges || []);
  const locked = BADGE_DEFS.filter(b => !earned.has(b.id));

  if (!locked.length) {
    el.innerHTML = `<div style="text-align:center;padding:18px;color:#2cffc9;font-weight:700;font-size:14px;">🎉 All badges earned! You're a legend.</div>`;
    return;
  }

  /* Score each locked badge by trackable progress % */
  const scored = locked.map(b => {
    const prog = badgeProgress(b.id);
    const pct  = prog ? Math.min(100, Math.round((prog.cur / prog.max) * 100)) : 0;
    return { b, prog, pct };
  }).sort((a, z) => z.pct - a.pct).slice(0, 3);

  el.innerHTML = `<div class="dash-next-row">${scored.map(({ b, prog, pct }) => {
    const cat       = BADGE_CATEGORIES.find(c => c.id === b.cat);
    const rewardStr = b.reward >= 1 ? b.reward.toFixed(1) : b.reward.toFixed(2);
    const progLabel = prog ? `${prog.label} · ${pct}%` : "Complete requirements";
    return `
      <div class="dash-next-card" onclick="window.openBadgeModal('${b.id}')">
        <div class="dash-next-img-wrap">
          <img class="dash-next-img" src="${b.img}" alt="${esc(b.name)}"
            onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
          <span class="dash-next-emoji" style="display:none">${b.icon}</span>
          <div class="dash-next-lock">🔒</div>
        </div>
        <div class="dash-next-name">${esc(b.name)}</div>
        <div class="dash-next-cat" style="color:${cat.color};">${cat.icon} ${cat.label}</div>
        <div class="dash-next-reward">
          <img src="${SOL_LOGO}" style="width:11px;height:11px;border-radius:50%;vertical-align:middle;">
          +${rewardStr} SOL
        </div>
        <div class="dash-next-bar-wrap">
          <div class="dash-next-bar-fill" style="width:${pct}%;background:${cat.color};"></div>
        </div>
        <div class="dash-next-prog-label">${progLabel}</div>
      </div>`;
  }).join("")}</div>`;
}

/* ═══════════════════════════════════════════════════════
   BADGE MODAL
═══════════════════════════════════════════════════════ */
window.openBadgeModal = function(id) {
  const b        = BADGE_DEFS.find(x => x.id === id);
  if (!b) return;
  const cat      = BADGE_CATEGORIES.find(c => c.id === b.cat);
  const isEarned = new Set(profile.badges || []).has(id);
  const rewardStr = b.reward >= 1 ? b.reward.toFixed(1) : b.reward.toFixed(2);

  /* Remove any existing modal */
  document.getElementById("badgeModalOverlay")?.remove();

  const overlay = document.createElement("div");
  overlay.className = "badge-modal-overlay";
  overlay.id = "badgeModalOverlay";
  overlay.innerHTML = `
    <div class="badge-modal-card" id="badgeModalCard">
      <button class="badge-modal-close" onclick="document.getElementById('badgeModalOverlay').remove()">✕</button>

      <div class="badge-modal-cat-chip"
        style="background:${cat.bgColor};border:1px solid ${cat.borderColor};color:${cat.color};">
        ${cat.icon} ${cat.label}
      </div>

      <div class="badge-modal-img-wrap ${isEarned ? 'earned' : ''}">
        <img class="badge-modal-img" src="${b.img}" alt="${esc(b.name)}"
          onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
        <div class="badge-modal-emoji" style="display:none">${b.icon}</div>
      </div>

      <div class="badge-modal-name">${esc(b.name)}</div>
      <div class="badge-modal-desc">${esc(b.desc)}</div>

      <div class="badge-modal-reward">
        <img src="${SOL_LOGO}" style="width:18px;height:18px;border-radius:50%;">
        +${rewardStr} SOL reward
      </div>

      <div class="badge-modal-status-row">
        <span class="badge-modal-status-chip ${isEarned ? 'earned' : 'locked'}">
          ${isEarned ? '✅ EARNED' : '🔒 NOT YET EARNED'}
        </span>
      </div>

      <div class="badge-modal-actions">
        <button class="badge-modal-btn save" id="badgeSaveBtn"
          onclick="window.saveBadgeImage('${id}')">
          💾 Save Image
        </button>
        <button class="badge-modal-btn share-x" id="badgeShareXBtn"
          onclick="window.shareBadgeOnX('${id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          Share on X
        </button>
      </div>
    </div>`;

  /* Close on backdrop click */
  overlay.addEventListener("click", e => {
    if (e.target === overlay) overlay.remove();
  });

  document.body.appendChild(overlay);
};

/* ── Build hidden share card & capture ───────────────────── */
async function buildShareCard(id) {
  const b        = BADGE_DEFS.find(x => x.id === id);
  const cat      = BADGE_CATEGORIES.find(c => c.id === b.cat);
  const isEarned = new Set(profile.badges || []).has(id);
  const rewardStr = b.reward >= 1 ? b.reward.toFixed(1) : b.reward.toFixed(2);
  const short    = wallet ? wallet.slice(0,6) + "…" + wallet.slice(-4) : "";

  /* Remove any old card */
  document.getElementById("badgeShareCard")?.remove();

  const card = document.createElement("div");
  card.id = "badgeShareCard";
  card.innerHTML = `
    <div class="bsc-logo">🌙 SCAN2MOON</div>
    <img class="bsc-img" src="${b.img}" alt="${b.name}"
      onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
    <div class="bsc-emoji" style="display:none">${b.icon}</div>
    <div class="bsc-name">${b.name}</div>
    <div class="bsc-desc">${b.desc}</div>
    <div class="bsc-reward">+${rewardStr} SOL reward</div>
    <div class="bsc-status ${isEarned ? 'earned' : 'locked'}">
      ${isEarned ? '✅ EARNED' : '🔒 NOT YET EARNED'}
    </div>
    <div style="font-size:11px;color:rgba(44,255,201,0.35);margin-top:6px;">${cat.icon} ${cat.label}</div>
    ${short ? `<div style="font-size:10px;color:rgba(207,255,244,0.25);margin-top:4px;font-family:monospace;">${short}</div>` : ""}
    <div class="bsc-footer">scan2moon.com</div>`;

  document.body.appendChild(card);

  /* Wait one frame for images */
  await new Promise(r => setTimeout(r, 120));

  const canvas = await html2canvas(card, {
    backgroundColor: "#061311",
    scale: 2,
    useCORS: true,
    allowTaint: true,
    logging: false,
  });

  card.remove();
  return { canvas, name: b.name };
}

window.saveBadgeImage = async function(id) {
  const btn = document.getElementById("badgeSaveBtn");
  if (btn) { btn.disabled = true; btn.textContent = "⏳ Saving…"; }
  try {
    const { canvas, name } = await buildShareCard(id);
    const link = document.createElement("a");
    link.download = `${name.replace(/\s+/g,"-")}-Scan2Moon.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  } catch(e) {
    console.error("Save badge image error:", e);
    showToast("⚠️ Could not save image — try again.");
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = "💾 Save Image"; }
  }
};

window.shareBadgeOnX = async function(id) {
  const b   = BADGE_DEFS.find(x => x.id === id);
  const btn = document.getElementById("badgeShareXBtn");
  if (btn) { btn.disabled = true; btn.textContent = "⏳ Preparing…"; }
  try {
    const { canvas, name } = await buildShareCard(id);
    /* Auto-download image */
    const link = document.createElement("a");
    link.download = `${name.replace(/\s+/g,"-")}-Scan2Moon.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    /* Open Twitter intent */
    const isEarned = new Set(profile.badges || []).has(id);
    const tweet = isEarned
      ? `🏅 Just earned the "${b.name}" badge on Scan2Moon!\n\n${b.desc}\n\nWe don't shill. We show data. 🌙\nhttps://scan2moon.com`
      : `🎯 Working towards the "${b.name}" badge on Scan2Moon!\n\n${b.desc}\n\nhttps://scan2moon.com`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}`, "_blank");
  } catch(e) {
    console.error("Share badge error:", e);
    showToast("⚠️ Could not share — try again.");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg> Share on X`;
    }
  }
};

/* ═══════════════════════════════════════════════════════
   HIGHLIGHT STATS ROW  (Best Trade, Worst Trade, Tasks…)
═══════════════════════════════════════════════════════ */
function renderHighlightStats() {
  const trades   = profile.trades || [];
  const sells    = trades.filter(tr => tr.type === "sell");
  const winSells = sells.filter(tr => (tr.pnl || 0) > 0);
  const losSells = sells.filter(tr => (tr.pnl || 0) < 0);

  const best  = winSells.length  ? winSells.reduce((a, b)  => (b.pnl > a.pnl  ? b : a), winSells[0])  : null;
  const worst = losSells.length  ? losSells.reduce((a, b)  => (b.pnl < a.pnl  ? b : a), losSells[0])  : null;

  const cards = [
    {
      icon: "🏆", label: "BEST TRADE",
      val: best  ? `+${formatSol(best.pnl)}`  : "—",
      sub: best  ? esc(best.symbol  || best.name  || "") : "No wins yet",
      color: "#2cffc9",
    },
    {
      icon: "💀", label: "WORST TRADE",
      val: worst ? formatSol(worst.pnl) : "—",
      sub: worst ? esc(worst.symbol || worst.name || "") : "No losses 🎉",
      color: worst ? "#ff4d6d" : "#2cffc9",
    },
    {
      icon: "✅", label: "TASKS DONE",
      val: "0",
      sub: "coming soon",
      color: "rgba(207,255,244,0.35)",
      soon: true,
    },
    {
      icon: "🎯", label: "DAILY STREAK XP",
      val: "—",
      sub: "coming soon",
      color: "rgba(207,255,244,0.25)",
      soon: true,
    },
    {
      icon: "📊", label: "SCAN ACCURACY",
      val: "—",
      sub: "coming soon",
      color: "rgba(207,255,244,0.25)",
      soon: true,
    },
  ];

  document.getElementById("dashHighlightRow").innerHTML = cards.map(c => `
    <div class="dash-hl-card ${c.soon ? 'soon' : ''}">
      <div class="dash-hl-top-label">${c.label}</div>
      <div class="dash-hl-icon">${c.icon}</div>
      <div class="dash-hl-val" style="color:${c.color}">${c.val}</div>
      <div class="dash-hl-sub">${c.sub}</div>
      ${c.soon ? '<div class="dash-hl-soon-chip">COMING SOON</div>' : ''}
    </div>`).join("");
}

/* ═══════════════════════════════════════════════════════
   APE SIMULATOR QUICK STATS  (6 cards: 2×3 grid)
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
    { label: "BALANCE",      val: formatSol(bal),                    color: "#ffb432" },
    { label: "ALL-TIME P/L", val: `${pnlSign}${formatSol(pnl)}`,     color: pnlCls   },
    { label: "WIN  ✅",      val: wins,                              color: "#2cffc9" },
    { label: "LOSE  ❌",     val: losses,                            color: losses > 0 ? "#ff4d6d" : "rgba(207,255,244,0.4)" },
    { label: "WIN RATE",     val: `${winRate}%`,                     color: parseFloat(winRate) >= 50 ? "#2cffc9" : "#ff4d6d" },
    { label: "TRADES",       val: total,                             color: "#cffff4" },
  ];

  document.getElementById("dashApeStats").innerHTML = cards.map(c => `
    <div class="dash-qs-card">
      <div class="dash-qs-label">${c.label}</div>
      <div class="dash-qs-val" style="color:${c.color}">${c.val}</div>
    </div>`).join("");

  /* ── Donut ring ── */
  const winPct = total > 0 ? Math.round((wins / total) * 100) : 0;
  const donutEl = document.getElementById("dashDonutWrap");
  if (donutEl) {
    donutEl.innerHTML = `
      <div class="dash-donut-ring" style="--win-pct:${winPct}">
        <div class="dash-donut-inner">
          <div class="dash-donut-val">${winRate}%</div>
          <div class="dash-donut-lbl">WIN RATE</div>
        </div>
      </div>
      <div class="dash-donut-legend">
        <span class="dash-donut-dot" style="background:#2cffc9;"></span> WIN ${wins}
        <span class="dash-donut-dot" style="background:rgba(255,77,109,0.7);margin-left:12px;"></span> LOSE ${losses}
      </div>`;
  }
}

/* ═══════════════════════════════════════════════════════
   RECENT ACTIVITY FEED
═══════════════════════════════════════════════════════ */
function renderActivityFeed() {
  const trades       = (profile.trades || []).slice(0, 5);
  const earnedBadges = profile.badges || [];
  const feed = [];

  for (const tr of trades) {
    const isBuy  = tr.type === "buy";
    const pnlSol = !isBuy && tr.pnl !== undefined ? parseFloat(tr.pnl) : null;
    const pnlStr = pnlSol !== null
      ? ` <span style="font-weight:800;color:${pnlSol >= 0 ? '#2cffc9' : '#ff4d6d'}">${pnlSol >= 0 ? '+' : ''}${formatSol(pnlSol)}</span>`
      : "";
    feed.push({
      icon: isBuy ? "🟢" : "🔴",
      text: `${isBuy ? "Bought" : "Sold"} <strong>${esc(tr.symbol || tr.name)}</strong>${pnlStr}`,
      time: timeAgo(tr.timestamp),
    });
  }

  if (earnedBadges.length) {
    const lastBadgeId = earnedBadges[earnedBadges.length - 1];
    const b = BADGE_DEFS.find(x => x.id === lastBadgeId);
    if (b) feed.unshift({ icon: "🏅", text: `Badge unlocked: <strong>${esc(b.name)}</strong>`, time: "recently" });
  }

  document.getElementById("dashActivityFeed").innerHTML = feed.length
    ? feed.map(item => `
        <div class="dash-activity-item">
          <span class="dash-activity-icon">${item.icon}</span>
          <span class="dash-activity-text">${item.text}</span>
          <span class="dash-activity-time">${item.time}</span>
        </div>`).join("")
    : `<div style="text-align:center;padding:20px;opacity:0.4;font-size:13px;">No activity yet — start trading!</div>`;
}

/* ═══════════════════════════════════════════════════════
   TRADE HISTORY  (panel preview — last 10)
═══════════════════════════════════════════════════════ */
function renderTradeHistory() {
  const el     = document.getElementById("dashTradeHistory");
  const trades = (profile.trades || []).slice(0, 10);

  if (!trades.length) {
    el.innerHTML = `<div class="dash-trade-empty">No trades yet — head to the Simulator!</div>`;
    return;
  }

  el.innerHTML = `
    <div class="dash-trade-table">
      <div class="dash-trade-header">
        <div>TYPE</div><div>TOKEN</div><div>AMOUNT</div><div>P/L</div><div>DATE</div>
      </div>
      ${trades.map(tr => buildTradeRow(tr)).join("")}
    </div>`;
}

/* ── Shared row builder (panel + modal) ──────────────── */
function buildTradeRow(tr) {
  const isBuy   = tr.type === "buy";
  const pnlSol  = !isBuy && tr.pnl !== undefined ? parseFloat(tr.pnl) : null;
  const pnlHtml = pnlSol !== null
    ? `<span style="color:${pnlSol>=0?'#2cffc9':'#ff4d6d'};font-weight:800;">${pnlSol>=0?'+':''}${formatSol(pnlSol)}</span>`
    : `<span style="opacity:0.3">—</span>`;
  const amtSol  = isBuy ? (tr.totalCostSol || null) : (tr.totalReceivedSol || null);
  const amtHtml = amtSol !== null ? formatSol(amtSol) : "—";
  const date    = new Date(tr.timestamp).toLocaleDateString(undefined, { month:"short", day:"numeric" });

  return `
    <div class="dash-trade-row">
      <div><span class="dash-trade-badge ${isBuy?'buy':'sell'}">${isBuy?'BUY':'SELL'}</span></div>
      <div>
        <div class="dash-trade-token">${esc(tr.symbol || tr.name)}</div>
        <div class="dash-trade-sym">${esc(tr.name || "")}</div>
      </div>
      <div class="dash-trade-amt">${amtHtml}</div>
      <div class="dash-trade-pnl">${pnlHtml}</div>
      <div style="font-size:10px;opacity:0.35;white-space:nowrap;">${date}</div>
    </div>`;
}

/* ═══════════════════════════════════════════════════════
   P/L BAR CHART  (last 10 sells)
═══════════════════════════════════════════════════════ */
function renderPnlChart() {
  const el    = document.getElementById("dashPnlChart");
  if (!el) return;

  const sells = (profile.trades || [])
    .filter(t => t.type === "sell" && t.pnl !== undefined)
    .slice(0, 10)
    .reverse(); /* oldest → newest, left → right */

  if (sells.length < 2) { el.style.display = "none"; return; }
  el.style.display = "block";

  const vals   = sells.map(t => parseFloat(t.pnl));
  const maxAbs = Math.max(...vals.map(Math.abs), 0.001);

  el.innerHTML = `
    <div class="pnl-chart-title">P/L PER SELL · LAST ${sells.length} TRADES</div>
    <div class="pnl-chart-bars">
      ${sells.map(t => {
        const v    = parseFloat(t.pnl);
        const pct  = Math.max(4, Math.round((Math.abs(v) / maxAbs) * 100));
        const pos  = v >= 0;
        const sym  = (t.symbol || t.name || "").slice(0, 5);
        return `
          <div class="pnl-bar-col">
            <div class="pnl-bar-wrap">
              <div class="pnl-bar ${pos ? 'pos' : 'neg'}" style="height:${pct}%"
                title="${pos ? '+' : ''}${formatSol(v)} — ${esc(t.symbol || t.name || '')}"></div>
            </div>
            <div class="pnl-bar-label">${esc(sym)}</div>
          </div>`;
      }).join("")}
    </div>`;
}

/* ═══════════════════════════════════════════════════════
   FULL TRADE HISTORY MODAL  (all 30, paginated)
═══════════════════════════════════════════════════════ */
const TH_PER_PAGE = 10;
let _thPage = 0;

window.openTradeHistoryModal = function() {
  _thPage = 0;
  document.getElementById("tradeHistModalOverlay")?.remove();

  const overlay = document.createElement("div");
  overlay.className = "th-modal-overlay";
  overlay.id        = "tradeHistModalOverlay";
  overlay.innerHTML = `
    <div class="th-modal-card" id="tradeHistModalCard">
      <div class="th-modal-header">
        <div class="th-modal-title">📋 FULL TRADE HISTORY</div>
        <button class="th-modal-close" onclick="document.getElementById('tradeHistModalOverlay').remove()">✕</button>
      </div>
      <div class="th-modal-body" id="thModalBody"></div>
      <div class="th-modal-pagination" id="thModalPager"></div>
    </div>`;

  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  _renderThPage(0);
};

function _renderThPage(page) {
  const allTrades = profile.trades || [];
  const total     = allTrades.length;
  const pages     = Math.max(1, Math.ceil(total / TH_PER_PAGE));
  _thPage = Math.max(0, Math.min(page, pages - 1));

  const slice = allTrades.slice(_thPage * TH_PER_PAGE, (_thPage + 1) * TH_PER_PAGE);

  const body  = document.getElementById("thModalBody");
  const pager = document.getElementById("thModalPager");
  if (!body || !pager) return;

  /* ── Table ── */
  body.innerHTML = !total
    ? `<div class="dash-trade-empty">No trades yet — start trading in the Simulator!</div>`
    : `<div class="th-modal-count">${total} trade${total!==1?'s':''} saved (max 30)</div>
       <div class="dash-trade-table">
         <div class="dash-trade-header">
           <div>TYPE</div><div>TOKEN</div><div>AMOUNT</div><div>P/L</div><div>DATE</div>
         </div>
         ${slice.map(tr => buildTradeRow(tr)).join("")}
       </div>`;

  /* ── Pagination ── */
  if (pages <= 1) { pager.innerHTML = ""; return; }

  const btns = [];
  btns.push(`<button class="th-pg-btn" ${_thPage===0?"disabled":""} onclick="window._thGoPage(${_thPage-1})">‹</button>`);
  for (let i = 0; i < pages; i++) {
    btns.push(`<button class="th-pg-btn ${i===_thPage?'active':''}" onclick="window._thGoPage(${i})">${i+1}</button>`);
  }
  btns.push(`<button class="th-pg-btn" ${_thPage===pages-1?"disabled":""} onclick="window._thGoPage(${_thPage+1})">›</button>`);

  pager.innerHTML = btns.join("");
}

window._thGoPage = function(page) { _renderThPage(page); };

/* ═══════════════════════════════════════════════════════
   CURRENT HOLDINGS
═══════════════════════════════════════════════════════ */
function renderHoldings() {
  const el       = document.getElementById("dashHoldings");
  const holdings = profile.holdings || {};
  const keys     = Object.keys(holdings).filter(k => (holdings[k]?.amount || 0) > 0.000001);

  if (!keys.length) {
    el.innerHTML = `<div class="dash-holdings-empty">No open positions — start trading in the Simulator!</div>`;
    return;
  }

  el.innerHTML = `<div class="dash-holdings-list">${keys.map(mint => {
    const h       = holdings[mint];
    const logo    = h.logo ? `/.netlify/functions/logoProxy?url=${encodeURIComponent(h.logo)}` : "https://placehold.co/34x34";
    const costSol = h.totalCostSol || 0;
    const safeMnt = String(mint).replace(/[^1-9A-HJ-NP-Za-km-z]/g, "");

    return `
      <div class="dash-holding-row">
        <img class="dash-holding-logo" src="${logo}"
          onerror="this.src='https://placehold.co/34x34'" />
        <div class="dash-holding-info">
          <div class="dash-holding-name">${esc(h.name || h.symbol)}</div>
          <div class="dash-holding-sym">${esc(h.symbol)}</div>
        </div>
        <div style="text-align:right;">
          <div class="dash-holding-cost">${formatSol(costSol)}</div>
          <div class="dash-holding-pnl" style="color:rgba(207,255,244,0.3);font-size:10px;">cost basis</div>
        </div>
        <a class="dash-holding-btn" href="safe-ape.html"
          onclick="localStorage.setItem('sa_prefill_mint','${safeMnt}')">
          Trade →
        </a>
      </div>`;
  }).join("")}</div>`;
}

/* ═══════════════════════════════════════════════════════
   LEADERBOARD PREVIEW
═══════════════════════════════════════════════════════ */
const FAKE_LEADERBOARD = [
  { rank:1, name:"MoonWalker",   level:12, winRate:78.4, pnl: 847.3 },
  { rank:2, name:"DeFi Phantom", level:11, winRate:71.2, pnl: 612.8 },
  { rank:3, name:"SolNinja",     level:10, winRate:68.9, pnl: 489.5 },
  { rank:4, name:"ApeKing",      level: 9, winRate:65.1, pnl: 334.2 },
  { rank:5, name:"RiskHunter",   level: 8, winRate:61.7, pnl: 218.6 },
];

function renderLeaderboard() {
  const el = document.getElementById("dashLeaderboard");
  if (!el) return;

  const wins    = profile.winCount   || 0;
  const losses  = profile.lossCount  || 0;
  const total   = wins + losses;
  const winRate = total > 0 ? parseFloat(((wins / total) * 100).toFixed(1)) : 0;
  const pnl     = profile.totalPnL   || 0;
  const xp      = (total * 25) + ((profile.badges || []).length * 50) + ((profile.loginStreak || 0) * 5);
  const lvl     = calcLevel(xp);

  /* Insert user at correct position vs fake list */
  const userRank  = FAKE_LEADERBOARD.filter(e => e.pnl > pnl).length + 1;
  const userEntry = { rank: userRank, name: profile.accountName || "You", level: lvl, winRate, pnl, isUser: true };

  /* Build display rows: top 5 fakes + user if outside top 5 */
  const rows     = FAKE_LEADERBOARD.slice(0, 5).map(e => ({ ...e, isUser: false }));
  const inTop5   = userRank <= 5;
  if (inTop5) {
    rows.splice(userRank - 1, 0, userEntry);
    rows.length = Math.min(rows.length, 6);
  }
  const medals = ["🥇","🥈","🥉"];

  const rowHtml = r => `
    <div class="dash-lb-row ${r.isUser ? 'is-user' : ''}">
      <div class="dash-lb-rank">${r.rank <= 3 ? medals[r.rank - 1] : `#${r.rank}`}</div>
      <div class="dash-lb-name">${r.isUser
        ? `<span style="color:#2cffc9;">▶ ${esc(r.name)}</span>`
        : esc(r.name)}</div>
      <div class="dash-lb-lvl">LVL ${r.level}</div>
      <div class="dash-lb-wr" style="color:${r.winRate>=50?'#2cffc9':'#ff4d6d'}">${r.winRate}%</div>
      <div class="dash-lb-pnl" style="color:${r.pnl>=0?'#2cffc9':'#ff4d6d'}">${r.pnl>=0?'+':''}${formatSol(r.pnl)}</div>
    </div>`;

  el.innerHTML = `
    <div class="dash-lb-table">
      <div class="dash-lb-header"><div>RANK</div><div>TRADER</div><div>LVL</div><div>WIN%</div><div>P/L</div></div>
      ${rows.map(rowHtml).join("")}
      ${!inTop5 ? `
        <div class="dash-lb-sep">• • •</div>
        ${rowHtml(userEntry)}` : ""}
    </div>
    <div class="dash-lb-footer">Full leaderboard — <span style="color:rgba(255,180,50,0.75);">coming soon</span></div>`;
}

/* ═══════════════════════════════════════════════════════
   SHAREABLE PROFILE CARD
═══════════════════════════════════════════════════════ */
async function buildProfileShareCard() {
  const wins    = profile.winCount  || 0;
  const losses  = profile.lossCount || 0;
  const total   = wins + losses;
  const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : "0";
  const pnl     = profile.totalPnL  || 0;
  const xp      = (total * 25) + ((profile.badges || []).length * 50) + ((profile.loginStreak || 0) * 5);
  const lvl     = calcLevel(xp);
  const short   = wallet ? wallet.slice(0, 6) + "…" + wallet.slice(-4) : "";
  const badges  = (profile.badges || []).length;
  const best    = (profile.trades || [])
    .filter(t => t.type === "sell" && (t.pnl || 0) > 0)
    .reduce((a, b) => (b.pnl > (a?.pnl || 0) ? b : a), null);

  document.getElementById("profileShareCard")?.remove();

  const card = document.createElement("div");
  card.id = "profileShareCard";
  card.innerHTML = `
    <div class="psc-header">
      <span class="psc-logo">🌙 SCAN2MOON</span>
      <span class="psc-tag">TRADER PROFILE</span>
    </div>
    <div class="psc-avatar">🦍</div>
    <div class="psc-name">${esc(profile.accountName || "Ape Trader")}</div>
    <div class="psc-rank-badge">${rankLabel(pnl)}</div>
    <div class="psc-level">LVL ${lvl}</div>
    <div class="psc-stats-grid">
      <div class="psc-stat">
        <div class="psc-stat-val" style="color:${pnl>=0?'#2cffc9':'#ff4d6d'}">${pnl>=0?'+':''}${formatSol(pnl)}</div>
        <div class="psc-stat-lbl">ALL-TIME P/L</div>
      </div>
      <div class="psc-stat">
        <div class="psc-stat-val" style="color:${parseFloat(winRate)>=50?'#2cffc9':'#ff4d6d'}">${winRate}%</div>
        <div class="psc-stat-lbl">WIN RATE</div>
      </div>
      <div class="psc-stat">
        <div class="psc-stat-val">${total}</div>
        <div class="psc-stat-lbl">TRADES</div>
      </div>
      <div class="psc-stat">
        <div class="psc-stat-val" style="color:#ffb432">${badges}</div>
        <div class="psc-stat-lbl">BADGES</div>
      </div>
    </div>
    ${best ? `<div class="psc-best">🏆 Best trade: <strong>+${formatSol(best.pnl)}</strong> on ${esc(best.symbol || best.name || "")}</div>` : ""}
    <div class="psc-wallet">${short}</div>
    <div class="psc-footer">scan2moon.com · We don't shill. We show data. 🌙</div>`;

  document.body.appendChild(card);
  await new Promise(r => setTimeout(r, 140));

  const canvas = await html2canvas(card, {
    backgroundColor: "#040f0d", scale: 2,
    useCORS: true, allowTaint: true, logging: false,
  });
  card.remove();
  return canvas;
}

window.shareProfileCard = async function() {
  const btn = document.getElementById("dashProfileShareBtn");
  if (btn) { btn.disabled = true; btn.textContent = "⏳ Saving…"; }
  try {
    const canvas = await buildProfileShareCard();
    /* Auto-download */
    const link = document.createElement("a");
    link.download = "Scan2Moon-Profile.png";
    link.href     = canvas.toDataURL("image/png");
    link.click();
    /* Open tweet */
    const pnl     = profile.totalPnL || 0;
    const wins    = profile.winCount  || 0;
    const losses  = profile.lossCount || 0;
    const total   = wins + losses;
    const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : "0";
    const xp      = (total * 25) + ((profile.badges || []).length * 50) + ((profile.loginStreak || 0) * 5);
    const lvl     = calcLevel(xp);
    const tweet   = `📊 My Scan2Moon Stats:\n\n${rankLabel(pnl)} · LVL ${lvl}\n💰 P/L: ${pnl>=0?'+':''}${formatSol(pnl)}\n🎯 Win Rate: ${winRate}%\n🏅 Badges: ${(profile.badges||[]).length}\n\nWe don't shill. We show data. 🌙\nhttps://scan2moon.com`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}`, "_blank");
    showToast("✅ Profile card saved — tweet is opening!");
  } catch (e) {
    console.error("Profile share error:", e);
    showToast("⚠️ Could not save — try again.");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "📸 Share Stats"; }
  }
};

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
