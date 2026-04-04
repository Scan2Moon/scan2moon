/* ============================================================
   Scan2Moon – leaderboard-app.js  (V2.0 FRONTEND)
   Safe Ape Leaderboard — Browser ES Module
   This is the FRONTEND script for leaderboard.html.
   The server-side Netlify function stays in leaderboard.js
   ============================================================ */

import { renderNav } from "./nav.js";
import "./community.js";

const LB_API = "/.netlify/functions/leaderboard";
const SIM_API = "/.netlify/functions/simulator";

let currentPeriod   = "alltime";
let connectedWallet = null;
let allEntries      = [];
let badgeDefs       = [];
let lbPage          = 0;
const LB_PAGE_SIZE  = 15;
let _badgeCycleTimer = null;
const _badgeCycleState = {};   // wallet → current offset index
let solPrice = 0;

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
  } catch {}
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

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener("DOMContentLoaded", async () => {
  renderNav();
  fetchSolPrice();
  setInterval(fetchSolPrice, 60_000);

  // Check saved wallet — also auto-register in leaderboard so traders
  // appear automatically without needing to click "Submit Score"
  const saved = localStorage.getItem("sa_wallet");
  if (saved) {
    connectedWallet = saved;
    updateConnectUI();
    // Register wallet in simulator.js's store (the same store the leaderboard GET reads from).
    // Must be awaited so the wallet is in the index before loadLeaderboard() runs.
    try {
      await fetch(SIM_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: saved, action: "register" })
      });
    } catch (e) {
      console.warn("LB pre-registration failed (non-critical):", e.message);
    }
  }

  // Bind buttons
  document.getElementById("lbRefreshBtn").addEventListener("click", loadLeaderboard);
  document.getElementById("lbConnectBtn").addEventListener("click", connectWallet);

  // Period tabs
  document.querySelectorAll(".lb-period-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      currentPeriod = btn.dataset.period;
      document.querySelectorAll(".lb-period-tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      loadLeaderboard();
    });
  });

  // Submit score button
  document.getElementById("submitScoreBtn")?.addEventListener("click", submitScore);

  // Share rank button
  document.getElementById("shareRankBtn")?.addEventListener("click", shareRank);

  // Load leaderboard
  loadLeaderboard();
  renderBadgesShowcase();
});

/* ============================================================
   WALLET CONNECT
   ============================================================ */
async function connectWallet() {
  const btn = document.getElementById("lbConnectBtn");
  btn.disabled = true;
  btn.textContent = "Connecting…";

  try {
    const phantom = window.solana;
    if (!phantom || !phantom.isPhantom) {
      alert("Phantom wallet not found!\n\nPlease install Phantom from phantom.app and refresh this page.");
      return;
    }
    const resp = await phantom.connect();
    connectedWallet = resp.publicKey.toString();
    localStorage.setItem("sa_wallet", connectedWallet);
    updateConnectUI();
    // Auto-register on connect — must go to SIM_API (same store the leaderboard GET reads)
    fetch(SIM_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet: connectedWallet, action: "register" })
    }).catch(() => {});
    loadLeaderboard();
  } catch (e) {
    alert("Wallet connection cancelled or failed.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Connect Wallet";
  }
}

function updateConnectUI() {
  const connectBanner = document.getElementById("lbConnectBanner");
  const rankBanner    = document.getElementById("yourRankBanner");

  if (connectedWallet) {
    // Hide the "connect wallet" prompt
    if (connectBanner) connectBanner.style.display = "none";
    // Always show the rank banner so Submit Score is always accessible
    if (rankBanner) {
      rankBanner.style.display = "flex";
      const nameEl = document.getElementById("yourRankName");
      const posEl  = document.getElementById("yourRankPos");
      // Only set placeholders if not already populated by renderYourRank
      if (nameEl && !nameEl.dataset.populated) nameEl.textContent = "Loading…";
      if (posEl  && !posEl.dataset.populated)  posEl.textContent  = "#—";
    }
  } else {
    if (connectBanner) connectBanner.style.display = "";
    if (rankBanner)    rankBanner.style.display = "none";
  }
}

