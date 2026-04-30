/* ================================================================
   Scan2Moon – Dev Wallet History  (Netlify Function)
   GET /.netlify/functions/devWallet?wallet=<address>

   Given a deployer wallet, returns every token they've launched
   plus a rug-rate classification — unique data not available
   anywhere else on Solana.

   Core data logic lives in devWalletHelper.js, shared with
   lpPredictor.js (server-to-server, no HTTP round-trip needed).

   Cache: Redis 15 min (wallet level) + 30 min (per token)
   ================================================================ */

const { redisGet, redisSet, CORS, CORS_API } = require("./db");
const { resolveAccess, respond402 }           = require("./x402");
const { fetchDevWalletData, WALLET_RE, SKIP_SET } = require("./devWalletHelper");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  if (event.httpMethod !== "GET")
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Method not allowed" }) };

  const wallet = (event.queryStringParameters?.wallet ?? "").trim();

  // Return empty result for invalid / system wallets — not an error
  if (!wallet || !WALLET_RE.test(wallet) || SKIP_SET.has(wallet)) {
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ totalDeployed: 0, rugCount: 0, rugRate: 0, activeCount: 0, tokens: [], wallet }),
    };
  }

  /* Access gate: API key / x402 Base / Solana / paywall */
  const access = await resolveAccess(event, "devWallet");
  if (access.access === "paywall") return respond402("devWallet");
  if (access.access === "denied")
    return { statusCode: access.status, headers: CORS_API, body: JSON.stringify({ error: access.error }) };

  const HELIUS_KEY  = process.env.HELIUS_KEY;
  const BIRDEYE_KEY = process.env.BIRDEYE_API_KEY;
  if (!HELIUS_KEY || !BIRDEYE_KEY)
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "API keys not configured" }) };

  try {
    const result = await fetchDevWalletData(wallet, HELIUS_KEY, BIRDEYE_KEY, redisGet, redisSet);
    const cached  = result._fromCache;
    delete result._fromCache;
    return {
      statusCode: 200,
      headers: { ...CORS, "X-Cache": cached ? "HIT" : "MISS" },
      body: JSON.stringify(result),
    };
  } catch (e) {
    console.error("[devWallet]", e.message);
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        totalDeployed: 0, rugCount: 0, rugRate: 0, activeCount: 0, tokens: [], wallet,
        error: e.message,
      }),
    };
  }
};
