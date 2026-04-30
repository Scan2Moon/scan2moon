const _DEBUG = false;

/* ============================================================
   Scan2Moon – leaderboard-app.js  (V2.0 FRONTEND)
   Scan2Moon Leaderboard — Browser ES Module
   This is the FRONTEND script for leaderboard.html.
   The server-side Netlify function stays in leaderboard.js
   ============================================================ */

import { renderNav } from "./nav.js";
import { applyTranslations } from "./i18n.js";
import "./community.js";

const LB_API = "/.netlify/functions/leaderboard";
const SIM_API = "/.netlify/functions/simulator";

/* ── Local badge media map ─────────────────────────────────────────────────
   Server's badgeDefs only has {id, icon, name, desc} — no img/type/video.
   This map fills the gap so avatars render correctly everywhere on this page.
   ────────────────────────────────────────────────────────────────────────── */
const LOCAL_BADGE_MEDIA = {
  // Trading
  first_profit:         { img: "/badges/First_Profit.png",             icon: "🏆" },
  win_streak_5:         { img: "/badges/win_streak_5.png",             icon: "🔥" },
  safe_trader:          { img: "/badges/Safe_Trader.png",              icon: "🛡️" },
  diamond_hands:        { img: "/badges/Diamond_Hands.png",            icon: "💎" },
  degen_survivor:       { img: "/badges/Degen_Survivor.png",           icon: "🦍" },
  portfolio_100:        { img: "/badges/portfolio_100.png",            icon: "📈" },
  wins_25:              { img: "/badges/Wins_25.png",                  icon: "⭐" },
  wins_50:              { img: "/badges/Wins_50.png",                  icon: "🌟" },
  wins_100:             { img: "/badges/Wins_100.png",                 icon: "💫" },
  wins_500:             { img: "/badges/Wins_500.png",                 icon: "🚀" },
  wins_1000:            { img: "/badges/Wins_1000.png",               icon: "🐐" },
  sol2moon_millionaire: { img: "/badges/Sol2Moon.png",                 icon: "🌙" },
  // Other / Pro
  streak_7:             { img: "/badges/Other_Bages/7_Days.png",       icon: "🔥" },
  pro_scanner:          { img: "/badges/Pro_badges/100_Risk_Scan.png", icon: "🛡️" },
  alpha_caller:         { img: "/badges/Pro_badges/Alpha_Caller.png",  icon: "🎯" },
  whale_analyst:        { img: "/badges/Pro_badges/Whale_Analyst.png", icon: "🐋" },
  top_10:               { img: "/badges/Pro_badges/Top_10.png",        icon: "🏆" },
  // Cosmetics
  cosm_love_solana:     { img: "/badges/Love_Solana.png",              icon: "❤️" },
  cosm_love_s2m:        { img: "/badges/Love_S2M.png",                 icon: "🌙" },
  // Moon Krakens (animated video)
  kraken_skeleton:      { type: "video", video: "/badges/Moon_Krakens_Bages/%23006.mp4", icon: "💀" },
  kraken_badboy:        { type: "video", video: "/badges/Moon_Krakens_Bages/%23005.mp4", icon: "😈" },
  kraken_pirate:        { type: "video", video: "/badges/Moon_Krakens_Bages/%23004.mp4", icon: "🏴‍☠️" },
  // Level badges
  lvl_1:   { img: "/badges/level_badges/LVL_1.png",   icon: "🌱" },
  lvl_5:   { img: "/badges/level_badges/LVL_5.png",   icon: "🔥" },
  lvl_10:  { img: "/badges/level_badges/LVL_10.png",  icon: "💪" },
  lvl_20:  { img: "/badges/level_badges/LVL_20.png",  icon: "🧠" },
  lvl_30:  { img: "/badges/level_badges/LVL_30.png",  icon: "💎" },
  lvl_50:  { img: "/badges/level_badges/LVL_50.png",  icon: "🚀" },
  lvl_100: { img: "/badges/level_badges/LVL_100.png", icon: "🌙" },
};

/* ── Frame CSS classes (mirror dashboard.js FRAME_DEFS) ── */
const LOCAL_FRAME_DEFS = [
  { id: "frame_none",        cssClass: "" },
  { id: "frame_moon_pulse",  cssClass: "frame-moon-pulse" },
  { id: "frame_solar_flare", cssClass: "frame-solar-flare" },
  { id: "frame_degen_neon",  cssClass: "frame-degen-neon" },
  { id: "frame_diamond",     cssClass: "frame-diamond" },
];

