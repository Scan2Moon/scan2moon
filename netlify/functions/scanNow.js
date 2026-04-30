// netlify/functions/scanNow.js
// Regular HTTP function — NOT scheduled.
// Callable from the browser / Force Scan button.
//
// Does the complete Smart Money pipeline in one shot:
//   1. Fetches recent tokens via Helius program signatures (Raydium V4 + Pump.fun)
//      — same approach as detectOnchain.js (proven working)
//   2. Enriches token metadata via Birdeye token_overview
//   3. Finds early buyers (first 60 s) via Birdeye /defi/txs/token?sort_type=asc
//   4. Stores signals in smart_money_signals
//   5. Returns a summary

const { getDb, redisSet, CORS, CORS_429, isRateLimitedRedis } = require("./db");

const BIRDEYE_KEY        = process.env.BIRDEYE_API_KEY;
const HELIUS_KEY         = process.env.HELIUS_KEY;
const BH                 = { "X-API-KEY": BIRDEYE_KEY, "x-chain": "solana" };
const HELIUS_RPC         = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;
const SOL_MINT           = "So11111111111111111111111111111111111111112";

const RAYDIUM_V4         = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";
const PUMP_FUN           = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

const BASE = new Set([
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
  "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs",
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
]);

const ENTRY_WINDOW_SECS  = 60;
const LOOKBACK_MINS      = 20;   // tokens created in last 20 min
const MAX_TOKENS         = 10;
const MIN_BUY_SOL        = 0.08;
const SM_CACHE_KEY       = "sm_feed_v1";

const SMART_MIN_ENTRIES  = 3;
const SMART_MIN_WIN_RATE = 60;

/* ── Helius helpers ─────────────────────────────────────────────────────────── */
async function heliusRpc(method, params) {
  try {
    const r = await fetch(HELIUS_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j.result ?? null;
  } catch { return null; }
}

async function getSigs(program, limit = 50) {
  return (await heliusRpc("getSignaturesForAddress", [program, { limit, commitment: "confirmed" }])) || [];
}

async function getEnhanced(sigs) {
  if (!sigs.length) return [];
  try {
    const r = await fetch(`https://api.helius.xyz/v0/transactions/?api-key=${HELIUS_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactions: sigs }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return [];
    return await r.json();
  } catch { return []; }
}

function extractMints(tx) {
  const out = new Set();
  for (const t of (tx.tokenTransfers || []))
    if (t.mint && !BASE.has(t.mint)) out.add(t.mint);
  for (const a of (tx.accountData || []))
    for (const b of (a.tokenBalanceChanges || []))
      if (b.mint && !BASE.has(b.mint)) out.add(b.mint);
  return [...out];
}

/* ── Birdeye helpers ────────────────────────────────────────────────────────── */
async function beFetch(url, ms = 12_000) {
  let r = await fetch(url, { headers: BH, signal: AbortSignal.timeout(ms) }).catch(() => null);
  if (r?.status === 429) {
    await new Promise(res => setTimeout(res, 1200));
    r = await fetch(url, { headers: BH, signal: AbortSignal.timeout(ms) }).catch(() => null);
  }
  return r;
}

// Get creation timestamp for a list of mints via Birdeye token_creation_info
async function getCreationTimes(mints) {
  const results = {};
  for (let i = 0; i < mints.length; i += 5) {
    await Promise.all(mints.slice(i, i + 5).map(async mint => {
      try {
        const r = await fetch(
          `https://public-api.birdeye.so/defi/token_creation_info?address=${mint}`,
          { headers: BH, signal: AbortSignal.timeout(5_000) }
        );
        if (!r.ok) return;
        const d = (await r.json())?.data;
        if (d?.blockUnixTime) results[mint] = d.blockUnixTime;
      } catch {}
    }));
  }
  return results;
}

// Get token overview (symbol, name, logo) from Birdeye
async function birdeyeOverview(mint) {
  try {
    const r = await beFetch(
      `https://public-api.birdeye.so/defi/token_overview?address=${encodeURIComponent(mint)}`, 6_000
    );
    if (!r?.ok) return null;
    const d = (await r.json())?.data;
    if (!d?.symbol) return null;
    return {
      symbol: d.symbol || "?",
      name:   d.name   || "Unknown",
      logo:   d.logoURI || null,
    };
  } catch { return null; }
}

