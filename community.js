const _DEBUG = false;

/* ============================================================
   Scan2Moon – community.js  (V3.0 — Professional Terminal)
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
    <div class="comm-terminal">

      <!-- Scan sweep -->
      <div class="comm-sweep"></div>

      <!-- TOP STATUS BAR -->
      <div class="comm-status-bar">
        <div class="comm-status-left">
          <span class="comm-status-dot"></span>
          <span class="comm-status-label">NETWORK LIVE</span>
          <span class="comm-status-sep">·</span>
          <span class="comm-status-chain">SOLANA</span>
          <span class="comm-status-sep">·</span>
          <span class="comm-status-chain">BIRDEYE DATA</span>
        </div>
        <div class="comm-status-right">
          <span class="comm-status-version">Scan2Moon V2.0</span>
        </div>
      </div>

      <!-- MAIN GRID -->
      <div class="s2m-footer-grid">

        <!-- COL 1: BRAND -->
        <div class="s2m-footer-brand">
          <div class="comm-brand-logo">
            <div class="comm-brand-diamond"></div>
            <span class="comm-brand-text">S2M</span>
          </div>
          <div class="comm-brand-name">Scan2Moon</div>
          <div class="comm-brand-tagline">${t("comm_tagline")}</div>


          <div class="s2m-footer-disclaimer">${t("comm_disclaimer")}</div>
        </div>

        <!-- COL 2: PLATFORM TOOLS -->
        <div class="s2m-footer-tools-col">
          <div class="s2m-footer-section-title">PLATFORM</div>
          <div class="s2m-footer-tools-list">
            <a href="index.html" class="s2m-footer-tool">
              <div class="comm-tool-shape comm-shape-teal"></div>
              <div class="comm-tool-body">
                <div class="comm-tool-name">${t("nav_home")}</div>
                <div class="comm-tool-sub">Live token scanner</div>
              </div>
              <span class="comm-tool-arrow">↗</span>
            </a>
            <a href="risk-scanner.html" class="s2m-footer-tool">
              <div class="comm-tool-shape comm-shape-teal"></div>
              <div class="comm-tool-body">
                <div class="comm-tool-name">${t("comm_tool_risk")}</div>
                <div class="comm-tool-sub">On-chain risk intelligence</div>
              </div>
              <span class="comm-tool-arrow">↗</span>
            </a>
            <a href="whale-dna.html" class="s2m-footer-tool">
              <div class="comm-tool-shape comm-shape-purple"></div>
              <div class="comm-tool-body">
                <div class="comm-tool-name">${t("comm_tool_whale")}</div>
                <div class="comm-tool-sub">Holder & wallet analysis</div>
              </div>
              <span class="comm-tool-arrow">↗</span>
            </a>
            <a href="safe-ape.html" class="s2m-footer-tool">
              <div class="comm-tool-shape comm-shape-gold"></div>
              <div class="comm-tool-body">
                <div class="comm-tool-name">Paper Trading</div>
                <div class="comm-tool-sub">Simulate with real data</div>
              </div>
              <span class="comm-tool-arrow">↗</span>
            </a>
            <a href="watchlist.html" class="s2m-footer-tool">
              <div class="comm-tool-shape comm-shape-teal"></div>
              <div class="comm-tool-body">
                <div class="comm-tool-name">${t("comm_tool_watchlist")}</div>
                <div class="comm-tool-sub">Monitor saved tokens</div>
              </div>
              <span class="comm-tool-arrow">↗</span>
            </a>
            <a href="leaderboard.html" class="s2m-footer-tool">
              <div class="comm-tool-shape comm-shape-orange"></div>
              <div class="comm-tool-body">
                <div class="comm-tool-name">${t("nav_leaderboard")}</div>
                <div class="comm-tool-sub">Risk-adjusted rankings</div>
              </div>
              <span class="comm-tool-arrow">↗</span>
            </a>
          </div>
        </div>

        <!-- COL 3: COMMUNITY LINKS -->
        <div class="s2m-footer-links-col">
          <div class="s2m-footer-section-title">COMMUNITY</div>
          <div class="s2m-footer-links-list">

            <a href="https://x.com/Scan2Moon" target="_blank" rel="noopener noreferrer" class="s2m-footer-link s2m-footer-link--x">
              <div class="comm-link-icon-wrap comm-link-icon--x">
                <span class="comm-link-x-glyph">𝕏</span>
              </div>
              <div class="s2m-footer-link-text">
                <div class="s2m-footer-link-name">${t("comm_follow_x")}</div>
                <div class="s2m-footer-link-sub">@Scan2Moon · Signals &amp; Alpha</div>
              </div>
              <span class="s2m-footer-link-arrow">↗</span>
            </a>

            <a href="https://t.me/scan2moon" target="_blank" rel="noopener noreferrer" class="s2m-footer-link s2m-footer-link--tg">
              <div class="comm-link-icon-wrap comm-link-icon--tg">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z"/>
                </svg>
              </div>
              <div class="s2m-footer-link-text">
                <div class="s2m-footer-link-name">${t("comm_tg_name")}</div>
                <div class="s2m-footer-link-sub">${t("comm_tg_sub")}</div>
              </div>
              <span class="s2m-footer-link-arrow">↗</span>
            </a>

            <a href="https://github.com/Scan2Moon/scan2moon" target="_blank" rel="noopener noreferrer" class="s2m-footer-link s2m-footer-link--gh">
              <div class="comm-link-icon-wrap comm-link-icon--gh">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
                </svg>
              </div>
              <div class="s2m-footer-link-text">
                <div class="s2m-footer-link-name">GitHub</div>
                <div class="s2m-footer-link-sub">${t("comm_gh_sub")}</div>
              </div>
              <span class="s2m-footer-link-arrow">↗</span>
            </a>

            <a href="mailto:team@scan2moon.com" class="s2m-footer-link s2m-footer-link--email">
              <div class="comm-link-icon-wrap comm-link-icon--email">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="2" y="4" width="20" height="16" rx="2"/>
                  <path d="M2 7l10 7 10-7"/>
                </svg>
              </div>
              <div class="s2m-footer-link-text">
                <div class="s2m-footer-link-name">${t("comm_contact")}</div>
                <div class="s2m-footer-link-sub">team@scan2moon.com</div>
              </div>
              <span class="s2m-footer-link-arrow">↗</span>
            </a>

          </div>
        </div>

        <!-- COL 4: LIVE STATS -->
        <div class="s2m-footer-stats-col">
          <div class="s2m-footer-section-title">${t("comm_live_stats")}</div>
          <div class="s2m-footer-stats-list">

            <div class="s2m-footer-stat-row">
              <div class="s2m-footer-stat-left">
                <div class="comm-stat-shape comm-stat-shape--teal"></div>
                <span class="s2m-footer-stat-label">${t("comm_stat_visits")}</span>
              </div>
              <strong class="s2m-footer-stat-val" id="statVisits">—</strong>
            </div>

            <div class="s2m-footer-stat-row">
              <div class="s2m-footer-stat-left">
                <div class="comm-stat-shape comm-stat-shape--purple"></div>
                <span class="s2m-footer-stat-label">${t("comm_stat_scans")}</span>
              </div>
              <strong class="s2m-footer-stat-val" id="statScans">—</strong>
            </div>

            <div class="s2m-footer-stat-row s2m-footer-stat-moon">
              <div class="s2m-footer-stat-left">
                <div class="comm-stat-shape comm-stat-shape--gold"></div>
                <span class="s2m-footer-stat-label">${t("comm_stat_moon")}</span>
              </div>
              <strong class="s2m-footer-stat-val s2m-footer-stat-val--moon" id="statMoon">—</strong>
            </div>

            <div class="s2m-footer-stat-note">${t("comm_stat_note")}</div>

          </div>

          <!-- DATA SOURCES -->
          <div class="comm-data-sources">
            <div class="comm-ds-title">DATA SOURCES</div>
            <div class="comm-ds-row">
              <div class="comm-ds-dot comm-ds-dot--teal"></div>
              <span>Birdeye · on-chain risk data</span>
            </div>
            <div class="comm-ds-row">
              <div class="comm-ds-dot comm-ds-dot--purple"></div>
              <span>Solana · RPC endpoints</span>
            </div>
            <div class="comm-ds-row">
              <div class="comm-ds-dot comm-ds-dot--dim"></div>
              <span>Jupiter · Price aggregation</span>
            </div>
          </div>
        </div>

      </div>

      <!-- BOTTOM BAR -->
      <div class="s2m-footer-bottom">
        <span class="s2m-footer-bottom-left">${t("comm_copyright")}</span>
        <div class="comm-bottom-center">
          <div class="comm-bottom-tag">NOT FINANCIAL ADVICE · ALWAYS DYOR</div>
        </div>
        <span class="s2m-footer-bottom-right">
          <span class="s2m-footer-live-dot"></span>
          ${t("comm_live_auto")}
        </span>
      </div>

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
   FETCH STATS  — with localStorage cache
   ============================================================ */
