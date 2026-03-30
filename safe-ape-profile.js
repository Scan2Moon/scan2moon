/* ============================================================
   Scan2Moon – safe-ape-profile.js  (V2.0)
   Safe Ape Simulator — Profile Page
   ============================================================ */

import { renderNav } from "./nav.js";
import "./community.js";

const SIM_API = "/.netlify/functions/simulator";
const DEX_API = "https://api.dexscreener.com/latest/dex/tokens/";

/* ─────────────────────────────────────
   TRADE HISTORY PAGINATION
───────────────────────────────────── */
const TRADES_PAGE_SIZE = 15;
let tradesCurrentPage  = 0;

/* ─────────────────────────────────────
   BADGE REWARD AMOUNTS  (must match simulator.js BADGE_REWARD_OVERRIDES)
───────────────────────────────────── */
const BADGE_REWARDS = {
  wins_50:              0.5,
  wins_100:             1.0,
  wins_500:             2.0,
  wins_1000:            5.0,
  sol2moon_millionaire: 500.0,
};
const DEFAULT_BADGE_REWARD = 0.1;
function badgeReward(id) { return BADGE_REWARDS[id] ?? DEFAULT_BADGE_REWARD; }
function fmtBadgeReward(id) {
  return formatSol(badgeReward(id));
}

/* ─────────────────────────────────────
   BADGE DEFINITIONS
───────────────────────────────────── */
const BADGE_DEFS = [
  { id: "first_profit",    img: "/badges/First_Profit.png",    icon: "🏆", name: "First Profit",          desc: "Make your first profitable trade" },
  { id: "win_streak_5",   img: "/badges/win_streak_5.png",    icon: "🔥", name: "Win Streak ×5",         desc: "Win 5 trades in a row" },
  { id: "safe_trader",    img: "/badges/Safe_Trader.png",     icon: "🛡️", name: "Safe Trader",            desc: "Buy 10 tokens with entry risk score ≥ 65" },
  { id: "diamond_hands",  img: "/badges/Diamond_Hands.png",   icon: "💎", name: "Diamond Hands",          desc: "Hold a token for 7+ days" },
  { id: "degen_survivor", img: "/badges/Degen_Survivor.png",  icon: "🦍", name: "Degen Survivor",         desc: "Profit 10× on tokens with risk score < 45 (1 sell per buy)" },
  { id: "portfolio_100",  img: "/badges/portfolio_100.png",   icon: "📈", name: "100% Growth",            desc: "Double your 10 SOL starting balance" },
  { id: "wins_25",        img: "/badges/Wins_25.png",         icon: "⭐", name: "25 Safe Wins",           desc: "Close 25 profitable trades" },
  { id: "wins_50",        img: "/badges/Wins_50.png",         icon: "🌟", name: "50 Safe Wins",           desc: "Close 50 profitable trades" },
  { id: "wins_100",       img: "/badges/Wins_100.png",        icon: "💫", name: "100 Safe Wins",          desc: "Close 100 profitable trades" },
  { id: "wins_500",       img: "/badges/Wins_500.png",        icon: "🚀", name: "500 Safe Wins",          desc: "Close 500 profitable trades" },
  { id: "wins_1000",      img: "/badges/Wins_1000.png",       icon: "🐐", name: "1000 Safe Wins — GOAT",  desc: "Become the absolute GOAT" },
  { id: "sol2moon_millionaire", img: "/badges/Sol2Moon.png",   icon: "🌙", name: "Sol2Moon Millionaire",    desc: "Reach 10,000 SOL" },
];

let wallet           = null;
let profile          = null;
let livePrices       = {};
let profilePollTimer = null;
let solPrice         = 0;

const SOL_LOGO = "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png";

async function fetchSolPrice() {
  try {
    const r = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT");
    const d = await r.json();
    const p = parseFloat(d.price);
    if (p > 0) { solPrice = p; return; }
  } catch {}
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd");
    const d = await r.json();
    const p = d?.solana?.usd;
    if (p > 0) solPrice = p;
  } catch (e) { console.warn("SOL price fetch failed:", e); }
}

function formatSol(n) {
  if (n === null || n === undefined || isNaN(n)) return "0 SOL";
  const abs = Math.abs(n);
  if (abs === 0)    return "0 SOL";
  if (abs < 0.001)  return n.toFixed(6) + " SOL";
  if (abs < 0.1)    return n.toFixed(4) + " SOL";
  if (abs < 10)     return n.toFixed(3) + " SOL";
  return n.toFixed(2) + " SOL";
}