/* ============================================================
   LOAD LEADERBOARD
   ============================================================ */
async function loadLeaderboard() {
  const btn = document.getElementById("lbRefreshBtn");
  if (btn) {
    btn.classList.add("spinning");
    btn.disabled = true;
  }

  const tableBody = document.getElementById("lbTableBody");
  if (tableBody) {
    tableBody.innerHTML = `
      <div class="lb-loading">
        <div class="lb-spinner"></div>
        <div>Loading rankings…</div>
      </div>`;
  }

  try {
    // Use simulator endpoint for leaderboard data — same function that writes
    // profiles and the __lb_index__, so zero cross-function Blobs isolation risk.
    // wallet_caller ensures the connected user always appears in results via a
    // direct strong-consistency read, even if the index hasn't caught up yet.
    const walletParam = connectedWallet ? `&wallet_caller=${connectedWallet}` : "";
    const res  = await fetch(`${SIM_API}?action=leaderboard&period=${currentPeriod}${walletParam}`);
    const data = await res.json();

    if (data.error) throw new Error(data.error);

    allEntries = data.entries || [];
    badgeDefs  = data.badgeDefs || [];

    // Update stats
    const totalEl = document.getElementById("lbTotalTraders");
    if (totalEl) totalEl.textContent = `${data.total || 0} traders`;

    const updateEl = document.getElementById("lbLastUpdate");
    if (updateEl) {
      const now = new Date();
      updateEl.textContent = `Updated ${now.toLocaleTimeString()}`;
    }

    // Render MVP strip
    renderMvpStrip(data.mvp);

    // Render full unified table (paginated)
    lbPage = 0;
    renderTable(allEntries);

    // Render your rank
    if (connectedWallet) renderYourRank(allEntries);

    // Render badges showcase
    renderBadgesShowcase();

  } catch (err) {
    console.error("Leaderboard load failed:", err);
    if (tableBody) {
      tableBody.innerHTML = `
        <div class="lb-empty">
          <div class="lb-empty-icon">🏆</div>
          <div class="lb-empty-title">No rankings yet</div>
          <div style="opacity:0.5;font-size:13px;">Be the first! Trade on Safe Ape Simulator and submit your score.</div>
        </div>`;
    }
  } finally {
    if (btn) {
      btn.classList.remove("spinning");
      btn.disabled = false;
    }
  }
}

/* ============================================================
   RENDER MVP STRIP
   ============================================================ */
function renderMvpStrip(mvp) {
  if (!mvp) return;

  const slots = [
    { key: "daily",   nameId: "mvpDayName",     valId: "mvpDayVal",     isAllTime: false },
    { key: "weekly",  nameId: "mvpWeekName",     valId: "mvpWeekVal",    isAllTime: false },
    { key: "monthly", nameId: "mvpMonthName",    valId: "mvpMonthVal",   isAllTime: false },
    { key: "alltime", nameId: "mvpAllTimeName",  valId: "mvpAllTimeVal", isAllTime: true  },
  ];

  for (const slot of slots) {
    const entry  = mvp[slot.key];
    const nameEl = document.getElementById(slot.nameId);
    const valEl  = document.getElementById(slot.valId);
    if (!nameEl || !valEl) continue;

    if (entry) {
      nameEl.textContent = entry.accountName || "Ape";
      if (slot.isAllTime) {
        const adjR = entry.adjReturn ?? 0;
        const sign = adjR >= 0 ? "+" : "";
        valEl.textContent = `${sign}${adjR.toFixed(2)}% adj. return`;
      } else {
        const pnl  = entry.periodPnL ?? 0;
        const sign = pnl >= 0 ? "+" : "";
        valEl.textContent = pnl !== 0
          ? `${sign}${formatSol(pnl)} P/L`
          : "No activity";
      }
    } else {
      nameEl.textContent = "—";
      valEl.textContent  = "No data yet";
    }
  }
}

/* ============================================================
   RENDER UNIFIED TABLE  (paginated · badge carousel)
   ============================================================ */
