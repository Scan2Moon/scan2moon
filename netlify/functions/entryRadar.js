// netlify/functions/entryRadar.js
// GET /.netlify/functions/entryRadar
//
// Returns recently active Solana tokens with real DEX liquidity.
// Powered entirely by Birdeye /defi/tokenlist (free tier — no premium required).
//
// Strategy: fetch tokens sorted by 24h% change with min_liquidity filter,
// then cap at MAX_MC to exclude established coins.
//
// NOTE: v24hChangePercent from Birdeye tokenlist = 24h VOLUME change %, not price change.
// Displayed in "VOL Δ 24H" column in the UI.
//
// Redis TTL: 60s

const { redisGet, redisSet, CORS, CORS_429, isRateLimitedRedis } = require("./db");

const REDIS_TTL = 60;
const MAX_MC    = 50_000_000;
const MIN_LIQ   = 5_000;

const STABLES = new Set([
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
]);

async function fetchTokenList(key) {
  const params = new URLSearchParams({
    sort_by:       "v24hChangePercent",
    sort_type:     "desc",
    offset:        "0",
    limit:         "50",
    min_liquidity: String(MIN_LIQ),
  });

  const res = await fetch(
    `https://public-api.birdeye.so/defi/tokenlist?${params}`,
    {
      headers: { "X-API-KEY": key, "x-chain": "solana" },
      signal: AbortSignal.timeout(9000),
    }
  );

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Birdeye tokenlist HTTP ${res.status}: ${errBody.slice(0, 300)}`);
  }

  const data  = await res.json();
  const items = data?.data?.tokens ?? [];

  const tokens = items
    .filter(t => {
      if (!t.address || STABLES.has(t.address)) return false;
      const liq = parseFloat(t.liquidity ?? 0);
      const mc  = parseFloat(t.mc        ?? 0);
      if (liq < MIN_LIQ) return false;
      if (mc  > MAX_MC)  return false;
      return true;
    })
    .slice(0, 40)
    .map(t => ({
      tokenAddress: t.address,
      chainId:      "solana",
      name:         t.name    ?? null,
      symbol:       t.symbol  ?? null,
      logoURI:      t.logoURI ?? null,
      liquidity:    parseFloat(t.liquidity         ?? 0),
      price:        parseFloat(t.price             ?? 0),
      mc:           parseFloat(t.mc                ?? 0),
      v24hUSD:      parseFloat(t.v24hUSD           ?? 0),
      // v24hChangePercent = 24h VOLUME change % (used for sorting + "VOL Δ 24H" column)
      v24hChange:   parseFloat(t.v24hChangePercent ?? 0),
      // Prefer actual createdAt if Birdeye provides it; lastTradeUnixTime = most recent trade
      createdAt:    t.createdAt         ?? null,
      lastTradeTs:  t.lastTradeUnixTime ?? null,
      source:       "birdeye",
    }));

  return tokens;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  if (event.httpMethod !== "GET")     return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Method not allowed" }) };

  const ip = (event.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (await isRateLimitedRedis(ip, 15, 10)) {
    return { statusCode: 429, headers: CORS_429, body: JSON.stringify({ error: "Too many requests" }) };
  }

  const KEY = process.env.BIRDEYE_API_KEY;
  if (!KEY) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "BIRDEYE_API_KEY not set" }) };
  }

  const cacheKey = "entry_radar_v2";

  try {
    const cached = await redisGet(cacheKey);
    if (cached) {
      return {
        statusCode: 200,
        headers: { ...CORS, "X-Cache": "HIT" },
        body: JSON.stringify({ ok: true, tokens: cached, source: "cache" }),
      };
    }
  } catch {}

  try {
    const tokens = await fetchTokenList(KEY);
    try { await redisSet(cacheKey, tokens, REDIS_TTL); } catch {}
    return {
      statusCode: 200,
      headers: { ...CORS, "X-Cache": "MISS" },
      body: JSON.stringify({ ok: true, tokens, source: "birdeye", count: tokens.length }),
    };
  } catch (e) {
    console.error("[entryRadar] Birdeye fetch failed:", e.message);
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        ok:     false,
        tokens: [],
        count:  0,
        error:  "Entry Radar temporarily unavailable — Birdeye could not be reached.",
        detail: e.message,
      }),
    };
  }
};
