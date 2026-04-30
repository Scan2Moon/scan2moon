// netlify/functions/detectOnchain.js
// Scheduled every 1 minute — watches Pump.fun + Raydium AMM v4 on-chain via Helius.
//
// Enrichment chain (in order):
//   1. Birdeye token_overview  — full data (price, liq, mc, holders)
//   2. Helius DAS getAssetBatch — symbol/name/logo only (for tokens too new for Birdeye)
//
// Birdeye tokens: must pass MIN_LIQ gate.
// Helius DAS-only tokens: confirmed new via token_creation_info, inserted with liq=0.

const { getDb, redisGet, redisSet, redisDel, CORS } = require("./db");

const HELIUS_KEY  = process.env.HELIUS_KEY;
const BIRDEYE_KEY = process.env.BIRDEYE_API_KEY;
const BH = { "X-API-KEY": BIRDEYE_KEY, "x-chain": "solana" };
const HELIUS_RPC  = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;

const RAYDIUM_V4 = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";
const PUMP_FUN   = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

const BASE = new Set([
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
  "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs",
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
]);

const MAX_CANDS      = 15;
const MIN_LIQ        = 500;       // Birdeye-enriched tokens must have ≥ $500 liq
const MAX_CREATE_AGE = 24 * 3600; // skip tokens confirmed older than 24h

// ── Helius RPC helpers ────────────────────────────────────────────────────────
async function rpc(method, params) {
  try {
    const r = await fetch(HELIUS_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j.result ?? null;
  } catch { return null; }
}

async function getSigs(program, until, limit = 50) {
  const opts = { limit, commitment: "confirmed" };
  if (until) opts.until = until;
  return (await rpc("getSignaturesForAddress", [program, opts])) || [];
}

async function getEnhanced(sigs) {
  if (!sigs.length) return [];
  try {
    const r = await fetch(`https://api.helius.xyz/v0/transactions/?api-key=${HELIUS_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactions: sigs }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return [];
    return await r.json();
  } catch { return []; }
}

// ── Helius DAS: batch-fetch token metadata for mints Birdeye doesn't know yet ─
async function dasGetAssets(mints) {
  if (!mints.length) return {};
  try {
    const result = await rpc("getAssetBatch", { ids: mints });
    if (!Array.isArray(result)) return {};
    const out = {};
    for (const asset of result) {
      if (!asset?.id) continue;
      const symbol = asset.content?.metadata?.symbol
                  || asset.token_info?.symbol
                  || "";
      const name   = asset.content?.metadata?.name
                  || asset.token_info?.name
                  || "";
      const logo   = asset.content?.links?.image
                  || asset.content?.files?.[0]?.cdn_uri
                  || asset.content?.files?.[0]?.uri
                  || null;
      const price  = parseFloat(asset.token_info?.price_info?.price_per_token || 0);
      const supply = parseInt(asset.token_info?.supply || 0, 10);
      const decimals = parseInt(asset.token_info?.decimals || 6, 10);
      const mc     = price * (supply / Math.pow(10, decimals));

      if (!symbol) continue; // skip LP tokens / unnamed accounts
      out[asset.id] = { symbol, name: name || symbol, logo, price, liq: 0, mc, vol24h: 0, holders: 0 };
    }
    return out;
  } catch { return {}; }
}

// ── Extract mints from a parsed tx ───────────────────────────────────────────
function extractMints(tx) {
  const out = new Set();
  for (const t of (tx.tokenTransfers || []))
    if (t.mint && !BASE.has(t.mint)) out.add(t.mint);
  for (const a of (tx.accountData || []))
    for (const b of (a.tokenBalanceChanges || []))
      if (b.mint && !BASE.has(b.mint)) out.add(b.mint);
  return [...out];
}

// ── Birdeye token_creation_info ───────────────────────────────────────────────
async function getCreationTimes(mints) {
  const results = {};
  for (let i = 0; i < mints.length; i += 5) {
    await Promise.all(mints.slice(i, i + 5).map(async mint => {
      try {
        const r = await fetch(
          `https://public-api.birdeye.so/defi/token_creation_info?address=${mint}`,
          { headers: BH, signal: AbortSignal.timeout(5000) }
        );
        if (!r.ok) return;
        const d = (await r.json())?.data;
        if (d?.blockUnixTime) results[mint] = d.blockUnixTime;
      } catch {}
    }));
  }
  return results;
}