const BADGE_CAROUSEL_SIZE = 4;   // visible badges at once
const BADGE_CYCLE_MS      = 2500; // ms between rotations

function renderTable(entries) {
  const el = document.getElementById("lbTableBody");
  if (!el) return;

  // Stop any running carousel
  clearInterval(_badgeCycleTimer);

  if (!entries.length) {
    el.innerHTML = `
      <div class="lb-empty">
        <div class="lb-empty-icon">🏆</div>
        <div class="lb-empty-title">No traders yet</div>
        <div style="opacity:0.5;font-size:13px;">Be the first! Trade on Safe Ape Simulator and your score appears here automatically.</div>
      </div>`;
    return;
  }

  const badgeDef_map = {};
  badgeDefs.forEach(b => { badgeDef_map[b.id] = b; });

  // ── Pagination slice ──────────────────────────────────────
  const totalPages = Math.ceil(entries.length / LB_PAGE_SIZE);
  lbPage = Math.max(0, Math.min(lbPage, totalPages - 1));
  const pageEntries = entries.slice(lbPage * LB_PAGE_SIZE, (lbPage + 1) * LB_PAGE_SIZE);

  // ── Build rows ────────────────────────────────────────────
  const rows = pageEntries.map(e => {
    const isYou   = connectedWallet && e.wallet === connectedWallet;
    const adjR    = e.adjReturn ?? 0;
    const sign    = adjR >= 0 ? "+" : "";
    const pnl     = e.totalPnL ?? 0;
    const pnlSign = pnl >= 0 ? "+" : "";
    const shortW  = e.wallet ? e.wallet.slice(0, 4) + "…" + e.wallet.slice(-4) : "";

    const medal       = e.rank === 1 ? "🥇" : e.rank === 2 ? "🥈" : e.rank === 3 ? "🥉" : null;
    const rowExtraCls = e.rank === 1 ? "lb-row-gold" : e.rank === 2 ? "lb-row-silver" : e.rank === 3 ? "lb-row-bronze" : "";

    const rankDisplay = medal
      ? `<div class="lb-rank-medal">${medal}</div><div class="lb-rank-sub">#${e.rank}</div>`
      : `<span class="lb-rank-normal">#${e.rank}</span>`;

    const riskCls = e.avgRiskScore >= 65 ? "lb-risk-good"
                  : e.avgRiskScore >= 40 ? "lb-risk-warn"
                  : "lb-risk-bad";

    const earnedBadges = (e.badges || []).filter(id => badgeDef_map[id]);
    const badgeCount   = earnedBadges.length;

    // Render first BADGE_CAROUSEL_SIZE badges; carousel will rotate the rest
    const visibleBadges = earnedBadges.slice(0, BADGE_CAROUSEL_SIZE).map(id => {
      const def = badgeDef_map[id];
      return def.img
        ? `<img class="lb-badge-icon-img" src="${def.img}" title="${def.name}: ${def.desc}" alt="${def.name}" onerror="this.style.display='none'">`
        : `<span class="lb-badge-icon" title="${def.name}: ${def.desc}">${def.icon}</span>`;
    }).join("");

    const badgesCell = badgeCount
      ? `<div class="lb-badges-cell" id="lb-bc-${e.wallet}"
             data-badges='${JSON.stringify(earnedBadges)}'
             data-wallet="${e.wallet}">${visibleBadges}</div>
         ${badgeCount > BADGE_CAROUSEL_SIZE
           ? `<div class="lb-badge-count">${badgeCount} 🎖</div>`
           : (badgeCount > 0 ? `<div class="lb-badge-count">${badgeCount} 🎖</div>` : "")}`
      : `<span style="opacity:0.3;font-size:12px;">—</span>`;

    const balance = e.balance ?? 10;
    const balDiff = balance - 10; // vs 10 SOL start

    return `
      <tr class="lb-clickable-row ${isYou ? "lb-you-row" : ""} ${rowExtraCls}" style="animation-delay:${(e.rank - 1) * 0.03}s" onclick="openTraderProfile('${e.wallet}')" title="Click to view profile">
        <td class="lb-rank-cell">${rankDisplay}</td>
        <td>
          <div class="lb-name-cell">
            <span class="lb-name-ape">🦍</span>
            <div>
              <div class="lb-name-text">
                ${e.accountName || "Ape"}
                ${isYou ? '<span class="lb-you-badge">YOU</span>' : ""}
              </div>
              <div class="lb-name-wallet">${shortW}</div>
            </div>
          </div>
        </td>
        <td><div class="lb-badges-wrapper">${badgesCell}</div></td>
        <td><div class="lb-adj-return ${adjR >= 0 ? 'lb-adj-pos' : 'lb-adj-neg'}">${sign}${adjR.toFixed(2)}%</div></td>
        <td><div class="lb-pnl-val ${pnl >= 0 ? 'lb-pnl-pos' : 'lb-pnl-neg'}">${pnlSign}${formatSol(Math.abs(pnl))}</div></td>
        <td><span class="lb-risk-score ${riskCls}">${e.avgRiskScore}/100</span></td>
        <td><div style="font-size:13px;font-weight:600;">${e.tradeCount || 0}</div></td>
        <td><div class="lb-last-active">${e.lastActive || "—"}</div></td>
        <td>
          <div class="lb-sol2moon-val"><img src="${SOL_LOGO}" class="s2m-token-icon" style="border-radius:50%;"> ${formatSol(balance)}</div>
          ${balDiff !== 0 ? `<div style="font-size:10px;font-weight:600;color:${balDiff>0?'#2cffc9':'#ff4d6d'};margin-top:2px;">${balDiff>0?'+':''}${formatSol(balDiff)}</div>` : ""}
        </td>
      </tr>`;
  }).join("");

  // ── Pagination controls ───────────────────────────────────
  const pageInfo  = `Page ${lbPage + 1} of ${totalPages} · ${entries.length} traders`;
  const prevDisabled = lbPage === 0 ? "disabled" : "";
  const nextDisabled = lbPage >= totalPages - 1 ? "disabled" : "";

  const paginationHtml = totalPages > 1 ? `
    <div class="lb-pagination">
      <button class="lb-page-btn" ${prevDisabled} onclick="lbGoPage(${lbPage - 1})">← Previous 15</button>
      <span class="lb-page-info">${pageInfo}</span>
      <button class="lb-page-btn" ${nextDisabled} onclick="lbGoPage(${lbPage + 1})">Next 15 →</button>
    </div>` : "";

  el.innerHTML = `
    <table class="lb-table">
      <thead>
        <tr>
          <th style="width:52px;">#</th>
          <th>Trader</th>
          <th>Badges</th>
          <th>Adj. Return ↕</th>
          <th>All Time P/L</th>
          <th>Avg Risk</th>
          <th>Trades</th>
          <th>Last Active</th>
          <th><img src="${SOL_LOGO}" class="s2m-token-icon" style="border-radius:50%;"> Balance</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${paginationHtml}`;

  // ── Start badge carousel ──────────────────────────────────
  startBadgeCarousel(badgeDef_map);
}

