/* ============================================================
   Scan2Moon – community.js  (V2.0)
   Professional footer community panel
   ============================================================ */

import { t } from "./i18n.js";

const statsEndpoint = "/.netlify/functions/stats";

/* ============================================================
   SAFE FETCH WITH TIMEOUT
   ============================================================ */
async function safeFetch(url, options = {}, timeout = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json"))
      throw new Error("Invalid JSON response");
    return await response.json();
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

/* ============================================================
   RENDER PANEL
   ============================================================ */
function renderCommunityPanel() {
  const panel = document.getElementById("communityPanel");
  if (!panel) return;

  panel.innerHTML = `
    <div class="s2m-footer-grid">

      <!-- COL 1: BRAND -->
      <div class="s2m-footer-brand">
        <div class="s2m-footer-logo-row">
          <img src="favicon.png" alt="Scan2Moon" class="s2m-footer-favicon" />
          <span class="s2m-footer-name">Scan2Moon</span>
          <span class="s2m-footer-version">V2.0</span>
        </div>
        <div class="s2m-footer-tagline">
          ${t("comm_tagline")}
        </div>
        <div class="s2m-footer-chain-pill">
          <span class="s2m-footer-chain-dot"></span>
          ${t("comm_built_solana")}
        </div>
        <div class="s2m-footer-disclaimer">
          ${t("comm_disclaimer")}
        </div>
      </div>

      <!-- COL 2: LIVE STATS -->
      <div class="s2m-footer-stats-col">
        <div class="s2m-footer-section-title">${t("comm_live_stats")}</div>
        <div class="s2m-footer-stats-list">

          <div class="s2m-footer-stat-row">
            <div class="s2m-footer-stat-left">
              <span class="s2m-footer-stat-icon">👁️</span>
              <span class="s2m-footer-stat-label">${t("comm_stat_visits")}</span>
            </div>
            <strong class="s2m-footer-stat-val" id="statVisits">—</strong>
          </div>

          <div class="s2m-footer-stat-row">
            <div class="s2m-footer-stat-left">
              <span class="s2m-footer-stat-icon">🔍</span>
              <span class="s2m-footer-stat-label">${t("comm_stat_scans")}</span>
            </div>
            <strong class="s2m-footer-stat-val" id="statScans">—</strong>
          </div>

          <div class="s2m-footer-stat-row s2m-footer-stat-moon">
            <div class="s2m-footer-stat-left">
              <span class="s2m-footer-stat-icon"><img src="/sol2moon-token.png" class="s2m-token-icon s2m-token-icon--footer"></span>
              <span class="s2m-footer-stat-label">${t("comm_stat_moon")}</span>
            </div>
            <strong class="s2m-footer-stat-val s2m-footer-stat-val--moon" id="statMoon">—</strong>
          </div>

          <div class="s2m-footer-stat-note">
            ${t("comm_stat_note")}
          </div>

        </div>
      </div>

      <!-- COL 3: COMMUNITY LINKS -->
      <div class="s2m-footer-links-col">
        <div class="s2m-footer-section-title">${t("comm_community")}</div>
        <div class="s2m-footer-links-list">

          <a href="https://x.com/Scan2Moon" target="_blank" rel="noopener noreferrer" class="s2m-footer-link s2m-footer-link--x">
            <span class="s2m-footer-link-icon">𝕏</span>
            <div class="s2m-footer-link-text">
              <div class="s2m-footer-link-name">${t("comm_follow_x")}</div>
              <div class="s2m-footer-link-sub">@Scan2Moon</div>
            </div>
            <span class="s2m-footer-link-arrow">↗</span>
          </a>

          <a href="https://t.me/scan2moon" target="_blank" rel="noopener noreferrer" class="s2m-footer-link s2m-footer-link--tg">
            <span class="s2m-footer-link-icon">✈️</span>
            <div class="s2m-footer-link-text">
              <div class="s2m-footer-link-name">${t("comm_tg_name")}</div>
              <div class="s2m-footer-link-sub">${t("comm_tg_sub")}</div>
            </div>
            <span class="s2m-footer-link-arrow">↗</span>
          </a>

          <a href="https://github.com/Scan2Moon/scan2moon" target="_blank" rel="noopener noreferrer" class="s2m-footer-link s2m-footer-link--gh">
            <span class="s2m-footer-link-icon">⌥</span>
            <div class="s2m-footer-link-text">
              <div class="s2m-footer-link-name">GitHub</div>
              <div class="s2m-footer-link-sub">${t("comm_gh_sub")}</div>
            </div>
            <span class="s2m-footer-link-arrow">↗</span>
          </a>

          <a href="mailto:team@scan2moon.com" class="s2m-footer-link s2m-footer-link--email">
            <span class="s2m-footer-link-icon">✉️</span>
            <div class="s2m-footer-link-text">
              <div class="s2m-footer-link-name">${t("comm_contact")}</div>
              <div class="s2m-footer-link-sub">team@scan2moon.com</div>
            </div>
            <span class="s2m-footer-link-arrow">↗</span>
          </a>

        </div>
      </div>

      <!-- COL 4: TOOLS -->
      <div class="s2m-footer-tools-col">
        <div class="s2m-footer-section-title">${t("comm_tools")}</div>
        <div class="s2m-footer-tools-list">
          <a href="risk-scanner.html" class="s2m-footer-tool">
            <span>🛡️</span> ${t("comm_tool_risk")}
          </a>
          <a href="portfolio.html" class="s2m-footer-tool">
            <span>💼</span> ${t("comm_tool_portfolio")}
          </a>
          <a href="whale-dna.html" class="s2m-footer-tool">
            <span>🧬</span> ${t("comm_tool_whale")}
          </a>
          <a href="entry-radar.html" class="s2m-footer-tool">
            <span>📡</span> ${t("comm_tool_radar")}
          </a>
          <a href="watchlist.html" class="s2m-footer-tool">
            <span>⭐</span> ${t("comm_tool_watchlist")}
          </a>
        </div>
      </div>

    </div>

    <!-- BOTTOM BAR -->
    <div class="s2m-footer-bottom">
      <span class="s2m-footer-bottom-left">${t("comm_copyright")}</span>
      <span class="s2m-footer-bottom-right">
        <span class="s2m-footer-live-dot"></span>
        ${t("comm_live_auto")}
      </span>
    </div>
  `;
}

/* ============================================================
   UPDATE STATS UI — animated number update
   ============================================================ */
function updateStatsUI(data = {}) {
  animateStat("statVisits", data.visits  || 0);
  animateStat("statScans",  data.scans   || 0);
  animateStat("statMoon",   data.moon    || 0);
}

/* Smooth number count-up animation */
function animateStat(id, target) {
  const el = document.getElementById(id);
  if (!el) return;

  const current = parseInt(el.dataset.value || "0", 10);
  if (current === target) {
    el.textContent = formatNumber(target);
    return;
  }

  el.dataset.value = target;
  const diff    = target - current;
  const steps   = 30;
  const stepVal = diff / steps;
  let   count   = current;
  let   step    = 0;

  const timer = setInterval(() => {
    step++;
    count += stepVal;
    el.textContent = formatNumber(Math.round(count));
    if (step >= steps) {
      clearInterval(timer);
      el.textContent = formatNumber(target);
    }
  }, 30);
}

/* ============================================================
   FETCH STATS  — with localStorage cache to prevent showing 0
   on cold-start or brief Blobs read failures.
   ============================================================ */
// v3: bumped to invalidate old per-stat-max cache that was blocking Redis updates
// v4: bump to bust cached zeros caused by RK.visits/scans bug in stats.js
const STATS_CACHE_KEY = "s2m_stats_v4";

function loadCachedStats() {
  try {
    const raw = localStorage.getItem(STATS_CACHE_KEY);
    if (!raw) return null;
    const { data, savedAt } = JSON.parse(raw);
    // Cache valid for 7 days — stats should never show 0 just because
    // Blobs is having a cold-start moment.
    if (Date.now() - savedAt > 7 * 86_400_000) return null;
    return data;
  } catch { return null; }
}

function saveCachedStats(data) {
  try {
    // Only cache if data looks real (at least one non-zero value)
    if ((data.visits || 0) + (data.scans || 0) + (data.moon || 0) > 0) {
      localStorage.setItem(STATS_CACHE_KEY, JSON.stringify({ data, savedAt: Date.now() }));
    }
  } catch {}
}

async function fetchStats() {
  // Always show cached stats immediately — UI never flickers to 0
  const cached = loadCachedStats();
  if (cached) updateStatsUI(cached);

  try {
    const data = await safeFetch(statsEndpoint);
    // Redis is the source of truth — trust server values directly.
    // Only fall back to cache if server returns all zeros (likely a network error).
    const allZero = !data.visits && !data.scans && !data.moon;
    if (!allZero) {
      updateStatsUI(data);
      saveCachedStats(data);
    }
  } catch (err) {
    console.warn("Stats fetch failed (cached values retained):", err.message);
  }
}

/* ============================================================
   INCREMENT STAT
   ============================================================ */
async function incrementGlobalStat(type) {
  try {
    const result = await safeFetch(statsEndpoint, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ type })
    });
    // Trust Redis INCR result directly — it's atomic and reliable.
    const allZero = !result.visits && !result.scans && !result.moon;
    if (!allZero) {
      updateStatsUI(result);
      saveCachedStats(result);
    }
  } catch (err) {
    // 503 (Blobs protecting data) or network error — just show cached values
    console.warn("Stat increment skipped (Blobs busy or network error):", err.message);
    const cached = loadCachedStats();
    if (cached) updateStatsUI(cached);
  }
}

/* ============================================================
   HELPERS
   ============================================================ */
function formatNumber(num) {
  const n = Number(num || 0);
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000)    return (n / 1000).toFixed(1) + "K";
  return n.toLocaleString();
}

/* ============================================================
   INIT
   ============================================================ */
async function initCommunity() {
  renderCommunityPanel();
  await fetchStats();
  setInterval(fetchStats, 60000);

  if (!sessionStorage.getItem("visited")) {
    await incrementGlobalStat("visit");
    sessionStorage.setItem("visited", "true");
  }
}

// ES module imports run after DOMContentLoaded may have already fired.
// Check readyState to handle both cases.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initCommunity);
} else {
  initCommunity();
}

window.incrementGlobalStat = incrementGlobalStat;

/* Re-render community panel on language switch */
window.addEventListener("langchange", () => {
  renderCommunityPanel();
  // Re-fetch stats to repopulate the counters after re-render
  const cached = loadCachedStats();
  if (cached) updateStatsUI(cached);
});
