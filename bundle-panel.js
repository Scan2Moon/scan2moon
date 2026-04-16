/* ================================================================
   Scan2Moon – Bundle Attack Panel  (frontend)
   Calls /.netlify/functions/bundle and renders the result panel.
   ================================================================ */

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
      <div class="bd-loading-text">Scanning launch blocks for bundle activity…</div>
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
        Bundle analysis unavailable — ${esc(e.message)}
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
            <div class="bd-score-label">Bundle Safety Score</div>
          </div>
          <div class="bd-verdict-pill bd-verdict-warn">
            <span class="bd-verdict-icon">🔁</span>
            <span class="bd-verdict-text">Pump.fun Token</span>
          </div>
        </div>
        <div class="bd-explanation bd-warn">
          Pump.fun tokens route all buys through the bonding curve program — individual launch buyers cannot be isolated via standard Solana RPC. Bundle risk is assessed via the <strong>Pump.fun Launch Risk</strong> signal in the Scan Signals panel instead.
        </div>
        <div class="bd-footer">⛓️ Check the Scan Signals panel for Pump.fun Launch Risk score</div>
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
    CLEAN:      "Launch block activity looks normal. No signs of coordinated wallet bundling detected.",
    SUSPICIOUS: "Some early concentration detected. Could be organic or early snipers. Monitor carefully.",
    BUNDLED:    "Multiple wallets bought in the first blocks with signs of coordination. Classic bundle pattern.",
    EXTREME:    "Heavy coordinated buying in launch blocks. High probability of a single entity controlling early supply.",
    NO_DATA:    "Not enough transaction history to perform bundle analysis.",
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
      share the same SOL funding source — a classic multi-wallet bundle pattern.
    </div>` : "";

  /* ── Top buyers table ── */
  const buyersHtml = (data.topBuyers && data.topBuyers.length > 0) ? `
    <div class="bd-buyers">
      <div class="bd-buyers-title">⏱️ Earliest buyers detected  <span class="bd-buyers-sub">(creation slot: ${esc(String(data.creationSlot))})</span></div>
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
          <div class="bd-score-label">Bundle Safety Score</div>
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
          <div class="bd-stat-label">Supply bought in first ${esc(String(data.earlyWindow))} blocks</div>
        </div>
        <div class="bd-stat">
          <div class="bd-stat-val">${esc(String(data.uniqueWallets))}</div>
          <div class="bd-stat-label">Early wallets detected</div>
        </div>
        <div class="bd-stat">
          <div class="bd-stat-val ${data.commonFunderDetected ? "bd-bad" : "bd-clean"}">
            ${data.commonFunderDetected ? "⚠️ Yes" : "✅ No"}
          </div>
          <div class="bd-stat-label">Common funder detected</div>
        </div>
        <div class="bd-stat">
          <div class="bd-stat-val ${data.estimatedControllers < data.uniqueWallets ? "bd-warn" : "bd-clean"}">
            ${esc(String(data.estimatedControllers))}
          </div>
          <div class="bd-stat-label">Estimated real controllers</div>
        </div>
      </div>

      ${funderAlert}
      ${buyersHtml}

      <div class="bd-footer">
        ⛓️ Analyzed first ${esc(String(data.earlyWindow))} launch blocks on Solana
        <span class="bd-footer-sep">•</span>
        ${esc(String(data.uniqueWallets))} wallet${data.uniqueWallets !== 1 ? "s" : ""} examined
      </div>
      ${data.pumpFunOrigin ? `
      <div class="bd-explanation bd-warn" style="margin-top:10px; font-size:0.82em;">
        🎓 <strong>Pump.fun origin:</strong> This token launched on pump.fun. Early buys went through the bonding curve program — not the mint — so the score above reflects <em>post-graduation</em> activity only (always 100 if no post-graduation bundling occurred). See the <strong>Pump.fun Launch Risk</strong> signal in Scan Signals for launch-stage analysis.
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
