// home.js – Scan2Moon V2.2 (multi-page aware)
import { renderNav }   from "./nav.js";
import "./community.js";
import { CandleChart } from "./candleChart.js";
import { birdeyeWs }   from "./birdeye-ws.js";
import "./bubbleMap.js";
import { esc }         from "./utils.js";

/* ══════════════════════════════════════════════
   PAGE DETECTION
══════════════════════════════════════════════ */
const _curPage = window.location.pathname.split("/").pop().replace(/\?.*$/, "") || "index.html";

/* ══════════════════════════════════════════════
   CONSTANTS
══════════════════════════════════════════════ */
const SM_API         = "/.netlify/functions/smartMoney";
const GAINERS_API    = "/.netlify/functions/topGainers";
const NEW_PAIRS_API  = "/.netlify/functions/newPairs";
const SOL_PRICE_API  = "/.netlify/functions/solPrice";
const PRICE_API      = "/.netlify/functions/priceOnly";
const BATCH_RISK_API = "/.netlify/functions/batchRisk";
const JUP_REF       = "49h527zlp56g";
const PER_PAGE      = 10;
const AUTO_REFRESH  = 90_000;
const NP_AUTO_REFRESH = 45_000;

/* ══════════════════════════════════════════════
   STATE
══════════════════════════════════════════════ */
let _tf          = "1h";
let _allTokens   = [];
let _page        = 1;
let _refreshTimer = null;
let _refreshProgress = null;
let _lastUpdated  = 0;

/* ── New Pairs state ── */
let _mode           = "gainers";
let _npWindow       = "newest";
let _npMinLiq       = 5000;
let _npVolFilter    = "all";
let _npMcapFilter   = "all";
let _npHolderFilter = "all";
let _npShowHighRisk = true;
let _npRawTokens    = [];
let _npTokens       = [];
let _npRefreshTimer = null;
let _npCurrentPage  = 0;
let _npSortBy       = "newest";   // "newest" | "liq" | "vol" | "hotness"

/* ── New Pairs column sort state ── */
let _npSortCol = null;  // null = use _npSortBy; otherwise a column key

/* ── Live risk score cache — survives table re-renders and API refreshes ── */
const _riskCache = new Map(); // mint → { score, level }
let _npSortDir = "desc";

/* ── Gainers filter state ── */
let _tgMinGainPct   = 0;          // 0 | 20 | 50 | 100
let _tgShowHighRisk = true;       // true = show all, false = hide HIGH risk

/* ── Gainers column sort state ── */
let _tgSortCol = "change";        // active sort column key
let _tgSortDir = "desc";          // "desc" | "asc"

/* ── Live ticker state ── */
let _liveTickTimer  = null;
let _livePriceMap   = {};         // mint -> last known price
let _ageTickTimer   = null;
let _solPriceTicker = null;
let _lastSolPrice   = 0;
const NP_PAGE_SIZE  = 15;

/* ── Smart Money state ── */
let _smRefreshTimer = null;
const SM_REFRESH_MS = 120_000; // 2 min — matches backend cron

/* ── Chart modal state ── */
let _hmToken     = null;
let _hmSolPrice  = null;
let _hmSellPct   = 100;
let _hmCandleChart  = null;
let _hmChartMint    = null;
let _hmCurrentTf    = "15m";
let _hmWsUnsub           = null;   /* cleanup fn for Birdeye WS subscription */
let _hmChartFastInterval = null;   /* 5 s REST poll — belt-and-suspenders alongside WS */

/* ── Simulator integration ── */
const HM_SIM_API  = "/.netlify/functions/simulator";
let _hmSimProfile = null;

