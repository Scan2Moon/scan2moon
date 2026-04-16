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

/* ================================================================
   renderBundlePanel(mint)
   Called from script.js after the main scan completes.
   ================================================================ */
export async function renderBundlePanel(mint) {
  const el = document.getElementById("bundlePanel");
  if (!el) return;

  /* Loading state */
  el.innerHTML = `
    <div class="bd-loading">
      <div class="bd-loading-dots"><span></span><span></span><span></span></div>
      <div class="bd-loading-text">${t("bundle_scanning")}</div>
    </div>`;

  let data;
  try {
    const res = await fetch("/.netlify/functions/bundle", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ mint, hasGraduated: !!window.scanHasGraduated }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    data = await res.json();
  } catch (e) {
    el.innerHTML = `
      <div class="bd-error">
        <span class="bd-error-icon">⚠️</span>
        ${t("bundle_error")} — ${esc(e.message)}
      </div>`;
    window.bundleData = null;
    return;
  }

  /* Cache for risk score integration */
  window.bundleData = data;

  /* ── Pump.fun special case ── */
  if (data.verdict === "PUMP_FUN") {
    el.innerHTML = `
      <div class="bd-card">
        <div class="bd-score-row">
          <div class="bd-score-block">
            <div class="bd-score-num bd-warn">—</div>
            <div class="bd-score-label">${t("bundle_safety_score")}</div>
          </div>
          <div class="bd-verdict-pill bd-verdict-warn">
            <span class="bd-verdict-icon">🔁</span>
            <span class="bd-verdict-text">${t("bundle_pump_token")}</span>
          </div>
        </div>
        <div class="bd-explanation bd-warn">
          ${t("bundle_explain_pump")}
        </div>
        <div class="bd-footer">⛓️ ${t("bundle_pump_footer")}</div>
      </div>`;
    return;
  }

  /* ── Verdict config ── */
  const verdictMap = {
    CLEAN:      { icon: "✅", cls: "bd-clean", bgCls: "bd-verdict-clean" },
    SUSPICIOUS: { icon: "⚠️", cls: "bd-warn",  bgCls: "bd-verdict-warn"  },
    BUNDLED:    { icon: "🚨", cls: "bd-bad",   bgCls: "bd-verdict-bad"   },
    EXTREME:    { icon: "💀", cls: "bd-bad",   bgCls: "bd-verdict-extreme"},
    NO_DATA:    { icon: "❓", cls: "bd-warn",  bgCls: "bd-verdict-warn"  },
  };
  const v = verdictMap[data.verdict] || verdictMap.SUSPICIOUS;

  /* ── Explanation copy ── */
  const explanations = {
    CLEAN:      t("bundle_explain_clean"),
    SUSPICIOUS: t("bundle_explain_sus"),
    BUNDLED:    t("bundle_explain_bundled"),
    EXTREME:    t("bundle_explain_extreme"),
    NO_DATA:    t("bundle_explain_nodata"),
  };
  const explanation = explanations[data.verdict] || explanations.SUSPICIOUS;

  /* ── Slot offset colour ── */
  function slotBadgeClass(offset) {
    if (offset === 0) return "bd-slot-zero";
    if (offset <= 2)  return "bd-slot-early";
    return "bd-slot-normal";
  }

  /* ── Common funder alert ── */
  const funderAlert = data.commonFunderDetected ? `
    <div class="bd-alert">
      🚨 <strong>${esc(String(data.commonFunderCount))} early buyer wallets</strong>
      ${t("bundle_funder_alert")}
    </div>` : "";

  /* ── Top buyers table ── */
  const buyersHtml = (data.topBuyers && data.topBuyers.length > 0) ? `
    <div class="bd-buyers">
      <div class="bd-buyers-title">${t("bundle_earliest_buyers")}  <span class="bd-buyers-sub">(creation slot: ${esc(String(data.creationSlot))})</span></div>
      <div class="bd-buyers-table">
        ${data.topBuyers.map(b => `
          <div class="bd-buyer-row">
            <a href="https://solscan.io/account/${esc(b.fullWallet)}" target="_blank" rel="noopener noreferrer" class="bd-buyer-addr">${esc(b.wallet)}</a>
            <span class="bd-buyer-slot ${slotBadgeClass(b.slotOffset)}">Block +${esc(String(b.slotOffset))}</span>
          </div>`).join("")}
      </div>
    </div>` : "";

  /* ── Render ── */
  el.innerHTML = `
    <div class="bd-card">

      <!-- Score row -->
      <div class="bd-score-row">
        <div class="bd-score-block">
          <div class="bd-score-num ${bundleScoreClass(data.bundleScore)}">${esc(String(data.bundleScore))}</div>
          <div class="bd-score-label">${t("bundle_safety_score")}</div>
        </div>
        <div class="bd-verdict-pill ${v.bgCls}">
          <span class="bd-verdict-icon">${v.icon}</span>
          <span class="bd-verdict-text">${esc(data.label)}</span>
        </div>
      </div>

      <!-- Progress bar -->
      <div class="bd-bar-wrap">
        <div class="bd-bar-fill" style="width:${esc(String(data.bundleScore))}%; background:${bundleBarGradient(data.bundleScore)};"></div>
      </div>

      <!-- Explanation -->
      <div class="bd-explanation ${v.cls}">${esc(explanation)}</div>

      <!-- Stats grid -->
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
      ${buyersHtml}

      <div class="bd-footer">
        ⛓️ ${t("bundle_analyzed")}
        <span class="bd-footer-sep">•</span>
        ${esc(String(data.uniqueWallets))} ${data.uniqueWallets !== 1 ? t("bundle_wallets_examined") : t("bundle_wallet_examined")}
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
   Returns the bundle safety score for integration into Total Risk Score.
   Returns 75 (neutral) when no data is available.
   ================================================================ */
export function getBundleRiskScore() {
  if (!window.bundleData || window.bundleData.verdict === "NO_DATA") return 75;
  return window.bundleData.bundleScore;
}
