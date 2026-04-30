/* ================================================================
   Scan2Moon -- Admin Key Management
   ALL methods require header:  X-Admin-Secret: <ADMIN_SECRET env>

   Actions
   ───────
   GET  ?action=list   [&email=] [&plan=] [&active=true|false]
        → paginated list of keys (max 100)

   GET  ?action=get&keyId=s2m_...
        → single key details

   POST { action:"create",  email, plan, note? }
        → create key (any plan, for enterprise deals etc.)

   POST { action:"upgrade", keyId, plan }
        → change plan on existing key

   POST { action:"revoke",  keyId }
        → set active=false

   POST { action:"reactivate", keyId }
        → set active=true

   POST { action:"reset-usage", keyId }
        → zero out daily_requests (useful after a bug)

   POST { action:"delete", keyId }
        → hard-delete (irreversible — use with care)
   ================================================================ */

const { getDb, PLAN_DAILY, isRateLimitedRedis } = require("./db");

const CORS = {
  "Content-Type":                 "application/json",
  "Access-Control-Allow-Origin":  process.env.ALLOWED_ORIGIN || "https://scan2moon.com",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Admin-Secret",
};

const VALID_PLANS = Object.keys(PLAN_DAILY);
const KEY_RE      = /^s2m_[0-9a-f]{32}$/;
const EMAIL_RE    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function generateKey() {
  var bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return "s2m_" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS")
    return { statusCode: 204, headers: CORS, body: "" };

  /* ── Rate limit: 10 attempts per IP per minute (brute-force protection) ── */
  const ip = (
    event.headers["x-nf-client-connection-ip"] ||
    event.headers["x-forwarded-for"] ||
    "unknown"
  ).split(",")[0].trim();

  if (await isRateLimitedRedis(ip, 10, 60)) {
    return {
      statusCode: 429,
      headers: { ...CORS, "Retry-After": "60" },
      body: JSON.stringify({ error: "Too many requests. Try again in 60 seconds." }),
    };
  }

  /* ── Auth ── */
  const secret = (event.headers["x-admin-secret"] || "").trim();
  const ADMIN_SECRET = process.env.ADMIN_SECRET || "";
  if (!ADMIN_SECRET)
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "ADMIN_SECRET env var not set." }) };
  if (!secret || secret !== ADMIN_SECRET)
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: "Unauthorized." }) };

  const sql     = getDb();
  const isGet   = event.httpMethod === "GET";
  const isPost  = event.httpMethod === "POST";
  const qp      = event.queryStringParameters || {};
  const action  = isGet ? (qp.action || "list") : null;

  /* ════════════════════════════════════════════════════════════
     GET actions
     ════════════════════════════════════════════════════════════ */
  if (isGet) {

    /* ── LIST ── */
    if (action === "list") {
      var conditions = [];
      var params     = [];

      if (qp.email) {
        params.push(qp.email.toLowerCase());
        conditions.push("email = $" + params.length);
      }
      if (qp.plan && VALID_PLANS.includes(qp.plan)) {
        params.push(qp.plan);
        conditions.push("plan = $" + params.length);
      }
      if (qp.active !== undefined) {
        params.push(qp.active === "true");
        conditions.push("active = $" + params.length);
      }

      var where  = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
      var offset = Math.max(0, parseInt(qp.offset || "0", 10));
      var limit  = Math.min(100, Math.max(1, parseInt(qp.limit  || "50",  10)));

      params.push(limit);
      params.push(offset);

      try {
        var rows = await sql(
          `SELECT key_id, email, plan, active, daily_requests, daily_reset,
                  total_requests, last_used_at, created_at, note
           FROM api_keys ${where}
           ORDER BY created_at DESC
           LIMIT $${params.length - 1} OFFSET $${params.length}`,
          params
        );

        var countRows = await sql(
          `SELECT COUNT(*)::int AS total FROM api_keys ${where}`,
          params.slice(0, params.length - 2)   /* strip LIMIT/OFFSET */
        );

        return {
          statusCode: 200,
          headers: CORS,
          body: JSON.stringify({
            ok:     true,
            total:  countRows[0] ? countRows[0].total : 0,
            offset: offset,
            limit:  limit,
            keys:   rows,
          }),
        };
      } catch (e) {
        return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "DB error: " + e.message }) };
      }
    }

    /* ── GET single key ── */
    if (action === "get") {
      var keyId = (qp.keyId || "").trim();
      if (!keyId || !KEY_RE.test(keyId))
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Valid keyId required." }) };

      try {
        var rows = await sql(
          `SELECT key_id, email, plan, active, daily_requests, daily_reset,
                  total_requests, last_used_at, created_at, note
           FROM api_keys WHERE key_id = $1`,
          [keyId]
        );
        if (!rows[0])
          return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: "Key not found." }) };
        return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, key: rows[0] }) };
      } catch (e) {
        return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "DB error: " + e.message }) };
      }
    }

    /* ── STATS summary ── */
    if (action === "stats") {
      try {
        var byPlan = await sql(
          `SELECT
             plan,
             COUNT(*)::int                               AS total,
             COUNT(*) FILTER (WHERE active = true)::int AS active,
             SUM(total_requests)::bigint                 AS all_time_requests
           FROM api_keys
           GROUP BY plan
           ORDER BY plan`
        );
        var agg = await sql(
          `SELECT
             COUNT(*)::int                                                     AS total,
             COUNT(*) FILTER (WHERE active = true)::int                       AS active,
             SUM(total_requests)::bigint                                       AS total_requests,
             SUM(daily_requests)::int                                          AS daily_requests,
             COUNT(*) FILTER (
               WHERE active = true AND plan != 'starter'
               AND renews_at BETWEEN NOW() AND NOW() + INTERVAL '7 days'
             )::int                                                            AS expiring_in_7_days,
             COUNT(*) FILTER (
               WHERE active = true AND plan != 'starter'
               AND renews_at < NOW()
             )::int                                                            AS expired
           FROM api_keys`
        );
        var g = agg[0] || {};
        /* Build per-plan counts */
        var planMap = {};
        byPlan.forEach(function(r) { planMap[r.plan] = r; });

        return {
          statusCode: 200,
          headers: CORS,
          body: JSON.stringify({
            ok: true,
            stats: {
              total:           g.total            || 0,
              active:          g.active           || 0,
              pro:             (planMap.pro   && planMap.pro.active)   || 0,
              power:           (planMap.power && planMap.power.active) || 0,
              starter:         (planMap.starter && planMap.starter.active) || 0,
              totalRequests:   Number(g.total_requests)  || 0,
              dailyRequests:   g.daily_requests   || 0,
              expiringIn7Days: g.expiring_in_7_days || 0,
              expired:         g.expired          || 0,
            },
            byPlan: byPlan,
          }),
        };
      } catch (e) {
        return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "DB error: " + e.message }) };
      }
    }

    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Unknown action. Valid: list, get, stats" }) };
  }

  /* ════════════════════════════════════════════════════════════
     POST actions
     ════════════════════════════════════════════════════════════ */
  if (isPost) {
    var body;
    try { body = JSON.parse(event.body || "{}"); }
    catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid JSON" }) }; }

    var act = (body.action || "").trim();

    /* ── CREATE ── */
    if (act === "create") {
      var email = (body.email || "").trim().toLowerCase();
      var plan  = (body.plan  || "starter").trim().toLowerCase();
      var note  = (body.note  || "admin-created").trim();

      if (!email || !EMAIL_RE.test(email))
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Valid email required." }) };
      if (!VALID_PLANS.includes(plan))
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid plan. Valid: " + VALID_PLANS.join(", ") }) };

      var keyId = generateKey();
      try {
        await sql(
          "INSERT INTO api_keys (key_id, email, plan, note) VALUES ($1, $2, $3, $4)",
          [keyId, email, plan, note]
        );
        console.log("[adminKey] Created", plan, "key for", email);
        return {
          statusCode: 201,
          headers: CORS,
          body: JSON.stringify({ ok: true, action: "created", keyId, email, plan, dailyLimit: PLAN_DAILY[plan] }),
        };
      } catch (e) {
        return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "DB error: " + e.message }) };
      }
    }

    /* ── UPGRADE (change plan) ── */
    if (act === "upgrade") {
      var keyId = (body.keyId || "").trim();
      var plan  = (body.plan  || "").trim().toLowerCase();
      if (!keyId || !KEY_RE.test(keyId))
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Valid keyId required." }) };
      if (!VALID_PLANS.includes(plan))
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid plan. Valid: " + VALID_PLANS.join(", ") }) };

      try {
        var rows = await sql(
          "UPDATE api_keys SET plan = $2 WHERE key_id = $1 RETURNING key_id, email, plan",
          [keyId, plan]
        );
        if (!rows[0])
          return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: "Key not found." }) };
        console.log("[adminKey] Upgraded", keyId, "to", plan);
        return {
          statusCode: 200,
          headers: CORS,
          body: JSON.stringify({ ok: true, action: "upgraded", keyId, email: rows[0].email, plan, dailyLimit: PLAN_DAILY[plan] }),
        };
      } catch (e) {
        return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "DB error: " + e.message }) };
      }
    }

    /* ── REVOKE ── */
    if (act === "revoke") {
      var keyId = (body.keyId || "").trim();
      if (!keyId || !KEY_RE.test(keyId))
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Valid keyId required." }) };

      try {
        var rows = await sql(
          "UPDATE api_keys SET active = false WHERE key_id = $1 RETURNING key_id, email",
          [keyId]
        );
        if (!rows[0])
          return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: "Key not found." }) };
        console.log("[adminKey] Revoked", keyId, "for", rows[0].email);
        return {
          statusCode: 200,
          headers: CORS,
          body: JSON.stringify({ ok: true, action: "revoked", keyId, email: rows[0].email }),
        };
      } catch (e) {
        return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "DB error: " + e.message }) };
      }
    }

    /* ── REACTIVATE ── */
    if (act === "reactivate") {
      var keyId = (body.keyId || "").trim();
      if (!keyId || !KEY_RE.test(keyId))
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Valid keyId required." }) };

      try {
        var rows = await sql(
          "UPDATE api_keys SET active = true WHERE key_id = $1 RETURNING key_id, email",
          [keyId]
        );
        if (!rows[0])
          return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: "Key not found." }) };
        return {
          statusCode: 200,
          headers: CORS,
          body: JSON.stringify({ ok: true, action: "reactivated", keyId, email: rows[0].email }),
        };
      } catch (e) {
        return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "DB error: " + e.message }) };
      }
    }

    /* ── RESET DAILY USAGE ── */
    if (act === "reset-usage") {
      var keyId = (body.keyId || "").trim();
      if (!keyId || !KEY_RE.test(keyId))
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Valid keyId required." }) };

      try {
        var rows = await sql(
          "UPDATE api_keys SET daily_requests = 0 WHERE key_id = $1 RETURNING key_id, email",
          [keyId]
        );
        if (!rows[0])
          return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: "Key not found." }) };
        return {
          statusCode: 200,
          headers: CORS,
          body: JSON.stringify({ ok: true, action: "usage-reset", keyId, email: rows[0].email }),
        };
      } catch (e) {
        return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "DB error: " + e.message }) };
      }
    }

    /* ── HARD DELETE ── */
    if (act === "delete") {
      var keyId  = (body.keyId  || "").trim();
      var confirm = (body.confirm || "").trim();
      if (!keyId || !KEY_RE.test(keyId))
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Valid keyId required." }) };
      if (confirm !== "DELETE")
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Pass confirm:"DELETE" to hard-delete a key.' }) };

      try {
        var rows = await sql(
          "DELETE FROM api_keys WHERE key_id = $1 RETURNING key_id, email",
          [keyId]
        );
        if (!rows[0])
          return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: "Key not found." }) };
        console.log("[adminKey] Hard-deleted", keyId, "for", rows[0].email);
        return {
          statusCode: 200,
          headers: CORS,
          body: JSON.stringify({ ok: true, action: "deleted", keyId, email: rows[0].email }),
        };
      } catch (e) {
        return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "DB error: " + e.message }) };
      }
    }

    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: "Unknown action. Valid: create, upgrade, revoke, reactivate, reset-usage, delete" }),
    };
  }

  return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Method not allowed" }) };
};