/* ── Badge carousel engine ───────────────────────────────── */
function startBadgeCarousel(badgeDef_map) {
  clearInterval(_badgeCycleTimer);
  _badgeCycleTimer = setInterval(() => {
    document.querySelectorAll(".lb-badges-cell[data-badges]").forEach(cell => {
      const wallet = cell.dataset.wallet;
      const badges = JSON.parse(cell.dataset.badges || "[]");
      if (badges.length <= BADGE_CAROUSEL_SIZE) return;   // no cycling needed

      // Advance offset
      if (!_badgeCycleState[wallet]) _badgeCycleState[wallet] = 0;
      _badgeCycleState[wallet] = (_badgeCycleState[wallet] + 1) % badges.length;

      const offset  = _badgeCycleState[wallet];
      const visible = [];
      for (let i = 0; i < BADGE_CAROUSEL_SIZE; i++) {
        visible.push(badges[(offset + i) % badges.length]);
      }

      cell.innerHTML = visible.map(id => {
        const def = badgeDef_map[id];
        if (!def) return "";
        return def.img
          ? `<img class="lb-badge-icon-img lb-badge-cycle-in" src="${def.img}" title="${def.name}: ${def.desc}" alt="${def.name}" onerror="this.style.display='none'">`
          : `<span class="lb-badge-icon lb-badge-cycle-in" title="${def.name}: ${def.desc}">${def.icon}</span>`;
      }).join("");
    });
  }, BADGE_CYCLE_MS);
}

