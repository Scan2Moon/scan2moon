// netlify/functions/smartMoney.js
// GET /.netlify/functions/smartMoney
// Serves the Smart Money Live Copy-Trade Feed to the frontend.
// Groups signals by token, attaches wallet details, caches in Redis (30 s).

const { getDb, redisGet, redisSet, CORS, CORS_429, isRateLimitedRedis } = require("./db");

const CACHE_KEY  = "sm_feed_v1";
const CACHE_TTL  = 30;  // seconds
const FEED_LIMIT = 40;  // max distinct tokens to return
const LOOKBACK_H = 24;  // hours of history to include

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  const ip = event.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() || "unknown";
  if (await isRateLimitedRedis(ip, 20, 10, "sm")) {
    return { statusCode: 429, headers: CORS_429, body: JSON.stringify({ error: "rate_limited" }) };
  }

  try {
    /* 1. Cache hit? */
    const cached = await redisGet(CACHE_KEY);
    if (cached) {
      return {
        statusCode: 200,
        headers:    { ...CORS, "X-Cache": "HIT" },
        body:       JSON.stringify(cached),
      };
    }

    const sql = getDb();
    const cutoffMs = Date.now() - LOOKBACK_H * 60 * 60 * 1000;

    /* Debug mode: ?debug=1 returns pipeline diagnostics instead of feed */
    if (event.queryStringParameters?.debug === "1") {
      const [pairsCount, signalsCount, walletsCount] = await Promise.all([
        sql`SELECT COUNT(*) AS n, MAX(detected_at) AS last FROM new_pairs WHERE detected_at > ${cutoffMs}`,
        sql`SELECT COUNT(*) AS n FROM smart_money_signals`,
        sql`SELECT COUNT(*) AS n FROM smart_wallets WHERE active = true`,
      ]);
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({
          ok: true,
          debug: {
            new_pairs_last_24h:    Number(pairsCount[0]?.n || 0),
            last_pair_detected_at: pairsCount[0]?.last ? new Date(Number(pairsCount[0].last)).toISOString() : null,
            total_signals_ever:    Number(signalsCount[0]?.n || 0),
            tracked_wallets:       Number(walletsCount[0]?.n || 0),
            note: "If new_pairs_last_24h = 0, the detectOnchain cron has not run. Trigger it manually at /.netlify/functions/detectOnchain"
          }
        }),
      };
    }

    /* 2. Fetch signals — all categories, prioritise quality wallets */
    const rows = await sql`
      SELECT
        s.id,
        s.mint,
        s.symbol,
        s.name,
        s.logo_uri,
        s.wallet,
        s.wallet_label,
        s.wallet_category,
        s.wallet_win_rate,
        s.buy_amount_sol,
        s.token_age_secs,
        s.detected_at,
        s.sig,
        s.outcome,
        -- Aggregate per token (window functions — no GROUP BY needed)
        COUNT(*)              OVER (PARTITION BY s.mint) AS smart_count,
        SUM(s.buy_amount_sol) OVER (PARTITION BY s.mint) AS total_smart_sol,
        AVG(s.wallet_win_rate) OVER (PARTITION BY s.mint) AS avg_win_rate,
        -- Quality score: weight by category
        MAX(CASE s.wallet_category
              WHEN 'sniper' THEN 4
              WHEN 'smart'  THEN 4
              WHEN 'alpha'  THEN 3
              WHEN 'whale'  THEN 3
              WHEN 'kol'    THEN 3
              WHEN 'watching' THEN 2
              ELSE 1 END) OVER (PARTITION BY s.mint) AS max_quality
      FROM   smart_money_signals s
      WHERE  s.detected_at > ${cutoffMs}
      ORDER  BY s.detected_at DESC
      LIMIT  300
    `;

    /* 3. Group rows by token mint */
    const tokenMap = new Map();
    for (const row of rows) {
      if (!tokenMap.has(row.mint)) {
        tokenMap.set(row.mint, {
          mint:            row.mint,
          symbol:          row.symbol || "?",
          name:            row.name   || "Unknown",
          logo_uri:        row.logo_uri || null,
          smart_count:     Number(row.smart_count),
          total_smart_sol: parseFloat(row.total_smart_sol) || 0,
          avg_win_rate:    parseFloat(row.avg_win_rate)    || 0,
          detected_at:     Number(row.detected_at),
          wallets:         [],
        });
      }
      tokenMap.get(row.mint).wallets.push({
        wallet:   row.wallet,
        label:    row.wallet_label    || "Early Buyer",
        category: row.wallet_category || "new",
        win_rate: parseFloat(row.wallet_win_rate) || 0,
        buy_sol:  parseFloat(row.buy_amount_sol)  || 0,
        age_secs: Number(row.token_age_secs)      || 0,
        sig:      row.sig    || null,
        outcome:  row.outcome || null,
      });
      // Track max quality score per token
      const qual = Number(row.max_quality) || 1;
      if (qual > (tokenMap.get(row.mint).quality || 0)) {
        tokenMap.get(row.mint).quality = qual;
      }
    }

    /* 4. Sort: quality score first, then most recent */
    const feed = [...tokenMap.values()]
      .sort((a, b) => (b.quality - a.quality) || (b.detected_at - a.detected_at))
      .slice(0, FEED_LIMIT);

    /* 5. Summary stats */
    const stats = await sql`
      SELECT
        COUNT(DISTINCT mint)   AS total_tokens,
        COUNT(DISTINCT wallet) AS active_wallets,
        MAX(detected_at)       AS last_signal_at
      FROM   smart_money_signals
      WHERE  detected_at > ${cutoffMs}
    `;

    /* 6. Top wallets by win rate (for sidebar widget) */
    const topWallets = await sql`
      SELECT wallet, label, category, win_rate, wins, losses
      FROM   smart_wallets
      WHERE  active = true
      ORDER  BY win_rate DESC
      LIMIT  10
    `;

    const payload = {
      ok:   true,
      feed,
      stats: {
        total_tokens:   Number(stats[0]?.total_tokens   || 0),
        active_wallets: Number(stats[0]?.active_wallets || 0),
        last_signal_at: Number(stats[0]?.last_signal_at || 0),
      },
      top_wallets: topWallets.map(w => ({
        wallet:   w.wallet,
        label:    w.label,
        category: w.category,
        win_rate: parseFloat(w.win_rate) || 0,
        wins:     Number(w.wins),
        losses:   Number(w.losses),
      })),
      ts: Date.now(),
    };

    await redisSet(CACHE_KEY, payload, CACHE_TTL);

    return {
      statusCode: 200,
      headers:    { ...CORS, "X-Cache": "MISS" },
      body:       JSON.stringify(payload),
    };
  } catch (err) {
    console.error("smartMoney error:", err);
    return {
      statusCode: 500,
      headers:    CORS,
      body:       JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
