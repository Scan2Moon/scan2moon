/* ============================================================
   Scan2Moon — Sentinel AI Agent (frontend)
   ============================================================ */

/* ── Collect all available scan globals ── */
function collectScanData() {
  const r    = window.scanResult     || {};
  const meta = window.scanTokenMeta  || {};
  const net  = window.scanNetBuyPressure || {};
  return {
    mint:            window.scanMint         || "N/A",
    name:            meta.name               || "Unknown Token",
    symbol:          meta.symbol             || "",
    totalScore:      r.totalScore            ?? 0,
    riskLevel:       r.riskLevel             || "UNKNOWN",
    liquidity:       r.liquidity             || "N/A",
    marketCap:       r.marketCap             || "N/A",
    top10:           r.top10                 || "N/A",
    devPercent:      r.devPercent            || window.scanDevPercent || "N/A",
    mintAuthority:   window.scanCreator      === "Renounced" ? "Renounced ✅" : (window.scanCreator ? "Active ⚠️" : "Unknown"),
    freezeAuthority: window.scanFreezeAuth   === "Renounced" ? "Renounced ✅" : (window.scanFreezeAuth ? "Active 🚨" : "Unknown"),
    isPumpFun:       !!window.scanIsPumpFun,
    hasGraduated:    !!window.scanHasGraduated,
    vol24h:          window.scanVol24h       || 0,
    buys24h:         window.scanBuys24h      || 0,
    sells24h:        net.sells               || 0,
    netBuy:          typeof net.net === "number" ? (net.net > 0 ? "+" : "") + net.net + " txns" : "N/A",
    signalScores:    window.scanSignalScores || null,
  };
}

/* ── Main entry point ── */
export async function askSentinel() {
  const scanData = collectScanData();
  if (!scanData.mint || scanData.mint === "N/A") return;

  showSentinelModal(scanData);
  setModalState("loading");

  try {
    const res = await fetch("/.netlify/functions/sentinel", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ scanData }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "HTTP " + res.status);
    }

    const { analysis } = await res.json();
    renderSentinelAnalysis(scanData, analysis);

  } catch (err) {
    console.error("[Sentinel] Error:", err);
    setModalState("error", err.message);
  }
}

/* ══════════════════════════════════════════════
   MODAL
   ══════════════════════════════════════════════ */
