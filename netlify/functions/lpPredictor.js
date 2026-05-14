/* ================================================================
   Scan2Moon -- LP Pull Predictor  (Netlify Function)
   POST /.netlify/functions/lpPredictor
   Body: { mint, creator }

   Estimates the probability of a liquidity pull (rug) by combining:
     1. Birdeye /defi/token_security -- LP lock/burn %, authorities,
        creator holdings, top-10 concentration
     2. Birdeye /defi/token_overview  -- liquidity, market cap,
        first trade time (pool age)
     3. Our own devWallet API         -- deployer rug history
        (only if creator is a valid wallet, uses Redis-cached result)

   LP Pull Score: 0-100, higher = safer.
   Signals array: each signal shows label, value, impact (+/-) and
   its point contribution so the frontend can explain the score.

   Cache: Redis 3 min
   ================================================================ */

const { redisGet, redisSet, CORS, CORS_API } = require("./db");
const { resolveAccess, respond402 }           = require("./x402");
const { fetchDevWalletData, WALLET_RE: CREATOR_RE, SKIP_SET: SKIP_CREATORS } = require("./devWalletHelper");

const REDIS_TTL = 180;    // 3 min
const MINT_RE   = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/* -- safe Birdeye fetch with one 429 retry -- */
async function beFetch(url, key, ms) {
  const h = { "X-API-KEY": key, "x-chain": "solana" };
  let r = await fetch(url, { headers: h, signal: AbortSignal.timeout(ms || 9000) });
  if (r.status === 429) {
    await new Promise(function(res) { setTimeout(res, 1200); });
    r = await fetch(url, { headers: h, signal: AbortSignal.timeout(ms || 9000) });
  }
  return r;
}

/* -- fetch deployer rug history via shared helper (direct call, no HTTP round-trip) -- */
async function getDevHistory(creator, heliusKey, birdeyeKey) {
  if (!creator || SKIP_CREATORS.has(creator) || !CREATOR_RE.test(creator)) {
    return { totalDeployed: 0, rugRate: 0, available: false };
  }
  try {
    const d = await fetchDevWalletData(creator, heliusKey, birdeyeKey, redisGet, redisSet);
    return {
      totalDeployed: d.totalDeployed || 0,
      rugCount:      d.rugCount      || 0,
      rugRate:       d.rugRate       || 0,
      available:     true,
    };
  } catch (e) {
    return { totalDeployed: 0, rugRate: 0, available: false };
  }
}

/* ================================================================
   SCORE ENGINE
   Base: 50. Each signal applies a delta. Final cap: 3-97.
   ================================================================ */
