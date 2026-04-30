// guide-init.js — initialisation for guide.html (extracted inline script)
import { renderNav } from "./nav.js";
import { applyTranslations } from "./i18n.js";

document.addEventListener("DOMContentLoaded", () => {
  renderNav();
  applyTranslations();
});
window.addEventListener("langchange", () => applyTranslations());
