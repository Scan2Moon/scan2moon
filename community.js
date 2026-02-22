/* ===== GLOBAL STATS ENDPOINT ===== */
const statsEndpoint = "/.netlify/functions/stats";

/* ===== SAFE FETCH WITH TIMEOUT ===== */
async function safeFetch(url, options = {}, timeout = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });

    clearTimeout(id);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text.substring(0, 120)}`);
    }

    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      throw new Error("Invalid JSON response (likely 404 HTML page)");
    }

    return await response.json();

  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

/* ===== RENDER PANEL STRUCTURE ===== */

function renderCommunityPanel() {
  const panel = document.getElementById("communityPanel");
  if (!panel) return;

  panel.innerHTML = `
    <div class="community-grid">

      <div class="community-col">
        <div class="community-item">
          <span>X / Twitter</span>
          <a href="https://x.com/Scan2Moon" target="_blank">@Scan2Moon</a>
        </div>
        <div class="community-item">
          <span>Discord</span>
          <a href="https://discord.gg/9XGETdE5" target="_blank">Join Server</a>
        </div>
        <div class="community-item coming">More coming soon</div>
        <div class="community-item coming">More coming soon</div>
      </div>

      <div class="community-col">
        <div class="community-item stat">
          Site Visits
          <strong id="statVisits">0</strong>
        </div>
        <div class="community-item stat">
          Wallets Scanned
          <strong id="statScans">0</strong>
        </div>
        <div class="community-item stat">
          Stats Shared to X
          <strong id="statShares">0</strong>
        </div>
        <div class="community-item stat">
          Moon Coins Detected
          <strong id="statMoon">0</strong>
        </div>
      </div>

      <div class="community-col">
        <div class="community-item coming">Community tools coming</div>
        <div class="community-item coming">Alerts & bots soon</div>
        <div class="community-item coming">Analytics expansion</div>
        <div class="community-item coming">Stay tuned 🌙</div>
      </div>

    </div>
  `;
}

/* ===== DEBOUNCE ===== */

function debounce(fn, delay) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  };
}

/* ===== UPDATE UI ===== */

function updateStatsUI(data = {}) {
  const safe = {
    visits: Number(data.visits || 0),
    scans: Number(data.scans || 0),
    shares: Number(data.shares || 0),
    moon: Number(data.moon || 0)
  };

  const visitsEl = document.getElementById("statVisits");
  const scansEl = document.getElementById("statScans");
  const sharesEl = document.getElementById("statShares");
  const moonEl = document.getElementById("statMoon");

  if (visitsEl) visitsEl.innerText = formatNumber(safe.visits);
  if (scansEl) scansEl.innerText = formatNumber(safe.scans);
  if (sharesEl) sharesEl.innerText = formatNumber(safe.shares);
  if (moonEl) moonEl.innerText = formatNumber(safe.moon);
}

/* ===== FETCH STATS ===== */

const debouncedFetchStats = debounce(async () => {
  try {
    const data = await safeFetch(statsEndpoint);
    updateStatsUI(data);
  } catch (err) {
    console.warn("Stats fetch failed:", err.message);
  }
}, 10000);

/* ===== INCREMENT STAT ===== */

async function incrementGlobalStat(type) {
  try {
    await safeFetch(statsEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type })
    });

    debouncedFetchStats();

  } catch (err) {
    console.warn("Stat increment failed:", err.message);
  }
}

/* ===== HELPERS ===== */

function formatNumber(num) {
  return Number(num || 0).toLocaleString();
}

/* ===== INIT ===== */

document.addEventListener("DOMContentLoaded", () => {
  renderCommunityPanel();
  debouncedFetchStats();

  if (!sessionStorage.getItem("visited")) {
    incrementGlobalStat("visit");
    sessionStorage.setItem("visited", "true");
  }
});

/* ===== EXPORT TO GLOBAL ===== */

window.incrementGlobalStat = incrementGlobalStat;