async function fetchDexData(mint) {
  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${mint}`
    );
    const data = await res.json();
    return (
      data.pairs?.find(p => p.chainId === "solana") ||
      data.pairs?.[0] ||
      null
    );
  } catch {
    return null;
  }
}

/* ================= CORE MARKET INTEGRITY ================= */

async function fetchMarketIntegrity(mint) {
  const pair = await fetchDexData(mint);
  if (!pair) return 40;

  const pc1h = pair.priceChange?.h1 ?? 0;
  const pc6h = pair.priceChange?.h6 ?? 0;
  const pc24h = pair.priceChange?.h24 ?? 0;
  const buys = pair.txns?.h1?.buys ?? 0;
  const sells = pair.txns?.h1?.sells ?? 0;

  let flags = 0;

  if (pc24h <= -85) return 0;
  if (pc6h <= -35 && pc24h <= -60) flags++;
  if (sells >= buys * 4 && sells > 20) flags++;

  if (flags >= 2) return 10;
  if (pc24h <= -50) return 20;
  if (pc24h <= -30) return 35;
  if (pc1h <= -15) return 50;
  return 85;
}

/* ================= LIQUIDITY LOGIC ================= */

async function fetchLpStrength(mint) {
  const pair = await fetchDexData(mint);
  if (!pair) return 30;

  const liq = pair.liquidity?.usd ?? 0;
  if (liq < 8000) return 10;
  if (liq < 30000) return 30;
  if (liq < 120000) return 60;
  return 85;
}

async function fetchLpStability(mint) {
  const pair = await fetchDexData(mint);
  if (!pair) return 40;

  const liq = pair.liquidity?.usd ?? 0;
  const pc1h = Math.abs(pair.priceChange?.h1 ?? 0);

  if (liq < 15000 && pc1h > 20) return 20;
  if (liq < 50000 && pc1h > 15) return 40;
  if (liq < 100000 && pc1h > 10) return 60;
  return 85;
}

/* ================= VOLUME ================= */

async function fetchVolumeConsistency(mint) {
  const pair = await fetchDexData(mint);
  if (!pair) return 40;

  const h1 = pair.volume?.h1 ?? 0;
  const h24 = pair.volume?.h24 ?? 0;
  if (h24 === 0) return 20;

  const ratio = h1 / (h24 / 24);
  if (ratio < 0.2) return 25;
  if (ratio < 0.5) return 45;
  if (ratio < 0.8) return 65;
  return 85;
}

/* ================= HOLDER RISK (FIXED - NO SOLSCAN) ================= */

async function fetchHolderConcentration(mint) {
  const pair = await fetchDexData(mint);
  if (!pair) return 40;

  // Use liquidity + tx imbalance as proxy risk
  const liquidity = pair.liquidity?.usd ?? 0;
  const buys = pair.txns?.h1?.buys ?? 0;
  const sells = pair.txns?.h1?.sells ?? 0;

  if (liquidity < 10000) return 20;
  if (liquidity < 30000) return 40;

  if (sells > buys * 3) return 35;
  if (sells > buys * 2) return 55;

  if (liquidity > 150000) return 85;
  return 70;
}

/* ================= DEV BEHAVIOR ================= */

async function fetchDevBehavior(mint) {
  const pair = await fetchDexData(mint);
  if (!pair) return 50;

  const sells = pair.txns?.h1?.sells ?? 0;
  const buys = pair.txns?.h1?.buys ?? 0;
  const pc1h = pair.priceChange?.h1 ?? 0;

  if (sells > buys * 3 && pc1h < -20) return 20;
  if (sells > buys * 2) return 45;
  if (pc1h < -10) return 60;
  return 85;
}

/* ================= BULLISH RECOVERY SIGNALS ================= */

async function fetchDipAbsorption(mint) {
  const pair = await fetchDexData(mint);
  if (!pair) return 40;

  const pc1h = pair.priceChange?.h1 ?? 0;
  const buys = pair.txns?.h1?.buys ?? 0;
  const sells = pair.txns?.h1?.sells ?? 0;

  if (pc1h < -10 && buys > sells * 1.5) return 85;
  if (pc1h < -5 && buys > sells) return 70;
  if (buys > sells) return 60;
  return 40;
}

async function fetchReversalVolume(mint) {
  const pair = await fetchDexData(mint);
  if (!pair) return 40;

  const pc1h = pair.priceChange?.h1 ?? 0;
  const h1 = pair.volume?.h1 ?? 0;
  const h24 = pair.volume?.h24 ?? 0;

  if (h24 === 0) return 30;

  const avg = h24 / 24;

  if (pc1h > 0 && h1 > avg * 2) return 85;
  if (pc1h > 0 && h1 > avg * 1.4) return 70;
  if (h1 > avg) return 60;
  return 40;
}

async function fetchHigherLowStructure(mint) {
  const pair = await fetchDexData(mint);
  if (!pair) return 40;

  const pc6h = pair.priceChange?.h6 ?? 0;
  const pc24h = pair.priceChange?.h24 ?? 0;

  if (pc24h < -40 && pc6h > -10) return 80;
  if (pc24h < -25 && pc6h > 0) return 75;
  if (pc6h > 0) return 65;
  return 45;
}

/* ================= SCORE DEGRADATION ================= */

function degradationMultiplier(mi) {
  if (mi >= 80) return 1;
  if (mi >= 55) return 0.8;
  if (mi >= 35) return 0.55;
  if (mi >= 20) return 0.35;
  return 0.2;
}

/* ================= RENDER ================= */

export async function renderSignals(mint) {
  const pair = await fetchDexData(mint);
  const pc24h = pair?.priceChange?.h24 ?? 0;

  const marketIntegrity = await fetchMarketIntegrity(mint);
  const degrade = degradationMultiplier(marketIntegrity);

  const lpStrength = await fetchLpStrength(mint);
  const lpStability = await fetchLpStability(mint);
  const volumeConsistency = await fetchVolumeConsistency(mint);
  const holderRisk = await fetchHolderConcentration(mint);
  const devBehavior = await fetchDevBehavior(mint);

  const dipAbsorption = await fetchDipAbsorption(mint);
  const reversalVolume = await fetchReversalVolume(mint);
  const higherLow = await fetchHigherLowStructure(mint);

  let signals = [
    { label: "Market Integrity", score: marketIntegrity, weight: 0.18 },
    { label: "LP Strength", score: lpStrength, weight: 0.1 },
    { label: "LP Stability", score: lpStability, weight: 0.08 },
    { label: "Volume Consistency", score: volumeConsistency, weight: 0.08 },
    { label: "Holder Risk Pattern", score: holderRisk, weight: 0.08 },
    { label: "Dev Behavior", score: devBehavior, weight: 0.08 },
    { label: "Dip Absorption", score: dipAbsorption, weight: 0.1 },
    { label: "Reversal Volume", score: reversalVolume, weight: 0.1 },
    { label: "Higher Low Structure", score: higherLow, weight: 0.1 },
    { label: "Community Sentiment", score: 70, weight: 0.05 },
    { label: "Smart Money", score: 75, weight: 0.05 }
  ].map(s => ({
    ...s,
    score: Math.round(s.score * degrade)
  }));

  let totalScore = Math.round(
    signals.reduce((a, s) => a + s.score * s.weight, 0)
  );

  if (pc24h <= -80) {
    totalScore = Math.min(totalScore, 35);
  }

  const riskLevel =
    totalScore >= 70
      ? "LOW RUG RISK"
      : totalScore >= 45
      ? "MODERATE RISK"
      : "HIGH RUG RISK";

  window.scanResult = { totalScore, riskLevel };

  document.getElementById("scanSignals").innerHTML = `
    <div class="signals-table">
      ${signals
        .map(s => {
          const state =
            s.score >= 70 ? "good" : s.score >= 40 ? "warn" : "bad";
          return `
          <div class="signal-row ${state}">
            <div class="signal-label">${s.label}</div>
            <div class="signal-score">${s.score}</div>
            <div class="signal-bar">
              <div class="signal-fill" style="width:${s.score}%"></div>
            </div>
          </div>`;
        })
        .join("")}
    </div>
  `;
}
