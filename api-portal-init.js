// api-portal-init.js — initialisation for api-portal.html
import { renderNav } from "./nav.js";
import { applyTranslations } from "./i18n.js";

document.addEventListener("DOMContentLoaded", () => {
  renderNav();
  applyTranslations();
});
window.addEventListener("langchange", () => applyTranslations());