/* ══════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════ */
function fmtPrice(p) {
  if (!p || p === 0) return "$—";
  if (p < 0.000001) return `$${p.toExponential(2)}`;
  if (p < 0.01)     return `$${p.toFixed(6)}`;
  if (p < 1)        return `$${p.toFixed(4)}`;
  if (p < 10)       return `$${p.toFixed(3)}`;
  return `$${p.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}
function fmtBig(n) {
  if (!n || n === 0) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000)     return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)         return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}
function fmtPct(v) {
  if (v == null) return "—";
  const abs  = Math.abs(v);
  const sign = v >= 0 ? "+" : "-";
  // Newly launched tokens can show millions of % (price up from near-zero baseline).
  // Format compactly so the column doesn't break layout.
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(1)}B%`;
  if (abs >= 1_000_000)     return `${sign}${(abs / 1_000_000).toFixed(1)}M%`;
  if (abs >= 10_000)        return `${sign}${Math.round(abs / 1_000)}K%`;
  if (abs >= 1_000)         return `${sign}${(abs / 1_000).toFixed(1)}K%`;
  return `${sign}${abs.toFixed(2)}%`;
}
function riskClass(level) {
  if (level === "MOON") return "tg-risk-moon";
  if (level === "LOW")  return "tg-risk-low";
  if (level === "MED")  return "tg-risk-med";
  return "tg-risk-high";
}
function scoreClass(score) {
  if (score >= 65) return "tg-score-good";
  if (score >= 45) return "tg-score-warn";
  return "tg-score-bad";
}
function changeClass(v) {
  if (v == null) return "";
  return v >= 0 ? "tg-chg-pos" : "tg-chg-neg";
}
function tfChangeKey(tf) {
  return { "30m": "m30", "1h": "h1", "6h": "h6", "12h": "h12", "24h": "h24" }[tf] || "h1";
}
function logoSrc(url) {
  if (!url) return "https://placehold.co/36x36/0a2a1e/2cffc9?text=?";
  return `/.netlify/functions/logoProxy?url=${encodeURIComponent(url)}`;
}
async function getSolPriceUsd() {
  try {
    const r = await fetch(SOL_PRICE_API, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return 0; // 503/429 etc — return 0 silently, no throw
    const j = await r.json();
    return (j.ok && j.price) ? j.price : 0;
  } catch { return 0; }
}

/* ══════════════════════════════════════════════
   FETCH — GAINERS
══════════════════════════════════════════════ */
async function fetchGainers(tf) {
  showLoading(true);
  hideError();
  try {
    const res = await fetch(`${GAINERS_API}?tf=${tf}&min_liq=1000`, {
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      if (j.error === "quota_exceeded") throw new Error("API quota exceeded — try again shortly.");
      throw new Error(j.error || `Server error ${res.status}`);
    }
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Unknown error");
    return data;
  } catch (err) {
    showError(err.message || "Failed to load top gainers.");
    return null;
  } finally {
    showLoading(false);
  }
}

/* ══════════════════════════════════════════════
   COLUMN SORT — GAINERS
══════════════════════════════════════════════ */
function _sortGainers(tokens, effectiveKey) {
  if (!tokens.length) return tokens;
  const d = _tgSortDir === "desc" ? -1 : 1;
  return [...tokens].sort((a, b) => {
    switch (_tgSortCol) {
      case "name":   return d * (a.name || "").localeCompare(b.name || "");
      case "price":  return d * ((a.price || 0) - (b.price || 0));
      case "change": return d * ((a.changes?.[effectiveKey] ?? -Infinity) - (b.changes?.[effectiveKey] ?? -Infinity));
      case "mc":     return d * ((a.mc || 0) - (b.mc || 0));
      case "liq":    return d * ((a.liquidity || 0) - (b.liquidity || 0));
      case "vol":    return d * ((a.vol24h || 0) - (b.vol24h || 0));
      case "risk":   return d * ((a.riskScore || 0) - (b.riskScore || 0));
      default:       return 0;
    }
  });
}

function updateSortHeaders() {
  document.querySelectorAll("#tgTable thead [data-sort]").forEach(th => {
    const isActive = th.dataset.sort === _tgSortCol;
    th.classList.toggle("tg-th-sort-active", isActive);
    th.dataset.dir = isActive ? _tgSortDir : "";
    const icon = th.querySelector(".tg-sort-icon");
    if (icon) icon.textContent = isActive ? (_tgSortDir === "desc" ? " ▼" : " ▲") : " ↕";
  });
}

/* ══════════════════════════════════════════════
   COLUMN SORT — NEW PAIRS
══════════════════════════════════════════════ */
function _sortNewPairsByCol(tokens, col, dir) {
  const d = dir === "desc" ? -1 : 1;
  return [...tokens].sort((a, b) => {
    switch (col) {
      case "name":  return d * (a.name || "").localeCompare(b.name || "");
      case "price": return d * ((a.price || 0) - (b.price || 0));
      case "age": {
        // Older = smaller createdAt timestamp = lower age value
        // "desc" → newest first (largest timestamp), "asc" → oldest first
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return d * (ta - tb);
      }
      case "liq":  return d * ((a.liquidity || 0) - (b.liquidity || 0));
      case "vol":  return d * ((a.vol24h || 0) - (b.vol24h || 0));
      case "mc":   return d * ((a.mc || 0) - (b.mc || 0));
      case "risk": return d * ((a.riskScore || 0) - (b.riskScore || 0));
      default:     return 0;
    }
  });
}

function updateNpSortHeaders() {
  document.querySelectorAll("#npTable thead [data-sort]").forEach(th => {
    const isActive = th.dataset.sort === _npSortCol;
    th.classList.toggle("tg-th-sort-active", isActive);
    th.dataset.dir = isActive ? _npSortDir : "";
    const icon = th.querySelector(".tg-sort-icon");
    if (icon) icon.textContent = isActive ? (_npSortDir === "desc" ? " ▼" : " ▲") : " ↕";
  });
}

/* ══════════════════════════════════════════════
   LIVE RISK REFRESH — batchRisk for both tables
   Called after table renders and on a 90s cycle.
   Runs TWO parallel requests so gainers (15) and
   NP (15) each get their own full batchRisk slot.
══════════════════════════════════════════════ */
/* Read the exact scanner score cached by script.js after a full scan (< 5 min old).
   Returns null when no fresh cache exists for this mint. */
function _readScannerScore(mint) {
  try {
    const raw = localStorage.getItem(`s2m_score_cache:${mint}`);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || !entry.score || !entry.level) return null;
    // Discard after 5 minutes so batchRisk takes over with live market data
    if (Date.now() - entry.ts > 5 * 60 * 1000) return null;
    return entry; // { score, level, ts }
  } catch { return null; }
}

function _applyRiskScores(scores) {
  let _tgFilterDirty = false; // gainers filter active + a visible token just scored HIGH
  let _npFilterDirty = false; // new pairs filter active + a visible NP token scored HIGH
  const _npSafeActive = !_npShowHighRisk;

  for (const [mint, batchEntry] of Object.entries(scores)) {
    // Prefer exact scanner score if user scanned this token within the last 5 minutes
    const scannerHit = _readScannerScore(mint);
    const { score, level } = scannerHit ?? batchEntry;

    // Persist in cache so re-renders after API refresh use the corrected score
    _riskCache.set(mint, { score, level });

    // Update gainers DOM cell in place
    const gRow = document.querySelector(`#tgBody tr[data-mint="${mint}"] .tg-td-risk`);
    if (gRow) {
      gRow.innerHTML = `<div class="tg-risk-cell"><span class="tg-risk-pill ${riskClass(level)}">${level}</span></div>`;
      // If Safe Only filter is active and this visible gainers token just scored HIGH → re-render
      if (level === "HIGH" && document.getElementById("tgRiskFilterBtn")?.dataset.active === "true") {
        _tgFilterDirty = true;
      }
    }

    // Update new pairs DOM cell in place
    const nRow = document.querySelector(`#npBody tr[data-mint="${mint}"] .tg-td-risk`);
    if (nRow) {
      nRow.innerHTML = `<div class="tg-risk-cell"><span class="tg-risk-pill ${riskClass(level)}">${level}</span></div>`;
      // If NP Safe Only filter is active and this visible NP token just scored HIGH → re-render
      if (level === "HIGH" && _npSafeActive) {
        _npFilterDirty = true;
      }
    }

    // Keep in-memory objects in sync
    const tg = _allTokens.find(t => t.mint === mint);
    if (tg) { tg.riskScore = score; tg.riskLevel = level; }
    const np = _npRawTokens.find(t => t.mint === mint);
    if (np) { np.riskScore = score; np.riskLevel = level; }
  }

  // Evict newly-HIGH tokens from filtered views
  if (_tgFilterDirty) renderTable();
  if (_npFilterDirty) _npApplyAllClientFilters();
}

async function _fetchRisk(mints, createdMap) {
  if (!mints.length) return;
  try {
    let url = `${BATCH_RISK_API}?mints=${mints.join(",")}`;
    // Pass creation timestamps so scoreTokenAge is accurate for new tokens
    // Format: created=mint1:unixMs1,mint2:unixMs2
    if (createdMap && Object.keys(createdMap).length) {
      const enc = Object.entries(createdMap)
        .filter(([, v]) => v)
        .map(([m, v]) => `${m}:${v}`)
        .join(",");
      if (enc) url += `&created=${encodeURIComponent(enc)}`;
    }
    const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return;
    const data = await r.json();
    if (!data.ok || !data.scores) return;
    _applyRiskScores(data.scores);
  } catch { /* silent — non-critical background refresh */ }
}

async function _refreshBatchRisk() {
  // Each table gets its own batchRisk call (up to 15 each) so neither starves the other
  const gMints = [...new Set([...document.querySelectorAll("#tgBody tr[data-mint]")].map(r => r.dataset.mint).filter(Boolean))].slice(0, 15);
  const nMints = [...new Set([...document.querySelectorAll("#npBody tr[data-mint]")].map(r => r.dataset.mint).filter(Boolean))].slice(0, 15);

  // Build createdAt map for NP tokens — enables accurate scoreTokenAge
  const npCreatedMap = {};
  for (const tok of _npRawTokens) {
    if (tok.mint && tok.createdAt) {
      const ts = new Date(tok.createdAt).getTime();
      if (!isNaN(ts)) npCreatedMap[tok.mint] = ts;
    }
  }

  await Promise.allSettled([_fetchRisk(gMints), _fetchRisk(nMints, npCreatedMap)]);
}

/* ══════════════════════════════════════════════
   RENDER TABLE — GAINERS
══════════════════════════════════════════════ */
function renderTable() {
  const tbody = document.getElementById("tgBody");
  const pagination = document.getElementById("tgPagination");
  if (!tbody) return;

  const chKey  = tfChangeKey(_tf);
  // When the selected TF has no data, use 24h as fallback (set by renderStatsBar)
  const effectiveKey = _tgUsingFallback ? "h24" : chKey;
  // Apply min % gain filter + risk filter then column sort
  let filtered = _tgMinGainPct > 0
    ? _allTokens.filter(t => (t.changes?.[effectiveKey] || 0) >= _tgMinGainPct)
    : _allTokens;
  // Safe Only — hide HIGH risk. Double-check against button DOM state in case of module reload edge cases.
  const _safeBtn = document.getElementById("tgRiskFilterBtn");
  const _safeActive = !_tgShowHighRisk || _safeBtn?.dataset.active === "true";
  if (_safeActive) {
    filtered = filtered.filter(t => {
      const rc  = _riskCache.get(t.mint);
      const lvl = rc?.level ?? t.riskLevel ?? "HIGH";
      return lvl !== "HIGH";
    });
  }
  const displayTokens = _sortGainers(filtered, effectiveKey);
  updateSortHeaders();
  const start  = (_page - 1) * PER_PAGE;
  const slice  = displayTokens.slice(start, start + PER_PAGE);
  const total  = displayTokens.length;
  const pages  = Math.ceil(total / PER_PAGE);

  if (!slice.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="tg-empty">No tokens found.</td></tr>`;
    if (pagination) pagination.style.display = "none";
    return;
  }

  tbody.innerHTML = slice.map((tok, idx) => {
    const chVal = tok.changes?.[effectiveKey];
    const rank  = start + idx + 1;
    const _rc   = _riskCache.get(tok.mint);
    const rs    = _rc?.score  ?? tok.riskScore ?? 50;
    const rl    = _rc?.level  ?? (tok.riskLevel || "HIGH");
    return `
    <tr class="tg-row" data-mint="${tok.mint}">
      <td class="tg-td tg-td-rank"><span class="tg-rank">${rank}</span></td>
      <td class="tg-td tg-td-token">
        <div class="tg-token-cell">
          <img class="tg-logo" src="${logoSrc(tok.logo)}"
            onerror="this.src='https://placehold.co/36x36/0a2a1e/2cffc9?text=?'"
            referrerpolicy="no-referrer" alt="${esc(tok.symbol)}" />
          <div class="tg-token-info">
            <div class="tg-token-name">${esc(tok.name) || "Unknown"}</div>
            <div class="tg-token-sym">${esc(tok.symbol)}</div>
          </div>
        </div>
      </td>
      <td class="tg-td tg-td-price">${fmtPrice(tok.price)}</td>
      <td class="tg-td tg-td-change">
        <span class="tg-chg ${changeClass(chVal)}">${fmtPct(chVal)}</span>
      </td>
      <td class="tg-td tg-td-mc">${fmtBig(tok.mc)}</td>
      <td class="tg-td tg-td-liq">${fmtBig(tok.liquidity)}</td>
      <td class="tg-td tg-td-vol">${fmtBig(tok.vol24h)}</td>
      <td class="tg-td tg-td-risk">
        <div class="tg-risk-cell">
          <span class="tg-risk-pill ${riskClass(rl)}">${rl}</span>
        </div>
      </td>
      <td class="tg-td tg-td-actions">
        <div class="tg-actions">
          <button class="tg-act-btn tg-act-scan" onclick="event.stopPropagation();homeGoToScan('${tok.mint}')" title="Risk Scan">🔍</button>
          <button class="tg-act-btn tg-act-ape"  onclick="event.stopPropagation();homeGoToApe('${tok.mint}')"  title="Ape Simulator">🦍</button>
        </div>
      </td>
    </tr>`;
  }).join("");

  tbody.querySelectorAll(".tg-row").forEach(row => {
    row.style.cursor = "pointer";
    row.addEventListener("click", () => {
      const mint = row.dataset.mint;
      const tok  = _allTokens.find(t => t.mint === mint);
      if (tok) window.openHomeChart(tok);
    });
  });

  // Sync Birdeye WS subscriptions for the new visible rows
  setTimeout(_syncTableWsSubs, 50);

  // Refresh risk scores live — background call after DOM is ready
  setTimeout(_refreshBatchRisk, 200);

  if (pagination) {
    pagination.style.display = pages > 1 ? "flex" : "none";
    const prevBtn = document.getElementById("tgPrevBtn");
    const nextBtn = document.getElementById("tgNextBtn");
    const pageInfo = document.getElementById("tgPageInfo");
    if (prevBtn) prevBtn.disabled = _page <= 1;
    if (nextBtn) nextBtn.disabled = _page >= pages;
    if (pageInfo) pageInfo.textContent = `Page ${_page} of ${pages}`;
  }
}

/* ══════════════════════════════════════════════
   STATS BAR
══════════════════════════════════════════════ */
function renderStatsBar(tokens, updatedAt) {
  const bar = document.getElementById("tgStatsBar");
  if (!bar || !tokens.length) return;
  const chKey = tfChangeKey(_tf);

  // If the selected TF has no data (all null), fall back to 24h
  let changes = tokens.map(t => t.changes?.[chKey]).filter(v => v != null);
  let usingFallback = false;
  if (!changes.length) {
    changes = tokens.map(t => t.changes?.h24).filter(v => v != null);
    usingFallback = changes.length > 0;
  }

  const avgGain = changes.length ? (changes.reduce((a,b) => a+b, 0) / changes.length).toFixed(1) : "—";
  const topGain = changes.length ? Math.max(...changes).toFixed(1) : "—";
  const secs    = Math.floor((Date.now() - updatedAt) / 1000);
  const updStr  = secs < 5 ? "just now" : `${secs}s ago`;

  document.getElementById("tgStatGainers").innerHTML =
    `<span class="tg-stat-label">🚀 Tokens</span><span class="tg-stat-val">${tokens.length}</span>`;
  document.getElementById("tgStatAvgGain").innerHTML =
    `<span class="tg-stat-label">📊 Avg gain</span><span class="tg-stat-val tg-chg-pos">${avgGain !== "—" ? "+" + avgGain + "%" : "—"}</span>`;
  document.getElementById("tgStatTopGain").innerHTML =
    `<span class="tg-stat-label">🏆 Top gain</span><span class="tg-stat-val tg-chg-pos">${topGain !== "—" ? "+" + topGain + "%" : "—"}</span>`;
  document.getElementById("tgStatUpdated").innerHTML =
    `<span class="tg-stat-label">🕐 Updated</span><span class="tg-stat-val">${updStr}</span>`;
  bar.style.display = "flex";
  _tgUsingFallback = usingFallback;
  updateTfHeader(); // re-render header in case fallback state changed
}

let _tgUsingFallback = false;

function updateTfHeader() {
  const th = document.getElementById("tgThChange");
  if (!th) return;
  const label = _tgUsingFallback ? "24H % ↩" : _tf.toUpperCase() + " %";
  th.title = _tgUsingFallback ? "1H data unavailable — showing 24H % instead" : "";
  // Preserve the sort icon span
  const icon = th.querySelector(".tg-sort-icon");
  const iconHtml = icon ? icon.outerHTML : '<span class="tg-sort-icon"> ↕</span>';
  th.innerHTML = label + iconHtml;
}

function showLoading(show) {
  const el = document.getElementById("tgLoading");
  const table = document.getElementById("tgTable");
  if (el) el.style.display = show ? "flex" : "none";
  if (table) table.style.opacity = show ? "0.35" : "1";
}
function showError(msg) {
  const el = document.getElementById("tgError");
  const msgEl = document.getElementById("tgErrorMsg");
  if (el) el.style.display = "flex";
  if (msgEl) msgEl.textContent = msg;
}
function hideError() {
  const el = document.getElementById("tgError");
  if (el) el.style.display = "none";
}

function startRefreshRing() {
  const ring = document.getElementById("tgRefreshRing");
  if (!ring) return;
  if (_refreshProgress) clearInterval(_refreshProgress);
  let pct = 0;
  ring.style.setProperty("--tg-ring-pct", "0%");
  _refreshProgress = setInterval(() => {
    pct = Math.min(100, pct + (100 / (AUTO_REFRESH / 500)));
    ring.style.setProperty("--tg-ring-pct", `${pct}%`);
    if (pct >= 100) { clearInterval(_refreshProgress); _refreshProgress = null; }
  }, 500);
}

async function loadGainers(tf) {
  _tf = tf; _page = 1;
  updateTfHeader();
  const data = await fetchGainers(tf);
  if (!data) return;
  _allTokens   = data.tokens || [];
  _lastUpdated = data.updatedAt || Date.now();
  renderTable();
  renderStatsBar(_allTokens, _lastUpdated);
  startRefreshRing();
}

function scheduleRefresh() {
  if (_refreshTimer) clearTimeout(_refreshTimer);
  _refreshTimer = setTimeout(() => { loadGainers(_tf).then(scheduleRefresh); }, AUTO_REFRESH);
}

/* ══════════════════════════════════════════════
   NEW PAIRS — RENDER
══════════════════════════════════════════════ */
function renderNewPairs() {
  const tbody  = document.getElementById("npBody");
  const loadEl = document.getElementById("npLoading");
  const errEl  = document.getElementById("npError");
  if (!tbody) return;
  if (loadEl) loadEl.style.display = "none";
  if (errEl)  errEl.style.display  = "none";
  updateNpSortHeaders();

  if (!_npTokens.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="tg-empty">No tokens match your filters.</td></tr>`;
    _npRenderPagination(0, 0);
    return;
  }

  // ── Pagination ──
  const totalPages = Math.ceil(_npTokens.length / NP_PAGE_SIZE);
  _npCurrentPage   = Math.min(_npCurrentPage, Math.max(0, totalPages - 1));
  const start      = _npCurrentPage * NP_PAGE_SIZE;
  const pageTokens = _npTokens.slice(start, start + NP_PAGE_SIZE);

  tbody.innerHTML = pageTokens.map((tok, i) => {
    const idx = start + i;
    const _rc = _riskCache.get(tok.mint);
    const rs  = _rc?.score ?? tok.riskScore ?? 50;
    const rl  = _rc?.level ?? (tok.riskLevel || "MED");
    return `
    <tr class="tg-row np-row" data-mint="${tok.mint}" data-created="${tok.createdAt ? new Date(tok.createdAt).getTime() : 0}">
      <td class="tg-td tg-td-rank"><span class="tg-rank">${idx + 1}</span></td>
      <td class="tg-td tg-td-token">
        <div class="tg-token-cell">
          <img class="tg-logo" src="${logoSrc(tok.logo)}"
            onerror="this.src='https://placehold.co/36x36/0a2a1e/2cffc9?text=?'"
            referrerpolicy="no-referrer" alt="${esc(tok.symbol)}" />
          <div class="tg-token-info">
            <div class="tg-token-name">${esc(tok.name) || "Unknown"}</div>
            <div class="tg-token-sym">${esc(tok.symbol)}</div>
          </div>
        </div>
      </td>
      <td class="tg-td tg-td-price">${fmtPrice(tok.price)}</td>
      <td class="tg-td np-td-age">
        <span class="np-age-badge">${tok.age || "—"}</span>
      </td>
      <td class="tg-td tg-td-liq">${fmtBig(tok.liquidity)}</td>
      <td class="tg-td tg-td-vol">${fmtBig(tok.vol24h)}</td>
      <td class="tg-td tg-td-mc">${fmtBig(tok.mc || 0)}</td>
      <td class="tg-td tg-td-risk">
        <div class="tg-risk-cell">
          <span class="tg-risk-pill ${riskClass(rl)}">${rl}</span>
        </div>
      </td>
      <td class="tg-td tg-td-actions">
        <div class="tg-actions">
          <button class="tg-act-btn tg-act-scan" onclick="event.stopPropagation();homeGoToScan('${tok.mint}')" title="Risk Scan">🔍</button>
          <button class="tg-act-btn tg-act-ape"  onclick="event.stopPropagation();homeGoToApe('${tok.mint}')"  title="Ape Simulator">🦍</button>
        </div>
      </td>
    </tr>`;
  }).join("");

  tbody.querySelectorAll(".np-row").forEach(row => {
    row.style.cursor = "pointer";
    row.addEventListener("click", () => {
      const mint = row.dataset.mint;
      const tok  = _npTokens.find(t => t.mint === mint);
      if (tok) window.openHomeChart(tok);
    });
  });

  _npRenderPagination(totalPages, _npTokens.length);

  // Sync Birdeye WS subscriptions for the new visible rows
  setTimeout(_syncTableWsSubs, 50);

  // Refresh risk scores live — runs in background after DOM is ready
  setTimeout(_refreshBatchRisk, 200);
}

/* Inject/update the pagination bar below the new-pairs table */
function _npRenderPagination(totalPages, totalCount) {
  const wrap = document.getElementById("npPaginationWrap");
  if (!wrap) return;
  if (totalPages <= 1) { wrap.innerHTML = ""; return; }
  const prevDisabled = _npCurrentPage === 0 ? "disabled" : "";
  const nextDisabled = _npCurrentPage >= totalPages - 1 ? "disabled" : "";
  wrap.innerHTML = `
    <div class="np-pagination">
      <button class="np-page-btn" onclick="_npGoPage(${_npCurrentPage - 1})" ${prevDisabled}>◀ Prev</button>
      <span class="np-page-info">Page ${_npCurrentPage + 1} / ${totalPages} &nbsp;·&nbsp; ${totalCount} tokens</span>
      <button class="np-page-btn" onclick="_npGoPage(${_npCurrentPage + 1})" ${nextDisabled}>Next ▶</button>
    </div>`;
}

window._npGoPage = function(page) {
  const totalPages = Math.ceil(_npTokens.length / NP_PAGE_SIZE);
  _npCurrentPage = Math.max(0, Math.min(page, totalPages - 1));
  renderNewPairs();
  // Scroll table into view
  document.getElementById("npBody")?.closest("table")?.scrollIntoView({ behavior: "smooth", block: "start" });
};

/* ══════════════════════════════════════════════
   NEW PAIRS — FETCH + FILTER
══════════════════════════════════════════════ */
async function loadNewPairs(win, minLiq, silent = false) {
  win    = win    || _npWindow;
  minLiq = minLiq !== undefined ? minLiq : _npMinLiq;
  const loadEl = document.getElementById("npLoading");
  const errEl  = document.getElementById("npError");
  if (loadEl) loadEl.style.display = "flex";
  if (errEl)  errEl.style.display  = "none";
  try {
    const url = `${NEW_PAIRS_API}?window=${win}&min_liq=${minLiq}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Unknown error");
    _npRawTokens = data.tokens || [];
    _npApplyAllClientFilters(silent);
  } catch (err) {
    if (loadEl) loadEl.style.display = "none";
    if (errEl) {
      errEl.style.display = "flex";
      const msgEl = document.getElementById("npErrorMsg");
      if (msgEl) msgEl.textContent = err.message || "Failed to load new pairs.";
    }
  }
}

function _npApplyAllClientFilters(silent = false) {
  let tokens = [..._npRawTokens];

  // ── Time window filter (based on lastTradeUnixTime stored as createdAt ISO) ──
  const windowMs = { "1h": 3_600_000, "6h": 21_600_000, "24h": 86_400_000 }[_npWindow];
  if (windowMs) {
    const cutoff = Date.now() - windowMs;
    tokens = tokens.filter(t => {
      if (!t.createdAt) return true; // no timestamp → include to avoid hiding everything
      return new Date(t.createdAt).getTime() >= cutoff;
    });
  }

  // ── Liquidity filter — always applied when user explicitly picks a value ──
  // (only skip default 5000 in "newest" mode so ultra-fresh liq≈0 tokens still show)
  const liqIsDefault = _npMinLiq === 5000;
  if (_npMinLiq > 0 && !(liqIsDefault && _npWindow === "newest")) {
    tokens = tokens.filter(t => (t.liquidity || 0) >= _npMinLiq);
  }

  // ── Volume filter ──
  tokens = tokens.filter(t => {
    const v = t.vol24h || 0;
    if (_npVolFilter === "low")  return v < 10_000;
    if (_npVolFilter === "mid")  return v >= 10_000 && v < 100_000;
    if (_npVolFilter === "high") return v >= 100_000;
    return true;
  });

  // ── Market cap filter ──
  tokens = tokens.filter(t => {
    const mc = t.mc || 0;
    if (_npMcapFilter === "micro") return mc > 0 && mc < 30_000;
    if (_npMcapFilter === "small") return mc >= 30_000 && mc < 100_000;
    if (_npMcapFilter === "mid")   return mc >= 100_000 && mc < 500_000;
    return true;
  });

  // ── Holder filter — skip when data is unavailable (all null) ──
  const hasHolderData = tokens.some(t => t.holders !== null && t.holders !== undefined);
  if (hasHolderData && _npHolderFilter !== "all") {
    tokens = tokens.filter(t => {
      const h = t.holders;
      if (h === null || h === undefined) return true; // include unknowns
      if (_npHolderFilter === "tiny") return h < 100;
      if (_npHolderFilter === "low")  return h >= 100 && h < 1000;
      if (_npHolderFilter === "mid")  return h >= 1000 && h < 5000;
      if (_npHolderFilter === "high") return h >= 5000;
      return true;
    });
  }

  // ── Risk filter (Safe Only) — use _riskCache first (same as gainers) ──
  if (!_npShowHighRisk) {
    tokens = tokens.filter(t => {
      const rc  = _riskCache.get(t.mint);
      const lvl = rc?.level ?? t.riskLevel ?? "MED";
      return lvl !== "HIGH";
    });
  }

  // ── Sort ── column click overrides filter modal sort preset
  if (_npSortCol) {
    tokens = _sortNewPairsByCol(tokens, _npSortCol, _npSortDir);
  } else if (_npSortBy === "liq") {
    tokens = tokens.slice().sort((a, b) => (b.liquidity || 0) - (a.liquidity || 0));
  } else if (_npSortBy === "vol") {
    tokens = tokens.slice().sort((a, b) => (b.vol24h || 0) - (a.vol24h || 0));
  } else if (_npSortBy === "hotness") {
    // Hotness = vol / max(liq, 1) ratio — high means lots of trading relative to pool size
    tokens = tokens.slice().sort((a, b) => {
      const ha = (a.vol24h || 0) / Math.max(a.liquidity || 1, 1);
      const hb = (b.vol24h || 0) / Math.max(b.liquidity || 1, 1);
      return hb - ha;
    });
  } else {
    // Default: newest first
    tokens = tokens.slice().sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    });
  }

  if (!silent) _npCurrentPage = 0; // only reset to page 1 on user-initiated filter change
  _npTokens = tokens;
  renderNewPairs();
  _npUpdateFilterBadge();
}

/* ══════════════════════════════════════════════
   LIVE PRICE TICKER — Birdeye WebSocket (replaces 10s REST polling)
   Subscriptions are managed per visible page; re-subscribed on table re-render.
══════════════════════════════════════════════ */

function _flashPriceEl(el, dir) {
  if (!el) return;
  el.classList.remove("price-flash-up", "price-flash-down");
  void el.offsetWidth; // force reflow
  el.classList.add(dir > 0 ? "price-flash-up" : "price-flash-down");
  setTimeout(() => el.classList.remove("price-flash-up", "price-flash-down"), 1400);
}

/* Map of mint → WS unsub fn for table price subscriptions */
const _tableWsSubs = new Map();

/** Build a WS price callback for a given mint that updates the DOM table cells */
function _mkTablePriceHandler(mint) {
  return (wsData) => {
    // wsData.price is always set — normalised by birdeye-ws.js from c/close/value
    const newPrice = wsData?.price;
    if (!(newPrice > 0)) return;

    const oldPrice = _livePriceMap[mint];
    const changed  = oldPrice !== undefined && Math.abs(newPrice - oldPrice) / (oldPrice || 1) > 0.0005;
    _livePriceMap[mint] = newPrice;
    if (!changed && oldPrice !== undefined) return;

    const dir = oldPrice !== undefined ? (newPrice > oldPrice ? 1 : -1) : 0;

    // Update gainers table cell
    const gRow = document.querySelector(`#tgBody tr[data-mint="${mint}"] .tg-td-price`);
    if (gRow) { gRow.textContent = fmtPrice(newPrice); if (dir) _flashPriceEl(gRow, dir); }

    // Update new-pairs table cell
    const nRow = document.querySelector(`#npBody tr[data-mint="${mint}"] .tg-td-price`);
    if (nRow) { nRow.textContent = fmtPrice(newPrice); if (dir) _flashPriceEl(nRow, dir); }

    // Keep in-memory objects in sync
    const tg = _allTokens.find(t => t.mint === mint);
    if (tg) tg.price = newPrice;
    const np = _npRawTokens.find(t => t.mint === mint);
    if (np) np.price = newPrice;
  };
}

/**
 * Subscribe to Birdeye WS for all mints currently visible in the tables.
 * Called after every table render. Automatically unsubs mints that
 * scrolled off the page.
 */
function _syncTableWsSubs() {
  const gMints = [...document.querySelectorAll("#tgBody tr[data-mint]")].map(r => r.dataset.mint).filter(Boolean);
  const nMints = _mode === "newpairs"
    ? [...document.querySelectorAll("#npBody tr[data-mint]")].map(r => r.dataset.mint).filter(Boolean)
    : [];
  const visible = new Set([...gMints, ...nMints]);

  // Unsub mints that are no longer visible
  for (const [mint, unsub] of _tableWsSubs) {
    if (!visible.has(mint)) { unsub(); _tableWsSubs.delete(mint); }
  }

  // Sub new visible mints
  for (const mint of visible) {
    if (_tableWsSubs.has(mint)) continue; // already subscribed
    const handler = _mkTablePriceHandler(mint);
    // Subscribe without chartType → price-only feed, lowest latency
    const unsub = birdeyeWs.subscribe(mint, null, handler);
    _tableWsSubs.set(mint, unsub);
  }
}

/** Unsubscribe all table price feeds (called on page unload / tab switch) */
function stopLivePriceTick() {
  for (const unsub of _tableWsSubs.values()) unsub();
  _tableWsSubs.clear();
  if (_liveTickTimer) { clearInterval(_liveTickTimer); _liveTickTimer = null; }
}

/** Called once at startup — birdeyeWs connects lazily on first subscribe */
function startLivePriceTick() {
  // Initial table sub happens after first render; nothing to do here
  // Keep a lightweight SOL-price fallback ticker to maintain the chip
}

/* ── Age counter — ticks the AGE column every 30s, no API needed ── */
function _fmtAgeMs(ms) {
  const min = Math.floor(ms / 60000);
  if (min < 1)  return "< 1m";
  if (min < 60) return min + "m";
  const hr = Math.floor(min / 60);
  if (hr < 24)  return `${hr}h ${min % 60}m`;
  return `${Math.floor(hr / 24)}d`;
}
function _tickAges() {
  document.querySelectorAll("#npBody tr[data-created]").forEach(row => {
    const ts = parseInt(row.dataset.created, 10);
    if (!ts) return;
    const badge = row.querySelector(".np-age-badge");
    if (badge) badge.textContent = _fmtAgeMs(Date.now() - ts);
  });
}
function startAgeTick() {
  if (_ageTickTimer) clearInterval(_ageTickTimer);
  _ageTickTimer = setInterval(_tickAges, 30_000);
}
function stopAgeTick() {
  if (_ageTickTimer) { clearInterval(_ageTickTimer); _ageTickTimer = null; }
}

/* ── SOL price chip — updates in the stats bar every 6s ── */
let _solPriceMisses = 0; // consecutive failure counter — backs off after 5 misses
async function _updateSolPriceChip() {
  if (_solPriceMisses >= 5) return; // stop hammering if the endpoint is down
  let price = await getSolPriceUsd();
  // CoinGecko fallback when Birdeye is rate-limited
  if (!price) {
    try {
      const r = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
        { signal: AbortSignal.timeout(4000) }
      );
      if (r.ok) { const d = await r.json(); price = d?.solana?.usd || 0; }
    } catch {}
  }
  if (!price) { _solPriceMisses++; return; }
  _solPriceMisses = 0; // reset on success
  _hmSolPrice = price; // keep modal's solPrice in sync
  _solPriceMisses = 0; // reset on success
  const el = document.getElementById("tgStatSolPrice");
  if (!el) return;
  const dir = _lastSolPrice ? (price > _lastSolPrice ? 1 : price < _lastSolPrice ? -1 : 0) : 0;
  _lastSolPrice = price;
  const cls = dir > 0 ? "tg-chg-pos" : dir < 0 ? "tg-chg-neg" : "";
  const valHtml = `<span class="tg-stat-val ${cls}" id="tgSolPriceVal">$${price.toFixed(2)}</span>`;
  el.innerHTML = `<span class="tg-stat-label">◎ SOL</span>${valHtml}`;
  if (dir !== 0) _flashPriceEl(document.getElementById("tgSolPriceVal"), dir);
}
function startSolTicker() {
  _updateSolPriceChip();
  if (_solPriceTicker) clearInterval(_solPriceTicker);
  _solPriceTicker = setInterval(_updateSolPriceChip, 6_000);
}