/* ── Fetch recent tokens via Helius ─────────────────────────────────────────── */
async function fetchRecentTokens() {
  try {
    const cutoffSec = Math.floor(Date.now() / 1000) - LOOKBACK_MINS * 60;
    const nowSec    = Math.floor(Date.now() / 1000);

    // 1. Get recent signatures from both programs in parallel
    const [raydiumSigs, pumpSigs] = await Promise.all([
      getSigs(RAYDIUM_V4, 50),
      getSigs(PUMP_FUN, 50),
    ]);

    const toSigArr = arr => arr.filter(s => !s.err).map(s => s.signature).slice(0, 60);

    // 2. Fetch enhanced transactions in parallel
    const [raydiumTxs, pumpTxs] = await Promise.all([
      getEnhanced(toSigArr(raydiumSigs)),
      getEnhanced(toSigArr(pumpSigs)),
    ]);

    const allTxs = [...raydiumTxs, ...pumpTxs];
    console.log(`[scanNow] ${allTxs.length} enhanced txs fetched`);

    // 3. Extract unique candidate mints with their tx timestamp
    const candidates = new Map(); // mint -> txTimestamp
    for (const tx of allTxs) {
      const ts = tx.timestamp || nowSec;
      for (const mint of extractMints(tx)) {
        if (!candidates.has(mint)) candidates.set(mint, ts);
      }
    }
    console.log(`[scanNow] ${candidates.size} unique candidate mints`);
    if (!candidates.size) return [];

    // 4. Get confirmed creation times from Birdeye
    const mintList     = [...candidates.keys()].slice(0, MAX_TOKENS * 5);
    const creationTimes = await getCreationTimes(mintList);

    // 5. Filter to tokens created within the lookback window
    const freshMints = mintList.filter(mint => {
      const ct = creationTimes[mint] || candidates.get(mint);
      return ct && ct >= cutoffSec;
    }).slice(0, MAX_TOKENS);

    console.log(`[scanNow] ${freshMints.length} fresh mints within last ${LOOKBACK_MINS} min`);
    if (!freshMints.length) return [];

    // 6. Enrich with Birdeye overview in batches of 5
    const tokens = [];
    for (let i = 0; i < freshMints.length; i += 5) {
      const batch   = freshMints.slice(i, i + 5);
      const results = await Promise.all(batch.map(m => birdeyeOverview(m)));
      batch.forEach((mint, j) => {
        const info   = results[j];
        const mintTs = creationTimes[mint] || candidates.get(mint) || nowSec;
        tokens.push({
          mint,
          symbol:     info?.symbol || "?",
          name:       info?.name   || "Unknown",
          logoURI:    info?.logo   || null,
          created_at: mintTs,
        });
      });
    }

    return tokens;
  } catch (e) {
    console.warn("[scanNow] fetchRecentTokens:", e.message);
    return [];
  }
}

// Fetch earliest buy-side trades for a token mint, sorted oldest-first
async function getEarlyBuys(mint, mintedAt) {
  try {
    const enc = encodeURIComponent(mint);
    const r   = await beFetch(
      `https://public-api.birdeye.so/defi/txs/token?address=${enc}&tx_type=swap&offset=0&limit=50&sort_type=asc`
    );
    if (!r?.ok) return [];
    const j      = await r.json().catch(() => null);
    const trades = j?.data?.items ?? j?.data ?? [];
    if (!Array.isArray(trades) || !trades.length) return [];

    trades.sort((a, b) => (a.blockUnixTime ?? 0) - (b.blockUnixTime ?? 0));
    const windowEnd = mintedAt + ENTRY_WINDOW_SECS;

    return trades.filter(tx => {
      const isBuy = tx.side === "buy"
        || tx.from?.symbol   === "SOL"
        || tx.quote?.symbol  === "SOL"
        || tx.from?.address  === SOL_MINT
        || tx.quote?.address === SOL_MINT;
      const t = tx.blockUnixTime ?? 0;
      return isBuy && t >= mintedAt && t <= windowEnd;
    });
  } catch (e) {
    console.warn("getEarlyBuys:", e.message);
    return [];
  }
}

async function getPrice(mint) {
  try {
    const r = await beFetch(
      `https://public-api.birdeye.so/defi/price?address=${encodeURIComponent(mint)}`, 5_000
    );
    if (!r?.ok) return 0;
    const j = await r.json().catch(() => null);
    return parseFloat(j?.data?.value ?? 0) || 0;
  } catch { return 0; }
}

function tradeOwner(tx) {
  return tx.owner ?? tx.maker ?? tx.from?.address ?? null;
}

function tradeSolAmount(tx) {
  const fromSol  = tx.from?.address  === SOL_MINT || tx.from?.symbol  === "SOL";
  const quoteSol = tx.quote?.address === SOL_MINT || tx.quote?.symbol === "SOL";
  if (fromSol)  return parseFloat(tx.from?.uiAmount  ?? tx.from?.amount  ?? 0);
  if (quoteSol) return parseFloat(tx.quote?.uiAmount ?? tx.quote?.amount ?? 0);
  return 0;
}

