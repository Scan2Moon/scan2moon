/* ================================================================
   Scan2Moon – Bundle Attack Panel  (frontend)
   Calls /.netlify/functions/bundle and renders the result panel.
   ================================================================ */
import { t } from "./i18n.js";

/* ── Security helpers ── */
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* ── Score → colour ── */
function scoreColor(score) {
  if (score >= 78) return "#2cffc9";
  if (score >= 50) return "#ffd166";
  return "#ff4d6d";
}

/* ── Bundle bar gradient by score ── */
function bundleBarGradient(score) {
  if (score >= 80) return "linear-gradient(90deg, #2cffc9, #1dd4a5)";
  if (score >= 55) return "linear-gradient(90deg, #ffd166, #ffb340)";
  if (score >= 30) return "linear-gradient(90deg, #ff4d6d, #cc2244)";
  return "linear-gradient(90deg, #9b0000, #ff2200)";
}

/* ── Score colour class ── */
function bundleScoreClass(score) {
  if (score >= 80) return "bd-clean";
  if (score >= 55) return "bd-warn";
  return "bd-bad";
}

/* ── SVG donut gauge (270deg arc) ── */
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
  return `<svg class="bd-gauge-svg" viewBox="0 0 120 124" width="120" height="124" xmlns="http://www.w3.org/2000/svg">
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

/* ── Early buyer supply-% bar chart ── */
function slotChartSVG(topBuyers) {
  const buyers = (topBuyers || []).slice(0, 10);
  if (!buyers.length) return '';
  const maxPct = Math.max(...buyers.map(b => parseFloat(b.percentage) || 0), 1);
  const W = 100, barH = 3, gap = 1;
  const totalH = buyers.length * (barH + gap);
  const bars = buyers.map(function(b, i) {
    const pct = parseFloat(b.percentage) || 0;
    const w   = Math.max(2, (pct / maxPct) * W);
    const col = pct >= 10 ? '#ff4d6d' : pct >= 5 ? '#ffd166' : '#2cffc9';
    const y   = i * (barH + gap);
    return '<rect x="0" y="' + y + '" width="' + w.toFixed(1) + '" height="' + barH + '" fill="' + col + '" rx="1"/>';
  }).join('');
  return '<svg viewBox="0 0 ' + W + ' ' + totalH + '" class="bd-chart-svg" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">' + bars + '</svg>';
}

/* ================================================================
   renderBundlePanel(mint)
   ================================================================ */
export async function renderBundlePanel(mint) {
  const el = document.getElementById("bundlePanel");
  if (!el) return;

  el.innerHTML = `
    <div class="bd-loading">
      <div class="bd-loading-dots"><span></span><span></span><span></span></div>
      <div class="bd-loading-text">${t("bundle_scanning")}</div>
    </div>`;

  let data;
  try {
    const res = await fetch("/.netlify/functions/bundle", {
      method:  "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": window.__s2mKey || "" },
      body:    JSON.stringify({ mint, hasGraduated: !!window.scanHasGraduated }),
    });
    if (res.status === 402) {
      el.innerHTML = `
        <div class="bd-paywall">
          <div class="bd-paywall-icon">🔒</div>
          <div class="bd-paywall-title">Premium Feature</div>
          <div class="bd-paywall-text">Bundle Attack Detection requires a Scan2Moon API key.</div>
          <a class="bd-paywall-btn" href="/api-portal.html">Get Free API Key →</a>
        </div>`;
      window.bundleData = null;
      return;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    data = await res.json();
  } catch (e) {
    el.innerHTML = `
      <div class="bd-error">
        <span class="bd-error-icon">&#x26A0;&#xFE0F;</span>
        ${t("bundle_error")} — ${esc(e.message)}
      </div>`;
    window.bundleData = null;
    return;
  }

  window.bundleData = data;

  /* Pump.fun special case */
  if (data.verdict === "PUMP_FUN") {
    const col = "#ffd166";
    el.innerHTML = `
      <div class="bd-card">
        <div class="bd-top">
          <div class="bd-gauge-col">${scoreGaugeSVG("—", col)}</div>
          <div class="bd-info-col">
            <div class="bd-verdict-pill bd-verdict-warn">
              <span class="bd-verdict-icon">&#x1F501;</span>
              <span class="bd-verdict-text">${t("bundle_pump_token")}</span>
            </div>
            <div class="bd-explanation bd-warn">${t("bundle_explain_pump")}</div>
          </div>
        </div>
        <div class="bd-footer">&#x26D3;&#xFE0F; ${t("bundle_pump_footer")}</div>
      </div>`;
    return;
  }

  const verdictMap = {
    CLEAN:      { icon: "✅", cls: "bd-clean", bgCls: "bd-verdict-clean", labelKey: "bundle_no_bundle"  },
    SUSPICIOUS: { icon: "⚠️", cls: "bd-warn",  bgCls: "bd-verdict-warn",  labelKey: "bundle_suspicious" },
    BUNDLED:    { icon: "🚨", cls: "bd-bad",   bgCls: "bd-verdict-bad",   labelKey: "bundle_bundled"    },
    EXTREME:    { icon: "💀", cls: "bd-bad",   bgCls: "bd-verdict-extreme",labelKey: "bundle_extreme"   },
    NO_DATA:    { icon: "❓", cls: "bd-warn",  bgCls: "bd-verdict-warn",  labelKey: "bundle_no_data"   },
  };
  const v = verdictMap[data.verdict] || verdictMap.SUSPICIOUS;
  const verdictLabel = t(v.labelKey);

  const explanations = {
    CLEAN:      t("bundle_explain_clean"),
    SUSPICIOUS: t("bundle_explain_sus"),
    BUNDLED:    t("bundle_explain_bundled"),
    EXTREME:    t("bundle_explain_extreme"),
    NO_DATA:    t("bundle_explain_nodata"),
  };
  const explanation = explanations[data.verdict] || explanations.SUSPICIOUS;

  function pctBadgeClass(pct) {
    if (pct >= 10) return "bd-slot-zero";
    if (pct >= 3)  return "bd-slot-early";
    return "bd-slot-normal";
  }

  const color = scoreColor(data.bundleScore);

  const funderAlert = data.commonFunderDetected ? `
    <div class="bd-alert">
      🚨 <strong>${esc(String(data.commonFunderCount))} early buyer wallets</strong>
      ${t("bundle_funder_alert")}
    </div>` : "";

  const hasTopBuyers = data.topBuyers && data.topBuyers.length > 0;

  const chartHtml = hasTopBuyers ? `
    <div class="bd-chart-wrap">
      <div class="bd-section-title">EARLY BUYER CONCENTRATION</div>
      ${slotChartSVG(data.topBuyers)}
    </div>` : "";

  var buyerRowsHtml = "";
  if (hasTopBuyers) {
    data.topBuyers.forEach(function(b) {
      const pct = parseFloat(b.percentage) || 0;
      const cls = pctBadgeClass(pct);
      const row = '<div class="bd-buyer-row">'
        + '<a href="https://solscan.io/account/' + esc(b.fullWallet) + '" target="_blank" rel="noopener noreferrer" class="bd-buyer-addr">' + esc(b.wallet) + '</a>'
        + '<span class="bd-buyer-slot ' + cls + '">' + pct.toFixed(2) + '%' + '<' + '/span>'
        + '<' + '/div>';
      buyerRowsHtml += row;
    });
  }

  const buyersHtml = hasTopBuyers ? `
    <div class="bd-buyers">
      <div class="bd-buyers-title">EARLIEST BUYERS <span class="bd-buyers-sub">(supply % held)</span></div>
      <div class="bd-buyers-table">${buyerRowsHtml}</div>
    </div>` : "";

  el.innerHTML = `
    <div class="bd-card">

      <div class="bd-top">
        <div class="bd-gauge-col">
          ${scoreGaugeSVG(data.bundleScore, color)}
        </div>
        <div class="bd-info-col">
          <div class="bd-verdict-pill ${v.bgCls}">
            <span class="bd-verdict-icon">${v.icon}</span>
            <span class="bd-verdict-text">${verdictLabel}</span>
          </div>
          <div class="bd-explanation ${v.cls}">${esc(explanation)}</div>
        </div>
      </div>

      <div class="bd-stats">
        <div class="bd-stat">
          <div class="bd-stat-val ${data.earlyPct > 20 ? "bd-bad" : data.earlyPct > 10 ? "bd-warn" : "bd-clean"}">
            ${esc(String(data.earlyPct))}%
          </div>
          <div class="bd-stat-label">${t("bundle_supply_pct")}</div>
        </div>
        <div class="bd-stat">
          <div class="bd-stat-val">${esc(String(data.uniqueWallets))}</div>
          <div class="bd-stat-label">${t("bundle_early_wallets")}</div>
        </div>
        <div class="bd-stat">
          <div class="bd-stat-val ${data.commonFunderDetected ? "bd-bad" : "bd-clean"}">
            ${data.commonFunderDetected ? "⚠️ Yes" : "✅ No"}
          </div>
          <div class="bd-stat-label">${t("bundle_common_funder")}</div>
        </div>
        <div class="bd-stat">
          <div class="bd-stat-val ${data.estimatedControllers < data.uniqueWallets ? "bd-warn" : "bd-clean"}">
            ${esc(String(data.estimatedControllers))}
          </div>
          <div class="bd-stat-label">${t("bundle_controllers")}</div>
        </div>
      </div>

      ${funderAlert}
      ${chartHtml}
      ${buyersHtml}

      <div class="bd-footer">
        ⛓️ ${t("bundle_analyzed")}
        <span class="bd-footer-sep">•</span>
        ${esc(String(data.uniqueWallets))} ${data.uniqueWallets !== 1 ? t("bundle_wallets_examined") : t("bundle_wallet_examined")}
        <span class="bd-footer-sep">•</span>
        <span title="Bundle detection uses Birdeye holder data. Tx data: Solana RPC">Tx data: Solana RPC</span>
      </div>
      ${data.pumpFunOrigin ? `
      <div class="bd-explanation bd-warn" style="margin-top:10px; font-size:0.82em;">
        🎓 ${t("bundle_explain_pump")}
      </div>` : ""}

    </div>
  `;
}

/* ================================================================
   getBundleRiskScore()
   ================================================================ */
export function getBundleRiskScore() {
  if (!window.bundleData || window.bundleData.verdict === "NO_DATA") return 75;
  return window.bundleData.bundleScore;
}
