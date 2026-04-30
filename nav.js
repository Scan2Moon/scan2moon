/* ===== SCAN2MOON SHARED NAVIGATION – V3.1 (Professional Terminal) ===== */
import { t, getCurrentLang, setLang, applyTranslations } from "./i18n.js";

export function renderNav() {
  /* Guard: only inject once per page */
  if (document.querySelector(".s2m-nav")) return;

  const currentPage = window.location.pathname.split("/").pop() || "index.html";

  const isScanner   = ["risk-scanner.html","whale-dna.html"].includes(currentPage);
  const isMarkets   = ["gainers.html","new-pairs.html","smart-money.html","bubbles.html"].includes(currentPage);
  const isInsights  = ["watchlist.html","about.html","leaderboard.html","safe-ape.html","api-portal.html","guide.html"].includes(currentPage);
  const isDashboard = currentPage === "dashboard.html";

  const navHTML = `
    <nav class="s2m-nav">
      <!-- Scan sweep line animation -->
      <div class="nav-sweep"></div>

      <div class="nav-inner">

        <!-- LOGO -->
        <a href="index.html" class="nav-logo">
          <div class="nav-logo-mark">
            <div class="nav-logo-diamond"></div>
            <span class="nav-logo-text">S2M</span>
          </div>
          <div class="nav-brand-block">
            <span class="nav-brand">Scan2Moon</span>
            <span class="nav-brand-sub">SOLANA ANALYTICS</span>
          </div>
        </a>

        <!-- SEPARATOR -->
        <div class="nav-sep"></div>

        <!-- LINKS -->
        <div class="nav-links">

          <!-- HOME -->
          <a href="index.html" class="nav-link ${currentPage === 'index.html' || currentPage === '' ? 'active' : ''}">
            <span class="nav-link-icon">◆</span>
            <span data-i18n="nav_home">${t("nav_home")}</span>
          </a>

          <!-- MARKETS dropdown -->
          <div class="nav-dropdown ${isMarkets ? 'open-default' : ''}" id="dd-markets">
            <button class="nav-link nav-drop-btn ${isMarkets ? 'active' : ''}">
              <span class="nav-link-icon">▲</span>
              <span>MARKETS</span>
              <svg class="nav-chevron-svg" width="10" height="6" viewBox="0 0 10 6" fill="none">
                <path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <div class="nav-drop-menu">
              <div class="nav-drop-category">LIVE DATA</div>
              <a href="gainers.html" class="nav-drop-item ${currentPage === 'gainers.html' ? 'drop-active' : ''}">
                <div class="drop-shape drop-shape--teal"></div>
                <div>
                  <div class="drop-label">Top Gainers</div>
                  <div class="drop-sub">Best performing tokens right now</div>
                </div>
              </a>
              <a href="new-pairs.html" class="nav-drop-item ${currentPage === 'new-pairs.html' ? 'drop-active' : ''}">
                <div class="drop-shape drop-shape--purple"></div>
                <div>
                  <div class="drop-label">New Pairs</div>
                  <div class="drop-sub">Freshly launched Solana tokens</div>
                </div>
              </a>
              <a href="smart-money.html" class="nav-drop-item ${currentPage === 'smart-money.html' ? 'drop-active' : ''}">
                <div class="drop-shape drop-shape--gold"></div>
                <div>
                  <div class="drop-label">Smart Money</div>
                  <div class="drop-sub">Track profitable wallet activity</div>
                </div>
              </a>
              <a href="bubbles.html" class="nav-drop-item ${currentPage === 'bubbles.html' ? 'drop-active' : ''}">
                <div class="drop-shape drop-shape--purple"></div>
                <div>
                  <div class="drop-label">Bubble Map</div>
                  <div class="drop-sub">Market cap visualisation</div>
                </div>
              </a>
            </div>
          </div>

          <!-- ANALYSIS dropdown -->
          <div class="nav-dropdown ${isScanner ? 'open-default' : ''}" id="dd-scanners">
            <button class="nav-link nav-drop-btn ${isScanner ? 'active' : ''}">
              <span class="nav-link-icon">·</span>
              <span data-i18n="nav_scanners">${t("nav_scanners")}</span>
              <svg class="nav-chevron-svg" width="10" height="6" viewBox="0 0 10 6" fill="none">
                <path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <div class="nav-drop-menu">
              <div class="nav-drop-category">ANALYSIS TOOLS</div>
              <a href="risk-scanner.html" class="nav-drop-item ${currentPage === 'risk-scanner.html' ? 'drop-active' : ''}">
                <div class="drop-shape drop-shape--teal"></div>
                <div>
                  <div class="drop-label" data-i18n="nav_risk_scanner">${t("nav_risk_scanner")}</div>
                  <div class="drop-sub" data-i18n="nav_risk_scanner_sub">${t("nav_risk_scanner_sub")}</div>
                </div>
              </a>
              <a href="whale-dna.html" class="nav-drop-item ${currentPage === 'whale-dna.html' ? 'drop-active' : ''}">
                <div class="drop-shape drop-shape--purple"></div>
                <div>
                  <div class="drop-label" data-i18n="nav_whale_dna">${t("nav_whale_dna")}</div>
                  <div class="drop-sub" data-i18n="nav_whale_dna_sub">${t("nav_whale_dna_sub")}</div>
                </div>
              </a>
            </div>
          </div>

          <!-- DASHBOARD -->
          <a href="dashboard.html" class="nav-link nav-link--dashboard ${isDashboard ? 'active' : ''}">
            <span class="nav-link-icon">◆</span>
            <span class="nav-dashboard-label">DASHBOARD</span>
          </a>

          <!-- PLATFORM dropdown -->
          <div class="nav-dropdown ${isInsights ? 'open-default' : ''}" id="dd-insights">
            <button class="nav-link nav-drop-btn ${isInsights ? 'active' : ''}">
              <span class="nav-link-icon">·</span>
              <span data-i18n="nav_insights">${t("nav_insights")}</span>
              <svg class="nav-chevron-svg" width="10" height="6" viewBox="0 0 10 6" fill="none">
                <path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <div class="nav-drop-menu nav-drop-menu--wide">
              <div class="nav-drop-category">PLATFORM</div>
              <a href="watchlist.html" class="nav-drop-item ${currentPage === 'watchlist.html' ? 'drop-active' : ''}">
                <div class="drop-shape drop-shape--teal"></div>
                <div>
                  <div class="drop-label" data-i18n="nav_watchlist">${t("nav_watchlist")}</div>
                  <div class="drop-sub" data-i18n="nav_watchlist_sub">${t("nav_watchlist_sub")}</div>
                </div>
              </a>
              <a href="safe-ape.html" class="nav-drop-item nav-drop-item--featured ${currentPage === 'safe-ape.html' ? 'drop-active' : ''}">
                <div class="drop-shape drop-shape--gold"></div>
                <div>
                  <div class="drop-label" data-i18n="nav_safe_ape">${t("nav_safe_ape")} <span class="drop-badge">LIVE</span></div>
                  <div class="drop-sub" data-i18n="nav_safe_ape_sub">${t("nav_safe_ape_sub")}</div>
                </div>
              </a>
              <a href="leaderboard.html" class="nav-drop-item ${currentPage === 'leaderboard.html' ? 'drop-active' : ''}">
                <div class="drop-shape drop-shape--orange"></div>
                <div>
                  <div class="drop-label" data-i18n="nav_leaderboard">${t("nav_leaderboard")}</div>
                  <div class="drop-sub" data-i18n="nav_leaderboard_sub">${t("nav_leaderboard_sub")}</div>
                </div>
              </a>
              <a href="api-portal.html" class="nav-drop-item ${currentPage === 'api-portal.html' ? 'drop-active' : ''}">
                <div class="drop-shape drop-shape--teal"></div>
                <div>
                  <div class="drop-label">API &amp; Payments <span class="drop-badge" style="background:rgba(44,255,201,.15);color:#2cffc9;border:1px solid rgba(44,255,201,.3);">NEW</span></div>
                  <div class="drop-sub">Pay-per-call &bull; x402 &bull; Solana USDC</div>
                </div>
              </a>
              <a href="guide.html" class="nav-drop-item ${currentPage === 'guide.html' ? 'drop-active' : ''}">
                <div class="drop-shape drop-shape--purple"></div>
                <div>
                  <div class="drop-label" data-i18n="nav_learn_guides">${t("nav_learn_guides")}</div>
                  <div class="drop-sub" data-i18n="nav_learn_guides_sub">${t("nav_learn_guides_sub")}</div>
                </div>
              </a>
              <div class="nav-drop-divider"></div>
              <a href="about.html" class="nav-drop-item ${currentPage === 'about.html' ? 'drop-active' : ''}">
                <div class="drop-shape drop-shape--dim"></div>
                <div>
                  <div class="drop-label" data-i18n="nav_about">${t("nav_about")}</div>
                  <div class="drop-sub" data-i18n="nav_about_sub">${t("nav_about_sub")}</div>
                </div>
              </a>
            </div>
          </div>

        </div><!-- end nav-links -->

        <!-- RIGHT: version + status -->
        <div class="nav-right">
          <div class="nav-status-dot"></div>
          <div class="nav-version-block">
            <span class="nav-version-label">V2.0</span>
            <span class="nav-version-chain">SOLANA</span>
          </div>
        </div>

      </div><!-- end nav-inner -->
    </nav>
  `;

  const app = document.querySelector(".app");
  if (!app) return;
  const header = app.querySelector(".hero-header");
  if (header) header.insertAdjacentHTML("afterend", navHTML);
  else app.insertAdjacentHTML("afterbegin", navHTML);

  /* Expose setLang globally so inline onclick works across module boundaries */
  window.__s2mSetLang = (lang) => {
    setLang(lang);
    document.querySelectorAll(".lang-flag-btn").forEach(btn => {
      btn.classList.toggle("lang-active", btn.dataset.lang === lang);
    });
  };

  /* Dropdown toggle logic */
  document.querySelectorAll(".nav-dropdown").forEach(dd => {
    const btn = dd.querySelector(".nav-drop-btn");
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const isOpen = dd.classList.contains("open");
      document.querySelectorAll(".nav-dropdown").forEach(other => other.classList.remove("open"));
      if (!isOpen) dd.classList.add("open");
    });
  });
  document.addEventListener("click", () => {
    document.querySelectorAll(".nav-dropdown").forEach(dd => dd.classList.remove("open"));
  });

  /* Apply any saved language immediately */
  applyTranslations();
}
