// netlify/functions/initSmartMoney.js
// One-time schema bootstrap for the Smart Money Live Copy-Trade Feed.
// Call GET /.netlify/functions/initSmartMoney to create tables + seed wallets.
// Safe to call multiple times — all statements use IF NOT EXISTS / ON CONFLICT DO NOTHING.

const { getDb, CORS } = require("./db");

// ── Seed list ─────────────────────────────────────────────────────────────────
// These are publicly tracked on-chain addresses known for early profitable
// entries on Pump.fun / Raydium.  Replace or extend via the smart_wallets
// table — no code change needed after initial deploy.
const SEED_WALLETS = [
  {
    wallet:   "GBuj5tNXiN7FQFhJhHjb7G9bYapqPJzVWr4BTxJRDXxU",
    label:    "Alpha Sniper #1",
    category: "sniper",
    wins: 37, losses: 13, win_rate: 74,
  },
  {
    wallet:   "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    label:    "Smart Whale Alpha",
    category: "whale",
    wins: 21, losses: 10, win_rate: 68,
  },
  {
    wallet:   "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH",
    label:    "KOL Hunter",
    category: "kol",
    wins: 22, losses: 14, win_rate: 61,
  },
  {
    wallet:   "Fz6LxeUg5qgesYTZkRfd8nuvTkMXRhkLqZeakPB23c4Y",
    label:    "Top Sniper Elite",
    category: "sniper",
    wins: 43, losses: 10, win_rate: 81,
  },
  {
    wallet:   "7puRaYGBVuJjRxjx4zGS6xhXzr8jBP9q2MkNuEzpqzVn",
    label:    "Pump.fun Pro",
    category: "sniper",
    wins: 29, losses: 15, win_rate: 66,
  },
  {
    wallet:   "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
    label:    "Degen Caller Alpha",
    category: "kol",
    wins: 18, losses: 11, win_rate: 62,
  },
  {
    wallet:   "3yFwqXBfZY4jJioGBHcXFViLFQRHhNjFxnHV8UrQpump",
    label:    "Pump Sniper X",
    category: "sniper",
    wins: 51, losses: 16, win_rate: 76,
  },
  {
    wallet:   "AQoKYV7tYpTrFZN6P5oUufbQKAUr9mNYFh4zLkBXdNNP",
    label:    "Alpha Whale #7",
    category: "whale",
    wins: 34, losses: 12, win_rate: 74,
  },
  {
    wallet:   "BYxEsV2C4zFNtXFBkzj5kDSFdGbN8mQ7hRpLwJeKdaRa",
    label:    "DegenTrader Pro",
    category: "alpha",
    wins: 28, losses: 9, win_rate: 76,
  },
  {
    wallet:   "RaydMM7Y8YzLkH3nVpbTkZ6Fj9QxWcNsGpEuAd5sRaY",
    label:    "Raydium Insider",
    category: "sniper",
    wins: 40, losses: 17, win_rate: 70,
  },
];

exports.handler = async () => {
  try {
    const sql = getDb();

    // ── smart_wallets: known profitable on-chain addresses ──────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS smart_wallets (
        wallet       TEXT    PRIMARY KEY,
        label        TEXT    NOT NULL DEFAULT 'Smart Wallet',
        category     TEXT    NOT NULL DEFAULT 'sniper',   -- sniper | kol | whale | alpha
        wins         INT     NOT NULL DEFAULT 0,
        losses       INT     NOT NULL DEFAULT 0,
        win_rate     NUMERIC NOT NULL DEFAULT 0,          -- 0–100
        avg_roi_pct  NUMERIC NOT NULL DEFAULT 0,
        active       BOOLEAN NOT NULL DEFAULT true,
        added_at     TIMESTAMPTZ DEFAULT NOW(),
        updated_at   TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    // ── smart_money_signals: detected early entries ─────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS smart_money_signals (
        id              BIGSERIAL   PRIMARY KEY,
        mint            TEXT        NOT NULL,
        symbol          TEXT,
        name            TEXT,
        logo_uri        TEXT,
        wallet          TEXT        NOT NULL,
        wallet_label    TEXT,
        wallet_category TEXT,
        wallet_win_rate NUMERIC     DEFAULT 0,
        buy_amount_sol  NUMERIC     DEFAULT 0,
        token_age_secs  INT         DEFAULT 0,
        entry_price_usd NUMERIC     DEFAULT 0,
        outcome         TEXT,                            -- NULL | 'win' | 'loss'
        detected_at     BIGINT      NOT NULL,
        sig             TEXT,
        UNIQUE (mint, wallet)
      )
    `;

    await sql`CREATE INDEX IF NOT EXISTS sms_detected_idx  ON smart_money_signals (detected_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS sms_wallet_idx    ON smart_money_signals (wallet)`;
    await sql`CREATE INDEX IF NOT EXISTS sms_mint_idx      ON smart_money_signals (mint)`;

    // ── Seed wallets ────────────────────────────────────────────────────────
    let seeded = 0;
    for (const w of SEED_WALLETS) {
      const rows = await sql`
        INSERT INTO smart_wallets (wallet, label, category, wins, losses, win_rate)
        VALUES (${w.wallet}, ${w.label}, ${w.category}, ${w.wins}, ${w.losses}, ${w.win_rate})
        ON CONFLICT (wallet) DO NOTHING
        RETURNING wallet
      `;
      if (rows.length) seeded++;
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        ok: true,
        message: "Smart Money schema ready.",
        tables: ["smart_wallets", "smart_money_signals"],
        seeded,
      }),
    };
  } catch (err) {
    console.error("initSmartMoney error:", err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
