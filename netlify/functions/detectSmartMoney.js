// netlify/functions/detectSmartMoney.js  (V2 — Birdeye-native auto-discovery)
// Scheduled every 2 min via netlify.toml.
//
// Strategy (mirrors bundle.js — proven approach):
//   1. Fetch new tokens from new_pairs (last 12 min)
//   2. For each token: GET /defi/txs/token?sort_type=asc → first 50 swaps, oldest first
//   3. Filter buys within first 60 s of token creation
//   4. Insert ALL early buyers (not just a pre-seeded list)
//   5. Categorise by historical performance:
//        smart    — 3+ entries, ≥60% win rate
//        watching — 1-2 previous entries
//        new      — never seen before
//   6. Background: resolve outcomes for 1h-old signals (2× = win, -50% = loss)
//   7. Auto-update win rates + promote wallets with consistent performance
//
// NO pre-seeded wallet list required — the system builds knowledge from real behaviour.

const { getDb, redisSet, CORS } = require("./db");

const BIRDEYE_KEY = process.env.BIRDEYE_API_KEY;
const BH          = { "X-API-KEY": BIRDEYE_KEY, "x-chain": "solana" };

const SOL_MINT           = "So11111111111111111111111111111111111111112";
const ENTRY_WINDOW_SECS  = 60;   // only count buys in first 60 s
const LOOKBACK_MINS      = 12;   // tokens detected in last 12 min
const MAX_TOKENS         = 8;    // cap per run (API quota protection)
const MIN_BUY_SOL        = 0.08; // ignore dust
const SM_CACHE_KEY       = "sm_feed_v1";

// Promotion thresholds
const SMART_MIN_ENTRIES  = 3;
const SMART_MIN_WIN_RATE = 60;   // ≥60% to be labeled "smart"

// Outcome thresholds
const WIN_MULT  = 2.0;  // 2× = win
const LOSS_MULT = 0.5;  // −50% = loss

/* ── Birdeye helpers ────────────────────────────────────────────────────────── */
async function beFetch(url, timeoutMs = 10_000) {
  let r = await fetch(url, { headers: BH, signal: AbortSignal.timeout(timeoutMs) }).catch(() => null);
  if (r?.status === 429) {
    await new Promise(res => setTimeout(res, 1200));
    r = await fetch(url, { headers: BH, signal: AbortSignal.timeout(timeoutMs) }).catch(() => null);
  }
  return r;
}

// Returns earliest buy-side trades for `mint` within the first 60 s of `mintedAt`.
// Uses same endpoint as bundle.js — proven to return correct earliest swaps.
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

    // Already sorted asc by API, but guarantee it
    trades.sort((a, b) => (a.blockUnixTime ?? 0) - (b.blockUnixTime ?? 0));

    const windowEnd = mintedAt + ENTRY_WINDOW_SECS;

    return trades.filter(tx => {
      const isBuy = tx.side === "buy"
        || tx.from?.symbol  === "SOL"
        || tx.quote?.symbol === "SOL"
        || tx.from?.address === SOL_MINT
        || tx.quote?.address === SOL_MINT;
      const t = tx.blockUnixTime ?? 0;
      return isBuy && t >= mintedAt && t <= windowEnd;
    });
  } catch (e) {
    console.warn("getEarlyBuys error:", e.message);
    return [];
  }
}

// Current token price from Birdeye
async function getPrice(mint) {
  try {
    const r = await beFetch(
      `https://public-api.birdeye.so/defi/price?address=${encodeURIComponent(mint)}`,
      5_000
    );
    if (!r?.ok) return 0;
    const j = await r.json().catch(() => null);
    return parseFloat(j?.data?.value ?? 0) || 0;
  } catch { return 0; }
}

// Extract buyer wallet from a Birdeye trade object
function tradeOwner(tx) {
  return tx.owner ?? tx.maker ?? tx.from?.address ?? null;
}

// Extract SOL amount the buyer paid
function tradeSolAmount(tx) {
  const fromSol  = tx.from?.address  === SOL_MINT || tx.from?.symbol  === "SOL";
  const quoteSol = tx.quote?.address === SOL_MINT || tx.quote?.symbol === "SOL";
  if (fromSol)  return parseFloat(tx.from?.uiAmount  ?? tx.from?.amount  ?? 0);
  if (quoteSol) return parseFloat(tx.quote?.uiAmount ?? tx.quote?.amount ?? 0);
  return 0;
}

