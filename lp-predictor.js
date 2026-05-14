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
  if (impact === "positive") return "✅";
  if (impact === "negative") return "⚠️";
  return "•";
}
function fmtLiq(v) {
  if (v === null || v === undefined) return "—";
  if (v >= 1000000) return "$" + (v/1000000).toFixed(1) + "M";
  if (v >= 1000)    return "$" + (v/1000).toFixed(1) + "k";
  if (v > 0)        return "$" + v.toFixed(0);
  return "$0";
}
function fmtAge(days) {
  if (days === null || days === undefined) return "—";
  if (days >= 1) return Math.round(days) + "d";
  return Math.round(days * 24) + "h";
}

/* ── Score → accent colour ── */
function scoreColor(score) {
  if (score >= 78) return "#2cffc9";
  if (score >= 50) return "#ffd166";
  return "#ff4d6d";
}

/* ── SVG donut gauge (270° arc) ── */
function scoreGaugeSVG(score, color) {
  const R = 48, cx = 60, cy = 62;
  const C = 2 * Math.PI * R;
  const arcFull = (270 / 360) * C;
  const arcFill = Math.max(4, (score / 100) * arcFull);
  const ticks = [25, 50, 75].map(v => {
    const angle = (135 + (v / 100) * 270) * Math.PI / 180;
    const x1 = (cx + (R - 7) * Math.cos(angle)).toFixed(1);
    const y1 = (cy + (R - 7) * Math.sin(angle)).toFixed(1);
    const x2 = (cx + (R + 1) * Math.cos(angle)).toFixed(1);
    const y2 = (cy + (R + 1) * Math.sin(angle)).toFixed(1);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(255,255,255,0.18)" stroke-width="1.5"/>`;
  }).join('');
  return `<svg class="lp-gauge-svg" viewBox="0 0 120 124" width="120" height="124" xmlns="http://www.w3.org/2000/svg">
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="9"
      stroke-dasharray="${arcFull.toFixed(1)} ${(C - arcFull).toFixed(1)}" stroke-linecap="round" transform="rotate(135 ${cx} ${cy})"/>
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${color}" stroke-width="9" opacity="0.22"
      stroke-dasharray="${arcFill.toFixed(1)} ${(C - arcFill).toFixed(1)}" stroke-linecap="round" transform="rotate(135 ${cx} ${cy})"/>
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${color}" stroke-width="8"
      stroke-dasharray="${arcFill.toFixed(1)} ${(C - arcFill).toFixed(1)}" stroke-linecap="round" transform="rotate(135 ${cx} ${cy})"/>
    ${ticks}
    <circle cx="${cx}" cy="${cy}" r="34" fill="rgba(0,8,5,0.6)"/>
    <text x="${cx}" y="${cy - 4}" text-anchor="middle" dominant-baseline="middle"
      font-family="JetBrains Mono,monospace" font-size="22" font-weight="900" fill="${color}">${score}</text>
    <text x="${cx}" y="${cy + 14}" text-anchor="middle"
      font-family="JetBrains Mono,monospace" font-size="7.5" font-weight="700"
      fill="rgba(200,220,210,0.4)" letter-spacing="1">SCORE</text>
  </svg>`;
}

