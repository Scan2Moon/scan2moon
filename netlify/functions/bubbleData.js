// netlify/functions/bubbleData.js
// GET /.netlify/functions/bubbleData?tf=4h|8h|24h|7d|30d
//
// Returns top Solana tokens with price change data for bubble map rendering.
// 100% Birdeye — required for Build-in-Public competition.
//
// TF data sources:
//   4h  → priceChange4hPercent from tokenlist (falls back to 1h if null)
//   8h  → priceChange8hPercent (falls back to 12h → 24h)
//   24h → priceChange24hPercent ✓ always available
//   7d  → computed from Birdeye OHLCV daily candles  (our own computed data!)
//   30d → computed from Birdeye OHLCV daily candles  (our own computed data!)
//
// 7D/30D data is valuable proprietary computation — we build it, we can rent it.
// Cache: 60s (short TF), 300s (7D/30D) at list level; 6h per-mint for OHLCV.

const { redisGet, redisSet, CORS, CORS_429, isRateLimitedRedis } = require("./db");

const CACHE_TTL_SHORT  = 60;     // 1 min for 4h/8h/24h
const CACHE_TTL_LONG   = 300;    // 5 min for 7d/30d
const OHLCV_MINT_TTL   = 21600;  // 6 hours — daily data barely changes
const OHLCV_CONCUR     = 10;     // parallel Birdeye calls per batch

// ── Exclusion helpers (same as topGainers.js) ────────────────────────────────
const EXCL_SYMBOLS = new Set([
  "USDC","USDT","USDG","USDH","UXD","USDR","DAI","FRAX","BUSD","PYUSD","USDM","USDB",
  "USD1","TUSD","GUSD","HUSD","LUSD","USDY","FDUSD","EURS","EURT","EURC","USDE","SUSDE",
  "USDS","SUSD","RUSD","MUSD","WBTC","CBBTC","BTCB","TBTC","WETH","CBETH","STETH",
  "RETH","WSTETH","WEETH","EZETH","WSOL",
]);
const EXCL_MINTS = new Set(["So11111111111111111111111111111111111111112"]);

