// netlify/functions/scanToken.js
// GET /.netlify/functions/scanToken?mint=<mint>
//
// Fetches Birdeye token_overview + creation info + pool markets in parallel.
// Returns a DexScreener-compatible pair object so frontend code changes are minimal.
// Cache: Redis 30s → serve instantly on all subsequent module calls.

const { getDb, redisGet, redisSet, CORS } = require("./db");

const REDIS_TTL = 90; // seconds — 90s keeps Birdeye rate limits comfortable

// Process-level flag — skip ALTER TABLE after first successful run (saves ~200ms)
let _schemaReady = false;

// ── Birdeye fetch with 429 retry ──────────────────────────────────────────
// Note: 429 = rate limited (retryable after backoff)
//       400 "Compute units usage limit exceeded" = quota exhausted (NOT retryable — daily/monthly cap)
async function birdeyeFetch(url, headers, retries = 2) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (res.status === 429 && retries > 0) {
    const wait = retries === 2 ? 1000 : 2000; // 1s first retry, 2s second
    console.log(`[scanToken] 429 rate-limit — retrying in ${wait}ms (${retries} left)`);
    await new Promise(r => setTimeout(r, wait));
    return birdeyeFetch(url, headers, retries - 1);
  }
  // 400 with compute-units message: mark so caller knows to use stale fallback immediately
  if (res.status === 400) {
    const txt = await res.text();
    if (txt.includes("Compute units")) {
      const err = new Error(`QUOTA_EXCEEDED: ${txt.slice(0, 200)}`);
      err.quotaExceeded = true;
      throw err;
    }
    // other 400: re-pack so caller handles it
    const e2 = new Error(`Birdeye 400: ${txt.slice(0, 200)}`);
    e2.status = 400;
    throw e2;
  }
  return res;
}