/* Build avatar <img>/<video>/<span> at a given square size */
function buildAvatarHtml(avId, size = 28, radius = 6) {
  const m = avId ? LOCAL_BADGE_MEDIA[avId] : null;
  const st = `width:${size}px;height:${size}px;object-fit:cover;border-radius:${radius}px;flex-shrink:0;display:block;`;
  if (m?.type === "video" && m.video)
    return `<video src="${m.video}" autoplay loop muted playsinline style="${st}"></video>`;
  if (m?.img)
    return `<img src="${m.img}" style="${st}" alt="avatar" onerror="this.style.display='none'">`;
  return `<span style="font-size:${Math.round(size * 0.6)}px;line-height:${size}px;display:inline-block;">${m?.icon || "◆"}</span>`;
}

/* Get the frame CSS class from localStorage */
function getMyFrameCls() {
  const fid = localStorage.getItem("sa_frame_id") || "frame_none";
  return (LOCAL_FRAME_DEFS.find(f => f.id === fid) || LOCAL_FRAME_DEFS[0]).cssClass;
}

let currentPeriod   = "alltime";
let connectedWallet = null;
let allEntries      = [];
let badgeDefs       = [];   // kept for trader profile popup
let lbPage          = 0;
const LB_PAGE_SIZE  = 15;
let solPrice = 0;

const SOL_LOGO = "S2M-Logo.png";

async function fetchSolPrice() {
  /* Route through server-side function — avoids CORS + geo-block issues */
  try {
    const r = await fetch("/.netlify/functions/solPrice", { signal: AbortSignal.timeout(5000) });
    const d = await r.json();
    const p = parseFloat(d.price);
    if (p > 0) { solPrice = p; return; }
  } catch {}
}

