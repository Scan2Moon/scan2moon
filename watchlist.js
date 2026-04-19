// watchlist.js – Scan2Moon V2.0 Token Watchlist
import { renderNav } from "./nav.js";
import { applyTranslations } from "./i18n.js";
import { computeRiskScore, pickSmartPair } from "./scanSignals.js";
import "./community.js";

const WL_KEY    = "s2m_watchlist";
const WL_FAV_KEY = "s2m_wl_favorites";
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
  _syncHotTokens();
}

/* ── Favorites helpers ── */
function loadFavorites() {
  try {
    const raw = localStorage.getItem(WL_FAV_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}

function saveFavorites(favSet) {
  localStorage.setItem(WL_FAV_KEY, JSON.stringify([...favSet]));
  _syncHotTokens();
}

/* ── Sync hot tokens list to backend (debounced, fire-and-forget) ──
   Sends favorites first (rank 1–N), then remaining watchlist mints.
   The warmCache cron uses this to know which mints to keep fresh.    */
let _syncHotTimer = null;
function _syncHotTokens() {
  clearTimeout(_syncHotTimer);
  _syncHotTimer = setTimeout(async () => {
    try {
      const favs  = [...loadFavorites()];
      const wl    = loadWatchlist().map(t => t.mint).filter(m => !favs.includes(m));
      const mints = [...favs, ...wl].slice(0, 50);
      if (!mints.length) return;
      await fetch("/.netlify/functions/hotTokens", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ mints }),
      });
    } catch { /* non-fatal */ }
  }, 2000); // debounce 2s so rapid toggles don't spam the endpoint
}

const FAV_DASH_MAX = 9;

window.toggleFavorite = function(mint) {
  const favs = loadFavorites();
  if (!favs.has(mint) && favs.size >= FAV_DASH_MAX) {
    _fdShowMaxToast();
    return;
  }
  if (favs.has(mint)) favs.delete(mint);
  else                favs.add(mint);
  saveFavorites(favs);
  render();
};

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

/* Favorite card color variant based on risk score:
   85+ = Moon Coin (chameleon rainbow)
   65+ = Low Risk  (green)
   45+ = Medium    (orange)
   <45 = High Risk (red)                              */
