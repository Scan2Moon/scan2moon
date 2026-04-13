/* ================================================================
   scanSignals.js — Scan2Moon V2.2 Smart Risk Engine

   KEY FIX V2.2:
   - Smart pair selection: prefers real DEX (Raydium/Orca) over
     pump.fun bonding curve. Pump.fun shows "virtual" liquidity
     ($30K+) that is NOT real exit liquidity — this was causing
     rugs to score as Moon Coins.
   - New signal #11: Pump.fun Launch Risk
   - Strengthened hard overrides for extreme MC/Liq ratios and
     dangerously low real liquidity.
   ================================================================ */

import { t, applyTranslations } from "./i18n.js";

/* ── Pair selection (internal) ── */
async function fetchDexData(mint) {
  try {
    const res  = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    const data = await res.json();
    if (!data.pairs || data.pairs.length === 0) return null;

    /* Delegate to the exported smart picker — single source of truth */
    const { pair, isPumpFun, hasGraduated } = pickSmartPair(mint, data.pairs);
    window.scanIsPumpFun    = isPumpFun;
    window.scanHasGraduated = hasGraduated;
    return pair;
  } catch { return null; }
}

/* ── Helpers ── */
function pct(v) { return Math.max(0, Math.min(100, Math.round(v))); }

/* ── Bot Noise Detector ────────────────────────────────────────
   Average transaction size is the best proxy we have for bot
   activity. DexScreener gives us total volume and total tx count,
   so we compute: avgTxUsd = vol24h / (buys24 + sells24).
   Returns 0 (clean) → 1 (all bots).
   ─────────────────────────────────────────────────────────── */
function botNoiseLevel(pair) {
  const vol24  = pair.volume?.h24       ?? 0;
  const buys24 = pair.txns?.h24?.buys  ?? 0;
  const sells24= pair.txns?.h24?.sells ?? 0;
  const total  = buys24 + sells24;
  if (!total || !vol24) return 0;
  const avgTx = vol24 / total;
  if (avgTx >= 20) return 0.00;
  if (avgTx >= 15) return 0.20;
  if (avgTx >= 10) return 0.45;
  if (avgTx >=  5) return 0.70;
  return 0.90;
}

/* ================================================================
   SIGNAL MODULES  —  each returns 0-100
   ================================================================ */

/* 1. TOKEN AGE TRUST */
function scoreTokenAge(pair) {
  const created = pair.pairCreatedAt;
  if (!created) return 35;
  const ageMs   = Date.now() - (created < 1e12 ? created * 1000 : created);
  const ageMins = ageMs / 60000;
  if (ageMins <  10)   return 5;
  if (ageMins <  30)   return 15;
  if (ageMins <  60)   return 28;
  if (ageMins < 240)   return 45;
  if (ageMins < 720)   return 60;
  if (ageMins < 1440)  return 72;
  if (ageMins < 4320)  return 82;
  return 90;
}

/* 2. MARKET INTEGRITY — detects active dumping */
function scoreMarketIntegrity(pair) {
  const pc5m  = pair.priceChange?.m5  ?? 0;
  const pc1h  = pair.priceChange?.h1  ?? 0;
  const pc6h  = pair.priceChange?.h6  ?? 0;
  const pc24h = pair.priceChange?.h24 ?? 0;
  const buys  = pair.txns?.h1?.buys   ?? 0;
  const sells = pair.txns?.h1?.sells  ?? 0;

  const noise    = botNoiseLevel(pair);
  const realBuys = Math.round(buys * (1 - noise * 0.85));

  if (pc24h <= -85)                        return 2;
  if (pc24h <= -65 && pc6h <= -30)         return 5;
  if (pc24h <= -65)                        return 8;
  if (pc6h  <= -40)                        return 10;
  if (pc24h <= -50)                        return 12;
  if (pc24h <= -40)                        return 20;
  if (sells >= realBuys * 4 && sells > 10) return 18;
  if (pc24h <= -30)                        return 30;
  if (pc1h  <= -20)                        return 42;
  if (pc24h <= -15)                        return 52;
  if (pc5m > 30 && pc24h < 0)             return 40;
  return 85;
}

/* 3. PUMP DANGER — catches pump & dump setup */
function scorePumpDanger(pair) {
  const pc5m = pair.priceChange?.m5  ?? 0;
  const pc1h = pair.priceChange?.h1  ?? 0;
  const pc6h = pair.priceChange?.h6  ?? 0;
  if (pc5m > 100 || pc1h > 500)  return 5;
  if (pc1h > 200)                 return 15;
  if (pc1h > 100)                 return 28;
  if (pc1h > 50)                  return 45;
  if (pc1h > 20 && pc6h > 100)   return 38;
  if (pc1h > 15)                  return 58;
  if (pc1h > 5)                   return 72;
  if (pc1h >= 0)                  return 82;
  return 85;
}

