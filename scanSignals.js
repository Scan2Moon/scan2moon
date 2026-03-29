/* ================================================================
   scanSignals.js — Scan2Moon V2.1 Smart Risk Engine
   Starts from real data, penalizes every rug pattern individually.
   ================================================================ */

async function fetchDexData(mint) {
  try {
    const res  = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    const data = await res.json();
    return data.pairs?.find(p => p.chainId === "solana") || data.pairs?.[0] || null;
  } catch { return null; }
}

/* ── Helpers ── */
function pct(v) { return Math.max(0, Math.min(100, Math.round(v))); }

/* ── Bot Noise Detector ────────────────────────────────────────
   Average transaction size is the best proxy we have for bot
   activity. DexScreener gives us total volume and total tx count,
   so we compute: avgTxUsd = vol24h / (buys24 + sells24).

   Bots typically trade $1–$10. Real humans trade $20+.
   Returns 0 (clean — mostly humans) → 1 (all bots).

   This factor is used to deflate bot-inflated tx counts before
   any count-based signal runs its scoring logic.
   ─────────────────────────────────────────────────────────── */
function botNoiseLevel(pair) {
  const vol24  = pair.volume?.h24        ?? 0;
  const buys24 = pair.txns?.h24?.buys   ?? 0;
  const sells24= pair.txns?.h24?.sells  ?? 0;
  const total  = buys24 + sells24;
  if (!total || !vol24) return 0;   // no data → assume clean
  const avgTx  = vol24 / total;
  if (avgTx >= 20) return 0.00;    // $20+  avg → mostly real traders
  if (avgTx >= 15) return 0.20;    // $15+  avg → mild noise
  if (avgTx >= 10) return 0.45;    // $10+  avg → moderate bot activity
  if (avgTx >=  5) return 0.70;    // $5+   avg → heavy bots
  return 0.90;                      // < $5  avg → near-total bot domination
}

/* ================================================================
   SIGNAL MODULES  —  each returns 0-100
   ================================================================ */

/* 1. TOKEN AGE TRUST
   Brand-new tokens have almost no track record and are the
   single biggest predictor of a rug. */
function scoreTokenAge(pair) {
  const created = pair.pairCreatedAt;
  if (!created) return 35; // unknown = moderate risk
  const ageMs   = Date.now() - (created < 1e12 ? created * 1000 : created);
  const ageMins = ageMs / 60000;
  if (ageMins < 10)        return 5;   // < 10 min: extreme danger
  if (ageMins < 30)        return 15;  // < 30 min
  if (ageMins < 60)        return 28;  // < 1 hr
  if (ageMins < 240)       return 45;  // < 4 hr
  if (ageMins < 720)       return 60;  // < 12 hr
  if (ageMins < 1440)      return 72;  // < 24 hr
  if (ageMins < 4320)      return 82;  // < 3 days
  return 90;                           // 3+ days: solid history
}

/* 2. MARKET INTEGRITY
   Detects active dumping — severe price drops are a red flag. */
function scoreMarketIntegrity(pair) {
  const pc5m  = pair.priceChange?.m5  ?? 0;
  const pc1h  = pair.priceChange?.h1  ?? 0;
  const pc6h  = pair.priceChange?.h6  ?? 0;
  const pc24h = pair.priceChange?.h24 ?? 0;
  const buys  = pair.txns?.h1?.buys   ?? 0;
  const sells = pair.txns?.h1?.sells  ?? 0;

  // Deflate bot-inflated buy counts so heavy sell pressure isn't hidden
  const noise      = botNoiseLevel(pair);
  const realBuys   = Math.round(buys * (1 - noise * 0.85));

  if (pc24h <= -85)                                 return 2;
  if (pc24h <= -65 && pc6h <= -30)                  return 5;  // extended collapse
  if (pc24h <= -65)                                 return 8;
  if (pc6h  <= -40)                                 return 10;
  if (pc24h <= -50)                                 return 12;  // -55% = heavily penalised
  if (pc24h <= -40)                                 return 20;  // new tier
  if (sells >= realBuys * 4 && sells > 10)          return 18; // bot-adjusted
  if (pc24h <= -30)                                 return 30;
  if (pc1h  <= -20)                                 return 42;
  if (pc24h <= -15)                                 return 52;
  if (pc5m > 30 && pc24h < 0)                       return 40;
  return 85;
}

/* 3. PUMP DANGER  (new signal — catches pump & dump before it dumps)
   A sudden extreme pump is one of the clearest rug precursors. */