const STATS_CACHE_KEY = "s2m_stats_v4";

function loadCachedStats() {
  try {
    const raw = localStorage.getItem(STATS_CACHE_KEY);
    if (!raw) return null;
    const { data, savedAt } = JSON.parse(raw);
    if (Date.now() - savedAt > 7 * 86_400_000) return null;
    return data;
  } catch { return null; }
}

function saveCachedStats(data) {
  try {
    if ((data.visits || 0) + (data.scans || 0) + (data.moon || 0) > 0) {
      localStorage.setItem(STATS_CACHE_KEY, JSON.stringify({ data, savedAt: Date.now() }));
    }
  } catch {}
}

async function fetchStats() {
  const cached = loadCachedStats();
  if (cached) updateStatsUI(cached);

  try {
    const data = await safeFetch(statsEndpoint);
    const allZero = !data.visits && !data.scans && !data.moon;
    if (!allZero) {
      updateStatsUI(data);
      saveCachedStats(data);
    }
  } catch (err) {
    _DEBUG && console.warn("Stats fetch failed (cached values retained):", err.message);
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
    const allZero = !result.visits && !result.scans && !result.moon;
    if (!allZero) {
      updateStatsUI(result);
      saveCachedStats(result);
    }
  } catch (err) {
    _DEBUG && console.warn("Stat increment skipped:", err.message);
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

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initCommunity);
} else {
  initCommunity();
}

window.incrementGlobalStat = incrementGlobalStat;

window.addEventListener("langchange", () => {
  renderCommunityPanel();
  const cached = loadCachedStats();
  if (cached) updateStatsUI(cached);
});