/* 4. LP STRENGTH — real exit liquidity available */
function scoreLpStrength(pair) {
  const liq = pair.liquidity?.usd ?? 0;
  if (liq <   500)   return 2;   // essentially zero — instant rug
  if (liq <  3000)   return 8;
  if (liq <  8000)   return 18;
  if (liq < 20000)   return 35;
  if (liq < 50000)   return 52;
  if (liq < 120000)  return 68;
  if (liq < 300000)  return 80;
  return 90;
}

/* 5. LP STABILITY — liquidity vs price volatility */
function scoreLpStability(pair) {
  const liq  = pair.liquidity?.usd ?? 0;
  const pc1h = Math.abs(pair.priceChange?.h1 ?? 0);
  if (liq <  500)                  return 2;
  if (liq < 3000)                  return 8;
  if (liq < 5000)                  return 15;
  if (liq < 10000 && pc1h > 20)   return 15;
  if (liq < 30000 && pc1h > 20)   return 30;
  if (liq < 50000 && pc1h > 15)   return 45;
  if (liq < 100000 && pc1h > 10)  return 60;
  return 85;
}

/* 6. MC / LIQUIDITY RATIO — price inflation risk
   A token where MC is wildly higher than real exit liquidity
   can be crashed by a single large sell. */
function scoreMcLiqRatio(pair) {
  const liq = pair.liquidity?.usd ?? 0;
  const mc  = pair.marketCap || pair.fdv || (liq * 8);
  if (!liq || liq < 100) return 5;   // no real liquidity = extreme danger
  if (mc < 2000)  return 12;
  if (mc < 5000)  return 22;
  const ratio = mc / liq;
  if (ratio > 500)  return 2;   // insane inflation
  if (ratio > 200)  return 8;
  if (ratio > 100)  return 18;
  if (ratio > 50)   return 30;
  if (ratio > 20)   return 48;
  if (ratio > 10)   return 65;
  if (ratio > 5)    return 78;
  return 88;
}

/* 7. SELL PRESSURE (1h window) */
function scoreSellPressure(pair) {
  const buys1h  = pair.txns?.h1?.buys  ?? 0;
  const sells1h = pair.txns?.h1?.sells ?? 0;
  const total   = buys1h + sells1h;
  if (total < 5) return 45;

  const noise    = botNoiseLevel(pair);
  const rawRatio = sells1h / total;
  const adjRatio = 0.5 + (rawRatio - 0.5) * (1 - noise);

  if (adjRatio > 0.80) return 8;
  if (adjRatio > 0.70) return 18;
  if (adjRatio > 0.60) return 32;
  if (adjRatio > 0.50) return 48;
  if (adjRatio > 0.40) return 62;
  if (adjRatio < 0.30) return 85;
  return 70;
}

/* 8. VOLUME CONSISTENCY */
function scoreVolumeConsistency(pair) {
  const h1  = pair.volume?.h1  ?? 0;
  const h24 = pair.volume?.h24 ?? 0;
  if (h24 < 500)  return 15;
  if (h24 < 2000) return 30;
  const avg = h24 / 24;
  if (avg === 0) return 20;
  const ratio = h1 / avg;
  if (ratio < 0.1) return 20;
  if (ratio < 0.3) return 38;
  if (ratio < 0.6) return 55;
  if (ratio < 1.0) return 70;
  return 85;
}

/* 9. DEV BEHAVIOR */
function scoreDevBehavior(pair) {
  const sells = pair.txns?.h1?.sells ?? 0;
  const buys  = pair.txns?.h1?.buys  ?? 0;
  const pc1h  = pair.priceChange?.h1  ?? 0;

  const mintActive   = window.scanCreator    && window.scanCreator    !== "Renounced";
  const freezeActive = window.scanFreezeAuth && window.scanFreezeAuth !== "Renounced";
  const devPctNum    = parseFloat(window.scanDevPercent) || 0;

  let score = 80;
  if (mintActive)          score -= 20;
  if (freezeActive)        score -= 25;
  if (devPctNum > 15)      score -= 25;
  else if (devPctNum > 5)  score -= 12;
  else if (devPctNum > 2)  score -= 5;

  const noise    = botNoiseLevel(pair);
  const realBuys = Math.round(buys * (1 - noise * 0.85));
  if (sells > realBuys * 3 && pc1h < -15) score -= 20;
  else if (sells > realBuys * 2)          score -= 10;

  return pct(score);
}