/* ─────────────────────────────────────
   INIT
───────────────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {
  renderNav();

  // Allow shared profile link: ?wallet=ADDRESS
  const urlParams = new URLSearchParams(window.location.search);
  const sharedWallet = urlParams.get("wallet");
  const saved = localStorage.getItem("sa_wallet");
  if (sharedWallet) {
    wallet = sharedWallet;
    loadProfile(true); // view-only mode
  } else if (saved) {
    wallet = saved;
    loadProfile();
  }

  document.getElementById("profileConnectBtn").addEventListener("click", connectWallet);
  document.getElementById("profileDisconnectBtn").addEventListener("click", disconnect);
  document.getElementById("resetAccountBtn").addEventListener("click", resetAccount);
});

/* ─────────────────────────────────────
   WALLET CONNECT
───────────────────────────────────── */
async function connectWallet() {
  const btn = document.getElementById("profileConnectBtn");
  document.getElementById("profileConnectText").textContent = "⏳ Connecting…";
  btn.disabled = true;

  try {
    const phantom = window.solana;
    if (!phantom || !phantom.isPhantom) {
      alert("Phantom wallet not found!\n\nPlease install Phantom from phantom.app and refresh.");
      return;
    }
    const resp = await phantom.connect();
    wallet = resp.publicKey.toString();
    localStorage.setItem("sa_wallet", wallet);
    await loadProfile();
  } catch (e) {
    alert("Wallet connection cancelled or failed.");
  } finally {
    document.getElementById("profileConnectText").textContent = "🔗 Connect Phantom Wallet";
    btn.disabled = false;
  }
}

function disconnect() {
  wallet = null;
  profile = null;
  livePrices = {};
  clearInterval(profilePollTimer); profilePollTimer = null;
  localStorage.removeItem("sa_wallet");
  document.getElementById("profileGate").style.display = "block";
  document.getElementById("profileApp").style.display  = "none";
  try { window.solana?.disconnect(); } catch {}
}

/* ─────────────────────────────────────
   LOAD PROFILE
───────────────────────────────────── */
async function loadProfile(viewOnly = false) {
  try {
    await fetchSolPrice();
    setInterval(fetchSolPrice, 60_000);
    const resp = await fetch(`${SIM_API}?wallet=${wallet}`);
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    profile = data.profile;

    document.getElementById("profileGate").style.display = "none";
    document.getElementById("profileApp").style.display  = "block";

    // View-only: hide edit controls, show view-only banner
    if (viewOnly) {
      const banner = document.createElement("div");
      banner.style.cssText = "background:rgba(255,180,50,0.1);border:1px solid rgba(255,180,50,0.3);border-radius:10px;padding:10px 18px;font-size:13px;font-weight:600;color:#ffb432;margin-bottom:16px;text-align:center;";
      banner.textContent = "👀 Viewing shared profile — read only";
      document.getElementById("profileApp").prepend(banner);
      // Hide reset/disconnect buttons for view-only
      const resetBtn = document.getElementById("resetAccountBtn");
      const discBtn  = document.getElementById("profileDisconnectBtn");
      if (resetBtn) resetBtn.style.display = "none";
      if (discBtn)  discBtn.style.display  = "none";
    }

    renderProfileCard();
    renderStats();
    renderBadges();
    renderHoldings();
    tradesCurrentPage = 0;
    renderTrades();
    if (!viewOnly) startProfilePricePoll();
  } catch (e) {
    console.error("Profile load failed:", e);
    alert("Failed to load profile. Make sure netlify dev is running.");
  }
}

/* ─────────────────────────────────────
   LIVE PRICE POLLING FOR HOLDINGS
───────────────────────────────────── */
function startProfilePricePoll() {
  clearInterval(profilePollTimer);
  fetchProfilePrices(); /* immediate first fetch */
  profilePollTimer = setInterval(fetchProfilePrices, 20000);
}

async function fetchProfilePrices() {
  if (!profile) return;
  const holdings = profile.holdings || {};
  const mints = Object.keys(holdings).filter(k => holdings[k].amount > 0.000001);
  if (!mints.length) return;

  // Fetch in batches of 100 via Jupiter Price API (direct mint→price, no ambiguity)
  for (let i = 0; i < mints.length; i += 100) {
    const slice = mints.slice(i, i + 100);
    let fetched = false;

    // Primary: Jupiter Price API v2
    try {
      const res  = await fetch(`https://api.jup.ag/price/v2?ids=${slice.join(",")}`);
      if (res.ok) {
        const data = await res.json();
        for (const [mint, info] of Object.entries(data.data || {})) {
          const price = parseFloat(info?.price || "0");
          if (price > 0) { livePrices[mint] = price; fetched = true; }
        }
      }
    } catch(e) {
      console.warn("Jupiter price fetch error:", e);
    }

    // Fallback: DexScreener (handles tokens not on Jupiter)
    if (!fetched) {
      try {
        const res  = await fetch(`${DEX_API}${slice.join(",")}`);
        const data = await res.json();
        for (const p of data.pairs || []) {
          if (p.chainId !== "solana") continue;
          const price = parseFloat(p.priceUsd || "0");
          if (price <= 0) continue;
          // Map price to whichever token in the pair is our holding
          const baseAddr  = p.baseToken?.address;
          const quoteAddr = p.quoteToken?.address;
          if (baseAddr  && slice.includes(baseAddr)  && !livePrices[baseAddr])  livePrices[baseAddr]  = price;
          if (quoteAddr && slice.includes(quoteAddr) && !livePrices[quoteAddr] && p.priceNative > 0) {
            livePrices[quoteAddr] = 1 / parseFloat(p.priceNative);
          }
        }
      } catch(e) {
        console.warn("DexScreener fallback error:", e);
      }
    }
  }
  updateProfilePnlCards();
}

