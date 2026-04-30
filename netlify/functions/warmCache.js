// netlify/functions/warmCache.js
// Netlify Scheduled Function — runs every 2 minutes via cron.
// Refreshes OHLCV + token data for the top 30 hot tokens so that
// real user requests always hit Redis/Neon instead of Birdeye.

const { getDb, redisSet } = require("./db");

const TF_LIST   = ["5m", "15m", "1h"];   // timeframes to keep warm
const BIRDEYE_TF = { "5m": "5m", "15m": "15m", "1h": "1H" };
const BAR_SEC    = { "5m": 300, "15m": 900, "1h": 3600 };
const REDIS_TTL  = { "5m": 20, "15m": 60, "1h": 180 };
const NEON_STALE = { "5m": 60, "15m": 180, "1h": 600 };

// ── Birdeye OHLCV ─────────────────────────────────────────────────────────
async function fetchOHLCV(mint, tf) {
  const KEY = process.env.BIRDEYE_API_KEY;
  const timeTo   = Math.floor(Date.now() / 1000);
  const timeFrom = timeTo - BAR_SEC[tf] * 200;
  const url = `https://public-api.birdeye.so/defi/ohlcv?address=${encodeURIComponent(mint)}&type=${BIRDEYE_TF[tf]}&time_from=${timeFrom}&time_to=${timeTo}`;
  const res = await fetch(url, {
    headers: { "X-API-KEY": KEY, "x-chain": "solana" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Birdeye OHLCV ${res.status}`);
  const json = await res.json();
  const items = json?.data?.items;
  if (!Array.isArray(items)) return [];
  return items.map(b => ({
    time: Math.floor(b.unixTime), open: b.open, high: b.high,
    low: b.low, close: b.close, volume: b.volume ?? 0,
  })).sort((a, b) => a.time - b.time);
}

// ── Birdeye token price ───────────────────────────────────────────────────
async function fetchToken(mint) {
  const KEY = process.env.BIRDEYE_API_KEY;
  const [p, o] = await Promise.all([
    fetch(`https://public-api.birdeye.so/defi/price?address=${encodeURIComponent(mint)}`,
      { headers: { "X-API-KEY": KEY, "x-chain": "solana" }, signal: AbortSignal.timeout(6000) }),
    fetch(`https://public-api.birdeye.so/defi/token_overview?address=${encodeURIComponent(mint)}`,
      { headers: { "X-API-KEY": KEY, "x-chain": "solana" }, signal: AbortSignal.timeout(6000) }),
  ]);
  const pj = p.ok ? await p.json() : null;
  const oj = o.ok ? await o.json() : null;
  return {
    mint,
    symbol:    oj?.data?.symbol    ?? null,
    name:      oj?.data?.name      ?? null,
    logoUri:   oj?.data?.logoURI   ?? null,
    priceUsd:  pj?.data?.value     ?? Number(oj?.data?.price ?? 0),
    volume24h: oj?.data?.v24hUSD   ?? null,
    marketCap: oj?.data?.mc        ?? null,
    fetchedAt: Date.now(),
  };
}

// ── Neon upserts ──────────────────────────────────────────────────────────
const CHUNK = 50; // parallel upsert concurrency — avoids N+1 serial await

async function upsertBars(sql, mint, tf, bars) {
  for (let i = 0; i < bars.length; i += CHUNK) {
    const slice = bars.slice(i, i + CHUNK);
    await Promise.all(slice.map(b => sql`
      INSERT INTO ohlcv_cache (mint, tf, ts, open, high, low, close, volume)
      VALUES (${mint}, ${tf}, ${b.time}, ${b.open}, ${b.high}, ${b.low}, ${b.close}, ${b.volume})
      ON CONFLICT (mint, tf, ts) DO UPDATE
        SET high  = GREATEST(ohlcv_cache.high, EXCLUDED.high),
            low   = LEAST(ohlcv_cache.low,  EXCLUDED.low),
            close = EXCLUDED.close,
            volume = EXCLUDED.volume,
            fetched_at = NOW()
    `));
  }
}