/* 10. VOLUME / MCAP RATIO — dump churn detector */
function scoreVolMcapRatio(pair) {
  const vol24 = pair.volume?.h24 ?? 0;
  const mc    = pair.marketCap || pair.fdv || 0;
  const pc24h = pair.priceChange?.h24 ?? 0;
  if (!mc || mc < 500) return 35;
  if (vol24 < 100 && mc < 10000) return 12;
  if (vol24 < 500 && mc <  5000) return 18;
  const ratio = vol24 / mc;
  if (ratio > 30 && pc24h < -20) return 5;
  if (ratio > 15 && pc24h < -10) return 12;
  if (ratio > 5  && pc24h <  -5) return 25;
  if (ratio > 20)                 return 20;
  if (ratio > 5)                  return 55;
  if (ratio > 1)                  return 75;
  return 82;
}

/* 11. PUMP.FUN LAUNCH RISK  ── NEW SIGNAL ──────────────────────
   Pump.fun bonding curve tokens show VIRTUAL liquidity that is not
   real exit liquidity. A token still on the bonding curve has no
   real DEX pool — any sell can collapse the price instantly.
   Even graduated tokens with tiny real DEX liquidity are very risky.
   ─────────────────────────────────────────────────────────────── */
function scorePumpFunRisk(pair) {
  const isPump    = window.scanIsPumpFun;
  const graduated = window.scanHasGraduated;
  const liq       = pair.liquidity?.usd ?? 0;   // real DEX liquidity (from pair selection)

  /* Not pump.fun at all — no special risk */
  if (!isPump) return 82;

  /* Still on bonding curve — no real DEX pool exists */
  if (!graduated) return 8;

  /* Graduated but to a near-dead pool — almost as risky */
  if (liq <  1000)  return 10;
  if (liq <  5000)  return 20;
  if (liq < 15000)  return 32;
  if (liq < 40000)  return 48;
  if (liq < 80000)  return 60;
  return 70;  // graduated with real liquidity — meaningfully safer
}

/* ================================================================
   SHARED PURE SCORER
   Returns a single 5-95 risk score from a DexScreener pair object.
   Pass top10Pct and bundleScore for full accuracy.
   ================================================================ */
export function computeRiskScore(pair, top10Pct = 0, bundleScore = 75) {
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
  const pumpFunRisk   = scorePumpFunRisk(pair);
  const bundleAttack  = Math.max(0, Math.min(100, bundleScore));

  /* Weights — 12 signals, sum = 1.00
     Pump.fun risk gets 0.12 because fake liquidity is the #1
     cause of false "safe" scores on new tokens. */
  let totalScore = Math.round(
    ageTrust      * 0.14 +
    integrity     * 0.12 +
    pumpDanger    * 0.09 +
    lpStrength    * 0.08 +
    mcLiqRatio    * 0.08 +
    sellPressure  * 0.08 +
    devBehavior   * 0.07 +
    bundleAttack  * 0.08 +
    pumpFunRisk   * 0.12 +
    lpStability   * 0.05 +
    volumeConsist * 0.04 +
    volMcapRatio  * 0.05
  );

  /* ── Hard overrides — extreme danger can never score "moderate" ── */
  const pc24h  = pair.priceChange?.h24 ?? 0;
  const _vol24 = pair.volume?.h24      ?? 0;
  const _liq   = pair.liquidity?.usd   ?? 0;
  const _mc    = pair.marketCap || pair.fdv || 0;

  /* Price collapse */
  if (pc24h <= -80) totalScore = Math.min(totalScore, 20);
  if (pc24h <= -50) totalScore = Math.min(totalScore, 30);
  if (pc24h <= -30) totalScore = Math.min(totalScore, 44);

  /* Extremely new token */
  if (ageTrust <= 5) totalScore = Math.min(totalScore, 28);

  /* Near-zero real liquidity — single sell can wipe the pool */
  if (_liq > 0 && _liq < 500)   totalScore = Math.min(totalScore, 15);
  if (_liq > 0 && _liq < 2000)  totalScore = Math.min(totalScore, 25);
  if (_liq > 0 && _liq < 5000)  totalScore = Math.min(totalScore, 35);

  /* Extreme MC/Liq ratio — price cannot be sustained */
  if (_liq > 0 && _mc > 0) {
    const _ratio = _mc / _liq;
    if (_ratio > 1000) totalScore = Math.min(totalScore, 12);
    else if (_ratio > 500) totalScore = Math.min(totalScore, 18);
    else if (_ratio > 200) totalScore = Math.min(totalScore, 28);
    else if (_ratio > 100) totalScore = Math.min(totalScore, 38);
  }

  /* Pump.fun bonding curve — NOT a real exit pool */
  if (window.scanIsPumpFun && !window.scanHasGraduated) {
    totalScore = Math.min(totalScore, 30);
  }

  /* Dead/abandoned token */
  if (_vol24 < 100 && _liq < 10000) totalScore = Math.min(totalScore, 25);
  if (_vol24 < 500 && _liq <  5000) totalScore = Math.min(totalScore, 28);

  /* On-chain holder concentration */
  if (top10Pct >= 95)      totalScore = Math.min(totalScore, 20);
  else if (top10Pct >= 85) totalScore = Math.min(totalScore, 33);
  else if (top10Pct >= 70) totalScore = Math.min(totalScore, 48);

  return Math.max(5, Math.min(95, totalScore));
}

