// netlify/functions/priceOnly.js
// GET /.netlify/functions/priceOnly?mint=<mint>
//
// Ultra-lightweight live price endpoint for the candle chart ticker.
// Calls Birdeye /defi/price — single field, very low compute-unit cost.
// Redis TTL: 5s so at most 12 Birdeye calls/min per open chart.
//
// Returns: { ok, price, updatedAt }

const { redisGet, redisSet, CORS } = require("./db");

async function fetchBirdeyePrice(mint) {
  const BIRDEYE_KEY = process.env.BIRDEYE_API_KEY;
  if (!BIRDEYE_KEY) throw new Error("BIRDEYE_API_KEY not set");

  const url = `https://public-api.birdeye.so/defi/price?address=${encodeURIComponent(mint)}&check_liquidity=100`;
  const res = await fetch(url, {
    headers: { "X-API-KEY": BIRDEYE_KEY, "x-chain": "solana" },
    signal: AbortSignal.timeout(5000),
  });

  if (res.status === 400) {
    const txt = await res.text();
    if (txt.includes("Compute units")) {
      const err = new Error(`QUOTA_EXCEEDED: ${txt.slice(0, 200)}`);
      err.quotaExceeded = true;
      throw err;
    }
  }
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Birdeye ${res.status}: ${txt.slice(0, 120)}`);
  }

  const json = await res.json();
  return parseFloat(json?.data?.value || "0");
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  const { mint } = event.queryStringParameters || {};
  if (!mint) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ ok: false, error: "mint required" }),
    };
  }

  const cacheKey = `px5:${mint}`;
  const PRICE_TTL = 5; // 5-second Redis TTL → max 12 Birdeye calls/min

  // ── L1: Redis ──────────────────────────────────────────────────
  try {
    const cached = await redisGet(cacheKey);
    if (cached !== null && cached > 0) {
      return {
        statusCode: 200,
        headers: { ...CORS, "X-Cache": "HIT" },
        body: JSON.stringify({ ok: true, price: cached, updatedAt: Date.now() }),
      };
    }
  } catch (e) {
    console.warn("Redis GET failed:", e.message);
  }

  // ── L2: Birdeye ────────────────────────────────────────────────
  try {
    const price = await fetchBirdeyePrice(mint);
    if (price <= 0) {
      return {
        statusCode: 404,
        headers: CORS,
        body: JSON.stringify({ ok: false, error: "No price data" }),
      };
    }
    try { await redisSet(cacheKey, price, PRICE_TTL); } catch {}
    return {
      statusCode: 200,
      headers: { ...CORS, "X-Cache": "MISS" },
      body: JSON.stringify({ ok: true, price, updatedAt: Date.now() }),
    };
  } catch (e) {
    if (e.quotaExceeded) {
      return {
        statusCode: 429,
        headers: CORS,
        body: JSON.stringify({ ok: false, error: "quota_exceeded" }),
      };
    }
    console.error("priceOnly fetch failed:", e.message);
    return {
      statusCode: 502,
      headers: CORS,
      body: JSON.stringify({ ok: false, error: e.message }),
    };
  }
};
