// netlify/functions/hotTokens.js
// POST /.netlify/functions/hotTokens
// Body: { mints: ["mint1","mint2",...] }
//
// Updates the hot_tokens table so warmCache knows which mints to keep warm.
// Called automatically from the frontend whenever the watchlist / favorites change.

const { getDb, CORS, CORS_429, isRateLimitedRedis } = require("./db");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  // Rate limit: 30 requests per 10 s per IP
  const ip = (event.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (await isRateLimitedRedis(ip, 30, 10, "hot")) {
    return { statusCode: 429, headers: CORS_429, body: JSON.stringify({ error: "Too many requests — slow down." }) };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "POST only" }) };
  }

  let mints;
  try {
    ({ mints } = JSON.parse(event.body || "{}"));
    if (!Array.isArray(mints) || !mints.length) throw new Error("mints must be a non-empty array");
    if (mints.length > 100) mints = mints.slice(0, 100); // safety cap
  } catch (e) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }

  try {
    const sql = getDb();

    // Auto-create table if it doesn't exist yet (safe to call every time)
    await sql`
      CREATE TABLE IF NOT EXISTS hot_tokens (
        mint        TEXT PRIMARY KEY,
        rank        INTEGER NOT NULL DEFAULT 99,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    // Upsert with rank = position in array (lower = hotter)
    for (let i = 0; i < mints.length; i++) {
      const mint = mints[i];
      if (typeof mint !== "string" || mint.length < 10) continue;
      await sql`
        INSERT INTO hot_tokens (mint, rank, updated_at)
        VALUES (${mint}, ${i + 1}, NOW())
        ON CONFLICT (mint) DO UPDATE
          SET rank = ${i + 1}, updated_at = NOW()
      `;
    }

    // Remove mints that are no longer in the list (keeps table lean)
    // Note: use ANY() array syntax — NOT IN with ${sql(mints)} is not supported by Neon client
    await sql`
      DELETE FROM hot_tokens
      WHERE NOT (mint = ANY(${mints}))
    `;

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ ok: true, count: mints.length }),
    };
  } catch (e) {
    console.error("hotTokens error:", e);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ ok: false, error: e.message }),
    };
  }
};