export async function renderLpPredictorPanel(mint) {
  var el = document.getElementById("lpPanel");
  if (!el) return;

  el.innerHTML =
    '<div class="lp-loading">'
    + '<div class="lp-loading-dots"><span></span><span></span><span></span></div>'
    + '<div class="lp-loading-text">Analyzing liquidity safety…</div>'
    + '</div>';

  var data;
  try {
    var creator = window.scanCreator || "";
    var res = await fetch("/.netlify/functions/lpPredictor", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": window.__s2mKey || "" },
      body: JSON.stringify({ mint: mint, creator: creator }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    data = await res.json();
  } catch (e) {
    el.innerHTML =
      '<div class="lp-error">'
      + '<span class="lp-error-icon">⚠️</span>'
      + "LP data unavailable — " + esc(e.message)
      + '</div>';
    window.lpData = null;
    return;
  }

  window.lpData = data;

  if (data.risk === "NO_DATA") {
    el.innerHTML =
      '<div class="lp-card">'
      + '<div class="lp-top">'
      +   '<div class="lp-gauge-col">' + scoreGaugeSVG(0, "#ffd166") + '</div>'
      +   '<div class="lp-info-col">'
      +     '<div class="lp-verdict-pill lp-verdict-warn">❓ Data Unavailable</div>'
      +   '</div>'
      + '</div>'
      + '<div class="lp-footer">⛓️ Birdeye + Helius · LP data could not be fetched</div>'
      + '</div>';
    return;
  }

  var verdictCls = data.score >= 78 ? "lp-verdict-clean"
    : data.score >= 55 ? "lp-verdict-warn"
    : data.score >= 30 ? "lp-verdict-bad"
    : "lp-verdict-extreme";

  var verdictIcon = data.score >= 78 ? "✅"
    : data.score >= 55 ? "⚠️"
    : "🚨";

  /* ── LP key stats ── */
  var lpStatus = "—";
  if (data.lpBurnPct !== null && data.lpBurnPct >= 95) lpStatus = "✅ Burned";
  else if (data.lpBurnPct !== null && data.lpBurnPct > 0) lpStatus = data.lpBurnPct.toFixed(0) + "% burned";
  else if (data.lpLocked) lpStatus = "🔒 Locked";
  else lpStatus = "⚠️ Unlocked";

  var mintStr  = (data.mintAuthority  === "Renounced") ? "✅ Renounced" : "⚠️ Active";
  var ageStr   = fmtAge(data.poolAgeDays);
  var liqStr   = fmtLiq(data.liquidityUsd);

  var color = scoreColor(data.score);

  /* ── Signals with progress bars ── */
  var sigsHtml = (data.signals || []).map(function(s) {
    var barW = Math.min(100, Math.abs(s.delta) * 4);
    return '<div class="lp-signal-row lp-signal-' + esc(s.impact) + '">'
      + '<span class="lp-signal-icon">' + impactIcon(s.impact) + '</span>'
      + '<span class="lp-signal-label">' + esc(s.label) + '</span>'
      + '<div class="lp-signal-bar-wrap"><div class="lp-signal-bar-fill" style="width:' + barW + '%"></div></div>'
      + '<span class="lp-signal-val">' + esc(s.value) + '</span>'
      + '<span class="lp-signal-delta">' + (s.delta > 0 ? "+" : "") + s.delta + '</span>'
      + '</div>';
  }).join("");

  /* ── Dev note ── */
  var devNote = "";
  if (data.devData && data.devData.available && data.devData.totalDeployed > 0) {
    devNote = '<div class="lp-dev-note">'
      + "👀 Dev history: " + data.devData.totalDeployed + " token"
      + (data.devData.totalDeployed !== 1 ? "s" : "") + " deployed"
      + (data.devData.rugRate > 0 ? " · " + data.devData.rugRate + "% rug rate" : " · clean record")
      + '</div>';
  }

  el.innerHTML =
    '<div class="lp-card">'

    /* ── Two-column top: gauge + verdict + 2×2 mini grid ── */
    + '<div class="lp-top">'
    +   '<div class="lp-gauge-col">' + scoreGaugeSVG(data.score, color) + '</div>'
    +   '<div class="lp-info-col">'
    +     '<div class="lp-verdict-pill ' + verdictCls + '">'
    +       '<span class="lp-verdict-icon">' + verdictIcon + '</span>'
    +       '<span class="lp-verdict-text">' + esc(data.label) + '</span>'
    +     '</div>'
    +     '<div class="lp-mini-grid">'
    +       '<div class="lp-mini-stat"><div class="lp-mini-val">' + lpStatus + '</div><div class="lp-mini-label">LP Status</div></div>'
    +       '<div class="lp-mini-stat"><div class="lp-mini-val">' + mintStr  + '</div><div class="lp-mini-label">Mint Auth</div></div>'
    +       '<div class="lp-mini-stat"><div class="lp-mini-val">' + ageStr   + '</div><div class="lp-mini-label">Pool Age</div></div>'
    +       '<div class="lp-mini-stat"><div class="lp-mini-val">' + liqStr   + '</div><div class="lp-mini-label">Liquidity</div></div>'
    +     '</div>'
    +   '</div>'
    + '</div>'

    /* ── Signal breakdown ── */
    + '<div class="lp-signals">'
    +   '<div class="lp-section-title">SIGNAL BREAKDOWN</div>'
    +   sigsHtml
    + '</div>'

    + devNote

    + '<div class="lp-footer">'
    +   '⛓️ Birdeye + Helius'
    +   '<span class="lp-footer-sep">·</span>'
    +   'LP burn, lock status, deployer history'
    + '</div>'

    + '</div>';
}

export function getLpRiskScore() {
  if (!window.lpData || window.lpData.risk === "NO_DATA") return 50;
  return window.lpData.score;
}
