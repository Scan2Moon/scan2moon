// netlify/functions/detectNewPairs.js
// Scheduled: every 2 minutes  (see netlify.toml)
//
// Scans Birdeye tokenlist for tokens we haven't seen before.
// For each unknown mint, calls token_creation_info to verify it's
// genuinely new (born within MAX_AGE_DETECT seconds).
// Survivors are enriched via token_overview and stored in Neon new_pairs table.
//
// 100% Birdeye — no external RPC needed.

const { getDb, redisGet, redisSet, redisDel } = require("./db");

const MAX_AGE_DETECT   = 48 * 3600;   // only keep tokens born < 48h ago
const PRUNE_AFTER      = 7  * 86400;  // delete DB rows older than 7 days
const CANDIDATES_PER_RUN = 10;        // max new mints to enrich per run (keeps within timeout)
const BATCH_SIZE       = 5;
const BATCH_DELAY_MS   = 250;

const STABLES = new Set([
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
]);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function calcRiskScore(liq, mc) {
  let s = 50;
  if      (liq >= 100000) s += 25;
  else if (liq >= 30000)  s += 15;
  else if (liq >= 8000)   s += 5;
  else                    s -= 20;
  if (mc > 0 && liq > 0) {
    const r = mc / liq;
    if      (r > 300) s -= 25;
    else if (r > 80)  s -= 15;
    else if (r > 20)  s -= 5;
    else              s +=  3;
  }
  return Math.max(5, Math.min(95, Math.round(s)));
}

async function beFetch(url, KEY) {
  const r = await fetch(url, {
    headers: { "X-API-KEY": KEY, "x-chain": "solana" },
    signal: AbortSignal.timeout(7000),
  });
  return r;
}

