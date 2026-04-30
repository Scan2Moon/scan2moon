// netlify/functions/solPrice.js
// GET /.netlify/functions/solPrice
// Returns current SOL/USD price.
//
// SOURCE: Birdeye /defi/price ONLY — no fallbacks to other providers.
// Using any non-Birdeye source violates the Build-in-Public competition rules.
//
// If Birdeye is unavailable, the last Redis-cached value is served.
// If Redis is also empty, a 503 is returned so the UI can display gracefully.
//
// Redis TTL: 10s to keep P/L displays accurate.

const { redisGet, redisSet, CORS, CORS_429, isRateLimitedRedis } = require("./db");

// In-process memory of the last known good price — survives across warm invocations
// within the same Lambda container (typically minutes). Never used across cold starts.
let _lastKnownPrice = 0;
let _lastKnownTs    = 0;
const IN_MEMORY_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

const CACHE_KEY = "sol_price_usd_v4";  // v4 = Birdeye-only (no fallbacks)
const CACHE_TTL = 6;                   // seconds — matches frontend 6s ticker
const STALE_TTL = 30;                  // serve stale cache for up to 30s if Birdeye down

const SOL_MINT  = "So11111111111111111111111111111111111111112";

/* ── Birdeye /defi/price — uses fetch() which works both locally and in Lambda ── */
async function fetchBirdeye() {
  try {
    const KEY = process.env.BIRDEYE_API_KEY;
    if (!KEY) return 0;
    const res = await fetch(
      `https://public-api.birdeye.so/defi/price?address=${SOL_MINT}&check_liquidity=10`,
      {
        headers: { "X-API-KEY": KEY, "x-chain": "solana" },
        signal: AbortSignal.timeout(5000),
      }
    );
    if (res.ok) {
      const json = await res.json();
      const price = parseFloat(json?.data?.value);
      if (price > 0) return price;
    }
  } catch {}
  return 0;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  const ip = (event.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (await isRateLimitedRedis(ip, 30, 10)) {
    return { statusCode: 429, headers: CORS_429, body: JSON.stringify({ error: "Too many requests." }) };
  }

  /* ── L1: Redis — serve cache if fresh ── */
  try {
    const cached = await redisGet(CACHE_KEY);
    if (cached && parseFloat(cached) > 0) {
      return {
        statusCode: 200,
        headers: { ...CORS, "X-Cache": "HIT", "X-Source": "redis" },
        body: JSON.stringify({ ok: true, price: parseFloat(cached), source: "birdeye-cached" }),
      };
    }
  } catch {}

  /* ── L2: Birdeye (source of truth) ── */
  const price = await fetchBirdeye();

  if (price > 0) {
    // Update in-memory cache for cross-request warm-lambda reuse
    _lastKnownPrice = price;
    _lastKnownTs    = Date.now();
    // Cache fresh price
    try { await redisSet(CACHE_KEY, String(price), CACHE_TTL); } catch {}
    // Also store a longer-lived stale copy for the fallback below
    try { await redisSet(`${CACHE_KEY}:stale`, String(price), STALE_TTL); } catch {}

    return {
      statusCode: 200,
      headers: { ...CORS, "X-Cache": "MISS", "X-Source": "birdeye" },
      body: JSON.stringify({ ok: true, price, source: "birdeye" }),
    };
  }

  /* ── L3: Serve stale Redis value rather than returning an error ──
     This avoids blank P/L panels during brief Birdeye hiccups.
     The stale price is clearly labelled so callers can choose to show
     a "price may be delayed" indicator if they wish. */
  try {
    const stale = await redisGet(`${CACHE_KEY}:stale`);
    if (stale && parseFloat(stale) > 0) {
      return {
        statusCode: 200,
        headers: { ...CORS, "X-Cache": "STALE", "X-Source": "birdeye-stale" },
        body: JSON.stringify({ ok: true, price: parseFloat(stale), source: "birdeye-stale", stale: true }),
      };
    }
  } catch {}

  /* ── L4: In-memory last known price (warm lambda only, expires after 5 min) ── */
  if (_lastKnownPrice > 0 && Date.now() - _lastKnownTs < IN_MEMORY_MAX_AGE_MS) {
    console.warn("[solPrice] All caches cold — serving in-memory last known price:", _lastKnownPrice);
    return {
      statusCode: 200,
      headers: { ...CORS, "X-Cache": "STALE-MEM", "X-Source": "birdeye-stale" },
      body: JSON.stringify({ ok: true, price: _lastKnownPrice, source: "birdeye-stale", stale: true }),
    };
  }

  /* ── L5: No price available anywhere — return 503 so clients can show a clear error ── */
  console.error("[solPrice] Birdeye unreachable and no cached value available — returning 503");
  return {
    statusCode: 503,
    headers: CORS,
    body: JSON.stringify({ ok: false, error: "SOL price temporarily unavailable — please retry shortly.", stale: true }),
  };
};