function updateProfilePnlCards() {
  if (!profile) return;
  const holdings = profile.holdings || {};
  let totalCurValSol = 0;
  let totalCostSolAll = 0;
  for (const [mint, h] of Object.entries(holdings)) {
    if (!h || h.amount <= 0.000001) continue;
    const price = livePrices[mint];
    if (!price) continue;
    const costSol   = h.totalCostSol || 0;
    // curValSol uses price ratio — immune to solPrice API errors
    const curValSol = (h.avgPrice > 0 && costSol > 0) ? costSol * (price / h.avgPrice) : costSol;
    const curValUsd = solPrice > 0 ? curValSol * solPrice : price * h.amount;
    // P/L = actual SOL value change
    const pnlSol    = curValSol - costSol;
    const pnlPct    = costSol > 0 ? (pnlSol / costSol) * 100 : 0;
    const sign      = pnlSol >= 0 ? "+" : "";
    const cl        = pnlSol >= 0 ? "#2cffc9" : "#ff4d6d";
    totalCurValSol += curValSol;
    totalCostSolAll += costSol;

    const pnlEl = document.getElementById(`prof-pnl-${mint}`);
    const valEl = document.getElementById(`prof-curval-${mint}`);
    const dotEl = document.getElementById(`prof-dot-${mint}`);
    if (pnlEl) {
      pnlEl.textContent = `${sign}${formatSol(pnlSol)} (${sign}${pnlPct.toFixed(2)}%)`;
      pnlEl.style.color = cl;
    }
    if (valEl) {
      valEl.textContent = formatSol(curValSol);
      valEl.style.color = "#cffff4";
    }
    // Flash the live dot green to confirm update
    if (dotEl) {
      dotEl.style.color = "#2cffc9";
      dotEl.textContent = "⬤ LIVE · updated";
      clearTimeout(dotEl._t);
      dotEl._t = setTimeout(() => { dotEl.textContent = "⬤ LIVE · 20s"; dotEl.style.color = ""; }, 2000);
    }
  }

  // Update Portfolio Growth with live prices (cash + live holdings value vs 10 SOL start)
  const growthEl = document.getElementById("profPortfolioGrowth");
  if (growthEl && totalCurValSol > 0) {
    const totalNow = (profile.balance || 0) + totalCurValSol;
    const growth   = ((totalNow - 10) / 10) * 100;
    const sign     = growth >= 0 ? "+" : "";
    const cl       = growth >= 0 ? "#2cffc9" : "#ff4d6d";
    growthEl.textContent  = `${sign}${growth.toFixed(2)}%`;
    growthEl.style.color  = cl;
  }
}