function scorePumpDanger(pair) {
  const pc5m = pair.priceChange?.m5  ?? 0;
  const pc1h = pair.priceChange?.h1  ?? 0;
  const pc6h = pair.priceChange?.h6  ?? 0;
  // High pump = high danger. Score INVERTS: lower number = more danger.
  if (pc5m > 100 || pc1h > 500)    return 5;
  if (pc1h > 200)                   return 15;
  if (pc1h > 100)                   return 28;
  if (pc1h > 50)                    return 45;
  if (pc1h > 20 && pc6h > 100)     return 38;
  if (pc1h > 15)                    return 58;
  if (pc1h > 5)                     return 72;
  if (pc1h >= 0)                    return 82;
  return 85; // declining or flat price = no pump risk right now
}

/* 4. LP STRENGTH
   Low liquidity makes it trivial to drain the pool. */
function scoreLpStrength(pair) {
  const liq = pair.liquidity?.usd ?? 0;
  if (liq < 3000)    return 3;
  if (liq < 8000)    return 12;
  if (liq < 20000)   return 30;
  if (liq < 50000)   return 52;
  if (liq < 120000)  return 68;
  if (liq < 300000)  return 80;
  return 90;
}

/* 5. LP STABILITY  (liquidity vs price volatility) */
function scoreLpStability(pair) {
  const liq = pair.liquidity?.usd ?? 0;
  const pc1h = Math.abs(pair.priceChange?.h1 ?? 0);
  if (liq < 3000)                 return 5;  // effectively drained
  if (liq < 5000)                 return 15; // near-dead: any sell drains pool
  if (liq < 10000 && pc1h > 20)  return 15;
  if (liq < 30000 && pc1h > 20)  return 30;
  if (liq < 50000 && pc1h > 15)  return 45;
  if (liq < 100000 && pc1h > 10) return 60;
  return 85;
}

/* 6. MC / LIQUIDITY RATIO  (price inflation risk)
   If MC is wildly higher than liquidity, the price is artificial
   and one large sell can crash it. */
function scoreMcLiqRatio(pair) {
  const liq = pair.liquidity?.usd ?? 0;
  const mc  = pair.marketCap || pair.fdv || (liq * 8);
  if (!liq || liq < 100) return 20;
  // Near-zero market cap = effectively dead / rugged token
  if (mc < 2000)  return 12;
  if (mc < 5000)  return 22;
  const ratio = mc / liq;
  if (ratio > 200)   return 5;
  if (ratio > 100)   return 15;
  if (ratio > 50)    return 28;
  if (ratio > 20)    return 48;
  if (ratio > 10)    return 65;
  if (ratio > 5)     return 78;
  return 88; // low ratio = healthy
}

/* 7. SELL PRESSURE  (1h window)
   Whales/devs dumping shows up here first.
   Bot trades are deflated so 500 × $1 bot buys don't mask
   5 × $500 real-money sells. */
function scoreSellPressure(pair) {
  const buys1h  = pair.txns?.h1?.buys  ?? 0;
  const sells1h = pair.txns?.h1?.sells ?? 0;
  const total   = buys1h + sells1h;
  if (total < 5) return 45; // too little data

  // Compress the buy/sell ratio toward neutral (0.5) based on bot noise.
  // At full bot noise the ratio becomes meaningless — treat as neutral.
  const noise     = botNoiseLevel(pair);
  const rawRatio  = sells1h / total;
  const adjRatio  = 0.5 + (rawRatio - 0.5) * (1 - noise);

  if (adjRatio > 0.80)  return 8;
  if (adjRatio > 0.70)  return 18;
  if (adjRatio > 0.60)  return 32;
  if (adjRatio > 0.50)  return 48;
  if (adjRatio > 0.40)  return 62;
  if (adjRatio < 0.30)  return 85;
  return 70;
}

/* 8. VOLUME CONSISTENCY  (no ghost-volume tokens) */
function scoreVolumeConsistency(pair) {
  const h1  = pair.volume?.h1  ?? 0;
  const h24 = pair.volume?.h24 ?? 0;
  if (h24 < 500)   return 15;
  if (h24 < 2000)  return 30;
  const avg = h24 / 24;
  if (avg === 0)   return 20;
  const ratio = h1 / avg;
  if (ratio < 0.1) return 20; // barely any volume in last hour
  if (ratio < 0.3) return 38;
  if (ratio < 0.6) return 55;
  if (ratio < 1.0) return 70;
  return 85;
}

