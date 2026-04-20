// netlify/functions/solPrice.js
// GET /.netlify/functions/solPrice
// Returns current SOL/USD price. Called by safe-ape.js frontend
// (Binance is CORS-blocked from browsers — this proxies it server-side).
// Redis TTL: 10s to keep it fresh for P/L display accuracy.

const https = require("https");
const { redisGet, redisSet, CORS } = require("./db");

const CACHE_KEY = "sol_price_usd";
const CACHE_TTL = 10;

function fetchBinance() {
  return new Promise((resolve) => {
    const req = https.get(
      "https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT",
      { timeout: 3000 },
      (res) => {
        let d = "";
        res.on("data", c => { d += c; });
        res.on("end", () => {
          try { resolve(parseFloat(JSON.parse(d).price) || 0); }
          catch { resolve(0); }
        });
      }
    );
    req.on("error",   () => resolve(0));
    req.on("timeout", () => { req.destroy(); resolve(0); });
  });
}

function fetchCoinGecko() {
  return new Promise((resolve) => {
    const req = https.get(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
      { timeout: 4000 },
      (res) => {
        let d = "";
        res.on("data", c => { d += c; });
        res.on("end", () => {
          try { resolve(parseFloat(JSON.parse(d)?.solana?.usd) || 0); }
          catch { resolve(0); }
        });
      }
    );
    req.on("error",   () => resolve(0));
    req.on("timeout", () => { req.destroy(); resolve(0); });
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  /* ── Redis cache (10 s) ── */
  try {
    const cached = await redisGet(CACHE_KEY);
    if (cached && parseFloat(cached) > 0) {
      return {
        statusCode: 200,
        headers: { ...CORS, "X-Cache": "HIT" },
        body: JSON.stringify({ ok: true, price: parseFloat(cached) }),
      };
    }
  } catch {}

  /* ── Binance (primary) ── */
  let price = await fetchBinance();

  /* ── CoinGecko (fallback) ── */
  if (!price) price = await fetchCoinGecko();

  /* ── Last resort fallback ── */
  if (!price) {
    return {
      statusCode: 503,
      headers: CORS,
      body: JSON.stringify({ ok: false, error: "SOL price unavailable" }),
    };
  }

  try { await redisSet(CACHE_KEY, String(price), CACHE_TTL); } catch {}

  return {
    statusCode: 200,
    headers: { ...CORS, "X-Cache": "MISS" },
    body: JSON.stringify({ ok: true, price }),
  };
};
