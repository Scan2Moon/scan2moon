// netlify/functions/holderData.js
// GET /.netlify/functions/holderData?mint=<mint>
//
// Returns top-20 token holders + ACCURATE top-10 concentration %
// using Birdeye /defi/v3/token/holder (list) + /defi/token_overview (top10 %).
//
// KEY FIX: /defi/v3/token/holder items do NOT include a percentage field.
// top10HolderPercent is sourced from token_overview (available on all plans,
// precomputed by Birdeye) — this is the same value Birdeye UI shows.
//
// Cache: Redis 60s per mint.

const { redisGet, redisSet, CORS, CORS_429, isRateLimitedRedis } = require("./db");

const REDIS_TTL = 60;
const MINT_RE   = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "GET")
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Method not allowed" }) };

  const ip = (event.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (await isRateLimitedRedis(ip, 15, 10))
    return { statusCode: 429, headers: CORS_429, body: JSON.stringify({ error: "Too many requests" }) };

  const { mint } = event.queryStringParameters || {};
  if (!mint || !MINT_RE.test(mint))
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid or missing mint address" }) };

  const cacheKey = `holders3:${mint}`;
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
    // Fetch holder list + token_overview in parallel.
    // token_overview.top10HolderPercent is the authoritative top10 value —
    // it matches what Birdeye UI shows and is available on all API plans.
    const [holderRes, ovRes] = await Promise.all([
      fetch(
        `https://public-api.birdeye.so/defi/v3/token/holder?address=${encodeURIComponent(mint)}&offset=0&limit=20`,
        { headers: { "X-API-KEY": KEY, "x-chain": "solana" }, signal: AbortSignal.timeout(9000) }
      ),
      fetch(
        `https://public-api.birdeye.so/defi/token_overview?address=${encodeURIComponent(mint)}`,
        { headers: { "X-API-KEY": KEY, "x-chain": "solana" }, signal: AbortSignal.timeout(8000) }
      ),
    ]);

    // Extract authoritative top10 from token_overview (0–1 fraction → multiply by 100)
    const ovJson  = ovRes.ok ? await ovRes.json() : null;
    const ovTop10 = ovJson?.data?.top10HolderPercent ?? null;

    if (!holderRes.ok) {
      const txt = await holderRes.text().catch(() => "");
      if (holderRes.status === 403 || holderRes.status === 401) {
        console.warn(`[holderData] v3/holder plan restriction for ${mint.slice(0,8)} — using overview top10`);
        const top10Fallback = ovTop10 !== null ? parseFloat((ovTop10 * 100).toFixed(2)) : 0;
        return {
          statusCode: 200,
          headers: { ...CORS, "X-Cache": "MISS" },
          body: JSON.stringify({
            ok: true, source: "birdeye", holders: [],
            top10Percent: top10Fallback,
            planRestricted: true,
            message: "Holder list requires Birdeye Standard plan — top10% from token_overview.",
          }),
        };
      }
      throw new Error(`Birdeye ${holderRes.status}: ${txt.slice(0, 200)}`);
    }

    const json  = await holderRes.json();
    const items = json?.data?.items ?? [];

    // Authoritative top10 from overview (stored as 0-1 fraction by Birdeye)
    // e.g. 0.9999 = 99.99%
    let top10Percent;
    if (ovTop10 !== null) {
      top10Percent = parseFloat((ovTop10 * 100).toFixed(2));
    } else {
      // Fallback: sum from holder items (less reliable — field may be absent)
      top10Percent = 0;
      items.slice(0, 10).forEach(h => {
        top10Percent += parseFloat(h.percentage ?? 0);
      });
      top10Percent = parseFloat(top10Percent.toFixed(2));
    }

    // Build per-holder percentage for display table
    // v3 items use snake_case: ui_amount, owner/address
    const totalUiAmount = items.reduce((s, h) => s + parseFloat(h.ui_amount ?? h.uiAmount ?? 0), 0) || 1;

    const holders = items.map(h => {
      const amt = parseFloat(h.ui_amount ?? h.uiAmount ?? 0);
      // If percentage field exists use it; otherwise compute from ui_amount/total
      const pct = h.percentage != null
        ? parseFloat(h.percentage)
        : parseFloat((amt / totalUiAmount * 100).toFixed(4));
      return {
        owner:      h.owner   ?? h.address ?? "Unknown",
        uiAmount:   amt,
        percentage: pct,
      };
    });

    const payload = { holders, top10Percent, source: "birdeye" };
    try { await redisSet(cacheKey, payload, REDIS_TTL); } catch {}

    return {
      statusCode: 200,
      headers: { ...CORS, "X-Cache": "MISS" },
      body: JSON.stringify({ ok: true, ...payload }),
    };

  } catch (e) {
    console.error("[holderData] fetch error:", e.message);
    return {
      statusCode: 502,
      headers: CORS,
      body: JSON.stringify({ ok: false, error: "Holder data unavailable", detail: e.message }),
    };
  }
};
