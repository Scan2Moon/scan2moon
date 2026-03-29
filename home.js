// home.js – Scan2Moon V2.0 Home Page
import { renderNav } from "./nav.js";
import "./community.js";

/* ===== STORAGE KEY ===== */
const SCANS_KEY = "s2m_last_scans";

/* ===== LOAD SCANS FROM LOCALSTORAGE ===== */
function loadScans() {
  try {
    const raw = localStorage.getItem(SCANS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/* ===== RENDER MINI SCORE CARD ===== */
function getMiniScoreClass(score) {
  if (score >= 65) return "score-good";
  if (score >= 45) return "score-warn";
  return "score-bad";
}

function getBadgeClass(score) {
  if (score >= 65) return "badge-good";
  if (score >= 45) return "badge-warn";
  return "badge-bad";
}

function timeAgo(isoString) {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function renderScans() {
  const container = document.getElementById("lastScansPanel");
  if (!container) return;

  const scans = loadScans();

  if (!scans.length) {
    container.innerHTML = `
      <div class="no-scans-msg">
        <div class="no-scans-icon">🔍</div>
        <div class="no-scans-title">No scans yet</div>
        <div class="no-scans-sub">Head to the <a href="index.html">Risk Scanner</a> and scan your first token!</div>
      </div>
    `;
    return;
  }

  const cardsHTML = scans.map(scan => {
    const scoreClass = getMiniScoreClass(scan.totalScore);
    const badgeClass = getBadgeClass(scan.totalScore);
    const logoUrl = scan.logo
      ? `/.netlify/functions/logoProxy?url=${encodeURIComponent(scan.logo)}`
      : "https://placehold.co/44x44";

    return `
      <div class="mini-score-card" onclick="goToScan('${scan.mint}')">
        <div class="mini-card-top">
          <img
            class="mini-logo"
            src="${logoUrl}"
            onerror="this.src='https://placehold.co/44x44'"
            referrerpolicy="no-referrer"
          />
          <div class="mini-token-info">
            <div class="mini-token-name">${scan.name || "Unknown"}</div>
            <div class="mini-token-symbol">${scan.symbol || ""}</div>
          </div>
          <div class="mini-scan-time">${timeAgo(scan.scannedAt)}</div>
        </div>

        <div class="mini-score-row">
          <div>
            <span class="mini-score-number ${scoreClass}">${scan.totalScore ?? "N/A"}</span>
            <span class="mini-score-max">/100</span>
          </div>
          <div class="mini-risk-badge ${badgeClass}">${scan.riskLevel || "UNKNOWN"}</div>
        </div>

        <div class="mini-metrics">
          <div class="mini-metric">
            <div class="mini-metric-label">Market Cap</div>
            <div class="mini-metric-value">${scan.marketCap || "N/A"}</div>
          </div>
          <div class="mini-metric">
            <div class="mini-metric-label">Liquidity</div>
            <div class="mini-metric-value">${scan.liquidity || "N/A"}</div>
          </div>
          <div class="mini-metric">
            <div class="mini-metric-label">Top 10 Holders</div>
            <div class="mini-metric-value">${scan.top10 || "N/A"}</div>
          </div>
          <div class="mini-metric">
            <div class="mini-metric-label">Avg TX Size</div>
            <div class="mini-metric-value">${scan.avgTxSize || "N/A"}</div>
          </div>
        </div>

        <div class="mini-card-actions">
          <div class="mini-rescan-hint">Click to re-scan →</div>
          <button class="mini-trade-btn" onclick="event.stopPropagation(); goToSafeApe('${scan.mint}')">
            <img src="/sol2moon-token.png" style="width:13px;height:13px;object-fit:contain;vertical-align:middle;margin-right:4px;">Trade on Safe Ape
          </button>
        </div>
      </div>
    `;
  }).join("");

  container.innerHTML = `
    <div class="scans-grid">${cardsHTML}</div>
    <button class="clear-history-btn" onclick="clearHistory()">Clear History</button>
  `;
}

/* ===== NAVIGATE TO RISK SCANNER WITH MINT ===== */
window.goToScan = function(mint) {
  localStorage.setItem("s2m_prefill_mint", mint);
  window.location.href = "risk-scanner.html";
};

/* ===== NAVIGATE TO SAFE APE SIMULATOR WITH MINT ===== */
window.goToSafeApe = function(mint) {
  localStorage.setItem("s2m_sa_mint", mint);
  window.location.href = "safe-ape.html";
};

/* ===== CLEAR HISTORY ===== */
window.clearHistory = function() {
  if (confirm("Clear all scan history?")) {
    localStorage.removeItem(SCANS_KEY);
    renderScans();
  }
};

/* ===== INIT ===== */
document.addEventListener("DOMContentLoaded", () => {
  renderNav();
  renderScans();
});