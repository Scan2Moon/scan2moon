// netlify/functions/newPairs.js
// GET /.netlify/functions/newPairs
//
// Serves new token pairs from our own Neon DB, populated every 2 min
// by detectNewPairs.js (our own on-chain signal — no Birdeye premium needed).
//
// Falls back to live Birdeye query if the DB is cold (< 3 rows).
// Cache: Redis 60s.

const { getDb, redisGet, redisSet, CORS, CORS_429, isRateLimitedRedis } = require("./db");

const REDIS_TTL  = 60;   // 60s — short so new launches appear quickly
const WINDOW_SEC = 7 * 86400; // serve tokens detected in last 7 days

function fmtAge(unixSec) {
  const ms  = Date.now() - unixSec * 1000;
  const min = Math.floor(ms / 60000);
  if (min <  1)  return "< 1m";
  if (min < 60)  return min + "m";
  const hr = Math.floor(min / 60);
  if (hr  < 24)  return `${hr}h ${min % 60}m`;
  return `${Math.floor(hr / 24)}d`;
}

// ── Live Birdeye fallback (used only when DB is cold) ─────────────────────────
async function liveFallback(KEY) {
  const bH = { "X-API-KEY": KEY, "x-chain": "solana" };
  const attempts = [
    "sort_by=v24hUSD&sort_type=desc",
    "sort_by=liquidity&sort_type=desc",
  ];
  for (const sort of attempts) {
    try {
      const r = await fetch(
        `https://public-api.birdeye.so/defi/tokenlist?${sort}&offset=0&limit=20&min_liquidity=1000`,
        { headers: bH, signal: AbortSignal.timeout(8000) }
      );
      if (!r.ok) continue;
      const d = await r.json();
      const items = d?.data?.tokens || [];
      if (items.length) {
        console.log("[newPairs] live fallback using", sort.split("&")[0]);
        const nowSec = Math.floor(Date.now() / 1000);
        return items
          .filter(t => t.address && (t.mc || 0) < 100_000_000)
          .slice(0, 20)
          .map(t => ({
            mint:        t.address,
            symbol:      t.symbol  || "?",
            name:        t.name    || "Unknown",
            logo:        t.logoURI || null,
            price:       parseFloat(t.price   || 0),
            mc:          parseFloat(t.mc      || 0),
            liquidity:   parseFloat(t.liquidity || 0),
            vol24h:      parseFloat(t.v24hUSD  || 0),
            holders:     parseInt(t.holder     || 0, 10),
            createdAt:   new Date((nowSec - 3600) * 1000).toISOString(),
            age:         fmtAge(nowSec - 3600),
            riskLevel:   "MED",
            riskScore:   50,
            source:      "birdeye-live",
            creationSrc: "estimated",
          }));
      }
    } catch {}
  }
  return [];
}

exports.handler = async function(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  /* newPairs serves our own Neon DB signal — no per-call Birdeye cost.
     Free for everyone, just rate-limited. No x402 paywall needed. */
  const ip = (
    event.headers["x-nf-client-connection-ip"] ||
    event.headers["x-forwarded-for"] ||
    "unknown"
  ).split(",")[0].trim();

  if (await isRateLimitedRedis(ip, 20, 10)) {
    return { statusCode: 429, headers: CORS_429, body: JSON.stringify({ ok: false, error: "Too many requests" }) };
  }

  const KEY = process.env.BIRDEYE_API_KEY;
  if (!KEY) {
    return { statusCode: 500, headers: CORS,
             body: JSON.stringify({ ok: false, error: "BIRDEYE_API_KEY not set" }) };
  }

  // L1: Redis cache
  const CACHE_KEY = "newpairs:v4";
  try {
    const cached = await redisGet(CACHE_KEY);
    if (cached) {
      return {
        statusCode: 200,
        headers: { ...CORS, "X-Cache": "HIT" },
        body: JSON.stringify({ ok: true, source: "redis", tokens: cached.tokens, count: cached.count }),
      };
    }
  } catch {}

  try {
    // L2: Neon DB — our own signal
    const nowSec = Math.floor(Date.now() / 1000);
    let tokens = [];
    let dbSource = "db";

    try {
      const sql = getDb();
      const rows = await sql`
        SELECT mint, symbol, name, logo_uri, price_usd, liquidity, market_cap,
               vol_24h, holders, block_unix_time, detected_at, risk_score, risk_level
        FROM   new_pairs
        WHERE  detected_at > ${nowSec - WINDOW_SEC}
        ORDER  BY COALESCE(block_unix_time, detected_at) DESC
        LIMIT  50
      `;
      tokens = rows.map(r => ({
        mint:        r.mint,
        symbol:      r.symbol,
        name:        r.name,
        logo:        r.logo_uri,
        price:       parseFloat(r.price_usd   || 0),
        mc:          parseFloat(r.market_cap  || 0),
        liquidity:   parseFloat(r.liquidity   || 0),
        vol24h:      parseFloat(r.vol_24h     || 0),
        holders:     r.holders || 0,
        createdAt:   new Date((r.block_unix_time || r.detected_at) * 1000).toISOString(),
        age:         fmtAge(r.block_unix_time || r.detected_at),
        riskLevel:   r.risk_level || "MED",
        riskScore:   r.risk_score || 50,
        source:      "scan2moon-signal",
        creationSrc: r.block_unix_time ? "onchain" : "detected",
      }));
      console.log("[newPairs] DB returned", tokens.length, "tokens");
    } catch (e) {
      console.warn("[newPairs] DB query failed:", e.message);
    }

    // L3: Live Birdeye fallback if DB is cold (< 3 tokens)
    if (tokens.length < 3) {
      console.log("[newPairs] DB cold — using live Birdeye fallback");
      tokens = await liveFallback(KEY);
      dbSource = "birdeye-live";
    }

    const result = { tokens, count: tokens.length };
    try { await redisSet(CACHE_KEY, result, REDIS_TTL); } catch {}
    return { statusCode: 200, headers: { ...CORS, "X-Cache": "MISS" }, body: JSON.stringify({ ok: true, source: dbSource, tokens: result.tokens, count: result.count }) };

  } catch (e) {
    console.error("[newPairs]", e.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ ok: false, error: "Failed to load new pairs" }) };
  }
};