function _npScheduleRefresh() {
  if (_npRefreshTimer) clearInterval(_npRefreshTimer);
  _npRefreshTimer = setInterval(() => { if (_mode === "newpairs") loadNewPairs(_npWindow, _npMinLiq, true); }, NP_AUTO_REFRESH);
  // Start age counter (no API — pure JS)
  startAgeTick();
}
function _npStopRefresh() {
  if (_npRefreshTimer) { clearInterval(_npRefreshTimer); _npRefreshTimer = null; }
  stopAgeTick();
}

/* ══════════════════════════════════════════════
   HOME CHART MODAL
══════════════════════════════════════════════ */
window.openHomeChart = async function(tok) {
  _hmToken = tok; _hmChartMint = tok.mint;
  const modal = document.getElementById("hmChartModal");
  if (!modal) return;
  document.getElementById("hmChartLogo").src = logoSrc(tok.logo);
  document.getElementById("hmChartName").textContent = `${tok.name} (${tok.symbol})`;
  document.getElementById("hmChartPrice").textContent = fmtPrice(tok.price);
  const chg = tok.change24h ?? tok.changes?.h24 ?? null;
  const chgEl = document.getElementById("hmChartChange");
  if (chgEl) { chgEl.textContent = chg != null ? fmtPct(chg) : ""; chgEl.className = "hm-chart-change " + changeClass(chg); }
  const scanBtn = document.getElementById("hmChartScanBtn");
  if (scanBtn) scanBtn.onclick = () => { window.closeHomeChart(); homeGoToScan(tok.mint); };
  modal.style.display = "flex";
  document.body.style.overflow = "hidden";
  if (!_hmSolPrice) { getSolPriceUsd().then(p => { if (p > 0) _hmSolPrice = p; _hmUpdateBuyEst(); }); }
  else { _hmUpdateBuyEst(); }
  // Show loading state while profile fetches; auto-detect Phantom if already trusted
  const _preWallet = window._saWallet || localStorage.getItem("sa_wallet");
  if (_preWallet) {
    const balEl = document.getElementById("hmSimBalance");
    if (balEl) balEl.textContent = "Loading…";
  } else {
    // Try to silently reconnect Phantom (no popup — only if already authorized)
    try {
      const ph = window.phantom?.solana || window.solana;
      if (ph?.isPhantom) {
        ph.connect({ onlyIfTrusted: true }).then(r => {
          const w = r?.publicKey?.toString();
          if (w) { localStorage.setItem("sa_wallet", w); _hmLoadSimProfile(); }
        }).catch(() => {});
      }
    } catch {}
  }
  // Reset sell % to 100 every time the modal opens
  _hmSellPct = 100;
  document.querySelectorAll(".hm-pct-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.pct === "100");
  });
  _hmLoadSimProfile();
  _hmLoadChart(_hmCurrentTf);
};

