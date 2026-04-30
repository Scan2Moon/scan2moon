/* ================================================================
   Scan2Moon -- LP Pull Predictor panel  (frontend module)
   Mirrors the bundle-panel.js pattern exactly.
   export renderLpPredictorPanel(mint) -- called from script.js
   export getLpRiskScore()             -- for finalScore integration
   ================================================================ */
import { esc } from "./utils.js";

function barGradient(score) {
  if (score >= 78) return "linear-gradient(90deg,#2cffc9,#1dd4a5)";
  if (score >= 55) return "linear-gradient(90deg,#ffd166,#ffb340)";
  if (score >= 30) return "linear-gradient(90deg,#ff4d6d,#cc2244)";
  return "linear-gradient(90deg,#9b0000,#ff2200)";
}
function scoreClass(score) {
  if (score >= 78) return "lp-clean";
  if (score >= 55) return "lp-warn";
  return "lp-bad";
}
function impactIcon(impact) {
  if (impact === "positive") return "\u2705";
  if (impact === "negative") return "\u26A0\uFE0F";
  return "\u2022";
}
function fmtLiq(v) {
  if (!v) return "\u2014";
  if (v >= 1000000) return "$" + (v/1000000).toFixed(1) + "M";
  if (v >= 1000)    return "$" + (v/1000).toFixed(1) + "k";
  return "$" + v.toFixed(0);
}
function fmtAge(days) {
  if (days === null || days === undefined) return "\u2014";
  if (days >= 1) return Math.round(days) + "d";
  return Math.round(days * 24) + "h";
}

export async function renderLpPredictorPanel(mint) {
  var el = document.getElementById("lpPanel");
  if (!el) return;

  el.innerHTML =
    '<div class="lp-loading">'
    + '<div class="lp-loading-dots"><span></span><span></span><span></span></div>'
    + '<div class="lp-loading-text">Analyzing liquidity safety\u2026</div>'
    + '</div>';

  var data;
  try {
    var creator = window.scanCreator || "";
    var res = await fetch("/.netlify/functions/lpPredictor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mint: mint, creator: creator }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    data = await res.json();
  } catch (e) {
    el.innerHTML =
      '<div class="lp-error">'
      + '<span class="lp-error-icon">\u26A0\uFE0F</span>'
      + "LP data unavailable \u2014 " + esc(e.message)
      + '</div>';
    window.lpData = null;
    return;
  }

  window.lpData = data;

  if (data.risk === "NO_DATA") {
    el.innerHTML =
      '<div class="lp-card">'
      + '<div class="lp-score-row">'
      +   '<div class="lp-score-block"><div class="lp-score-num lp-warn">\u2014</div><div class="lp-score-label">LP Safety Score</div></div>'
      +   '<div class="lp-verdict-pill lp-verdict-warn">\u2753 Data Unavailable</div>'
      + '</div>'
      + '<div class="lp-footer">\u26D3\uFE0F Birdeye + Helius \u00b7 LP data could not be fetched</div>'
      + '</div>';
    return;
  }

  var verdictCls = data.score >= 78 ? "lp-verdict-clean"
    : data.score >= 55 ? "lp-verdict-warn"
    : data.score >= 30 ? "lp-verdict-bad"
    : "lp-verdict-extreme";

  var verdictIcon = data.score >= 78 ? "\u2705"
    : data.score >= 55 ? "\u26A0\uFE0F"
    : "\uD83D\uDEA8";

  /* key stats row */
  var lpStatus = "\u2014";
  if (data.lpBurnPct !== null && data.lpBurnPct >= 95) lpStatus = "\u2705 Burned";
  else if (data.lpBurnPct !== null && data.lpBurnPct > 0) lpStatus = data.lpBurnPct.toFixed(0) + "% burned";
  else if (data.lpLocked) lpStatus = "\uD83D\uDD12 Locked";
  else lpStatus = "\u26A0\uFE0F Unlocked";

  var mintStr  = (data.mintAuthority  === "Renounced") ? "\u2705 Renounced" : "\u26A0\uFE0F Active";
  var ageStr   = fmtAge(data.poolAgeDays);
  var liqStr   = fmtLiq(data.liquidityUsd);

  /* signals list */
  var sigsHtml = (data.signals || []).map(function(s) {
    return '<div class="lp-signal-row lp-signal-' + esc(s.impact) + '">'
      + '<span class="lp-signal-icon">' + impactIcon(s.impact) + '</span>'
      + '<span class="lp-signal-label">' + esc(s.label) + '</span>'
      + '<span class="lp-signal-val">' + esc(s.value) + '</span>'
      + '<span class="lp-signal-delta">' + (s.delta > 0 ? "+" : "") + s.delta + '</span>'
      + '</div>';
  }).join("");

  /* deployer note */
  var devNote = "";
  if (data.devData && data.devData.available && data.devData.totalDeployed > 0) {
    devNote = '<div class="lp-dev-note">'
      + "\uD83D\uDC40 Dev history: " + data.devData.totalDeployed + " token"
      + (data.devData.totalDeployed !== 1 ? "s" : "") + " deployed"
      + (data.devData.rugRate > 0 ? " \u00b7 " + data.devData.rugRate + "% rug rate" : " \u00b7 clean record")
      + '</div>';
  }

  el.innerHTML =
    '<div class="lp-card">'

    /* score row */
    + '<div class="lp-score-row">'
    +   '<div class="lp-score-block">'
    +     '<div class="lp-score-num ' + scoreClass(data.score) + '">' + esc(String(data.score)) + '</div>'
    +     '<div class="lp-score-label">LP Safety Score</div>'
    +   '</div>'
    +   '<div class="lp-verdict-pill ' + verdictCls + '">'
    +     '<span class="lp-verdict-icon">' + verdictIcon + '</span>'
    +     '<span class="lp-verdict-text">' + esc(data.label) + '</span>'
    +   '</div>'
    + '</div>'

    /* bar */
    + '<div class="lp-bar-wrap">'
    +   '<div class="lp-bar-fill" style="width:' + esc(String(data.score)) + '%;background:' + barGradient(data.score) + '"></div>'
    + '</div>'

    /* quick stats */
    + '<div class="lp-stats">'
    +   '<div class="lp-stat"><div class="lp-stat-val">' + lpStatus + '</div><div class="lp-stat-label">LP Status</div></div>'
    +   '<div class="lp-stat"><div class="lp-stat-val">' + mintStr  + '</div><div class="lp-stat-label">Mint Auth</div></div>'
    +   '<div class="lp-stat"><div class="lp-stat-val">' + ageStr   + '</div><div class="lp-stat-label">Pool Age</div></div>'
    +   '<div class="lp-stat"><div class="lp-stat-val">' + liqStr   + '</div><div class="lp-stat-label">Liquidity</div></div>'
    + '</div>'

    /* signals */
    + '<div class="lp-signals">'
    +   '<div class="lp-signals-title">Signal Breakdown</div>'
    +   sigsHtml
    + '</div>'

    + devNote

    + '<div class="lp-footer">'
    +   '\u26D3\uFE0F Birdeye + Helius'
    +   '<span class="lp-footer-sep">\u00b7</span>'
    +   'LP burn, lock status, deployer history'
    + '</div>'

    + '</div>';
}

export function getLpRiskScore() {
  if (!window.lpData || window.lpData.risk === "NO_DATA") return 50;
  return window.lpData.score;
}
