/* ================================================================
   Scan2Moon -- Smart Money Leaderboard  (Netlify Function)
   GET /.netlify/functions/smartMoneyLeaderboard
     ?archetype=all|smart_money|whale|bot|degen|sniper|...
     &sort=copy_score|win_rate|total_value|scan_count
     &limit=50

   Queries the wallet_profiles table that is populated by every
   Whale DNA scan. Over time this becomes Scan2Moon's proprietary
   classified Solana wallet database.

   Unique data -- not available anywhere else.

   Cache: Redis 5 min
   ================================================================ */

const { getDb, redisGet, redisSet, CORS, CORS_429, isRateLimitedRedis } = require("./db");
const { resolveAccess, respond402, CORS_API } = require("./x402");

const REDIS_TTL = 300; // 5 min

const VALID_SORTS = new Set(["copy_score", "win_rate", "total_value", "scan_count"]);

const VALID_ARCHETYPES = new Set([
  "all", "smart_money", "whale", "bot", "degen", "sniper",
  "diamond", "smart", "flipper", "accumulator", "rug_deployer",
  "dev_wallet", "unknown",
]);

const ARCHETYPE_META = {
  smart_money:  { emoji: "\uD83E\uDDE0", name: "Smart Money",  color: "#2cffc9" },
  whale:        { emoji: "\uD83D\uDC0B", name: "Whale",         color: "#5bc8ff" },
  bot:          { emoji: "\uD83E\uDD16", name: "Bot",           color: "#a78bfa" },
  degen:        { emoji: "\uD83C\uDFB0", name: "Degen",         color: "#ff6b6b" },
  sniper:       { emoji: "\uD83C\uDFAF", name: "Sniper",        color: "#ffd700" },
  diamond:      { emoji: "\uD83D\uDC8E", name: "Diamond Hands", color: "#5bc8ff" },
  smart:        { emoji: "\uD83E\uDDE0", name: "Smart",         color: "#2cffc9" },
  flipper:      { emoji: "\uD83D\uDD04", name: "Flipper",       color: "#ff9632" },
  accumulator:  { emoji: "\uD83D\uDFE2", name: "Accumulator",   color: "#4ade80" },
  rug_deployer: { emoji: "\uD83D\uDC80", name: "Rug Deployer",  color: "#ff4d6d" },
  dev_wallet:   { emoji: "\uD83D\uDEE0\uFE0F", name: "Dev Wallet",    color: "#ff9632" },
  unknown:      { emoji: "?",              name: "Unknown",      color: "#888888" },
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  if (event.httpMethod !== "GET")
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Method not allowed" }) };

  const ip = (
    event.headers["x-nf-client-connection-ip"] ||
    event.headers["x-forwarded-for"] ||
    "unknown"
  ).split(",")[0].trim();

  /* Access gate: API key / x402 Base / Solana / paywall */
  const access = await resolveAccess(event, "smartMoneyLeaderboard");
  if (access.access === "paywall") return respond402("smartMoneyLeaderboard");
  if (access.access === "denied")
    return { statusCode: access.status, headers: CORS_API, body: JSON.stringify({ error: access.error }) };

  const params    = event.queryStringParameters || {};
  const archetype = VALID_ARCHETYPES.has(params.archetype) ? params.archetype : "all";
  const sort      = VALID_SORTS.has(params.sort)           ? params.sort      : "copy_score";
  const limit     = Math.min(Math.max(parseInt(params.limit) || 50, 1), 100);

  const cacheKey = `smlb:v1:${archetype}:${sort}:${limit}`;
  try {
    const hit = await redisGet(cacheKey);
    if (hit) return {
      statusCode: 200,
      headers: { ...CORS, "X-Cache": "HIT" },
      body: JSON.stringify(hit),
    };
  } catch {}

  try {
    const sql = getDb();

    // sort is validated against VALID_SORTS whitelist -- safe to interpolate as identifier
    // limit is a parsed integer -- safe to interpolate
    // archetype is parameterised via $1 placeholder where used
    const mainQuery = archetype === "all"
      ? `SELECT wallet, archetype, copy_score, win_rate, total_value,
                total_deployed, rug_rate, scan_count, last_scanned, tags
         FROM wallet_profiles
         ORDER BY ${sort} DESC NULLS LAST
         LIMIT $1`
      : `SELECT wallet, archetype, copy_score, win_rate, total_value,
                total_deployed, rug_rate, scan_count, last_scanned, tags
         FROM wallet_profiles
         WHERE archetype = $1
         ORDER BY ${sort} DESC NULLS LAST
         LIMIT $2`;

    const rows = archetype === "all"
      ? await sql(mainQuery, [limit])
      : await sql(mainQuery, [archetype, limit]);

    // Archetype distribution for filter tab counts
    const distRows = await sql`
      SELECT archetype, COUNT(*)::int AS cnt
      FROM wallet_profiles
      GROUP BY archetype
      ORDER BY cnt DESC
    `;

    const distribution = { all: 0 };
    for (const r of distRows) {
      distribution[r.archetype] = r.cnt;
      distribution.all += r.cnt;
    }

    // Enrich rows with display metadata
    const entries = rows.map((r, i) => {
      const meta = ARCHETYPE_META[r.archetype] ?? ARCHETYPE_META.unknown;
      return {
        rank:          i + 1,
        wallet:        r.wallet,
        walletShort:   r.wallet.slice(0, 4) + "..." + r.wallet.slice(-4),
        archetype:     r.archetype,
        archetypeEmoji: meta.emoji,
        archetypeName:  meta.name,
        archetypeColor: meta.color,
        copyScore:     r.copy_score    ?? 50,
        winRate:       r.win_rate      ?? 0,   // stored as 0-100 integer
        totalValue:    parseFloat(r.total_value    ?? 0),
        totalDeployed: r.total_deployed ?? 0,
        rugRate:       parseFloat(r.rug_rate ?? 0),
        scanCount:     r.scan_count    ?? 1,
        lastScanned:   r.last_scanned,
        tags:          r.tags          ?? [],
      };
    });

    const result = { entries, distribution, archetype, sort, limit };

    try { await redisSet(cacheKey, result, REDIS_TTL); } catch {}

    return {
      statusCode: 200,
      headers: { ...CORS, "X-Cache": "MISS" },
      body: JSON.stringify(result),
    };

  } catch (e) {
    console.error("[smartMoneyLeaderboard]", e.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "Internal error" }) };
  }
};
