// netlify/functions/ohlcvData.js
// GET /.netlify/functions/ohlcvData?mint=<mint>&tf=<5m|15m|1h|4h|1d>
//
// Cache layers (fastest → slowest):
//   L1  Upstash Redis  (TTL: tf-dependent, sub-ms reads)
//   L2  Neon Postgres  (persistent, survives cold starts)
//   L3  Birdeye API    (source of truth, ~200ms)

const { getDb, redisGet, redisSet, CORS } = require("./db");

// ── Timeframe config ──────────────────────────────────────────────────────
// redisTtl: seconds to serve from Redis without hitting Birdeye.
//   Longer = fewer Birdeye calls = fast dashboard opens for repeat users.
//   15m candle closes every 15 min → 5 min (300s) cache is always accurate.
// staleAfterSec: how long Neon data is considered fresh (falls back to Birdeye when exceeded).
const TF_CONFIG = {
  "1m":  { birdeyeType: "1m",  redisTtl: 20,   barSec: 60,     limit: 500, staleAfterSec: 30    },
  "5m":  { birdeyeType: "5m",  redisTtl: 60,   barSec: 300,    limit: 300, staleAfterSec: 120   },
  "15m": { birdeyeType: "15m", redisTtl: 300,  barSec: 900,    limit: 200, staleAfterSec: 600   },
  "1h":  { birdeyeType: "1H",  redisTtl: 600,  barSec: 3600,   limit: 200, staleAfterSec: 1800  },
  "4h":  { birdeyeType: "4H",  redisTtl: 1800, barSec: 14400,  limit: 200, staleAfterSec: 7200  },
  "1d":  { birdeyeType: "1D",  redisTtl: 7200, barSec: 86400,  limit: 200, staleAfterSec: 86400 },
};

// ── Birdeye fetch with 429 retry ──────────────────────────────────────────
async function birdeyeFetchOhlcv(url, headers, retries = 2) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (res.status === 429 && retries > 0) {
    const wait = retries === 2 ? 1000 : 2000;
    console.log(`[ohlcvData] 429 — retrying in ${wait}ms (${retries} left)`);
    await new Promise(r => setTimeout(r, wait));
    return birdeyeFetchOhlcv(url, headers, retries - 1);
  }
  return res;
}