/* ─────────────────────────────────────
   PROFILE CARD
───────────────────────────────────── */
function renderProfileCard() {
  const el     = document.getElementById("profileCardBody");
  const short  = wallet.slice(0, 6) + "…" + wallet.slice(-6);
  const joined = new Date(profile.createdAt).toLocaleDateString("en-US", { year:"numeric", month:"long", day:"numeric" });
  const pnl        = profile.totalPnL   || 0;
  const pnlCls     = pnl >= 0 ? "#2cffc9" : "#ff4d6d";
  const pnlSign    = pnl >= 0 ? "+" : "";
  const tradeWins  = profile.winCount   || 0;
  const tradeLoss  = profile.lossCount  || 0;
  const tradeTotal = tradeWins + tradeLoss;

  // Rank badge based on total P/L (now in SOL)
  let rank, rankColor;
  if (pnl > 50)        { rank = "🏆 LEGENDARY APE";  rankColor = "#ffd166"; }
  else if (pnl > 10)   { rank = "💎 DIAMOND HANDS";  rankColor = "#82b4ff"; }
  else if (pnl > 1)    { rank = "🟢 SMART MONEY";    rankColor = "#2cffc9"; }
  else if (pnl > 0)    { rank = "📈 PROFITABLE APE"; rankColor = "#7fffe1"; }
  else if (pnl > -2)   { rank = "🙈 LEARNING APE";   rankColor = "#ffd166"; }
  else                 { rank = "💀 RUG SURVIVOR";    rankColor = "#ff4d6d"; }

  el.innerHTML = `
    <div style="display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start;">

      <!-- Avatar block -->
      <div style="width:140px;background:rgba(0,0,0,0.35);border:1px solid rgba(255,180,50,0.2);border-radius:14px;padding:20px 16px;text-align:center;flex-shrink:0;">
        <div style="font-size:52px;margin-bottom:10px;filter:drop-shadow(0 0 12px rgba(255,180,50,0.4))">🦍</div>
        <div style="font-size:15px;font-weight:800;color:#ffb432;margin-bottom:6px;">${profile.accountName}</div>
        <div style="font-size:12px;font-weight:700;color:${rankColor};margin-bottom:4px;">${rank}</div>
        <div style="font-size:10px;opacity:0.4;">🔥 ${profile.loginStreak || 0} day streak</div>
      </div>

      <!-- Info -->
      <div style="flex:1;min-width:200px;">

        <!-- Name edit -->
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;padding:10px 14px;background:rgba(255,180,50,0.05);border:1px solid rgba(255,180,50,0.15);border-radius:10px;">
          <input id="nameInput" value="${profile.accountName}" maxlength="24"
            style="flex:1;background:transparent;border:none;outline:none;color:#cffff4;font-size:14px;font-weight:600;" />
          <button id="saveNameBtn" onclick="saveName()"
            style="padding:5px 14px;background:linear-gradient(135deg,#ffb432,#ff8c00);border:none;border-radius:7px;color:#1a0a00;font-size:12px;font-weight:700;cursor:pointer;">
            Save
          </button>
        </div>

        <!-- Wallet + dates -->
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
          <span style="font-family:monospace;font-size:13px;color:#7fffe1;opacity:0.8;">${short}</span>
          <button onclick="navigator.clipboard.writeText('${wallet}')" style="padding:3px 10px;font-size:11px;font-weight:700;background:rgba(44,255,201,0.08);border:1px solid rgba(44,255,201,0.25);border-radius:6px;color:#2cffc9;cursor:pointer;">Copy</button>
          <a href="https://solscan.io/account/${wallet}" target="_blank" rel="noopener noreferrer" style="padding:3px 10px;font-size:11px;font-weight:700;background:rgba(44,255,201,0.08);border:1px solid rgba(44,255,201,0.25);border-radius:6px;color:#2cffc9;text-decoration:none;">Solscan ↗</a>
          <button onclick="copyProfileLink('${wallet}')" id="copyProfileLinkBtn" style="padding:3px 10px;font-size:11px;font-weight:700;background:rgba(255,180,50,0.1);border:1px solid rgba(255,180,50,0.35);border-radius:6px;color:#ffb432;cursor:pointer;">🔗 Share Profile</button>
        </div>

        <div style="font-size:12px;opacity:0.45;margin-bottom:16px;">Member since ${joined}</div>

        <!-- Key stats row -->
        <div style="display:flex;flex-direction:column;gap:8px;">

          <!-- Row 1: Balance + P/L -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div style="background:rgba(0,0,0,0.3);border:1px solid rgba(44,255,201,0.1);border-radius:10px;padding:12px;text-align:center;">
              <div style="font-size:10px;opacity:0.5;letter-spacing:0.5px;margin-bottom:5px;">BALANCE</div>
              <div style="font-size:18px;font-weight:800;color:#ffb432;">${formatSol(profile.balance)}</div>
              ${solPrice>0?`<div style="font-size:11px;opacity:0.4;">≈ ${formatUsd(profile.balance*solPrice)}</div>`:''}
            </div>
            <div style="background:rgba(0,0,0,0.3);border:1px solid rgba(44,255,201,0.1);border-radius:10px;padding:12px;text-align:center;">
              <div style="font-size:10px;opacity:0.5;letter-spacing:0.5px;margin-bottom:5px;">ALL-TIME P/L</div>
              <div style="font-size:18px;font-weight:800;color:${pnlCls};">${pnlSign}${formatSol(pnl)}</div>
            </div>
          </div>

          <!-- Row 2: WIN / LOSE / TOTAL -->
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
            <div style="background:rgba(44,255,100,0.06);border:1px solid rgba(44,255,100,0.2);border-radius:10px;padding:12px;text-align:center;">
              <div style="font-size:10px;letter-spacing:0.5px;margin-bottom:5px;color:#2cff64;font-weight:700;">WIN</div>
              <div style="font-size:22px;font-weight:800;color:#2cff64;">${tradeWins}</div>
            </div>
            <div style="background:rgba(255,77,109,0.06);border:1px solid rgba(255,77,109,0.2);border-radius:10px;padding:12px;text-align:center;">
              <div style="font-size:10px;letter-spacing:0.5px;margin-bottom:5px;color:#ff4d6d;font-weight:700;">LOSE</div>
              <div style="font-size:22px;font-weight:800;color:#ff4d6d;">${tradeLoss}</div>
            </div>
            <div style="background:rgba(0,0,0,0.3);border:1px solid rgba(44,255,201,0.1);border-radius:10px;padding:12px;text-align:center;">
              <div style="font-size:10px;opacity:0.5;letter-spacing:0.5px;margin-bottom:5px;">TOTAL</div>
              <div style="font-size:22px;font-weight:800;color:#cffff4;">${tradeTotal}</div>
            </div>
          </div>

        </div>
      </div>
    </div>
  `;
}