window.closeHomeChart = function() {
  const modal = document.getElementById("hmChartModal");
  if (modal) modal.style.display = "none";
  document.body.style.overflow = "";
  // Unsubscribe from Birdeye WS + stop REST poll
  if (_hmWsUnsub) { _hmWsUnsub(); _hmWsUnsub = null; }
  clearInterval(_hmChartFastInterval); _hmChartFastInterval = null;
  if (_hmCandleChart) { _hmCandleChart.destroy(); _hmCandleChart = null; }
};

window._hmChartBgClick = function(e) {
  if (e.target === document.getElementById("hmChartModal")) window.closeHomeChart();
};

async function _hmLoadChart(tf) {
  _hmCurrentTf = tf;
  const canvas  = document.getElementById("hmChartCanvas");
  const loadEl  = document.getElementById("hmChartLoading");
  const errEl   = document.getElementById("hmChartError");
  if (!canvas) return;
  if (errEl)  errEl.style.display  = "none";
  if (loadEl) loadEl.style.display = "flex";
  document.querySelectorAll(".hm-chart-tf-btn").forEach(b => {
    b.classList.toggle("hm-chart-tf-active", b.dataset.tf === tf);
  });

  // ── Stop previous WS subscription + REST poll ──
  if (_hmWsUnsub) { _hmWsUnsub(); _hmWsUnsub = null; }
  clearInterval(_hmChartFastInterval); _hmChartFastInterval = null;
  if (_hmCandleChart) { _hmCandleChart.destroy(); _hmCandleChart = null; }

  try {
    const res = await fetch(`/.netlify/functions/ohlcvData?mint=${_hmChartMint}&tf=${tf}`,
      { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error("Chart data unavailable");
    const data = await res.json();
    if (!data.ok || !data.bars?.length) throw new Error("No candle data");
    if (loadEl) loadEl.style.display = "none";

    // CandleChart takes a container ID string + opts; data loaded via loadCandles()
    _hmCandleChart = new CandleChart("hmChartCanvas", { noToolbar: true });
    // Set tf so open-candle exclusion + axis formatting uses the right period
    const TF_MS_MAP = { "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000 };
    _hmCandleChart.tf    = tf;
    _hmCandleChart.tfMs  = TF_MS_MAP[tf] || 900_000;
    _hmCandleChart.setToken(_hmToken?.name || "", _hmToken?.symbol || "");

    // Convert object bars → [ts, o, h, l, c, v] tuples expected by loadCandles
    const tuples = data.bars.map(b => [b.time, b.open, b.high, b.low, b.close, b.volume || 0]);
    _hmCandleChart.loadCandles(tuples);

    // ── Subscribe to Birdeye WS for live candle updates ──
    if (_hmChartMint) {
      const normTf = { "15m":"15m","1h":"1H","4h":"4H","1d":"1D" }[tf] || "15m";
      const chartMintSnap = _hmChartMint; // capture for async safety

      const _hmOnWsTick = (wsData) => {
        // wsData is normalised by birdeye-ws.js: { address, price, o,h,l,c,v, unixTime }
        const price = wsData?.price;
        if (!(price > 0) || !_hmCandleChart) return;
        const vol = wsData?.v || 0;
        _hmCandleChart.tick(price, vol);

        // Update price display in modal header
        const priceEl = document.getElementById("hmChartPrice");
        if (priceEl) priceEl.textContent = fmtPrice(price);
        // Update live price in the table row so it stays in sync
        const gRow = document.querySelector(`#tgBody tr[data-mint="${chartMintSnap}"] .tg-td-price`);
        if (gRow) gRow.textContent = fmtPrice(price);
        const nRow = document.querySelector(`#npBody tr[data-mint="${chartMintSnap}"] .tg-td-price`);
        if (nRow) nRow.textContent = fmtPrice(price);
      };

      // WS primary
      const unsub1 = birdeyeWs.subscribe(chartMintSnap, normTf, _hmOnWsTick);
      const unsub2 = birdeyeWs.subscribe(chartMintSnap, null,   _hmOnWsTick); // price-only fallback
      _hmWsUnsub = () => { unsub1(); unsub2(); };

      // ── REST poll — belt-and-suspenders (5 s) ───────────────────────────
      // Guarantees candle ticks even if WS messages aren't flowing.
      const _hmRestPoll = async () => {
        if (!_hmCandleChart) return;
        try {
          const r = await fetch(`${PRICE_API}?mint=${encodeURIComponent(chartMintSnap)}`);
          if (!r.ok) return;
          const d = await r.json();
          if (d?.ok && d.price > 0) _hmOnWsTick({ address: chartMintSnap, price: d.price, v: 0 });
        } catch { /* non-critical */ }
      };
      _hmChartFastInterval = setInterval(_hmRestPoll, 5000);
      _hmRestPoll(); // immediate first tick
    }
  } catch (err) {
    if (loadEl) loadEl.style.display = "none";
    if (errEl)  errEl.style.display  = "flex";
  }
}

async function _hmLoadSimProfile() {
  const wallet = window._saWallet || localStorage.getItem("sa_wallet");
  if (!wallet) return;
  // Retry up to 3× on 503 — Netlify Blobs occasionally returns null transiently
  // for registered wallets; the server guards against data wipe by returning 503.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) await new Promise(r => setTimeout(r, attempt * 1500));
      const r = await fetch(`${HM_SIM_API}?wallet=${wallet}`, { signal: AbortSignal.timeout(8000) });
      if (r.status === 503) continue; // Blobs transient — retry
      if (!r.ok) return;
      const d = await r.json();
      if (d.profile) { _hmSimProfile = d.profile; _hmUpdateSellPanel(); _hmRenderBalance(); }
      return;
    } catch {}
  }
}

function _hmUpdateBuyEst() {
  const estEl = document.getElementById("hmBuyEst");
  if (!estEl || !_hmToken) return;
  const amount = parseFloat(document.getElementById("hmBuyAmount")?.value) || 0.1;
  if (_hmSolPrice && _hmToken.price) {
    const tokens = (amount * _hmSolPrice) / _hmToken.price;
    estEl.textContent = `≈ ${tokens.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${_hmToken.symbol}`;
  } else { estEl.textContent = "≈ — tokens"; }
}

function _hmUpdateSellPanel() {
  const estEl = document.getElementById("hmSellEst");
  if (!estEl || !_hmToken || !_hmSimProfile) return;
  const h = _hmSimProfile.holdings?.[_hmToken.mint];
  if (!h || !h.amount) { estEl.textContent = "No open position"; return; }
  const sellAmt = h.amount * (_hmSellPct / 100);
  const solVal  = _hmSolPrice && _hmToken.price ? (sellAmt * _hmToken.price / _hmSolPrice) : null;
  const pctTxt  = _hmSellPct < 100 ? `${_hmSellPct}% of ` : "";
  estEl.textContent = solVal
    ? `${pctTxt}${sellAmt.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${_hmToken.symbol} ≈ ${solVal.toFixed(4)} S2M`
    : `${pctTxt}${sellAmt.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${_hmToken.symbol}`;
}

window._hmSetTab = function(tab) {
  document.getElementById("hmBuyPanel").style.display  = tab === "buy"  ? "" : "none";
  document.getElementById("hmSellPanel").style.display = tab === "sell" ? "" : "none";
  document.getElementById("hmTabBuy").classList.toggle("active",  tab === "buy");
  document.getElementById("hmTabSell").classList.toggle("active", tab === "sell");
};
/* ── Helper: show feedback on a button then restore it ── */
function _hmBtnFeedback(btn, msg, delay = 2500) {
  if (!btn) return;
  const orig = btn.textContent;
  btn.textContent = msg;
  btn.disabled = true;
  setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, delay);
}