function favColorClass(score) {
  if (score >= 80) return "wl-card--fav-moon";   /* matches scanner Moon threshold */
  if (score >= 65) return "wl-card--fav-green";
  if (score >= 45) return "wl-card--fav-orange";
  return "wl-card--fav-red";
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

  /* Only show Clear All when on the Saved tab — Live Trades tab hides it via _ltSwitchTab,
     but render() is called every 30s by auto-refresh and would override that. */
  if (clearBtn) clearBtn.style.display = _ltActiveTab === "live" ? "none" : "flex";

  /* Sort: favorites pinned to top, rest in original order */
  const favs = loadFavorites();
  const favList  = list.filter(t =>  favs.has(t.mint));
  const restList = list.filter(t => !favs.has(t.mint));

  const renderCard = (t, i, isFav) => {
    const logoUrl = t.logo
      ? `/.netlify/functions/logoProxy?url=${encodeURIComponent(t.logo)}`
      : "https://placehold.co/44x44";
    const sc = scoreClass(t.totalScore);
    const bc = badgeClass(t.totalScore);

    const favRiskClass = isFav ? favColorClass(t.totalScore ?? 0) : "";

    return `
          <div class="wl-card${isFav ? ` wl-card--fav ${favRiskClass}` : ""}" id="wlcard-${i}">

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
              <div class="wl-card-actions">
                <button class="wl-fav-btn${isFav ? " active" : ""}"
                  onclick="toggleFavorite('${t.mint}')"
                  title="${isFav ? "Remove from favorites" : "Add to favorites"}">★</button>
                <button class="wl-remove-btn" onclick="removeToken('${t.mint}')" title="Remove from watchlist">✕</button>
              </div>
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
  };

  /* Build HTML — favorites in their own compact grid, rest in normal grid */
  let gridHtml = "";

  if (favList.length > 0) {
    gridHtml += `
      <div class="wl-section-label wl-section-fav">
        ⭐ Favorites
        <span class="wl-section-count">${favList.length}/${FAV_DASH_MAX}</span>
        <button class="wl-fav-dash-btn" onclick="openFavDashboard()" title="Open Live Dashboard">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
            <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
          </svg>
          Live Wall
        </button>
      </div>`;
    gridHtml += '<div class="wl-fav-grid">';
    gridHtml += favList.map((t, i) => renderCard(t, i, true)).join("");
    gridHtml += "</div>";
  }

  if (restList.length > 0) {
    if (favList.length > 0) {
      gridHtml += `<div class="wl-section-label">All Tokens <span class="wl-section-count">${restList.length}</span></div>`;
    }
    gridHtml += '<div class="wl-grid">';
    gridHtml += restList.map((t, i) => renderCard(t, favList.length + i, false)).join("");
    gridHtml += "</div>";
  }

  body.innerHTML = gridHtml;
}

/* ── Actions ── */
window.removeToken = function(mint) {
  let list = loadWatchlist();
  list = list.filter(t => t.mint !== mint);
  saveWatchlist(list);
  /* Also remove from favorites so it doesn't ghost there */
  const favs = loadFavorites();
  if (favs.has(mint)) { favs.delete(mint); saveFavorites(favs); }
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
   LIVE REFRESH — 30s Birdeye tick (prices + scores, same data as Risk Scanner)
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

/* Risk level string from score — mirrors scanSignals.js */
function riskLevelFromScore(score) {
  if (score >= 80) return "🌕 MOON COIN";
  if (score >= 65) return "LOW RUG RISK";
  if (score >= 45) return "MODERATE RISK";
  if (score >= 25) return "HIGH RUG RISK";
  return "EXTREME RISK 🚨";
}

let _listDirty = false; /* track if we need to saveWatchlist after tick */

/* ── Birdeye score cache ─────────────────────────────────────────────────
   Fetches from our scanToken backend (same source as Risk Scanner).
   30s TTL matches Redis cache — cached hits are instant.
   This ensures the watchlist shows IDENTICAL scores to the Risk Scanner.
   ─────────────────────────────────────────────────────────────────────── */
const _wlBirdeyeCache = {};      // mint → { pair, isPumpFun, hasGraduated, ts }
const _wlInflight     = {};      // mint → Promise — coalesce duplicate in-flight calls
const WL_BIRDEYE_TTL  = 120000;  // 120s in-memory — Redis is 90s, extra buffer avoids stampedes

async function fetchBirdeyeScore(mint, staggerMs = 0) {
  const now = Date.now();

  // 1. In-memory cache hit — instant, no stagger
  if (_wlBirdeyeCache[mint] && (now - _wlBirdeyeCache[mint].ts) < WL_BIRDEYE_TTL) {
    return _wlBirdeyeCache[mint];
  }

  // 2. Already in-flight for this mint — join existing promise instead of firing a 2nd API call
  //    This prevents the cache-stampede where liveRefreshTick + _fdLiveTick both fire
  //    fetchBirdeyeScore for the same mint simultaneously and both hit Birdeye.
  if (_wlInflight[mint]) return _wlInflight[mint];

  // 3. New fetch — create promise, register in _wlInflight so concurrent callers share it
  const p = (async () => {
    try {
      // Only stagger when actually hitting the API
      if (staggerMs > 0) await new Promise(res => setTimeout(res, staggerMs));
      const res = await fetch(`/.netlify/functions/scanToken?mint=${encodeURIComponent(mint)}&lite=1`);
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.ok || !data.pair) return null;
      const entry = {
        pair:         data.pair,
        isPumpFun:    data.isPumpFun    ?? false,
        hasGraduated: data.hasGraduated ?? false,
        stale:        data.stale        ?? false,  // true when Birdeye quota exhausted, data from Neon
        ts: Date.now(),
      };
      _wlBirdeyeCache[mint] = entry;
      return entry;
    } catch { return null; }
    finally { delete _wlInflight[mint]; } // always clean up so next cycle can retry
  })();

  _wlInflight[mint] = p;
  return p;
}

let _liveRefreshRunning = false; /* guard: prevents _fdLiveTick overlapping */

async function liveRefreshTick() {
  const list = loadWatchlist();
  if (!list.length) return;

  const _favs      = loadFavorites();
  const _favList   = list.filter(t =>  _favs.has(t.mint));
  const _restList  = list.filter(t => !_favs.has(t.mint));
  const sortedList = [..._favList, ..._restList];  /* matches DOM index */

  _listDirty = false;
  _liveRefreshRunning = true;

  /* ── Sequential processing — one token at a time ──────────────────────────
     Promise.allSettled fires all tokens simultaneously, which bursts Birdeye
     with 13 concurrent requests even with internal staggering.
     Sequential ensures at most 1 API call in flight at any time.
     Cache hits (90s in-memory cache) are instant — no delay applied.
     Only actual Birdeye calls (cache miss) trigger the 1100ms inter-token gap,
     keeping us safely under the 1 req/sec rate limit.                         */
  for (let i = 0; i < sortedList.length; i++) {
    const t = sortedList[i];

    /* Snapshot cache state before fetching so we know if it was a real call */
    const isCached = _wlBirdeyeCache[t.mint] &&
                     (Date.now() - _wlBirdeyeCache[t.mint].ts) < WL_BIRDEYE_TTL;

    const birdeyeEntry = await fetchBirdeyeScore(t.mint, 0); /* no internal stagger */

    /* ── Update this card's UI immediately as data arrives ── */
    const card = document.getElementById(`wlcard-${i}`);
    if (card && birdeyeEntry?.pair) {
      const pair  = birdeyeEntry.pair;
      const price = parseFloat(pair.priceUsd || "0");
      const pc24h = pair.priceChange?.h24 ?? null;
      const mcap  = pair.marketCap ?? pair.fdv ?? 0;
      const liq   = pair.liquidity?.usd ?? 0;
      const vol24 = pair.volume?.h24 ?? 0;

      const priceEl  = document.getElementById(`wl-price-${i}`);
      const changeEl = document.getElementById(`wl-change-${i}`);
      if (priceEl)  priceEl.textContent = fmtPrice(price);
      if (changeEl && pc24h !== null) {
        const sign = pc24h >= 0 ? "+" : "";
        changeEl.textContent = `${sign}${pc24h.toFixed(2)}% 24h`;
        changeEl.className   = "wl-live-change " + (pc24h >= 0 ? "wl-ch-pos" : "wl-ch-neg");
      }

      const mcapEl = document.getElementById(`wl-mcap-${i}`);
      const liqEl  = document.getElementById(`wl-liq-${i}`);
      const volEl  = document.getElementById(`wl-vol-${i}`);
      if (mcapEl) mcapEl.textContent = fmtUsd(mcap);
      if (liqEl)  liqEl.textContent  = fmtUsd(liq);
      if (volEl)  volEl.textContent  = fmtUsd(vol24);

      /* ── P/L strip ── */
      const h = _simProfile?.holdings?.[t.mint];
      if (h && h.amount > 0 && price > 0 && h.avgPrice > 0 && h.totalCostSol > 0) {
        const costSol   = h.totalCostSol;
        const curValSol = costSol * (price / h.avgPrice);
        const pnlSol    = curValSol - costSol;
        const pnlPct    = (pnlSol / costSol) * 100;
        injectPnlStrip(card, pnlSol, pnlPct);
      }

      /* ── Risk score ── */
      window.scanIsPumpFun    = birdeyeEntry?.isPumpFun    ?? t.isPumpFun    ?? false;
      window.scanHasGraduated = birdeyeEntry?.hasGraduated ?? t.hasGraduated ?? false;
      window.scanCreator      = t.mintAuthority   || undefined;
      window.scanFreezeAuth   = t.freezeAuthority || undefined;
      window.scanDevPercent   = t.devPercent       || undefined;

      const top10PctNum = t.top10PctNum ?? parseFloat(t.top10) ?? 0;
      const bundleScore = t.bundleScore ?? 75;
      const liveScore   = computeRiskScore(pair, top10PctNum, bundleScore);
      const liveLevel   = riskLevelFromScore(liveScore);

      const scoreEl = document.getElementById(`wl-score-${i}`);
      const badgeEl = document.getElementById(`wl-badge-${i}`);
      if (scoreEl) {
        scoreEl.textContent = liveScore;
        scoreEl.className   = "wl-score-num " + scoreClass(liveScore);
      }
      if (badgeEl) {
        badgeEl.textContent = liveLevel;
        badgeEl.className   = "wl-risk-badge " + badgeClass(liveScore);
      }

      if (card.classList.contains("wl-card--fav")) {
        const newFavClass = favColorClass(liveScore);
        if (!card.classList.contains(newFavClass)) {
          card.classList.remove("wl-card--fav-moon", "wl-card--fav-green",
                                "wl-card--fav-orange", "wl-card--fav-red");
          card.classList.add(newFavClass);
        }
      }

      if (t.totalScore !== liveScore) {
        t.totalScore = liveScore;
        t.riskLevel  = liveLevel;
        _listDirty   = true;
      }
    }

    /* ── Rate-limit guard: only delay after a real Birdeye call ──
       1100ms ≈ just over 1 req/sec — stays safely inside Birdeye's limit.
       Cached responses are instant; no delay added for them.               */
    if (!isCached) {
      await new Promise(r => setTimeout(r, 1100));
    }
  }

  /* Save only if scores actually changed — avoids pointless writes */
  if (_listDirty) saveWatchlist(list);
  _liveRefreshRunning = false;
}

async function startLiveRefresh() {
  /* Initial load — fetch sim profile + SOL price first, then first tick */
  await Promise.all([fetchSimProfile(), fetchSolPrice()]);
  await liveRefreshTick();
  /* Refresh every 30s — matches Birdeye Redis cache TTL.
     Cached hits are instant so this is free after the first load. */
  _liveRefreshTimer = setInterval(liveRefreshTick, 30000);
  /* Keep SOL price fresh for P/L calculations */
  setInterval(fetchSolPrice, 30000);

  /* ── Background OHLCV prefetch ─────────────────────────────────────────────
     After liveRefreshTick finishes warming the scanToken cache, silently
     pre-fetch 15m OHLCV for all favorite tokens.  This warms the ohlcvData
     Redis cache so the next openFavDashboard() is instant (cache hits < 100ms).
     Runs sequentially at 1100ms per token so it stays under the Birdeye
     rate limit.  _fdBarCache is populated so TF switching is also instant.    */
  _fdPrefetchFavoritesOhlcv();
}

async function _fdPrefetchFavoritesOhlcv() {
  const favMints = [...loadFavorites()].slice(0, FAV_DASH_MAX);
  if (!favMints.length) return;

  /* Wait a tick for the browser to be idle */
  await new Promise(r => setTimeout(r, 500));

  for (const mint of favMints) {
    if (_liveRefreshRunning) {
      /* liveRefreshTick fired mid-prefetch — pause until it finishes */
      await new Promise(r => setTimeout(r, 1500));
    }
    const key = `${mint}_ohlcv_15m`;
    if (_fdBarCache[key]) continue;   /* already in memory — skip */
    try {
      const t0 = Date.now();
      const r = await fetch(`/.netlify/functions/ohlcvData?mint=${encodeURIComponent(mint)}&tf=15m`);
      if (r.ok) {
        const d = await r.json();
        const bars = (d.bars || []).filter(b => b.time > 0 && b.close > 0).sort((a,b) => a.time - b.time);
        if (bars.length >= 2) {
          _fdBarCache[key] = bars;
          console.log(`[Prefetch] 15m ${mint.slice(0,8)}…: ${bars.length} bars cached (${d.source || "?"}, ${Date.now()-t0}ms)`);
        }
      }
      const elapsed = Date.now() - t0;
      if (elapsed < 250) continue;  /* cache hit — no wait */
      const gap = 1100 - elapsed;
      if (gap > 0) await new Promise(r => setTimeout(r, gap));
    } catch { /* non-fatal: prefetch failure just means first open is slower */ }
  }
  console.log("[Prefetch] OHLCV prefetch complete — dashboard open will be fast.");
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
/* ============================================================
   FAVORITES LIVE DASHBOARD — full-screen 3×3 monitoring wall
   ============================================================ */

let _fdCharts      = {};     /* mint → { chart, candleSeries, tf }  */
let _fdPairMap     = {};     /* mint → pairAddress                   */
let _fdPairData    = {};     /* mint → latest Birdeye pair obj       */
let _fdBarCache    = {};     /* `${mint}_ohlcv_${tf}` → sorted bars  */
let _fdLiveBars    = {};     /* mint → { bucket, open, high, low, close } — current open candle */
let _fdTicker      = null;   /* 5s live-price interval               */
let _fdClock       = null;   /* 1s clock interval                    */
let _fdOpen        = false;
let _fdPrefetchGen = 0;      /* incremented each open — old prefetch detects mismatch → self-aborts */

/* ── Timeframe config ── */
function _fdTfConfig(tf) {
  const map = {
    "1m":  { path: "minute", agg: 1,  limit: 120, tsInterval: 60    },
    "5m":  { path: "minute", agg: 5,  limit: 96,  tsInterval: 300   },
    "15m": { path: "minute", agg: 15, limit: 96,  tsInterval: 900   },
    "1h":  { path: "hour",   agg: 1,  limit: 96,  tsInterval: 3600  },
    "12h": { path: "hour",   agg: 12, limit: 96,  tsInterval: 43200 },
  };
  return map[tf] || map["15m"];
}

/* ── Resample fine-grained bars into a coarser timeframe ──
   Takes the CLOSE price of the last bar that falls inside each coarser bucket.
   e.g. four 15m bars → one 1h bar whose value = the 4th bar's close.           */
function _fdResampleBars(bars, targetSec) {
  if (!bars.length || targetSec <= 0) return [];
  const out = [];
  let bucketTs  = null;
  let lastClose = 0;
  for (const b of bars) {
    const bk = Math.floor(b.time / targetSec) * targetSec;
    if (bk !== bucketTs) {
      if (bucketTs !== null) out.push({ time: bucketTs, value: lastClose });
      bucketTs  = bk;
    }
    lastClose = b.value;
  }
  if (bucketTs !== null && lastClose > 0) out.push({ time: bucketTs, value: lastClose });
  return out;
}

/* ── Fetch + sort OHLCV bars ──
   Priority order:
     1. In-memory cache (instant) — skipped when forceRefresh=true
     2. Resample from a finer-grained cached TF (instant) — skipped when forceRefresh=true
     3. Own Birdeye backend (ohlcvData) — fast, Redis+Neon cached, no external rate limits
     4. Shape fallback from another cached TF (no external call)
   Pass forceRefresh=true from prefetch passes 4/5 to bypass resampled cache and
   get the real multi-day Birdeye window.                                          */
async function _fdFetchBars(pairAddr, tf, forceRefresh = false, mint = null) {
  if (!pairAddr && !mint) return [];

  const cacheKey              = `${pairAddr || mint}_${tf}`;
  const { tsInterval: tgtSec } = _fdTfConfig(tf);

  /* ── 1. Already cached ── */
  if (!forceRefresh && _fdBarCache[cacheKey]) return _fdBarCache[cacheKey];

  /* ── 2. Resample from a finer-grained cached TF ── */
  /* Skip when forceRefresh — we want the real multi-day window, not a resampled 24h slice */
  if (!forceRefresh) {
    for (const srcTf of ["5m", "15m", "1h"]) {
      if (srcTf === tf) continue;
      const src = _fdBarCache[`${pairAddr || mint}_${srcTf}`];
      if (!src || src.length < 2) continue;
      const { tsInterval: srcSec } = _fdTfConfig(srcTf);
      if (srcSec >= tgtSec) continue;         /* can't upsample to finer res */
      const resampled = _fdResampleBars(src, tgtSec);
      if (resampled.length >= 2) {
        console.log(`[FavDash] ${tf} ${(pairAddr||mint).slice(0,8)}…: ${resampled.length} bars (resampled from ${srcTf})`);
        _fdBarCache[cacheKey] = resampled;
        return resampled;
      }
    }
  }

  /* ── 3. Own Birdeye backend (ohlcvData) — fastest, no external rate limits ── */
  /* Supports: 1m, 5m, 15m, 1h, 4h, 1d — falls through for 12h */
  const _ohlcvSupportedTfs = new Set(["1m","5m","15m","1h","4h","1d"]);
  if (mint && _ohlcvSupportedTfs.has(tf)) {
    try {
      const r = await fetch(`/.netlify/functions/ohlcvData?mint=${encodeURIComponent(mint)}&tf=${tf}`);
      if (r.ok) {
        const d = await r.json();
        const raw = d.bars || [];
        const bars = raw
          .filter(b => b.time > 0 && b.close > 0)
          .map(b => ({ time: Number(b.time), value: Number(b.close) }))
          .sort((a, b) => a.time - b.time);
        if (bars.length >= 2) {
          console.log(`[FavDash] ${tf} ${mint.slice(0,8)}…: ${bars.length} bars (ohlcvData/birdeye)`);
          _fdBarCache[cacheKey] = bars;
          return bars;
        }
      }
    } catch (_) { /* fall through */ }
  }

  /* ── 4. Shape fallback: use any cached TF (correct trend, wrong x-scale) ──
     Birdeye-only. Don't cache shape fallback so future retries can get real data.
     Skip when forceRefresh=true — caller wants real data only.               */
  if (!forceRefresh) {
    for (const srcTf of ["15m", "1h", "5m", "12h"]) {
      if (srcTf === tf) continue;
      const src = _fdBarCache[`${pairAddr || mint}_${srcTf}`];
      if (src && src.length >= 2) {
        console.log(`[FavDash] ${tf} ${(pairAddr||mint).slice(0,8)}…: using ${srcTf} bars as shape fallback`);
        return src;
      }
    }
  }

  console.log(`[FavDash] ${tf} ${(pairAddr||mint).slice(0,8)}…: 0 bars (birdeye returned nothing)`);
  return [];
}

/* ── Fetch full OHLCV for candlestick charts ──
   Returns [{time, open, high, low, close}] sorted ascending.
   Birdeye-only: ohlcvData (Redis L1 → Neon L2 → Birdeye). No Gecko/DexScreener.
   Cache key: `${mint}_ohlcv_${tf}`                                                 */
async function _fdFetchOHLCV(pairAddr, tf, mint) {
  const key = mint || pairAddr;
  if (!key) return [];
  const cacheKey = `${key}_ohlcv_${tf}`;
  if (_fdBarCache[cacheKey]) return _fdBarCache[cacheKey];

  /* ── Birdeye backend (Redis L1 → Neon L2 → Birdeye) ── */
  const mintAddr = mint || pairAddr; /* pairAddr === mint in our Birdeye-only setup */
  try {
    const r = await fetch(`/.netlify/functions/ohlcvData?mint=${encodeURIComponent(mintAddr)}&tf=${tf}`);
    if (r.ok) {
      const d = await r.json();
      const bars = (d.bars || [])
        .filter(b => b.time > 0 && b.close > 0)
        .sort((a, b) => a.time - b.time);
      if (bars.length >= 2) {
        console.log(`[FavDash] OHLCV ${tf} ${mintAddr.slice(0,8)}…: ${bars.length} bars (${d.source})`);
        _fdBarCache[cacheKey] = bars;
        return bars;
      }
    }
  } catch (_) { /* network error */ }

  console.log(`[FavDash] OHLCV ${tf} ${mintAddr.slice(0,8)}…: no data`);
  return [];
}

/* ── Safe setData wrapper — validates + copies bars before passing to LightweightCharts ──
   Prevents "Value is null" RAF crashes from bad data reaching the chart library.        */
function _fdSafeSetData(series, bars) {
  if (!series || !bars) return false;
  /* Deep-copy and strictly filter: time must be positive finite integer, value positive finite */
  const clean = bars
    .map(b => ({ time: Math.floor(b.time), value: b.value }))
    .filter(b => Number.isFinite(b.time) && b.time > 0 &&
                 Number.isFinite(b.value) && b.value > 0);
  if (!clean.length) return false;
  try { series.setData(clean); return true; }
  catch (e) { console.warn("[FavDash] setData error:", e.message, "bars:", clean.length); return false; }
}

/* ── Switch timeframe for one card ── */
window._fdSwitchTf = function(mint, tf) {
  /* Swap active button styling immediately */
  const card = document.getElementById(`fdc-${mint}`);
  if (card) {
    card.querySelectorAll(".fdc-tf-btn").forEach(btn =>
      btn.classList.toggle("active", btn.dataset.tf === tf)
    );
  }

  const cd = _fdCharts[mint];
  if (!cd || !cd.candleSeries) return;
  cd.tf = tf;
  delete _fdLiveBars[mint];   /* reset live OHLC tracker for new timeframe */

  const pairAddr = _fdPairMap[mint];
  if (!pairAddr) return;

  /* Invalidate bar cache for this TF so fresh data is fetched */
  delete _fdBarCache[`${mint}_ohlcv_${tf}`];

  /* Fetch new OHLCV and refresh the chart */
  _fdLoadChartData(mint, pairAddr, tf);
};

/* ── Show "no data" message inside a chart wrap ── */
function _fdShowNoData(wrapEl) {
  if (!wrapEl) return;
  /* Only inject if there's no real chart canvas already visible */
  if (!wrapEl.querySelector(".fdc-no-data")) {
    const el = document.createElement("div");
    el.className = "fdc-no-data";
    el.textContent = "No data for this timeframe";
    wrapEl.appendChild(el);
  }
}

/* Remove "no data" label when real data arrives */
function _fdClearNoData(wrapEl) {
  wrapEl?.querySelector(".fdc-no-data")?.remove();
}

/* ── Risk colour per score tier ── */
function _fdChartColor(score) {
  if (score >= 80) return { line: "rgba(190,90,255,0.95)",  top: "rgba(190,90,255,0.22)",  bot: "rgba(190,90,255,0)"   };
  if (score >= 65) return { line: "rgba(44,255,201,0.95)",   top: "rgba(44,255,201,0.22)",   bot: "rgba(44,255,201,0)"    };
  if (score >= 45) return { line: "rgba(255,165,0,0.95)",    top: "rgba(255,165,0,0.22)",    bot: "rgba(255,165,0,0)"     };
  return             { line: "rgba(255,65,85,0.95)",    top: "rgba(255,65,85,0.22)",    bot: "rgba(255,65,85,0)"     };
}
function _fdCardClass(score) {
  if (score >= 80) return "fdc-moon";
  if (score >= 65) return "fdc-green";
  if (score >= 45) return "fdc-orange";
  return "fdc-red";
}

/* ── Open / close ── */
window.openFavDashboard = async function() {
  const favMints = [...loadFavorites()].slice(0, FAV_DASH_MAX);
  if (!favMints.length) return;

  /* Signal any currently-running prefetch to self-abort BEFORE we rebuild.
     _fdPrefetchAllTfs checks alive() at each await point and returns early
     when it sees its captured generation no longer matches _fdPrefetchGen.  */
  _fdPrefetchGen++;
  _fdLiveBars = {};   /* reset OHLC tracker so new session starts clean */

  document.getElementById("favDashModal").style.display = "flex";
  _fdOpen = true;
  document.addEventListener("keydown", _fdEscKey);

  await _fdBuild(favMints);
  _fdStartTicker();
  _fdStartClock();
};

window.closeFavDashboard = function() {
  _fdOpen = false;
  document.getElementById("favDashModal").style.display = "none";
  document.removeEventListener("keydown", _fdEscKey);
  _fdStopTicker();
  _fdStopClock();
  _fdDestroyCharts();
};

window._fdBgClick = function(e) {
  if (e.target.id === "favDashModal") closeFavDashboard();
};

function _fdEscKey(e) {
  if (e.key === "Escape") closeFavDashboard();
}

/* ── Stale-data banner: shown when Birdeye quota is exhausted ── */
function _fdShowStaleBanner(show = true) {
  let el = document.getElementById("fdStaleBanner");
  if (!el) {
    el = document.createElement("div");
    el.id = "fdStaleBanner";
    el.style.cssText = [
      "display:none",
      "position:sticky",
      "top:0",
      "z-index:10",
      "background:rgba(255,180,0,0.12)",
      "border-bottom:1px solid rgba(255,180,0,0.30)",
      "color:rgba(255,220,100,0.9)",
      "font-size:12px",
      "text-align:center",
      "padding:6px 12px",
      "letter-spacing:0.03em",
    ].join(";");
    el.textContent = "⚠️  Live data unavailable — showing last saved prices (Birdeye quota exceeded). Charts and P/L may be outdated.";
    const overlay = document.getElementById("favDashOverlay");
    if (overlay) overlay.prepend(el);
  }
  el.style.display = show ? "block" : "none";
}

/* ── Max-9 toast ── */
function _fdShowMaxToast() {
  const el = document.getElementById("fdMaxToast");
  if (!el) return;
  el.style.display = "block";
  el.classList.add("fd-toast-show");
  setTimeout(() => {
    el.classList.remove("fd-toast-show");
    setTimeout(() => { el.style.display = "none"; }, 400);
  }, 2800);
}

/* ── Build the grid ── */
async function _fdBuild(favMints) {
  const list   = loadWatchlist();
  const tokens = favMints
    .map(mint => list.find(t => t.mint === mint))
    .filter(Boolean)
    .slice(0, FAV_DASH_MAX);

  const count = tokens.length;
  const rows  = count <= 3 ? 1 : count <= 6 ? 2 : 3;

  const grid = document.getElementById("favDashGrid");
  grid.innerHTML = "";
  grid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
  _fdCharts = {};
  _fdPairMap = {};

  const sub = document.getElementById("fdSubLabel");
  if (sub) sub.textContent = `${count} token${count !== 1 ? "s" : ""}`;

  /* Render empty card shells */
  tokens.forEach(t => {
    const logoUrl = t.logo
      ? `/.netlify/functions/logoProxy?url=${encodeURIComponent(t.logo)}`
      : "https://placehold.co/44x44";
    const sc  = scoreClass(t.totalScore ?? 0);
    const bc  = badgeClass(t.totalScore ?? 0);
    const riskCls = _fdCardClass(t.totalScore ?? 0);

    const card = document.createElement("div");
    card.className = `fav-dash-card ${riskCls}`;
    card.id = `fdc-${t.mint}`;
    card.innerHTML = `
      <div class="fdc-header">
        <img class="fdc-logo" src="${logoUrl}"
             onerror="this.src='https://placehold.co/40x40'" referrerpolicy="no-referrer"/>
        <div class="fdc-info">
          <div class="fdc-name">${t.name || "Unknown"}</div>
          <div class="fdc-sym">${t.symbol || ""}</div>
        </div>
        <div class="fdc-price-block">
          <div class="fdc-price" id="fdcp-${t.mint}">—</div>
          <div class="fdc-change" id="fdcc-${t.mint}"></div>
        </div>
      </div>
      <div class="fdc-tf-bar">
        <button class="fdc-tf-btn" data-tf="1m"  onclick="_fdSwitchTf('${t.mint}','1m')">1m</button>
        <button class="fdc-tf-btn" data-tf="5m"  onclick="_fdSwitchTf('${t.mint}','5m')">5m</button>
        <button class="fdc-tf-btn active" data-tf="15m" onclick="_fdSwitchTf('${t.mint}','15m')">15m</button>
        <button class="fdc-tf-btn" data-tf="1h"  onclick="_fdSwitchTf('${t.mint}','1h')">1h</button>
        <button class="fdc-tf-btn" data-tf="12h" onclick="_fdSwitchTf('${t.mint}','12h')">12h</button>
      </div>
      <div class="fdc-chart-wrap" id="fdcw-${t.mint}">
        <div class="fdc-chart-loading">Loading chart…</div>
      </div>
      <div class="fdc-footer">
        <span class="fdc-score-num wl-score-num ${sc}" id="fdcs-${t.mint}">${t.totalScore ?? "—"}</span>
        <span class="fdc-score-max">/100</span>
        <span class="fdc-risk-badge wl-risk-badge ${bc}" id="fdcl-${t.mint}">${t.riskLevel || "—"}</span>
        <span class="fdc-age" id="fdca-${t.mint}"></span>
      </div>
    `;
    grid.appendChild(card);
  });

  /* ── Fetch initial pair data sequentially ─────────────────────────────────
     Most tokens will already be in _wlBirdeyeCache from liveRefreshTick.
     Sequential ensures we don't burst Birdeye if caches are cold.           */
  let anyStale = false;
  for (const t of tokens) {
    const isCached = _wlBirdeyeCache[t.mint] &&
                     (Date.now() - _wlBirdeyeCache[t.mint].ts) < WL_BIRDEYE_TTL;
    const entry = await fetchBirdeyeScore(t.mint, 0);
    if (!entry?.pair) {
      if (!isCached) await new Promise(r => setTimeout(r, 1100));
      continue;
    }
    if (entry.stale) anyStale = true;
    _fdPairMap[t.mint]  = t.mint;
    _fdPairData[t.mint] = entry.pair;
    _fdUpdateCard(t.mint, entry.pair, t);
    if (!isCached) await new Promise(r => setTimeout(r, 1100));
  }
  /* Show/hide stale warning banner */
  _fdShowStaleBanner(anyStale);

  /* ── Create LightweightCharts charts + load OHLCV ───────────────────────────
     Smart-delay pattern:
       • Cache hit  (< 250ms) → next chart starts immediately — no wait
       • Birdeye call (≥ 250ms) → enforce 1100ms total spacing so we stay
         under the 1 req/sec rate limit
     This means: on warm ohlcvData cache all 9 charts appear in < 1 second.
     On cold cache they load sequentially but still as fast as the rate limit
     allows.                                                                   */
  await new Promise(r => setTimeout(r, 100)); /* let browser paint grid first */

  /* Wait until liveRefreshTick is done (max 30s) — shares same Birdeye budget */
  const waitStart = Date.now();
  while (_liveRefreshRunning && (Date.now() - waitStart) < 30000) {
    await new Promise(r => setTimeout(r, 200));
  }

  for (const t of tokens) {
    const pa = _fdPairMap[t.mint];
    if (!pa) continue;                          /* no pair = chart stays "No chart data" */

    const loadEl = _fdInitChart(t);             /* sync: creates chart container only */
    if (!loadEl) continue;                      /* _fdInitChart returns null if no pair */

    const t0 = Date.now();
    await _fdLoadChartData(t.mint, pa, "15m", loadEl); /* awaited — we time it */

    const elapsed = Date.now() - t0;
    if (elapsed >= 250) {
      /* Real Birdeye call — enforce 1100ms total gap to respect rate limit */
      const remaining = 1100 - elapsed;
      if (remaining > 0) await new Promise(r => setTimeout(r, remaining));
    }
    /* Cache hit (< 250ms): no extra wait — browser paints immediately */
  }
}

async function _fdPrefetchAllTfs(tokens) {
  /* Background multi-TF prefetch using Birdeye ohlcvData.
     Strategy:
       Pass 1 – fetch 15m for all tokens, 1100ms apart. Track which fail.
       Pass 2 – retry tokens that returned 0 bars (transient error, 2s pause first).
       Pass 3 – fetch 5m for tokens with 15m data.
       Pass 4 – real 1h (forceRefresh), fallback to resample if no Birdeye data.
       Pass 5 – real 12h (forceRefresh), fallback to resample.
     Each pass upgrades charts live as data arrives.

     Generation guard: if openFavDashboard() is called again mid-flight it increments
     _fdPrefetchGen. alive() detects the mismatch and returns early so the old
     prefetch aborts cleanly — no duplicate API hammering or cache corruption.      */

  const myGen  = _fdPrefetchGen;                         /* captured at start */
  const alive  = () => _fdOpen && _fdPrefetchGen === myGen; /* still the active run? */
  const wait   = ms => alive() ? new Promise(r => setTimeout(r, ms)) : Promise.resolve();

  /* Wait for liveRefreshTick to finish — both streams share Birdeye rate limit */
  const prefetchWaitStart = Date.now();
  while (_liveRefreshRunning && alive() && (Date.now() - prefetchWaitStart) < 30000) {
    await wait(300);
  }
  if (!alive()) return;

  const noData = new Set(); /* pair addresses that returned 0 bars in Pass 1 */

  /* ── Pass 1: 15m, first attempt — Birdeye ohlcvData only, 1100ms between tokens ── */
  for (const t of tokens) {
    if (!alive()) return;
    const pa = _fdPairMap[t.mint];
    if (!pa) continue;
    if (_fdBarCache[`${pa}_15m`]) { _fdUpgradeChart(t.mint, "15m"); }
    else {
      const bars = await _fdFetchBars(pa, "15m", false, t.mint);
      if (!alive()) return;
      if (bars.length) _fdUpgradeChart(t.mint, "15m");
      else             noData.add(pa);
      await wait(1100); /* 1100ms after real API call — cache hits skip this */
    }
  }

  /* ── Pass 2: retry tokens that returned 0 bars — may be a transient error.
     With Birdeye as primary the main failure mode is a new token not yet indexed
     rather than rate-limiting, so wait only 2s instead of 10s.                  */
  const succeeded = tokens.filter(t => _fdPairMap[t.mint] && _fdBarCache[`${_fdPairMap[t.mint]}_15m`]).length;
  const likelyRateLimited = succeeded > 0 && noData.size > 0;

  if (likelyRateLimited && alive()) {
    console.log(`[FavDash] Retrying ${noData.size} token(s)…`);
    await wait(2000);
    for (const t of tokens) {
      if (!alive()) return;
      const pa = _fdPairMap[t.mint];
      if (!pa || !noData.has(pa) || _fdBarCache[`${pa}_15m`]) continue;
      const bars = await _fdFetchBars(pa, "15m", false, t.mint);
      if (!alive()) return;
      if (bars.length) _fdUpgradeChart(t.mint, "15m");
      await wait(500);
    }
  }

  /* ── Pass 3: 5m for tokens with 15m data ──
     Using ohlcvData (Birdeye) — fast, 500ms between tokens.                     */
  await wait(500);
  for (const t of tokens) {
    if (!alive()) return;
    const pa = _fdPairMap[t.mint];
    if (!pa || !_fdBarCache[`${pa}_15m`] || _fdBarCache[`${pa}_5m`]) continue;
    await _fdFetchBars(pa, "5m", false, t.mint);
    if (!alive()) return;
    _fdUpgradeChart(t.mint, "5m");
    await wait(500);
  }

  /* ── Pass 4: 1h data (200 bars × 1h ≈ 8-day window) ──
     ohlcvData serves 1h natively. If still empty, resample from 15m.           */
  await wait(500);
  for (const t of tokens) {
    if (!alive()) return;
    const pa = _fdPairMap[t.mint];
    if (!pa || !_fdBarCache[`${pa}_15m`]) continue;
    const bars1h = await _fdFetchBars(pa, "1h", true /* forceRefresh */, t.mint);
    if (!alive()) return;
    if (!bars1h.length && !_fdBarCache[`${pa}_1h`]) {
      const resampled = _fdResampleBars(_fdBarCache[`${pa}_15m`], 3600);
      if (resampled.length >= 2) {
        _fdBarCache[`${pa}_1h`] = resampled;
        console.log(`[FavDash] 1h ${pa.slice(0,8)}…: ${resampled.length} bars (resampled fallback)`);
      }
    }
    _fdUpgradeChart(t.mint, "1h");
    await wait(500);
  }

  /* ── Pass 5: 12h data — ohlcvData doesn't support 12h, falls through to
     shape fallback (resample 1h → 12h). No external API calls needed.          */
  await wait(2000);
  for (const t of tokens) {
    if (!alive()) return;
    const pa = _fdPairMap[t.mint];
    if (!pa || !_fdBarCache[`${pa}_15m`]) continue;
    const bars12h = await _fdFetchBars(pa, "12h", true /* forceRefresh */, t.mint);
    if (!alive()) return;
    if (!bars12h.length && !_fdBarCache[`${pa}_12h`]) {
      const src = _fdBarCache[`${pa}_1h`] || _fdBarCache[`${pa}_15m`];
      if (src) {
        const resampled = _fdResampleBars(src, 43200);
        if (resampled.length >= 2) {
          _fdBarCache[`${pa}_12h`] = resampled;
          console.log(`[FavDash] 12h ${pa.slice(0,8)}…: ${resampled.length} bars (resampled fallback)`);
        }
      }
    }
    _fdUpgradeChart(t.mint, "12h");
    await wait(3000);
  }

  if (alive()) console.log("[FavDash] Background OHLCV fetch complete.");
}

/* Upgrade a chart with freshly fetched data.
   Handles two cases:
     a) synthetic → real  (Pass 1/2/3: first real data arrives)
     b) resampled → real  (Pass 4/5: 1h/12h real window replaces 24h resampled slice)
   In case (b) cd.synthetic is false but the chart is showing resampled data; we still
   want to swap in the new bars as long as the active TF matches.                       */
function _fdUpgradeChart(mint, tf) {
  const cd = _fdCharts[mint];
  if (!cd) return;
  if (cd.tf !== tf) return;                     /* user may have switched away */
  const pairAddr = _fdPairMap[mint];
  if (!pairAddr) return;
  const bars = _fdBarCache[`${pairAddr}_${tf}`];
  if (!bars || bars.length < 2) return;

  /* Only upgrade if:
       – the chart is synthetic (always upgrade), OR
       – the new bars cover a meaningfully larger time window than what's shown.
         This catches the resampled-24h → real-4day upgrade in Pass 4/5.          */
  const wrapEl = document.getElementById(`fdcw-${mint}`);
  const wasLabel = cd.synthetic ? "synthetic" : "resampled";

  _fdClearNoData(wrapEl);
  cd.synthetic     = false;
  cd.shapeFallback = false; /* clear static flag — live tick can now extend bars */
  if (_fdSafeSetData(cd.series, bars)) {
    try { cd.chart.timeScale().fitContent(); } catch {}
    console.log(`[FavDash] Upgraded ${mint.slice(0,8)}… chart from ${wasLabel} → real (${tf}, ${bars.length} bars)`);
  }
}

/* ── Initialise a single chart card with LightweightCharts candlesticks ──
   Birdeye-only: ohlcvData (Redis → Neon → Birdeye).
   Renders directly in a canvas — no iframes, no hydration issues, full OHLCV support. */
function _fdInitChart(t, tf = "15m") {
  const wrapEl = document.getElementById(`fdcw-${t.mint}`);
  if (!wrapEl) return;

  /* Destroy any existing chart instance first */
  const existing = _fdCharts[t.mint];
  if (existing?.chart) { try { existing.chart.remove(); } catch {} }

  wrapEl.innerHTML = "";

  const pairAddr = _fdPairMap[t.mint];
  if (!pairAddr) {
    const noData = document.createElement("div");
    noData.className = "fdc-no-data";
    noData.textContent = "No chart data";
    wrapEl.appendChild(noData);
    _fdCharts[t.mint] = { chart: null, candleSeries: null, tf };
    return;
  }

  /* Chart mount div */
  const chartDiv = document.createElement("div");
  chartDiv.style.cssText = "width:100%;height:100%;";
  wrapEl.appendChild(chartDiv);

  /* Loading label */
  const loadEl = document.createElement("div");
  loadEl.className = "fdc-chart-loading";
  loadEl.textContent = "Loading chart…";
  wrapEl.appendChild(loadEl);

  /* Create LightweightCharts instance — compact settings for small cards */
  const chart = LightweightCharts.createChart(chartDiv, {
    autoSize: true,
    layout: {
      background: { type: "solid", color: "#040d0b" },
      textColor:  "rgba(207,255,244,0.40)",
      fontFamily: "'Segoe UI', system-ui, sans-serif",
      fontSize:   10,
    },
    grid: {
      vertLines: { color: "rgba(44,255,201,0.04)" },
      horzLines: { color: "rgba(44,255,201,0.04)" },
    },
    crosshair: {
      mode:     LightweightCharts.CrosshairMode.Normal,
      vertLine: { color: "rgba(207,255,244,0.18)", labelBackgroundColor: "#0d2820" },
      horzLine: { color: "rgba(207,255,244,0.18)", labelBackgroundColor: "#0d2820" },
    },
    rightPriceScale: {
      borderColor:  "rgba(44,255,201,0.08)",
      textColor:    "rgba(207,255,244,0.40)",
      scaleMargins: { top: 0.06, bottom: 0.05 },
      mode: LightweightCharts.PriceScaleMode.Logarithmic,
    },
    timeScale: {
      borderColor:    "rgba(44,255,201,0.08)",
      textColor:      "rgba(207,255,244,0.40)",
      timeVisible:    true,
      secondsVisible: false,
      rightOffset:    3,
      fixRightEdge:   false,
    },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true },
    handleScale:  { mouseWheel: true, pinch: true },
  });

  /* Candlestick series — green up / red down */
  const candleSeries = chart.addCandlestickSeries({
    upColor:         "#26c98a",
    downColor:       "#ef5350",
    borderUpColor:   "#26c98a",
    borderDownColor: "#ef5350",
    wickUpColor:     "#26c98a",
    wickDownColor:   "#ef5350",
    priceFormat: {
      type:      "custom",
      minMove:   0.000000001,
      formatter: (p) => {
        if (!p || p <= 0) return "0";
        if (p < 0.000001) return p.toFixed(9);
        if (p < 0.0001)   return p.toFixed(7);
        if (p < 0.01)     return p.toFixed(5);
        if (p < 1)        return p.toFixed(4);
        return p.toFixed(3);
      },
    },
  });

  _fdCharts[t.mint] = { chart, candleSeries, tf };

  return loadEl;  /* caller handles the data fetch — no fire-and-forget here */
}

/* ── Fetch OHLCV and render into an existing chart ── */
async function _fdLoadChartData(mint, pairAddr, tf, loadEl) {
  const bars = await _fdFetchOHLCV(pairAddr, tf, mint);
  const cd   = _fdCharts[mint];
  if (!cd || !cd.candleSeries) return;   /* chart was destroyed while fetching */

  /* Remove loading label */
  if (loadEl) loadEl.remove();
  else document.querySelector(`#fdcw-${mint} .fdc-chart-loading`)?.remove();

  if (bars.length < 2) {
    /* Show "no data" overlay — chart canvas stays (may get data later) */
    const wrapEl = document.getElementById(`fdcw-${mint}`);
    if (wrapEl && !wrapEl.querySelector(".fdc-no-data")) {
      const el = document.createElement("div");
      el.className   = "fdc-no-data";
      el.textContent = "No chart data";
      wrapEl.appendChild(el);
    }
    return;
  }

  /* Remove stale "no data" labels */
  document.querySelector(`#fdcw-${mint} .fdc-no-data`)?.remove();

  try {
    cd.candleSeries.setData(bars);
    cd.chart.timeScale().fitContent();
  } catch (e) {
    console.warn("[FavDash] candleSeries.setData error:", e.message);
  }
}

/* ── Update card price/score/badge from a live pair object ── */
function _fdUpdateCard(mint, pair, storedToken) {
  const price = parseFloat(pair.priceUsd || "0");
  const pc24h = pair.priceChange?.h24 ?? null;

  const priceEl  = document.getElementById(`fdcp-${mint}`);
  const changeEl = document.getElementById(`fdcc-${mint}`);
  if (priceEl) priceEl.textContent = fmtPrice(price);
  if (changeEl && pc24h !== null) {
    const sign = pc24h >= 0 ? "+" : "";
    changeEl.textContent = `${sign}${pc24h.toFixed(2)}%`;
    changeEl.className   = "fdc-change " + (pc24h >= 0 ? "fdc-pos" : "fdc-neg");
  }

  /* Age label */
  const ageEl = document.getElementById(`fdca-${mint}`);
  if (ageEl && pair.pairCreatedAt) {
    const ms  = Date.now() - (pair.pairCreatedAt < 1e12 ? pair.pairCreatedAt * 1000 : pair.pairCreatedAt);
    const min = Math.floor(ms / 60000);
    ageEl.textContent = min < 60 ? `${min}m old`
      : min < 1440 ? `${Math.floor(min / 60)}h old`
      : `${Math.floor(min / 1440)}d old`;
  }

  /* Live risk score */
  if (storedToken) {
    window.scanIsPumpFun    = _fdPairMap[mint] ? (storedToken.isPumpFun    ?? false) : false;
    window.scanHasGraduated = storedToken.hasGraduated ?? false;
    window.scanCreator      = storedToken.mintAuthority   || undefined;
    window.scanFreezeAuth   = storedToken.freezeAuthority || undefined;
    window.scanDevPercent   = storedToken.devPercent      || undefined;

    const liveScore = computeRiskScore(pair, storedToken.top10PctNum ?? 0, storedToken.bundleScore ?? 75);
    const liveLevel = riskLevelFromScore(liveScore);
    const scoreEl   = document.getElementById(`fdcs-${mint}`);
    const levelEl   = document.getElementById(`fdcl-${mint}`);
    if (scoreEl) { scoreEl.textContent = liveScore; scoreEl.className = `fdc-score-num wl-score-num ${scoreClass(liveScore)}`; }
    if (levelEl) { levelEl.textContent = liveLevel; levelEl.className = `fdc-risk-badge wl-risk-badge ${badgeClass(liveScore)}`; }

    /* Recolour card border if risk tier changed */
    const card = document.getElementById(`fdc-${mint}`);
    if (card) {
      const newCls = _fdCardClass(liveScore);
      if (!card.classList.contains(newCls)) {
        card.classList.remove("fdc-moon", "fdc-green", "fdc-orange", "fdc-red");
        card.classList.add(newCls);
      }
    }
  }
}

/* ── Live tick: refresh prices every 5s from Birdeye + smooth OHLC candle ──
   Proper OHLC tracking per candle bucket so candles look live and smooth.    */
function _fdStartTicker() {
  _fdStopTicker();
  _fdTicker = setInterval(_fdLiveTick, 20000); /* 20s — liveRefreshTick handles price refresh every 30s */
}
function _fdStopTicker() {
  if (_fdTicker) { clearInterval(_fdTicker); _fdTicker = null; }
}

let _fdTickRunning = false; /* guard against overlapping ticks */
async function _fdLiveTick() {
  /* Skip if liveRefreshTick is mid-run — they share Birdeye API quota */
  if (!_fdOpen || _fdTickRunning || _liveRefreshRunning) return;
  _fdTickRunning = true;
  try { await _fdLiveTickInner(); } finally { _fdTickRunning = false; }
}

async function _fdLiveTickInner() {
  const favMints = [...loadFavorites()].slice(0, FAV_DASH_MAX);
  if (!favMints.length) return;
  const list = loadWatchlist();
  const now  = Math.floor(Date.now() / 1000);
  let tickStale = false;

  for (const mint of favMints) {
    if (!_fdOpen) break;
    /* Snapshot cache state — determines if we need a post-call delay */
    const isCached = _wlBirdeyeCache[mint] &&
                     (Date.now() - _wlBirdeyeCache[mint].ts) < WL_BIRDEYE_TTL;
    /* Birdeye via cache (instant when WL_BIRDEYE_TTL not expired) */
    const entry = await fetchBirdeyeScore(mint);
    if (!entry?.pair) {
      if (!isCached) await new Promise(r => setTimeout(r, 1100));
      continue;
    }
    if (entry.stale) tickStale = true;
    const pair        = entry.pair;
    const storedToken = list.find(t => t.mint === mint);

    _fdPairData[mint] = pair;
    _fdUpdateCard(mint, pair, storedToken);

    /* ── Smooth candle update ─────────────────────────────────────────────
       Track open/high/low/close per bucket instead of flat open=close=price.
       This gives realistic wicks and body as price moves within the candle. */
    const cd = _fdCharts[mint];
    if (!cd?.candleSeries) continue;
    const price = parseFloat(pair.priceUsd || "0");
    if (!price || !isFinite(price) || price <= 0) continue;

    const tfSec  = _fdTfToSec(cd.tf);
    const bucket = Math.floor(now / tfSec) * tfSec;

    let bar = _fdLiveBars[mint];
    if (!bar || bar.bucket !== bucket) {
      /* New candle — open at last close for a gapless chart */
      const prevClose = bar ? bar.close : price;
      _fdLiveBars[mint] = bar = { bucket, open: prevClose, high: Math.max(prevClose, price), low: Math.min(prevClose, price), close: price };
    } else {
      bar.high  = Math.max(bar.high, price);
      bar.low   = Math.min(bar.low,  price);
      bar.close = price;
    }

    try {
      cd.candleSeries.update({ time: bar.bucket, open: bar.open, high: bar.high, low: bar.low, close: bar.close });
    } catch (_) { /* chart may have been destroyed */ }

    /* Only delay if this was a real API call — cache hits are instant */
    if (!isCached) await new Promise(r => setTimeout(r, 1100));
  }

  /* Update stale banner — hide when live data is back */
  _fdShowStaleBanner(tickStale);
}

/* Timeframe label → seconds (used by live tick to snap to bucket) */
function _fdTfToSec(tf) {
  return { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "12h": 43200, "1d": 86400 }[tf] || 900;
}

/* ── Clock ── */
function _fdStartClock() {
  _fdStopClock();
  const el = document.getElementById("fdClock");
  const tick = () => {
    if (!_fdOpen || !el) return;
    const now = new Date();
    el.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };
  tick();
  _fdClock = setInterval(tick, 1000);
}
function _fdStopClock() {
  if (_fdClock) { clearInterval(_fdClock); _fdClock = null; }
}

/* ── Build a 2-point synthetic trend from Birdeye price-change data.
   Each TF maps to its most appropriate historical anchor so TF switching
   actually changes the visible time window even without OHLCV data:
     5m  → m5  anchor (5 min range)
     15m → h1  anchor (1 h range)
     1h  → h6  anchor (6 h range)
     12h → h24 anchor (24 h range)
   Formula: priceAtAnchor = currentPrice / (1 + changePct / 100)
   Guard: pct must be > -100 (otherwise denominator ≤ 0 → Infinity)          */
function _fdSyntheticBars(pair, tf = "15m") {
  const price = parseFloat(pair.priceUsd || "0");
  if (!price || !isFinite(price) || price <= 0) return [];

  const now = Math.floor(Date.now() / 1000);
  const pc  = pair.priceChange || {};

  /* Helper — convert a priceChange% + seconds-ago into a { time, value } point.
     Returns null if the data is missing or would produce an invalid price.     */
  function pt(pct, ago) {
    if (pct == null || !isFinite(pct) || pct <= -100) return null;
    const v = price / (1 + pct / 100);
    return (isFinite(v) && v > 0) ? { time: now - ago, value: v } : null;
  }

  /* Multi-anchor synthetic path per TF.
     Using multiple real Birdeye price-change checkpoints gives a much more
     realistic curve than a flat diagonal — reflects actual price trajectory.    */
  const TF_POINTS = {
    "5m":  [pt(pc.h1, 3600),  pt(pc.m5, 300)  ],
    "15m": [pt(pc.h6, 21600), pt(pc.h1, 3600)  ],
    "1h":  [pt(pc.h24,86400), pt(pc.h6, 21600) ],
    "12h": [pt(pc.h24,86400)                    ],
  };

  const pts = (TF_POINTS[tf] || TF_POINTS["15m"])
    .filter(Boolean)                          /* drop nulls (missing data) */
    .concat([{ time: now, value: price }]);   /* always end at current price */

  return pts.length >= 2 ? pts : [];
}

/* ── Cleanup ── */
function _fdDestroyCharts() {
  for (const mint of Object.keys(_fdCharts)) {
    try { _fdCharts[mint]?.chart?.remove(); } catch {}
  }
  _fdCharts   = {};
  _fdPairMap  = {};
  _fdPairData = {};
  _fdBarCache = {};
}

/* ── Auto-refresh counter displayed in page header ── */
let _autoRefreshTimer = null;
let _autoRefreshCountdown = 30;

function _startAutoRefresh() {
  if (_autoRefreshTimer) clearInterval(_autoRefreshTimer);
  _autoRefreshCountdown = 30;
  _updateRefreshBadge();

  _autoRefreshTimer = setInterval(() => {
    _autoRefreshCountdown--;
    _updateRefreshBadge();
    if (_autoRefreshCountdown <= 0) {
      _autoRefreshCountdown = 30;
      /* Rebuild DOM without restarting the 2s live-price ticker */
      render();
      _updateRefreshBadge();
    }
  }, 1000);
}

function _updateRefreshBadge() {
  const el = document.getElementById("wlRefreshBadge");
  if (!el) return;
  el.textContent = `↻ ${_autoRefreshCountdown}s`;
  el.classList.toggle("wl-refresh-soon", _autoRefreshCountdown <= 5);
}

/* ============================================================
   LIVE TRADES PANEL
   ─────────────────────────────────────────────────────────────
   Reads open holdings from the simulator profile (_simProfile),
   shows real-time P/L on professionally styled cards, and lets
   users click through to a full-screen candle chart with their
   actual buy/sell markers.
   ============================================================ */

let _ltActiveTab      = "saved";
let _ltTicker         = null;          /* 3-second refresh interval */
let _ltPairCache      = {};            /* mint → Birdeye pair object */
let _ltChartInst      = null;          /* CandleChart instance (chart popup) */
let _ltChartMint      = null;          /* mint currently open in chart popup */
let _ltChartTf        = "15m";         /* active TF in chart popup */
let _ltRenderedMints  = "";            /* comma list of displayed mints — triggers full rebuild when changed */
let _ltTradeMint      = null;          /* mint open in buy/sell modal */
let _ltTradeMode      = null;          /* "buy" | "sell" */
let _ltChartInterval  = null;          /* dedicated 10s price-refresh loop for the open chart */

/* ── Tab switching ── */
window._ltSwitchTab = function(tab) {
  _ltActiveTab = tab;
  const savedBody = document.getElementById("watchlistBody");
  const liveBody  = document.getElementById("liveTradesBody");
  if (savedBody) savedBody.style.display = tab === "saved" ? "block" : "none";
  if (liveBody)  liveBody.style.display  = tab === "live"  ? "block" : "none";
  document.getElementById("wlTabSaved")?.classList.toggle("wl-tab-active", tab === "saved");
  document.getElementById("wlTabLive")?.classList.toggle("wl-tab-active",  tab === "live");

  /* Hide saved-tokens controls when on Live Trades — they only apply to saved tokens */
  const isLive = tab === "live";
  ["wlClearAll", "wlRefreshBadge", "wlCountPill"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = isLive ? "none" : "";
  });

  if (tab === "live") { _ltStartRefresh(); }
  else                { _ltStopRefresh();  }
};