function showSentinelModal(scanData) {
  let modal = document.getElementById("sentinelModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "sentinelModal";
    modal.className = "sentinel-overlay";
    modal.innerHTML = `
      <div class="sentinel-modal" id="sentinelModalInner">
        <div class="sentinel-header">
          <div class="sentinel-header-left">
            <div class="sentinel-avatar">
              <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <radialGradient id="sng" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stop-color="#2cffc9"/>
                    <stop offset="100%" stop-color="#0d6e5e"/>
                  </radialGradient>
                </defs>
                <circle cx="20" cy="20" r="20" fill="url(#sng)"/>
                <path d="M20 8 L24 16 L33 17.5 L26.5 24 L28 33 L20 29 L12 33 L13.5 24 L7 17.5 L16 16 Z" fill="#061311" opacity="0.85"/>
                <circle cx="20" cy="20" r="4.5" fill="#2cffc9" opacity="0.95"/>
                <circle cx="20" cy="20" r="2" fill="#061311"/>
                <circle cx="15" cy="17" r="1.5" fill="#2cffc9" opacity="0.8"/>
                <circle cx="25" cy="17" r="1.5" fill="#2cffc9" opacity="0.8"/>
              </svg>
            </div>
            <div>
              <div class="sentinel-name">SENTINEL</div>
              <div class="sentinel-sub">AI Risk Agent · Scan2Moon</div>
            </div>
          </div>
          <button class="sentinel-close" id="sentinelCloseBtn" aria-label="Close">✕</button>
        </div>
        <div class="sentinel-token-bar" id="sentinelTokenBar"></div>
        <div class="sentinel-body" id="sentinelBody"></div>
        <div class="sentinel-footer">
          <span>⚠️ Not financial advice. Always DYOR.</span>
          <span class="sentinel-powered">Powered by Groq AI</span>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById("sentinelCloseBtn").addEventListener("click", closeSentinelModal);
    modal.addEventListener("click", function(e) { if (e.target === modal) closeSentinelModal(); });
  }

  /* Token bar — use modal.querySelector to avoid null if DOM hasn't settled */
  const meta    = window.scanTokenMeta || {};
  const rawLogo = meta.logo || "";
  const logoUrl = rawLogo
    ? "/.netlify/functions/logoProxy?url=" + encodeURIComponent(rawLogo)
    : "https://placehold.co/36x36";

  const tokenBar = modal.querySelector("#sentinelTokenBar");
  if (tokenBar) {
    tokenBar.innerHTML =
      '<img class="sentinel-token-logo" src="' + logoUrl + '" onerror="this.src=\'https://placehold.co/36x36\'" referrerpolicy="no-referrer"/>' +
      '<div class="sentinel-token-info">' +
        '<span class="sentinel-token-name">' + esc(scanData.name) + '</span>' +
        '<span class="sentinel-token-symbol">' + esc(scanData.symbol) + '</span>' +
      '</div>' +
      '<div class="sentinel-token-score-pill ' + scoreClass(scanData.totalScore) + '">' + scanData.totalScore + '/100</div>';
  }

  modal.style.display = "flex";
  document.body.style.overflow = "hidden";
  requestAnimationFrame(function() { modal.classList.add("sentinel-visible"); });
}

function closeSentinelModal() {
  var modal = document.getElementById("sentinelModal");
  if (!modal) return;
  modal.classList.remove("sentinel-visible");
  setTimeout(function() { modal.style.display = "none"; }, 300);
  document.body.style.overflow = "";
}

/* ── Loading / error states ── */
function setModalState(state, errorMsg) {
  var modal = document.getElementById("sentinelModal");
  var body = modal ? modal.querySelector("#sentinelBody") : document.getElementById("sentinelBody");
  if (!body) return;
  if (state === "loading") {
    body.innerHTML =
      '<div class="sentinel-loading">' +
        '<div class="sentinel-pulse-ring"></div>' +
        '<div class="sentinel-loading-text">' +
          '<div class="sentinel-loading-title">Sentinel is analyzing…</div>' +
          '<div class="sentinel-loading-sub">Reading on-chain signals · Checking risk factors · Calculating moon potential</div>' +
        '</div>' +
      '</div>';
  } else if (state === "error") {
    body.innerHTML =
      '<div class="sentinel-error">' +
        '<div class="sentinel-error-icon">⚠️</div>' +
        '<div class="sentinel-error-title">Analysis Failed</div>' +
        '<div class="sentinel-error-msg">' + esc(errorMsg || "Unknown error") + '</div>' +
        '<button class="sentinel-retry-btn" onclick="window.askSentinelRetry()">Try Again</button>' +
      '</div>';
  }
}

/* ── Render full analysis ── */
function renderSentinelAnalysis(scanData, a) {
  var modal = document.getElementById("sentinelModal");
  var body = modal ? modal.querySelector("#sentinelBody") : document.getElementById("sentinelBody");
  if (!body) return;

  var verdictCls = { "SAFE TO APE": "sv-safe", "LOW RISK": "sv-low", "MODERATE RISK": "sv-moderate", "HIGH RISK": "sv-high", "EXTREME DANGER": "sv-extreme" }[a.verdict] || "sv-moderate";
  var moonCls    = { "LOW": "moon-low", "MEDIUM": "moon-medium", "HIGH": "moon-high", "MOONSHOT": "moon-shot" }[(a.moonPotential || {}).rating] || "moon-medium";

  var signalRows = (a.signalBreakdown || []).map(function(s) {
    var cls  = s.status === "good" ? "sb-good" : s.status === "warn" ? "sb-warn" : "sb-bad";
    var icon = s.status === "good" ? "✅" : s.status === "warn" ? "⚠️" : "❌";
    return '<div class="sentinel-signal-row">' +
      '<span class="ss-icon">' + icon + '</span>' +
      '<div class="ss-info"><div class="ss-name">' + esc(s.name) + '</div><div class="ss-explain">' + esc(s.explanation) + '</div></div>' +
      '<div class="ss-score ' + cls + '">' + s.score + '</div>' +
    '</div>';
  }).join("");

  var redFlags   = (a.redFlags   || []).map(function(f) { return '<li class="sentinel-flag red-flag">🚩 ' + esc(f) + '</li>'; }).join("");
  var greenFlags = (a.greenFlags || []).map(function(f) { return '<li class="sentinel-flag green-flag">✅ ' + esc(f) + '</li>'; }).join("");

  var mp = a.moonPotential || {};

  body.innerHTML =
    /* VERDICT */
    '<div class="sentinel-verdict-banner ' + verdictCls + '">' +
      '<span class="sv-emoji">' + (a.verdictEmoji || "🤖") + '</span>' +
      '<div class="sv-text"><div class="sv-label">Sentinel Verdict</div><div class="sv-verdict">' + esc(a.verdict) + '</div></div>' +
    '</div>' +

    /* SUMMARY */
    '<div class="sentinel-section"><div class="sentinel-section-title">📋 Summary</div>' +
    '<p class="sentinel-summary-text">' + esc(a.summary) + '</p></div>' +

    /* FLAGS */
    ((redFlags || greenFlags) ?
    '<div class="sentinel-section sentinel-flags-section">' +
      (redFlags   ? '<div class="sentinel-flags-col"><div class="sentinel-section-title">🚩 Risk Flags</div><ul class="sentinel-flag-list">' + redFlags + '</ul></div>' : '') +
      (greenFlags ? '<div class="sentinel-flags-col"><div class="sentinel-section-title">✅ Positive Signals</div><ul class="sentinel-flag-list">' + greenFlags + '</ul></div>' : '') +
    '</div>' : '') +

    /* SIGNALS */
    (signalRows ?
    '<div class="sentinel-section"><div class="sentinel-section-title">📊 Signal Breakdown</div>' +
    '<div class="sentinel-signals-list">' + signalRows + '</div></div>' : '') +

    /* MOON POTENTIAL */
    '<div class="sentinel-section"><div class="sentinel-section-title">🌕 Moon Potential</div>' +
    '<div class="sentinel-moon-card ' + moonCls + '">' +
      '<div class="moon-card-top">' +
        '<span class="moon-emoji">' + (mp.emoji || "🌕") + '</span>' +
        '<div class="moon-bar-wrap">' +
          '<div class="moon-rating">' + esc(mp.rating || "UNKNOWN") + '</div>' +
          '<div class="moon-score-bar-wrap"><div class="moon-score-bar-fill" style="width:0%" data-target="' + (mp.score || 0) + '%"></div></div>' +
        '</div>' +
        '<span class="moon-score-num">' + (mp.score || 0) + '/100</span>' +
      '</div>' +
      '<p class="moon-reasoning">' + esc(mp.reasoning || "") + '</p>' +
    '</div></div>' +

    /* RECOMMENDATION */
    '<div class="sentinel-section"><div class="sentinel-section-title">🎯 Recommendation</div>' +
    '<div class="sentinel-recommendation">' + esc(a.recommendation) + '</div></div>' +

    /* BEGINNER TIP */
    (a.beginnerTip ?
    '<div class="sentinel-beginner-tip">' +
      '<span class="tip-icon">💡</span>' +
      '<div><div class="tip-label">Beginner Tip</div><div class="tip-text">' + esc(a.beginnerTip) + '</div></div>' +
    '</div>' : '');

  /* Animate moon bar */
  requestAnimationFrame(function() {
    body.querySelectorAll(".moon-score-bar-fill").forEach(function(el) {
      var target = el.getAttribute("data-target") || "0%";
      setTimeout(function() { el.style.width = target; }, 150);
    });
  });
}

/* ── Helpers ── */
function esc(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function scoreClass(s) {
  return s >= 80 ? "pill-moon" : s >= 65 ? "pill-good" : s >= 45 ? "pill-warn" : "pill-bad";
}

/* ── Global hooks ── */
window.askSentinel      = askSentinel;
window.askSentinelRetry = askSentinel;