// ── Birdeye token_overview ────────────────────────────────────────────────────
async function birdeyeEnrich(mint) {
  try {
    const r = await fetch(
      `https://public-api.birdeye.so/defi/token_overview?address=${mint}`,
      { headers: BH, signal: AbortSignal.timeout(6000) }
    );
    if (!r.ok) return null;
    const d = (await r.json())?.data;
    if (!d?.symbol) return null;
    return {
      symbol:  d.symbol   || "?",
      name:    d.name     || "Unknown",
      logo:    d.logoURI  || null,
      price:   parseFloat(d.price     || 0),
      liq:     parseFloat(d.liquidity || 0),
      mc:      parseFloat(d.mc        || 0),
      vol24h:  parseFloat(d.v24hUSD   || 0),
      holders: parseInt(d.holder      || 0, 10),
      _src:    "birdeye",
    };
  } catch { return null; }
}

function calcRisk(info) {
  let s = 50;
  if (info.holders <  50)   s += 20;
  if (info.holders > 500)   s -= 10;
  if (info.liq     < 5000)  s += 15;
  if (info.liq     > 50000) s -= 10;
  if (info.mc      > 1e6)   s -=  5;
  // brand new tokens with no data are automatically HIGH risk
  if (!info.liq && !info.holders) s = 85;
  s = Math.max(10, Math.min(95, s));
  return { score: s, level: s >= 70 ? "HIGH" : s >= 40 ? "MED" : "LOW" };
}

