/* ================================================================
   Scan2Moon -- Self-Service Key Revocation
   POST /.netlify/functions/revokeMyKey
   Body: { keyId, confirm }

   The key itself proves ownership — no password needed.
   Knowing the key IS the proof; that's why we tell users to keep it secret.

   Abuse prevention:
     - Key must match s2m_ format
     - confirm field must equal "REVOKE" (prevents accidents)
     - Key is set active=false (not deleted — audit trail preserved)
     - Confirmation email sent to the email on file
     - Rate limited: 3 revocations per IP per hour (prevents enumeration)
   ================================================================ */

const { getDb } = require("./db");
const { sendRevokeEmail } = require("./email");

const CORS = {
  "Content-Type":                 "application/json",
  "Access-Control-Allow-Origin":  process.env.ALLOWED_ORIGIN || "https://scan2moon.com",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const KEY_RE = /^s2m_[0-9a-f]{32}$/;

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST")
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Method not allowed" }) };

  /* ── IP rate limit: 3 revocations per IP per hour ── */
  const ip = (
    event.headers["x-nf-client-connection-ip"] ||
    event.headers["x-forwarded-for"] ||
    "unknown"
  ).split(",")[0].trim();

  const rlKey = "revoke:ip:" + ip;
  try {
    const rlUrl = process.env.UPSTASH_REDIS_REST_URL;
    const rlTok = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (rlUrl && rlTok) {
      const incr = await fetch(rlUrl + "/incr/" + encodeURIComponent(rlKey), {
        headers: { Authorization: "Bearer " + rlTok },
        signal: AbortSignal.timeout(1500),
      });
      if (incr.ok) {
        const { result: cnt } = await incr.json();
        if (cnt === 1) {
          await fetch(rlUrl + "/expire/" + encodeURIComponent(rlKey) + "/3600", {
            headers: { Authorization: "Bearer " + rlTok },
            signal: AbortSignal.timeout(1500),
          });
        }
        if (cnt > 3)
          return { statusCode: 429, headers: CORS, body: JSON.stringify({ error: "Too many revocation requests. Try again in an hour." }) };
      }
    }
  } catch (e) { /* Redis down — proceed */ }

  /* ── Parse body ── */
  var body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  var keyId   = (body.keyId   || "").trim();
  var confirm = (body.confirm || "").trim();

  if (!keyId || !KEY_RE.test(keyId))
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Valid API key required (s2m_ + 32 hex chars)" }) };

  if (confirm !== "REVOKE")
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Pass confirm:"REVOKE" to confirm revocation.' }) };

  /* ── Revoke in DB ── */
  const sql = getDb();
  var row;
  try {
    var rows = await sql(
      "UPDATE api_keys SET active = false WHERE key_id = $1 AND active = true RETURNING key_id, email, plan",
      [keyId]
    );
    row = rows[0];
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "Database error: " + e.message }) };
  }

  if (!row) {
    /* Key not found OR already revoked — same response to prevent enumeration */
    return {
      statusCode: 404,
      headers: CORS,
      body: JSON.stringify({ error: "Key not found or already revoked." }),
    };
  }

  console.log("[revokeMyKey] Revoked", keyId, "for", row.email);

  /* ── Send confirmation email — fire-and-forget ── */
  const planLabel = row.plan.charAt(0).toUpperCase() + row.plan.slice(1);
  sendRevokeEmail({ to: row.email, keyId, plan: row.plan, planLabel })
    .catch(function(e) { console.warn("[revokeMyKey] email failed:", e.message); });

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({
      ok:      true,
      keyId:   keyId.slice(0, 8) + "..." + keyId.slice(-4),
      message: "Key revoked. It will no longer accept requests. A confirmation was sent to the email on file.",
    }),
  };
};