/* ─────────────────────────────────────
   SAVE NAME
───────────────────────────────────── */
window.saveName = async function() {
  const name = document.getElementById("nameInput").value.trim();
  if (!name) return;
  try {
    const resp = await fetch(SIM_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet, action: "update_name", accountName: name })
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    profile = data.profile;
    renderProfileCard();
    showToast("✅ Name updated!");
  } catch (e) {
    showToast("⚠️ Failed to save name.");
  }
};

/* ─────────────────────────────────────
   ACHIEVEMENT BADGES
───────────────────────────────────── */
function renderBadges() {
  const el = document.getElementById("profileBadgesBody");
  if (!el) return;

  const earned = new Set(profile.badges || []);
  const earnedCount = earned.size;
  const total = BADGE_DEFS.length;

  const cards = BADGE_DEFS.map(b => {
    const isEarned = earned.has(b.id);
    return `
      <div class="prof-badge-card ${isEarned ? "earned" : "locked"}">
        <div class="prof-badge-reward-tag">+${fmtBadgeReward(b.id)}</div>
        <div class="prof-badge-icon-big">
          <img class="prof-badge-img" src="${b.img}" alt="${b.name}" onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
          <span class="prof-badge-img-fallback" style="display:none">${b.icon}</span>
        </div>
        <div class="prof-badge-name">${b.name}</div>
        <div class="prof-badge-desc">${b.desc}</div>
        ${isEarned
          ? `<div class="prof-badge-earned-tag">✅ Earned</div>`
          : `<div class="prof-badge-locked-tag">🔒 Not yet earned</div>`}
      </div>`;
  }).join("");

  const progressPct = total > 0 ? Math.round((earnedCount / total) * 100) : 0;

  el.innerHTML = `
    <!-- Progress bar -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div style="font-size:13px;font-weight:600;color:#cffff4;">
        ${earnedCount} / ${total} badges earned
        <span style="margin-left:8px;font-size:12px;color:#ffb432;font-weight:700;display:inline-flex;align-items:center;gap:4px;"><img src="${SOL_LOGO}" class="s2m-token-icon" style="width:16px;height:16px;border-radius:50%;"> +${formatSol([...earned].reduce((s, id) => s + badgeReward(id), 0))} earned</span>
      </div>
      <div style="font-size:11px;opacity:0.5;">${progressPct}% complete</div>
    </div>
    <div style="background:rgba(255,255,255,0.06);border-radius:4px;height:6px;margin-bottom:18px;overflow:hidden;">
      <div style="height:100%;width:${progressPct}%;background:linear-gradient(90deg,#ffb432,#ff8c00);border-radius:4px;transition:width 0.6s ease;"></div>
    </div>
    <div class="prof-badges-grid">${cards}</div>`;
}