// ── Birdeye fetch: 2-phase to avoid rate-limit burst ─────────────────────
// Phase 1 (parallel): overview (required) + Binance SOL price (different server)
// Phase 2 (parallel): creation_info + markets — ONLY if knownCreatedAt is null.
//   knownCreatedAt is passed in from Neon cache so repeat calls skip phase 2
//   entirely (saves 2 Birdeye calls per refresh after the first scan).
async function fetchBirdeyeData(mint, knownCreatedAt = null, skipPhase2 = false) {
  const KEY = process.env.BIRDEYE_API_KEY;
  if (!KEY) throw new Error("BIRDEYE_API_KEY not set");

  const headers = { "X-API-KEY": KEY, "x-chain": "solana" };
  const enc     = encodeURIComponent(mint);

  // ── Phase 1: required data ───────────────────────────────────────────────
  const [overviewRes, solPriceRes] = await Promise.all([
    birdeyeFetch(`https://public-api.birdeye.so/defi/token_overview?address=${enc}`, headers),
    // Binance — different server, no rate-limit concern
    fetch(`https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT`, {
      signal: AbortSignal.timeout(5000),
    }),
  ]);

  // ── overview is mandatory — fail fast before optional calls ─────────────
  if (!overviewRes.ok) {
    const txt = await overviewRes.text();
    throw new Error(`Birdeye overview ${overviewRes.status}: ${txt.slice(0, 200)}`);
  }

  const overview = await overviewRes.json();
  const solJson  = solPriceRes.ok ? await solPriceRes.json() : null;
  const solPrice = parseFloat(solJson?.price ?? 0);

  const d = overview?.data;
  if (!d) throw new Error("Birdeye returned no data for this mint");

  console.log("[scanToken] Birdeye OK — solPrice:", solPrice.toFixed(2));

  // ── Phase 2: optional enrichment ──────────────────────────────────────
  // Skip entirely if we already know the creation date from Neon cache.
  // pairCreatedAt never changes after the pool is created, so caching it
  // permanently in Neon means we save 2 Birdeye calls on every subsequent scan.
  let pairCreatedAt = knownCreatedAt ?? null;
  let _dexSource    = null;

  if (!skipPhase2 && !pairCreatedAt) {
    // Both are optional — if they fail, pairCreatedAt stays null → score 35 (neutral).
    // NEVER use lastTradeUnixTime — that is the MOST RECENT trade, not creation date.
    // ── Phase 2 Birdeye calls (creation date) ──────────────────────────────
    const [creationRes, marketsRes] = await Promise.all([
      birdeyeFetch(`https://public-api.birdeye.so/defi/token_creation_info?address=${enc}`, headers, 1).catch(() => null),
      birdeyeFetch(`https://public-api.birdeye.so/defi/v2/markets?address=${enc}&sort_by=liquidity&sort_type=desc&offset=0&limit=1`, headers, 1).catch(() => null),
    ]);

    // Priority 1: markets → pool createTime (most accurate)
    try {
      if (marketsRes?.ok) {
        const mj = await marketsRes.json();
        const market = mj?.data?.items?.[0] ?? mj?.data?.[0] ?? null;
        const ct = market?.createTime ?? market?.createdAt ?? market?.created_at ?? null;
        if (ct) {
          pairCreatedAt = (typeof ct === "number")
            ? (ct < 1e12 ? ct * 1000 : ct)
            : new Date(ct).getTime();
          console.log("[scanToken] pairCreatedAt from pool:", new Date(pairCreatedAt).toISOString());
        }
        _dexSource = market?.source ?? market?.dex ?? market?.exchange ?? null;
      }
    } catch (e) { console.warn("[scanToken] markets parse:", e.message); }

    // Priority 2: token_creation_info → blockUnixTime (on-chain mint birth)
    if (!pairCreatedAt) {
      try {
        if (creationRes?.ok) {
          const cj = await creationRes.json();
          const blockTime = cj?.data?.blockUnixTime ?? cj?.data?.block_unix_time ?? null;
          if (blockTime) {
            pairCreatedAt = blockTime < 1e12 ? blockTime * 1000 : blockTime;
            console.log("[scanToken] pairCreatedAt from creation info:", new Date(pairCreatedAt).toISOString());
          }
        }
      } catch (e) { console.warn("[scanToken] creation parse:", e.message); }
    }

    if (!pairCreatedAt) {
      console.log("[scanToken] pairCreatedAt unavailable — scoreTokenAge → 35 (neutral)");
    }
  } else if (skipPhase2) {
    if (pairCreatedAt) console.log("[scanToken] phase 2 skipped — createdAt from cache");
    else console.log("[scanToken] phase 2 skipped (lite mode) — scoreTokenAge → 35 (neutral)");
  }

  // ── Pump.fun detection ──────────────────────────────────────────────────
  const isPumpFun    = String(mint).toLowerCase().endsWith("pump");
  const hasGraduated = (d.liquidity ?? 0) > 500;

  // ── Build DexScreener-compatible pair object ────────────────────────────
  const priceUsd = d.price ?? 0;
  const pair = {
    // Price
    priceUsd:    String(priceUsd),
    priceNative: solPrice > 0 ? String(priceUsd / solPrice) : "0",

    // Price changes — confirmed Birdeye field names from token_overview
    // Note: Birdeye has no 6h field — using 8h as closest substitute
    priceChange: {
      m5:  d.priceChange5mPercent  ?? null,
      h1:  d.priceChange1hPercent  ?? null,
      h6:  d.priceChange8hPercent  ?? d.priceChange4hPercent ?? null,  // 8h closest to 6h
      h24: d.priceChange24hPercent ?? null,
    },

    // Liquidity
    liquidity: { usd: d.liquidity ?? 0 },

    // Market cap / FDV
    marketCap: d.mc  ?? d.fdv ?? 0,
    fdv:       d.fdv ?? d.mc  ?? 0,

    // Volume — confirmed Birdeye field names
    volume: {
      h1:  d.v1hUSD  ?? 0,
      h24: d.v24hUSD ?? 0,
    },

    // Transactions — confirmed Birdeye field names
    txns: {
      h1: {
        buys:  d.buy1h  ?? 0,
        sells: d.sell1h ?? 0,
      },
      h24: {
        buys:  d.buy24h  ?? 0,
        sells: d.sell24h ?? 0,
      },
    },

    // Real pair/pool creation date (resolved above — NOT lastTradeUnixTime)
    pairCreatedAt,

    // Metadata
    baseToken: {
      symbol: d.symbol ?? "UNKNOWN",
      name:   d.name   ?? "Unknown Token",
    },
    info: { imageUrl: d.logoURI ?? null },
    dexId: "birdeye",
    _dexSource,   // real DEX name from markets API (raydium, orca, meteora, etc.)

    // Holder data (bonus — not in DexScreener but useful)
    holders:          d.holder         ?? 0,
    uniqueWallets24h: d.uniqueWallet24h ?? 0,
  };

  // ── Token metadata (for mainAnalysis) ──────────────────────────────────
  const meta = {
    name:      d.name    ?? "Unknown Token",
    symbol:    d.symbol  ?? "UNKNOWN",
    logo:      d.logoURI ?? null,
    marketCap: d.mc ?? d.fdv ?? 0,
  };

  return { pair, meta, isPumpFun, hasGraduated, solPrice, mint };
}