// ── Birdeye fetch ─────────────────────────────────────────────────────────
async function fetchBirdeye(mint, tf) {
  const cfg = TF_CONFIG[tf];
  if (!cfg) throw new Error(`Unknown tf: ${tf}`);
  const BIRDEYE_KEY = process.env.BIRDEYE_API_KEY;
  if (!BIRDEYE_KEY) throw new Error("BIRDEYE_API_KEY not set");

  // Birdeye requires time_from + time_to — without them it returns 0 items
  const timeTo   = Math.floor(Date.now() / 1000);
  const timeFrom = timeTo - cfg.barSec * cfg.limit;
  const url = `https://public-api.birdeye.so/defi/ohlcv?address=${encodeURIComponent(mint)}&type=${cfg.birdeyeType}&time_from=${timeFrom}&time_to=${timeTo}`;
  const headers = { "X-API-KEY": BIRDEYE_KEY, "x-chain": "solana" };
  const res = await birdeyeFetchOhlcv(url, headers);

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Birdeye ${res.status}: ${txt.slice(0, 200)}`);
  }

  const json = await res.json();
  const items = json?.data?.items;
  if (!Array.isArray(items) || items.length === 0) return [];

  // Log first item to detect field names (remove after confirmed)
  console.log("[Birdeye OHLCV] sample item keys:", Object.keys(items[0]));
  console.log("[Birdeye OHLCV] sample item:", JSON.stringify(items[0]));

  return items.map(b => ({
    time:   Math.floor(b.unixTime ?? b.time ?? 0),
    open:   b.open  ?? b.o ?? 0,
    high:   b.high  ?? b.h ?? 0,
    low:    b.low   ?? b.l ?? 0,
    close:  b.close ?? b.c ?? 0,
    volume: b.volume ?? b.v ?? 0,
  }))
  .filter(b => b.time > 0 && b.close > 0)
  .sort((a, b) => a.time - b.time);
}

// ── Upsert bars into Neon ─────────────────────────────────────────────────
async function upsertBars(sql, mint, tf, bars) {
  if (!bars.length) return;
  // Batch upsert in chunks of 100 to avoid query length limits
  const chunkSize = 100;
  for (let i = 0; i < bars.length; i += chunkSize) {
    const chunk = bars.slice(i, i + chunkSize);
    for (const b of chunk) {
      await sql`
        INSERT INTO ohlcv_cache (mint, tf, ts, open, high, low, close, volume)
        VALUES (${mint}, ${tf}, ${b.time}, ${b.open}, ${b.high}, ${b.low}, ${b.close}, ${b.volume})
        ON CONFLICT (mint, tf, ts) DO UPDATE
          SET open  = EXCLUDED.open,
              high  = GREATEST(ohlcv_cache.high, EXCLUDED.high),
              low   = LEAST(ohlcv_cache.low,  EXCLUDED.low),
              close = EXCLUDED.close,
              volume = EXCLUDED.volume,
              fetched_at = NOW()
      `;
    }
  }
}

// ── Load bars from Neon ───────────────────────────────────────────────────
async function loadFromNeon(sql, mint, tf) {
  const cfg = TF_CONFIG[tf];
  const rows = await sql`
    SELECT ts, open, high, low, close, volume, fetched_at
    FROM   ohlcv_cache
    WHERE  mint = ${mint}
      AND  tf   = ${tf}
    ORDER  BY ts ASC
    LIMIT  ${cfg.limit}
  `;
  if (!rows.length) return null;

  // Check freshness of latest bar
  const latestFetchedAt = rows[rows.length - 1].fetched_at;
  const ageSec = (Date.now() - new Date(latestFetchedAt).getTime()) / 1000;
  if (ageSec > cfg.staleAfterSec) return null; // stale → go to Birdeye

  return rows.map(r => ({
    time:   Number(r.ts),
    open:   Number(r.open),
    high:   Number(r.high),
    low:    Number(r.low),
    close:  Number(r.close),
    volume: Number(r.volume),
  }));
}

// ── Main handler ──────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  const { mint, tf = "15m" } = event.queryStringParameters || {};
  if (!mint) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "mint required" }) };
  }
  if (!TF_CONFIG[tf]) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: `tf must be one of: ${Object.keys(TF_CONFIG).join(",")}` }) };
  }

  const cacheKey = `ohlcv:${mint}:${tf}`;
  const cfg = TF_CONFIG[tf];

  // ── L1: Redis ──────────────────────────────────────────────────────────
  try {
    const cached = await redisGet(cacheKey);
    if (cached) {
      return {
        statusCode: 200,
        headers: { ...CORS, "X-Cache": "HIT-REDIS" },
        body: JSON.stringify({ ok: true, source: "redis", bars: cached }),
      };
    }
  } catch (e) {
    console.warn("Redis GET failed:", e.message);
  }

  // ── L2: Neon Postgres ──────────────────────────────────────────────────
  let bars = null;
  let sql;
  try {
    sql = getDb();
    bars = await loadFromNeon(sql, mint, tf);
  } catch (e) {
    console.warn("Neon load failed:", e.message);
  }

  if (bars) {
    // Warm Redis from Neon and return
    try { await redisSet(cacheKey, bars, cfg.redisTtl); } catch {}
    return {
      statusCode: 200,
      headers: { ...CORS, "X-Cache": "HIT-NEON" },
      body: JSON.stringify({ ok: true, source: "neon", bars }),
    };
  }

  // ── L3: Birdeye ────────────────────────────────────────────────────────
  try {
    bars = await fetchBirdeye(mint, tf);
  } catch (e) {
    console.error("Birdeye fetch failed:", e.message);
    return {
      statusCode: 502,
      headers: CORS,
      body: JSON.stringify({ ok: false, error: "OHLCV unavailable", detail: e.message }),
    };
  }

  if (!bars.length) {
    return {
      statusCode: 404,
      headers: CORS,
      body: JSON.stringify({ ok: false, error: "No OHLCV data for this mint" }),
    };
  }

  // Store in Neon + Redis (fire-and-forget)
  Promise.all([
    sql ? upsertBars(sql, mint, tf, bars).catch(e => console.warn("Neon upsert:", e.message)) : Promise.resolve(),
    redisSet(cacheKey, bars, cfg.redisTtl).catch(e => console.warn("Redis set:", e.message)),
  ]);

  return {
    statusCode: 200,
    headers: { ...CORS, "X-Cache": "MISS" },
    body: JSON.stringify({ ok: true, source: "birdeye", bars }),
  };
};