/* ─────────────────────────────────────
   STATS PANEL
───────────────────────────────────── */
function renderStats() {
  const el      = document.getElementById("profileStatsBody");
  const trades  = profile.trades || [];
  const wins    = profile.winCount  || 0;
  const losses  = profile.lossCount || 0;
  const total   = wins + losses;
  const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : "0";
  const pnl     = profile.totalPnL || 0;
  const pnlSign = pnl >= 0 ? "+" : "";
  const pnlCls  = pnl >= 0 ? "#2cffc9" : "#ff4d6d";

  // Best trade = only profitable sells; worst = only losing sells
  const sells     = trades.filter(t => t.type === "sell");
  const winSells  = sells.filter(t => (t.pnl || 0) > 0);
  const lossSells = sells.filter(t => (t.pnl || 0) < 0);
  const bestTrade  = winSells.length  ? winSells.reduce((a, b)  => (b.pnl > a.pnl ? b : a), winSells[0])  : null;
  const worstTrade = lossSells.length ? lossSells.reduce((a, b) => (b.pnl < a.pnl ? b : a), lossSells[0]) : null;

  // Portfolio Growth: cash balance + cost basis of open holdings vs 10 SOL start.
  // updateProfilePnlCards() will upgrade this to live value once prices load.
  const startBalance = 10;
  const openCost = Object.values(profile.holdings || {})
    .filter(h => h.amount > 0.000001)
    .reduce((s, h) => s + (h.totalCostSol || 0), 0);
  const portfolioGrowth = (((profile.balance + openCost) - startBalance) / startBalance * 100).toFixed(2);
  const growthSign = portfolioGrowth >= 0 ? "+" : "";
  const growthCls  = portfolioGrowth >= 0 ? "#2cffc9" : "#ff4d6d";

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px;">
      <div class="prof-stat-card">
        <div class="prof-stat-label">Win Rate</div>
        <div class="prof-stat-val" style="color:${parseFloat(winRate)>=50?'#2cffc9':'#ff4d6d'}">${winRate}%</div>
        <div class="prof-stat-sub">${wins}W / ${losses}L</div>
      </div>
      <div class="prof-stat-card">
        <div class="prof-stat-label">Realised P/L</div>
        <div class="prof-stat-val" style="color:${pnlCls}">${pnlSign}${formatSol(pnl)}</div>
        <div class="prof-stat-sub">from closed trades</div>
      </div>
      <div class="prof-stat-card">
        <div class="prof-stat-label">Portfolio Growth</div>
        <div class="prof-stat-val" id="profPortfolioGrowth" style="color:${growthCls}">${growthSign}${portfolioGrowth}%</div>
        <div class="prof-stat-sub">vs 10 SOL start</div>
      </div>
      <div class="prof-stat-card">
        <div class="prof-stat-label">Login Streak</div>
        <div class="prof-stat-val" style="color:#ff9a60">🔥 ${profile.loginStreak || 0}</div>
        <div class="prof-stat-sub">days in a row</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div style="background:rgba(44,255,201,0.04);border:1px solid rgba(44,255,201,0.12);border-radius:10px;padding:14px;">
        <div style="font-size:11px;opacity:0.5;margin-bottom:8px;letter-spacing:0.5px;">🏆 BEST TRADE</div>
        ${bestTrade
          ? `<div style="font-weight:700;color:#cffff4;margin-bottom:4px;">${bestTrade.symbol}</div>
             <div style="font-size:18px;font-weight:800;color:${bestTrade.pnl >= 0 ? '#2cffc9' : '#ff4d6d'};">${bestTrade.pnl >= 0 ? '+' : ''}${formatSol(bestTrade.pnl)}</div>
             <div style="font-size:11px;opacity:0.45;">${new Date(bestTrade.timestamp).toLocaleDateString()}</div>`
          : `<div style="opacity:0.4;font-size:13px;">No closed trades yet</div>`}
      </div>
      <div style="background:rgba(255,77,109,0.04);border:1px solid rgba(255,77,109,0.12);border-radius:10px;padding:14px;">
        <div style="font-size:11px;opacity:0.5;margin-bottom:8px;letter-spacing:0.5px;">💀 WORST TRADE</div>
        ${worstTrade && worstTrade.pnl < 0
          ? `<div style="font-weight:700;color:#cffff4;margin-bottom:4px;">${worstTrade.symbol}</div>
             <div style="font-size:18px;font-weight:800;color:#ff4d6d;">${formatSol(worstTrade.pnl)}</div>
             <div style="font-size:11px;opacity:0.45;">${new Date(worstTrade.timestamp).toLocaleDateString()}</div>`
          : `<div style="opacity:0.4;font-size:13px;">No losses yet 🎉</div>`}
      </div>
    </div>
  `;
}

/* ─────────────────────────────────────
   HOLDINGS
───────────────────────────────────── */
function renderHoldings() {
  const el       = document.getElementById("profileHoldingsBody");
  const holdings = profile.holdings || {};
  const keys     = Object.keys(holdings).filter(k => holdings[k].amount > 0.000001);

  if (!keys.length) {
    el.innerHTML = `<div style="text-align:center;padding:30px;opacity:0.5;">No open positions — <a href="safe-ape.html" style="color:#ffb432;">start trading</a></div>`;
    return;
  }

  const rows = keys.map(mint => {
    const h         = holdings[mint];
    const logo      = h.logo ? `/.netlify/functions/logoProxy?url=${encodeURIComponent(h.logo)}` : "https://placehold.co/36x36";
    const price     = livePrices[mint];
    const costSol   = h.totalCostSol || 0;
    // curValSol uses price ratio — immune to solPrice API errors
    const curValSol = (price && h.avgPrice > 0 && costSol > 0) ? costSol * (price / h.avgPrice) : null;
    const curValUsd = curValSol !== null && solPrice > 0 ? curValSol * solPrice : (price ? price * h.amount : null);
    // P/L = actual SOL value change
    const pnlSol    = curValSol !== null ? curValSol - costSol : null;
    const pnlPct    = pnlSol !== null && costSol > 0 ? (pnlSol / costSol) * 100 : null;
    const sign      = pnlSol !== null ? (pnlSol >= 0 ? "+" : "") : "";
    const cl        = pnlSol !== null ? (pnlSol >= 0 ? "#2cffc9" : "#ff4d6d") : "#7fffe1";
    const pnlText   = pnlSol !== null
      ? `${sign}${formatSol(pnlSol)} (${sign}${pnlPct.toFixed(2)}%)`
      : "⬤ Loading…";

    return `
      <div style="display:grid;grid-template-columns:1fr 120px 120px 170px 100px;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid rgba(44,255,201,0.06);font-size:13px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <img src="${logo}" onerror="this.src='https://placehold.co/36x36'" style="width:36px;height:36px;border-radius:50%;border:1px solid rgba(44,255,201,0.2);object-fit:cover;" />
          <div>
            <div style="font-weight:600;color:#cffff4;">${h.name}</div>
            <div style="font-size:11px;opacity:0.5;">${h.symbol}</div>
          </div>
        </div>
        <div>
          <div style="font-weight:600;color:#7fffe1;" id="prof-curval-${mint}">${curValSol !== null ? formatSol(curValSol) : formatSol(costSol)}</div>
          <div style="font-size:11px;opacity:0.5;">${formatSol(costSol)} cost</div>
        </div>
        <div>
          <div style="font-size:12px;opacity:0.6;">${formatAmount(h.amount)} tokens</div>
          <div style="font-size:11px;opacity:0.4;">avg ${formatPrice(h.avgPrice)}</div>
        </div>
        <div>
          <div id="prof-pnl-${mint}" style="font-weight:700;font-size:13px;color:${cl};">${pnlText}</div>
          <div id="prof-dot-${mint}" style="font-size:10px;opacity:0.4;margin-top:2px;">⬤ LIVE · 20s</div>
        </div>
        <div>
          <a href="safe-ape.html" onclick="localStorage.setItem('sa_prefill_mint','${mint}')" style="padding:6px 12px;background:linear-gradient(135deg,#ffb432,#ff8c00);border:none;border-radius:7px;color:#1a0a00;font-size:11px;font-weight:700;text-decoration:none;display:inline-block;">Trade →</a>
        </div>
      </div>`;
  }).join("");

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 120px 120px 170px 100px;gap:12px;padding-bottom:8px;border-bottom:1px solid rgba(44,255,201,0.15);font-size:11px;opacity:0.5;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">
      <div>Token</div><div>Cur. Value</div><div>Amount</div><div>Unrealised P/L</div><div>Action</div>
    </div>
    ${rows}`;
}