/* ── Pagination helper (called from inline onclick) ─────── */
window.lbGoPage = function(page) {
  lbPage = page;
  renderTable(allEntries);
  document.getElementById("lbTableBody")?.scrollIntoView({ behavior: "smooth", block: "start" });
};

/* ============================================================
   RENDER YOUR RANK BANNER
   ============================================================ */
function renderYourRank(entries) {
  if (!connectedWallet) return;

  const banner  = document.getElementById("yourRankBanner");
  const nameEl  = document.getElementById("yourRankName");
  const posEl   = document.getElementById("yourRankPos");

  if (!banner) return;
  // Always show the banner when connected — Submit Score must always be accessible
  banner.style.display = "flex";

  const entry = entries.find(e => e.wallet === connectedWallet);
  if (entry) {
    if (nameEl) { nameEl.textContent = entry.accountName || "Ape"; nameEl.dataset.populated = "1"; }
    if (posEl)  { posEl.textContent  = `#${entry.rank}`;           posEl.dataset.populated  = "1"; }
  } else {
    // Connected but not ranked yet — show placeholder so Submit Score is still visible
    if (nameEl) { nameEl.textContent = "Not yet ranked"; nameEl.dataset.populated = "1"; }
    if (posEl)  { posEl.textContent  = "#—";             posEl.dataset.populated  = "1"; }
  }
}

/* ============================================================
   SUBMIT SCORE
   ============================================================ */
async function submitScore() {
  if (!connectedWallet) { alert("Connect your wallet first!"); return; }
  const btn = document.getElementById("submitScoreBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Submitting…"; }

  try {
    // Must use SIM_API — leaderboard GET reads from simulator's store context.
    // Posting to leaderboard.js would register in a different store and never appear.
    const res  = await fetch(SIM_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet: connectedWallet, action: "register" })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    const adjR = data.adjReturn !== undefined ? `\nRisk-Adjusted Return: ${data.adjReturn}%` : "";
    const bdgs = data.badges ? `\nBadges earned: ${data.badges.length}` : "";
    alert(`✅ Score submitted!${adjR}${bdgs}`);
    loadLeaderboard();
  } catch (e) {
    alert("⚠️ Submit failed: " + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "⬆️ Submit Score"; }
  }
}

/* ============================================================
   SHARE RANK
   ============================================================ */
function shareRank() {
  if (!connectedWallet || !allEntries.length) return;
  const entry = allEntries.find(e => e.wallet === connectedWallet);
  if (!entry) return;

  const adjR = (entry.adjReturn ?? 0).toFixed(2);
  const sign = entry.adjReturn >= 0 ? "+" : "";
  const text = [
    `🏆 My Safe Ape rank on @Scan2Moon: #${entry.rank}`,
    `📊 Risk-Adjusted Return: ${sign}${adjR}%`,
    `🛡️ Avg Risk Score: ${entry.avgRiskScore}/100`,
    `🦍 Paper trading with real risk intelligence`,
    `https://scan2moon.com`,
    `#Solana #SafeApe #Crypto`
  ].join("\n");

  window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank");
}

/* ============================================================
   BADGES SHOWCASE
   ============================================================ */
