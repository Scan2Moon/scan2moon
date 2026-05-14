// netlify/functions/tokenSecurity.js
// GET /.netlify/functions/tokenSecurity?mint=<mint>
//
// Returns mint authority, freeze authority, total supply, decimals
// using ONLY Birdeye /defi/token_security — no Helius RPC.
// Replaces the old callRpc("getAccountInfo") + callRpc("getTokenSupply") calls
// in mainAnalysis.js and entry-radar.js.
//
// Cache: Redis 120s (authority fields never change after renounce).

const { redisGet, redisSet, CORS, CORS_429, isRateLimitedRedis } = require("./db");

const REDIS_TTL = 120;
const MINT_RE   = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "GET")
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Method not allowed" }) };

  const ip = (event.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (await isRateLimitedRedis(ip, 20, 10, "tsec"))
    return { statusCode: 429, headers: CORS_429, body: JSON.stringify({ error: "Too many requests" }) };

  const { mint } = event.queryStringParameters || {};
  if (!mint || !MINT_RE.test(mint))
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid or missing mint address" }) };

  const cacheKey = `security:${mint}`;
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
    // Fetch token_security + token_overview in parallel for full picture
    const [secRes, ovRes] = await Promise.all([
      fetch(
        `https://public-api.birdeye.so/defi/token_security?address=${encodeURIComponent(mint)}`,
        { headers: { "X-API-KEY": KEY, "x-chain": "solana" }, signal: AbortSignal.timeout(8000) }
      ),
      fetch(
        `https://public-api.birdeye.so/defi/token_overview?address=${encodeURIComponent(mint)}`,
        { headers: { "X-API-KEY": KEY, "x-chain": "solana" }, signal: AbortSignal.timeout(8000) }
      ),
    ]);

    if (!secRes.ok) {
      const txt = await secRes.text().catch(() => "");
      throw new Error(`Birdeye token_security ${secRes.status}: ${txt.slice(0, 200)}`);
    }

    const secJson = await secRes.json();
    const ovJson  = ovRes.ok ? await ovRes.json() : null;
    const d       = secJson?.data ?? {};
    const ov      = ovJson?.data  ?? {};

    // Normalise authority fields — Birdeye uses different casings across API versions
    const mintAuth   = d.mintAuthority   ?? d.mint_authority   ?? null;
    const freezeAuth = d.freezeAuthority ?? d.freeze_authority ?? null;

    // Total supply — prefer security endpoint, fall back to overview
    const totalSupply = d.totalSupply ?? d.total_supply ?? ov.supply ?? null;
    const decimals    = d.decimals    ?? ov.decimals                  ?? null;

    // Dev wallet (creator) — Birdeye token_security may include this
    const creatorAddress = d.creatorAddress ?? d.creator_address ?? null;
    const creatorPct     = d.creatorPercentage ?? d.creator_percentage ?? null;

    const payload = {
      mintAuthority:    mintAuth   === null ? "Renounced" : mintAuth,
      freezeAuthority:  freezeAuth === null ? "Renounced" : freezeAuth,
      totalSupply:      totalSupply !== null ? String(totalSupply) : null,
      decimals:         decimals    !== null ? Number(decimals)    : null,
      creatorAddress:   creatorAddress ?? null,
      creatorPercent:   creatorPct     !== null ? parseFloat(creatorPct) : null,
      top10HolderPercent: d.top10HolderPercent ?? d.top_10_holder_percent ?? null,
      source: "birdeye",
    };

    try { await redisSet(cacheKey, payload, REDIS_TTL); } catch {}

    return {
      statusCode: 200,
      headers: { ...CORS, "X-Cache": "MISS" },
      body: JSON.stringify({ ok: true, ...payload }),
    };
  } catch (e) {
    console.error("[tokenSecurity] fetch error:", e.message);
    return {
      statusCode: 502,
      headers: CORS,
      body: JSON.stringify({ ok: false, error: "Token security data unavailable", detail: e.message }),
    };
  }
};
