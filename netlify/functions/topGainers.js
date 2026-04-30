// netlify/functions/topGainers.js
// GET /.netlify/functions/topGainers?tf=1h&min_liq=10000
//
// Birdeye tokenlist returns camelCase fields (priceChange1hPercent, v24hUSD etc.)
// sort_by accepts: v24hUSD | mc | fdv | holder | price | liquidity  (NOT price_change_*)
// We fetch 50 tokens sorted by volume, re-sort server-side by the TF price change.
// Redis TTL: 90s per tf+liq combo.

const { redisGet, redisSet, CORS, CORS_429, isRateLimitedRedis } = require("./db");

/* ── Timeframe → Birdeye camelCase field name ── */
const TF_FIELD = {
  "30m": "priceChange30mPercent",
  "1h":  "priceChange1hPercent",
  "6h":  "priceChange6hPercent",
  "12h": "priceChange12hPercent",
  "24h": "priceChange24hPercent",
};

/* ── Stablecoins & wrapped majors to exclude ── */
const EXCLUDE_SYMBOLS = new Set([
  // USD-pegged stablecoins
  "USDC","USDT","USDG","USDH","UXD","USDR","CASH","CUSD","PAI","EURC","SUSD","USDS",
  "DAI","FRAX","BUSD","PYUSD","USDM","USDB","USD1","TUSD","GUSD","HUSD","LUSD","OUSD",
  "USDY","FDUSD","EURS","EURT","EUROC","USDE","SUSDE","MUSD","RUSD",
  // Wrapped BTC / ETH
  "WBTC","CBBTC","BTCB","TBTC","WETH","CBETH","STETH","RETH","WSTETH","WEETH","EZETH",
  // Wrapped SOL / native SOL (just tracks SOL price, not an independent gainer)
  "WSOL",
]);

/* ── Specific mint addresses to exclude ──
   Some tokens use a different symbol than expected (e.g. Birdeye lists Wrapped SOL
   as "SOL" not "WSOL"), so we exclude by mint address to be safe. ── */
const EXCLUDE_MINTS = new Set([
  "So11111111111111111111111111111111111111112", // Native / Wrapped SOL
]);

