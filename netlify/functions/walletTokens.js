// netlify/functions/walletTokens.js
// GET /.netlify/functions/walletTokens?wallet=<address>
//
// Returns all SPL token holdings for a wallet using
// ONLY Birdeye /v1/wallet/token_list — no Helius RPC.
// Replaces callRpc("getTokenAccountsByOwner") in portfolio.js and whale-dna.js.
//
// Cache: Redis 30s (portfolio changes slowly; we still want near-real-time).

const { redisGet, redisSet, CORS, CORS_429, isRateLimitedRedis } = require("./db");

const REDIS_TTL  = 30;
const WALLET_RE  = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MIN_AMOUNT = 0; // return everything; caller can filter dust

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "GET")
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Method not allowed" }) };

  const ip = (event.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (await isRateLimitedRedis(ip, 10, 10, "wt"))
    return { statusCode: 429, headers: CORS_429, body: JSON.stringify({ error: "Too many requests" }) };

  const { wallet } = event.queryStringParameters || {};
  if (!wallet || !WALLET_RE.test(wallet))
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid or missing wallet address" }) };

  const cacheKey = `wallet2:${wallet}`;
  try {
    const cached = await redisGet(cacheKey);
    if (cached) return {
      statusCode: 200,
      headers: { ...CORS, "X-Cache": "HIT" },
      body: JSON.stringify({ ok: true, source: "cache", ...cached }),
    };
  } catch {}

  const KEY = process.env.BIRDEYE_API_KEY;
  if (!KEY)
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "BIRDEYE_API_KEY not set" }) };

  try {
    const res = await fetch(
      `https://public-api.birdeye.so/v1/wallet/token_list?wallet=${encodeURIComponent(wallet)}`,
      {
        headers: { "X-API-KEY": KEY, "x-chain": "solana" },
        signal: AbortSignal.timeout(12000),
      }
    );

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      if (res.status === 403 || res.status === 401) {
        return {
          statusCode: 200,
          headers: CORS,
          body: JSON.stringify({
            ok: false,
            planRestricted: true,
            tokens: [],
            error: "Wallet token list requires Birdeye Standard plan or above.",
          }),
        };
      }
      throw new Error(`Birdeye wallet/token_list ${res.status}: ${txt.slice(0, 200)}`);
    }

    const json  = await res.json();
    const items = json?.data?.items ?? [];

    const tokens = items
      .filter(t => t.address && parseFloat(t.uiAmount ?? 0) >= MIN_AMOUNT)
      .map(t => ({
        mint:     t.address,
        uiAmount: parseFloat(t.uiAmount  ?? 0),
        symbol:   t.symbol   ?? null,
        name:     t.name     ?? null,
        logoUri:  t.logoURI  ?? null,
        priceUsd: parseFloat(t.priceUsd  ?? 0),
        valueUsd: parseFloat(t.valueUsd  ?? (t.uiAmount * (t.priceUsd ?? 0))),
        decimals: parseInt(t.decimals    ?? 0),
      }));

    const payload = {
      tokens,
      count:  tokens.length,
      source: "birdeye",
    };

    try { await redisSet(cacheKey, payload, REDIS_TTL); } catch {}

    return {
      statusCode: 200,
      headers: { ...CORS, "X-Cache": "MISS" },
      body: JSON.stringify({ ok: true, ...payload }),
    };
  } catch (e) {
    console.error("[walletTokens] fetch error:", e.message);
    return {
      statusCode: 502,
      headers: CORS,
      body: JSON.stringify({ ok: false, error: "Wallet data unavailable", detail: e.message }),
    };
  }
};