/* ── Resolve category for a wallet ─────────────────────────────────────────── */
function resolveWallet(walletAddr, knownMap, histMap) {
  const lower = walletAddr.toLowerCase();

  // Known pre-seeded wallet (label from DB)?
  if (knownMap.has(lower)) {
    const w = knownMap.get(lower);
    if (w.category !== "tracking") {          // don't override auto-tracked
      return { label: w.label, category: w.category, win_rate: Number(w.win_rate) || 0 };
    }
  }

  // Historical performance from signals table
  const hist = histMap.get(walletAddr);
  if (hist) {
    const resolved = hist.wins + hist.losses;
    const wr       = resolved > 0 ? Math.round((hist.wins / resolved) * 100) : 0;

    if (hist.total >= SMART_MIN_ENTRIES && wr >= SMART_MIN_WIN_RATE) {
      return { label: `Auto Sniper · ${wr}% WR`, category: "smart", win_rate: wr };
    }
    return { label: `Tracking · ${hist.total} entries`, category: "watching", win_rate: wr };
  }

  return { label: "New Early Buyer", category: "new", win_rate: 0 };
}

/* ── Outcome resolver (runs each cron tick) ─────────────────────────────────── */
async function resolveOutcomes(sql) {
  try {
    const cutoff1h = Date.now() - 1 * 60 * 60 * 1000;
    const cutoff6h = Date.now() - 6 * 60 * 60 * 1000;

    const pending = await sql`
      SELECT DISTINCT ON (mint) mint, entry_price_usd
      FROM   smart_money_signals
      WHERE  outcome IS NULL
        AND  entry_price_usd > 0
        AND  detected_at BETWEEN ${cutoff6h} AND ${cutoff1h}
      LIMIT  6
    `;

    for (const sig of pending) {
      const price = await getPrice(sig.mint);
      if (!price || !sig.entry_price_usd) continue;

      const mult    = price / parseFloat(sig.entry_price_usd);
      const outcome = mult >= WIN_MULT ? "win" : mult <= LOSS_MULT ? "loss" : null;
      if (!outcome) continue;

      await sql`
        UPDATE smart_money_signals
        SET    outcome = ${outcome}
        WHERE  mint = ${sig.mint} AND outcome IS NULL
      `;
    }
  } catch (e) { console.warn("resolveOutcomes:", e.message); }
}

/* ── Win-rate sync ──────────────────────────────────────────────────────────── */
async function syncWinRates(sql) {
  try {
    const rows = await sql`
      SELECT
        wallet,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE outcome = 'win')  AS wins,
        COUNT(*) FILTER (WHERE outcome = 'loss') AS losses
      FROM   smart_money_signals
      WHERE  outcome IS NOT NULL
      GROUP  BY wallet
    `;

    for (const row of rows) {
      const total    = Number(row.wins) + Number(row.losses);
      const win_rate = total > 0 ? Math.round((Number(row.wins) / total) * 100) : 0;
      const total_entries = Number(row.total);

      // Promote category if threshold reached
      const cat = total_entries >= SMART_MIN_ENTRIES && win_rate >= SMART_MIN_WIN_RATE
        ? "smart" : "tracking";
      const label = cat === "smart"
        ? `Auto Sniper · ${win_rate}% WR`
        : `Auto-Tracked`;

      await sql`
        INSERT INTO smart_wallets (wallet, label, category, wins, losses, win_rate, active)
        VALUES (${row.wallet}, ${label}, ${cat}, ${row.wins}, ${row.losses}, ${win_rate}, true)
        ON CONFLICT (wallet) DO UPDATE
          SET wins     = ${row.wins},
              losses   = ${row.losses},
              win_rate = ${win_rate},
              category = CASE WHEN smart_wallets.category NOT IN ('sniper','kol','whale','alpha')
                               THEN ${cat}
                               ELSE smart_wallets.category END,
              label    = CASE WHEN smart_wallets.category NOT IN ('sniper','kol','whale','alpha')
                               THEN ${label}
                               ELSE smart_wallets.label END,
              updated_at = NOW()
      `;
    }
  } catch (e) { console.warn("syncWinRates:", e.message); }
}