function computeScore(fields) {
  const {
    lpBurnPct, lpLockedPct, lpLocked,
    mintAuth, freezeAuth,
    poolAgeDays, liquidityUsd, mcap,
    creatorPct, top10Pct,
    devTotalDeployed, devRugRate, devAvailable,
  } = fields;

  let score = 50;
  const signals = [];

  function apply(label, value, delta, positive) {
    score += delta;
    signals.push({
      label,
      value: String(value),
      impact: delta > 0 ? "positive" : delta < 0 ? "negative" : "neutral",
      delta,
    });
  }

  /* -- LP lock / burn status (most important signal) -- */
  const burnPct = lpBurnPct != null ? parseFloat(lpBurnPct) : null;
  const lockPct = lpLockedPct != null ? parseFloat(lpLockedPct) : null;

  if (burnPct !== null && burnPct >= 95) {
    apply("LP Burned", burnPct.toFixed(0) + "%", 38);
  } else if (burnPct !== null && burnPct >= 50) {
    apply("LP Partially Burned", burnPct.toFixed(0) + "%", 20);
  } else if (lpLocked === true || (lockPct !== null && lockPct >= 50)) {
    apply("LP Locked (3rd party)", lockPct != null ? lockPct.toFixed(0) + "%" : "Yes", 18);
  } else {
    var burnStr = burnPct !== null ? burnPct.toFixed(0) + "% burned" : "Not burned";
    apply("LP Not Locked / Burned", burnStr, -35);
  }

  /* -- Mint authority -- */
  if (mintAuth === "Renounced" || mintAuth === null) {
    apply("Mint Renounced", "Renounced", 12);
  } else {
    apply("Mint Active", "Active", -15);
  }

  /* -- Freeze authority -- */
  if (freezeAuth === "Renounced" || freezeAuth === null) {
    apply("Freeze Renounced", "Renounced", 4);
  } else {
    apply("Freeze Active", "Active", -8);
  }

  /* -- Pool age -- */
  if (poolAgeDays !== null) {
    if (poolAgeDays > 30) {
      apply("Pool Age", Math.round(poolAgeDays) + " days", 14);
    } else if (poolAgeDays >= 7) {
      apply("Pool Age", Math.round(poolAgeDays) + " days", 8);
    } else if (poolAgeDays >= 1) {
      apply("Pool Age", poolAgeDays.toFixed(1) + " days", 2);
    } else if (poolAgeDays >= 0.25) {
      apply("Pool Age", Math.round(poolAgeDays * 24) + " hours", -12);
    } else {
      apply("Pool Age", Math.round(poolAgeDays * 24 * 60) + " mins", -22);
    }
  }

  /* -- Liquidity -- */
  if (liquidityUsd !== null) {
    if (liquidityUsd >= 50000) {
      apply("Liquidity", "$" + (liquidityUsd / 1000).toFixed(0) + "k", 8);
    } else if (liquidityUsd >= 10000) {
      apply("Liquidity", "$" + (liquidityUsd / 1000).toFixed(1) + "k", 4);
    } else if (liquidityUsd < 1000) {
      apply("Liquidity", "$" + liquidityUsd.toFixed(0), -18);
    } else if (liquidityUsd < 5000) {
      apply("Liquidity", "$" + (liquidityUsd / 1000).toFixed(1) + "k", -8);
    }
  }

  /* -- Liq / MC ratio (healthy LP has decent liq vs mcap) -- */
  if (liquidityUsd > 0 && mcap > 0) {
    var ratio = (liquidityUsd / mcap) * 100;
    if (ratio >= 25) {
      apply("Liq / MC Ratio", ratio.toFixed(1) + "%", 8);
    } else if (ratio >= 10) {
      apply("Liq / MC Ratio", ratio.toFixed(1) + "%", 4);
    } else if (ratio < 2) {
      apply("Liq / MC Ratio", ratio.toFixed(1) + "%", -10);
    }
  }

  /* -- Creator holdings -- */
  if (creatorPct !== null) {
    var cpct = parseFloat(creatorPct);
    if (cpct <= 2) {
      apply("Creator Holdings", cpct.toFixed(1) + "%", 10);
    } else if (cpct <= 5) {
      apply("Creator Holdings", cpct.toFixed(1) + "%", 5);
    } else if (cpct <= 15) {
      apply("Creator Holdings", cpct.toFixed(1) + "%", -6);
    } else if (cpct <= 30) {
      apply("Creator Holdings", cpct.toFixed(1) + "%", -15);
    } else {
      apply("Creator Holdings", cpct.toFixed(1) + "%", -25);
    }
  }

  /* -- Top-10 concentration -- */
  if (top10Pct !== null) {
    var t10 = parseFloat(top10Pct) * 100;
    if (t10 >= 80) {
      apply("Top-10 Concentration", t10.toFixed(0) + "%", -12);
    } else if (t10 <= 40) {
      apply("Top-10 Concentration", t10.toFixed(0) + "%", 5);
    }
  }

  /* -- Deployer rug history -- */
  if (devAvailable && devTotalDeployed > 0) {
    if (devRugRate === 0) {
      apply("Dev History", devTotalDeployed + " deploys, 0 rugs", 10);
    } else if (devRugRate <= 20) {
      apply("Dev History", devTotalDeployed + " deploys, " + devRugRate + "% rug rate", -5);
    } else if (devRugRate <= 50) {
      apply("Dev History", devTotalDeployed + " deploys, " + devRugRate + "% rug rate", -18);
    } else {
      apply("Dev History", devTotalDeployed + " deploys, " + devRugRate + "% rug rate", -28);
    }
  } else if (devAvailable && devTotalDeployed === 0) {
    apply("Dev History", "No prior deploys", 0);
  }

  /* -- Clamp -- */
  score = Math.max(3, Math.min(97, Math.round(score)));

  /* -- Risk tier -- */
  var risk, label;
  if      (score >= 78) { risk = "LOW";     label = "LP Likely Safe";    }
  else if (score >= 55) { risk = "MEDIUM";  label = "LP Pull Possible";  }
  else if (score >= 30) { risk = "HIGH";    label = "LP Pull Risk";      }
  else                  { risk = "EXTREME"; label = "LP Pull Imminent";  }

  return { score, risk, label, signals };
}

/* ================================================================
   HANDLER
   ================================================================ */