function _ltStartRefresh() {
  _ltStopRefresh();
  _ltRenderPanel();                            /* immediate first render */
  _ltTicker = setInterval(_ltRenderPanel, 3000);
}

function _ltStopRefresh() {
  if (_ltTicker) { clearInterval(_ltTicker); _ltTicker = null; }
}

/* ── Collect open holdings from sim profile ── */
function _ltGetOpenHoldings() {
  if (!_simProfile) return [];
  return Object.entries(_simProfile.holdings || {})
    .filter(([, h]) => h.amount > 0)
    .map(([mint, h]) => ({ mint, ...h }))
    .slice(0, 12);
}

/* ── Fetch prices for the Live Trades portfolio — Birdeye only ──────────────
   Uses _wlBirdeyeCache first (populated by liveRefreshTick every 30s, 120s TTL).
   Live-trade holdings are always watchlisted, so this is almost always instant.
   Falls back to fetchBirdeyeScore for any mint not yet in the cache.           */
async function _ltFetchPrices(mints) {
  if (!mints.length) return;

  const toFetch = [];
  for (const mint of mints) {
    const cached = _wlBirdeyeCache[mint];
    if (cached?.pair) {
      _ltPairCache[mint] = cached.pair;   /* instant cache hit */
    } else {
      toFetch.push(mint);                 /* not in watchlist cache yet */
    }
  }

  /* Fetch any stragglers sequentially — shouldn't happen in normal usage */
  for (const mint of toFetch) {
    const entry = await fetchBirdeyeScore(mint, 0);
    if (entry?.pair) _ltPairCache[mint] = entry.pair;
  }
}