/* ================================================================
   SHARED PAIR PICKER — exported so every page uses identical logic.
   Returns { pair, isPumpFun, hasGraduated } with NO window side-effects.
   Callers must set window.scanIsPumpFun / window.scanHasGraduated
   right before calling computeRiskScore (synchronously, no await between).
   ================================================================ */
export function pickSmartPair(mint, pairs) {
  const solanaPairs = (pairs || []).filter(p => p.chainId === "solana");
  if (!solanaPairs.length) {
    return { pair: (pairs || [])[0] || null, isPumpFun: false, hasGraduated: false };
  }

  const isPumpFunToken = String(mint).toLowerCase().endsWith("pump");

  if (isPumpFunToken) {
    // Separate real DEX pairs (Meteora, Raydium…) from the pump.fun bonding-curve pair.
    // DexScreener under-reports liquidity for Meteora DLMM pools, so we can't rely on
    // liquidity.usd alone — being on a non-pump DEX is enough to confirm graduation.
    const realDexPairs = solanaPairs.filter(
      p => !String(p.dexId || "").toLowerCase().includes("pump")
    );
    const pumpPairs = solanaPairs.filter(
      p => String(p.dexId || "").toLowerCase().includes("pump")
    );

    if (realDexPairs.length > 0) {
      // Token has graduated — pick the highest-liquidity real DEX pair
      const best = realDexPairs.sort(
        (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0)
      )[0];
      return { pair: best, isPumpFun: true, hasGraduated: true };
    }

    // Still only on pump.fun — pick highest-liquidity pump pair
    const best = pumpPairs.sort(
      (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0)
    )[0] || solanaPairs[0];
    return { pair: best, isPumpFun: true, hasGraduated: false };
  }

  const pair = [...solanaPairs].sort(
    (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0)
  )[0];
  return { pair, isPumpFun: false, hasGraduated: false };
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
  const pumpFunRisk   = scorePumpFunRisk(pair);

  /* Bundle score: populated async by bundle-panel.js.
     Default 75 (neutral) until bundle completes; re-renders after. */
  const bundleScore = (window.bundleData && window.bundleData.verdict !== "NO_DATA")
    ? window.bundleData.bundleScore
    : 75;

  /* ── Signals display array ── */
  const signals = [
    { label: t("sig_age_trust"),      score: ageTrust,      weight: 0.14 },
    { label: t("sig_integrity"),      score: integrity,     weight: 0.12 },
    { label: t("sig_pump_danger"),    score: pumpDanger,    weight: 0.09 },
    { label: t("sig_lp_strength"),    score: lpStrength,    weight: 0.08 },
    { label: t("sig_mc_liq"),         score: mcLiqRatio,    weight: 0.08 },
    { label: t("sig_sell_pressure"),  score: sellPressure,  weight: 0.08 },
    { label: t("sig_dev_behavior"),   score: devBehavior,   weight: 0.07 },
    { label: t("sig_bundle"),         score: bundleScore,   weight: 0.08 },
    { label: t("sig_pump_launch"),    score: pumpFunRisk,   weight: 0.12 },
    { label: t("sig_lp_stability"),   score: lpStability,   weight: 0.05 },
    { label: t("sig_vol_consistency"),score: volumeConsist, weight: 0.04 },
    { label: t("sig_vol_mcap"),       score: volMcapRatio,  weight: 0.05 },
  ];

  const top10Pct = parseFloat(window.scanTop10) || 0;
  let totalScore = computeRiskScore(pair, top10Pct, bundleScore);

  /* ── Net buy pressure for display ── */
  const buys24  = pair.txns?.h24?.buys  ?? 0;
  const sells24 = pair.txns?.h24?.sells ?? 0;
  window.scanNetBuyPressure = { net: buys24 - sells24, buys: buys24, sells: sells24 };

  /* ── Volume/buys for other panels ── */
  window.scanVol24h  = pair.volume?.h24       ?? 0;
  window.scanBuys24h = pair.txns?.h24?.buys   ?? 0;

  const riskLevel =
    totalScore >= 80 ? "🌕 MOON COIN" :
    totalScore >= 65 ? "LOW RUG RISK" :
    totalScore >= 45 ? "MODERATE RISK" :
    totalScore >= 25 ? "HIGH RUG RISK" : "EXTREME RISK 🚨";

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
    top10:      window.scanTop10  || "N/A",
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
