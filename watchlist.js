// watchlist.js – Scan2Moon V2.0 Token Watchlist
import { renderNav } from "./nav.js";
import "./community.js";

const WL_KEY    = "s2m_watchlist";
const SIM_API   = "/.netlify/functions/simulator";
const SOL_PRICE = "https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT";

/* ── Storage helpers ── */
function loadWatchlist() {
  try {
    const raw = localStorage.getItem(WL_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveWatchlist(list) {
  localStorage.setItem(WL_KEY, JSON.stringify(list));
}

export function addToWatchlist(entry) {
  let list = loadWatchlist();
  // Remove duplicate if already saved
  list = list.filter(t => t.mint !== entry.mint);
  list.unshift(entry);
  saveWatchlist(list);
}

export function isOnWatchlist(mint) {
  return loadWatchlist().some(t => t.mint === mint);
}

/* ── Helpers ── */
function timeAgo(isoString) {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function scoreClass(score) {
  if (score >= 65) return "wl-score-good";
  if (score >= 45) return "wl-score-warn";
  return "wl-score-bad";
}

function badgeClass(score) {
  if (score >= 65) return "wl-badge-good";
  if (score >= 45) return "wl-badge-warn";
  return "wl-badge-bad";
}

/* ── Render ── */
function render() {
  const body    = document.getElementById("watchlistBody");
  const pill    = document.getElementById("wlCountPill");
  const clearBtn = document.getElementById("wlClearAll");
  if (!body) return;

  const list = loadWatchlist();

  if (pill) pill.textContent = `${list.length} token${list.length !== 1 ? "s" : ""}`;

  if (!list.length) {
    if (clearBtn) clearBtn.style.display = "none";
    body.innerHTML = `
      <div class="wl-empty">
        <div class="wl-empty-icon">⭐</div>
        <div class="wl-empty-title">Your watchlist is empty</div>
        <div class="wl-empty-sub">
          Scan a token on the <a href="risk-scanner.html">Risk Scanner</a>
          and click <strong>"+ Watchlist"</strong> to save it here.
        </div>
      </div>
    `;
    return;
  }

  if (clearBtn) clearBtn.style.display = "flex";

  body.innerHTML = `
    <div class="wl-grid">
      ${list.map((t, i) => {
        const logoUrl = t.logo
          ? `/.netlify/functions/logoProxy?url=${encodeURIComponent(t.logo)}`
          : "https://placehold.co/44x44";
        const sc = scoreClass(t.totalScore);
        const bc = badgeClass(t.totalScore);

        return `
          <div class="wl-card" id="wlcard-${i}">

            <!-- Card header -->
            <div class="wl-card-top">
              <img class="wl-logo"
                src="${logoUrl}"
                onerror="this.src='https://placehold.co/44x44'"
                referrerpolicy="no-referrer"
              />
              <div class="wl-token-info">
                <div class="wl-token-name">${t.name || "Unknown"}</div>
                <div class="wl-token-symbol">${t.symbol || ""}</div>
              </div>
              <button class="wl-remove-btn" onclick="removeToken('${t.mint}')" title="Remove from watchlist">✕</button>
            </div>

            <!-- Score -->
            <div class="wl-score-row">
              <div>
                <span class="wl-score-num ${sc}" id="wl-score-${i}">${t.totalScore ?? "N/A"}</span>
                <span class="wl-score-max">/100</span>
              </div>
              <div class="wl-risk-badge ${bc}" id="wl-badge-${i}">${t.riskLevel || "UNKNOWN"}</div>
            </div>

            <!-- Live price row -->
            <div class="wl-live-row" id="wl-live-${i}">
              <span class="wl-live-dot">●</span>
              <span class="wl-live-price" id="wl-price-${i}">—</span>
              <span class="wl-live-change" id="wl-change-${i}"></span>
            </div>

            <!-- Metrics -->
            <div class="wl-metrics">
              <div class="wl-metric">
                <div class="wl-metric-label">Market Cap</div>
                <div class="wl-metric-val" id="wl-mcap-${i}">${t.marketCap || "N/A"}</div>
              </div>
              <div class="wl-metric">
                <div class="wl-metric-label">Liquidity</div>
                <div class="wl-metric-val" id="wl-liq-${i}">${t.liquidity || "N/A"}</div>
              </div>
              <div class="wl-metric">
                <div class="wl-metric-label">Top 10 Holders</div>
                <div class="wl-metric-val">${t.top10 || "N/A"}</div>
              </div>
              <div class="wl-metric">
                <div class="wl-metric-label">24H Volume</div>
                <div class="wl-metric-val" id="wl-vol-${i}">—</div>
              </div>
            </div>

            <!-- Footer -->
            <div class="wl-card-footer">
              <span class="wl-saved-time">Saved ${timeAgo(t.savedAt || t.scannedAt)}</span>
            </div>

            <!-- Action buttons — full-width row -->
            <div class="wl-actions">
              <a
                href="https://dexscreener.com/solana/${t.mint}"
                target="_blank"
                rel="noopener noreferrer"
                class="wl-action-btn wl-dex"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                Dex
              </a>
              <button
                class="wl-action-btn wl-rescan"
                onclick="rescanToken('${t.mint}')"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
                Re-scan
              </button>
              <button
                class="wl-action-btn wl-trade-ape"
                onclick="tradeOnSafeApe('${t.mint}')"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
                Trade
              </button>
            </div>

          </div>
        `;
      }).join("")}
    </div>
  `;
}

/* ── Actions ── */
window.removeToken = function(mint) {
  let list = loadWatchlist();
  list = list.filter(t => t.mint !== mint);
  saveWatchlist(list);
  render();
};

window.rescanToken = function(mint) {
  localStorage.setItem("s2m_prefill_mint", mint);
  window.location.href = "risk-scanner.html";
};

window.tradeOnSafeApe = function(mint) {
  localStorage.setItem("s2m_sa_mint", mint);
  window.location.href = "safe-ape.html";
};

/* ============================================================
   LIVE REFRESH — 2s tick, single batched DexScreener call
   ============================================================ */
function fmtSol(n) {
  if (!n && n !== 0) return "0 SOL";
  const abs = Math.abs(n);
  const str = abs < 0.001 ? abs.toFixed(6)
            : abs < 0.1   ? abs.toFixed(4)
            : abs < 10    ? abs.toFixed(3)
            : abs.toFixed(2);
  return (n < 0 ? "-" : "") + str + " SOL";
}

function fmtUsd(v) {
  if (!v) return "N/A";
  const a = Math.abs(v);
  const s = a >= 1e9 ? "$" + (a/1e9).toFixed(2) + "B"
          : a >= 1e6 ? "$" + (a/1e6).toFixed(2) + "M"
          : a >= 1e3 ? "$" + (a/1e3).toFixed(2) + "K"
          : "$" + a.toFixed(2);
  return v < 0 ? "-" + s : s;
}

function fmtPrice(p) {
  if (!p) return "—";
  if (p < 0.000001) return "$" + p.toFixed(10);
  if (p < 0.0001)   return "$" + p.toFixed(8);
  if (p < 0.01)     return "$" + p.toFixed(6);
  if (p < 1)        return "$" + p.toFixed(4);
  return "$" + p.toFixed(2);
}

let _liveRefreshTimer = null;
let _simProfile       = null;  /* cached simulator profile */
let _solUsd           = 0;
let _solUsdFetchedAt  = 0;

async function fetchSolPrice() {
  if (Date.now() - _solUsdFetchedAt < 10000) return; /* refresh max every 10s */
  try {
    const r = await fetch(SOL_PRICE);
    _solUsd = parseFloat((await r.json()).price || "0");
    _solUsdFetchedAt = Date.now();
  } catch {}
}

async function fetchSimProfile() {
  const saWallet = localStorage.getItem("sa_wallet");
  if (!saWallet) { _simProfile = null; return; }
  try {
    const r = await fetch(`${SIM_API}?wallet=${encodeURIComponent(saWallet)}`);
    if (r.ok) _simProfile = (await r.json()).profile;
  } catch {}
}

async function liveRefreshTick() {
  const list = loadWatchlist();
  if (!list.length) return;

  /* Batch fetch all watchlist mints in one DexScreener call (max 30) */
  const mints = list.map(t => t.mint).join(",");
  let pairs = [];
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mints}`);
    const d = await r.json();
    pairs = d.pairs || [];
  } catch { return; }

  await fetchSolPrice();

  list.forEach((t, i) => {
    const card = document.getElementById(`wlcard-${i}`);
    if (!card) return;

    /* Best pair for this mint */
    const pair = pairs
      .filter(p => p.baseToken?.address === t.mint && p.chainId === "solana")
      .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    if (!pair) return;

    const price  = parseFloat(pair.priceUsd || "0");
    const pc24h  = pair.priceChange?.h24 ?? null;
    const mcap   = pair.fdv ?? pair.marketCap ?? 0;
    const liq    = pair.liquidity?.usd ?? 0;
    const vol24  = pair.volume?.h24 ?? 0;

    /* Live price row */
    const priceEl  = document.getElementById(`wl-price-${i}`);
    const changeEl = document.getElementById(`wl-change-${i}`);
    if (priceEl)  { priceEl.textContent = fmtPrice(price); }
    if (changeEl && pc24h !== null) {
      const sign = pc24h >= 0 ? "+" : "";
      changeEl.textContent  = `${sign}${pc24h.toFixed(2)}% 24h`;
      changeEl.className    = "wl-live-change " + (pc24h >= 0 ? "wl-ch-pos" : "wl-ch-neg");
    }

    /* Metrics */
    const mcapEl = document.getElementById(`wl-mcap-${i}`);
    const liqEl  = document.getElementById(`wl-liq-${i}`);
    const volEl  = document.getElementById(`wl-vol-${i}`);
    if (mcapEl) mcapEl.textContent = fmtUsd(mcap);
    if (liqEl)  liqEl.textContent  = fmtUsd(liq);
    if (volEl)  volEl.textContent  = fmtUsd(vol24);

    /* Simulator P/L strip — actual SOL value change (consistent with Current Value) */
    const h = _simProfile?.holdings?.[t.mint];
    if (h && h.amount > 0 && price > 0 && _solUsd > 0) {
      const curValSol = (price * h.amount) / _solUsd;
      const costSol   = h.totalCostSol || ((h.avgPrice * h.amount) / _solUsd);
      const pnlSol    = curValSol - costSol;
      const pnlPct    = costSol > 0 ? (pnlSol / costSol) * 100 : 0;
      injectPnlStrip(card, pnlSol, pnlPct);
    }
  });
}

async function startLiveRefresh() {
  /* Initial load — fetch sim profile first, then first tick */
  await fetchSimProfile();
  await liveRefreshTick();
  /* Then refresh every 2 seconds */
  _liveRefreshTimer = setInterval(liveRefreshTick, 2000);
}

function injectPnlStrip(card, pnlSol, pnlPct) {
  card.querySelector(".wl-sim-pnl")?.remove();

  const isPos  = pnlSol >= 0;
  const sign   = isPos ? "+" : "";
  const cls    = isPos ? "wl-pnl-pos" : "wl-pnl-neg";

  const strip = document.createElement("div");
  strip.className = "wl-sim-pnl";
  strip.innerHTML = `
    <div class="wl-sim-pnl-header">
      <span class="wl-sim-pnl-label">🎮 Safe Ape Position</span>
      <span class="wl-sim-pnl-value ${cls}">
        <span class="wl-pnl-pct">${sign}${pnlPct.toFixed(2)}%</span>
        <span class="wl-pnl-sep">·</span>
        <span class="wl-pnl-sol">${sign}${fmtSol(pnlSol)}</span>
      </span>
    </div>
    <div class="wl-sim-pnl-bar-wrap">
      <div class="wl-sim-pnl-bar ${cls}" style="width:${Math.min(Math.abs(pnlPct), 100).toFixed(1)}%"></div>
    </div>
  `;

  /* Insert above the card footer */
  const footer = card.querySelector(".wl-card-footer");
  footer ? card.insertBefore(strip, footer) : card.appendChild(strip);
}

/* ── Clear all ── */
document.addEventListener("DOMContentLoaded", () => {
  renderNav();
  render();
  startLiveRefresh(); /* batch live refresh every 2s — prices + P/L */

  document.getElementById("wlClearAll")?.addEventListener("click", () => {
    if (confirm("Remove all tokens from your watchlist?")) {
      localStorage.removeItem(WL_KEY);
      render();
    }
  });
});