/* ── Formatting helpers ── */
function _ltFmtPrice(p) {
  if (!p || !isFinite(p) || p <= 0) return "—";
  if (p < 0.000001) return "$" + p.toFixed(9);
  if (p < 0.0001)   return "$" + p.toFixed(7);
  if (p < 0.001)    return "$" + p.toFixed(6);
  if (p < 1)        return "$" + p.toFixed(4);
  return "$" + p.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function _ltFmtSol(v) {
  if (!isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "−";
  const abs  = Math.abs(v);
  if (abs >= 100) return sign + abs.toFixed(1) + " ◎";
  if (abs >= 10)  return sign + abs.toFixed(2) + " ◎";
  return sign + abs.toFixed(4) + " ◎";
}

function _ltFmtVol(v) {
  if (!v || !isFinite(v) || v <= 0) return "—";
  if (v >= 1_000_000) return "$" + (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1_000)     return "$" + (v / 1_000).toFixed(1) + "K";
  return "$" + v.toFixed(0);
}

/* ── Compute P/L for each holding ── */
function _ltComputeTrades(holdings) {
  return holdings.map(h => {
    const pair  = _ltPairCache[h.mint];
    const curPx = parseFloat(pair?.priceUsd || "0");
    const cost  = h.totalCostSol || 0;
    const avgPx = h.avgPrice     || 0;
    let pnlSol = 0, pnlPct = 0, curVal = cost;
    if (curPx > 0 && avgPx > 0 && cost > 0) {
      curVal = cost * (curPx / avgPx);
      pnlSol = curVal - cost;
      pnlPct = (pnlSol / cost) * 100;
    }
    return { ...h, pair, curPx, cost, curVal, pnlSol, pnlPct };
  });
}

/* ── Build full panel HTML (called when structure changes) ── */
function _ltBuildPanel(trades) {
  const body = document.getElementById("liveTradesBody");
  if (!body) return;

  let totalCost = 0, totalVal = 0, totalPnl = 0, wins = 0, losses = 0;
  trades.forEach(t => {
    totalCost += t.cost;
    totalVal  += t.curVal;
    totalPnl  += t.pnlSol;
    if (t.pnlSol > 0.0001) wins++;
    else if (t.pnlSol < -0.0001) losses++;
  });

  const pCls  = totalPnl >= 0 ? "lt-pos" : "lt-neg";
  const pSign = totalPnl >= 0 ? "+" : "−";

  const summary = `
    <div class="lt-summary">
      <div class="lt-summary-stat">
        <div class="lt-summary-label">Total P/L</div>
        <div class="lt-summary-val ${pCls}" id="ltSumPnl">${pSign}${Math.abs(totalPnl).toFixed(4)} ◎</div>
      </div>
      <div class="lt-summary-stat">
        <div class="lt-summary-label">Invested</div>
        <div class="lt-summary-val" id="ltSumCost">${totalCost.toFixed(3)} ◎</div>
      </div>
      <div class="lt-summary-stat">
        <div class="lt-summary-label">Value Now</div>
        <div class="lt-summary-val ${pCls}" id="ltSumVal">${totalVal.toFixed(4)} ◎</div>
      </div>
      <div class="lt-summary-stat">
        <div class="lt-summary-label">Positions</div>
        <div class="lt-summary-val" id="ltSumWL">
          <span class="lt-win-cnt">${wins}W</span>&nbsp;<span class="lt-sep">/</span>&nbsp;<span class="lt-loss-cnt">${losses}L</span>
        </div>
      </div>
    </div>`;

  const grid = `<div class="lt-grid">${trades.map(_ltCardHTML).join("")}</div>`;

  body.innerHTML = `
    <div class="lt-panel-hdr">
      <span class="lt-live-dot"></span>
      <span class="lt-panel-label">LIVE POSITIONS</span>
      <span class="lt-positions-badge">${trades.length} / 12</span>
    </div>
    ${summary}
    ${grid}`;
}

/* ── Generate HTML for one trade card ── */
function _ltCardHTML(t) {
  const state  = t.pnlSol > 0.0001 ? "lt-win" : t.pnlSol < -0.0001 ? "lt-loss" : "lt-neutral";
  const pCls   = t.pnlSol >= 0 ? "lt-pos" : "lt-neg";
  const sign   = t.pnlSol >= 0 ? "+" : "−";
  const logoUrl = t.logo
    ? `/.netlify/functions/logoProxy?url=${encodeURIComponent(t.logo)}`
    : "https://placehold.co/36x36";

  const pair   = t.pair;
  const chg1h  = parseFloat(pair?.priceChange?.h1 || "0");
  const chgCls = chg1h >= 0 ? "pos" : "neg";
  const chgSign= chg1h >= 0 ? "+" : "";

  /* Estimate buy/sell volume from txn ratio */
  const txns1h = pair?.txns?.h1 || {};
  const buys   = txns1h.buys  || 0;
  const sells  = txns1h.sells || 0;
  const vol1h  = parseFloat(pair?.volume?.h1 || "0");
  const tot    = buys + sells || 1;
  const buyVol = vol1h * (buys  / tot);
  const selVol = vol1h * (sells / tot);

  return `
    <div class="lt-card ${state}" id="ltcard-${t.mint}" onclick="window._ltOpenChart('${t.mint}')">
      <div class="lt-header">
        <img class="lt-logo" src="${logoUrl}"
             onerror="this.src='https://placehold.co/36x36'" referrerpolicy="no-referrer"/>
        <div class="lt-info">
          <div class="lt-name">${t.name || "Unknown"}</div>
          <div class="lt-sym">${t.symbol || ""}</div>
        </div>
        <div class="lt-price-block">
          <div class="lt-price" id="ltp-${t.mint}">${_ltFmtPrice(t.curPx)}</div>
          <div class="lt-chg ${chgCls}" id="ltchg-${t.mint}">${chgSign}${chg1h.toFixed(1)}%</div>
        </div>
      </div>
      <div class="lt-pnl-row">
        <div class="lt-pnl-label">P/L</div>
        <div class="lt-pnl-sol ${pCls}" id="ltpnl-${t.mint}">${sign}${Math.abs(t.pnlSol).toFixed(4)} ◎</div>
        <div class="lt-pnl-pct ${pCls}" id="ltpct-${t.mint}">${sign}${Math.abs(t.pnlPct).toFixed(1)}%</div>
      </div>
      <div class="lt-stats-row">
        <div class="lt-stat">
          <div class="lt-stat-label">Cost</div>
          <div class="lt-stat-val">${t.cost.toFixed(3)} ◎</div>
        </div>
        <div class="lt-stat">
          <div class="lt-stat-label">1h Buy</div>
          <div class="lt-stat-val lt-buy-vol">${_ltFmtVol(buyVol)}</div>
        </div>
        <div class="lt-stat">
          <div class="lt-stat-label">1h Sell</div>
          <div class="lt-stat-val lt-sell-vol">${_ltFmtVol(selVol)}</div>
        </div>
      </div>
      <div class="lt-action-row">
        <button class="lt-action-btn lt-btn-buy"  onclick="window._ltOpenTradeModal('${t.mint}','buy',event)"  title="Simulate Buy">🟢 BUY</button>
        <button class="lt-action-btn lt-btn-sell" onclick="window._ltOpenTradeModal('${t.mint}','sell',event)" title="Simulate Sell">🔴 SELL</button>
        <button class="lt-action-btn lt-btn-jup"  onclick="window._ltOpenJupiter('${t.mint}',event)"           title="Swap on Jupiter">⚡ JUP</button>
      </div>
      <div class="lt-click-hint">📈 tap card to open chart</div>
    </div>`;
}

/* ── In-place refresh (avoids full re-render flicker every 3s) ── */
function _ltUpdateInPlace(trades) {
  let totalCost = 0, totalVal = 0, totalPnl = 0, wins = 0, losses = 0;

  for (const t of trades) {
    totalCost += t.cost;
    totalVal  += t.curVal;
    totalPnl  += t.pnlSol;
    if (t.pnlSol > 0.0001) wins++;
    else if (t.pnlSol < -0.0001) losses++;

    /* Update card state class */
    const card = document.getElementById(`ltcard-${t.mint}`);
    if (card) {
      card.className = `lt-card ${t.pnlSol > 0.0001 ? "lt-win" : t.pnlSol < -0.0001 ? "lt-loss" : "lt-neutral"}`;
    }

    const pCls = t.pnlSol >= 0 ? "lt-pos" : "lt-neg";
    const sign = t.pnlSol >= 0 ? "+" : "−";

    const pEl = document.getElementById(`ltp-${t.mint}`);
    if (pEl) pEl.textContent = _ltFmtPrice(t.curPx);

    const chg1h = parseFloat(t.pair?.priceChange?.h1 || "0");
    const chgEl = document.getElementById(`ltchg-${t.mint}`);
    if (chgEl) {
      chgEl.textContent = (chg1h >= 0 ? "+" : "") + chg1h.toFixed(1) + "%";
      chgEl.className   = `lt-chg ${chg1h >= 0 ? "pos" : "neg"}`;
    }

    const pnlEl = document.getElementById(`ltpnl-${t.mint}`);
    if (pnlEl) { pnlEl.textContent = sign + Math.abs(t.pnlSol).toFixed(4) + " ◎"; pnlEl.className = `lt-pnl-sol ${pCls}`; }

    const pctEl = document.getElementById(`ltpct-${t.mint}`);
    if (pctEl) { pctEl.textContent = sign + Math.abs(t.pnlPct).toFixed(1) + "%"; pctEl.className = `lt-pnl-pct ${pCls}`; }

    /* Also update live price in open chart if same mint */
    if (_ltChartMint === t.mint) {
      const cpEl = document.getElementById("ltChartPriceEl");
      if (cpEl) cpEl.textContent = _ltFmtPrice(t.curPx);
      _ltUpdateChartPnlBadge(t);
      /* Push new price into the live candle so the chart actually moves */
      if (_ltChartInst && t.curPx > 0) _ltChartInst.tick(t.curPx, 0);
    }
  }

  /* Summary bar */
  const pCls  = totalPnl >= 0 ? "lt-pos" : "lt-neg";
  const pSign = totalPnl >= 0 ? "+" : "−";
  const sumPnl  = document.getElementById("ltSumPnl");
  const sumCost = document.getElementById("ltSumCost");
  const sumVal  = document.getElementById("ltSumVal");
  const sumWL   = document.getElementById("ltSumWL");

  if (sumPnl)  { sumPnl.textContent = pSign + Math.abs(totalPnl).toFixed(4) + " ◎"; sumPnl.className = `lt-summary-val ${pCls}`; }
  if (sumCost) sumCost.textContent  = totalCost.toFixed(3) + " ◎";
  if (sumVal)  { sumVal.textContent = totalVal.toFixed(4) + " ◎";  sumVal.className = `lt-summary-val ${pCls}`; }
  if (sumWL)   sumWL.innerHTML      = `<span class="lt-win-cnt">${wins}W</span>&nbsp;<span class="lt-sep">/</span>&nbsp;<span class="lt-loss-cnt">${losses}L</span>`;
}

function _ltUpdateChartPnlBadge(t) {
  const badge = document.getElementById("ltChartPnlBadge");
  if (!badge) return;
  const sign  = t.pnlSol >= 0 ? "+" : "−";
  const pCls  = t.pnlSol >= 0 ? "lt-pos" : "lt-neg";
  badge.textContent = `${sign}${Math.abs(t.pnlSol).toFixed(4)} ◎  (${sign}${Math.abs(t.pnlPct).toFixed(1)}%)`;
  badge.className   = `lt-chart-pnl-badge ${pCls}`;
}

/* ── Main render / refresh orchestrator ── */
async function _ltRenderPanel() {
  if (_ltActiveTab !== "live") return;
  const body = document.getElementById("liveTradesBody");
  if (!body) return;

  /* Ensure sim profile is loaded */
  if (!_simProfile) {
    await fetchSimProfile();
    if (!_simProfile) {
      body.innerHTML = `
        <div class="lt-empty">
          <div class="lt-empty-icon">🚀</div>
          <div class="lt-empty-msg">Connect your simulator wallet</div>
          <div class="lt-empty-sub">Open trades appear here when you buy tokens in the APE SIMULATOR</div>
        </div>`;
      return;
    }
  }

  const holdings = _ltGetOpenHoldings();

  if (!holdings.length) {
    body.innerHTML = `
      <div class="lt-empty">
        <div class="lt-empty-icon">📭</div>
        <div class="lt-empty-msg">No open trades</div>
        <div class="lt-empty-sub">Buy tokens in APE SIMULATOR to track your live P/L here</div>
      </div>`;
    _ltRenderedMints = "";
    return;
  }

  /* Fetch fresh prices from DexScreener */
  await _ltFetchPrices(holdings.map(h => h.mint));

  /* Compute per-trade P/L */
  const trades = _ltComputeTrades(holdings);

  /* Full re-render only when holdings change; otherwise update in-place */
  const mintKey = holdings.map(h => h.mint).join(",");
  if (_ltRenderedMints !== mintKey) {
    _ltRenderedMints = mintKey;
    _ltBuildPanel(trades);
  } else {
    _ltUpdateInPlace(trades);
  }
}

/* ════════════════════════════════════════════════════
   LIVE TRADES — Full-screen candle chart popup
   ════════════════════════════════════════════════════ */

window._ltOpenChart = async function(mint) {
  _ltChartMint = mint;
  _ltChartTf   = "15m";   /* always reset to 15m on fresh open */

  /* Reset TF button active state */
  document.querySelectorAll(".lt-chart-tf-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tf === "15m");
  });

  const overlay = document.getElementById("ltChartOverlay");
  if (!overlay) return;

  const holding = _simProfile?.holdings?.[mint];
  const pair    = _ltPairCache[mint];
  const name    = holding?.name   || pair?.baseToken?.name   || "Unknown";
  const symbol  = holding?.symbol || pair?.baseToken?.symbol || "";
  const logo    = holding?.logo   || "";
  const logoUrl = logo
    ? `/.netlify/functions/logoProxy?url=${encodeURIComponent(logo)}`
    : "https://placehold.co/40x40";
  const curPx   = parseFloat(pair?.priceUsd || "0");

  /* Populate header */
  const el = id => document.getElementById(id);
  if (el("ltChartLogoEl"))  el("ltChartLogoEl").src = logoUrl;
  if (el("ltChartNameEl"))  el("ltChartNameEl").textContent  = name;
  if (el("ltChartSymEl"))   el("ltChartSymEl").textContent   = symbol;
  if (el("ltChartPriceEl")) el("ltChartPriceEl").textContent = _ltFmtPrice(curPx);

  /* Show P/L badge */
  if (holding && curPx > 0 && holding.avgPrice > 0 && holding.totalCostSol > 0) {
    const cost   = holding.totalCostSol;
    const curVal = cost * (curPx / holding.avgPrice);
    _ltUpdateChartPnlBadge({ pnlSol: curVal - cost, pnlPct: ((curVal - cost) / cost) * 100 });
  } else {
    const badge = el("ltChartPnlBadge");
    if (badge) { badge.textContent = ""; badge.className = "lt-chart-pnl-badge"; }
  }

  overlay.style.display = "flex";
  document.body.style.overflow = "hidden";

  /* Tear down previous chart instance */
  if (_ltChartInst) { try { _ltChartInst.destroy(); } catch {} _ltChartInst = null; }

  /* Dynamically load CandleChart if not yet available */
  if (!window.CandleChart) {
    try {
      const mod = await import("./candleChart.js");
      window.CandleChart = mod.CandleChart;
    } catch (e) {
      console.warn("[LiveTrades] candleChart.js failed to load:", e);
      const cont = el("ltChartContainer");
      if (cont) cont.innerHTML = `<div style="padding:60px;text-align:center;color:rgba(44,255,201,0.4);font-size:14px">Chart engine unavailable</div>`;
      return;
    }
  }

  /* Build chart */
  _ltChartInst = new window.CandleChart("ltChartContainer");
  _ltChartInst.startLoading();
  _ltChartInst.setToken(name, symbol);
  if (pair) _ltChartInst.seedFromPair(pair);

  /* Inject all buy/sell trade markers for this mint */
  if (_simProfile?.trades?.length) {
    _ltChartInst.setTradeMarkers(_simProfile.trades, mint);
  }

  /* Fetch OHLCV — Birdeye only (ohlcvData: Redis L1 → Neon L2 → Birdeye) */
  try {
    const r = await fetch(`/.netlify/functions/ohlcvData?mint=${encodeURIComponent(mint)}&tf=${_ltChartTf}`);
    if (r.ok) {
      const d = await r.json();
      const bars = (d.bars || []).filter(b => b.time > 0 && b.close > 0);
      if (bars.length >= 2) {
        _ltChartInst.loadCandles(bars.map(b => [b.time, b.open, b.high, b.low, b.close, b.volume || 0]));
      }
    }
  } catch {}

  /* Start dedicated 10s price ticker so the live candle actually moves.
     This bypasses the 120s _wlBirdeyeCache so every 10s the chart gets a
     real fresh price from scanToken (Redis 90s → Neon → Birdeye).          */
  _ltStartChartTicker();
};

/* ── Chart TF switcher ── */
window._ltSwitchChartTf = async function(tf) {
  _ltChartTf = tf;
  document.querySelectorAll(".lt-chart-tf-btn").forEach(btn =>
    btn.classList.toggle("active", btn.dataset.tf === tf)
  );
  if (!_ltChartInst || !_ltChartMint) return;

  /* Pause ticker while loading new TF — restarts below */
  _ltStopChartTicker();

  const pair     = _ltPairCache[_ltChartMint];
  const pairAddr = pair?.pairAddress;
  _ltChartInst.setTimeframe(tf);
  /* Don't call startLoading() here — it leaves the legend stuck at "Loading…"
     if the fetch fails. Old candles remain visible during the short fetch. */

  let gotRealData = false;

  /* Birdeye only — ohlcvData (Redis L1 → Neon L2 → Birdeye) */
  if (_ltChartMint) {
    try {
      const r = await fetch(`/.netlify/functions/ohlcvData?mint=${encodeURIComponent(_ltChartMint)}&tf=${tf}`);
      if (r.ok) {
        const d = await r.json();
        const bars = (d.bars || []).filter(b => b.time > 0 && b.close > 0);
        if (bars.length >= 2) {
          _ltChartInst.loadCandles(bars.map(b => [b.time, b.open, b.high, b.low, b.close, b.volume || 0]));
          gotRealData = true;
        }
      }
    } catch {}
  }

  if (!gotRealData && pair) {
    /* Seed with synthetic price data.
       Key: set isLoading=false BEFORE seedFromPair so the overlay is already
       gone, then call tick() to re-render the legend with the real price
       (tick() guards against isLoading=true, so order matters).            */
    _ltChartInst.isLoading = false;
    _ltChartInst.seedFromPair(pair);
    const px = parseFloat(pair.priceUsd || "0");
    if (px > 0) _ltChartInst.tick(px, 0);
  }

  if (_simProfile?.trades?.length) _ltChartInst.setTradeMarkers(_simProfile.trades, _ltChartMint);

  /* Restart dedicated price ticker for the new TF */
  _ltStartChartTicker();
};

/* ── Chart screenshot → downloads PNG with token info header ── */
window._ltChartScreenshot = function() {
  if (!_ltChartInst?._chart) { alert("No chart loaded yet"); return; }

  const chartCanvas = _ltChartInst._chart.takeScreenshot();
  const headerH = 64;

  const final = document.createElement("canvas");
  final.width  = chartCanvas.width;
  final.height = chartCanvas.height + headerH;

  const ctx = final.getContext("2d");

  /* Dark header background */
  ctx.fillStyle = "#040d0b";
  ctx.fillRect(0, 0, final.width, headerH);

  /* Divider line */
  ctx.strokeStyle = "rgba(44,255,201,0.2)";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, headerH); ctx.lineTo(final.width, headerH); ctx.stroke();

  /* Token name + symbol */
  const pair    = _ltPairCache[_ltChartMint];
  const holding = _simProfile?.holdings?.[_ltChartMint];
  const name    = holding?.name   || pair?.baseToken?.name   || "Unknown";
  const symbol  = holding?.symbol || pair?.baseToken?.symbol || "";
  const price   = pair ? _ltFmtPrice(parseFloat(pair.priceUsd || "0")) : "—";

  ctx.font = "bold 16px 'Segoe UI', system-ui, sans-serif";
  ctx.fillStyle = "rgba(232,245,240,0.95)";
  ctx.fillText(`${name}  ${symbol ? "· " + symbol : ""}`, 16, 26);

  ctx.font = "13px 'Segoe UI', system-ui, sans-serif";
  ctx.fillStyle = "rgba(44,255,201,0.9)";
  ctx.fillText(`$${price}  ·  ${_ltChartTf}`, 16, 50);

  /* Branding (right-aligned) */
  ctx.font = "11px 'Segoe UI', system-ui, sans-serif";
  ctx.fillStyle = "rgba(207,255,244,0.28)";
  ctx.textAlign = "right";
  ctx.fillText("scan2moon.com", final.width - 16, 40);
  ctx.textAlign = "left";

  /* Chart below */
  ctx.drawImage(chartCanvas, 0, headerH);

  const link = document.createElement("a");
  link.download = `scan2moon-${symbol || name.slice(0,12)}-${_ltChartTf}-${new Date().toISOString().slice(0,10)}.png`;
  link.href = final.toDataURL("image/png");
  link.click();
};