// ── Ensure schema exists ──────────────────────────────────────────────────────
async function ensureSchema(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS new_pairs (
      mint            TEXT PRIMARY KEY,
      symbol          TEXT NOT NULL DEFAULT '',
      name            TEXT NOT NULL DEFAULT '',
      logo_uri        TEXT,
      price_usd       NUMERIC  DEFAULT 0,
      liquidity       NUMERIC  DEFAULT 0,
      market_cap      NUMERIC  DEFAULT 0,
      vol_24h         NUMERIC  DEFAULT 0,
      holders         INTEGER  DEFAULT 0,
      block_unix_time BIGINT,
      detected_at     BIGINT   NOT NULL,
      risk_score      INTEGER  DEFAULT 50,
      risk_level      TEXT     DEFAULT 'MED',
      fetched_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS np_block_time_idx ON new_pairs (block_unix_time DESC NULLS LAST)`;
  await sql`CREATE INDEX IF NOT EXISTS np_detected_idx   ON new_pairs (detected_at DESC)`;
}

exports.handler = async function(event) {
  /* Block direct HTTP calls — only the Netlify scheduler (no httpMethod) or
     an authorised manual trigger (X-Cron-Secret header) may run this.
     Prevents quota drain: each run makes up to 30 Birdeye API calls. */
  const CRON_SECRET = process.env.CRON_SECRET;
  if (event?.httpMethod) {
    const auth = (event?.headers?.["x-cron-secret"] || "").trim();
    if (!CRON_SECRET || auth !== CRON_SECRET) {
      return { statusCode: 403, body: JSON.stringify({ error: "Forbidden" }) };
    }
  }

  const KEY = process.env.BIRDEYE_API_KEY;
  if (!KEY) { console.error("[detectNewPairs] BIRDEYE_API_KEY not set"); return; }

  const nowSec = Math.floor(Date.now() / 1000);
  let sql;
  try {
    sql = getDb();
    await ensureSchema(sql);
  } catch (e) {
    console.error("[detectNewPairs] DB init failed:", e.message);
    return;
  }

  // ── Step 1: Load known mints from DB (last 7 days) ─────────────────────────
  let knownMints = new Set();
  try {
    const rows = await sql`
      SELECT mint FROM new_pairs WHERE detected_at > ${nowSec - PRUNE_AFTER}
    `;
    rows.forEach(r => knownMints.add(r.mint));
    console.log("[detectNewPairs] known mints in DB:", knownMints.size);
  } catch (e) {
    console.warn("[detectNewPairs] DB read failed:", e.message);
  }

  // ── Step 2: Fetch candidate tokens from Birdeye (two different sorts) ───────
  const sortQueries = [
    `sort_by=v24hUSD&sort_type=desc&offset=0&limit=50&min_liquidity=1000`,
    `sort_by=liquidity&sort_type=desc&offset=0&limit=50&min_liquidity=1000`,
  ];
  const seenInFetch = new Set();
  let unknownCandidates = [];

  for (const qs of sortQueries) {
    try {
      const r = await beFetch(`https://public-api.birdeye.so/defi/tokenlist?${qs}`, KEY);
      if (!r.ok) { console.warn("[detectNewPairs] tokenlist failed:", r.status); continue; }
      const d = await r.json();
      const items = d?.data?.tokens || [];
      for (const t of items) {
        if (!t.address || seenInFetch.has(t.address)) continue;
        if (STABLES.has(t.address)) continue;
        if ((t.mc || 0) > 100_000_000) continue;       // skip large caps
        seenInFetch.add(t.address);
        if (!knownMints.has(t.address)) unknownCandidates.push(t);
      }
    } catch (e) {
      console.warn("[detectNewPairs] tokenlist error:", e.message);
    }
  }

  console.log("[detectNewPairs] unknown candidates:", unknownCandidates.length);

  // Cap to avoid timeout
  unknownCandidates = unknownCandidates.slice(0, CANDIDATES_PER_RUN);

  if (!unknownCandidates.length) {
    console.log("[detectNewPairs] nothing new this run");
    // Still prune old rows
    try { await sql`DELETE FROM new_pairs WHERE detected_at < ${nowSec - PRUNE_AFTER}`; } catch {}
    return;
  }

  // ── Step 3: Check creation time for unknown tokens ────────────────────────
  const creationMap = {};
  for (let i = 0; i < unknownCandidates.length; i += BATCH_SIZE) {
    const batch = unknownCandidates.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(async t => {
      try {
        const r = await beFetch(
          `https://public-api.birdeye.so/defi/token_creation_info?address=${encodeURIComponent(t.address)}`,
          KEY
        );
        if (!r.ok) return null;
        const j = await r.json();
        const bt = j?.data?.blockUnixTime || j?.data?.block_unix_time || null;
        return bt ? { address: t.address, bt: Number(bt) } : null;
      } catch { return null; }
    }));
    results.forEach(r => {
      if (r.status === "fulfilled" && r.value) {
        creationMap[r.value.address] = r.value.bt;
      }
    });
    if (i + BATCH_SIZE < unknownCandidates.length) await sleep(BATCH_DELAY_MS);
  }

  // Keep only tokens born within MAX_AGE_DETECT
  const newTokens = unknownCandidates.filter(t => {
    const bt = creationMap[t.address];
    if (!bt) return false;  // no creation info → skip (can't verify age)
    return (nowSec - bt) <= MAX_AGE_DETECT;
  });

  console.log("[detectNewPairs]", newTokens.length, "genuinely new tokens (< 48h old)");

  if (!newTokens.length) {
    try { await sql`DELETE FROM new_pairs WHERE detected_at < ${nowSec - PRUNE_AFTER}`; } catch {}
    return;
  }

  // ── Step 4: Enrich new tokens via token_overview ──────────────────────────
  const enriched = await Promise.allSettled(newTokens.map(async t => {
    try {
      const r = await beFetch(
        `https://public-api.birdeye.so/defi/token_overview?address=${encodeURIComponent(t.address)}`,
        KEY
      );
      if (!r.ok) return null;
      const j  = await r.json();
      const d  = j?.data;
      if (!d)  return null;
      const liq = parseFloat(d.liquidity || t.liquidity || 0);
      const mc  = parseFloat(d.mc || d.fdv || t.mc || 0);
      const rs  = calcRiskScore(liq, mc);
      return {
        mint:            t.address,
        symbol:          d.symbol      || t.symbol  || "?",
        name:            d.name        || t.name    || "Unknown",
        logo_uri:        d.logoURI     || t.logoURI || null,
        price_usd:       parseFloat(d.price || t.price || 0),
        liquidity:       liq,
        market_cap:      mc,
        vol_24h:         parseFloat(d.v24hUSD || t.v24hUSD || 0),
        holders:         parseInt(d.holder || t.holder || 0, 10),
        block_unix_time: creationMap[t.address],
        detected_at:     nowSec,
        risk_score:      rs,
        risk_level:      rs >= 65 ? "LOW" : rs >= 45 ? "MED" : "HIGH",
      };
    } catch (e) {
      console.warn("[detectNewPairs] overview failed for", t.address, e.message);
      return null;
    }
  }));

  const toInsert = enriched
    .filter(r => r.status === "fulfilled" && r.value)
    .map(r => r.value);

  console.log("[detectNewPairs] inserting", toInsert.length, "new pairs into DB");

  // ── Step 5: Upsert into Neon ──────────────────────────────────────────────
  for (const p of toInsert) {
    try {
      await sql`
        INSERT INTO new_pairs
          (mint, symbol, name, logo_uri, price_usd, liquidity, market_cap,
           vol_24h, holders, block_unix_time, detected_at, risk_score, risk_level)
        VALUES
          (${p.mint}, ${p.symbol}, ${p.name}, ${p.logo_uri}, ${p.price_usd},
           ${p.liquidity}, ${p.market_cap}, ${p.vol_24h}, ${p.holders},
           ${p.block_unix_time}, ${p.detected_at}, ${p.risk_score}, ${p.risk_level})
        ON CONFLICT (mint) DO UPDATE SET
          price_usd  = EXCLUDED.price_usd,
          liquidity  = EXCLUDED.liquidity,
          market_cap = EXCLUDED.market_cap,
          vol_24h    = EXCLUDED.vol_24h,
          holders    = EXCLUDED.holders,
          risk_score = EXCLUDED.risk_score,
          risk_level = EXCLUDED.risk_level,
          fetched_at = NOW()
      `;
    } catch (e) {
      console.warn("[detectNewPairs] upsert failed for", p.mint, e.message);
    }
  }

  // ── Step 6: Prune old rows + bust newPairs Redis cache ────────────────────
  try {
    await sql`DELETE FROM new_pairs WHERE detected_at < ${nowSec - PRUNE_AFTER}`;
    await redisDel("newpairs:v4");   // bust cache so API serves fresh DB data
    console.log("[detectNewPairs] done — cache busted");
  } catch (e) {
    console.warn("[detectNewPairs] prune/bust error:", e.message);
  }
};