/* ── Update balance chip in trade panel header ── */
function _hmRenderBalance() {
  const el = document.getElementById("hmSimBalance");
  if (!el) return;
  if (!_hmSimProfile) { el.textContent = "Connect wallet"; return; }
  const bal = isFinite(_hmSimProfile.balance) ? Math.max(0, _hmSimProfile.balance) : 0;
  el.textContent = `${bal.toFixed(3)} S2M`;
}

/* ── Get SOL price with CoinGecko fallback when Birdeye is down ── */
async function _hmGetSolPrice() {
  let p = _hmSolPrice || (await getSolPriceUsd());
  if (p > 0) return p;
  // Birdeye down — try CoinGecko (allowed in connect-src CSP)
  try {
    const r = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
      { signal: AbortSignal.timeout(4000) }
    );
    if (r.ok) { const d = await r.json(); p = d?.solana?.usd || 0; }
  } catch {}
  if (p > 0) { _hmSolPrice = p; }  // cache it for this session
  return p;
}

/* ── BUY — calls simulator inline, no page redirect ── */
window._hmExecuteBuy = async function() {
  if (!_hmToken) return;
  const wallet = window._saWallet || localStorage.getItem("sa_wallet");
  const btn = document.querySelector(".hm-exec-buy");
  if (!wallet) { _hmBtnFeedback(btn, "⚠ No wallet connected"); return; }
  const amount = parseFloat(document.getElementById("hmBuyAmount")?.value) || 0.1;
  if (amount <= 0) { _hmBtnFeedback(btn, "⚠ Invalid amount"); return; }
  if (!_hmToken.price) { _hmBtnFeedback(btn, "⚠ Token price unavailable"); return; }

  _hmBtnFeedback(btn, "⏳ Buying…", 15000); // long timeout — override below
  try {
    const solPrice = await _hmGetSolPrice();
    if (!solPrice) { btn.disabled = false; _hmBtnFeedback(btn, "⚠ SOL price unavailable — retry", 3000); return; }
    const r = await fetch(HM_SIM_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action:    "buy",
        wallet,
        mint:      _hmToken.mint,
        symbol:    _hmToken.symbol || "?",
        name:      _hmToken.name  || _hmToken.symbol || "Unknown",
        logo:      _hmToken.logo  || null,
        priceUsd:  _hmToken.price,
        solAmount: amount,
        slippage:  1,
        riskScore: _hmToken.riskScore ?? 50,
        solPrice,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const d = await r.json();
    if (d.ok || d.profile) {  // d.profile as safety fallback if ok field missing
      _hmSimProfile = d.profile;
      _hmUpdateSellPanel();
      _hmRenderBalance();
      btn.disabled = false;
      const badgeTxt = d.newBadges?.length ? ` 🏆 ${d.newBadges.length} badge!` : "";
      _hmBtnFeedback(btn, `✅ Bought ${amount} S2M!${badgeTxt}`, 3000);
    } else {
      btn.disabled = false;
      _hmBtnFeedback(btn, `❌ ${(d.error || "Failed").slice(0, 30)}`, 3500);
    }
  } catch (err) {
    btn.disabled = false;
    _hmBtnFeedback(btn, "❌ Network error", 3000);
  }
};

/* ── SELL — calls simulator inline, no page redirect ── */
window._hmExecuteSell = async function() {
  if (!_hmToken) return;
  const wallet = window._saWallet || localStorage.getItem("sa_wallet");
  const btn = document.querySelector(".hm-exec-sell");
  if (!wallet) { _hmBtnFeedback(btn, "⚠ No wallet connected"); return; }
  const h = _hmSimProfile?.holdings?.[_hmToken.mint];
  if (!h || !h.amount) { _hmBtnFeedback(btn, "⚠ No open position"); return; }
  const sellAmt = h.amount * (_hmSellPct / 100);

  _hmBtnFeedback(btn, "⏳ Closing…", 15000);
  try {
    const solPrice = await _hmGetSolPrice();
    if (!solPrice) { btn.disabled = false; _hmBtnFeedback(btn, "⚠ SOL price unavailable — retry", 3000); return; }
    const r = await fetch(HM_SIM_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action:    "sell",
        wallet,
        mint:      _hmToken.mint,
        priceUsd:  _hmToken.price,
        amount:    sellAmt,
        slippage:  1,
        riskScore: _hmToken.riskScore ?? 50,
        solPrice,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const d = await r.json();
    if (d.ok || d.profile) {  // d.profile as safety fallback if ok field missing
      const pnl = d.trade?.pnl ?? null;
      _hmSimProfile = d.profile;
      _hmUpdateSellPanel();
      _hmRenderBalance();
      btn.disabled = false;
      const pnlTxt = pnl != null ? ` (${pnl >= 0 ? "+" : ""}${pnl.toFixed(4)} S2M)` : "";
      _hmBtnFeedback(btn, `✅ Closed${pnlTxt}`, 4000);
    } else {
      btn.disabled = false;
      _hmBtnFeedback(btn, `❌ ${(d.error || "Failed").slice(0, 30)}`, 3500);
    }
  } catch {
    btn.disabled = false;
    _hmBtnFeedback(btn, "❌ Network error", 3000);
  }
};

/* ── Jupiter — open in new tab pre-filled with token + SOL amount ── */
window._hmOpenJupiter = function() {
  if (!_hmToken) return;
  // Pre-fill input amount (from BUY panel) in lamports (1 SOL = 1e9 lamports)
  const solAmt  = parseFloat(document.getElementById("hmBuyAmount")?.value) || 0.1;
  const lamports = Math.round(solAmt * 1_000_000_000);
  // ?ref= is Jupiter's affiliate tracking parameter — earns referral fees on every swap
  const url = `https://jup.ag/swap/SOL-${_hmToken.mint}?inAmount=${lamports}&ref=${JUP_REF}`;
  window.open(url, "_blank", "noopener,noreferrer");
};
/* Keep legacy close functions no-op so no errors if called */
window._hmJupBgClick = function() {};
window._hmCloseJupiter = function() {};

/* ══════════════════════════════════════════════
   NEW PAIRS FILTER MODAL — CSS + LOGIC
══════════════════════════════════════════════ */
(function _injectNpFilterCss() {
  const s = document.createElement("style");
  s.textContent = `
.np-filters-btn { display:flex;align-items:center;gap:6px;padding:7px 14px;border-radius:20px;cursor:pointer;background:rgba(44,255,201,0.08);border:1px solid rgba(44,255,201,0.25);color:#2cffc9;font-size:12px;font-weight:700;letter-spacing:0.4px;transition:all 0.15s;white-space:nowrap; }
.np-filters-btn:hover { background:rgba(44,255,201,0.15);border-color:rgba(44,255,201,0.5); }
.np-filter-count { background:#2cffc9;color:#040d08;border-radius:50%;width:18px;height:18px;font-size:10px;font-weight:900;display:inline-flex;align-items:center;justify-content:center; }
.np-active-summary { display:flex;flex-wrap:wrap;gap:6px;align-items:center;flex:1; }
.np-pill { display:inline-flex;align-items:center;gap:4px;padding:3px 8px 3px 10px;border-radius:20px;background:rgba(44,255,201,0.1);border:1px solid rgba(44,255,201,0.3);color:#2cffc9;font-size:11px;font-weight:700; }
.np-pill-remove { background:none;border:none;color:rgba(44,255,201,0.6);cursor:pointer;font-size:10px;padding:0;line-height:1; }
.np-pill-remove:hover { color:#ff4d6d; }
.np-titlebar { display:flex;align-items:center;gap:10px;padding:10px 16px;flex-wrap:wrap; }
.npf-overlay { position:fixed;inset:0;background:rgba(0,0,0,0.72);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px); }
.npf-modal { background:#0b1f14;border:1px solid rgba(44,255,201,0.18);border-radius:20px;width:min(480px,96vw);box-shadow:0 24px 64px rgba(0,0,0,0.6);animation:npfSlideIn 0.2s ease; }
@keyframes npfSlideIn { from{opacity:0;transform:translateY(-12px) scale(0.97)} to{opacity:1;transform:none} }
.npf-header { display:flex;align-items:center;justify-content:space-between;padding:18px 20px 14px;border-bottom:1px solid rgba(255,255,255,0.06); }
.npf-header-left { display:flex;align-items:center;gap:12px; }
.npf-header-icon { font-size:22px; }
.npf-title { font-size:14px;font-weight:900;color:#cffff4;letter-spacing:0.6px; }
.npf-subtitle { font-size:11px;color:rgba(207,255,244,0.35);margin-top:1px; }
.npf-close { background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);color:rgba(207,255,244,0.5);border-radius:50%;width:30px;height:30px;cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center;transition:all 0.13s; }
.npf-close:hover { background:rgba(255,77,109,0.15);border-color:rgba(255,77,109,0.3);color:#ff4d6d; }
.npf-body { padding:16px 20px 4px;max-height:70vh;overflow-y:auto; }
.npf-group { margin-bottom:14px; }
.npf-group-label { font-size:11px;font-weight:800;color:rgba(207,255,244,0.45);letter-spacing:0.8px;text-transform:uppercase;margin-bottom:8px; }
.npf-options { display:flex;flex-wrap:wrap;gap:7px; }
.npf-opt { padding:7px 14px;border-radius:20px;cursor:pointer;font-size:12px;font-weight:700;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);color:rgba(207,255,244,0.5);transition:all 0.13s; }
.npf-opt:hover { background:rgba(255,255,255,0.08);color:rgba(207,255,244,0.85); }
.npf-opt.active { background:rgba(44,255,201,0.12);border-color:rgba(44,255,201,0.4);color:#2cffc9; }
.npf-opt.active-all { background:rgba(255,255,255,0.06);border-color:rgba(255,255,255,0.15);color:rgba(207,255,244,0.7); }
.npf-divider { height:1px;background:rgba(255,255,255,0.05);margin:6px 0 14px; }
.npf-footer { display:flex;gap:10px;padding:14px 20px 18px;border-top:1px solid rgba(255,255,255,0.06); }
.npf-apply-btn { flex:1;padding:12px 0;border-radius:12px;cursor:pointer;background:linear-gradient(135deg,rgba(44,255,201,0.25),rgba(44,255,201,0.12));border:1px solid rgba(44,255,201,0.4);color:#2cffc9;font-size:14px;font-weight:800;letter-spacing:0.3px;transition:all 0.15s; }
.npf-apply-btn:hover { background:linear-gradient(135deg,rgba(44,255,201,0.38),rgba(44,255,201,0.2));box-shadow:0 0 20px rgba(44,255,201,0.2); }
.npf-reset-btn { padding:12px 18px;border-radius:12px;cursor:pointer;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);color:rgba(207,255,244,0.4);font-size:12px;font-weight:700;transition:all 0.13s; }
.npf-reset-btn:hover { background:rgba(255,77,109,0.08);border-color:rgba(255,77,109,0.25);color:#ff4d6d; }
.npf-risk-group { margin-top:2px; }
.npf-risk-toggle-row { display:flex;gap:10px;margin-top:4px; }
.npf-risk-btn { flex:1;padding:11px 10px;border-radius:12px;cursor:pointer;background:rgba(255,255,255,0.04);border:1.5px solid rgba(255,255,255,0.1);color:rgba(207,255,244,0.5);font-size:13px;font-weight:700;transition:all 0.15s;text-align:center; }
.npf-risk-btn:hover { border-color:rgba(255,255,255,0.2);color:rgba(207,255,244,0.8); }
.npf-risk-btn.npf-risk-yes { background:linear-gradient(135deg,rgba(255,180,50,0.18),rgba(255,100,0,0.1));border-color:rgba(255,180,50,0.5);color:#ffb432;box-shadow:0 0 12px rgba(255,180,50,0.15); }
.npf-risk-btn.npf-risk-no { background:linear-gradient(135deg,rgba(44,255,201,0.15),rgba(44,255,201,0.07));border-color:rgba(44,255,201,0.4);color:#2cffc9;box-shadow:0 0 12px rgba(44,255,201,0.12); }
.npf-risk-hint { margin-top:7px;font-size:11px;color:rgba(207,255,244,0.35);font-weight:600;letter-spacing:0.2px; }
.np-pagination { display:flex;align-items:center;justify-content:center;gap:14px;padding:14px 0 4px;flex-wrap:wrap; }
.np-page-btn { padding:7px 18px;border-radius:10px;cursor:pointer;background:rgba(44,255,201,0.08);border:1.5px solid rgba(44,255,201,0.25);color:#2cffc9;font-size:13px;font-weight:700;transition:all 0.15s; }
.np-page-btn:hover:not([disabled]) { background:rgba(44,255,201,0.18);border-color:rgba(44,255,201,0.5); }
.np-page-btn[disabled] { opacity:0.28;cursor:default;pointer-events:none; }
.np-page-info { font-size:12px;color:rgba(207,255,244,0.45);font-weight:600;letter-spacing:0.2px; }
  `;
  document.head.appendChild(s);
})();

function _npUpdateFilterBadge() {
  const countEl   = document.getElementById("npFilterCount");
  const summaryEl = document.getElementById("npActiveSummary");
  if (!countEl || !summaryEl) return;
  const active = [];
  if (_npWindow !== "newest") {
    const lbl = { "1h": "1H", "6h": "6H", "24h": "24H" }[_npWindow] || _npWindow.toUpperCase();
    active.push({ key: "window", label: "Listed: " + lbl });
  }
  if (_npMinLiq !== 5000) {
    const lbl = _npMinLiq >= 100000 ? "$100K+" : _npMinLiq >= 50000 ? "$50K+" : _npMinLiq >= 25000 ? "$25K+" : _npMinLiq >= 10000 ? "$10K+" : "$5K+";
    active.push({ key: "liq", label: "Liq: " + lbl });
  }
  if (_npVolFilter !== "all") {
    const lbl = { low: "Vol <$10K", mid: "Vol $10K–$100K", high: "Vol >$100K" }[_npVolFilter];
    active.push({ key: "vol", label: lbl });
  }
  if (_npMcapFilter !== "all") {
    const lbl = { micro: "MCap <$30K", small: "MCap $30K–$100K", mid: "MCap $100K–$500K" }[_npMcapFilter];
    active.push({ key: "mcap", label: lbl });
  }
  if (_npHolderFilter !== "all") {
    const lbl = { tiny: "Holders <100", low: "Holders 100–1K", mid: "Holders 1K–5K", high: "Holders >5K" }[_npHolderFilter];
    active.push({ key: "holders", label: lbl });
  }
  if (!_npShowHighRisk) { active.push({ key: "risk", label: "🛡 Safe Only" }); }
  if (_npSortBy !== "newest") {
    const lbl = { vol: "🔥 Sort: Volume", liq: "💧 Sort: Liquidity", hotness: "⚡ Sort: Hottest" }[_npSortBy] || _npSortBy;
    active.push({ key: "sortby", label: lbl });
  }
  const count = active.length;
  countEl.textContent = count > 0 ? count : "";
  countEl.style.display = count > 0 ? "" : "none";
  summaryEl.innerHTML = active.map(a =>
    `<span class="np-pill">${a.label}<button class="np-pill-remove" onclick="event.stopPropagation();_npRemoveFilter('${a.key}')" title="Remove">✕</button></span>`
  ).join("");
}

window._npRemoveFilter = function(key) {
  if (key === "window")  _npWindow = "newest";
  if (key === "liq")     _npMinLiq = 5000;
  if (key === "vol")     _npVolFilter = "all";
  if (key === "mcap")    _npMcapFilter = "all";
  if (key === "holders") _npHolderFilter = "all";
  if (key === "risk")    _npShowHighRisk = true;
  if (key === "sortby")  { _npSortBy = "newest"; _npSortCol = null; }
  if (key === "window" || key === "liq") loadNewPairs(_npWindow, _npMinLiq);
  else _npApplyAllClientFilters();
};

window.openNpFilters = function() {
  document.getElementById("npfOverlay")?.remove();
  let tmpWindow   = _npWindow;
  let tmpMinLiq   = _npMinLiq;
  let tmpVol      = _npVolFilter;
  let tmpMcap     = _npMcapFilter;
  let tmpHolders  = _npHolderFilter;
  let tmpHighRisk = _npShowHighRisk;
  let tmpSortBy   = _npSortBy;

  function optRow(gid, opts, cur) {
    return opts.map(o =>
      `<button class="npf-opt${o.val === cur ? (o.val === "all" ? " active active-all" : " active") : ""}" data-group="${gid}" data-val="${o.val}">${o.label}</button>`
    ).join("");
  }

  const overlay = document.createElement("div");
  overlay.id = "npfOverlay";
  overlay.className = "npf-overlay";
  overlay.innerHTML = `
    <div class="npf-modal">
      <div class="npf-header">
        <div class="npf-header-left">
          <div class="npf-header-icon">⚗️</div>
          <div><div class="npf-title">NEW PAIRS FILTERS</div><div class="npf-subtitle">Solana · Live data · Client-side filtering</div></div>
        </div>
        <button class="npf-close" onclick="document.getElementById('npfOverlay').remove()">✕</button>
      </div>
      <div class="npf-body">
        <div class="npf-group">
          <div class="npf-group-label">⏱ Listed In</div>
          <div class="npf-options">${optRow("window",[{val:"newest",label:"🆕 Newest"},{val:"1h",label:"1H"},{val:"6h",label:"6H"},{val:"24h",label:"24H"}],tmpWindow)}</div>
        </div>
        <div class="npf-divider"></div>
        <div class="npf-group">
          <div class="npf-group-label">💧 Min Liquidity</div>
          <div class="npf-options">${optRow("liq",[{val:"0",label:"Any"},{val:"5000",label:"$5K+"},{val:"10000",label:"$10K+"},{val:"25000",label:"$25K+"},{val:"50000",label:"$50K+"},{val:"100000",label:"$100K+"}],String(tmpMinLiq))}</div>
        </div>
        <div class="npf-divider"></div>
        <div class="npf-group">
          <div class="npf-group-label">📈 Sort By</div>
          <div class="npf-options">${optRow("sortby",[{val:"newest",label:"🆕 Newest"},{val:"vol",label:"🔥 Volume"},{val:"liq",label:"💧 Liquidity"},{val:"hotness",label:"⚡ Hottest"}],tmpSortBy)}</div>
        </div>
        <div class="npf-divider"></div>
        <div class="npf-group">
          <div class="npf-group-label">📊 Volume 24H</div>
          <div class="npf-options">${optRow("vol",[{val:"all",label:"All"},{val:"low",label:"＜$10K"},{val:"mid",label:"$10K–$100K"},{val:"high",label:"＞$100K"}],tmpVol)}</div>
        </div>
        <div class="npf-divider"></div>
        <div class="npf-group">
          <div class="npf-group-label">🏦 Market Cap (FDV)</div>
          <div class="npf-options">${optRow("mcap",[{val:"all",label:"All"},{val:"micro",label:"＜$30K"},{val:"small",label:"$30K–$100K"},{val:"mid",label:"$100K–$500K"}],tmpMcap)}</div>
        </div>
        <div class="npf-divider"></div>
        <div class="npf-group">
          <div class="npf-group-label">👥 Holders</div>
          <div class="npf-options">${optRow("holders",[{val:"all",label:"All"},{val:"tiny",label:"＜100"},{val:"low",label:"100–1K"},{val:"mid",label:"1K–5K"},{val:"high",label:"＞5K"}],tmpHolders)}</div>
        </div>
        <div class="npf-divider"></div>
        <div class="npf-group npf-risk-group">
          <div class="npf-group-label">⚠️ Show HIGH Risk Tokens?</div>
          <div class="npf-risk-toggle-row">
            <button class="npf-risk-btn${tmpHighRisk ? " npf-risk-yes" : ""}" id="npfRiskYes">🚀 YES — I love risk</button>
            <button class="npf-risk-btn${!tmpHighRisk ? " npf-risk-no" : ""}" id="npfRiskNo">🛡 NO — Play safe</button>
          </div>
          <div class="npf-risk-hint" id="npfRiskHint">${tmpHighRisk ? "⚡ Showing all tokens including HIGH risk" : "🛡 HIGH risk tokens are hidden"}</div>
        </div>
      </div>
      <div class="npf-footer">
        <button class="npf-reset-btn" id="npfResetBtn">Reset All</button>
        <button class="npf-apply-btn" id="npfApplyBtn">✅ Apply Filters</button>
      </div>
    </div>`;

  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
  overlay.addEventListener("click", e => {
    const btn = e.target.closest(".npf-opt");
    if (!btn) return;
    const group = btn.dataset.group, val = btn.dataset.val;
    overlay.querySelectorAll(`.npf-opt[data-group="${group}"]`).forEach(b => b.classList.remove("active","active-all"));
    btn.classList.add("active");
    if (val === "all") btn.classList.add("active-all");
    if (group === "window")  tmpWindow  = val;
    if (group === "liq")     tmpMinLiq  = parseInt(val, 10);
    if (group === "vol")     tmpVol     = val;
    if (group === "mcap")    tmpMcap    = val;
    if (group === "holders") tmpHolders = val;
    if (group === "sortby")  tmpSortBy  = val;
  });
  overlay.querySelector("#npfRiskYes").addEventListener("click", () => {
    tmpHighRisk = true;
    overlay.querySelector("#npfRiskYes").classList.add("npf-risk-yes");
    overlay.querySelector("#npfRiskNo").classList.remove("npf-risk-no");
    overlay.querySelector("#npfRiskHint").textContent = "⚡ Showing all tokens including HIGH risk";
  });
  overlay.querySelector("#npfRiskNo").addEventListener("click", () => {
    tmpHighRisk = false;
    overlay.querySelector("#npfRiskNo").classList.add("npf-risk-no");
    overlay.querySelector("#npfRiskYes").classList.remove("npf-risk-yes");
    overlay.querySelector("#npfRiskHint").textContent = "🛡 HIGH risk tokens are hidden";
  });
  overlay.querySelector("#npfResetBtn").addEventListener("click", () => {
    tmpWindow = "newest"; tmpMinLiq = 5000; tmpVol = "all"; tmpMcap = "all"; tmpHolders = "all"; tmpHighRisk = true; tmpSortBy = "newest"; _npSortCol = null;
    overlay.querySelectorAll(".npf-opt").forEach(b => {
      b.classList.remove("active","active-all");
      if (b.dataset.val === "all") b.classList.add("active","active-all");
    });
    overlay.querySelectorAll(".npf-opt[data-val=\"6h\"]").forEach(b => b.classList.add("active"));
    overlay.querySelectorAll(".npf-opt[data-val=\"5000\"]").forEach(b => b.classList.add("active"));
    overlay.querySelector("#npfRiskYes").classList.add("npf-risk-yes");
    overlay.querySelector("#npfRiskNo").classList.remove("npf-risk-no");
    overlay.querySelector("#npfRiskHint").textContent = "⚡ Showing all tokens including HIGH risk";
  });
  overlay.querySelector("#npfApplyBtn").addEventListener("click", () => {
    const serverChanged = tmpWindow !== _npWindow || tmpMinLiq !== _npMinLiq;
    _npWindow = tmpWindow; _npMinLiq = tmpMinLiq; _npVolFilter = tmpVol;
    _npMcapFilter = tmpMcap; _npHolderFilter = tmpHolders; _npShowHighRisk = tmpHighRisk;
    _npSortBy = tmpSortBy;
    _npSortCol = null; // clear column sort when filter modal preset is applied
    overlay.remove();
    if (serverChanged) loadNewPairs(_npWindow, _npMinLiq);
    else _npApplyAllClientFilters();
  });
  document.body.appendChild(overlay);
};

/* ══════════════════════════════════════════════
   NAVIGATION HELPERS
══════════════════════════════════════════════ */
window.homeGoToScan = function(mint) {
  localStorage.setItem("s2m_prefill_mint", mint);
  window.location.href = "risk-scanner.html";
};
window.homeGoToApe = function(mint) {
  localStorage.setItem("s2m_sa_mint", mint);
  window.location.href = "safe-ape.html";
};
window.goToScan    = window.homeGoToScan;
window.goToSafeApe = window.homeGoToApe;

/* ══════════════════════════════════════════════
   SMART MONEY — FETCH & RENDER
══════════════════════════════════════════════ */
function _smStopRefresh() {
  if (_smRefreshTimer) { clearTimeout(_smRefreshTimer); _smRefreshTimer = null; }
}
function _smScheduleRefresh() {
  _smStopRefresh();
  _smRefreshTimer = setTimeout(() => { loadSmartMoney(); _smScheduleRefresh(); }, SM_REFRESH_MS);
}

/* Inject Force Scan + debug button into SM titlebar (once) */
function _smInjectControls() {
  const statsRow = document.querySelector("#tgSmartMoneyView .sm-stats-row");
  if (!statsRow || statsRow.querySelector(".sm-force-scan-btn")) return;

  const btn = document.createElement("button");
  btn.className   = "sm-force-scan-btn";
  btn.textContent = "↻ Force Scan";
  btn.title       = "Manually trigger detection (useful on localhost)";
  btn.onclick     = _smForceScan;
  statsRow.appendChild(btn);
}

async function _smForceScan() {
  const btn = document.querySelector(".sm-force-scan-btn");
  if (btn) { btn.textContent = "Scanning…"; btn.disabled = true; }

  async function safeFetch(url, label, timeout = 28_000) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(timeout) });
      const text = await r.text();
      try { return { ok: r.ok, data: JSON.parse(text) }; }
      catch { return { ok: false, data: null, raw: text.slice(0, 120) }; }
    } catch (e) { return { ok: false, data: null, raw: e.message }; }
  }

  try {
    /* Single call to scanNow — regular HTTP function, works on localhost */
    _smShowToast("🧠 Scanning Birdeye for smart money entries…", "ok");
    const scan = await safeFetch("/.netlify/functions/scanNow", "scanNow", 28_000);
    console.info("[scanNow]", scan.data || scan.raw);

    if (!scan.ok || !scan.data?.ok) {
      _smShowToast(`⚠️ Scan error: ${scan.raw || scan.data?.error || "unknown"}`, "err");
      return;
    }

    const { processed = 0, inserted = 0, tokens_found = 0, msg = "" } = scan.data;
    if (inserted > 0) {
      _smShowToast(`✅ Found ${inserted} early buyer signal${inserted !== 1 ? "s" : ""} from ${processed} token${processed !== 1 ? "s" : ""}!`, "ok");
    } else if (tokens_found > 0) {
      _smShowToast(`ℹ️ ${msg}`, "ok");
    } else {
      _smShowToast(`ℹ️ No tokens created in the last 20 min found. Solana might be quiet right now — try again shortly.`, "ok");
    }

    /* 4. Reload feed */
    await loadSmartMoney();
  } catch (err) {
    _smShowToast(`⚠️ ${err.message}`, "err");
  } finally {
    if (btn) { btn.textContent = "↻ Force Scan"; btn.disabled = false; }
  }
}