function isExcluded(tok) {
  const sym = (tok.symbol || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (EXCL_SYMBOLS.has(sym)) return true;
  if (EXCL_MINTS.has(tok.address)) return true;
  const p = tok.price || 0;
  if (p >= 0.95 && p <= 1.05 && (tok.liquidity || 0) >= 100_000) return true;
  if (p > 30_000) return true;
  return false;
}

// ── Fetch tokenlist (3 pages = up to 150 raw tokens) ─────────────────────────
async function fetchTokenList(KEY) {
  const pages = await Promise.all([0, 50, 100].map(async offset => {
    try {
      const p = new URLSearchParams({
        sort_by: "v24hUSD", sort_type: "desc",
        offset: String(offset), limit: "50",
        min_liquidity: "5000",
      });
      const r = await fetch(`https://public-api.birdeye.so/defi/tokenlist?${p}`, {
        headers: { "X-API-KEY": KEY, "x-chain": "solana" },
        signal: AbortSignal.timeout(9000),
      });
      if (!r.ok) return [];
      const d = await r.json();
      return d?.data?.tokens || [];
    } catch { return []; }
  }));

  const seen = new Set();
  return pages.flat().filter(t => {
    if (!t.address || seen.has(t.address)) return false;
    seen.add(t.address);
    return !isExcluded(t) && (t.price || 0) > 0;
  });
}

// ── Compute price change from OHLCV daily candles ────────────────────────────
// Returns % change from `days` days ago to latest close.
// Cached per mint for OHLCV_MINT_TTL to avoid hammering Birdeye.
async function fetchOhlcvChange(mint, KEY, days) {
  const cacheKey = `bbl:ohlcv:${days}d:${mint}`;
  try {
    const cached = await redisGet(cacheKey);
    if (cached !== null) {
      const v = parseFloat(cached);
      return isNaN(v) ? null : v;
    }
  } catch {}

  try {
    const timeTo   = Math.floor(Date.now() / 1000);
    const timeFrom = timeTo - 86400 * (days + 5); // buffer
    const url = `https://public-api.birdeye.so/defi/ohlcv?address=${encodeURIComponent(mint)}&type=1D&time_from=${timeFrom}&time_to=${timeTo}`;
    const r = await fetch(url, {
      headers: { "X-API-KEY": KEY, "x-chain": "solana" },
      signal: AbortSignal.timeout(7000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const items = j?.data?.items;
    if (!Array.isArray(items) || items.length < 2) return null;

    // Sort oldest → newest, pick candle N days back
    items.sort((a, b) => (a.unixTime ?? a.time ?? 0) - (b.unixTime ?? b.time ?? 0));
    const latest = items[items.length - 1];
    const idx    = Math.max(0, items.length - 1 - days);
    const anchor = items[idx];

    const currentPrice = latest.c ?? latest.close ?? 0;
    const oldPrice     = anchor.o  ?? anchor.open  ?? anchor.c ?? anchor.close ?? 0;
    if (!oldPrice || !currentPrice) return null;

    const change = ((currentPrice - oldPrice) / oldPrice) * 100;
    const rounded = Math.round(change * 100) / 100;
    try { await redisSet(cacheKey, String(rounded), OHLCV_MINT_TTL); } catch {}
    return rounded;
  } catch {
    return null;
  }
}

// ── Run async tasks with concurrency limit ────────────────────────────────────
async function runConcurrent(tasks, limit) {
  const results = new Array(tasks.length).fill(null);
  for (let i = 0; i < tasks.length; i += limit) {
    const batch   = tasks.slice(i, i + limit);
    const partial = await Promise.all(batch.map(fn => fn()));
    partial.forEach((v, j) => { results[i + j] = v; });
  }
  return results;
}

// ── Handler ───────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  const ip = (event.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (await isRateLimitedRedis(ip, 20, 10, "bub")) {
    return { statusCode: 429, headers: CORS_429, body: JSON.stringify({ error: "Too many requests." }) };
  }

  const qs = event.queryStringParameters || {};
  const tf = (qs.tf || "24h").toLowerCase();
  if (!["4h","8h","24h","7d","30d"].includes(tf)) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ ok: false, error: "Invalid tf. Use: 4h|8h|24h|7d|30d" }) };
  }

  const cacheKey = `bubblemap:v3:${tf}`;
  const cacheTtl = (tf === "7d" || tf === "30d") ? CACHE_TTL_LONG : CACHE_TTL_SHORT;

  // Redis cache
  try {
    const cached = await redisGet(cacheKey);
    if (cached) return { statusCode: 200, headers: { ...CORS, "X-Cache": "HIT" }, body: typeof cached === "string" ? cached : JSON.stringify(cached) };
  } catch {}

  const KEY = process.env.BIRDEYE_API_KEY;
  if (!KEY) return { statusCode: 500, headers: CORS, body: JSON.stringify({ ok: false, error: "BIRDEYE_API_KEY not set" }) };

  try {
    const tokens = await fetchTokenList(KEY);

    let bubbles;

    if (tf === "7d" || tf === "30d") {
      /* ── Our own computed data: OHLCV → multi-day % change ── */
      const days  = tf === "7d" ? 7 : 30;
      const top40 = tokens.slice(0, 40);
      const tasks = top40.map(tok => () => fetchOhlcvChange(tok.address, KEY, days));
      const changes = await runConcurrent(tasks, OHLCV_CONCUR);

      bubbles = top40
        .map((tok, i) => ({ tok, change: changes[i] }))
        .filter(({ change }) => change !== null)
        .map(({ tok, change }) => ({
          mint:   tok.address,
          symbol: tok.symbol  || "?",
          name:   tok.name    || "Unknown",
          logo:   tok.logoURI || null,
          price:  tok.price   || 0,
          change,
          mc:     tok.mc      || tok.fdv || 0,
          liq:    tok.liquidity || 0,
          vol24h: tok.v24hUSD  || 0,
        }));

    } else {
      /* ── Tokenlist fields — pick best available field per TF ──
         Birdeye tokenlist often returns null for priceChange* on free plans.
         Fix: enrich with /defi/multi_price in chunks of 30 (same as topGainers.js).
         multi_price reliably returns priceChange24h as a universal fallback.     ── */
      const mpData = {};
      const CHUNK  = 30;
      const addrs  = tokens.map(t => t.address);
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

      // Merge multi_price fallback into each token
      const enriched = tokens.map(t => {
        const pd = mpData[t.address];
        const pc24Fallback = pd?.priceChange24h ?? null;
        return {
          ...t,
          priceChange24hPercent:  t.priceChange24hPercent  ?? pc24Fallback,
          priceChange12hPercent:  t.priceChange12hPercent  ?? pc24Fallback,
          priceChange8hPercent:   t.priceChange8hPercent   ?? pc24Fallback,
          priceChange4hPercent:   t.priceChange4hPercent   ?? pc24Fallback,
          priceChange1hPercent:   t.priceChange1hPercent   ?? pc24Fallback,
        };
      });

      const FIELDS = {
        "4h":  ["priceChange4hPercent",  "priceChange1hPercent",  "priceChange24hPercent"],
        "8h":  ["priceChange8hPercent",  "priceChange12hPercent", "priceChange24hPercent"],
        "24h": ["priceChange24hPercent"],
      }[tf];

      bubbles = enriched
        .map(tok => {
          let change = null;
          for (const f of FIELDS) {
            if (tok[f] != null) { change = Math.round(tok[f] * 100) / 100; break; }
          }
          return {
            mint:   tok.address,
            symbol: tok.symbol  || "?",
            name:   tok.name    || "Unknown",
            logo:   tok.logoURI || null,
            price:  tok.price   || 0,
            change,
            mc:     tok.mc      || tok.fdv || 0,
            liq:    tok.liquidity || 0,
            vol24h: tok.v24hUSD  || 0,
          };
        })
        .filter(t => t.change !== null);
    }

    // Sort: most volatile first (biggest movers — up or down)
    bubbles.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

    const gainers = bubbles.filter(t => t.change >= 0).length;
    const losers  = bubbles.length - gainers;

    const result = JSON.stringify({
      ok: true, tf,
      tokens: bubbles,
      stats: { total: bubbles.length, gainers, losers },
      updatedAt: Date.now(),
    });

    try { await redisSet(cacheKey, result, cacheTtl); } catch {}
    return { statusCode: 200, headers: { ...CORS, "X-Cache": "MISS" }, body: result };

  } catch (e) {
    console.error("[bubbleData] error:", e);
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
