// guide-risk-scanner-init.js — module init for guide-risk-scanner.html (extracted inline module script)
import { renderNav } from "./nav.js";
import { applyTranslations, t } from "./i18n.js";

document.addEventListener("DOMContentLoaded", () => {
  renderNav();
  applyTranslations();
});

window.addEventListener("langchange", () => {
  applyTranslations();
  /* Re-translate dynamic quiz content */
  if (typeof window.__s2mRetranslateDynamic === "function") {
    window.__s2mRetranslateDynamic();
  }
  /* Update progress bar label */
  if (typeof window.__s2mUpdateProgressLabel === "function") {
    window.__s2mUpdateProgressLabel();
  }
});

/* Expose t() for the classic script */
window.__s2m_t = t;