function renderBadgesShowcase() {
  const el = document.getElementById("allBadgesGrid");
  if (!el) return;

  const defaultBadges = [
    { id: "first_profit",    img: "/badges/First_Profit.png",   icon: "🏆", name: "First Profit",         desc: "Made your first profitable trade" },
    { id: "win_streak_5",   img: "/badges/win_streak_5.png",   icon: "🔥", name: "Win Streak x5",        desc: "Won 5 trades in a row" },
    { id: "safe_trader",    img: "/badges/Safe_Trader.png",    icon: "🛡️", name: "Safe Trader",           desc: "Buy 10 tokens with entry risk score ≥ 65" },
    { id: "diamond_hands",  img: "/badges/Diamond_Hands.png",  icon: "💎", name: "Diamond Hands",         desc: "Held a token for 7+ days" },
    { id: "degen_survivor", img: "/badges/Degen_Survivor.png", icon: "🦍", name: "Degen Survivor",        desc: "Profit 10× on tokens with risk score < 45 (1 sell per buy)" },
    { id: "portfolio_100",  img: "/badges/portfolio_100.png",  icon: "📈", name: "100% Growth",           desc: "Doubled your 10 SOL starting balance" },
    { id: "wins_25",        img: "/badges/Wins_25.png",        icon: "⭐", name: "25 Safe Wins",          desc: "25 profitable trades" },
    { id: "wins_50",        img: "/badges/Wins_50.png",        icon: "🌟", name: "50 Safe Wins",          desc: "50 profitable trades" },
    { id: "wins_100",       img: "/badges/Wins_100.png",       icon: "💫", name: "100 Safe Wins",         desc: "100 profitable trades" },
    { id: "wins_500",       img: "/badges/Wins_500.png",       icon: "🚀", name: "500 Safe Wins",         desc: "500 profitable trades" },
    { id: "wins_1000",           img: "/badges/Wins_1000.png", icon: "🐐", name: "1000 Safe Wins — GOAT", desc: "The absolute GOAT." },
    { id: "sol2moon_millionaire", img: "/badges/Sol2Moon.png",  icon: "🌙", name: "Sol2Moon Millionaire",   desc: "Reach 10,000 SOL" },
  ];

  const defs = badgeDefs.length ? badgeDefs : defaultBadges;

  // Get your earned badges if connected
  let earnedBadges = [];
  if (connectedWallet) {
    const myEntry = allEntries.find(e => e.wallet === connectedWallet);
    if (myEntry) earnedBadges = myEntry.badges || [];
  }

  el.innerHTML = defs.map(b => {
    const earned = earnedBadges.includes(b.id);
    const imgHtml = b.img
      ? `<img class="lb-badge-showcase-img" src="${b.img}" alt="${b.name}" onerror="this.style.display='none'">`
      : `<span style="font-size:38px;">${b.icon}</span>`;
    return `
      <div class="lb-badge-showcase ${earned ? "earned" : ""}">
        <div class="lb-badge-showcase-icon">${imgHtml}</div>
        <div class="lb-badge-showcase-name">${b.name}</div>
        <div class="lb-badge-showcase-desc">${b.desc}</div>
        ${earned
          ? `<div style="margin-top:6px;font-size:11px;color:#2cffc9;font-weight:700;">✅ Earned!</div>`
          : `<div class="lb-badge-showcase-lock">🔒 Not yet earned</div>`}
      </div>`;
  }).join("");
}

/* ============================================================
   EXPOSE TO WINDOW (for any inline onclick fallbacks)
   ============================================================ */
window.loadLeaderboard = loadLeaderboard;
window.setPeriod = function(period) {
  currentPeriod = period;
  document.querySelectorAll(".lb-period-tab").forEach(b => {
    b.classList.toggle("active", b.dataset.period === period);
  });
  loadLeaderboard();
};
/* ============================================================
   TRADER PROFILE MODAL
   ============================================================ */
