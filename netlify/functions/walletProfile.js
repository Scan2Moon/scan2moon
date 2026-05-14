/* ================================================================
   Scan2Moon - Wallet Profile Store  (Netlify Function)
   GET  /.netlify/functions/walletProfile?wallet=<address>
   POST /.netlify/functions/walletProfile  { wallet, archetype, ... }

   Every time a wallet is scanned on Scan2Moon, its DNA profile
   is saved here. Over time this builds Scan2Moon's own unique
   dataset of classified Solana wallets -- the foundation of the
   API product.

   GET  -> return stored profile (fast DB lookup, no Birdeye calls)
   POST -> upsert profile (called by whale-dna.js after every scan)

   Schema (auto-created on first POST):
     wallet_profiles (wallet PK, archetype, copy_score, win_rate,
       total_value, total_deployed, rug_rate, scan_count,
       last_scanned, created_at, tags JSONB, metadata JSONB)
   ================================================================ */

const { getDb, CORS, CORS_429, isRateLimitedRedis } = require("./db");

const WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/* -- Ensure wallet_profiles table exists (runs once per cold start) -- */
let schemaReady = false;
async function ensureSchema(sql) {
  if (schemaReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS wallet_profiles (
      wallet          TEXT PRIMARY KEY,
      archetype       TEXT        NOT NULL DEFAULT 'unknown',
      copy_score      INTEGER     DEFAULT 50,
      win_rate        FLOAT       DEFAULT 0,
      total_value     FLOAT       DEFAULT 0,
      total_deployed  INTEGER     DEFAULT 0,
      rug_rate        FLOAT       DEFAULT 0,
      scan_count      INTEGER     DEFAULT 1,
      last_scanned    TIMESTAMPTZ DEFAULT NOW(),
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      tags            JSONB       DEFAULT '[]',
      metadata        JSONB       DEFAULT '{}'
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS wp_archetype_idx ON wallet_profiles (archetype)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS wp_copy_score_idx ON wallet_profiles (copy_score DESC)
  `;
  schemaReady = true;
}

/* ================================================================
   HANDLER
   ================================================================ */
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };

  const ip = (
    event.headers["x-nf-client-connection-ip"] ||
    event.headers["x-forwarded-for"] ||
    "unknown"
  ).split(",")[0].trim();

  if (await isRateLimitedRedis(ip, 30, 60, "wp"))
    return { statusCode: 429, headers: CORS_429, body: JSON.stringify({ error: "Too many requests" }) };

  const sql = getDb();
  try { await ensureSchema(sql); } catch (e) {
    console.error("[walletProfile] schema error:", e.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "DB schema error" }) };
  }

  /* ---- GET: look up a stored profile ---------------------------------- */
  if (event.httpMethod === "GET") {
    const wallet = (event.queryStringParameters?.wallet ?? "").trim();
    if (!wallet || !WALLET_RE.test(wallet))
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid wallet" }) };

    try {
      const rows = await sql`
        SELECT * FROM wallet_profiles WHERE wallet = ${wallet} LIMIT 1
      `;
      if (rows.length === 0)
        return { statusCode: 404, headers: CORS, body: JSON.stringify({ found: false, wallet }) };

      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({ found: true, profile: rows[0] }),
      };
    } catch (e) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
    }
  }

  /* ---- POST: upsert a profile after scan ------------------------------ */
  if (event.httpMethod === "POST") {
    let body;
    try { body = JSON.parse(event.body || "{}"); }
    catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid JSON" }) }; }

    const {
      wallet,
      archetype    = "unknown",
      copyScore    = 50,
      winRate      = 0,
      totalValue   = 0,
      totalDeployed = 0,
      rugRate      = 0,
      tags         = [],
      metadata     = {},
    } = body;

    if (!wallet || !WALLET_RE.test(wallet))
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid wallet" }) };

    try {
      await sql`
        INSERT INTO wallet_profiles
          (wallet, archetype, copy_score, win_rate, total_value,
           total_deployed, rug_rate, scan_count, last_scanned, tags, metadata)
        VALUES (
          ${wallet}, ${archetype}, ${copyScore}, ${winRate}, ${totalValue},
          ${totalDeployed}, ${rugRate}, 1, NOW(),
          ${JSON.stringify(tags)}, ${JSON.stringify(metadata)}
        )
        ON CONFLICT (wallet) DO UPDATE SET
          archetype      = EXCLUDED.archetype,
          copy_score     = EXCLUDED.copy_score,
          win_rate       = EXCLUDED.win_rate,
          total_value    = EXCLUDED.total_value,
          total_deployed = EXCLUDED.total_deployed,
          rug_rate       = EXCLUDED.rug_rate,
          scan_count     = wallet_profiles.scan_count + 1,
          last_scanned   = NOW(),
          tags           = EXCLUDED.tags,
          metadata       = EXCLUDED.metadata
      `;
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, wallet }) };
    } catch (e) {
      console.error("[walletProfile] upsert error:", e.message);
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
    }
  }

  return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Method not allowed" }) };
};
