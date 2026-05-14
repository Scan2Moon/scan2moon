// netlify/functions/geckoProxy.js
// OHLCV data proxy — migrated from GeckoTerminal → Birdeye /defi/ohlcv
//
// Returns ohlcv_list as [[ts_sec, open, high, low, close, volume], ...]
// (same array format as before so all callers work without changes)
//
// Query params:
//   pairAddress  — token or pair mint address
//   path         — "minute" | "hour" | "day"   (GeckoTerminal-style, mapped to Birdeye type)
//   agg          — aggregation number (15 for 15m, 4 for 4H, etc.)
//   limit        — number of candles (default 96)

const { CORS, CORS_429, isRateLimitedRedis } = require("./db");

// Map GeckoTerminal (path + agg) → Birdeye type string
const TYPE_MAP = {
  "minute:1":  "1m",  "minute:3":  "3m",  "minute:5":  "5m",
  "minute:15": "15m", "minute:30": "30m",
  "hour:1":    "1H",  "hour:2":    "2H",  "hour:4":    "4H",
  "hour:6":    "6H",  "hour:8":    "8H",  "hour:12":   "12H",
  "day:1":     "1D",  "day:3":     "3D",  "day:7":     "1W",
};

// How many seconds each candle covers (used to calculate time_from)
const SECONDS_PER_TYPE = {
  "1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1800,
  "1H": 3600, "2H": 7200, "4H": 14400, "6H": 21600, "8H": 28800, "12H": 43200,
  "1D": 86400, "3D": 259200, "1W": 604800,
};

exports.handler = async function(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  if (event.httpMethod !== "GET")     return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Method not allowed" }) };

  const ip = (event.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (await isRateLimitedRedis(ip, 30, 10, "gecko")) {
    return { statusCode: 429, headers: CORS_429, body: JSON.stringify({ error: "Too many requests" }) };
  }

  const q           = event.queryStringParameters || {};
  const pairAddress = (q.pairAddress || "").trim();
  const path        = (q.path  || "minute").trim();
  const agg         = parseInt(q.agg   || "15", 10);
  const limit       = Math.min(parseInt(q.limit || "96", 10), 500);

  if (!pairAddress) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Missing pairAddress" }) };
  }
  // Validate base58 Solana address format
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(pairAddress)) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid pairAddress format" }) };
  }

  if (!["minute", "hour", "day"].includes(path)) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid path" }) };
  }

  const birdeyeType = TYPE_MAP[`${path}:${agg}`] || "15m";
  const candleSecs  = SECONDS_PER_TYPE[birdeyeType] || 900;
  const timeTo      = Math.floor(Date.now() / 1000);
  const timeFrom    = timeTo - (candleSecs * (limit + 5)); // +5 buffer

  const KEY = process.env.BIRDEYE_API_KEY;
  if (!KEY) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "BIRDEYE_API_KEY not set" }) };
  }

  const url = `https://public-api.birdeye.so/defi/ohlcv?address=${encodeURIComponent(pairAddress)}` +
              `&type=${birdeyeType}&time_from=${timeFrom}&time_to=${timeTo}`;

  try {
    const res = await fetch(url, {
      headers: { "X-API-KEY": KEY, "x-chain": "solana" },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      console.warn(`geckoProxy (Birdeye): responded ${res.status} for ${pairAddress}`);
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({ ohlcv_list: [], source: "birdeye", count: 0, error: `HTTP ${res.status}` }),
      };
    }

    const data  = await res.json();
    const items = data?.data?.items || [];

    // Transform Birdeye format → [[ts_sec, open, high, low, close, volume], ...]
    // Birdeye returns full field names (open/high/low/close/volume) — fall back to
    // short aliases (o/h/l/c/v) just in case the API ever changes.
    const ohlcv_list = items.slice(-limit).map(b => {
      const rawTs = b.unixTime ?? b.time ?? 0;
      // unixTime is already seconds; guard against rare ms values (> year 2100 in seconds)
      const ts = rawTs > 4_000_000_000 ? Math.floor(rawTs / 1000) : Math.floor(rawTs);
      return [
        ts,
        Number(b.open   ?? b.o ?? 0),
        Number(b.high   ?? b.h ?? 0),
        Number(b.low    ?? b.l ?? 0),
        Number(b.close  ?? b.c ?? 0),
        Number(b.volume ?? b.v ?? 0),
      ];
    }).filter(row => row[0] > 0 && row[4] > 0); // drop zero-close bars

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ ohlcv_list, source: "birdeye", count: ohlcv_list.length }),
    };

  } catch (err) {
    console.warn("geckoProxy (Birdeye) fetch error:", err.message);
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ ohlcv_list: [], source: "birdeye", count: 0, error: err.message }),
    };
  }
};