window.openTraderProfile = function(wallet) {
  const e = allEntries.find(x => x.wallet === wallet);
  if (!e) return;

  const badgeDef_map = {};
  badgeDefs.forEach(b => { badgeDef_map[b.id] = b; });

  // Rank title (mirrors safe-ape-profile logic, thresholds in SOL)
  const pnl = e.totalPnL || 0;
  let rank, rankColor;
  if (pnl > 50)        { rank = "🏆 LEGENDARY APE";  rankColor = "#ffd166"; }
  else if (pnl > 10)   { rank = "💎 DIAMOND HANDS";  rankColor = "#82b4ff"; }
  else if (pnl > 1)    { rank = "🟢 SMART MONEY";    rankColor = "#2cffc9"; }
  else if (pnl > 0)    { rank = "📈 PROFITABLE APE"; rankColor = "#7fffe1"; }
  else if (pnl > -2)   { rank = "🙈 LEARNING APE";   rankColor = "#ffd166"; }
  else                 { rank = "💀 RUG SURVIVOR";    rankColor = "#ff4d6d"; }

  const pnlColor = pnl >= 0 ? "#2cffc9" : "#ff4d6d";
  const pnlSign  = pnl >= 0 ? "+" : "";
  const adjR     = e.adjReturn ?? 0;
  const adjColor = adjR >= 0 ? "#2cffc9" : "#ff4d6d";
  const adjSign  = adjR >= 0 ? "+" : "";
  const riskColor = e.avgRiskScore >= 65 ? "#2cffc9" : e.avgRiskScore >= 40 ? "#ffd166" : "#ff4d6d";

  const balance  = e.balance ?? 10;
  const balDiff  = balance - 10; // vs 10 SOL start
  const balDiffHtml = balDiff !== 0
    ? `<span style="font-size:11px;font-weight:600;color:${balDiff>0?'#2cffc9':'#ff4d6d'};margin-left:6px;">(${balDiff>0?'+':''}${formatSol(balDiff)})</span>`
    : "";

  const totalTrades = (e.winCount || 0) + (e.lossCount || 0);
  const winRate = totalTrades > 0 ? ((e.winCount / totalTrades) * 100).toFixed(0) : "0";

  const shortW = e.wallet ? e.wallet.slice(0, 6) + "…" + e.wallet.slice(-6) : "";

  const medal = e.rank === 1 ? "🥇" : e.rank === 2 ? "🥈" : e.rank === 3 ? "🥉" : `#${e.rank}`;
  const isYou = connectedWallet && e.wallet === connectedWallet;

  // Badges
  const earnedBadges = (e.badges || []).filter(id => badgeDef_map[id]);
  const badgesHtml = earnedBadges.length
    ? earnedBadges.map(id => {
        const def = badgeDef_map[id];
        const imgHtml = def.img
          ? `<img src="${def.img}" class="tp-badge-img" title="${def.name}: ${def.desc}" onerror="this.style.display='none'">`
          : `<span class="tp-badge-emoji" title="${def.name}: ${def.desc}">${def.icon}</span>`;
        return `<div class="tp-badge-item" title="${def.name}: ${def.desc}">${imgHtml}<div class="tp-badge-name">${def.name}</div></div>`;
      }).join("")
    : `<div style="opacity:0.4;font-size:13px;padding:8px 0;">No badges yet</div>`;

  document.getElementById("traderProfileContent").innerHTML = `
    <!-- Header: rank + name -->
    <div class="tp-header">
      <div class="tp-rank-pill">${medal}</div>
      <div class="tp-avatar">🦍</div>
      <div class="tp-header-info">
        <div class="tp-name">${e.accountName || "Ape"}${isYou ? ' <span class="lb-you-badge">YOU</span>' : ""}</div>
        <div class="tp-rank-title" style="color:${rankColor}">${rank}</div>
        <div class="tp-wallet">
          <span>${shortW}</span>
          <a href="https://solscan.io/account/${e.wallet}" target="_blank" rel="noopener noreferrer" class="tp-solscan-link">Solscan ↗</a>
        </div>
      </div>
    </div>

    <!-- Stats grid -->
    <div class="tp-stats-grid">
      <div class="tp-stat">
        <div class="tp-stat-label">BALANCE</div>
        <div class="tp-stat-val" style="color:#ffb432;">${formatSol(balance)}${balDiffHtml}</div>
      </div>
      <div class="tp-stat">
        <div class="tp-stat-label">ALL-TIME P/L</div>
        <div class="tp-stat-val" style="color:${pnlColor};">${pnlSign}${formatSol(Math.abs(pnl))}</div>
      </div>
      <div class="tp-stat">
        <div class="tp-stat-label">ADJ. RETURN</div>
        <div class="tp-stat-val" style="color:${adjColor};">${adjSign}${adjR.toFixed(2)}%</div>
      </div>
      <div class="tp-stat">
        <div class="tp-stat-label">AVG RISK SCORE</div>
        <div class="tp-stat-val" style="color:${riskColor};">${e.avgRiskScore}/100</div>
      </div>
    </div>

    <!-- Trades: WIN / LOSE / TOTAL -->
    <div class="tp-trades-row">
      <div class="tp-trade-box tp-win">
        <div class="tp-trade-label">WIN</div>
        <div class="tp-trade-num">${e.winCount || 0}</div>
      </div>
      <div class="tp-trade-box tp-lose">
        <div class="tp-trade-label">LOSE</div>
        <div class="tp-trade-num">${e.lossCount || 0}</div>
      </div>
      <div class="tp-trade-box tp-total">
        <div class="tp-trade-label">TOTAL</div>
        <div class="tp-trade-num">${totalTrades}</div>
      </div>
      <div class="tp-trade-box tp-winrate">
        <div class="tp-trade-label">WIN RATE</div>
        <div class="tp-trade-num" style="color:#ffd166;">${winRate}%</div>
      </div>
    </div>

    <!-- Meta row -->
    <div class="tp-meta-row">
      <div class="tp-meta-item">🔥 <strong>${e.loginStreak || 0}</strong> day streak</div>
      <div class="tp-meta-item">🕐 Last active: <strong>${e.lastActive || "—"}</strong></div>
    </div>

    <!-- Badges -->
    <div class="tp-section-title">🎖️ Badges</div>
    <div class="tp-badges-grid">${badgesHtml}</div>
  `;

  const overlay = document.getElementById("traderProfileOverlay");
  overlay.style.display = "flex";
  requestAnimationFrame(() => overlay.classList.add("tp-visible"));
};

