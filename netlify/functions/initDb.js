// netlify/functions/initDb.js
// One-time schema bootstrap — call GET /.netlify/functions/initDb to create tables.
// Safe to call multiple times (CREATE TABLE IF NOT EXISTS).
// Protected by ADMIN_SECRET header — same secret used by adminKey.js.

const { getDb, CORS } = require("./db");

exports.handler = async (event) => {
  /* ── Auth: require X-Admin-Secret header ── */
  const secret      = (event.headers["x-admin-secret"] || "").trim();
  const ADMIN_SECRET = process.env.ADMIN_SECRET || "";
  if (!ADMIN_SECRET) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: "ADMIN_SECRET env var not set on server." }),
    };
  }
  if (!secret || secret !== ADMIN_SECRET) {
    return {
      statusCode: 401,
      headers: CORS,
      body: JSON.stringify({ error: "Unauthorized. Pass X-Admin-Secret header." }),
    };
  }

  try {
    const sql = getDb();

    // ── token_cache: latest price + metadata per mint ──────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS token_cache (
        mint          TEXT PRIMARY KEY,
        symbol        TEXT,
        name          TEXT,
        logo_uri      TEXT,
        price_usd     NUMERIC,
        price_sol     NUMERIC,
        volume_24h    NUMERIC,
        market_cap    NUMERIC,
        pair_address  TEXT,
        dex_id        TEXT,
        chain_id      TEXT DEFAULT 'solana',
        fetched_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    // ── ohlcv_cache: candlestick bars per mint+timeframe ───────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS ohlcv_cache (
        id          BIGSERIAL PRIMARY KEY,
        mint        TEXT        NOT NULL,
        tf          TEXT        NOT NULL,
        ts          BIGINT      NOT NULL,
        open        NUMERIC     NOT NULL,
        high        NUMERIC     NOT NULL,
        low         NUMERIC     NOT NULL,
        close       NUMERIC     NOT NULL,
        volume      NUMERIC     NOT NULL DEFAULT 0,
        fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (mint, tf, ts)
      )
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS ohlcv_mint_tf_ts
        ON ohlcv_cache (mint, tf, ts DESC)
    `;

    // ── hot_tokens: which mints to keep warm in the 2-min cron ────────────
    await sql`
      CREATE TABLE IF NOT EXISTS hot_tokens (
        mint        TEXT PRIMARY KEY,
        rank        INT  NOT NULL DEFAULT 999,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    // ── new_pairs: our own new-token signal (populated by detectNewPairs cron) ──
    await sql`
      CREATE TABLE IF NOT EXISTS new_pairs (
        mint            TEXT PRIMARY KEY,
        symbol          TEXT NOT NULL DEFAULT '',
        name            TEXT NOT NULL DEFAULT '',
        logo_uri        TEXT,
        price_usd       NUMERIC     DEFAULT 0,
        liquidity       NUMERIC     DEFAULT 0,
        market_cap      NUMERIC     DEFAULT 0,
        vol_24h         NUMERIC     DEFAULT 0,
        holders         INTEGER     DEFAULT 0,
        block_unix_time BIGINT,
        detected_at     BIGINT      NOT NULL,
        risk_score      INTEGER     DEFAULT 50,
        risk_level      TEXT        DEFAULT 'MED',
        fetched_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS np_block_time_idx ON new_pairs (block_unix_time DESC NULLS LAST)`;
    await sql`CREATE INDEX IF NOT EXISTS np_detected_idx   ON new_pairs (detected_at DESC)`;

    // -- wallet_profiles: Scan2Moon's own wallet classification dataset ----
    // Every Whale DNA scan saves here. Over time this becomes a unique
    // database of classified Solana wallets -- the core of the API product.
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
    await sql`CREATE INDEX IF NOT EXISTS wp_archetype_idx  ON wallet_profiles (archetype)`;
    await sql`CREATE INDEX IF NOT EXISTS wp_copy_score_idx ON wallet_profiles (copy_score DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS wp_last_scan_idx  ON wallet_profiles (last_scanned DESC)`;

    // ── api_keys: developer API key monetisation ──────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS api_keys (
        key_id         TEXT PRIMARY KEY,
        email          TEXT NOT NULL,
        plan           TEXT NOT NULL DEFAULT 'starter',
        active         BOOLEAN NOT NULL DEFAULT true,
        created_at     TIMESTAMPTZ DEFAULT NOW(),
        last_used_at   TIMESTAMPTZ,
        total_requests BIGINT DEFAULT 0,
        daily_requests INT DEFAULT 0,
        daily_reset    DATE DEFAULT CURRENT_DATE,
        note           TEXT
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS ak_email_idx ON api_keys (email)`;
    await sql`CREATE INDEX IF NOT EXISTS ak_active_idx ON api_keys (active)`;

    /* renews_at — added in renewal-detection update (safe on existing tables) */
    await sql`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS renews_at TIMESTAMPTZ`;
    await sql`CREATE INDEX IF NOT EXISTS ak_renews_idx ON api_keys (renews_at) WHERE renews_at IS NOT NULL`;

    // ── request_log: per-call agent/API usage log ─────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS request_log (
        id            BIGSERIAL PRIMARY KEY,
        endpoint      TEXT        NOT NULL,
        access_method TEXT        NOT NULL,
        key_id        TEXT,
        plan          TEXT,
        email_domain  TEXT,
        payer         TEXT,
        tx_hash       TEXT,
        ip            TEXT,
        called_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS rl_called_at_idx  ON request_log (called_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS rl_endpoint_idx   ON request_log (endpoint, called_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS rl_key_id_idx     ON request_log (key_id) WHERE key_id IS NOT NULL`;

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ ok: true, message: "Schema ready." }),
    };
  } catch (err) {
    console.error("initDb error:", err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