function formatSol(n) {
  if (n === null || n === undefined || isNaN(n)) return "0 S2M";
  const abs = Math.abs(n);
  if (abs === 0)    return "0 S2M";
  if (abs < 0.001)  return n.toFixed(6) + " S2M";
  if (abs < 0.1)    return n.toFixed(4) + " S2M";
  if (abs < 10)     return n.toFixed(3) + " S2M";
  return n.toFixed(2) + " S2M";
}

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener("DOMContentLoaded", async () => {
  renderNav();
  applyTranslations();
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
      _DEBUG && console.warn("LB pre-registration failed (non-critical):", e.message);
    }
    // Sync display name to server so leaderboard shows the name set in Dashboard
    syncDisplayName(saved).catch(() => {});
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
    // Sync display name to server so leaderboard shows the name set in Dashboard
    syncDisplayName(connectedWallet).catch(() => {});
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
        <div class="lb-scan-ring"></div>
        <div class="lb-scan-text">Scanning rankings…</div>
      </div>`;
  }

  try {
    // Use simulator endpoint for leaderboard data — same function that writes
    // profiles and the __lb_index__, so zero cross-function Blobs isolation risk.
    // wallet_caller ensures the connected user always appears in results via a
    // direct strong-consistency read, even if the index hasn't caught up yet.
    const walletParam = connectedWallet ? `&wallet_caller=${connectedWallet}` : "";

    // Retry up to 3 times on 503 — server returns 503 when the Blobs index is
    // temporarily null (Lambda cold start). Better to retry than show empty leaderboard.
    let res, retries = 0;
    while (retries <= 2) {
      res = await fetch(`${SIM_API}?action=leaderboard&period=${currentPeriod}${walletParam}`);
      if (res.status !== 503) break;
      retries++;
      if (retries <= 2) {
        _DEBUG && console.warn(`Leaderboard 503, retry ${retries}/2…`);
        await new Promise(r => setTimeout(r, 800 * retries));
      }
    }
    const data = await res.json();

    if (data.error && res.status !== 503) throw new Error(data.error);
    if (res.status === 503) throw new Error("Leaderboard temporarily unavailable — please refresh in a moment");

    const freshEntries = data.entries || [];
    badgeDefs = data.badgeDefs || [];

    // If server returned real entries, cache them so we survive future outages.
    // If server returned 0 entries but we have a valid cache, use the cache instead
    // — this prevents the leaderboard from going blank when Blobs/Redis is flaky.
    if (freshEntries.length > 0) {
      allEntries = freshEntries;
      try {
        localStorage.setItem("s2m_lb_cache", JSON.stringify({
          entries:  freshEntries,
          badgeDefs: data.badgeDefs || [],
          mvp:      data.mvp || {},
          savedAt:  Date.now()
        }));
      } catch {}
    } else {
      // Server returned 0 — try the cache (valid up to 24h)
      try {
        const raw = localStorage.getItem("s2m_lb_cache");
        if (raw) {
          const c = JSON.parse(raw);
          if (Date.now() - c.savedAt < 86_400_000 && c.entries.length > 0) {
            allEntries = c.entries;
            if (c.badgeDefs) badgeDefs = c.badgeDefs;
            if (c.mvp) data.mvp = c.mvp;
            _DEBUG && console.warn("Leaderboard: server returned 0, showing cached data");
            const updateEl = document.getElementById("lbLastUpdate");
            if (updateEl) updateEl.textContent = "⚠ Showing cached data";
            const totalEl = document.getElementById("lbTotalTraders");
            if (totalEl) totalEl.textContent = `${allEntries.length} traders (cached)`;
            renderMvpStrip(data.mvp);
            lbPage = 0;
            renderTable(allEntries);
            if (connectedWallet) renderYourRank(allEntries);
            renderBadgesShowcase();
            return; // skip normal render below
          }
        }
      } catch {}
      allEntries = []; // genuinely empty (fresh deploy, no cache)
    }

    // Normal render path (server returned real data)
    const totalEl = document.getElementById("lbTotalTraders");
    if (totalEl) totalEl.textContent = `${data.total || allEntries.length} traders`;

    const updateEl = document.getElementById("lbLastUpdate");
    if (updateEl) {
      const now = new Date();
      updateEl.textContent = `Updated ${now.toLocaleTimeString()}`;
    }

    renderMvpStrip(data.mvp);
    lbPage = 0;
    renderTable(allEntries);
    if (connectedWallet) renderYourRank(allEntries);
    renderBadgesShowcase();

  } catch (err) {
    _DEBUG && console.error("Leaderboard load failed:", err);
    // On any error, try to show cached data rather than "No rankings yet"
    try {
      const raw = localStorage.getItem("s2m_lb_cache");
      if (raw) {
        const c = JSON.parse(raw);
        if (Date.now() - c.savedAt < 86_400_000 && c.entries.length > 0) {
          allEntries = c.entries;
          if (c.badgeDefs) badgeDefs = c.badgeDefs;
          const updateEl = document.getElementById("lbLastUpdate");
          if (updateEl) updateEl.textContent = "⚠ Showing cached data";
          const totalEl = document.getElementById("lbTotalTraders");
          if (totalEl) totalEl.textContent = `${allEntries.length} traders (cached)`;
          renderMvpStrip(c.mvp || {});
          lbPage = 0;
          renderTable(allEntries);
          if (connectedWallet) renderYourRank(allEntries);
          renderBadgesShowcase();
          return;
        }
      }
    } catch {}
    if (tableBody) {
      tableBody.innerHTML = `
        <div class="lb-empty">
          <div class="lb-empty-icon">📊</div>
          <div class="lb-empty-title">Rankings unavailable</div>
          <div style="opacity:0.4;font-size:12px;">Could not load data. Try refreshing in a moment.</div>
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

  // pnlKey maps each slot to the correct per-period P/L field on the entry object
  const slots = [
    { key: "daily",   nameId: "mvpDayName",    valId: "mvpDayVal",     pnlKey: "dailyPnL",  isAllTime: false },
    { key: "weekly",  nameId: "mvpWeekName",   valId: "mvpWeekVal",    pnlKey: "weeklyPnL", isAllTime: false },
    { key: "monthly", nameId: "mvpMonthName",  valId: "mvpMonthVal",   pnlKey: "monthlyPnL",isAllTime: false },
    { key: "alltime", nameId: "mvpAllTimeName",valId: "mvpAllTimeVal", pnlKey: "totalPnL",  isAllTime: true  },
  ];

  for (const slot of slots) {
    const entry  = mvp[slot.key];
    const nameEl = document.getElementById(slot.nameId);
    const valEl  = document.getElementById(slot.valId);
    if (!nameEl || !valEl) continue;

    if (entry) {
      nameEl.textContent = entry.accountName || "Trader";
      if (slot.isAllTime) {
        const adjR = entry.adjReturn ?? 0;
        const sign = adjR >= 0 ? "+" : "";
        valEl.textContent = `${sign}${adjR.toFixed(2)}% adj. return`;
      } else {
        // Use the period-specific P/L so Daily MVP shows today's P/L only, etc.
        const pnl  = entry[slot.pnlKey] ?? 0;
        const sign = pnl >= 0 ? "+" : "";
        valEl.textContent = pnl !== 0
          ? `${sign}${formatSol(pnl)} P/L`
          : "No activity";
      }
    } else {
      nameEl.textContent = "—";
      valEl.textContent  = "No activity yet";
    }
  }
}