/* ── Jupiter referral open ── */
window._ltOpenJupiter = function(mint, event) {
  event.stopPropagation();
  window.open(`https://jup.ag/swap/SOL-${mint}?ref=49h527zlp56g`, "_blank", "noopener,noreferrer");
};

/* ── Background click to close trade modal ── */
window._ltBgCloseTrade = function(event) {
  if (event.target === document.getElementById("ltTradeModal")) {
    document.getElementById("ltTradeModal").style.display = "none";
  }
};

/* ── Open buy/sell trade modal ── */
window._ltOpenTradeModal = function(mint, mode, event) {
  event.stopPropagation();
  _ltTradeMint = mint;
  _ltTradeMode = mode;

  const pair     = _ltPairCache[mint];
  const holding  = _simProfile?.holdings?.[mint];
  if (!pair) return;

  const name    = holding?.name   || pair.baseToken?.name   || "Unknown";
  const symbol  = holding?.symbol || pair.baseToken?.symbol || "";
  const logo    = holding?.logo   || "";
  const logoUrl = logo ? `/.netlify/functions/logoProxy?url=${encodeURIComponent(logo)}` : "https://placehold.co/40x40";
  const price   = parseFloat(pair.priceUsd || "0");

  /* Header */
  document.getElementById("ltTradeLogo").src        = logoUrl;
  document.getElementById("ltTradeName").textContent = name;
  document.getElementById("ltTradeSym").textContent  = symbol;
  document.getElementById("ltTradePx").textContent   = "$" + _ltFmtPrice(price);
  const modeEl = document.getElementById("ltTradeMode");
  modeEl.textContent = mode === "buy" ? "🟢 BUY" : "🔴 SELL";
  modeEl.className   = "lt-trade-panel-mode " + (mode === "buy" ? "lt-mode-buy" : "lt-mode-sell");

  /* Position strip */
  const posEl = document.getElementById("ltTradePosition");
  if (holding && holding.amount > 0 && holding.totalCostSol > 0) {
    const curVal = holding.totalCostSol * (price / (holding.avgCostSol || holding.avgPrice || price));
    const pnlSol = curVal - holding.totalCostSol;
    const pnlPct = (pnlSol / holding.totalCostSol) * 100;
    const pc     = pnlSol >= 0 ? "lt-pos" : "lt-neg";
    const sg     = pnlSol >= 0 ? "+" : "−";
    const fmtAmt = (n) => n >= 1e6 ? (n/1e6).toFixed(2)+"M" : n >= 1000 ? (n/1000).toFixed(1)+"K" : n.toFixed(2);
    posEl.innerHTML = `
      <div class="lt-pos-row">
        <div class="lt-pos-stat"><div class="lt-pos-label">Holdings</div><div class="lt-pos-val">${fmtAmt(holding.amount)}</div></div>
        <div class="lt-pos-stat"><div class="lt-pos-label">Cost</div><div class="lt-pos-val">${holding.totalCostSol.toFixed(4)} ◎</div></div>
        <div class="lt-pos-stat"><div class="lt-pos-label">P/L</div><div class="lt-pos-val ${pc}">${sg}${Math.abs(pnlSol).toFixed(4)} ◎</div></div>
        <div class="lt-pos-stat"><div class="lt-pos-label">Change</div><div class="lt-pos-val ${pc}">${sg}${Math.abs(pnlPct).toFixed(1)}%</div></div>
      </div>`;
  } else {
    posEl.innerHTML = "";
  }

  /* Form */
  const msgEl  = document.getElementById("ltTradeMsg");
  if (msgEl) { msgEl.style.display = "none"; msgEl.textContent = ""; }

  _ltBuildTradeForm(mode, mint, symbol, holding, price);

  document.getElementById("ltTradeModal").style.display = "flex";
};

