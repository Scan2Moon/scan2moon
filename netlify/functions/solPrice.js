// netlify/functions/solPrice.js
// GET /.netlify/functions/solPrice
// Returns current SOL/USD price. Called by safe-ape.js and watchlist.js frontends.
// Binance is CORS-blocked from browsers AND geo-blocked (451) in some server regions.
// Jupiter Price API is the primary source — globally available, no geo-restrictions.
// Redis TTL: 10s to keep it fresh for P/L display accuracy.
//
// Priority chain: Jupiter → Pyth (on-chain oracle) → CoinGecko → Binance

const https = require("https");
const { redisGet, redisSet, CORS } = require("./db");

const CACHE_KEY = "sol_price_usd_v2";
const CACHE_TTL = 10;

/* SOL mint address (needed for some APIs) */
const SOL_MINT = "So11111111111111111111111111111111111111112";

function httpsGet(url, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      // Follow redirects up to 2 hops
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(httpsGet(res.headers.location, timeoutMs));
        return;
      }
      let d = "";
      res.on("data", c => { d += c; });
      res.on("end", () => resolve({ status: res.statusCode, body: d }));
    });
    req.on("error",   () => resolve({ status: 0, body: "" }));
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, body: "" }); });
  });
}

/* ── Jupiter Price API v2 (primary — global, no geo-blocks) ── */
async function fetchJupiter() {
  try {
    const { status, body } = await httpsGet(
      `https://api.jup.ag/price/v2?ids=${SOL_MINT}`,
      4000
    );
    if (status === 200) {
      const json = JSON.parse(body);
      const price = parseFloat(json?.data?.[SOL_MINT]?.price);
      if (price > 0) return price;
    }
  } catch {}
  return 0;
}

/* ── CoinGecko (secondary fallback) ── */
async function fetchCoinGecko() {
  try {
    const { status, body } = await httpsGet(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
      5000
    );
    if (status === 200) {
      const price = parseFloat(JSON.parse(body)?.solana?.usd);
      if (price > 0) return price;
    }
  } catch {}
  return 0;
}

/* ── Binance (tertiary — may be geo-blocked in some regions) ── */
async function fetchBinance() {
  try {
    const { status, body } = await httpsGet(
      "https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT",
      3000
    );
    if (status === 200) {
      const price = parseFloat(JSON.parse(body)?.price);
      if (price > 0) return price;
    }
  } catch {}
  return 0;
}

/* ── OKX (quaternary fallback) ── */
async function fetchOKX() {
  try {
    const { status, body } = await httpsGet(
      "https://www.okx.com/api/v5/market/ticker?instId=SOL-USDT",
      4000
    );
    if (status === 200) {
      const price = parseFloat(JSON.parse(body)?.data?.[0]?.last);
      if (price > 0) return price;
    }
  } catch {}
  return 0;
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

  /* ── Try sources in order ── */
  let price = await fetchJupiter();
  if (!price) price = await fetchCoinGecko();
  if (!price) price = await fetchBinance();
  if (!price) price = await fetchOKX();

  if (!price) {
    return {
      statusCode: 503,
      headers: CORS,
      body: JSON.stringify({ ok: false, error: "SOL price unavailable from all sources" }),
    };
  }

  try { await redisSet(CACHE_KEY, String(price), CACHE_TTL); } catch {}

  return {
    statusCode: 200,
    headers: { ...CORS, "X-Cache": "MISS" },
    body: JSON.stringify({ ok: true, price }),
  };
};
