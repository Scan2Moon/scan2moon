// netlify/functions/topGainers.js
// GET /.netlify/functions/topGainers?tf=1h&min_liq=10000
//
// Birdeye tokenlist returns camelCase fields (priceChange1hPercent, v24hUSD etc.)
// sort_by accepts: v24hUSD | mc | fdv | holder | price | liquidity  (NOT price_change_*)
// We fetch 50 tokens sorted by volume, re-sort server-side by the TF price change.
// Redis TTL: 90s per tf+liq combo.

const { redisGet, redisSet, CORS } = require("./db");

/* ── Timeframe → Birdeye camelCase field name ── */
const TF_FIELD = {
  "30m": "priceChange30mPercent",
  "1h":  "priceChange1hPercent",
  "12h": "priceChange12hPercent",
  "24h": "priceChange24hPercent",
};

/* ── Quick risk score ── */
function quickRisk(tok) {
  const liq     = tok.liquidity             || 0;
  const mc      = tok.mc  || tok.fdv        || 0;
  const pc24    = tok.priceChange24hPercent || 0;
  const vol24   = tok.v24hUSD               || 0;
  const holders = tok.holder                || 0;

  let score = 50;

  if      (liq >= 500_000) score += 30;
  else if (liq >= 100_000) score += 22;
  else if (liq >= 50_000)  score += 16;
  else if (liq >= 10_000)  score += 8;
  else if (liq >= 2_000)   score += 2;
  else                     score -= 20;

  if (mc > 0 && liq > 0) {
    const r = mc / liq;
    if      (r > 1000) score -= 30;
    else if (r > 500)  score -= 20;
    else if (r > 200)  score -= 10;
    else if (r > 50)   score -= 2;
    else               score += 5;
  }

  if      (pc24 <= -80) score = Math.min(score, 20);
  else if (pc24 <= -50) score = Math.min(score, 30);
  else if (pc24 <= -30) score = Math.min(score, 44);

  if      (liq < 500)   score = Math.min(score, 15);
  else if (liq < 2_000) score = Math.min(score, 25);
  else if (liq < 5_000) score = Math.min(score, 35);

  if (liq > 0 && vol24 > 0) {
    const vl = vol24 / liq;
    if      (vl < 0.01) score -= 5;
    else if (vl > 10)   score += 5;
  }

  if      (holders >= 10_000) score += 8;
  else if (holders >= 1_000)  score += 4;
  else if (holders < 100)     score -= 10;

  return Math.max(5, Math.min(95, Math.round(score)));
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  const qs       = event.queryStringParameters || {};
  const tf       = TF_FIELD[qs.tf] ? qs.tf : "24h";
  const tfField  = TF_FIELD[tf];
  const minLiq   = Math.max(0, parseInt(qs.min_liq || "10000", 10) || 10000);
  const cacheKey = `topgain2:${tf}:${minLiq}`;

  /* ── Redis cache ── */
  try {
    const cached = await redisGet(cacheKey);
    if (cached) {
      return {
        statusCode: 200,
        headers: { ...CORS, "X-Cache": "HIT" },
        body: typeof cached === "string" ? cached : JSON.stringify(cached),
      };
    }
  } catch {}

  const KEY = process.env.BIRDEYE_API_KEY;
  if (!KEY) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ ok: false, error: "BIRDEYE_API_KEY not set" }) };
  }

  try {
    const params = new URLSearchParams({
      sort_by:       "v24hUSD",
      sort_type:     "desc",
      offset:        "0",
      limit:         "50",
      min_liquidity: String(minLiq),
    });

    const url = `https://public-api.birdeye.so/defi/tokenlist?${params}`;

    const res = await fetch(url, {
      headers: { "X-API-KEY": KEY, "x-chain": "solana" },
      signal: AbortSignal.timeout(9000),
    });

    if (!res.ok) {
      const txt = await res.text();
      console.error(`topGainers: Birdeye ${res.status} — ${txt.slice(0, 300)}`);
      if (txt.includes("Compute units") || txt.includes("quota")) {
        return { statusCode: 429, headers: CORS, body: JSON.stringify({ ok: false, error: "quota_exceeded" }) };
      }
      return { statusCode: 502, headers: CORS, body: JSON.stringify({ ok: false, error: `Birdeye ${res.status}: ${txt.slice(0, 200)}` }) };
    }

    const data = await res.json();
    let tokens = data?.data?.tokens || [];

    /* ── Re-sort by requested TF price change, filter out nulls ── */
    tokens = tokens
      .filter(t => t[tfField] != null)
      .sort((a, b) => (b[tfField] || 0) - (a[tfField] || 0))
      .slice(0, 50);

    const result = {
      ok:        true,
      tf,
      updatedAt: Date.now(),
      tokens:    tokens.map((t, i) => {
        const rs = quickRisk(t);
        return {
          rank:      i + 1,
          mint:      t.address,
          name:      t.name    || "Unknown",
          symbol:    t.symbol  || "",
          logo:      t.logoURI || null,
          price:     t.price   || 0,
          changes: {
            m30: t.priceChange30mPercent ?? null,
            h1:  t.priceChange1hPercent  ?? null,
            h12: t.priceChange12hPercent ?? null,
            h24: t.priceChange24hPercent ?? null,
          },
          mc:        t.mc        || t.fdv || 0,
          fdv:       t.fdv       || 0,
          liquidity: t.liquidity || 0,
          vol24h:    t.v24hUSD   || 0,
          holders:   t.holder    || 0,
          riskScore: rs,
          riskLevel: rs >= 65 ? "LOW" : rs >= 45 ? "MED" : "HIGH",
        };
      }),
    };

    try { await redisSet(cacheKey, JSON.stringify(result), 90); } catch {}

    return {
      statusCode: 200,
      headers: { ...CORS, "X-Cache": "MISS" },
      body: JSON.stringify(result),
    };
  } catch (e) {
    console.error("topGainers error:", e);
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