function _ltBuildTradeForm(mode, mint, symbol, holding, price) {
  const formEl = document.getElementById("ltTradeForm");
  if (!formEl) return;

  if (mode === "buy") {
    const bal = _simProfile?.balance ?? 0;
    formEl.innerHTML = `
      <div class="lt-trade-form-inner">
        <div class="lt-trade-bal-row">
          <span class="lt-trade-bal-label">Sim Balance</span>
          <span class="lt-trade-bal-val">${bal.toFixed(4)} ◎</span>
        </div>
        <div class="lt-trade-quick-row">
          <button onclick="window._ltSetQuickBuy(10)">10%</button>
          <button onclick="window._ltSetQuickBuy(25)">25%</button>
          <button onclick="window._ltSetQuickBuy(50)">50%</button>
          <button onclick="window._ltSetQuickBuy(100)">MAX</button>
        </div>
        <div class="lt-trade-input-wrap">
          <input type="number" id="ltTradeAmountInput" class="lt-trade-input"
                 placeholder="SOL amount" min="0" step="0.01" oninput="window._ltUpdateBuyPreview()"/>
          <span class="lt-trade-input-unit">◎</span>
        </div>
        <div class="lt-trade-preview" id="ltTradePreview">Enter SOL amount to see token estimate</div>
        <button class="lt-trade-exec-btn lt-exec-buy" onclick="window._ltExecuteTrade()">🟢 BUY ${symbol || "Token"}</button>
      </div>`;
  } else {
    const maxAmt = holding?.amount || 0;
    const fmtAmt = (n) => n >= 1e6 ? (n/1e6).toFixed(2)+"M" : n >= 1000 ? (n/1000).toFixed(1)+"K" : n.toFixed(6);
    formEl.innerHTML = `
      <div class="lt-trade-form-inner">
        <div class="lt-trade-bal-row">
          <span class="lt-trade-bal-label">Tokens Held</span>
          <span class="lt-trade-bal-val">${fmtAmt(maxAmt)}</span>
        </div>
        <div class="lt-trade-quick-row">
          <button onclick="window._ltSetQuickSell(25)">25%</button>
          <button onclick="window._ltSetQuickSell(50)">50%</button>
          <button onclick="window._ltSetQuickSell(75)">75%</button>
          <button onclick="window._ltSetQuickSell(100)">MAX</button>
        </div>
        <div class="lt-trade-input-wrap">
          <input type="number" id="ltTradeAmountInput" class="lt-trade-input"
                 placeholder="Token amount" min="0" step="any" oninput="window._ltUpdateSellPreview()"/>
          <span class="lt-trade-input-unit">${symbol || "tokens"}</span>
        </div>
        <div class="lt-trade-preview" id="ltTradePreview">Enter token amount to see SOL estimate</div>
        <button class="lt-trade-exec-btn lt-exec-sell" onclick="window._ltExecuteTrade()">🔴 SELL ${symbol || "Token"}</button>
      </div>`;
  }
}