exports.handler = async function(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  if (event.httpMethod !== "POST")
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Method not allowed" }) };

  /* Access gate: API key / x402 Base / Solana / paywall */
  const access = await resolveAccess(event, "lpPredictor");
  if (access.access === "paywall") return respond402("lpPredictor");
  if (access.access === "denied")
    return { statusCode: access.status, headers: CORS_API, body: JSON.stringify({ error: access.error }) };

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  const { mint, creator } = body;
  if (!mint || !MINT_RE.test(mint))
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid mint" }) };

  const cacheKey = "lp2:" + mint + ":" + (creator || "");
  try {
    const hit = await redisGet(cacheKey);
    if (hit) return { statusCode: 200, headers: { ...CORS, "X-Cache": "HIT" }, body: JSON.stringify(hit) };
  } catch {}

  const BIRDEYE   = process.env.BIRDEYE_API_KEY;
  const HELIUS    = process.env.HELIUS_KEY;
  if (!BIRDEYE)
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "BIRDEYE_API_KEY not set" }) };

  const enc = encodeURIComponent(mint);

  try {
    /* Parallel: security + overview + dev history (direct helper call — no HTTP auth loop) */
    const [secRes, ovRes, devData] = await Promise.all([
      beFetch("https://public-api.birdeye.so/defi/token_security?address=" + enc, BIRDEYE),
      beFetch("https://public-api.birdeye.so/defi/token_overview?address=" + enc, BIRDEYE),
      getDevHistory(creator, HELIUS, BIRDEYE),
    ]);

    const secJson = secRes.ok  ? await secRes.json().catch(() => null)  : null;
    const ovJson  = ovRes.ok   ? await ovRes.json().catch(() => null)   : null;
    const sec = secJson?.data ?? {};
    const ov  = ovJson?.data  ?? {};

    /* Extract fields */
    const lpBurnPct   = sec.lpBurnPct     ?? sec.lp_burn_pct     ?? null;
    const lpLockedPct = sec.lpLockedPct   ?? sec.lp_locked_pct   ?? null;
    const lpLocked    = sec.lpLocked      ?? sec.lp_locked       ?? null;
    const mintAuth    = sec.mintAuthority ?? sec.mint_authority   ?? null;
    const freezeAuth  = sec.freezeAuthority ?? sec.freeze_authority ?? null;
    const creatorPct  = sec.creatorPercentage ?? sec.creator_percentage ?? null;
    const top10Pct    = sec.top10HolderPercent ?? sec.top_10_holder_percent ?? null;

    const liquidityUsd = parseFloat(ov.liquidity ?? 0) || 0;
    const mcap         = parseFloat(ov.mc         ?? 0) || 0;

    /* Pool age — try multiple timestamp fields across both API responses */
    var poolAgeDays = null;
    var firstTradeTs = ov.firstTradeUnixTime
      ?? ov.createdTime
      ?? ov.blockUnixTime
      ?? ov.lastTradeUnixTime   /* rough proxy if nothing else */
      ?? sec.creationTime       /* token_security sometimes has this */
      ?? sec.blockTime
      ?? null;
    if (firstTradeTs && firstTradeTs > 0) {
      poolAgeDays = (Date.now() / 1000 - firstTradeTs) / 86400;
      /* sanity-check: ignore future or impossibly old timestamps */
      if (poolAgeDays < 0 || poolAgeDays > 3650) poolAgeDays = null;
    }

    /* Compute score */
    const { score, risk, label, signals } = computeScore({
      lpBurnPct, lpLockedPct, lpLocked,
      mintAuth:   mintAuth   === null ? "Renounced" : mintAuth,
      freezeAuth: freezeAuth === null ? "Renounced" : freezeAuth,
      poolAgeDays, liquidityUsd, mcap, creatorPct, top10Pct,
      devTotalDeployed: devData.totalDeployed,
      devRugRate:       devData.rugRate,
      devAvailable:     devData.available,
    });

    const result = {
      score, risk, label, signals,
      /* raw data for display */
      lpBurnPct:    lpBurnPct   !== null ? parseFloat(lpBurnPct)   : null,
      lpLockedPct:  lpLockedPct !== null ? parseFloat(lpLockedPct) : null,
      lpLocked:     lpLocked,
      mintAuthority:   mintAuth   === null ? "Renounced" : (mintAuth   ?? "Unknown"),
      freezeAuthority: freezeAuth === null ? "Renounced" : (freezeAuth ?? "Unknown"),
      poolAgeDays:     poolAgeDays !== null ? parseFloat(poolAgeDays.toFixed(2)) : null,
      liquidityUsd,
      mcap,
      creatorPct:   creatorPct !== null ? parseFloat(creatorPct) : null,
      top10Pct:     top10Pct   !== null ? parseFloat(top10Pct)   : null,
      devData,
      creator: creator || null,
    };


    try { await redisSet(cacheKey, result, REDIS_TTL); } catch {}
    return { statusCode: 200, headers: { ...CORS, "X-Cache": "MISS" }, body: JSON.stringify(result) };

  } catch (e) {
    console.error("[lpPredictor]", e.message);
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        score: 50, risk: "NO_DATA", label: "LP Data Unavailable",
        signals: [], error: e.message,
      }),
    };
  }
};
