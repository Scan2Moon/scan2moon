// utils.js — Shared frontend utilities
// C3 fix: esc() prevents XSS by escaping API-sourced strings before innerHTML insertion.
// Any token name/symbol/metadata from Birdeye must go through esc() before being
// placed inside an innerHTML template literal.

/**
 * Escapes a string for safe insertion into HTML via innerHTML.
 * Use on every value that originates from an external API or user input.
 * @param {*} str - Value to escape (any type; coerced to string)
 * @returns {string} HTML-safe string
 */
export function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * SINGLE SOURCE OF TRUTH for risk labels — import everywhere instead of inline ternaries.
 * Thresholds must stay in sync with computeRiskScore() in scanSignals.js.
 * @param {number} score  0–100
 * @returns {string}
 */
export function riskLabel(score) {
  if (score >= 80) return "🌕 MOON COIN";
  if (score >= 65) return "LOW RUG RISK";
  if (score >= 45) return "MODERATE RISK";
  if (score >= 25) return "HIGH RUG RISK";
  return "EXTREME RISK 🚨";
}

/**
 * Returns a hex colour matching the risk level for a given score.
 * @param {number} score  0–100
 * @returns {string}
 */
export function riskColor(score) {
  if (score >= 80) return "#ffd700";
  if (score >= 65) return "#2cffc9";
  if (score >= 45) return "#ffd166";
  if (score >= 25) return "#ff9a3c";
  return "#ff4d6d";
}