/* ─────────────────────────────────────
   TRADE HISTORY
───────────────────────────────────── */
function renderTrades() {
  const el     = document.getElementById("profileTradesBody");
  const allTrades = [...(profile.trades || [])]; // already newest first (simulator uses unshift)
  const total  = allTrades.length;
  const totalPages = Math.max(1, Math.ceil(total / TRADES_PAGE_SIZE));

  // Clamp page in case trades were deleted
  if (tradesCurrentPage >= totalPages) tradesCurrentPage = totalPages - 1;
  if (tradesCurrentPage < 0) tradesCurrentPage = 0;

  document.getElementById("tradeCountLabel").textContent = `${total} trades total`;

  if (!total) {
    el.innerHTML = `<div style="text-align:center;padding:30px;opacity:0.5;">No trades yet</div>`;
    return;
  }

  const start  = tradesCurrentPage * TRADES_PAGE_SIZE;
  const page   = allTrades.slice(start, start + TRADES_PAGE_SIZE);

  const rows = page.map(t => {
    const isBuy  = t.type === "buy";
    const logo   = t.logo ? `/.netlify/functions/logoProxy?url=${encodeURIComponent(t.logo)}` : "https://placehold.co/28x28";
    const pnlSol = parseFloat(t.pnl);
    const pnlHtml = !isBuy
      ? `<span style="color:${pnlSol>=0?'#2cffc9':'#ff4d6d'};font-weight:700;">${pnlSol>=0?'+':''}${formatSol(pnlSol)} (${pnlSol>=0?'+':''}${t.pnlPct}%)</span>`
      : `<span style="opacity:0.35;">—</span>`;
    const amountSol = isBuy
      ? (t.totalCostSol || (solPrice > 0 ? t.totalCost / solPrice : null))
      : (t.totalReceivedSol || (solPrice > 0 ? t.totalReceived / solPrice : null));
    const amountFmt = amountSol !== null ? formatSol(amountSol) : (isBuy ? formatUsd(t.totalCost) : formatUsd(t.totalReceived));

    return `
      <div style="display:grid;grid-template-columns:90px 1fr 130px 150px 110px;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(44,255,201,0.05);font-size:13px;">
        <div><span class="sa-trade-type-badge ${isBuy?'sa-trade-buy':'sa-trade-sell'}">${isBuy?'BUY':'SELL'}</span></div>
        <div style="display:flex;align-items:center;gap:8px;">
          <img src="${logo}" onerror="this.src='https://placehold.co/28x28'" style="width:28px;height:28px;border-radius:50%;border:1px solid rgba(44,255,201,0.2);object-fit:cover;" />
          <div>
            <div style="font-weight:600;color:#cffff4;">${t.name || t.symbol}</div>
            <div style="font-size:10px;opacity:0.5;">${t.symbol}</div>
          </div>
        </div>
        <div style="font-weight:600;color:#7fffe1;">${amountFmt}</div>
        <div>${pnlHtml}</div>
        <div style="font-size:11px;opacity:0.4;">${new Date(t.timestamp).toLocaleString()}</div>
      </div>`;
  }).join("");

  const hasPrev = tradesCurrentPage > 0;
  const hasNext = tradesCurrentPage < totalPages - 1;

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:90px 1fr 130px 150px 110px;gap:10px;padding-bottom:8px;border-bottom:1px solid rgba(44,255,201,0.15);font-size:11px;opacity:0.5;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;">
      <div>Type</div><div>Token</div><div>Amount</div><div>P/L</div><div>Date</div>
    </div>
    ${rows}
    <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 0 4px;gap:12px;">
      <button onclick="window.tradesPrevPage()"
        style="padding:7px 16px;background:${hasPrev?'rgba(44,255,201,0.12)':'rgba(44,255,201,0.03)'};border:1px solid ${hasPrev?'rgba(44,255,201,0.35)':'rgba(44,255,201,0.08)'};border-radius:8px;color:${hasPrev?'#2cffc9':'rgba(44,255,201,0.25)'};font-size:12px;font-weight:700;cursor:${hasPrev?'pointer':'default'};transition:all .2s;"
        ${hasPrev?'':'disabled'}>← Previous 15</button>
      <span style="font-size:12px;opacity:0.5;white-space:nowrap;">
        Page ${tradesCurrentPage + 1} / ${totalPages} &nbsp;·&nbsp; ${total} trades
      </span>
      <button onclick="window.tradesNextPage()"
        style="padding:7px 16px;background:${hasNext?'rgba(44,255,201,0.12)':'rgba(44,255,201,0.03)'};border:1px solid ${hasNext?'rgba(44,255,201,0.35)':'rgba(44,255,201,0.08)'};border-radius:8px;color:${hasNext?'#2cffc9':'rgba(44,255,201,0.25)'};font-size:12px;font-weight:700;cursor:${hasNext?'pointer':'default'};transition:all .2s;"
        ${hasNext?'':'disabled'}>Next 15 →</button>
    </div>`;
}

window.tradesPrevPage = function() {
  if (tradesCurrentPage > 0) { tradesCurrentPage--; renderTrades(); }
};
window.tradesNextPage = function() {
  const total = (profile.trades || []).length;
  const totalPages = Math.ceil(total / TRADES_PAGE_SIZE);
  if (tradesCurrentPage < totalPages - 1) { tradesCurrentPage++; renderTrades(); }
};

/* ─────────────────────────────────────
   COPY PROFILE LINK
───────────────────────────────────── */
window.copyProfileLink = function(w) {
  const url = `${window.location.origin}/safe-ape-profile.html?wallet=${w}`;
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.getElementById("copyProfileLinkBtn");
    if (btn) { const orig = btn.textContent; btn.textContent = "✅ Copied!"; setTimeout(() => { btn.textContent = orig; }, 1800); }
  }).catch(() => showToast("⚠️ Copy failed — please copy manually."));
};

/* ─────────────────────────────────────
   RESET ACCOUNT
───────────────────────────────────── */
async function resetAccount() {
  if (!confirm("⚠️ This will wipe ALL your trades and holdings, resetting to 10 SOL.\n\nThis CANNOT be undone. Are you sure?")) return;
  try {
    const resp = await fetch(SIM_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet, action: "reset" })
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    profile = data.profile;
    renderProfileCard();
    renderStats();
    renderHoldings();
    tradesCurrentPage = 0;
    renderTrades();
    showToast("✅ Account reset! Starting fresh with 10 SOL.");
  } catch (e) {
    showToast("⚠️ Reset failed: " + e.message);
  }
}

/* ─────────────────────────────────────
   TOAST
───────────────────────────────────── */
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

/* ─────────────────────────────────────
   FORMAT HELPERS
───────────────────────────────────── */
function formatUsd(v) {
  if (!v || isNaN(v)) return "$0.00";
  const abs = Math.abs(v);
  let s;
  if (abs >= 1e6)       s = "$" + (abs/1e6).toFixed(2) + "M";
  else if (abs >= 1e3)  s = "$" + (abs/1e3).toFixed(2) + "K";
  else if (abs >= 0.01) s = "$" + abs.toFixed(2);
  else                  s = "$" + abs.toFixed(6);
  return v < 0 ? "-" + s : s;
}

function formatPrice(v) {
  if (!v) return "$0";
  if (v < 0.000001) return "$" + v.toFixed(10);
  if (v < 0.001)    return "$" + v.toFixed(7);
  if (v < 1)        return "$" + v.toFixed(5);
  return "$" + v.toFixed(4);
}

function formatAmount(n) {
  if (!n || isNaN(n)) return "0";
  if (n >= 1e9)  return (n/1e9).toFixed(2)  + "B";
  if (n >= 1e6)  return (n/1e6).toFixed(2)  + "M";
  if (n >= 1e3)  return (n/1e3).toFixed(2)  + "K";
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}