// ── Main ──────────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  /* Block direct HTTP calls — only the Netlify scheduler (no httpMethod) or
     an authorised manual trigger (X-Cron-Secret header) may run this.
     Prevents quota drain: each run makes Helius + Birdeye API calls. */
  const CRON_SECRET = process.env.CRON_SECRET;
  if (event?.httpMethod) {
    const auth = (event?.headers?.["x-cron-secret"] || "").trim();
    if (!CRON_SECRET || auth !== CRON_SECRET) {
      return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: "Forbidden" }) };
    }
  }

  if (!HELIUS_KEY || !BIRDEYE_KEY) {
    return { statusCode: 500, headers: CORS,
             body: JSON.stringify({ ok: false, error: "Missing API keys" }) };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  let inserted = 0;

  try {
    const sql = getDb();
    const knownRows = await sql`SELECT mint FROM new_pairs WHERE detected_at > ${nowSec - 7 * 86400}`;
    const known = new Set(knownRows.map(r => r.mint));

    // ── Parallel: cursors + sigs ──────────────────────────────────────────────
    const [raydiumCur, pumpCur] = await Promise.all([
      redisGet("cur:raydium"),
      redisGet("cur:pump"),
    ]);
    const [raydiumSigs, pumpSigs] = await Promise.all([
      getSigs(RAYDIUM_V4, raydiumCur?.sig || null),
      getSigs(PUMP_FUN,   pumpCur?.sig    || null),
    ]);
    await Promise.all([
      raydiumSigs.length ? redisSet("cur:raydium", { sig: raydiumSigs[0].signature }, 300) : Promise.resolve(),
      pumpSigs.length    ? redisSet("cur:pump",    { sig: pumpSigs[0].signature    }, 300) : Promise.resolve(),
    ]);

    // ── Parallel: enhanced txs ────────────────────────────────────────────────
    const toSigs = arr => arr.filter(s => !s.err).map(s => s.signature).slice(0, 80);
    const [raydiumTxs, pumpTxs] = await Promise.all([
      getEnhanced(toSigs(raydiumSigs)),
      getEnhanced(toSigs(pumpSigs)),
    ]);

    const allTxs = [...raydiumTxs, ...pumpTxs];
    const typeCount = {};
    for (const tx of allTxs) { const t = tx.type || "UNKNOWN"; typeCount[t] = (typeCount[t] || 0) + 1; }
    console.log(`[detectOnchain] ${allTxs.length} txs — types:`, JSON.stringify(typeCount));

    // ── Candidate mints ───────────────────────────────────────────────────────
    const candidates = new Map(); // mint -> txTimestamp
    for (const tx of allTxs) {
      for (const mint of extractMints(tx)) {
        if (!known.has(mint) && !candidates.has(mint))
          candidates.set(mint, tx.timestamp || nowSec);
      }
    }
    console.log(`[detectOnchain] ${candidates.size} unknown candidates`);
    if (!candidates.size) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, inserted: 0 }) };
    }

    // ── Age gate ──────────────────────────────────────────────────────────────
    const checkList = [...candidates.keys()].slice(0, MAX_CANDS * 3);
    const creationTimes = await getCreationTimes(checkList);

    const freshMints = checkList.filter(mint => {
      const ct = creationTimes[mint];
      if (!ct) return true;                    // no data = possibly brand new
      return (nowSec - ct) < MAX_CREATE_AGE;
    }).slice(0, MAX_CANDS);

    const confirmed = freshMints.filter(m =>  creationTimes[m]).length;
    const tooFresh  = freshMints.filter(m => !creationTimes[m]).length;
    const skipped   = checkList.length - freshMints.length;
    console.log(`[detectOnchain] ${freshMints.length} to enrich — ${confirmed} confirmed, ${tooFresh} ultra-fresh, ${skipped} old`);

    // ── Birdeye enrichment (batch of 5) ───────────────────────────────────────
    const birdeyeMap = {};  // mint -> enriched data
    for (let i = 0; i < freshMints.length; i += 5) {
      const batch = freshMints.slice(i, i + 5);
      const results = await Promise.all(batch.map(m => birdeyeEnrich(m)));
      batch.forEach((m, j) => { if (results[j]) birdeyeMap[m] = results[j]; });
    }

    // ── DAS fallback for mints Birdeye doesn't know yet ───────────────────────
    const needsDas = freshMints.filter(m => !birdeyeMap[m]);
    const dasMap   = needsDas.length ? await dasGetAssets(needsDas) : {};
    console.log(`[detectOnchain] Birdeye: ${Object.keys(birdeyeMap).length}, DAS fallback: ${Object.keys(dasMap).length}`);

    // ── Insert ────────────────────────────────────────────────────────────────
    for (const mint of freshMints) {
      const bInfo = birdeyeMap[mint];
      const dInfo = dasMap[mint];

      // Birdeye result: must pass liquidity gate
      if (bInfo) {
        if (bInfo.liq < MIN_LIQ) {
          console.log(`[detectOnchain] skip ${bInfo.symbol} liq=$${bInfo.liq.toFixed(0)} (below min)`);
          continue;
        }
      } else if (dInfo) {
        // DAS result: confirmed new by creation_info, insert even with liq=0
        // (liq will be updated next time Birdeye indexes it)
      } else {
        console.log(`[detectOnchain] skip ${mint.slice(0, 8)} — no enrichment data`);
        continue;
      }

      const info    = bInfo || { ...dInfo, _src: "helius-das" };
      const blockTs = creationTimes[mint] || candidates.get(mint) || nowSec;
      const { score, level } = calcRisk(info);

      await sql`
        INSERT INTO new_pairs
          (mint, symbol, name, logo_uri, price_usd, liquidity, market_cap,
           vol_24h, holders, block_unix_time, detected_at, risk_score, risk_level, fetched_at)
        VALUES
          (${mint}, ${info.symbol}, ${info.name}, ${info.logo},
           ${info.price}, ${info.liq}, ${info.mc}, ${info.vol24h}, ${info.holders},
           ${blockTs}, ${nowSec}, ${score}, ${level}, NOW())
        ON CONFLICT (mint) DO UPDATE SET
          price_usd  = EXCLUDED.price_usd,
          liquidity  = EXCLUDED.liquidity,
          market_cap = EXCLUDED.market_cap,
          vol_24h    = EXCLUDED.vol_24h,
          holders    = EXCLUDED.holders,
          fetched_at = NOW()
      `;
      known.add(mint);
      inserted++;
      const ageMin = Math.round((nowSec - blockTs) / 60);
      console.log(`[detectOnchain] +${info.symbol} liq=$${(info.liq||0).toFixed(0)} age=${ageMin}m src=${info._src || "helius-das"}`);
    }

    await sql`DELETE FROM new_pairs WHERE detected_at < ${nowSec - 7 * 86400}`;
    if (inserted > 0) await redisDel("newpairs:v4");

    console.log(`[detectOnchain] done — ${inserted} inserted`);
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, inserted }) };

  } catch (err) {
    console.error("[detectOnchain] error:", err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
