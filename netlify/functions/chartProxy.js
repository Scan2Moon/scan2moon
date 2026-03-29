// netlify/functions/chartProxy.js
// Proxies DexScreener chart data server-side to bypass CORS.
// Returns OHLCV as [[ts_sec, open, high, low, close, volume], ...]
// so it's the same format as GeckoTerminal ohlcv_list.

/* Resolution map: safe-ape timeframe → DexScreener res param (minutes) */
const TF_RES = {
  "1m":  "1",
  "5m":  "5",
  "15m": "15",
  "1h":  "60",
  "4h":  "240",
  "1d":  "1440",
};

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/* Convert any bar format to [ts_sec, o, h, l, c, v] */
function normaliseBar(b) {
  if (Array.isArray(b)) {
    const ts = b[0] > 1e10 ? Math.floor(b[0] / 1000) : Number(b[0]);
    return [ts, Number(b[1])||0, Number(b[2])||0, Number(b[3])||0, Number(b[4])||0, Number(b[5])||0];
  }
  const ts_raw = b.time ?? b.timestamp ?? b.t ?? 0;
  const ts = ts_raw > 1e10 ? Math.floor(ts_raw / 1000) : Number(ts_raw);
  return [
    ts,
    parseFloat(b.open  ?? b.o ?? 0),
    parseFloat(b.high  ?? b.h ?? 0),
    parseFloat(b.low   ?? b.l ?? 0),
    parseFloat(b.close ?? b.c ?? 0),
    parseFloat(b.volume ?? b.v ?? 0),
  ];
}

/* Try multiple DexScreener chart endpoint variants */
async function tryFetch(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept":          "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "Origin":          "https://dexscreener.com",
      "Referer":         "https://dexscreener.com/",
      "Cache-Control":   "no-cache",
    },
    signal: AbortSignal.timeout(7000),
  });
  if (!res.ok) return null;
  return res.json();
}

exports.handler = async function(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  if (event.httpMethod !== "GET")     return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Method not allowed" }) };

  const q = event.queryStringParameters || {};
  const pairAddress = (q.pairAddress || "").trim();
  const tf          = (q.tf || "5m").trim();
  const chain       = (q.chain || "solana").trim();

  if (!pairAddress) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Missing pairAddress" }) };
  }

  const res = TF_RES[tf] || "5";
  const cb  = Math.floor(Date.now() / 1000);

  // Try several known DexScreener chart endpoint patterns
  const endpoints = [
    `https://io.dexscreener.com/dex/chart/amm/v3/${chain}/${pairAddress}?res=${res}&cb=${cb}`,
    `https://io.dexscreener.com/dex/chart/amm/v2/${chain}/${pairAddress}?res=${res}&cb=${cb}`,
    `https://io.dexscreener.com/dex/chart/v2/lines/usd/${chain}/${pairAddress}?res=${res}&cb=${cb}`,
  ];

  let ohlcv = [];
  let lastErr = null;

  /* Fire all endpoints in parallel — use the first that returns valid bars.
     Sequential attempts caused up to 21s of wait time when DexScreener
     rate-limits, which is the root cause of chart lag on TF switches. */
  const results = await Promise.allSettled(endpoints.map(url => tryFetch(url)));

  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value) {
      if (result.reason) lastErr = result.reason?.message || String(result.reason);
      continue;
    }
    const data = result.value;
    const rawBars = data.bars || data.data?.bars || (Array.isArray(data) ? data : null);
    if (!rawBars || !rawBars.length) continue;

    const candidate = rawBars
      .map(normaliseBar)
      .filter(b => b[0] > 0 && b[1] > 0)
      .sort((a, b) => a[0] - b[0]);

    if (candidate.length > ohlcv.length) {
      ohlcv = candidate; // keep the endpoint that returned the most bars
    }
    if (ohlcv.length > 2) break;
  }

  if (ohlcv.length > 0) {
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ ohlcv, source: "dexscreener", count: ohlcv.length }),
    };
  }

  // No data from any endpoint
  console.warn("chartProxy: all endpoints failed. lastErr:", lastErr);
  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({ ohlcv: [], source: "none", count: 0, error: lastErr }),
  };
};
