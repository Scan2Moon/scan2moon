/* ============================================================
   Scan2Moon – community.js  (V2.0)
   Professional footer community panel
   ============================================================ */

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
          On-chain Solana intelligence.<br/>Scan smarter. Trade safer.
        </div>
        <div class="s2m-footer-chain-pill">
          <span class="s2m-footer-chain-dot"></span>
          Built on Solana
        </div>
        <div class="s2m-footer-disclaimer">
          Informational tool only. Always DYOR.<br/>
          Not financial advice.
        </div>
      </div>

      <!-- COL 2: LIVE STATS -->
      <div class="s2m-footer-stats-col">
        <div class="s2m-footer-section-title">📡 Live Stats</div>
        <div class="s2m-footer-stats-list">

          <div class="s2m-footer-stat-row">
            <div class="s2m-footer-stat-left">
              <span class="s2m-footer-stat-icon">👁️</span>
              <span class="s2m-footer-stat-label">Site Visits</span>
            </div>
            <strong class="s2m-footer-stat-val" id="statVisits">—</strong>
          </div>

          <div class="s2m-footer-stat-row">
            <div class="s2m-footer-stat-left">
              <span class="s2m-footer-stat-icon">🔍</span>
              <span class="s2m-footer-stat-label">Risk Scans Run</span>
            </div>
            <strong class="s2m-footer-stat-val" id="statScans">—</strong>
          </div>

          <div class="s2m-footer-stat-row s2m-footer-stat-moon">
            <div class="s2m-footer-stat-left">
              <span class="s2m-footer-stat-icon"><img src="/sol2moon-token.png" class="s2m-token-icon s2m-token-icon--footer"></span>
              <span class="s2m-footer-stat-label">Moon Coins Detected</span>
            </div>
            <strong class="s2m-footer-stat-val s2m-footer-stat-val--moon" id="statMoon">—</strong>
          </div>

          <div class="s2m-footer-stat-note">
            Moon Coins = Risk Score ≥ 80/100
          </div>

        </div>
      </div>

      <!-- COL 3: COMMUNITY LINKS -->
      <div class="s2m-footer-links-col">
        <div class="s2m-footer-section-title">🌐 Community</div>
        <div class="s2m-footer-links-list">

          <a href="https://x.com/Scan2Moon" target="_blank" rel="noopener noreferrer" class="s2m-footer-link s2m-footer-link--x">
            <span class="s2m-footer-link-icon">𝕏</span>
            <div class="s2m-footer-link-text">
              <div class="s2m-footer-link-name">Follow on X</div>
              <div class="s2m-footer-link-sub">@Scan2Moon</div>
            </div>
            <span class="s2m-footer-link-arrow">↗</span>
          </a>

          <a href="https://t.me/scan2moon" target="_blank" rel="noopener noreferrer" class="s2m-footer-link s2m-footer-link--tg">
            <span class="s2m-footer-link-icon">✈️</span>
            <div class="s2m-footer-link-text">
              <div class="s2m-footer-link-name">Telegram</div>
              <div class="s2m-footer-link-sub">Join community chat</div>
            </div>
            <span class="s2m-footer-link-arrow">↗</span>
          </a>

          <a href="https://github.com/Scan2Moon/scan2moon" target="_blank" rel="noopener noreferrer" class="s2m-footer-link s2m-footer-link--gh">
            <span class="s2m-footer-link-icon">⌥</span>
            <div class="s2m-footer-link-text">
              <div class="s2m-footer-link-name">GitHub</div>
              <div class="s2m-footer-link-sub">Open source</div>
            </div>
            <span class="s2m-footer-link-arrow">↗</span>
          </a>

        </div>
      </div>

      <!-- COL 4: TOOLS -->
      <div class="s2m-footer-tools-col">
        <div class="s2m-footer-section-title">🛠️ Tools</div>
        <div class="s2m-footer-tools-list">
          <a href="risk-scanner.html" class="s2m-footer-tool">
            <span>🛡️</span> Risk Scanner
          </a>
          <a href="portfolio.html" class="s2m-footer-tool">
            <span>💼</span> Portfolio Scanner
          </a>
          <a href="whale-dna.html" class="s2m-footer-tool">
            <span>🧬</span> Whale DNA
          </a>
          <a href="entry-radar.html" class="s2m-footer-tool">
            <span>📡</span> Entry Radar
          </a>
          <a href="watchlist.html" class="s2m-footer-tool">
            <span>⭐</span> Watchlist
          </a>
        </div>
      </div>

    </div>

    <!-- BOTTOM BAR -->
    <div class="s2m-footer-bottom">
      <span class="s2m-footer-bottom-left">© 2026 Scan2Moon · All rights reserved</span>
      <span class="s2m-footer-bottom-right">
        <span class="s2m-footer-live-dot"></span>
        Live · Auto-refreshes every 60s
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
   FETCH STATS
   ============================================================ */
async function fetchStats() {
  try {
    const data = await safeFetch(statsEndpoint);
    updateStatsUI(data);
  } catch (err) {
    console.warn("Stats fetch failed:", err.message);
  }
}

/* ============================================================
   INCREMENT STAT
   ============================================================ */
async function incrementGlobalStat(type) {
  try {
    await safeFetch(statsEndpoint, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ type })
    });
    await fetchStats();
  } catch (err) {
    console.warn("Stat increment failed:", err.message);
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