/* ============================
   Scan2Moon – Final Score Panel V2.0
   ============================ */
import { t } from "./i18n.js";

/* ── Watchlist helpers (localStorage) ── */
const WL_KEY = "s2m_watchlist";

function isOnWatchlist(mint) {
  try {
    const raw = localStorage.getItem(WL_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return list.some(t => t.mint === mint);
  } catch { return false; }
}

function toggleWatchlist(mint, entry) {
  try {
    const raw  = localStorage.getItem(WL_KEY);
    let list   = raw ? JSON.parse(raw) : [];
    const exists = list.some(t => t.mint === mint);
    if (exists) {
      list = list.filter(t => t.mint !== mint);
    } else {
      list.unshift({ ...entry, savedAt: new Date().toISOString() });
    }
    localStorage.setItem(WL_KEY, JSON.stringify(list));
    return !exists; // true = just added
  } catch { return false; }
}

export async function renderFinalScore() {
  try {
    const r = window.scanResult;
    if (!r) return;

    const meta    = window.scanTokenMeta || {};
    const name    = meta.name   || "Unknown Token";
    const symbol  = meta.symbol || "";
    const rawLogo = meta.logo   || "https://placehold.co/80x80";
    const logoUrl = `/.netlify/functions/logoProxy?url=${encodeURIComponent(rawLogo)}`;
    const mint    = window.scanMint || "";

    const container = document.getElementById("finalScore");
    if (!container) return;

    const now       = new Date();
    const timestamp = now.toLocaleString();

    const scoreClass =
      r.totalScore >= 80 ? "score-moon" :
      r.totalScore >= 65 ? "score-good" :
      r.totalScore >= 45 ? "score-warn" : "score-bad";

    const explainClass =
      r.totalScore >= 65 ? "explain-good" :
      r.totalScore >= 45 ? "explain-warn" : "explain-bad";

    const explanation = generateRiskExplanation(r);

    const liquidity  = r.liquidity  ?? window.scanLiquidity  ?? window.tokenLiquidity  ?? "N/A";
    const top10      = r.top10      ?? window.scanTop10      ?? window.tokenTop10      ?? "N/A";
    const marketCap  = r.marketCap  ?? window.scanMarketCap  ?? window.tokenMarketCap  ?? "N/A";

    const netData = window.scanNetBuyPressure;
    let netPressureDisplay = "N/A";
    let pressureClass = "neutral-pressure";
    let pressureBadge = "NEUTRAL";
    let badgeClass    = "badge-neutral";

    if (netData && typeof netData.net === "number") {
      const net  = netData.net;
      const sign = net > 0 ? "+" : "";
      netPressureDisplay = `${sign}${net} txns`;
      if (net > 0) { pressureClass = "positive-pressure"; pressureBadge = "BULLISH"; badgeClass = "badge-bullish"; }
      else if (net < 0) { pressureClass = "negative-pressure"; pressureBadge = "BEARISH"; badgeClass = "badge-bearish"; }
    }

    const alreadySaved = mint ? isOnWatchlist(mint) : false;

    container.innerHTML = `
      <div class="score-card-pro" id="scoreCard">

        <div class="score-top">
          <div class="token-block">
            <img class="score-logo" id="finalScoreLogo" />
            <div>
              <div class="token-name">${name}</div>
              <div class="token-symbol">${symbol}</div>
            </div>
          </div>
          <div class="scan-time">
            Scan Time<br/>
            <strong>${timestamp}</strong>
          </div>
        </div>

        <div class="score-main-pro ${scoreClass}">
          <span class="score-value-pro">${r.totalScore ?? "N/A"}</span>
          <span class="score-max-pro">/100</span>
        </div>

        <div class="risk-badge-pro${r.totalScore >= 80 ? " risk-badge-moon" : ""}">${r.riskLevel ?? "UNKNOWN"}</div>

        <div class="score-sub-pro">
          Calculated from on-chain and market behavior
        </div>

        <div class="signal-explainer-pro ${explainClass}">
          <strong>${t("explain_risk")}</strong>
          <div class="explain-text">${explanation}</div>
        </div>

        <div class="metrics-row">
          <div class="metric">
            <div class="metric-label">${t("liquidity_label")}</div>
            <div class="metric-value">${liquidity}</div>
          </div>
          <div class="metric">
            <div class="metric-label">${t("top10_label")}</div>
            <div class="metric-value">${top10}</div>
          </div>
          <div class="metric">
            <div class="metric-label">${t("market_cap_label")}</div>
            <div class="metric-value">${marketCap}</div>
          </div>
          <div class="metric">
            <div class="metric-label">${t("net_buy_label")}</div>
            <div class="metric-value ${pressureClass}">
              ${netPressureDisplay}
              <div class="pressure-badge ${badgeClass}">${pressureBadge}</div>
            </div>
          </div>
        </div>

        <!-- ⭐ WATCHLIST BUTTON -->
        ${mint ? `
        <div class="wl-btn-wrap">
          <button class="wl-add-btn ${alreadySaved ? 'wl-saved' : ''}" id="wlToggleBtn">
            ${alreadySaved ? '⭐ Saved to Watchlist' : '☆ Add to Watchlist'}
          </button>
        </div>
        ` : ""}

        <div class="score-footer-pro">
          VERIFIED • SCAN2MOON • scan2moon.com
        </div>

      </div>
    `;

    const logoImg = document.getElementById("finalScoreLogo");
    if (logoImg) {
      logoImg.src = logoUrl;
      await waitForImageLoad(logoImg);
    }

    // Bind watchlist button
    if (mint) {
      const wlBtn = document.getElementById("wlToggleBtn");
      if (wlBtn) {
        wlBtn.addEventListener("click", () => {
          // Build the entry to save
          const avgTxSize = (() => {
            const vol24h  = window.scanVol24h  || 0;
            const buys24h = window.scanBuys24h || 0;
            if (vol24h > 0 && buys24h > 0) {
              const avg = vol24h / buys24h;
              if (avg >= 1000000) return "$" + (avg / 1000000).toFixed(2) + "M";
              if (avg >= 1000)    return "$" + (avg / 1000).toFixed(1) + "K";
              return "$" + avg.toFixed(0);
            }
            return "N/A";
          })();

          const entry = {
            mint,
            name:       meta.name   || "Unknown",
            symbol:     meta.symbol || "",
            logo:       meta.logo   || null,
            totalScore: r.totalScore,
            riskLevel:  r.riskLevel,
            liquidity,
            marketCap,
            top10,
            avgTxSize,
            scannedAt:  new Date().toISOString()
          };

          const added = toggleWatchlist(mint, entry);
          wlBtn.textContent = added ? "⭐ Saved to Watchlist" : "☆ Add to Watchlist";
          wlBtn.classList.toggle("wl-saved", added);

          // Quick visual feedback
          wlBtn.style.transform = "scale(0.96)";
          setTimeout(() => wlBtn.style.transform = "", 150);
        });
      }
    }

    bindTopButtons();

  } catch (err) {
    console.warn("FinalScore render error:", err);
  }
}

/* ============================
   TOP BUTTON BINDER
   ============================ */
function bindTopButtons() {
  const copyBtn = document.getElementById("copyScore");
  const saveBtn = document.getElementById("saveScore");
  const postBtn = document.getElementById("postScore");
  const card    = document.getElementById("scoreCard");
  if (!card) return;

  const name = window.scanTokenMeta?.name || "Token";

  const shareText = `
Scan2Moon Risk Scan 🔍

Score: ${window.scanResult?.totalScore ?? "N/A"}/100
Risk Level: ${window.scanResult?.riskLevel ?? "UNKNOWN"}

We don't shill. We show data.
https://scan2moon.com
`.trim();

  async function generateImage() {
    return await html2canvas(card, { backgroundColor: "#061311", scale: 2, useCORS: true });
  }

  if (copyBtn) {
    copyBtn.onclick = async () => {
      await navigator.clipboard.writeText(shareText);
      copyBtn.innerText = "Copied!";
      setTimeout(() => (copyBtn.innerText = "Copy"), 1500);
    };
  }
  if (saveBtn) {
    saveBtn.onclick = async () => {
      const canvas = await generateImage();
      const link = document.createElement("a");
      link.download = `${name}-Scan2Moon.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    };
  }
  if (postBtn) {
    postBtn.onclick = async () => {
      const canvas = await generateImage();
      const link = document.createElement("a");
      link.download = `${name}-Scan2Moon.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`, "_blank");
    };
  }
}

/* ── Helpers ── */
function waitForImageLoad(img) {
  return new Promise(resolve => {
    if (img.complete) resolve();
    else { img.onload = resolve; img.onerror = resolve; }
  });
}

function generateRiskExplanation(r) {
  if (r.totalScore >= 80) return "🌕 Strong on-chain health. Low rug risk, clean liquidity and healthy holder distribution.";
  if (r.totalScore >= 65) return "Healthy structure. No critical sell pressure or liquidity abuse detected.";
  if (r.totalScore >= 45) return "Mixed signals. Possible liquidity weakness or elevated sell pressure.";
  return "High-risk behavior detected. Strong rug indicators present.";
}