/* ── Main handler ───────────────────────────────────────────────────────────── */
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  try {
    const sql = getDb();

    // Load known wallets map (lower-case key)
    const knownRows = await sql`SELECT wallet, label, category, win_rate FROM smart_wallets WHERE active = true`;
    const knownMap  = new Map(knownRows.map(w => [w.wallet.toLowerCase(), w]));

    // Load historical performance of ALL wallets seen in signals
    const histRows = await sql`
      SELECT
        wallet,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE outcome = 'win')  AS wins,
        COUNT(*) FILTER (WHERE outcome = 'loss') AS losses
      FROM   smart_money_signals
      GROUP  BY wallet
    `;
    const histMap = new Map(histRows.map(r => [r.wallet, {
      total:  Number(r.total),
      wins:   Number(r.wins),
      losses: Number(r.losses),
    }]));

    // Get recently detected new pairs
    const cutoffMs = Date.now() - LOOKBACK_MINS * 60 * 1000;
    const pairs = await sql`
      SELECT mint, symbol, name, logo_uri, block_unix_time, detected_at
      FROM   new_pairs
      WHERE  detected_at > ${cutoffMs}
      ORDER  BY detected_at DESC
      LIMIT  ${MAX_TOKENS}
    `;

    let processed = 0, inserted = 0;

    for (const pair of pairs) {
      processed++;
      const mintedAt = pair.block_unix_time
        ? Number(pair.block_unix_time)
        : Math.floor(Number(pair.detected_at) / 1000);

      // Fetch earliest buys via Birdeye (sort=asc, proven in bundle.js)
      const earlyBuys = await getEarlyBuys(pair.mint, mintedAt);
      if (!earlyBuys.length) continue;

      // Get entry price once per token
      const entryPrice = await getPrice(pair.mint);

      // Deduplicate buyers within this token (keep largest buy per wallet)
      const buyerMap = new Map(); // wallet → trade
      for (const trade of earlyBuys) {
        const wallet = tradeOwner(trade);
        if (!wallet) continue;
        const sol = tradeSolAmount(trade);
        if (sol < MIN_BUY_SOL) continue;
        if (!buyerMap.has(wallet) || sol > tradeSolAmount(buyerMap.get(wallet))) {
          buyerMap.set(wallet, trade);
        }
      }

      for (const [wallet, trade] of buyerMap) {
        const sol     = tradeSolAmount(trade);
        const ageSecs = Math.max(0, (trade.blockUnixTime ?? mintedAt) - mintedAt);
        const walletInfo = resolveWallet(wallet, knownMap, histMap);

        try {
          const res = await sql`
            INSERT INTO smart_money_signals
              (mint, symbol, name, logo_uri,
               wallet, wallet_label, wallet_category, wallet_win_rate,
               buy_amount_sol, token_age_secs, entry_price_usd, detected_at, sig)
            VALUES
              (${pair.mint}, ${pair.symbol || "?"}, ${pair.name || "?"}, ${pair.logo_uri || null},
               ${wallet}, ${walletInfo.label}, ${walletInfo.category}, ${walletInfo.win_rate},
               ${sol}, ${ageSecs}, ${entryPrice || 0}, ${Date.now()}, ${trade.txHash || null})
            ON CONFLICT (mint, wallet) DO NOTHING
            RETURNING id
          `;
          if (res.length) inserted++;
        } catch { /* duplicate — safe to ignore */ }
      }
    }

    // Background maintenance (non-fatal)
    await resolveOutcomes(sql);
    await syncWinRates(sql);

    // Bust Redis so frontend gets fresh data
    await redisSet(SM_CACHE_KEY, null, 1);

    return {
      statusCode: 200,
      headers:    CORS,
      body: JSON.stringify({ ok: true, processed, inserted }),
    };
  } catch (err) {
    console.error("detectSmartMoney error:", err);
    return {
      statusCode: 500,
      headers:    CORS,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
