/* ============================================================
   Scan2Moon – about.js  (V2.0)
   About Scan2Moon page initialisation
   ============================================================ */

import { renderNav } from "./nav.js";
import { applyTranslations } from "./i18n.js";
import "./community.js";

document.addEventListener("DOMContentLoaded", () => {
  renderNav();
  applyTranslations();
});

window.addEventListener("langchange", () => {
  applyTranslations();
});