function resolveWallet(wallet, knownMap, histMap) {
  const lower = wallet.toLowerCase();
  if (knownMap.has(lower)) {
    const w = knownMap.get(lower);
    if (w.category !== "tracking") {
      return { label: w.label, category: w.category, win_rate: Number(w.win_rate) || 0 };
    }
  }
  const hist = histMap.get(wallet);
  if (hist) {
    const resolved = hist.wins + hist.losses;
    const wr = resolved > 0 ? Math.round((hist.wins / resolved) * 100) : 0;
    if (hist.total >= SMART_MIN_ENTRIES && wr >= SMART_MIN_WIN_RATE) {
      return { label: `Auto Sniper · ${wr}% WR`, category: "smart", win_rate: wr };
    }
    return { label: `Tracking · ${hist.total} entries`, category: "watching", win_rate: wr };
  }
  return { label: "New Early Buyer", category: "new", win_rate: 0 };
}

/* ── Main handler ───────────────────────────────────────────────────────────── */
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  const ip = event.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() || "unknown";
  if (await isRateLimitedRedis(ip, 5, 60)) {
    return { statusCode: 429, headers: CORS_429, body: JSON.stringify({ error: "rate_limited" }) };
  }

  if (!HELIUS_KEY) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ ok: false, error: "HELIUS_KEY not set" }) };
  }

  try {
    const sql = getDb();

    // Load known wallets + historical performance
    const [knownRows, histRows] = await Promise.all([
      sql`SELECT wallet, label, category, win_rate FROM smart_wallets WHERE active = true`,
      sql`SELECT wallet, COUNT(*) AS total,
            COUNT(*) FILTER (WHERE outcome = 'win') AS wins,
            COUNT(*) FILTER (WHERE outcome = 'loss') AS losses
          FROM smart_money_signals GROUP BY wallet`,
    ]);
    const knownMap = new Map(knownRows.map(w => [w.wallet.toLowerCase(), w]));
    const histMap  = new Map(histRows.map(r => [r.wallet, {
      total: Number(r.total), wins: Number(r.wins), losses: Number(r.losses),
    }]));

    // Step 1: Fetch recent tokens via Helius + Birdeye enrichment
    const tokens = await fetchRecentTokens();
    if (!tokens.length) {
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({
          ok: true, processed: 0, inserted: 0,
          msg: `No tokens found in the last ${LOOKBACK_MINS} min. Chain may be quiet — try again in a moment.`,
        }),
      };
    }

    let processed = 0, inserted = 0;
    const tokensSeen = [];

    for (const token of tokens) {
      processed++;
      const mint     = token.mint;
      const mintedAt = token.created_at; // unix seconds
      const symbol   = token.symbol || "?";
      const name     = token.name   || token.symbol || "Unknown";
      const logo     = token.logoURI || null;

      tokensSeen.push({ mint, symbol, mintedAt });

      // Step 2: Get earliest buyers via Birdeye trades
      const earlyBuys = await getEarlyBuys(mint, mintedAt);
      if (!earlyBuys.length) continue;

      const entryPrice = await getPrice(mint);

      // Deduplicate: keep largest buy per wallet
      const buyerMap = new Map();
      for (const trade of earlyBuys) {
        const wallet = tradeOwner(trade);
        if (!wallet) continue;
        const sol = tradeSolAmount(trade);
        if (sol < MIN_BUY_SOL) continue;
        if (!buyerMap.has(wallet) || sol > tradeSolAmount(buyerMap.get(wallet))) {
          buyerMap.set(wallet, trade);
        }
      }

      // Step 3: Store signals
      for (const [wallet, trade] of buyerMap) {
        const sol      = tradeSolAmount(trade);
        const ageSecs  = Math.max(0, (trade.blockUnixTime ?? mintedAt) - mintedAt);
        const walletInfo = resolveWallet(wallet, knownMap, histMap);

        try {
          const res = await sql`
            INSERT INTO smart_money_signals
              (mint, symbol, name, logo_uri,
               wallet, wallet_label, wallet_category, wallet_win_rate,
               buy_amount_sol, token_age_secs, entry_price_usd, detected_at, sig)
            VALUES
              (${mint}, ${symbol}, ${name}, ${logo},
               ${wallet}, ${walletInfo.label}, ${walletInfo.category}, ${walletInfo.win_rate},
               ${sol}, ${ageSecs}, ${entryPrice || 0}, ${Date.now()}, ${trade.txHash || null})
            ON CONFLICT (mint, wallet) DO NOTHING
            RETURNING id
          `;
          if (res.length) inserted++;
        } catch { /* duplicate — safe */ }
      }
    }

    // Bust Redis cache so frontend picks up new signals
    await redisSet(SM_CACHE_KEY, null, 1);

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        ok: true,
        processed,
        inserted,
        tokens_found:  tokens.length,
        tokens_detail: tokensSeen,
        msg: inserted > 0
          ? `Found ${inserted} early buyer signal${inserted !== 1 ? "s" : ""} across ${processed} new tokens.`
          : `Scanned ${processed} recent token${processed !== 1 ? "s" : ""} — no qualifying early buys yet (min ${MIN_BUY_SOL} SOL). System is tracking wallets.`,
      }),
    };
  } catch (err) {
    console.error("scanNow error:", err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
