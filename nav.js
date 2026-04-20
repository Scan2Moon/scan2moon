/* ===== SCAN2MOON SHARED NAVIGATION – V2.1 (i18n) ===== */
import { t, getCurrentLang, setLang, applyTranslations } from "./i18n.js";

export function renderNav() {
  /* Guard: only inject once per page */
  if (document.querySelector(".s2m-nav")) return;

  const currentPage = window.location.pathname.split("/").pop() || "index.html";

  const isScanner  = ["risk-scanner.html","whale-dna.html"].includes(currentPage);
  const isRadar    = currentPage === "entry-radar.html";
  const isInsights = ["watchlist.html","about.html","leaderboard.html","safe-ape.html"].includes(currentPage);
  const isDashboard = currentPage === "dashboard.html";

  const navHTML = `
    <nav class="s2m-nav">
      <div class="nav-inner">
        <a href="index.html" class="nav-logo">
          <img src="favicon.png" alt="S2M" class="nav-favicon" />
          <span class="nav-brand">Scan2Moon</span>
        </a>
        <div class="nav-links">
          <a href="index.html" class="nav-link ${currentPage === 'index.html' || currentPage === '' ? 'active' : ''}">
            <span class="nav-icon">🏠</span> <span data-i18n="nav_home">${t("nav_home")}</span>
          </a>
          <div class="nav-dropdown ${isScanner ? 'active' : ''}" id="dd-scanners">
            <button class="nav-link nav-drop-btn ${isScanner ? 'active' : ''}">
              <span class="nav-icon">🔍</span> <span data-i18n="nav_scanners">${t("nav_scanners")}</span> <span class="nav-chevron">▾</span>
            </button>
            <div class="nav-drop-menu">
              <a href="risk-scanner.html" class="nav-drop-item ${currentPage === 'risk-scanner.html' ? 'drop-active' : ''}">
                <span class="drop-icon">🛡️</span>
                <div>
                  <div class="drop-label" data-i18n="nav_risk_scanner">${t("nav_risk_scanner")}</div>
                  <div class="drop-sub" data-i18n="nav_risk_scanner_sub">${t("nav_risk_scanner_sub")}</div>
                </div>
              </a>
              <a href="whale-dna.html" class="nav-drop-item ${currentPage === 'whale-dna.html' ? 'drop-active' : ''}">
                <span class="drop-icon">🧬</span>
                <div>
                  <div class="drop-label" data-i18n="nav_whale_dna">${t("nav_whale_dna")}</div>
                  <div class="drop-sub" data-i18n="nav_whale_dna_sub">${t("nav_whale_dna_sub")}</div>
                </div>
              </a>
            </div>
          </div>
          <div class="nav-dropdown ${isRadar ? 'active' : ''}" id="dd-radars">
            <button class="nav-link nav-drop-btn ${isRadar ? 'active' : ''}">
              <span class="nav-icon">📡</span> <span data-i18n="nav_radars">${t("nav_radars")}</span> <span class="nav-chevron">▾</span>
            </button>
            <div class="nav-drop-menu">
              <a href="entry-radar.html" class="nav-drop-item ${currentPage === 'entry-radar.html' ? 'drop-active' : ''}">
                <span class="drop-icon">🚀</span>
                <div>
                  <div class="drop-label" data-i18n="nav_entry_radar">${t("nav_entry_radar")}</div>
                  <div class="drop-sub" data-i18n="nav_entry_radar_sub">${t("nav_entry_radar_sub")}</div>
                </div>
              </a>
            </div>
          </div>
          <a href="dashboard.html" class="nav-link ${isDashboard ? 'active' : ''}">
            <span class="nav-icon">📊</span> <span>Dashboard</span>
          </a>
          <div class="nav-dropdown ${isInsights ? 'active' : ''}" id="dd-insights">
            <button class="nav-link nav-drop-btn ${isInsights ? 'active' : ''}">
              <span class="nav-icon">💡</span> <span data-i18n="nav_insights">${t("nav_insights")}</span> <span class="nav-chevron">▾</span>
            </button>
            <div class="nav-drop-menu">
              <a href="watchlist.html" class="nav-drop-item ${currentPage === 'watchlist.html' ? 'drop-active' : ''}">
                <span class="drop-icon">⭐</span>
                <div>
                  <div class="drop-label" data-i18n="nav_watchlist">${t("nav_watchlist")}</div>
                  <div class="drop-sub" data-i18n="nav_watchlist_sub">${t("nav_watchlist_sub")}</div>
                </div>
              </a>
              <a href="safe-ape.html" class="nav-drop-item ${currentPage === 'safe-ape.html' ? 'drop-active' : ''}" style="border:1px solid rgba(255,180,50,0.2);background:rgba(255,180,50,0.04);">
                <span class="drop-icon">🦍</span>
                <div>
                  <div class="drop-label" style="color:#ffb432;" data-i18n="nav_safe_ape">${t("nav_safe_ape")} <span style="font-size:9px;background:rgba(255,180,50,0.2);color:#ffb432;border:1px solid rgba(255,180,50,0.4);border-radius:6px;padding:1px 6px;margin-left:4px;vertical-align:middle;">NEW</span></div>
                  <div class="drop-sub" data-i18n="nav_safe_ape_sub">${t("nav_safe_ape_sub")}</div>
                </div>
              </a>
              <a href="leaderboard.html" class="nav-drop-item ${currentPage === 'leaderboard.html' ? 'drop-active' : ''}">
                <span class="drop-icon">🏆</span>
                <div>
                  <div class="drop-label" data-i18n="nav_leaderboard">${t("nav_leaderboard")}</div>
                  <div class="drop-sub" data-i18n="nav_leaderboard_sub">${t("nav_leaderboard_sub")}</div>
                </div>
              </a>
              <a href="about.html" class="nav-drop-item ${currentPage === 'about.html' ? 'drop-active' : ''}">
                <span class="drop-icon">🌐</span>
                <div>
                  <div class="drop-label" data-i18n="nav_about">${t("nav_about")}</div>
                  <div class="drop-sub" data-i18n="nav_about_sub">${t("nav_about_sub")}</div>
                </div>
              </a>
            </div>
          </div>
        </div>

        <!-- ── Language Switcher ── -->
        <div class="lang-switcher">
          <button class="lang-flag-btn ${getCurrentLang() === 'en' ? 'lang-active' : ''}"
                  data-lang="en"
                  title="English"
                  onclick="window.__s2mSetLang('en')">
            <img class="lang-flag-img"
                 src="https://flagcdn.com/w40/gb.png"
                 alt="EN" />
          </button>
          <button class="lang-flag-btn ${getCurrentLang() === 'nl' ? 'lang-active' : ''}"
                  data-lang="nl"
                  title="Nederlands"
                  onclick="window.__s2mSetLang('nl')">
            <img class="lang-flag-img"
                 src="https://flagcdn.com/w40/nl.png"
                 alt="NL" />
          </button>
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

  /* Expose setLang globally so inline onclick works across module boundaries */
  window.__s2mSetLang = (lang) => {
    setLang(lang);
    /* Re-render the nav so flag active states update immediately */
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
