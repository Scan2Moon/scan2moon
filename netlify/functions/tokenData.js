// netlify/functions/tokenData.js
// GET /.netlify/functions/tokenData?mint=<mint>
//
// Returns token price + metadata.
// Cache layers: Redis (60s) → Neon (5 min stale) → Birdeye

const { getDb, redisGet, redisSet, CORS, CORS_429, isRateLimitedRedis } = require("./db");

const REDIS_TTL  = 30;      // seconds in Redis
const NEON_STALE = 5 * 60;  // seconds before Neon row is considered stale

// ── Birdeye: token price ──────────────────────────────────────────────────
async function fetchBirdeyeToken(mint) {
  const KEY = process.env.BIRDEYE_API_KEY;
  if (!KEY) throw new Error("BIRDEYE_API_KEY not set");

  // Fetch price + token overview in parallel
  const [priceRes, overviewRes] = await Promise.all([
    fetch(`https://public-api.birdeye.so/defi/price?address=${encodeURIComponent(mint)}`, {
      headers: { "X-API-KEY": KEY, "x-chain": "solana" },
      signal: AbortSignal.timeout(6000),
    }),
    fetch(`https://public-api.birdeye.so/defi/token_overview?address=${encodeURIComponent(mint)}`, {
      headers: { "X-API-KEY": KEY, "x-chain": "solana" },
      signal: AbortSignal.timeout(6000),
    }),
  ]);

  const priceJson    = priceRes.ok    ? await priceRes.json()    : null;
  const overviewJson = overviewRes.ok ? await overviewRes.json() : null;

  const priceUsd  = priceJson?.data?.value        ?? null;
  const overview  = overviewJson?.data             ?? {};

  return {
    mint,
    symbol:           overview.symbol              ?? null,
    name:             overview.name                ?? null,
    logoUri:          overview.logoURI             ?? null,
    priceUsd:         priceUsd                     ?? Number(overview.price ?? 0),
    volume24h:        overview.v24hUSD             ?? null,
    volume1h:         overview.v1hUSD              ?? null,
    marketCap:        overview.mc                  ?? null,
    liquidity:        overview.liquidity           ?? null,
    priceChange1h:    overview.priceChange1hPercent  ?? null,
    priceChange6h:    overview.priceChange6hPercent  ?? null,
    priceChange24h:   overview.priceChange24hPercent ?? null,
    buy24h:           overview.buy24h              ?? null,
    sell24h:          overview.sell24h             ?? null,
    buy1h:            overview.buy1h               ?? null,
    sell1h:           overview.sell1h              ?? null,
    createdAt:        overview.createdAt           ?? null,
    fetchedAt:        Date.now(),
  };
}

// ── Upsert token into Neon ────────────────────────────────────────────────
async function upsertToken(sql, data) {
  await sql`
    INSERT INTO token_cache (mint, symbol, name, logo_uri, price_usd, volume_24h, market_cap, fetched_at)
    VALUES (
      ${data.mint},
      ${data.symbol},
      ${data.name},
      ${data.logoUri},
      ${data.priceUsd},
      ${data.volume24h},
      ${data.marketCap},
      NOW()
    )
    ON CONFLICT (mint) DO UPDATE
      SET symbol     = EXCLUDED.symbol,
          name       = EXCLUDED.name,
          logo_uri   = EXCLUDED.logo_uri,
          price_usd  = EXCLUDED.price_usd,
          volume_24h = EXCLUDED.volume_24h,
          market_cap = EXCLUDED.market_cap,
          fetched_at = NOW()
  `;
}

// ── Load token from Neon ──────────────────────────────────────────────────
async function loadFromNeon(sql, mint) {
  const rows = await sql`
    SELECT mint, symbol, name, logo_uri, price_usd, volume_24h, market_cap, fetched_at
    FROM   token_cache
    WHERE  mint = ${mint}
    LIMIT  1
  `;
  if (!rows.length) return null;

  const r = rows[0];
  const ageSec = (Date.now() - new Date(r.fetched_at).getTime()) / 1000;
  if (ageSec > NEON_STALE) return null;

  return {
    mint:      r.mint,
    symbol:    r.symbol,
    name:      r.name,
    logoUri:   r.logo_uri,
    priceUsd:  Number(r.price_usd),
    volume24h: r.volume_24h ? Number(r.volume_24h) : null,
    marketCap: r.market_cap ? Number(r.market_cap) : null,
    fetchedAt: new Date(r.fetched_at).getTime(),
  };
}

// ── Main handler ──────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  // Rate limit: 30 requests per 10 s per IP
  const ip = (event.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (await isRateLimitedRedis(ip, 30, 10, "tokd")) {
    return { statusCode: 429, headers: CORS_429, body: JSON.stringify({ error: "Too many requests — slow down." }) };
  }

  const { mint } = event.queryStringParameters || {};
  if (!mint) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "mint required" }) };
  }
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid mint address format" }) };
  }

  const cacheKey = `token:${mint}`;

  // ── L1: Redis ──────────────────────────────────────────────────────────
  try {
    const cached = await redisGet(cacheKey);
    if (cached) {
      return {
        statusCode: 200,
        headers: { ...CORS, "X-Cache": "HIT-REDIS" },
        body: JSON.stringify({ ok: true, source: "redis", token: cached }),
      };
    }
  } catch {}

  // ── L2: Neon ───────────────────────────────────────────────────────────
  // NOTE: Neon token_cache only stores price/volume/marketCap — it does NOT
  // store liquidity, priceChange, or txns.  Returning incomplete data causes
  // the risk scorer in safe-ape and watchlist to compute wrong scores
  // (liquidity: 0 → LP Strength signal near 0 → score drops ~25 pts).
  // We therefore SKIP the Neon cache here and fall through to Birdeye.
  // The Neon table is still used by batchTokenData for the portfolio/dashboard
  // price display where only price+marketCap is needed.
  let sql;
  try { sql = getDb(); } catch (e) { console.warn("Neon init:", e.message); }

  // ── L3: Birdeye ────────────────────────────────────────────────────────
  let token;
  try {
    token = await fetchBirdeyeToken(mint);
  } catch (e) {
    console.error("Birdeye token fetch:", e.message);
    return {
      statusCode: 502,
      headers: CORS,
      body: JSON.stringify({ ok: false, error: "Token data unavailable", detail: e.message }),
    };
  }

  // Persist (fire-and-forget)
  Promise.all([
    sql ? upsertToken(sql, token).catch(e => console.warn("Neon upsert:", e.message)) : Promise.resolve(),
    redisSet(cacheKey, token, REDIS_TTL).catch(() => {}),
  ]);

  return {
    statusCode: 200,
    headers: { ...CORS, "X-Cache": "MISS" },
    body: JSON.stringify({ ok: true, source: "birdeye", token }),
  };
};