/* 9. DEV BEHAVIOR  (sell pressure + on-chain context from mainAnalysis) */
function scoreDevBehavior(pair) {
  const sells = pair.txns?.h1?.sells ?? 0;
  const buys  = pair.txns?.h1?.buys  ?? 0;
  const pc1h  = pair.priceChange?.h1  ?? 0;

  // Use on-chain data from main scan if available
  const mintActive    = window.scanCreator   && window.scanCreator   !== "Renounced";
  const freezeActive  = window.scanFreezeAuth && window.scanFreezeAuth !== "Renounced";
  const devPctNum     = parseFloat(window.scanDevPercent) || 0;

  let score = 80;
  if (mintActive)                     score -= 20; // dev can mint more
  if (freezeActive)                   score -= 25; // dev can freeze accounts
  if (devPctNum > 15)                 score -= 25;
  else if (devPctNum > 5)             score -= 12;
  else if (devPctNum > 2)             score -= 5;

  // Deflate bot-inflated buy counts so dev dumps aren't hidden
  const noise    = botNoiseLevel(pair);
  const realBuys = Math.round(buys * (1 - noise * 0.85));
  if (sells > realBuys * 3 && pc1h < -15) score -= 20; // likely dev dumping
  else if (sells > realBuys * 2)           score -= 10;

  return pct(score);
}

/* 10. VOLUME / MCAP RATIO  (dump churn detector)
   High volume relative to market cap during a price decline is one
   of the clearest signals of an active dump. Whales are churning
   out while bots/retail cycle in and immediately lose.
   Normal healthy tokens: vol24 ≈ 10-50% of mcap.
   Dump in progress:      vol24 > 5× mcap AND price falling. */
function scoreVolMcapRatio(pair) {
  const vol24 = pair.volume?.h24 ?? 0;
  const mc    = pair.marketCap || pair.fdv || 0;
  const pc24h = pair.priceChange?.h24 ?? 0;
  if (!mc || mc < 500) return 35; // can't compute → caution
  // Dead token: near-zero volume on a tiny market cap = abandoned/rugged
  if (vol24 < 100 && mc < 10000)  return 12;
  if (vol24 < 500 && mc < 5000)   return 18;
  const ratio = vol24 / mc;
  // Extreme churn while price collapses = active dump
  if (ratio > 30 && pc24h < -20)  return 5;   // 30× turnover + heavy drop = rug
  if (ratio > 15 && pc24h < -10)  return 12;
  if (ratio > 5  && pc24h < -5)   return 25;
  // High turnover without a decline can also signal pump-and-dump setup
  if (ratio > 20)                  return 20;
  if (ratio > 5)                   return 55;
  if (ratio > 1)                   return 75;
  return 82; // low turnover = healthy
}

/* ================================================================
   SHARED PURE SCORER  — used by Risk Scanner, Entry Radar, Safe Ape
   Returns a single 5-95 risk score from a DexScreener pair object.
   Pass top10Pct (on-chain top-10 holder %) for full accuracy —
   Risk Scanner provides this; Entry Radar omits it (no per-token RPC).
   ================================================================ */
export function computeRiskScore(pair, top10Pct = 0) {
  if (!pair) return 10;

  const ageTrust      = scoreTokenAge(pair);
  const integrity     = scoreMarketIntegrity(pair);
  const pumpDanger    = scorePumpDanger(pair);
  const lpStrength    = scoreLpStrength(pair);
  const lpStability   = scoreLpStability(pair);
  const mcLiqRatio    = scoreMcLiqRatio(pair);
  const sellPressure  = scoreSellPressure(pair);
  const volumeConsist = scoreVolumeConsistency(pair);
  const devBehavior   = scoreDevBehavior(pair);
  const volMcapRatio  = scoreVolMcapRatio(pair);

  let totalScore = Math.round(
    ageTrust      * 0.18 +
    integrity     * 0.15 +
    pumpDanger    * 0.12 +
    lpStrength    * 0.10 +
    mcLiqRatio    * 0.10 +
    sellPressure  * 0.10 +
    devBehavior   * 0.09 +
    lpStability   * 0.06 +
    volumeConsist * 0.05 +
    volMcapRatio  * 0.05
  );

  // Hard overrides for extreme danger — tokens this far down can never be "moderate"
  const pc24h = pair.priceChange?.h24 ?? 0;
  if (pc24h <= -80)  totalScore = Math.min(totalScore, 22);
  if (pc24h <= -50)  totalScore = Math.min(totalScore, 32);  // -55% = HIGH at most
  if (pc24h <= -30)  totalScore = Math.min(totalScore, 46);  // -30% = borderline HIGH
  if (ageTrust <= 5) totalScore = Math.min(totalScore, 30);

  // Dead token override: near-zero volume + tiny liquidity = rugged/abandoned
  const _vol24 = pair.volume?.h24    ?? 0;
  const _liq   = pair.liquidity?.usd ?? 0;
  if (_vol24 < 100 && _liq < 10000) totalScore = Math.min(totalScore, 28);
  if (_vol24 < 500 && _liq <  5000) totalScore = Math.min(totalScore, 30);

  // On-chain top-10 holder concentration (only when Risk Scanner provides it)
  if (top10Pct >= 95) totalScore = Math.min(totalScore, 22);
  else if (top10Pct >= 85) totalScore = Math.min(totalScore, 35);
  else if (top10Pct >= 70) totalScore = Math.min(totalScore, 50);

  return Math.max(5, Math.min(95, totalScore));
}

