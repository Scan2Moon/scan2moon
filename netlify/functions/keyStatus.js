/* ================================================================
   Scan2Moon -- Key Status
   GET /.netlify/functions/keyStatus
     ?apiKey=s2m_...   OR   X-Api-Key: s2m_...

   Returns plan, quota, daily usage, reset time, and all-time stats
   for the supplied API key. The key itself proves ownership — no
   other auth needed.

   Response includes standard rate-limit headers.
   Cache: none (always live from Postgres).
   ================================================================ */

const { getDb, PLAN_DAILY, CORS_API } = require("./db");
const { redisGet, redisSet } = require("./db");

const KEY_RE = /^s2m_[0-9a-f]{32}$/;

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS_API, body: "" };
  if (event.httpMethod !== "GET")
    return { statusCode: 405, headers: CORS_API, body: JSON.stringify({ error: "Method not allowed" }) };

  /* Accept key via header or query param */
  const keyId = (
    (event.headers && (event.headers["x-api-key"] || event.headers["X-Api-Key"])) ||
    (event.queryStringParameters && event.queryStringParameters.apiKey) ||
    ""
  ).trim();

  if (!keyId || !KEY_RE.test(keyId))
    return { statusCode: 400, headers: CORS_API, body: JSON.stringify({ error: "Valid API key required (s2m_ + 32 hex chars)" }) };

  /* Light rate limit on this endpoint itself: 20 checks/min per IP */
  const rlIp = (
    event.headers["x-nf-client-connection-ip"] ||
    event.headers["x-forwarded-for"] ||
    "unknown"
  ).split(",")[0].trim();
  const rlRedisKey = "ks:rl:ip:" + rlIp;
  try {
    const rlUrl = process.env.UPSTASH_REDIS_REST_URL;
    const rlTok = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (rlUrl && rlTok) {
      const incr = await fetch(rlUrl + "/incr/" + encodeURIComponent(rlRedisKey), {
        headers: { Authorization: "Bearer " + rlTok },
        signal: AbortSignal.timeout(1500),
      });
      if (incr.ok) {
        const { result: cnt } = await incr.json();
        if (cnt === 1) {
          await fetch(rlUrl + "/expire/" + encodeURIComponent(rlRedisKey) + "/60", {
            headers: { Authorization: "Bearer " + rlTok },
            signal: AbortSignal.timeout(1500),
          });
        }
        if (cnt > 20)
          return { statusCode: 429, headers: CORS_API, body: JSON.stringify({ error: "Too many status checks. Wait a minute." }) };
      }
    }
  } catch (e) { /* Redis down — proceed */ }

  /* Fetch key from Postgres */
  const sql = getDb();
  let row;
  try {
    const rows = await sql(
      `SELECT key_id, email, plan, active,
              daily_requests, daily_reset,
              total_requests, last_used_at, created_at, renews_at
       FROM api_keys WHERE key_id = $1`,
      [keyId]
    );
    row = rows[0];
  } catch (e) {
    console.error("[keyStatus] DB error:", e.message);
    return { statusCode: 500, headers: CORS_API, body: JSON.stringify({ error: "Database error" }) };
  }

  if (!row)
    return { statusCode: 404, headers: CORS_API, body: JSON.stringify({ error: "API key not found." }) };
  if (!row.active)
    return { statusCode: 401, headers: CORS_API, body: JSON.stringify({ error: "API key has been revoked." }) };

  /* Quota calculation */
  const limit     = PLAN_DAILY[row.plan] || 1000;
  const today     = new Date().toISOString().slice(0, 10);
  const resetDay  = row.daily_reset ? String(row.daily_reset).slice(0, 10) : null;
  const dailyUsed = resetDay === today ? (row.daily_requests || 0) : 0;
  const remaining = Math.max(0, limit - dailyUsed);

  /* Next reset = midnight UTC tomorrow */
  const now      = new Date();
  const resetsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));

  /* Mask email: dev@example.com → d****@example.com */
  const email = row.email || "";
  const emailMasked = email.replace(
    /^(.)(.*)(@.*)$/,
    (_, first, mid, domain) => first + "*".repeat(Math.min(mid.length, 4)) + domain
  );

  /* Partially mask key: s2m_a1b2c3d4...f6 */
  const keyMasked = keyId.slice(0, 8) + "..." + keyId.slice(-4);

  const headers = Object.assign({}, CORS_API, {
    "X-RateLimit-Limit":     String(limit),
    "X-RateLimit-Remaining": String(remaining),
    "X-RateLimit-Reset":     String(Math.floor(resetsAt.getTime() / 1000)),
  });

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      ok:            true,
      keyId:         keyMasked,
      email:         emailMasked,
      plan:          row.plan,
      active:        row.active,
      dailyLimit:    limit,
      dailyUsed:     dailyUsed,
      dailyRemaining: remaining,
      resetsAt:      resetsAt.toISOString(),
      totalRequests:    row.total_requests || 0,
      lastUsedAt:       row.last_used_at   || null,
      createdAt:        row.created_at     || null,
      renewsAt:         row.renews_at      || null,
      daysUntilExpiry:  row.renews_at
        ? Math.max(0, Math.ceil((new Date(row.renews_at) - new Date()) / 86400000))
        : null,
    }),
  };
};