window._ltSetQuickBuy = function(pct) {
  const bal   = _simProfile?.balance || 0;
  const input = document.getElementById("ltTradeAmountInput");
  if (input) { input.value = (bal * pct / 100).toFixed(4); window._ltUpdateBuyPreview(); }
};

window._ltSetQuickSell = function(pct) {
  const holding = _simProfile?.holdings?.[_ltTradeMint];
  if (!holding) return;
  const input = document.getElementById("ltTradeAmountInput");
  if (input) {
    input.value = pct >= 100 ? holding.amount.toString() : (holding.amount * pct / 100).toFixed(6);
    window._ltUpdateSellPreview();
  }
};

window._ltUpdateBuyPreview = function() {
  const input = document.getElementById("ltTradeAmountInput");
  const prev  = document.getElementById("ltTradePreview");
  if (!input || !prev) return;
  const sol      = parseFloat(input.value) || 0;
  const pair     = _ltPairCache[_ltTradeMint];
  const priceUsd = parseFloat(pair?.priceUsd || "0");
  const solUsd   = _solUsd || 150;
  if (!sol || !priceUsd || !solUsd) { prev.textContent = "Enter SOL amount to see token estimate"; return; }
  const tokens = (sol * solUsd) / priceUsd;
  const sym    = pair?.baseToken?.symbol || "tokens";
  const fmtT   = tokens >= 1e6 ? (tokens/1e6).toFixed(2)+"M" : tokens >= 1000 ? (tokens/1000).toFixed(1)+"K" : tokens.toFixed(2);
  prev.textContent = `≈ ${fmtT} ${sym}`;
};