/* ============================================================
   LEVEL HELPERS — mirrors dashboard.js calcLevel()
   ============================================================ */
function calcLevel(xp) {
  return Math.floor(Math.sqrt(xp / 100)) + 1;
}
function levelIcon(lvl) {
  if (lvl >= 50) return "◆◆◆";
  if (lvl >= 30) return "◆◆";
  if (lvl >= 20) return "◆";
  if (lvl >= 10) return "▲▲";
  if (lvl >= 5)  return "▲";
  return "·";
}
function levelColor(lvl) {
  if (lvl >= 30) return "#2cffc9";
  if (lvl >= 10) return "#ffb432";
  return "#cffff4";
}

/* ============================================================
   RENDER UNIFIED TABLE  (paginated)
   ============================================================ */
function renderTable(entries) {
  const el = document.getElementById("lbTableBody");
  if (!el) return;

  if (!entries.length) {
    el.innerHTML = `
      <div class="lb-empty">
        <div class="lb-empty-icon">📊</div>
        <div class="lb-empty-title">No rankings yet</div>
        <div style="opacity:0.4;font-size:12px;">Be the first — make a trade in the simulator and your score appears here automatically.</div>
      </div>`;
    return;
  }

  // ── Pagination slice ──────────────────────────────────────
  const totalPages = Math.ceil(entries.length / LB_PAGE_SIZE);
  lbPage = Math.max(0, Math.min(lbPage, totalPages - 1));
  const pageEntries = entries.slice(lbPage * LB_PAGE_SIZE, (lbPage + 1) * LB_PAGE_SIZE);

  // ── Build rows ────────────────────────────────────────────
  const rows = pageEntries.map(e => {
    const isYou   = connectedWallet && e.wallet === connectedWallet;
    const adjR    = e.adjReturn ?? 0;
    const sign    = adjR >= 0 ? "+" : "";
    // Show period-specific P/L in the table column
    const pnl     = currentPeriod === "alltime"  ? (e.totalPnL   ?? 0)
                  : currentPeriod === "daily"     ? (e.dailyPnL   ?? 0)
                  : currentPeriod === "weekly"    ? (e.weeklyPnL  ?? 0)
                  :                                 (e.monthlyPnL ?? 0);
    const pnlSign = pnl >= 0 ? "+" : "";
    const shortW  = e.wallet ? e.wallet.slice(0, 4) + "…" + e.wallet.slice(-4) : "";

    const medal       = e.rank === 1 ? "🥇" : e.rank === 2 ? "🥈" : e.rank === 3 ? "🥉" : null;
    const rowExtraCls = e.rank === 1 ? "lb-row-gold" : e.rank === 2 ? "lb-row-silver" : e.rank === 3 ? "lb-row-bronze" : "";

    /* ── Avatar for this row — use LOCAL_BADGE_MEDIA so img/video fields are available ── */
    let apeHtml;
    if (isYou) {
      const myAvId   = localStorage.getItem("sa_avatar_id");
      const frameCls = getMyFrameCls();
      const avInner  = buildAvatarHtml(myAvId, 28, 6);
      apeHtml = `<div class="dash-avatar-frame ${frameCls}"
        style="width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;">
        ${avInner}
      </div>`;
    } else {
      const initials = (e.accountName || "?").slice(0, 1).toUpperCase();
      const hue = e.wallet ? (e.wallet.charCodeAt(0) + e.wallet.charCodeAt(e.wallet.length - 1)) % 360 : 120;
      /* Try to use first earned badge image as their avatar */
      const rowAvBadge = (e.badges || []).map(id => LOCAL_BADGE_MEDIA[id]).find(m => m?.img);
      if (rowAvBadge?.img) {
        apeHtml = `<div style="width:28px;height:28px;border-radius:7px;overflow:hidden;flex-shrink:0;background:hsla(${hue},40%,20%,0.9);">
          <img src="${rowAvBadge.img}" style="width:100%;height:100%;object-fit:contain;" alt=""
            onerror="this.parentElement.textContent='${initials}'">
        </div>`;
      } else {
        apeHtml = `<div style="width:28px;height:28px;border-radius:7px;background:hsla(${hue},40%,20%,0.9);border:1px solid hsla(${hue},50%,40%,0.35);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:hsla(${hue},60%,70%,0.9);flex-shrink:0;">${initials}</div>`;
      }
    }

    const rankDisplay = medal
      ? `<div class="lb-rank-medal">${medal}</div><div class="lb-rank-sub">#${e.rank}</div>`
      : `<span class="lb-rank-normal">#${e.rank}</span>`;

    const riskCls = e.avgRiskScore >= 65 ? "lb-risk-good"
                  : e.avgRiskScore >= 40 ? "lb-risk-warn"
                  : "lb-risk-bad";

    /* Account Level — computed from XP (server sends e.level, fall back to client calc) */
    const lvl     = e.level || calcLevel((e.tradeCount || 0) * 25 + (e.badges?.length || 0) * 50 + (e.loginStreak || 0) * 5);
    const lvlIcon = levelIcon(lvl);
    const lvlCol  = levelColor(lvl);
    const levelCell = `<div class="lb-level-cell" style="color:${lvlCol};font-weight:700;">${lvlIcon} LVL ${lvl}</div>`;

    const balance = e.balance ?? 10;
    const balDiff = balance - 10; // vs 10 SOL start

    return `
      <tr class="lb-clickable-row ${isYou ? "lb-you-row" : ""} ${rowExtraCls} ${isYou ? (() => { try { return "lb-skin-"+(localStorage.getItem("s2m_dash_skin")||"s2m_original"); } catch { return ""; } })() : ""}" style="animation-delay:${(e.rank - 1) * 0.03}s" onclick="openTraderProfile('${e.wallet}')" title="Click to view profile">
        <td class="lb-rank-cell">${rankDisplay}</td>
        <td>
          <div class="lb-name-cell">
            ${apeHtml}
            <div>
              <div class="lb-name-text">
                ${e.accountName || "Trader"}
                ${isYou ? '<span class="lb-you-badge">YOU</span>' : ""}
              </div>
              <div class="lb-name-wallet">${shortW}</div>
            </div>
          </div>
        </td>
        <td>${levelCell}</td>
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
          <th>Level</th>
          <th>Adj. Return ↕</th>
          <th>${currentPeriod === "alltime" ? "All Time P/L" : currentPeriod === "daily" ? "Today's P/L" : currentPeriod === "weekly" ? "Weekly P/L" : "Monthly P/L"}</th>
          <th>Avg Risk</th>
          <th>Trades</th>
          <th>Last Active</th>
          <th><img src="${SOL_LOGO}" class="s2m-token-icon" style="border-radius:50%;"> Balance</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${paginationHtml}`;

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

  /* ── Sync avatar + frame from Dashboard localStorage ── */
  const emojiEl = banner.querySelector(".lb-your-rank-emoji");
  if (emojiEl) {
    const avId     = localStorage.getItem("sa_avatar_id");
    const frameCls = getMyFrameCls();
    const avInner  = buildAvatarHtml(avId, 42, 8);
    /* Replace the emoji placeholder with a framed avatar wrapper */
    const wrapper  = document.createElement("div");
    wrapper.className = `dash-avatar-frame ${frameCls}`;
    wrapper.style.cssText = "width:42px;height:42px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;";
    wrapper.innerHTML = avInner;
    emojiEl.replaceWith(wrapper);
  }

  const entry = entries.find(e => e.wallet === connectedWallet);
  if (entry) {
    if (nameEl) { nameEl.textContent = entry.accountName || localStorage.getItem("sa_display_name") || "Trader"; nameEl.dataset.populated = "1"; }
    if (posEl)  { posEl.textContent  = `#${entry.rank}`;           posEl.dataset.populated  = "1"; }
  } else {
    // Connected but not ranked yet — show placeholder so Submit Score is still visible
    if (nameEl) { nameEl.textContent = localStorage.getItem("sa_display_name") || "Not yet ranked"; nameEl.dataset.populated = "1"; }
    if (posEl)  { posEl.textContent  = "#—";             posEl.dataset.populated  = "1"; }
  }
}

/* ── Sync display name to server (fire-and-forget) ── */
async function syncDisplayName(wallet) {
  const name = localStorage.getItem("sa_display_name");
  if (!name || !wallet) return;
  try {
    await fetch(SIM_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet, action: "update_name", accountName: name }),
    });
  } catch { /* non-critical */ }
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
    /* Also sync display name so leaderboard shows correct name */
    await syncDisplayName(connectedWallet);
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
    `Ranked #${entry.rank} on @Scan2Moon Leaderboard`,
    `Risk-Adjusted Return: ${sign}${adjR}%`,
    `Avg Risk Score: ${entry.avgRiskScore}/100`,
    `Paper trading with real Birdeye risk intelligence on Solana`,
    `https://scan2moon.com`,
    `#Solana #Crypto #Trading`
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
    { id: "portfolio_100",  img: "/badges/portfolio_100.png",  icon: "📈", name: "100% Growth",           desc: "Doubled your 10 S2M starting balance" },
    { id: "wins_25",        img: "/badges/Wins_25.png",        icon: "⭐", name: "25 Safe Wins",          desc: "25 profitable trades" },
    { id: "wins_50",        img: "/badges/Wins_50.png",        icon: "🌟", name: "50 Safe Wins",          desc: "50 profitable trades" },
    { id: "wins_100",       img: "/badges/Wins_100.png",       icon: "💫", name: "100 Safe Wins",         desc: "100 profitable trades" },
    { id: "wins_500",       img: "/badges/Wins_500.png",       icon: "🚀", name: "500 Safe Wins",         desc: "500 profitable trades" },
    { id: "wins_1000",           img: "/badges/Wins_1000.png", icon: "🐐", name: "1000 Safe Wins — GOAT", desc: "The absolute GOAT." },
    { id: "sol2moon_millionaire", img: "/badges/Sol2Moon.png",  icon: "🌙", name: "Sol2Moon Millionaire",   desc: "Reach 10,000 S2M" },
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

  /* ── Determine skin (read from entry data or localStorage if it's you) ── */
  const isYou = connectedWallet && e.wallet === connectedWallet;
  let activeSkin = e.dashSkin || "s2m_original";
  if (isYou) {
    try { activeSkin = localStorage.getItem("s2m_dash_skin") || activeSkin; } catch {}
  }
  const SKIN_THEMES = {
    s2m_original: { accent: "#2cffc9", accent2: "#c084fc", pos: "#2cffc9", neg: "#ff4d6d", name: "S2M Original", icon: "🌿" },
    neon_degen:   { accent: "#c840ff", accent2: "#ff3aaa",  pos: "#39ff14", neg: "#ff4d6d", name: "Neon Degen",   icon: "🔮" },
  };
  const sk = SKIN_THEMES[activeSkin] || SKIN_THEMES.s2m_original;

  // Rank title (mirrors safe-ape-profile logic, thresholds in SOL)
  const pnl = e.totalPnL || 0;
  let rank, rankColor;
  if (pnl > 50)        { rank = "ELITE PERFORMER";    rankColor = "#ffd166"; }
  else if (pnl > 10)   { rank = "TOP TRADER";         rankColor = "#82b4ff"; }
  else if (pnl > 1)    { rank = "SMART MONEY";        rankColor = "#2cffc9"; }
  else if (pnl > 0)    { rank = "PROFITABLE";         rankColor = "#7fffe1"; }
  else if (pnl > -2)   { rank = "IN TRAINING";        rankColor = "#ffd166"; }
  else                 { rank = "REBUILDING";          rankColor = "#ff4d6d"; }

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

  // Level
  const tpLvl = e.level || calcLevel((e.tradeCount || 0) * 25 + (e.badges?.length || 0) * 50 + (e.loginStreak || 0) * 5);
  const tpLvlIcon = levelIcon(tpLvl);
  const tpLvlCol  = levelColor(tpLvl);

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

  /* ── Avatar ── */
  let avHtml;
  let frameCls = "";
  const avHue = e.wallet ? (e.wallet.charCodeAt(0) + e.wallet.charCodeAt(e.wallet.length - 1)) % 360 : 120;
  if (isYou) {
    const avId = localStorage.getItem("sa_avatar_id");
    frameCls   = getMyFrameCls();
    avHtml     = buildAvatarHtml(avId, 90, 16);
  } else {
    /* Use their highest-value badge image as avatar; fall back to colored initials */
    const avBadge = (e.badges || []).map(id => LOCAL_BADGE_MEDIA[id]).find(m => m?.img);
    const initials = (e.accountName || "?").slice(0, 2).toUpperCase();
    if (avBadge?.img) {
      avHtml = `<div style="width:90px;height:90px;border-radius:16px;overflow:hidden;background:hsla(${avHue},40%,15%,0.95);border:1px solid hsla(${avHue},50%,35%,0.3);display:flex;align-items:center;justify-content:center;">
        <img src="${avBadge.img}" style="width:100%;height:100%;object-fit:contain;" alt=""
          onerror="this.outerHTML='<span style=\\'font-size:28px;font-weight:900;\\'>‍${initials}</span>'">
      </div>`;
    } else {
      avHtml = `<div style="width:90px;height:90px;border-radius:16px;background:hsla(${avHue},40%,15%,0.95);border:1px solid hsla(${avHue},50%,35%,0.4);display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:900;color:hsla(${avHue},55%,70%,0.9);">${initials}</div>`;
    }
  }

  /* ── Win-rate progress bar ── */
  const winRateNum = parseInt(winRate, 10) || 0;
  const winBarFill = `background:linear-gradient(90deg,${sk.pos},${sk.pos}88);width:${winRateNum}%`;

  /* ── Balance vs start track ── */
  const balPct = Math.min(100, Math.max(0, (balance / 20) * 100));
  const balBarFill = `background:linear-gradient(90deg,${pnl >= 0 ? sk.pos : sk.neg},${(pnl >= 0 ? sk.pos : sk.neg)}66);width:${balPct}%`;

  /* ── Badges — merge server defs with LOCAL_BADGE_MEDIA for real images ── */
  const ldBadgesHtml = earnedBadges.length
    ? earnedBadges.slice(0, 10).map(id => {
        const def     = badgeDef_map[id];
        const localM  = LOCAL_BADGE_MEDIA[id];
        const imgSrc  = localM?.img || def.img;
        const icon    = def.icon || localM?.icon || "◆";
        const imgHtml = imgSrc
          ? `<img src="${imgSrc}" class="ld-badge-img" onerror="this.style.display='none';this.nextElementSibling.style.display='block'" alt=""><span class="ld-badge-emoji" style="display:none">${icon}</span>`
          : `<span class="ld-badge-emoji">${icon}</span>`;
        return `<div class="ld-badge-card" title="${def.name}: ${def.desc}">${imgHtml}<div class="ld-badge-name">${def.name}</div></div>`;
      }).join("")
    : `<div style="grid-column:1/-1;padding:14px 0;text-align:center;opacity:0.3;font-size:12px;">No badges yet</div>`;

  /* ── Skin chip ── */
  const skinChip = activeSkin !== "s2m_original"
    ? `<span class="ld-skin-chip skin-${activeSkin}">${sk.icon} ${sk.name}</span>`
    : "";

  /* ── Build popup HTML ── */
  const modal = document.getElementById("traderProfileModal");
  modal.dataset.skin = activeSkin;

  document.getElementById("traderProfileContent").innerHTML = `
    <!-- HEADER -->
    <div class="ld-header">
      <div class="ld-header-left">
        <div class="ld-live-dot"></div>
        <span class="ld-brand">SCAN2MOON</span>
        <span class="ld-type-label">LIVE DASHBOARD</span>
      </div>
      <div class="ld-header-right">
        ${skinChip}
        <button class="ld-close-btn" onclick="window.closeTraderProfile()">✕</button>
      </div>
    </div>

    <!-- BODY -->
    <div class="ld-body">

      <!-- IDENTITY -->
      <div class="ld-identity">
        <div class="dash-avatar-frame ${frameCls} ld-avatar-wrap">${avHtml}</div>
        <div class="ld-identity-info">
          <div class="ld-identity-top">
            <span class="ld-identity-name">${(e.accountName || "Trader").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</span>
            ${isYou ? '<span class="ld-identity-you">YOU</span>' : ""}
            <span class="ld-identity-medal">${medal}</span>
          </div>
          <div class="ld-identity-rank" style="color:${rankColor};">${rank}</div>
          <div class="ld-identity-sub">
            <span class="ld-identity-level" style="color:${tpLvlCol};">${tpLvlIcon} Level ${tpLvl}</span>
            <span style="color:rgba(207,255,244,0.2);">·</span>
            <span style="font-size:10px;color:rgba(207,255,244,0.4);">▲ <strong style="color:rgba(207,255,244,0.75);">${e.loginStreak || 0}</strong>-day streak</span>
          </div>
          <div class="ld-identity-wallet">
            <span>${shortW}</span>
            <a href="https://solscan.io/account/${e.wallet}" target="_blank" rel="noopener noreferrer">Solscan ↗</a>
            <span style="color:rgba(207,255,244,0.2);">·</span>
            <span>🕐 ${e.lastActive || "—"}</span>
          </div>
        </div>
      </div>

      <!-- KEY METRICS -->
      <div class="ld-section-title">KEY METRICS</div>
      <div class="ld-stats-row">
        <div class="ld-stat-box">
          <div class="ld-stat-val" style="color:#ffb432;">${formatSol(balance)}</div>
          <div class="ld-stat-label">Balance</div>
        </div>
        <div class="ld-stat-box">
          <div class="ld-stat-val" style="color:${pnlColor};">${pnlSign}${formatSol(Math.abs(pnl))}</div>
          <div class="ld-stat-label">P / L</div>
        </div>
        <div class="ld-stat-box">
          <div class="ld-stat-val" style="color:${adjColor};">${adjSign}${adjR.toFixed(1)}%</div>
          <div class="ld-stat-label">Adj Return</div>
        </div>
        <div class="ld-stat-box">
          <div class="ld-stat-val" style="color:${riskColor};">${e.avgRiskScore || "—"}</div>
          <div class="ld-stat-label">Avg Risk</div>
        </div>
      </div>

      <!-- BALANCE TRACK -->
      <div class="ld-section-title" style="margin-top:14px;">BALANCE vs START</div>
      <div class="ld-bal-track">
        <div class="ld-bal-track-labels">
          <span class="ld-bal-track-start">Start: 10 S2M</span>
          <span class="ld-bal-track-val" style="color:${pnlColor};">${formatSol(balance)} ${balDiffHtml ? `(${pnl >= 0 ? "+" : ""}${pnlSign}${formatSol(Math.abs(pnl))})` : ""}</span>
        </div>
        <div class="ld-bal-bar"><div class="ld-bal-bar-fill" style="${balBarFill}"></div></div>
      </div>

      <!-- WIN RATE + TRADES -->
      <div class="ld-section-title">PERFORMANCE</div>
      <div class="ld-perf-row">
        <div class="ld-perf-bar"><div class="ld-perf-bar-fill" style="${winBarFill}"></div></div>
        <span class="ld-perf-label" style="color:#ffd166;">${winRate}% Win Rate</span>
      </div>
      <div class="ld-trades-row">
        <div class="ld-trade-box win"><div class="ld-trade-lbl">WIN</div><div class="ld-trade-num">${e.winCount || 0}</div></div>
        <div class="ld-trade-box lose"><div class="ld-trade-lbl">LOSE</div><div class="ld-trade-num">${e.lossCount || 0}</div></div>
        <div class="ld-trade-box total"><div class="ld-trade-lbl">TRADES</div><div class="ld-trade-num">${totalTrades}</div></div>
        <div class="ld-trade-box rate"><div class="ld-trade-lbl">WIN %</div><div class="ld-trade-num">${winRate}%</div></div>
      </div>

      <!-- BADGES -->
      <div class="ld-section-title">ACHIEVEMENTS <span style="opacity:0.45;">(${earnedBadges.length})</span></div>
      <div class="ld-badges-grid">${ldBadgesHtml}</div>

      <!-- FOOTER -->
      <hr class="ld-divider">
      <div class="ld-footer-btns">
        <button id="saveTraderCardBtn" class="ld-footer-btn-main" onclick="window.saveTraderCard()">
          💾 Save Profile Card
        </button>
        <a href="https://solscan.io/account/${e.wallet}" target="_blank" rel="noopener noreferrer" class="ld-footer-btn-sec">
          🔗 View on Solscan
        </a>
      </div>
    </div>
  `;

  const overlay = document.getElementById("traderProfileOverlay");
  overlay.style.display = "flex";
  requestAnimationFrame(() => overlay.classList.add("tp-visible"));
};

window.closeTraderProfile = function(e) {
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
    const walletEl = modal.querySelector(".ld-identity-wallet span, .tp-wallet span");
    const walletSnip = walletEl ? walletEl.textContent.replace(/[^a-zA-Z0-9]/g, "") : "trader";
    const filename = `scan2moon-trader-${walletSnip}.png`;

    const link = document.createElement("a");
    link.download = filename;
    link.href = canvas.toDataURL("image/png");
    link.click();
  } catch (err) {
    btn.parentElement.style.display = "";
    _DEBUG && console.error("Save card failed:", err);
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

window.addEventListener("langchange", () => {
  applyTranslations();
});
