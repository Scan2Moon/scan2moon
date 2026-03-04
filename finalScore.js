/* ============================
   Scan2Moon – Final Score Panel
   FINAL CLEAN VERSION
   (NO CARD BUTTONS – TOP BUTTONS WORK)
   ============================ */

export async function renderFinalScore() {
  try {
    const r = window.scanResult;
    if (!r) return;

    const meta = window.scanTokenMeta || {};
    const name = meta.name || "Unknown Token";
    const symbol = meta.symbol || "";
    const rawLogo = meta.logo || "https://placehold.co/80x80";
    const logoUrl = `/.netlify/functions/logoProxy?url=${encodeURIComponent(rawLogo)}`;

    const container = document.getElementById("finalScore");
    if (!container) return;

    const now = new Date();
    const timestamp = now.toLocaleString();

    const scoreClass =
      r.totalScore >= 70
        ? "score-good"
        : r.totalScore >= 40
        ? "score-warn"
        : "score-bad";

    const explainClass =
      r.totalScore >= 70
        ? "explain-good"
        : r.totalScore >= 40
        ? "explain-warn"
        : "explain-bad";

    const explanation = generateRiskExplanation(r);

    const liquidity =
      r.liquidity ??
      window.scanLiquidity ??
      window.tokenLiquidity ??
      "N/A";

    const top10 =
      r.top10 ??
      window.scanTop10 ??
      window.tokenTop10 ??
      "N/A";

    const marketCap =
      r.marketCap ??
      window.scanMarketCap ??
      window.tokenMarketCap ??
      "N/A";

    /* NET BUY PRESSURE */

    const netData = window.scanNetBuyPressure;

    let netPressureDisplay = "N/A";
    let pressureClass = "neutral-pressure";
    let pressureBadge = "NEUTRAL";
    let badgeClass = "badge-neutral";

    if (netData && typeof netData.net === "number") {
      const net = netData.net;
      const sign = net > 0 ? "+" : "";

      netPressureDisplay = `${sign}${net} txns`;

      if (net > 0) {
        pressureClass = "positive-pressure";
        pressureBadge = "BULLISH";
        badgeClass = "badge-bullish";
      } else if (net < 0) {
        pressureClass = "negative-pressure";
        pressureBadge = "BEARISH";
        badgeClass = "badge-bearish";
      }
    }

    /* RENDER CARD */

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

        <div class="risk-badge-pro">${r.riskLevel ?? "UNKNOWN"}</div>

        <div class="score-sub-pro">
          Calculated from on-chain and market behavior
        </div>

        <div class="signal-explainer-pro ${explainClass}">
          <strong>Explain Risk</strong>
          <div class="explain-text">${explanation}</div>
        </div>

        <div class="metrics-row">

          <div class="metric">
            <div class="metric-label">Liquidity</div>
            <div class="metric-value">${liquidity}</div>
          </div>

          <div class="metric">
            <div class="metric-label">Top 10 Holders</div>
            <div class="metric-value">${top10}</div>
          </div>

          <div class="metric">
            <div class="metric-label">Market Cap</div>
            <div class="metric-value">${marketCap}</div>
          </div>

          <div class="metric">
            <div class="metric-label">Net Buy Pressure (24H)</div>
            <div class="metric-value ${pressureClass}">
              ${netPressureDisplay}
              <div class="pressure-badge ${badgeClass}">
                ${pressureBadge}
              </div>
            </div>
          </div>

        </div>

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

    /* 🔥 IMPORTANT: Bind your real TOP buttons here */
    bindTopButtons();

  } catch (err) {
    console.warn("FinalScore render error:", err);
  }
}

/* ============================
   TOP BUTTON BINDER
   (connects existing buttons)
   ============================ */

function bindTopButtons() {
  const copyBtn = document.getElementById("copyScore");
  const saveBtn = document.getElementById("saveScore");
  const postBtn = document.getElementById("postScore");
  const card = document.getElementById("scoreCard");

  if (!card) return;

  const name = window.scanTokenMeta?.name || "Token";

  const shareText = `
Scan2Moon Risk Scan 🔍

Score: ${window.scanResult?.totalScore ?? "N/A"}/100
Risk Level: ${window.scanResult?.riskLevel ?? "UNKNOWN"}

We don’t shill. We show data.
https://scan2moon.com
`.trim();

  async function generateImage() {
    return await html2canvas(card, {
      backgroundColor: "#061311",
      scale: 2,
      useCORS: true
    });
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

      window.open(
        `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`,
        "_blank"
      );
    };
  }
}

/* ================= HELPERS ================= */

function waitForImageLoad(img) {
  return new Promise((resolve) => {
    if (img.complete) resolve();
    else {
      img.onload = resolve;
      img.onerror = resolve;
    }
  });
}

function generateRiskExplanation(r) {
  if (r.totalScore >= 70) {
    return "Healthy structure. No critical sell pressure or liquidity abuse detected.";
  }
  if (r.totalScore >= 45) {
    return "Mixed signals. Possible liquidity weakness or elevated sell pressure.";
  }
  return "High-risk behavior detected. Strong rug indicators present.";
}