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
      throw new Error(`HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      throw new Error("Invalid JSON response");
    }

    return await response.json();

  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

/* ===== RENDER PANEL ===== */
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
          <a href="https://discord.gg/kMhXfpJR" target="_blank">Join Server</a>
        </div>
        <div class="community-item coming">More coming soon</div>
        <div class="community-item coming">More coming soon</div>
      </div>

      <div class="community-col">
        <div class="community-item stat">
          Site Visits
          <strong id="statVisits">—</strong>
        </div>
        <div class="community-item stat">
          Wallets Scanned
          <strong id="statScans">—</strong>
        </div>
        <div class="community-item stat">
          Stats Shared to X
          <strong id="statShares">—</strong>
        </div>
        <div class="community-item stat">
          Moon Coins Detected
          <strong id="statMoon">—</strong>
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

/* ===== UPDATE UI ===== */
function updateStatsUI(data = {}) {
  const visitsEl = document.getElementById("statVisits");
  const scansEl = document.getElementById("statScans");
  const sharesEl = document.getElementById("statShares");
  const moonEl = document.getElementById("statMoon");

  if (visitsEl) visitsEl.innerText = formatNumber(data.visits || 0);
  if (scansEl) scansEl.innerText = formatNumber(data.scans || 0);
  if (sharesEl) sharesEl.innerText = formatNumber(data.shares || 0);
  if (moonEl) moonEl.innerText = formatNumber(data.moon || 0);
}

/* ===== FETCH STATS ===== */
async function fetchStats() {
  try {
    const data = await safeFetch(statsEndpoint);
    updateStatsUI(data);
  } catch (err) {
    console.warn("Stats fetch failed:", err.message);
  }
}

/* ===== INCREMENT STAT ===== */
async function incrementGlobalStat(type) {
  try {
    await safeFetch(statsEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type })
    });
    await fetchStats();
  } catch (err) {
    console.warn("Stat increment failed:", err.message);
  }
}

/* ===== HELPERS ===== */
function formatNumber(num) {
  return Number(num || 0).toLocaleString();
}

/* ===== INIT ===== */
document.addEventListener("DOMContentLoaded", async () => {
  renderCommunityPanel();
  await fetchStats();
  setInterval(fetchStats, 60000);

  if (!sessionStorage.getItem("visited")) {
    await incrementGlobalStat("visit");
    sessionStorage.setItem("visited", "true");
  }
});

window.incrementGlobalStat = incrementGlobalStat;