let mcInterval = null;
let mcPoints = [];

export function stopMarketCap() {
  if (mcInterval) {
    clearInterval(mcInterval);
    mcInterval = null;
  }
  mcPoints = [];
}

export function renderMarketCap() {
  const container = document.getElementById("marketCap");
  if (!container) return;

  container.innerHTML = `
    <canvas id="mcCanvas"></canvas>
    <div class="mc-value" id="mcValue">—</div>
  `;

  const canvas = document.getElementById("mcCanvas");
  const ctx = canvas.getContext("2d");

  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight;

  function parseMarketCap(text) {
    if (!text) return null;

    const value = parseFloat(text.replace(/[^0-9.]/g, ""));
    if (isNaN(value)) return null;

    if (text.includes("B")) return value * 1_000_000_000;
    if (text.includes("M")) return value * 1_000_000;
    if (text.includes("K")) return value * 1_000;
    return value;
  }

  function formatMC(v) {
    if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
    if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
    if (v >= 1e3) return `$${(v / 1e3).toFixed(2)}K`;
    return `$${v.toFixed(0)}`;
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const max = Math.max(...mcPoints);
    const min = Math.min(...mcPoints);

    ctx.beginPath();
    mcPoints.forEach((v, i) => {
      const x = (i / (mcPoints.length - 1)) * canvas.width;
      const y =
        canvas.height -
        ((v - min) / (max - min || 1)) * canvas.height * 0.85 -
        10;

      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });

    ctx.strokeStyle = "#2cffc9";
    ctx.lineWidth = 2;
    ctx.shadowBlur = 14;
    ctx.shadowColor = "#2cffc9";
    ctx.stroke();
  }

  stopMarketCap();

  mcInterval = setInterval(() => {
    const mcText = document.querySelector(
      "#mainAnalysis .analysis-table .row:nth-child(4) strong"
    )?.innerText;

    const baseValue = parseMarketCap(mcText);
    if (!baseValue) return;

    // 🔥 realistic live fluctuation ±0.15%
    const jitter = baseValue * (Math.random() * 0.003 - 0.0015);
    const liveValue = baseValue + jitter;

    mcPoints.push(liveValue);
    if (mcPoints.length > 32) mcPoints.shift();

    draw();
    document.getElementById("mcValue").innerText = formatMC(liveValue);
  }, 1200);
}