window.closeTraderProfile = function(e) {
  // Close if clicking backdrop (not modal itself), or if called directly
  if (e && e.target !== document.getElementById("traderProfileOverlay")) return;
  const overlay = document.getElementById("traderProfileOverlay");
  overlay.classList.remove("tp-visible");
  setTimeout(() => { overlay.style.display = "none"; }, 250);
};

window.saveTraderCard = async function() {
  const modal = document.getElementById("traderProfileModal");
  const btn   = document.getElementById("saveTraderCardBtn");
  if (!modal || !btn) return;

  const origText = btn.innerHTML;
  btn.innerHTML  = "⏳ Saving…";
  btn.style.opacity = "0.7";
  btn.disabled   = true;

  // Temporarily hide the Save button itself so it doesn't appear in the image
  btn.parentElement.style.display = "none";

  try {
    const canvas = await html2canvas(modal, {
      backgroundColor: "#0d1f1a",
      scale: 2,           // 2× for sharp/retina quality
      useCORS: true,
      logging: false,
    });

    // Restore button before download
    btn.parentElement.style.display = "";

    // Build filename from the displayed wallet snippet inside the modal
    const walletEl = modal.querySelector(".tp-wallet span");
    const walletSnip = walletEl ? walletEl.textContent.replace(/[^a-zA-Z0-9]/g, "") : "trader";
    const filename = `scan2moon-trader-${walletSnip}.png`;

    const link = document.createElement("a");
    link.download = filename;
    link.href = canvas.toDataURL("image/png");
    link.click();
  } catch (err) {
    btn.parentElement.style.display = "";
    console.error("Save card failed:", err);
    alert("⚠️ Could not save image. Try again.");
  } finally {
    btn.innerHTML  = origText;
    btn.style.opacity = "";
    btn.disabled   = false;
  }
};

// Close on Escape key
document.addEventListener("keydown", e => {
  if (e.key === "Escape") window.closeTraderProfile();
});
