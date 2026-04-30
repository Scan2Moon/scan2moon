// netlify/functions/batchRisk.js
// GET /.netlify/functions/batchRisk?mints=addr1,addr2,...
//
// Returns live risk scores for up to 15 Solana token mints.
// Uses the EXACT same scoring engine as scanSignals.js (the Risk Scanner page).
// This is the only way to guarantee home-page scores match the scanner.
//
// Scoring: 10-signal weighted average, same weights as computeRiskScore().
// Missing signals vs full scanner: devBehavior (needs on-chain mint/freeze auth),
//   bundleAttack (async bundle scan), top10Pct (holder concentration).
//   These default to neutral so the score is close but may differ ±5-10 points.
//
// pairCreatedAt: checked in Redis (scan:${mint}) from prior full scans.
//   If available, scoreTokenAge is accurate. Otherwise defaults to 35 (neutral).
//
// Redis cache: risk:v2:${mint} = 90s TTL
// SOURCE: Birdeye ONLY — required for Build-in-Public competition.

const { redisGet, redisSet, CORS, CORS_429, isRateLimitedRedis } = require("./db");

const MAX_MINTS  = 15;
const CACHE_TTL  = 90; // seconds
const CACHE_VER  = "risk:v2:"; // bump version to bust stale v1 entries

/* ================================================================
   EXACT COPY of scoring signals from scanSignals.js
   Keep in sync when scanSignals.js is updated.
   ================================================================ */

function pct(v) { return Math.max(0, Math.min(100, Math.round(v))); }

function botNoiseLevel(pair) {
  const vol24   = pair.volume?.h24       ?? 0;
  const buys24  = pair.txns?.h24?.buys   ?? 0;
  const sells24 = pair.txns?.h24?.sells  ?? 0;
  const total   = buys24 + sells24;
  if (!total || !vol24) return 0;
  const avgTx = vol24 / total;
  if (avgTx >= 20) return 0.00;
  if (avgTx >= 15) return 0.20;
  if (avgTx >= 10) return 0.45;
  if (avgTx >=  5) return 0.70;
  return 0.90;
}

