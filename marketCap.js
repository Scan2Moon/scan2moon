// marketCap.js – Scan2Moon V2.0 – Professional Live Market Cap

let mcInterval = null;
let mcChartInstance = null;
let mcPoints = [];
let mcLabels = [];
let mcBaseValue = null;
let mcStartValue = null;
let mcBasePrice = 0.0001;

export function stopMarketCap() {
  if (mcInterval) { clearInterval(mcInterval); mcInterval = null; }
  if (mcChartInstance) { mcChartInstance.destroy(); mcChartInstance = null; }
  mcPoints = []; mcLabels = []; mcBaseValue = null; mcStartValue = null;
}

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
  if (!v) return "N/A";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(3)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(3)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(2)}K`;
  return `$${v.toFixed(0)}`;
}

function formatPrice(v) {
  if (!v) return "N/A";
  if (v < 0.000001) return `$${v.toFixed(10)}`;
  if (v < 0.001) return `$${v.toFixed(7)}`;
  if (v < 1) return `$${v.toFixed(5)}`;
  return `$${v.toFixed(4)}`;
}

export function renderMarketCap(mint) {
  const container = document.getElementById("marketCap");
  if (!container) return;

  container.innerHTML = `
    <div class="mc-pro-card">
      <div class="mc-top-row">
        <div class="mc-price-block">
          <div class="mc-price-label">Token Price</div>
          <div class="mc-price-value" id="mcPriceVal">—</div>
        </div>
        <div class="mc-change-block">
          <div class="mc-change-badge" id="mcChangeBadge">—</div>
          <div class="mc-change-label">since scan</div>
        </div>
      </div>
      <div class="mc-stats-row">
        <div class="mc-stat-pill">
          <div class="mc-stat-label">Market Cap</div>
          <div class="mc-stat-val" id="mcCapVal">—</div>
        </div>
        <div class="mc-stat-pill">
          <div class="mc-stat-label">Session High</div>
          <div class="mc-stat-val mc-high" id="mcHighVal">—</div>
        </div>
        <div class="mc-stat-pill">
          <div class="mc-stat-label">Session Low</div>
          <div class="mc-stat-val mc-low" id="mcLowVal">—</div>
        </div>
      </div>
      <div class="mc-chart-wrap">
        <canvas id="mcChartCanvas"></canvas>
      </div>
      <div class="mc-footer-row">
        <span class="mc-live-dot"></span>
        <span class="mc-live-label">LIVE</span>
        <span class="mc-footer-note">Updates every 1.2s • Simulated from base price</span>
      </div>
    </div>
  `;

  setTimeout(() => initMcChart(), 60);
}

function initMcChart() {
  const canvas = document.getElementById("mcChartCanvas");
  if (!canvas || typeof Chart === "undefined") return;

  const mcText = document.querySelector(
    "#mainAnalysis .analysis-table .row:nth-child(4) strong"
  )?.innerText;
  mcBaseValue  = parseMarketCap(mcText) || 50000;
  mcStartValue = mcBaseValue;

  const priceText = document.querySelector(
    "#tokenStats .stat-item:first-child strong"
  )?.innerText;
  mcBasePrice = parseFloat((priceText || "0").replace(/[^0-9.e\-]/g, "")) || 0.0001;
  let lastPrice = mcBasePrice;

  let lastVal = mcBaseValue;
  const now = Date.now();
  for (let i = 9; i >= 0; i--) {
    const jitter = lastVal * (Math.random() * 0.002 - 0.001);
    lastVal = Math.max(1, lastVal + jitter);
    mcPoints.push(lastVal);
    const t = new Date(now - i * 1200);
    mcLabels.push(t.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
  }
  mcPoints[mcPoints.length - 1] = mcBaseValue;

  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 0, 150);
  gradient.addColorStop(0, "rgba(44,255,201,0.18)");
  gradient.addColorStop(1, "rgba(44,255,201,0.00)");

  mcChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels: mcLabels,
      datasets: [{
        data: mcPoints,
        borderColor: "#2cffc9",
        backgroundColor: gradient,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: "#2cffc9",
        tension: 0.45,
        fill: true,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300, easing: "easeOutQuart" },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(4,18,14,0.97)",
          borderColor: "rgba(44,255,201,0.3)",
          borderWidth: 1,
          titleColor: "rgba(207,255,244,0.5)",
          bodyColor: "#2cffc9",
          bodyFont: { weight: "700", size: 13 },
          callbacks: { label: c => "  " + formatMC(c.raw) }
        }
      },
      scales: {
        x: { display: false },
        y: {
          position: "right",
          ticks: { color: "rgba(207,255,244,0.3)", font: { size: 10 }, maxTicksLimit: 4, callback: v => formatMC(v) },
          grid:  { color: "rgba(44,255,201,0.05)", drawBorder: false }
        }
      }
    }
  });

  updateMcUI(mcBaseValue, lastPrice);

  mcInterval = setInterval(() => {
    if (!mcChartInstance) return;

    const jitter = mcBaseValue * (Math.random() * 0.003 - 0.0015);
    mcBaseValue = Math.max(1, mcBaseValue + jitter);

    const priceJitter = lastPrice * (Math.random() * 0.003 - 0.0015);
    lastPrice = Math.max(0.000001, lastPrice + priceJitter);

    mcPoints.push(mcBaseValue);
    if (mcPoints.length > 60) mcPoints.shift();
    const nowLabel = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    mcLabels.push(nowLabel);
    if (mcLabels.length > 60) mcLabels.shift();

    const isUp = mcBaseValue >= (mcPoints[0] || mcBaseValue);
    const lineColor = isUp ? "#2cffc9" : "#ff4d6d";
    mcChartInstance.data.datasets[0].borderColor = lineColor;
    const newGrad = ctx.createLinearGradient(0, 0, 0, 150);
    newGrad.addColorStop(0, isUp ? "rgba(44,255,201,0.15)" : "rgba(255,77,109,0.15)");
    newGrad.addColorStop(1, "rgba(0,0,0,0)");
    mcChartInstance.data.datasets[0].backgroundColor = newGrad;
    mcChartInstance.update("none");

    updateMcUI(mcBaseValue, lastPrice);
  }, 1200);
}

function updateMcUI(mcVal, price) {
  const priceEl = document.getElementById("mcPriceVal");
  if (priceEl) priceEl.textContent = formatPrice(price);

  const capEl = document.getElementById("mcCapVal");
  if (capEl) capEl.textContent = formatMC(mcVal);

  if (mcPoints.length > 0) {
    const high = Math.max(...mcPoints);
    const low  = Math.min(...mcPoints);
    const highEl = document.getElementById("mcHighVal");
    const lowEl  = document.getElementById("mcLowVal");
    if (highEl) highEl.textContent = formatMC(high);
    if (lowEl)  lowEl.textContent  = formatMC(low);
  }

  const changeBadge = document.getElementById("mcChangeBadge");
  if (changeBadge && mcStartValue) {
    const pct  = ((mcVal - mcStartValue) / mcStartValue) * 100;
    const sign = pct >= 0 ? "+" : "";
    changeBadge.textContent = `${sign}${pct.toFixed(3)}%`;
    changeBadge.className   = `mc-change-badge ${pct >= 0 ? "mc-up" : "mc-down"}`;
  }
}