/* ================================================================
   MAIN RENDER
   ================================================================ */
export async function renderSignals(mint) {
  const pair = await fetchDexData(mint);
  if (!pair) {
    document.getElementById("scanSignals").innerHTML =
      `<div class="signals-error">⚠️ Could not fetch market data</div>`;
    window.scanResult = { totalScore: 10, riskLevel: "HIGH RUG RISK", liquidity: "N/A", marketCap: "N/A", top10: "N/A" };
    return;
  }

  /* ── Compute all signals ── */
  const ageTrust      = scoreTokenAge(pair);
  const integrity     = scoreMarketIntegrity(pair);
  const pumpDanger    = scorePumpDanger(pair);
  const lpStrength    = scoreLpStrength(pair);
  const lpStability   = scoreLpStability(pair);
  const mcLiqRatio    = scoreMcLiqRatio(pair);
  const sellPressure  = scoreSellPressure(pair);
  const volumeConsist = scoreVolumeConsistency(pair);
  const devBehavior   = scoreDevBehavior(pair);
  const volMcapRatio  = scoreVolMcapRatio(pair);

  /* ── Weighted final score ──
     Weights reflect how predictive each signal is for rugs. */
  const signals = [
    { label: "Token Age Trust",         score: ageTrust,      weight: 0.18 },
    { label: "Market Integrity",        score: integrity,     weight: 0.15 },
    { label: "Pump Danger",             score: pumpDanger,    weight: 0.12 },
    { label: "LP Strength",             score: lpStrength,    weight: 0.10 },
    { label: "MC / Liquidity Ratio",    score: mcLiqRatio,    weight: 0.10 },
    { label: "Sell Pressure (1h)",      score: sellPressure,  weight: 0.10 },
    { label: "Dev Behavior",            score: devBehavior,   weight: 0.09 },
    { label: "LP Stability",            score: lpStability,   weight: 0.06 },
    { label: "Volume Consistency",      score: volumeConsist, weight: 0.05 },
    { label: "Vol / MCap Ratio",        score: volMcapRatio,  weight: 0.05 },
  ];

  // Delegate final score to computeRiskScore (single source of truth)
  // Pass top-10 holder % from on-chain data so all overrides apply consistently
  const top10Pct = parseFloat(window.scanTop10) || 0;
  let totalScore = computeRiskScore(pair, top10Pct);

  /* ── Net buy pressure for display ── */
  const buys24  = pair.txns?.h24?.buys  ?? 0;
  const sells24 = pair.txns?.h24?.sells ?? 0;
  window.scanNetBuyPressure = { net: buys24 - sells24, buys: buys24, sells: sells24 };

  /* ── Volume/buys for other panels ── */
  window.scanVol24h  = pair.volume?.h24   ?? 0;
  window.scanBuys24h = pair.txns?.h24?.buys ?? 0;

  const riskLevel =
    totalScore >= 80 ? "🌕 MOON COIN" :
    totalScore >= 65 ? "LOW RUG RISK" :
    totalScore >= 45 ? "MODERATE RISK" :
    totalScore >= 25 ? "HIGH RUG RISK" : "EXTREME RISK 🚨";

  /* ── Format helpers ── */
  function fmtUsd(v) {
    if (!v) return "N/A";
    if (v >= 1e9) return "$" + (v/1e9).toFixed(2) + "B";
    if (v >= 1e6) return "$" + (v/1e6).toFixed(2) + "M";
    if (v >= 1e3) return "$" + (v/1e3).toFixed(2) + "K";
    return "$" + v.toFixed(0);
  }

  window.scanResult = {
    totalScore,
    riskLevel,
    liquidity:  fmtUsd(pair.liquidity?.usd ?? 0),
    marketCap:  fmtUsd(pair.marketCap || pair.fdv || 0),
    top10:      window.scanTop10 || "N/A",
    devPercent: window.scanDevPercent || "N/A",
  };
  window.scanLiquidity = window.scanResult.liquidity;

  document.getElementById("scanSignals").innerHTML = `
    <div class="signals-table">
      ${signals.map(s => {
        const state = s.score >= 65 ? "good" : s.score >= 45 ? "warn" : "bad";
        return `
        <div class="signal-row ${state}">
          <div class="signal-label">${s.label}</div>
          <div class="signal-score">${s.score}</div>
          <div class="signal-bar">
            <div class="signal-fill" style="width:${s.score}%"></div>
          </div>
        </div>`;
      }).join("")}
    </div>
  `;
}