/* 1. TOKEN AGE TRUST */
function scoreTokenAge(pair) {
  const created = pair.pairCreatedAt;
  if (!created) return 35;
  const ageMs   = Date.now() - (created < 1e12 ? created * 1000 : created);
  const ageMins = ageMs / 60000;
  if (ageMins <  10)  return 5;
  if (ageMins <  30)  return 15;
  if (ageMins <  60)  return 28;
  if (ageMins < 240)  return 45;
  if (ageMins < 720)  return 60;
  if (ageMins < 1440) return 72;
  if (ageMins < 4320) return 82;
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

/* 4. LP STRENGTH — real exit liquidity */
function scoreLpStrength(pair) {
  const liq = pair.liquidity?.usd ?? 0;
  if (liq <    500) return 2;
  if (liq <   3000) return 8;
  if (liq <   8000) return 18;
  if (liq <  20000) return 35;
  if (liq <  50000) return 52;
  if (liq < 120000) return 68;
  if (liq < 300000) return 80;
  return 90;
}

/* 5. LP STABILITY */
function scoreLpStability(pair) {
  const liq  = pair.liquidity?.usd ?? 0;
  const pc1h = Math.abs(pair.priceChange?.h1 ?? 0);
  if (liq <   500)                  return 2;
  if (liq <  3000)                  return 8;
  if (liq <  5000)                  return 15;
  if (liq < 10000 && pc1h > 20)    return 15;
  if (liq < 30000 && pc1h > 20)    return 30;
  if (liq < 50000 && pc1h > 15)    return 45;
  if (liq < 100000 && pc1h > 10)   return 60;
  return 85;
}

/* 6. MC / LIQUIDITY RATIO */
function scoreMcLiqRatio(pair) {
  const liq = pair.liquidity?.usd ?? 0;
  const mc  = pair.marketCap || pair.fdv || (liq * 8);
  if (!liq || liq < 100) return 5;
  if (mc < 2000)  return 12;
  if (mc < 5000)  return 22;
  const ratio = mc / liq;
  if (ratio > 500)  return 2;
  if (ratio > 200)  return 8;
  if (ratio > 100)  return 18;
  if (ratio > 50)   return 30;
  if (ratio > 20)   return 48;
  if (ratio > 10)   return 65;
  if (ratio > 5)    return 78;
  return 88;  // MC ≤ 5× LIQ — healthy / undervalued relative to pool
}

/* 7. SELL PRESSURE (1h) */
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

/* 9. VOLUME / MCAP RATIO — dump churn detector */
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

/* 10. PUMP.FUN LAUNCH RISK */
function scorePumpFunRisk(pair, isPumpFun, hasGraduated) {
  const liq = pair.liquidity?.usd ?? 0;
  if (!isPumpFun) return 82;
  if (!hasGraduated) return 8;
  if (liq <  1000)  return 10;
  if (liq <  5000)  return 20;
  if (liq < 15000)  return 32;
  if (liq < 40000)  return 48;
  if (liq < 80000)  return 60;
  return 70;
}

/* ── FINAL SCORE — same weights as computeRiskScore() in scanSignals.js ── */
function computeScore(pair, isPumpFun, hasGraduated) {
  const ageTrust      = scoreTokenAge(pair);
  const integrity     = scoreMarketIntegrity(pair);
  const pumpDanger    = scorePumpDanger(pair);
  const lpStrength    = scoreLpStrength(pair);
  const lpStability   = scoreLpStability(pair);
  const mcLiqRatio    = scoreMcLiqRatio(pair);
  const sellPressure  = scoreSellPressure(pair);
  const volumeConsist = scoreVolumeConsistency(pair);
  const volMcapRatio  = scoreVolMcapRatio(pair);
  const pumpFunRisk   = scorePumpFunRisk(pair, isPumpFun, hasGraduated);

  // devBehavior needs on-chain mint/freeze data — default 80 (neutral-good)
  const devBehavior  = 80;
  // bundleAttack needs async bundle scan — default 75 (neutral)
  const bundleAttack = 75;

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

  // Hard overrides — same as computeRiskScore() in scanSignals.js
  const pc24h  = pair.priceChange?.h24 ?? 0;
  const _vol24 = pair.volume?.h24      ?? 0;
  const _liq   = pair.liquidity?.usd   ?? 0;
  const _mc    = pair.marketCap || pair.fdv || 0;

  if (pc24h <= -80) totalScore = Math.min(totalScore, 20);
  if (pc24h <= -50) totalScore = Math.min(totalScore, 30);
  if (pc24h <= -30) totalScore = Math.min(totalScore, 44);

  if (ageTrust <= 5) totalScore = Math.min(totalScore, 28);

  if (_liq > 0 && _liq < 500)   totalScore = Math.min(totalScore, 15);
  if (_liq > 0 && _liq < 2000)  totalScore = Math.min(totalScore, 25);
  if (_liq > 0 && _liq < 5000)  totalScore = Math.min(totalScore, 35);

  if (_liq > 0 && _mc > 0) {
    const _ratio = _mc / _liq;
    if (_ratio > 1000) totalScore = Math.min(totalScore, 12);
    else if (_ratio > 500) totalScore = Math.min(totalScore, 18);
    else if (_ratio > 200) totalScore = Math.min(totalScore, 28);
    else if (_ratio > 100) totalScore = Math.min(totalScore, 38);
  }

  if (isPumpFun && !hasGraduated) totalScore = Math.min(totalScore, 30);

  if (_vol24 < 100 && _liq < 10000) totalScore = Math.min(totalScore, 25);
  if (_vol24 < 500 && _liq <  5000) totalScore = Math.min(totalScore, 28);

  return Math.max(5, Math.min(95, totalScore));
}

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  /* batchRisk powers the site's gainers/new-pairs tables — free for all, rate-limited.
     x-nf-client-connection-ip is set by Netlify and cannot be spoofed by the client. */
  const ip = (
    event.headers["x-nf-client-connection-ip"] ||
    event.headers["x-forwarded-for"] ||
    "unknown"
  ).split(",")[0].trim();

  /* 10 batch calls per minute per IP — each batch costs up to 45 Birdeye calls,
     so this caps one IP at ~450 Birdeye calls/min (well within safe limits). */
  if (await isRateLimitedRedis(ip, 10, 60)) {
    return { statusCode: 429, headers: CORS_429, body: JSON.stringify({ error: "Too many requests. Max 10 batch calls per minute." }) };
  }

  const qs = event.queryStringParameters || {};
  const rawMints = (qs.mints || "").split(",").map(m => m.trim()).filter(m => MINT_RE.test(m));
  const mints = [...new Set(rawMints)].slice(0, MAX_MINTS);

  if (!mints.length) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok: false, error: "No valid mints provided" }) };
  }

  const KEY = process.env.BIRDEYE_API_KEY;
  if (!KEY) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ ok: false, error: "BIRDEYE_API_KEY not set" }) };
  }

  // Parse optional creation timestamps from frontend (NP tokens have exact createdAt)
  // Format: created=mint1:unixMs1,mint2:unixMs2
  const createdMap = {};
  if (qs.created) {
    try {
      for (const part of decodeURIComponent(qs.created).split(",")) {
        const colon = part.lastIndexOf(":");
        if (colon > 0) {
          const m  = part.slice(0, colon).trim();
          const ts = Number(part.slice(colon + 1).trim());
          if (MINT_RE.test(m) && ts > 0) createdMap[m] = ts;
        }
      }
    } catch {}
  }

  const scores = {};

  /* ── L1: Redis cache — serve already-computed scores ──
     Bypass cache when we have a creation time for the token: the cached score
     was computed without the correct age so it is likely wrong.             ── */
  const uncached = [];
  await Promise.all(mints.map(async mint => {
    try {
      if (createdMap[mint]) { uncached.push(mint); return; }
      const cached = await redisGet(`${CACHE_VER}${mint}`);
      if (cached) {
        scores[mint] = typeof cached === "string" ? JSON.parse(cached) : cached;
      } else {
        uncached.push(mint);
      }
    } catch {
      uncached.push(mint);
    }
  }));

  /* ── L2: Fetch uncached mints ── */
  await Promise.all(uncached.map(async mint => {
    try {
      // Priority for pairCreatedAt:
      // 1. Passed directly from frontend (accurate for fresh NP tokens)
      // 2. Cached from a previous full Risk Scanner scan (scan:${mint} key)
      // 3. null → scoreTokenAge returns 35 (neutral default)
      let pairCreatedAt = createdMap[mint] || null;

      if (!pairCreatedAt) {
        try {
          const cached = await redisGet(`scan:${mint}`);
          if (cached) {
            const obj = typeof cached === "string" ? JSON.parse(cached) : cached;
            const ca  = obj?.pair?.pairCreatedAt ?? obj?.pairCreatedAt ?? null;
            if (ca) pairCreatedAt = Number(ca);
          }
        } catch {}
      }

      // Birdeye token_overview — single call, all key signals present
      const res = await fetch(
        `https://public-api.birdeye.so/defi/token_overview?address=${encodeURIComponent(mint)}`,
        {
          headers: { "X-API-KEY": KEY, "x-chain": "solana" },
          signal: AbortSignal.timeout(8000),
        }
      );
      if (!res.ok) return;
      const json = await res.json();
      const d = json?.data;
      if (!d) return;

      // Construct pair object matching the structure scanSignals.js expects
      const pair = {
        priceChange: {
          m5:  d.priceChange5mPercent  ?? 0,
          h1:  d.priceChange1hPercent  ?? 0,
          h6:  d.priceChange8hPercent  ?? d.priceChange4hPercent ?? 0,
          h24: d.priceChange24hPercent ?? 0,
        },
        liquidity:  { usd: d.liquidity ?? 0 },
        marketCap:  d.mc  ?? d.fdv ?? 0,
        fdv:        d.fdv ?? d.mc  ?? 0,
        volume: {
          h1:  d.v1hUSD  ?? 0,
          h24: d.v24hUSD ?? 0,
        },
        txns: {
          h1:  { buys: d.buy1h  ?? 0, sells: d.sell1h  ?? 0 },
          h24: { buys: d.buy24h ?? 0, sells: d.sell24h ?? 0 },
        },
        pairCreatedAt,
      };

      const isPumpFun    = String(mint).toLowerCase().endsWith("pump");
      const hasGraduated = (d.liquidity ?? 0) > 500;

      const rs    = computeScore(pair, isPumpFun, hasGraduated);
      const level = rs >= 80 ? "MOON" : rs >= 65 ? "LOW" : rs >= 45 ? "MED" : "HIGH";
      const entry = { score: rs, level };
      scores[mint] = entry;

      // Only cache when we have creation time (score is accurate); skip caching
      // tokens where age was unknown so next call recomputes with fresher data.
      if (pairCreatedAt) {
        try { await redisSet(`${CACHE_VER}${mint}`, JSON.stringify(entry), CACHE_TTL); } catch {}
      }
    } catch (e) {
      console.warn("[batchRisk] error for", mint.slice(0, 8), e.message?.slice(0, 60));
    }
  }));

  return {
    statusCode: 200,
    headers: { ...CORS, "Cache-Control": "no-store" },
    body: JSON.stringify({ ok: true, scores }),
  };
};