function _smShowToast(msg, type = "ok") {
  let t = document.getElementById("smToast");
  if (!t) {
    t = document.createElement("div");
    t.id = "smToast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className   = `sm-toast sm-toast-${type} sm-toast-show`;
  clearTimeout(t._timer);
  const ms = type === "err" ? 9000 : msg.length > 80 ? 8000 : 5000;
  t._timer = setTimeout(() => t.classList.remove("sm-toast-show"), ms);
}

async function loadSmartMoney() {
  const feedEl    = document.getElementById("smFeed");
  const loadingEl = document.getElementById("smLoading");
  const emptyEl   = document.getElementById("smEmpty");
  if (!feedEl) return;

  _smInjectControls(); // add Force Scan button if not already there

  if (loadingEl) loadingEl.style.display = "";
  if (emptyEl)   emptyEl.style.display   = "none";
  // Clear previous cards (keep loading spinner)
  feedEl.querySelectorAll(".sm-card").forEach(c => c.remove());

  try {
    const res = await fetch(SM_API, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Unknown error");

    if (loadingEl) loadingEl.style.display = "none";

    // Update stat pills
    _smUpdateStats(data.stats, data.ts);

    // Render top wallets sidebar
    _smRenderWallets(data.top_wallets || []);

    // Render feed cards
    if (!data.feed || !data.feed.length) {
      if (emptyEl) {
        emptyEl.style.display = "";
        // Show diagnostic hint on localhost
        const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
        const subEl   = emptyEl.querySelector(".sm-empty-sub");
        if (subEl) {
          subEl.innerHTML = isLocal
            ? `Running on localhost — cron doesn't auto-fire here.<br>
               Hit <strong>↻ Force Scan</strong> above to trigger detection manually.`
            : `Feed updates every 2 minutes as new pairs launch`;
        }
      }
      return;
    }
    for (const token of data.feed) {
      const card = _smBuildCard(token);
      feedEl.insertBefore(card, loadingEl);
    }
  } catch (err) {
    if (loadingEl) loadingEl.style.display = "none";
    if (emptyEl) {
      emptyEl.style.display = "";
      const sub = emptyEl.querySelector(".sm-empty-sub");
      if (sub) sub.textContent = "Failed to load — retrying in 2 min";
    }
    console.warn("loadSmartMoney error:", err.message);
  }
}

function _smUpdateStats(stats, ts) {
  const tokensEl  = document.getElementById("smStatTokens");
  const walletsEl = document.getElementById("smStatWallets");
  const updateEl  = document.getElementById("smStatUpdate");
  if (tokensEl)  tokensEl.textContent  = `${stats?.total_tokens  || 0} signals today`;
  if (walletsEl) walletsEl.textContent = `${stats?.active_wallets || 0} wallets tracked`;
  if (updateEl)  updateEl.textContent  = ts ? `Updated ${_smRelTime(ts)}` : "Just updated";
}

function _smRelTime(ms) {
  const diff = Math.floor((Date.now() - ms) / 1000);
  if (diff < 10)  return "just now";
  if (diff < 60)  return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function _smCategoryIcon(cat) {
  if (cat === "sniper"   || cat === "smart") return "🎯";
  if (cat === "whale")                       return "🐋";
  if (cat === "kol")                         return "📢";
  if (cat === "alpha")                       return "⭐";
  if (cat === "watching")                    return "👁";
  if (cat === "new")                         return "🆕";
  return "🧠";
}
function _smCategoryLabel(cat) {
  if (cat === "sniper"   || cat === "smart") return "Smart";
  if (cat === "whale")                       return "Whale";
  if (cat === "kol")                         return "KOL";
  if (cat === "alpha")                       return "Alpha";
  if (cat === "watching")                    return "Tracking";
  if (cat === "new")                         return "New";
  return "Alpha";
}
function _smWinRateColor(rate, cat) {
  if (cat === "new" || cat === "tracking")   return "#4a7a6a";
  if (rate >= 70) return "#2cffc9";
  if (rate >= 55) return "#ffb432";
  if (rate > 0)   return "#ff4d6d";
  return "#4a7a6a";
}
function _smShortAddr(addr) {
  if (!addr) return "—";
  return addr.slice(0, 4) + "…" + addr.slice(-4);
}
function _smFmtSol(n) {
  if (!n) return "—";
  return parseFloat(n).toFixed(2) + " S2M";
}
function _smAgeFmt(secs) {
  if (secs <= 0)  return "at launch";
  if (secs < 60)  return `${secs}s after launch`;
  return `${Math.floor(secs / 60)}m after launch`;
}

function _smRenderWallets(wallets) {
  const el = document.getElementById("smWalletList");
  if (!el) return;
  if (!wallets.length) { el.innerHTML = `<div class="sm-wallet-empty">No wallets yet — run initSmartMoney</div>`; return; }
  el.innerHTML = wallets.map(w => {
    const color = _smWinRateColor(w.win_rate, w.category);
    const pct   = Math.round(w.win_rate);
    const barW  = Math.min(100, pct);
    return `
      <div class="sm-wallet-row" data-wallet="${w.wallet}" title="Open Whale DNA →">
        <div class="sm-wallet-icon">${_smCategoryIcon(w.category)}</div>
        <div class="sm-wallet-info">
          <div class="sm-wallet-label">${w.label}</div>
          <div class="sm-wallet-addr">${_smShortAddr(w.wallet)}</div>
        </div>
        <div class="sm-wallet-stats">
          <div class="sm-wallet-rate" style="color:${color}">${pct}%</div>
          <div class="sm-win-bar-bg"><div class="sm-win-bar-fill" style="width:${barW}%;background:${color}"></div></div>
          <div class="sm-wallet-record">${w.wins}W / ${w.losses}L</div>
        </div>
        <div class="sm-wallet-dna-arrow">🧬</div>
      </div>`;
  }).join("");

  // Click → open Whale DNA pre-filled with wallet address
  el.querySelectorAll(".sm-wallet-row[data-wallet]").forEach(row => {
    row.addEventListener("click", () => {
      const addr = row.dataset.wallet;
      if (!addr) return;
      localStorage.setItem("s2m_prefill_whale", addr);
      window.location.href = "whale-dna.html";
    });
  });
}

function _smBuildCard(token) {
  const wrap = document.createElement("div");
  wrap.className = "sm-card sm-card--collapsed";

  const mint    = token.mint    || "";
  const symbol  = token.symbol  || "?";
  const name    = token.name    || "Unknown";
  const logoUrl = token.logo_uri
    ? `/.netlify/functions/logoProxy?url=${encodeURIComponent(token.logo_uri)}`
    : "https://placehold.co/38x38/0a2a1e/2cffc9?text=?";
  const timeAgo    = _smRelTime(token.detected_at);
  const count      = token.smart_count || 1;
  const totalSol   = _smFmtSol(token.total_smart_sol);
  const avgWin     = Math.round(token.avg_win_rate || 0);
  const avgWinColor = _smWinRateColor(avgWin);

  // Wallet rows — show smart/alpha/whale/kol first, then watching, then new
  const sortedWallets = [...(token.wallets || [])].sort((a, b) => {
    const rank = { sniper: 5, smart: 5, alpha: 4, whale: 4, kol: 4, watching: 2, new: 1, tracking: 1 };
    return (rank[b.category] || 1) - (rank[a.category] || 1);
  });
  const walletRows = sortedWallets.map(w => {
    const color = _smWinRateColor(w.win_rate, w.category);
    const barW  = Math.min(100, Math.round(w.win_rate));
    const isNew = w.category === "new" || w.category === "tracking";
    const solscanUrl = w.sig ? `https://solscan.io/tx/${w.sig}` : null;
    const winRateHtml = isNew
      ? `<span class="sm-cw-rate sm-cw-rate-new">Building…</span>`
      : `<span class="sm-cw-rate" style="color:${color}">${Math.round(w.win_rate)}% WR</span>
         <div class="sm-win-bar-bg sm-cw-bar"><div class="sm-win-bar-fill" style="width:${barW}%;background:${color}"></div></div>`;
    return `
      <div class="sm-card-wallet${isNew ? " sm-card-wallet-new" : ""}">
        <div class="sm-cw-icon">${_smCategoryIcon(w.category)}</div>
        <div class="sm-cw-body">
          <div class="sm-cw-top">
            <span class="sm-cw-label">${w.label}</span>
            <span class="sm-cw-cat sm-cw-cat-${w.category}">${_smCategoryLabel(w.category)}</span>
            ${winRateHtml}
          </div>
          <div class="sm-cw-bottom">
            <span class="sm-cw-bought">Bought <strong>${_smFmtSol(w.buy_sol)}</strong></span>
            <span class="sm-cw-age">· ${_smAgeFmt(w.age_secs)}</span>
            ${solscanUrl ? `<a class="sm-cw-tx" href="${solscanUrl}" target="_blank" rel="noopener">↗ tx</a>` : ""}
          </div>
        </div>
      </div>`;
  }).join("");

  // Action: Jupiter copy trade + Risk Scan
  const jupUrl  = `https://jup.ag/swap/SOL-${mint}?referral=${JUP_REF}`;

  wrap.innerHTML = `
    <div class="sm-card-header">
      <img class="sm-card-logo" src="${logoUrl}" alt="${symbol}"
        onerror="this.src='https://placehold.co/38x38/0a2a1e/2cffc9?text=?'" referrerpolicy="no-referrer" />
      <div class="sm-card-token-info">
        <div class="sm-card-symbol">${symbol}
          <span class="sm-card-name">${name}</span>
        </div>
        <div class="sm-card-mint" title="${mint}">${_smShortAddr(mint)}</div>
      </div>
      <div class="sm-card-meta">
        <span class="sm-card-count">${count} smart wallet${count > 1 ? "s" : ""}</span>
        <span class="sm-card-time">${timeAgo}</span>
        <span class="sm-card-avg-wr" style="color:${avgWinColor}">avg ${avgWin}% WR</span>
        <span class="sm-card-total-inline">💰 <strong>${totalSol}</strong></span>
      </div>
      <div class="sm-card-chevron">▾</div>
    </div>

    <div class="sm-card-body">
      <div class="sm-card-wallets">
        ${walletRows || '<div class="sm-card-no-wallets">No wallet details available</div>'}
      </div>
      <div class="sm-card-footer">
        <div class="sm-card-actions">
          <a class="sm-btn sm-btn-scan" href="risk-scanner.html" onclick="localStorage.setItem('s2m_prefill_mint','${mint}')">🔍 Risk Scan</a>
          <a class="sm-btn sm-btn-copy" href="${jupUrl}" target="_blank" rel="noopener">⚡ Copy Trade</a>
        </div>
      </div>
    </div>`;

  // Toggle expand/collapse on header click
  wrap.querySelector(".sm-card-header").addEventListener("click", (e) => {
    // Don't collapse if user clicked a link inside the header
    if (e.target.closest("a")) return;
    wrap.classList.toggle("sm-card--collapsed");
  });

  return wrap;
}

/* ══════════════════════════════════════════════
   INIT
══════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", () => {
  renderNav();

  const modeTabs = document.getElementById("tgModeTabs");
  if (modeTabs) {
    modeTabs.addEventListener("click", e => {
      const btn = e.target.closest(".tg-mode-btn");
      if (!btn) return;
      const mode = btn.dataset.mode;
      if (mode === _mode) return;
      _mode = mode;
      modeTabs.querySelectorAll(".tg-mode-btn").forEach(b => b.classList.remove("tg-mode-active"));
      btn.classList.add("tg-mode-active");
      const gainersView  = document.getElementById("tgGainersView");
      const newPairsView = document.getElementById("tgNewPairsView");
      const smView       = document.getElementById("tgSmartMoneyView");
      if (mode === "bubbles") {
        // Bubble map opens as a modal overlay — don't change the tab views
        // Reset tab highlight back to gainers immediately (modal is independent)
        modeTabs.querySelectorAll(".tg-mode-btn").forEach(b => b.classList.remove("tg-mode-active"));
        modeTabs.querySelector('[data-mode="gainers"]')?.classList.add("tg-mode-active");
        _mode = "gainers";
        window.openBubbleMap?.("24h");
        return;
      } else if (mode === "gainers") {
        if (gainersView)  gainersView.style.display  = "";
        if (newPairsView) newPairsView.style.display = "none";
        if (smView)       smView.style.display       = "none";
        _npStopRefresh();
        _smStopRefresh();
      } else if (mode === "smartmoney") {
        if (gainersView)  gainersView.style.display  = "none";
        if (newPairsView) newPairsView.style.display = "none";
        if (smView)       smView.style.display       = "";
        _npStopRefresh();
        loadSmartMoney();
        _smScheduleRefresh();
      } else {
        if (gainersView)  gainersView.style.display  = "none";
        if (newPairsView) newPairsView.style.display = "";
        if (smView)       smView.style.display       = "none";
        _smStopRefresh();
        loadNewPairs(_npWindow, _npMinLiq);
        _npScheduleRefresh();
      }
    });
  }

  const tabs = document.getElementById("tgTfTabs");
  if (tabs) {
    tabs.addEventListener("click", e => {
      const btn = e.target.closest(".tg-tf-btn");
      if (!btn) return;
      tabs.querySelectorAll(".tg-tf-btn").forEach(b => b.classList.remove("tg-tf-active"));
      btn.classList.add("tg-tf-active");
      if (_refreshTimer) clearTimeout(_refreshTimer);
      loadGainers(btn.dataset.tf).then(scheduleRefresh);
    });
  }

  document.getElementById("tgPrevBtn")?.addEventListener("click", () => {
    if (_page > 1) { _page--; renderTable(); window.scrollTo({ top: 0, behavior: "smooth" }); }
  });
  document.getElementById("tgNextBtn")?.addEventListener("click", () => {
    const pages = Math.ceil(_allTokens.length / PER_PAGE);
    if (_page < pages) { _page++; renderTable(); window.scrollTo({ top: 0, behavior: "smooth" }); }
  });

  document.getElementById("tgRetryBtn")?.addEventListener("click", () => loadGainers(_tf));
  document.getElementById("npRetryBtn")?.addEventListener("click", () => loadNewPairs(_npWindow, _npMinLiq));

  const tfBar = document.getElementById("hmChartTfBar");
  if (tfBar) {
    tfBar.addEventListener("click", e => {
      const btn = e.target.closest(".hm-chart-tf-btn");
      if (!btn) return;
      _hmLoadChart(btn.dataset.tf);
    });
  }

  // Sell % buttons — use document-level delegation so it always fires
  document.addEventListener("click", e => {
    const btn = e.target.closest(".hm-pct-btn");
    if (!btn) return;
    document.querySelectorAll(".hm-pct-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    _hmSellPct = parseInt(btn.dataset.pct, 10);
    _hmUpdateSellPanel(); // immediately reflect new partial amount in estimate
  });

  document.getElementById("hmBuyAmount")?.addEventListener("input", _hmUpdateBuyEst);

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      if (document.getElementById("hmChartModal")?.style.display !== "none") window.closeHomeChart();
      document.getElementById("npfOverlay")?.remove();
    }
  });

  // ── Gainers column sort ──
  document.querySelector("#tgTable thead")?.addEventListener("click", e => {
    const th = e.target.closest("[data-sort]");
    if (!th) return;
    const col = th.dataset.sort;
    if (_tgSortCol === col) {
      _tgSortDir = _tgSortDir === "desc" ? "asc" : "desc"; // toggle direction
    } else {
      _tgSortCol = col;
      _tgSortDir = "desc"; // first click always high → low
    }
    _page = 1;
    renderTable();
  });

  // ── New Pairs column sort ──
  document.querySelector("#npTable thead")?.addEventListener("click", e => {
    const th = e.target.closest("[data-sort]");
    if (!th) return;
    const col = th.dataset.sort;
    if (_npSortCol === col) {
      _npSortDir = _npSortDir === "desc" ? "asc" : "desc";
    } else {
      _npSortCol = col;
      _npSortDir = "desc";
    }
    _npCurrentPage = 0;
    _npApplyAllClientFilters();
  });

  // ── Gainers min % gain filter chips ──
  document.getElementById("tgGainFilterBar")?.addEventListener("click", e => {
    const btn = e.target.closest(".tg-gain-btn");
    if (!btn) return;
    document.querySelectorAll(".tg-gain-btn").forEach(b => b.classList.remove("tg-gain-active"));
    btn.classList.add("tg-gain-active");
    _tgMinGainPct = parseInt(btn.dataset.gain, 10) || 0;
    _page = 1;
    renderTable();
  });

  // ── Gainers risk filter toggle ──
  document.getElementById("tgRiskFilterBtn")?.addEventListener("click", function() {
    _tgShowHighRisk = !_tgShowHighRisk;
    this.dataset.active = _tgShowHighRisk ? "false" : "true";
    this.classList.toggle("tg-risk-safe-active", !_tgShowHighRisk);
    this.textContent = _tgShowHighRisk ? "▲ Safe Only" : "◆ Safe Only";
    this.title = _tgShowHighRisk
      ? "Click to hide HIGH risk tokens"
      : "Click to show all tokens including HIGH risk";
    _page = 1;
    renderTable();
  });

  // ── Page-specific initialization ──
  if (_curPage === "gainers.html") {
    startLivePriceTick();
    startSolTicker();
    loadGainers("1h").then(scheduleRefresh);
  } else if (_curPage === "new-pairs.html") {
    startLivePriceTick();
    loadNewPairs(_npWindow, _npMinLiq);
    _npScheduleRefresh();
  } else if (_curPage === "smart-money.html") {
    loadSmartMoney();
    _smScheduleRefresh();
  } else if (_curPage === "bubbles.html") {
    // Override close to navigate back to home
    const _origClose = window.closeBubbleMap;
    window.closeBubbleMap = function() {
      _origClose?.();
      window.location.href = "index.html";
    };
    window.openBubbleMap?.("24h");
  } else {
    // index.html — hero mode: light stats only
    initHero();
  }
});

/* ══════════════════════════════════════════════
   HERO PAGE — lightweight market stats
══════════════════════════════════════════════ */
let _heroSolTimer = null;

async function initHero() {
  await _heroFetchAll();
  _heroSolTimer = setInterval(_heroFetchSol, 12_000);
}

async function _heroFetchAll() {
  await _heroFetchSol();
  // Gainers stats
  try {
    // min_liq=15000 filters out micro-cap coins (<$15K liquidity) that produce
    // extreme outlier gains (+100,000%) and skew the avg/top-mover stats.
    const res = await fetch(`${GAINERS_API}?tf=1h&min_liq=15000`, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.ok) return;
    const tokens  = data.tokens || [];
    const allChanges = tokens.map(t => t.changes?.h1).filter(v => v != null);
    // Cap at 10,000% for average — outliers above this are micro-cap one-minute pumps
    // that aren't meaningful context for typical traders. Top mover still shows real value.
    const cappedChanges = allChanges.filter(v => v <= 10000);
    const avgChanges    = cappedChanges.length ? cappedChanges : allChanges;
    const avgGain = avgChanges.length ? avgChanges.reduce((a,b) => a+b, 0) / avgChanges.length : 0;
    const topGain = allChanges.length ? Math.max(...allChanges) : 0;
    const vol24   = tokens.reduce((s, t) => s + (t.vol24h || 0), 0);
    _heroSet("hmHeroGainersVal", tokens.length);
    _heroSet("hmHeroAvgGainVal", avgGain > 0 ? "+" + avgGain.toFixed(0) + "%" : "—");
    _heroSet("hmHeroTopGainVal", topGain > 0 ? fmtPct(topGain) : "—");
    _heroSet("hmHeroVolVal", fmtBig(vol24));
  } catch {}
  // New pairs count (lightweight)
  try {
    const res = await fetch(`${NEW_PAIRS_API}?limit=1`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return;
    const data = await res.json();
    const count = data.total || data.count || (Array.isArray(data.tokens) ? data.tokens.length : null);
    if (count != null) _heroSet("hmHeroNewPairsVal", count.toLocaleString());
  } catch {}
}

async function _heroFetchSol() {
  let price = await getSolPriceUsd();
  let change = null;
  if (!price) {
    try {
      const r = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd&include_24hr_change=true",
        { signal: AbortSignal.timeout(5000) }
      );
      if (r.ok) {
        const d = await r.json();
        price  = d?.solana?.usd || 0;
        change = d?.solana?.usd_24h_change ?? null;
      }
    } catch {}
  }
  if (!price) return;
  const valEl = document.getElementById("hmHeroSolVal");
  const chgEl = document.getElementById("hmHeroSolChg");
  if (valEl) valEl.textContent = "$" + price.toFixed(2);
  if (chgEl && change != null) {
    chgEl.textContent = (change >= 0 ? "+" : "") + change.toFixed(2) + "%";
    chgEl.className   = "hm-hero-sol-chg " + (change >= 0 ? "pos" : "neg");
  }
}

function _heroSet(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
