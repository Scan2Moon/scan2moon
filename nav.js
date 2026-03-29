/* ===== SCAN2MOON SHARED NAVIGATION – V2.0 ===== */

export function renderNav() {
  /* Guard: only inject once per page — importing this module from multiple
     JS files (e.g. safe-ape.js + watchlist.js) must not produce duplicate navs. */
  if (document.querySelector(".s2m-nav")) return;

  const currentPage = window.location.pathname.split("/").pop() || "index.html";

  const isScanner  = ["risk-scanner.html","portfolio.html","whale-dna.html"].includes(currentPage);
  const isRadar    = currentPage === "entry-radar.html";
  const isInsights = ["watchlist.html","about.html","leaderboard.html","safe-ape.html","safe-ape-profile.html"].includes(currentPage);

  const navHTML = `
    <nav class="s2m-nav">
      <div class="nav-inner">
        <a href="index.html" class="nav-logo">
          <img src="favicon.png" alt="S2M" class="nav-favicon" />
          <span class="nav-brand">Scan2Moon</span>
        </a>
        <div class="nav-links">
          <a href="index.html" class="nav-link ${currentPage === 'index.html' || currentPage === '' ? 'active' : ''}">
            <span class="nav-icon">🏠</span> HOME
          </a>
          <div class="nav-dropdown ${isScanner ? 'active' : ''}" id="dd-scanners">
            <button class="nav-link nav-drop-btn ${isScanner ? 'active' : ''}">
              <span class="nav-icon">🔍</span> SCANNERS <span class="nav-chevron">▾</span>
            </button>
            <div class="nav-drop-menu">
              <a href="risk-scanner.html" class="nav-drop-item ${currentPage === 'risk-scanner.html' ? 'drop-active' : ''}">
                <span class="drop-icon">🛡️</span>
                <div><div class="drop-label">Risk Scanner</div><div class="drop-sub">On-chain rug detection</div></div>
              </a>
              <a href="portfolio.html" class="nav-drop-item ${currentPage === 'portfolio.html' ? 'drop-active' : ''}">
                <span class="drop-icon">💼</span>
                <div><div class="drop-label">Portfolio Scanner</div><div class="drop-sub">Wallet risk analysis</div></div>
              </a>
              <a href="whale-dna.html" class="nav-drop-item ${currentPage === 'whale-dna.html' ? 'drop-active' : ''}">
                <span class="drop-icon">🧬</span>
                <div><div class="drop-label">Whale DNA</div><div class="drop-sub">Wallet behavior & copy-trade score</div></div>
              </a>
            </div>
          </div>
          <div class="nav-dropdown ${isRadar ? 'active' : ''}" id="dd-radars">
            <button class="nav-link nav-drop-btn ${isRadar ? 'active' : ''}">
              <span class="nav-icon">📡</span> RADARS <span class="nav-chevron">▾</span>
            </button>
            <div class="nav-drop-menu">
              <a href="entry-radar.html" class="nav-drop-item ${currentPage === 'entry-radar.html' ? 'drop-active' : ''}">
                <span class="drop-icon">🚀</span>
                <div><div class="drop-label">Entry Radar</div><div class="drop-sub">Early token detection</div></div>
              </a>
            </div>
          </div>
          <div class="nav-dropdown ${isInsights ? 'active' : ''}" id="dd-insights">
            <button class="nav-link nav-drop-btn ${isInsights ? 'active' : ''}">
              <span class="nav-icon">💡</span> INSIGHTS <span class="nav-chevron">▾</span>
            </button>
            <div class="nav-drop-menu">
              <a href="watchlist.html" class="nav-drop-item ${currentPage === 'watchlist.html' ? 'drop-active' : ''}">
                <span class="drop-icon">⭐</span>
                <div><div class="drop-label">Token Watchlist</div><div class="drop-sub">Your saved tokens</div></div>
              </a>
              <a href="safe-ape.html" class="nav-drop-item ${currentPage === 'safe-ape.html' || currentPage === 'safe-ape-profile.html' ? 'drop-active' : ''}" style="border:1px solid rgba(255,180,50,0.2);background:rgba(255,180,50,0.04);">
                <span class="drop-icon">🦍</span>
                <div>
                  <div class="drop-label" style="color:#ffb432;">Safe Ape Simulator <span style="font-size:9px;background:rgba(255,180,50,0.2);color:#ffb432;border:1px solid rgba(255,180,50,0.4);border-radius:6px;padding:1px 6px;margin-left:4px;vertical-align:middle;">NEW</span></div>
                  <div class="drop-sub">Paper trading with risk intelligence</div>
                </div>
              </a>
              <a href="leaderboard.html" class="nav-drop-item ${currentPage === 'leaderboard.html' ? 'drop-active' : ''}">
                <span class="drop-icon">🏆</span>
                <div><div class="drop-label">Leaderboard</div><div class="drop-sub">Top Safe Ape traders</div></div>
              </a>
              <a href="about.html" class="nav-drop-item ${currentPage === 'about.html' ? 'drop-active' : ''}">
                <span class="drop-icon">🌐</span>
                <div><div class="drop-label">About Scan2Moon</div><div class="drop-sub">Project, mission & roadmap</div></div>
              </a>
            </div>
          </div>
        </div>
        <div class="nav-badge">V2.0</div>
      </div>
    </nav>
  `;

  const app = document.querySelector(".app");
  if (!app) return;
  const header = app.querySelector(".hero-header");
  if (header) header.insertAdjacentHTML("afterend", navHTML);
  else app.insertAdjacentHTML("afterbegin", navHTML);

  document.querySelectorAll(".nav-dropdown").forEach(dd => {
    const btn = dd.querySelector(".nav-drop-btn");
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const isOpen = dd.classList.contains("open");
      // Close all dropdowns first
      document.querySelectorAll(".nav-dropdown").forEach(other => other.classList.remove("open"));
      // Toggle this one
      if (!isOpen) dd.classList.add("open");
    });
  });
  document.addEventListener("click", () => {
    document.querySelectorAll(".nav-dropdown").forEach(dd => dd.classList.remove("open"));
  });
}