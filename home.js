// home.js – Scan2Moon V2.0 Home Page
import { renderNav } from "./nav.js";
import "./community.js";

/* ══════════════════════════════════════════════
   CONSTANTS
══════════════════════════════════════════════ */
const GAINERS_API  = "/.netlify/functions/topGainers";
const PER_PAGE     = 10;
const AUTO_REFRESH = 90_000; // 90 s — matches Redis TTL

/* ══════════════════════════════════════════════
   STATE
══════════════════════════════════════════════ */
let _tf          = "1h";
let _allTokens   = [];
let _page        = 1;
let _refreshTimer = null;
let _refreshProgress = null;
let _lastUpdated  = 0;

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
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

function riskClass(level) {
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
  return { "30m": "m30", "1h": "h1", "12h": "h12", "24h": "h24" }[tf] || "h1";
}

function logoSrc(url) {
  if (!url) return "https://placehold.co/36x36/0a2a1e/2cffc9?text=?";
  return `/.netlify/functions/logoProxy?url=${encodeURIComponent(url)}`;
}

/* ══════════════════════════════════════════════
   FETCH
══════════════════════════════════════════════ */
async function fetchGainers(tf) {
  showLoading(true);
  hideError();
  try {
    const res = await fetch(`${GAINERS_API}?tf=${tf}&min_liq=10000`, {
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      if (j.error === "quota_exceeded") throw new Error("API quota exceeded — try again shortly.");
      throw new Error(`Server error ${res.status}`);
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
   RENDER TABLE
══════════════════════════════════════════════ */
function renderTable() {
  const tbody = document.getElementById("tgBody");
  const pagination = document.getElementById("tgPagination");
  if (!tbody) return;

  const chKey  = tfChangeKey(_tf);
  const start  = (_page - 1) * PER_PAGE;
  const slice  = _allTokens.slice(start, start + PER_PAGE);
  const total  = _allTokens.length;
  const pages  = Math.ceil(total / PER_PAGE);

  if (!slice.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="tg-empty">No tokens found.</td></tr>`;
    if (pagination) pagination.style.display = "none";
    return;
  }

  tbody.innerHTML = slice.map((tok, idx) => {
    const chVal   = tok.changes?.[chKey];
    const rank    = start + idx + 1;
    const rs      = tok.riskScore ?? 50;
    const rl      = tok.riskLevel || "HIGH";

    return `
    <tr class="tg-row" data-mint="${tok.mint}">
      <td class="tg-td tg-td-rank"><span class="tg-rank">${rank}</span></td>

      <td class="tg-td tg-td-token">
        <div class="tg-token-cell">
          <img
            class="tg-logo"
            src="${logoSrc(tok.logo)}"
            onerror="this.src='https://placehold.co/36x36/0a2a1e/2cffc9?text=?'"
            referrerpolicy="no-referrer"
            alt="${tok.symbol}"
          />
          <div class="tg-token-info">
            <div class="tg-token-name">${tok.name || "Unknown"}</div>
            <div class="tg-token-sym">${tok.symbol || ""}</div>
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
          <span class="tg-score ${scoreClass(rs)}">${rs}</span>
          <span class="tg-risk-pill ${riskClass(rl)}">${rl}</span>
        </div>
      </td>

      <td class="tg-td tg-td-actions">
        <div class="tg-actions">
          <button class="tg-act-btn tg-act-scan" onclick="homeGoToScan('${tok.mint}')" title="Risk Scan">
            🔍
          </button>
          <button class="tg-act-btn tg-act-ape" onclick="homeGoToApe('${tok.mint}')" title="Ape Simulator">
            🦍
          </button>
        </div>
      </td>
    </tr>`;
  }).join("");

  /* pagination */
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
  const changes = tokens.map(t => t.changes?.[chKey]).filter(v => v != null);
  const avgGain = changes.length
    ? (changes.reduce((a, b) => a + b, 0) / changes.length).toFixed(1)
    : 0;
  const topGain = changes.length ? Math.max(...changes).toFixed(1) : 0;

  const secs = Math.floor((Date.now() - updatedAt) / 1000);
  const updStr = secs < 5 ? "just now" : `${secs}s ago`;

  document.getElementById("tgStatGainers").innerHTML =
    `<span class="tg-stat-label">🚀 Tokens</span><span class="tg-stat-val">${tokens.length}</span>`;
  document.getElementById("tgStatAvgGain").innerHTML =
    `<span class="tg-stat-label">📊 Avg gain</span><span class="tg-stat-val tg-chg-pos">+${avgGain}%</span>`;
  document.getElementById("tgStatTopGain").innerHTML =
    `<span class="tg-stat-label">🏆 Top gain</span><span class="tg-stat-val tg-chg-pos">+${topGain}%</span>`;
  document.getElementById("tgStatUpdated").innerHTML =
    `<span class="tg-stat-label">🕐 Updated</span><span class="tg-stat-val">${updStr}</span>`;

  bar.style.display = "flex";
}

/* ══════════════════════════════════════════════
   TF COLUMN HEADER
══════════════════════════════════════════════ */
function updateTfHeader() {
  const th = document.getElementById("tgThChange");
  if (th) th.textContent = _tf.toUpperCase() + " %";
}

/* ══════════════════════════════════════════════
   LOADING / ERROR STATES
══════════════════════════════════════════════ */
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

/* ══════════════════════════════════════════════
   REFRESH RING ANIMATION
══════════════════════════════════════════════ */
function startRefreshRing() {
  const ring = document.getElementById("tgRefreshRing");
  if (!ring) return;
  if (_refreshProgress) clearInterval(_refreshProgress);
  let pct = 0;
  ring.style.setProperty("--tg-ring-pct", "0%");
  _refreshProgress = setInterval(() => {
    pct = Math.min(100, pct + (100 / (AUTO_REFRESH / 500)));
    ring.style.setProperty("--tg-ring-pct", `${pct}%`);
    if (pct >= 100) {
      clearInterval(_refreshProgress);
      _refreshProgress = null;
    }
  }, 500);
}

/* ══════════════════════════════════════════════
   LOAD & DISPLAY
══════════════════════════════════════════════ */
async function loadGainers(tf) {
  _tf   = tf;
  _page = 1;
  updateTfHeader();

  const data = await fetchGainers(tf);
  if (!data) return;

  _allTokens   = data.tokens || [];
  _lastUpdated = data.updatedAt || Date.now();

  renderTable();
  renderStatsBar(_allTokens, _lastUpdated);
  startRefreshRing();
}

/* ══════════════════════════════════════════════
   AUTO REFRESH
══════════════════════════════════════════════ */
function scheduleRefresh() {
  if (_refreshTimer) clearTimeout(_refreshTimer);
  _refreshTimer = setTimeout(() => {
    loadGainers(_tf).then(scheduleRefresh);
  }, AUTO_REFRESH);
}

/* ══════════════════════════════════════════════
   NAVIGATION HELPERS (global)
══════════════════════════════════════════════ */
window.homeGoToScan = function(mint) {
  localStorage.setItem("s2m_prefill_mint", mint);
  window.location.href = "risk-scanner.html";
};

window.homeGoToApe = function(mint) {
  localStorage.setItem("s2m_sa_mint", mint);
  window.location.href = "safe-ape.html";
};

/* kept for backwards compat (dashboard.js uses these names) */
window.goToScan    = window.homeGoToScan;
window.goToSafeApe = window.homeGoToApe;

/* ══════════════════════════════════════════════
   INIT
══════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", () => {
  renderNav();

  /* TF tab clicks */
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

  /* Pagination */
  document.getElementById("tgPrevBtn")?.addEventListener("click", () => {
    if (_page > 1) { _page--; renderTable(); window.scrollTo({ top: 0, behavior: "smooth" }); }
  });
  document.getElementById("tgNextBtn")?.addEventListener("click", () => {
    const pages = Math.ceil(_allTokens.length / PER_PAGE);
    if (_page < pages) { _page++; renderTable(); window.scrollTo({ top: 0, behavior: "smooth" }); }
  });

  /* Retry */
  document.getElementById("tgRetryBtn")?.addEventListener("click", () => loadGainers(_tf));

  /* Initial load */
  loadGainers("1h").then(scheduleRefresh);
});
