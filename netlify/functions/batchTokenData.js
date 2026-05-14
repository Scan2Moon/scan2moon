// netlify/functions/batchTokenData.js
// GET /.netlify/functions/batchTokenData?mints=addr1,addr2,...
//
// Batch token overview using Birdeye /defi/token_overview.
// Accepts up to 25 comma-separated mint addresses.
// Each token is fetched in parallel; Redis caches each result for 30s.
//
// Returns: { ok, tokens: [ { mint, symbol, name, logoUri, priceUsd,
//   volume24h, volume1h, marketCap, liquidity,
//   priceChange1h, priceChange6h, priceChange24h,
//   buy24h, sell24h, buy1h, sell1h, createdAt } ] }

const { redisGet, redisSet, CORS, isRateLimitedRedis } = require("./db");

const REDIS_TTL  = 30;   // seconds
const MAX_MINTS  = 25;

async function fetchOneMint(mint, key) {
  const cacheKey = `token:${mint}`;

  // ── L1: Redis ──
  try {
    const cached = await redisGet(cacheKey);
    if (cached) return cached;
  } catch {}

  // ── L2: Birdeye — token_overview already includes price (ov.price)
  //    No separate /defi/price call needed — that would double Birdeye compute units.
  const overviewRes  = await fetch(`https://public-api.birdeye.so/defi/token_overview?address=${encodeURIComponent(mint)}`, {
    headers: { "X-API-KEY": key, "x-chain": "solana" },
    signal: AbortSignal.timeout(6000),
  });

  const overviewJson = overviewRes.ok ? await overviewRes.json() : null;
  const ov           = overviewJson?.data ?? {};

  const token = {
    mint,
    symbol:         ov.symbol              ?? null,
    name:           ov.name                ?? null,
    logoUri:        ov.logoURI             ?? null,
    priceUsd:       Number(ov.price         ?? 0),
    volume24h:      ov.v24hUSD             ?? null,
    volume1h:       ov.v1hUSD              ?? null,
    marketCap:      ov.mc                  ?? null,
    liquidity:      ov.liquidity           ?? null,
    priceChange1h:  ov.priceChange1hPercent  ?? null,
    priceChange6h:  ov.priceChange8hPercent  ?? ov.priceChange4hPercent ?? null, // Birdeye has no 6h field — 8h is closest
    priceChange24h: ov.priceChange24hPercent ?? null,
    buy24h:         ov.buy24h              ?? null,
    sell24h:        ov.sell24h             ?? null,
    buy1h:          ov.buy1h               ?? null,
    sell1h:         ov.sell1h              ?? null,
    createdAt:      ov.createdAt           ?? null,
  };

  try { await redisSet(cacheKey, token, REDIS_TTL); } catch {}
  return token;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  if (event.httpMethod !== "GET")
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Method not allowed" }) };

  const ip = (event.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (await isRateLimitedRedis(ip, 20, 10, "btd")) {
    return { statusCode: 429, headers: CORS, body: JSON.stringify({ error: "Too many requests" }) };
  }

  const KEY = process.env.BIRDEYE_API_KEY;
  if (!KEY) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "BIRDEYE_API_KEY not set" }) };
  }

  const rawMints = (event.queryStringParameters?.mints || "").trim();
  if (!rawMints) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "mints required" }) };
  }

  // Sanitise: only valid base58 chars, commas, max 25 mints
  const mints = rawMints
    .split(",")
    .map(m => m.trim().replace(/[^1-9A-HJ-NP-Za-km-z]/g, ""))
    .filter(m => m.length >= 32 && m.length <= 44)
    .slice(0, MAX_MINTS);

  if (!mints.length) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "No valid mints provided" }) };
  }

  // Fetch all in parallel
  const results = await Promise.allSettled(mints.map(m => fetchOneMint(m, KEY)));

  const tokens = results
    .map((r, i) => r.status === "fulfilled" ? r.value : { mint: mints[i], error: r.reason?.message })
    .filter(Boolean);

  return {
    statusCode: 200,
    headers: { ...CORS, "X-Cache": "MIXED" },
    body: JSON.stringify({ ok: true, tokens, count: tokens.length }),
  };
};