function isExcluded(tok) {
  const sym   = (tok.symbol || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const price = tok.price || 0;
  // Hard symbol exclusion
  if (EXCLUDE_SYMBOLS.has(sym)) return true;
  // Hard mint exclusion (catches symbol mismatches like Birdeye listing WSOL as "SOL")
  if (EXCLUDE_MINTS.has(tok.address)) return true;
  // Price-peg heuristic: token priced $0.95–$1.05 with >= $100K liquidity is almost certainly a stablecoin
  if (price >= 0.95 && price <= 1.05 && (tok.liquidity || 0) >= 100_000) return true;
  // Wrapped BTC heuristic: price > $30,000
  if (price > 30_000) return true;
  return false;
}

/* ── Quick risk score ──
   NOTE: this is a lightweight estimate using Birdeye tokenlist data only.
   It does NOT have holder concentration, bundle scores, or full on-chain data
   that the real Risk Scanner uses. Keep calibration conservative. ── */
function quickRisk(tok) {
  const liq     = tok.liquidity             || 0;
  const mc      = tok.mc  || tok.fdv        || 0;
  const pc24    = tok.priceChange24hPercent || 0;
  const vol24   = tok.v24hUSD               || 0;
  const holders = tok.holder                || 0;

  let score = 50;

  /* ── Liquidity (primary quality gate) ── */
  if      (liq >= 500_000) score += 30;
  else if (liq >= 100_000) score += 22;
  else if (liq >= 50_000)  score += 16;
  else if (liq >= 10_000)  score += 8;
  else if (liq >= 2_000)   score += 2;
  else                     score -= 20;

  /* ── MC / Liquidity ratio — matches scoreMcLiqRatio() from scanSignals.js ──
     Real scanner signal: ratio > 500→2, >200→8, >100→18, >50→30, >20→48,
       >10→65, >5→78, ≤5→88 (MC ≤ 5× LIQ is HEALTHY / undervalued vs pool).
     We map the same thresholds to additive deltas (treating 50 as signal=35 baseline).
     MC < LIQ is NOT a red flag — it is actually the best bucket (signal=88). ── */
  if (mc > 0 && liq > 0) {
    const r = mc / liq;
    if      (r > 1000) score -= 35;  // signal ≈ 2
    else if (r > 500)  score -= 28;  // signal ≈ 2
    else if (r > 200)  score -= 22;  // signal ≈ 8
    else if (r > 100)  score -= 15;  // signal ≈ 18
    else if (r > 50)   score -= 8;   // signal ≈ 30
    else if (r > 20)   score -= 2;   // signal ≈ 48 (near neutral)
    else if (r > 10)   score += 8;   // signal ≈ 65
    else if (r > 5)    score += 12;  // signal ≈ 78
    else               score += 15;  // signal ≈ 88 — MC ≤ LIQ is a BONUS
  }

  /* ── Crash detection — same hard overrides as computeRiskScore() ── */
  if      (pc24 <= -80) score = Math.min(score, 20);
  else if (pc24 <= -50) score = Math.min(score, 30);
  else if (pc24 <= -30) score = Math.min(score, 44);

  /* ── Large gains are NOT penalised ──
     batchRisk uses scorePumpDanger() which correctly lowers the score for
     extreme 1h pumps (pc1h > 500 → signal 5). quickRisk doesn't have pc1h
     data but that's fine — batchRisk overwrites these scores live. ── */

  /* ── Low liquidity hard cap — same as computeRiskScore() ── */
  if      (liq < 500)   score = Math.min(score, 15);
  else if (liq < 2_000) score = Math.min(score, 25);
  else if (liq < 5_000) score = Math.min(score, 35);

  /* ── Vol / MC ratio (scoreVolMcapRatio proxy) ──
     Real scanner uses vol/MC not vol/liq.
     High vol relative to MC is a dump churn signal only when price is falling.
     For rising tokens it's just high activity, not a risk.                    ── */
  if (mc > 0 && vol24 > 0) {
    const vm = vol24 / mc;
    if (vm > 20)              score -= 15;  // extreme churn
    else if (vm > 5)          score -= 5;
    else if (vm > 1)          score += 3;   // healthy activity
  }

  /* ── Holder count (weak signal without concentration data) ──
     holders === 0 typically means Birdeye has no data for this token, NOT that
     the token literally has 0 holders.  Only penalise when we have evidence
     of very low holder count (data present AND < 100). ── */
  if      (holders >= 10_000)           score += 8;
  else if (holders >= 1_000)            score += 4;
  else if (holders > 0 && holders < 100) score -= 10;  // only penalise with real data

  return Math.max(5, Math.min(95, Math.round(score)));
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  // Rate limit: 20 requests per 10 s per IP
  const ip = (event.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (await isRateLimitedRedis(ip, 20, 10)) {
    return { statusCode: 429, headers: CORS_429, body: JSON.stringify({ ok: false, error: "Too many requests — slow down." }) };
  }

  const qs       = event.queryStringParameters || {};
  const tf       = TF_FIELD[qs.tf] ? qs.tf : "24h";
  const tfField  = TF_FIELD[tf];
  const minLiq   = Math.max(0, parseInt(qs.min_liq || "1000", 10) || 1000);
  const cacheKey = `topgainers:v3:${tf}:${minLiq}`; // v3 = fixed quickRisk scoring

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
    // ── Fetch pool sorted by 24h VOLUME.
    // Volume spikes strongly correlate with big % movers — a token pumping +10,000%
    // will have massive trading activity, so it appears at the top of v24hUSD.
    // Sorting by liquidity (old approach) only returned big established coins (BONK, WIF)
    // with tiny 1-3% moves — totally missing the real gainers.
    // We use a lower min_liquidity floor (500) so fresh pumping tokens aren't excluded.
    // Risk scoring handles safety: extreme vol/liq ratio tokens still score HIGH.
    const LIQ_FLOOR = Math.max(500, minLiq);  // respect caller preference but floor at 500
    const fetchPage = async (offset) => {
      const p = new URLSearchParams({
        sort_by:       "v24hUSD",
        sort_type:     "desc",
        offset:        String(offset),
        limit:         "50",
        min_liquidity: String(LIQ_FLOOR),
      });
      const r = await fetch(`https://public-api.birdeye.so/defi/tokenlist?${p}`, {
        headers: { "X-API-KEY": KEY, "x-chain": "solana" },
        signal: AbortSignal.timeout(9000),
      });
      if (!r.ok) {
        const txt = await r.text();
        console.error(`topGainers page${offset}: Birdeye ${r.status}`);
        if (txt.includes("Compute units") || txt.includes("quota")) throw new Error("quota_exceeded");
        throw new Error(`Birdeye ${r.status}: ${txt.slice(0, 200)}`);
      }
      const d = await r.json();
      return d?.data?.tokens || [];
    };

    // Fetch three pages in parallel (150 tokens) to maximise the chance of catching
    // all the big movers across the full active token universe
    const [page0, page1, page2] = await Promise.all([fetchPage(0), fetchPage(50), fetchPage(100)]);
    // De-duplicate by address in case Birdeye returns overlaps
    const seen = new Set();
    let tokens = [...page0, ...page1, ...page2].filter(t => {
      if (!t.address || seen.has(t.address)) return false;
      seen.add(t.address);
      return true;
    });

    /* ── Remove stablecoins, wrapped majors, zero-price tokens ── */
    tokens = tokens.filter(t => !isExcluded(t) && (t.price || 0) > 0);

    /* ── Batch-enrich price change data ─────────────────────────────────────
       Birdeye tokenlist on many plans returns null for all TF price change fields.
       We fix this by calling /defi/multi_price in CHUNKS OF 30 — using the full
       150-token list as a single URL (~6,600 chars) silently fails on Birdeye's
       proxy before it even reaches the handler (URL too long).
       multi_price returns priceChange24h; we use it as fallback for all TFs.    ── */
    const mpData = {};
    const CHUNK = 30;
    const addrs = tokens.map(t => t.address);
    for (let i = 0; i < addrs.length; i += CHUNK) {
      const chunk = addrs.slice(i, i + CHUNK);
      try {
        const mpRes = await fetch(
          `https://public-api.birdeye.so/defi/multi_price?list_address=${chunk.join(",")}`,
          { headers: { "X-API-KEY": KEY, "x-chain": "solana" }, signal: AbortSignal.timeout(8000) }
        );
        if (mpRes.ok) {
          const d = (await mpRes.json())?.data || {};
          Object.assign(mpData, d);
        }
      } catch { /* non-fatal per chunk */ }
    }
    tokens = tokens.map(t => {
      const pd  = mpData[t.address];
      // Prefer the tokenlist field, fall back to multi_price 24h value
      const pc24 = t.priceChange24hPercent ?? pd?.priceChange24h ?? null;
      const pc1h = t.priceChange1hPercent  ?? null;
      return {
        ...t,
        priceChange24hPercent: pc24,
        priceChange1hPercent:  pc1h ?? pc24,   // fall back to 24h if 1h not on plan
        priceChange6hPercent:  t.priceChange6hPercent  ?? pc24,
        priceChange12hPercent: t.priceChange12hPercent ?? pc24,
        priceChange30mPercent: t.priceChange30mPercent ?? pc24,
        _pc24Fallback: pc1h === null && pc24 !== null, // flag: shorter TF used 24h data
      };
    });

    /* ── Sort by requested TF price change ──
       All TF fields are now populated (or best-effort 24h fallback).
       If still all null (very unlikely now), fall back to 24h sort. ── */
    const hasTFData  = tokens.some(t => t[tfField] != null);
    const sortField  = hasTFData ? tfField : "priceChange24hPercent";
    const displayTf  = hasTFData ? tf : "24h";   // tell frontend which TF was actually used

    tokens = tokens
      .sort((a, b) => {
        const av = a[sortField] ?? -Infinity;
        const bv = b[sortField] ?? -Infinity;
        return bv - av;
      })
      .slice(0, 50);   // keep top 50 gainers (sorted by % move)

    /* ── Compute risk scores & build result list ─────────────────────────
       We do NOT filter by risk score threshold.  On Solana, even genuine gainers
       have extreme vol/liq ratios that drop their score.  Filtering by score
       would remove all real tokens from the list.

       Instead we:
         1. Show every token that passed the liq/exclusion checks above
         2. Compute an honest risk score for each token (displayed to users)
         3. Sort by the selected TF price change so biggest movers appear first
         4. Cap at top 20 to keep the list concise

       The risk label (HIGH / MED / LOW) tells users what to watch out for.  ── */
    const scoredTokens = tokens
      .map(t => ({ tok: t, rs: quickRisk(t) }));

    const result = {
      ok:          true,
      tf,
      displayTf,   // actual TF used for sorting (may differ if plan lacks shorter TF data)
      updatedAt:   Date.now(),
      tokens:      scoredTokens.map(({ tok: t, rs }, i) => ({
        rank:      i + 1,
        mint:      t.address,
        name:      t.name    || "Unknown",
        symbol:    t.symbol  || "",
        logo:      t.logoURI || null,
        price:     t.price   || 0,
        changes: {
          m30: t.priceChange30mPercent ?? null,
          h1:  t.priceChange1hPercent  ?? null,
          h6:  t.priceChange6hPercent  ?? null,
          h12: t.priceChange12hPercent ?? null,
          h24: t.priceChange24hPercent ?? null,
        },
        tfFallback: t._pc24Fallback || false, // true = 1h/12h/30m used 24h data
        mc:        t.mc        || t.fdv || 0,
        fdv:       t.fdv       || 0,
        liquidity: t.liquidity || 0,
        vol24h:    t.v24hUSD   || 0,
        holders:   t.holder    || 0,
        riskScore: rs,
        riskLevel: rs >= 80 ? "MOON" : rs >= 65 ? "LOW" : rs >= 45 ? "MED" : "HIGH",
      })),
    };

    try { await redisSet(cacheKey, JSON.stringify(result), 60); } catch {}

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
