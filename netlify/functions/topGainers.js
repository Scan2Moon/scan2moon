// netlify/functions/topGainers.js
// GET /.netlify/functions/topGainers?tf=1h&min_liq=10000
//
// Returns Solana top gainers from Birdeye tokenlist sorted by price change.
// NOTE: Birdeye tokenlist only accepts "price_change_24h_percent" as a valid
// sort_by value. We always fetch 100 tokens sorted by 24h, then re-sort
// server-side by the requested timeframe field (30m / 1h / 12h / 24h).
// Redis TTL: 90s per tf+liq combo.

const { redisGet, redisSet, CORS } = require("./db");

/* ── Timeframe → response field name ── */
const TF_FIELD = {
  "30m": "price_change_30m_percent",
  "1h":  "price_change_1h_percent",
  "12h": "price_change_12h_percent",
  "24h": "price_change_24h_percent",
};

/* ── The only sort_by value Birdeye tokenlist accepts for price change ── */
const BIRDEYE_SORT = "price_change_24h_percent";

/* ── Quick risk score from Birdeye tokenlist fields ─────────────────
   Approximates the full computeRiskScore() without needing an RPC call.
   ------------------------------------------------------------------- */
function quickRisk(tok) {
  const liq     = tok.liquidity                  || 0;
  const mc      = tok.mc || tok.fdv              || 0;
  const pc24    = tok.price_change_24h_percent   || 0;
  const vol24   = tok.volume_24h_usd             || 0;
  const holders = tok.holder                     || 0;

  let score = 50;

  /* ── Liquidity (+30 max) ── */
  if      (liq >= 500_000) score += 30;
  else if (liq >= 100_000) score += 22;
  else if (liq >= 50_000)  score += 16;
  else if (liq >= 10_000)  score += 8;
  else if (liq >= 2_000)   score += 2;
  else                     score -= 20;

  /* ── MC / liquidity ratio (rug proxy) ── */
  if (mc > 0 && liq > 0) {
    const ratio = mc / liq;
    if      (ratio > 1000) score -= 30;
    else if (ratio > 500)  score -= 20;
    else if (ratio > 200)  score -= 10;
    else if (ratio > 50)   score -= 2;
    else                   score += 5;
  }

  /* ── Severe 24h dump penalty ── */
  if      (pc24 <= -80) score = Math.min(score, 20);
  else if (pc24 <= -50) score = Math.min(score, 30);
  else if (pc24 <= -30) score = Math.min(score, 44);

  /* ── Liquidity floor caps ── */
  if      (liq < 500)   score = Math.min(score, 15);
  else if (liq < 2_000) score = Math.min(score, 25);
  else if (liq < 5_000) score = Math.min(score, 35);

  /* ── Volume / liquidity health ── */
  if (liq > 0 && vol24 > 0) {
    const vl = vol24 / liq;
    if      (vl < 0.01) score -= 5;
    else if (vl > 10)   score += 5;
  }

  /* ── Holder count signal ── */
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
  const tf       = TF_FIELD[qs.tf] ? qs.tf : "1h";
  const tfField  = TF_FIELD[tf];
  const minLiq   = Math.max(0, parseInt(qs.min_liq || "10000", 10) || 10000);
  const cacheKey = `topgain:${tf}:${minLiq}`;

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
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ ok: false, error: "BIRDEYE_API_KEY not set" }),
    };
  }

  try {
    /* Always sort by 24h change — only valid price-change sort in Birdeye tokenlist.
       Fetch 100 so we have enough after re-sorting by the requested TF field. */
    const params = new URLSearchParams({
      sort_by:       BIRDEYE_SORT,
      sort_type:     "desc",
      offset:        "0",
      limit:         "100",
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
      return {
        statusCode: 502,
        headers: CORS,
        body: JSON.stringify({ ok: false, error: `Birdeye ${res.status}: ${txt.slice(0, 200)}` }),
      };
    }

    const data   = await res.json();
    let tokens   = data?.data?.tokens || [];

    /* ── Re-sort by the requested timeframe field ── */
    if (tf !== "24h") {
      tokens = tokens
        .filter(t => t[tfField] != null)
        .sort((a, b) => (b[tfField] || 0) - (a[tfField] || 0));
    }

    /* ── Keep top 50 after re-sort ── */
    tokens = tokens.slice(0, 50);

    /* ── Build result ── */
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
            m30: t.price_change_30m_percent ?? null,
            h1:  t.price_change_1h_percent  ?? null,
            h12: t.price_change_12h_percent ?? null,
            h24: t.price_change_24h_percent ?? null,
          },
          mc:        t.mc        || t.fdv || 0,
          fdv:       t.fdv       || 0,
          liquidity: t.liquidity || 0,
          vol24h:    t.volume_24h_usd || 0,
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
