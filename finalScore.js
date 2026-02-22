export function renderFinalScore() {
  const r = window.scanResult;
  if (!r) return;

  const meta = window.scanTokenMeta || {};
  const name = meta.name || "Unknown Token";
  const logo = meta.logo || "https://placehold.co/56x56";

  const explanation = generateRiskExplanation(r);

  const shareText = `
Scan2Moon Risk Scan 🔍
${name}

Score: ${r.totalScore}/100
Risk Level: ${r.riskLevel}

On-chain risk intelligence. No hype. Just data.

Scan your next token before you ape.
👉 https://scan2moon.com/

Verified by Scan2Moon 🚀
`.trim();

  const container = document.getElementById("finalScore");
  if (!container) return;

  container.innerHTML = `
    <div class="score-card" id="scoreCard">
      <div class="score-content">
        <div class="score-header">
          <img class="score-logo" src="${logo}" />
          <div class="score-meta">
            <div class="score-token">${name}</div>
            <div class="score-badge">${r.riskLevel}</div>
          </div>
        </div>

        <div class="score-main ${
          r.totalScore >= 70
            ? "score-good"
            : r.totalScore >= 40
            ? "score-warn"
            : "score-bad"
        }">
          <span class="score-value">${r.totalScore}</span>
          <span class="score-max">/100</span>
        </div>

        <div class="score-sub">
          Calculated from on-chain and market behavior
        </div>

        <div class="signal-explainer">
          <strong>Explain Risk</strong><br />
          ${explanation}
        </div>

        <div class="score-footer">VERIFIED • SCAN2MOON</div>
      </div>
    </div>
  `;

  bindFinalScoreButtons(shareText, name);
}

/* ================= BUTTONS FIXED ================= */

function bindFinalScoreButtons(shareText, name) {
  const copyBtn = document.getElementById("copyScore");
  const saveBtn = document.getElementById("saveScore");
  const postBtn = document.getElementById("postScore");

  const card = document.getElementById("scoreCard");

  if (!card) return;

  /* COPY */
  if (copyBtn) {
    copyBtn.onclick = async () => {
      await navigator.clipboard.writeText(shareText);
      copyBtn.innerText = "Copied!";
      setTimeout(() => (copyBtn.innerText = "Copy"), 1500);
    };
  }

  /* SAVE IMAGE */
  if (saveBtn) {
    saveBtn.onclick = async () => {
      const canvas = await html2canvas(card, {
        backgroundColor: "#020806",   // ✅ FIXED
        scale: 2,
        useCORS: true                 // ✅ ensures background loads properly
      });

      const link = document.createElement("a");
      link.download = `${name}-Scan2Moon.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    };
  }

  /* POST TO X */
  if (postBtn) {
    postBtn.onclick = async () => {
      const canvas = await html2canvas(card, {
        backgroundColor: "#020806",   // ✅ FIXED
        scale: 2,
        useCORS: true                 // ✅ ensures background loads properly
      });

      const imageData = canvas.toDataURL("image/png");

      const link = document.createElement("a");
      link.download = `${name}-Scan2Moon.png`;
      link.href = imageData;
      link.click();

      window.open(
        `https://twitter.com/intent/tweet?text=${encodeURIComponent(
          shareText
        )}`,
        "_blank"
      );

      const current = Number(localStorage.getItem("s2m_shared") || 0);
      localStorage.setItem("s2m_shared", current + 1);
    };
  }
}

/* ================= EXPLAIN ================= */

function generateRiskExplanation(r) {
  if (r.totalScore >= 70) {
    return "Healthy structure. No critical sell pressure or liquidity abuse detected.";
  }
  if (r.totalScore >= 45) {
    return "Mixed signals. Possible liquidity weakness or elevated sell pressure.";
  }
  return "High-risk behavior detected. Strong rug indicators present.";
}