// ── Main handler ──────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  const { mint, lite } = event.queryStringParameters || {};
  if (!mint) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "mint required" }) };
  }

  // lite=1  →  watchlist/live-refresh mode:
  //   • Only 1 Birdeye call (overview) — no phase 2 (creation_info + markets)
  //   • Still checks Neon for pair_created_at so score stays accurate for known tokens
  //   • Uses same 90s TTL as full scan — liveRefreshTick runs every 30s so 2 out of
  //     3 ticks are pure cache hits (no Birdeye calls at all)
  //   • Full scan (?lite=0 or absent) always fires phase 2 and uses 90s TTL
  const isLite    = lite === "1";
  const cacheKey  = isLite ? `scan:lite:${mint}` : `scan:${mint}`;
  const cacheTTL  = REDIS_TTL; // 90s for both lite and full — reduces Birdeye calls 3×

  // L1: Redis — for lite requests also accept a cached full-scan result (richer data)
  try {
    if (isLite) {
      const full = await redisGet(`scan:${mint}`);
      if (full) return { statusCode: 200, headers: { ...CORS, "X-Cache": "HIT-FULL" }, body: JSON.stringify({ ok: true, ...full }) };
    }
    const cached = await redisGet(cacheKey);
    if (cached) {
      return { statusCode: 200, headers: { ...CORS, "X-Cache": "HIT" }, body: JSON.stringify({ ok: true, ...cached }) };
    }
  } catch {}

  // L2: Neon — fetch full cached row for two purposes:
  //   a) pair_created_at lets us skip Birdeye phase 2 (saves 2 API calls)
  //   b) full row is our emergency fallback if Birdeye quota is exhausted
  let cachedCreatedAt = null;
  let neonRow         = null;
  let sql;
  try {
    sql = getDb();
    if (!_schemaReady) {
      await sql`ALTER TABLE token_cache ADD COLUMN IF NOT EXISTS pair_created_at BIGINT`;
      _schemaReady = true;
    }
    const rows = await sql`
      SELECT mint, symbol, name, logo_uri, price_usd, volume_24h, market_cap, pair_created_at
      FROM   token_cache
      WHERE  mint = ${mint}
      LIMIT  1
    `;
    if (rows.length) {
      neonRow = rows[0];
      if (neonRow.pair_created_at) {
        cachedCreatedAt = Number(neonRow.pair_created_at);
        console.log("[scanToken] pair_created_at from Neon:", new Date(cachedCreatedAt).toISOString());
      }
    }
  } catch (e) { console.warn("[scanToken] Neon lookup:", e.message); }

  // ── Helper: build minimal pair from stale Neon row so the UI shows something
  //    when Birdeye quota is exhausted. Cached in Redis for 30s so next tick retries Birdeye.
  function staleResponseFromNeon(row) {
    const stalePair = {
      priceUsd:    String(row.price_usd  ?? 0),
      priceNative: "0",
      priceChange: { m5: null, h1: null, h6: null, h24: null },
      liquidity:   { usd: 0 },
      marketCap:   row.market_cap  ?? 0,
      fdv:         row.market_cap  ?? 0,
      volume:      { h1: 0, h24: row.volume_24h ?? 0 },
      txns:        { h1: { buys: 0, sells: 0 }, h24: { buys: 0, sells: 0 } },
      pairCreatedAt: row.pair_created_at ?? null,
      baseToken:   { symbol: row.symbol ?? "UNKNOWN", name: row.name ?? "Unknown Token" },
      info:        { imageUrl: row.logo_uri ?? null },
      dexId:       "birdeye",
      holders:     0,
      uniqueWallets24h: 0,
    };
    const staleMeta = {
      name:      row.name      ?? "Unknown Token",
      symbol:    row.symbol    ?? "UNKNOWN",
      logo:      row.logo_uri  ?? null,
      marketCap: row.market_cap ?? 0,
    };
    return {
      pair:         stalePair,
      meta:         staleMeta,
      isPumpFun:    String(mint).toLowerCase().endsWith("pump"),
      hasGraduated: false,
      solPrice:     0,
      mint,
      stale:        true,
    };
  }

  // L3: Birdeye
  //   lite mode  → always skip phase 2 (use Neon value if available, else null/35)
  //   full mode  → skip phase 2 only if Neon already has the date (saves 2 calls)
  const skipPhase2 = isLite || !!cachedCreatedAt;
  let result;
  try {
    result = await fetchBirdeyeData(mint, cachedCreatedAt, skipPhase2);
  } catch (e) {
    console.error("[scanToken] Birdeye error:", e.message);

    // ── Quota exhausted / hard failure → serve stale Neon data rather than blank 502 ──
    if (neonRow) {
      console.log(`[scanToken] Birdeye down — serving stale Neon data for ${mint.slice(0, 8)}…`);
      const staleResult = staleResponseFromNeon(neonRow);
      // Cache with short TTL (30s) so next cycle retries Birdeye quickly
      try { await redisSet(cacheKey, staleResult, 30); } catch {}
      return {
        statusCode: 200,
        headers: { ...CORS, "X-Cache": "STALE-NEON" },
        body: JSON.stringify({ ok: true, ...staleResult }),
      };
    }

    // No Neon data either — true hard failure
    const isQuotaErr = e.quotaExceeded || e.message?.includes("QUOTA_EXCEEDED");
    return {
      statusCode: isQuotaErr ? 503 : 502,
      headers: CORS,
      body: JSON.stringify({
        ok: false,
        error: isQuotaErr ? "Birdeye compute quota exceeded — upgrade plan or wait for reset" : "Token data unavailable",
        detail: e.message,
      }),
    };
  }

  // Cache result in Redis
  try { await redisSet(cacheKey, result, cacheTTL); } catch {}

  // Persist to Neon (only update pair_created_at when we have a real value — never overwrite with null)
  if (!isLite || result.pair?.pairCreatedAt) {
    try {
      if (!sql) sql = getDb();
      const { meta, pair } = result;
      const createdAtVal = pair.pairCreatedAt ?? null;
      await sql`
        INSERT INTO token_cache (mint, symbol, name, logo_uri, price_usd, volume_24h, market_cap, pair_created_at, fetched_at)
        VALUES (${mint}, ${meta.symbol}, ${meta.name}, ${meta.logo},
                ${parseFloat(pair.priceUsd)}, ${pair.volume.h24}, ${pair.marketCap},
                ${createdAtVal}, NOW())
        ON CONFLICT (mint) DO UPDATE
          SET symbol=EXCLUDED.symbol, name=EXCLUDED.name, logo_uri=EXCLUDED.logo_uri,
              price_usd=EXCLUDED.price_usd, volume_24h=EXCLUDED.volume_24h,
              market_cap=EXCLUDED.market_cap, fetched_at=NOW(),
              pair_created_at = COALESCE(token_cache.pair_created_at, EXCLUDED.pair_created_at)
      `;
    } catch (e) { console.warn("[scanToken] Neon upsert:", e.message); }
  }

  return {
    statusCode: 200,
    headers: { ...CORS, "X-Cache": "MISS" },
    body: JSON.stringify({ ok: true, ...result }),
  };
};
