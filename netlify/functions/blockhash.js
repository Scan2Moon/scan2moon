// netlify/functions/blockhash.js
// GET /.netlify/functions/blockhash
//
// Returns the latest Solana blockhash for transaction signing (e.g. Moon Market payments).
// Proxied server-side so:
//   1. The RPC key is never exposed to the browser.
//   2. No direct third-party connections appear in the CSP connect-src.
//   3. Fallback RPC list is managed in one place.
//
// Cache: 6 seconds (blockhashes are valid for ~80 slots / ~32 seconds; 6s keeps it fresh).

const { CORS, CORS_429, isRateLimitedRedis } = require("./db");

const CACHE_TTL_MS = 6000;
let _cachedBlockhash = null;
let _cachedAt        = 0;

// Ordered list of public RPC endpoints — tried in sequence until one responds.
// These are only called server-side; they never appear in the browser CSP.
const RPC_ENDPOINTS = [
  process.env.HELIUS_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_KEY}`
    : null,
  "https://api.mainnet-beta.solana.com",
  "https://solana.drpc.org",
].filter(Boolean);

const RPC_BODY = JSON.stringify({
  jsonrpc: "2.0", id: 1,
  method: "getLatestBlockhash",
  params: [{ commitment: "confirmed" }],
});

async function fetchBlockhash() {
  for (const url of RPC_ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    RPC_BODY,
        signal:  AbortSignal.timeout(5000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const bh   = data?.result?.value?.blockhash;
      if (bh) return bh;
    } catch { /* try next */ }
  }
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "GET")
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "GET only" }) };

  const ip = (event.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (await isRateLimitedRedis(ip, 30, 10))
    return { statusCode: 429, headers: CORS_429, body: JSON.stringify({ error: "Too many requests" }) };

  // Serve in-process cache (warm lambda invocations only — not shared across instances)
  if (_cachedBlockhash && Date.now() - _cachedAt < CACHE_TTL_MS) {
    return {
      statusCode: 200,
      headers: { ...CORS, "X-Cache": "HIT" },
      body: JSON.stringify({ ok: true, blockhash: _cachedBlockhash }),
    };
  }

  const blockhash = await fetchBlockhash();

  if (!blockhash) {
    return {
      statusCode: 503,
      headers: CORS,
      body: JSON.stringify({ ok: false, error: "Could not reach Solana network — please retry." }),
    };
  }

  _cachedBlockhash = blockhash;
  _cachedAt        = Date.now();

  return {
    statusCode: 200,
    headers: { ...CORS, "X-Cache": "MISS" },
    body: JSON.stringify({ ok: true, blockhash }),
  };
};