async function upsertToken(sql, d) {
  await sql`
    INSERT INTO token_cache (mint, symbol, name, logo_uri, price_usd, volume_24h, market_cap, fetched_at)
    VALUES (${d.mint}, ${d.symbol}, ${d.name}, ${d.logoUri}, ${d.priceUsd}, ${d.volume24h}, ${d.marketCap}, NOW())
    ON CONFLICT (mint) DO UPDATE
      SET symbol=EXCLUDED.symbol, name=EXCLUDED.name, logo_uri=EXCLUDED.logo_uri,
          price_usd=EXCLUDED.price_usd, volume_24h=EXCLUDED.volume_24h,
          market_cap=EXCLUDED.market_cap, fetched_at=NOW()
  `;
}

// ── Main handler ──────────────────────────────────────────────────────────
exports.handler = async (event) => {
  // Reject HTTP requests that aren't from the Netlify scheduler.
  // The scheduler sends no httpMethod; direct HTTP hits have one.
  // Also accept requests with the internal warm secret for manual triggers.
  const SECRET = process.env.WARM_CACHE_SECRET;
  if (event?.httpMethod) {
    const authHeader = event?.headers?.["x-warm-secret"] || "";
    if (!SECRET || authHeader !== SECRET) {
      return { statusCode: 403, body: "Forbidden" };
    }
  }

  const started = Date.now();
  console.log("[warmCache] Starting warm run at", new Date().toISOString());

  let sql;
  try {
    sql = getDb();
  } catch (e) {
    console.error("[warmCache] DB connect failed:", e.message);
    return { statusCode: 500, body: e.message };
  }

  // Load hot tokens list
  let mints = [];
  try {
    const rows = await sql`
      SELECT mint FROM hot_tokens
      ORDER BY rank ASC
      LIMIT 30
    `;
    mints = rows.map(r => r.mint);
  } catch (e) {
    console.warn("[warmCache] hot_tokens query failed:", e.message);
    return { statusCode: 200, body: "No hot tokens yet." };
  }

  if (!mints.length) {
    console.log("[warmCache] hot_tokens table is empty — nothing to warm.");
    return { statusCode: 200, body: "No hot tokens." };
  }

  console.log(`[warmCache] Warming ${mints.length} tokens × ${TF_LIST.length} TFs...`);

  let ohlcvOk = 0, ohlcvErr = 0, tokenOk = 0, tokenErr = 0;

  // Process sequentially to avoid hammering Birdeye rate limits
  for (const mint of mints) {
    // Warm token metadata
    try {
      const token = await fetchToken(mint);
      await upsertToken(sql, token);
      await redisSet(`token:${mint}`, token, 45);
      tokenOk++;
    } catch (e) {
      console.warn(`[warmCache] token ${mint.slice(0,8)}: ${e.message}`);
      tokenErr++;
    }

    // Warm each timeframe
    for (const tf of TF_LIST) {
      try {
        const bars = await fetchOHLCV(mint, tf);
        if (bars.length) {
          await upsertBars(sql, mint, tf, bars);
          await redisSet(`ohlcv:${mint}:${tf}`, bars, REDIS_TTL[tf]);
          ohlcvOk++;
        }
      } catch (e) {
        console.warn(`[warmCache] ohlcv ${mint.slice(0,8)} ${tf}: ${e.message}`);
        ohlcvErr++;
      }

      // Small delay between Birdeye calls to stay under rate limits
      await new Promise(r => setTimeout(r, 150));
    }
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const summary = `Warmed ${mints.length} tokens in ${elapsed}s. OHLCV: ${ohlcvOk} ok / ${ohlcvErr} err. Token: ${tokenOk} ok / ${tokenErr} err.`;
  console.log("[warmCache]", summary);

  return { statusCode: 200, body: summary };
};