window._ltUpdateSellPreview = function() {
  const input = document.getElementById("ltTradeAmountInput");
  const prev  = document.getElementById("ltTradePreview");
  if (!input || !prev) return;
  const tokens   = parseFloat(input.value) || 0;
  const pair     = _ltPairCache[_ltTradeMint];
  const priceUsd = parseFloat(pair?.priceUsd || "0");
  const solUsd   = _solUsd || 150;
  if (!tokens || !priceUsd || !solUsd) { prev.textContent = "Enter token amount to see SOL estimate"; return; }
  const solRec = (tokens * priceUsd) / solUsd;
  prev.textContent = `≈ ${solRec.toFixed(4)} ◎ SOL`;
};

window._ltExecuteTrade = async function() {
  const wallet = localStorage.getItem("sa_wallet");
  const msgEl  = document.getElementById("ltTradeMsg");
  if (!wallet) {
    if (msgEl) { msgEl.textContent = "⚠️ No simulator wallet — open APE SIMULATOR first"; msgEl.style.display = "block"; msgEl.className = "lt-trade-msg lt-msg-warn"; }
    return;
  }

  const input    = document.getElementById("ltTradeAmountInput");
  const amount   = parseFloat(input?.value || "0");
  if (!amount || amount <= 0) {
    if (msgEl) { msgEl.textContent = "⚠️ Enter a valid amount"; msgEl.style.display = "block"; msgEl.className = "lt-trade-msg lt-msg-warn"; }
    return;
  }

  const pair     = _ltPairCache[_ltTradeMint];
  const holding  = _simProfile?.holdings?.[_ltTradeMint];
  const priceUsd = parseFloat(pair?.priceUsd || "0");
  if (!priceUsd) {
    if (msgEl) { msgEl.textContent = "⚠️ Price unavailable — try again"; msgEl.style.display = "block"; msgEl.className = "lt-trade-msg lt-msg-warn"; }
    return;
  }

  const execBtn = document.querySelector(".lt-trade-exec-btn");
  if (execBtn) { execBtn.disabled = true; execBtn.textContent = "Executing…"; }
  if (msgEl)   { msgEl.style.display = "none"; }

  const solUsd = _solUsd || 150;
  let body;

  if (_ltTradeMode === "buy") {
    const tokenAmt = (amount * solUsd) / priceUsd;
    body = {
      action: "buy", wallet,
      mint: _ltTradeMint,
      symbol: holding?.symbol || pair?.baseToken?.symbol || "",
      name:   holding?.name   || pair?.baseToken?.name   || "",
      logo:   holding?.logo   || "",
      priceUsd: priceUsd.toString(),
      amount:   tokenAmt.toString(),
      solAmount: amount,
      solPrice:  solUsd,
      slippage:  1,
    };
  } else {
    body = {
      action: "sell", wallet,
      mint: _ltTradeMint,
      priceUsd: priceUsd.toString(),
      amount:   amount.toString(),
      solPrice:  solUsd,
      slippage:  1,
    };
  }

  try {
    const r = await fetch(SIM_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json();

    if (!r.ok || d.error) {
      if (msgEl) { msgEl.textContent = "❌ " + (d.error || "Trade failed"); msgEl.style.display = "block"; msgEl.className = "lt-trade-msg lt-msg-error"; }
      if (execBtn) { execBtn.disabled = false; execBtn.textContent = _ltTradeMode === "buy" ? "🟢 BUY" : "🔴 SELL"; }
      return;
    }

    if (d.profile) _simProfile = d.profile;
    if (msgEl) { msgEl.textContent = _ltTradeMode === "buy" ? "✅ Bought successfully!" : "✅ Sold successfully!"; msgEl.style.display = "block"; msgEl.className = "lt-trade-msg lt-msg-success"; }

    setTimeout(() => {
      document.getElementById("ltTradeModal").style.display = "none";
      _ltTradeMint = null; _ltTradeMode = null;
      _ltRenderPanel();
    }, 1300);

  } catch {
    if (msgEl) { msgEl.textContent = "❌ Network error — try again"; msgEl.style.display = "block"; msgEl.className = "lt-trade-msg lt-msg-error"; }
    if (execBtn) { execBtn.disabled = false; execBtn.textContent = _ltTradeMode === "buy" ? "🟢 BUY" : "🔴 SELL"; }
  }
};

/* ── Dedicated chart price ticker ───────────────────────────────────────────
   Calls scanToken every 10s (bypasses _wlBirdeyeCache) so the live candle
   actually moves rather than showing the same price for 120s.                */
async function _ltChartTick() {
  if (!_ltChartInst || !_ltChartMint) return;
  try {
    const r = await fetch(`/.netlify/functions/scanToken?mint=${encodeURIComponent(_ltChartMint)}`);
    if (!r.ok) return;
    const d = await r.json();
    const pair  = d?.pair;
    if (!pair) return;
    const price = parseFloat(pair.priceUsd || "0");
    if (price <= 0) return;

    /* Freshen the caches so _ltUpdateInPlace also picks up the new price */
    _ltPairCache[_ltChartMint] = pair;
    if (_wlBirdeyeCache[_ltChartMint]) {
      _wlBirdeyeCache[_ltChartMint].pair = pair;
      _wlBirdeyeCache[_ltChartMint].ts   = Date.now();
    }

    /* Update header price */
    const cpEl = document.getElementById("ltChartPriceEl");
    if (cpEl) cpEl.textContent = _ltFmtPrice(price);

    /* Update P/L badge */
    const holding = _simProfile?.holdings?.[_ltChartMint];
    if (holding && price > 0 && holding.avgPrice > 0 && holding.totalCostSol > 0) {
      const cost   = holding.totalCostSol;
      const curVal = cost * (price / holding.avgPrice);
      _ltUpdateChartPnlBadge({ pnlSol: curVal - cost, pnlPct: ((curVal - cost) / cost) * 100 });
    }

    /* Drive the live candle */
    _ltChartInst.tick(price, 0);
  } catch (e) {
    console.warn("[ltChartTick]", e.message);
  }
}

function _ltStartChartTicker() {
  _ltStopChartTicker();
  /* Fire immediately, then every 10s */
  _ltChartTick();
  _ltChartInterval = setInterval(_ltChartTick, 10_000);
}

function _ltStopChartTicker() {
  if (_ltChartInterval) { clearInterval(_ltChartInterval); _ltChartInterval = null; }
}

window._ltCloseChart = function() {
  const overlay = document.getElementById("ltChartOverlay");
  if (overlay) overlay.style.display = "none";
  document.body.style.overflow = "";
  _ltStopChartTicker();
  if (_ltChartInst) { try { _ltChartInst.destroy(); } catch {} _ltChartInst = null; }
  _ltChartMint = null;
};

document.addEventListener("DOMContentLoaded", () => {
  renderNav();
  applyTranslations();
  render();
  startLiveRefresh(); /* Birdeye refresh every 30s — scores + prices + P/L */
  _startAutoRefresh(); /* full DOM rebuild every 30s */

  document.getElementById("wlClearAll")?.addEventListener("click", () => {
    if (confirm("Remove all tokens from your watchlist?")) {
      localStorage.removeItem(WL_KEY);
      render();
    }
  });
});

/* i18n handles data-i18n elements automatically on langchange — no manual call needed */
window.addEventListener("langchange", () => { /* i18n system handles this */ });
