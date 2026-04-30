/* ================================================================
   Scan2Moon -- Self-Service API Key Generation
   POST /.netlify/functions/selfServeKey
   Body: { email, plan? }

   Generates a starter API key instantly and returns it in the
   response. No admin secret needed. No waiting 24 hours.

   Abuse prevention:
     - Max 3 active keys per email address (enforced atomically in DB)
     - Max 5 requests per IP per hour (Redis)
     - Email format validation
     - Disposable / throwaway email domain blocklist
     - plan is locked to "starter" (upgrade via upgradeKey / admin)
   ================================================================ */

const { getDb, redisGet, redisSet, isRateLimitedRedis, PLAN_DAILY } = require("./db");
const { sendKeyEmail } = require("./email");

const CORS = {
  "Content-Type":                 "application/json",
  "Access-Control-Allow-Origin":  process.env.ALLOWED_ORIGIN || "https://scan2moon.com",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_KEYS_PER_EMAIL = 3;

/* Disposable / throwaway email domains — blocks key-limit bypass via burner emails */
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamailblock.com",
  "10minutemail.com", "10minutemail.net", "10minutemail.org",
  "tempmail.com", "tempmail.net", "tempmail.org",
  "throwam.com", "throwam.net",
  "yopmail.com", "yopmail.fr",
  "sharklasers.com", "guerrillamail.info", "grr.la", "guerrillamail.biz",
  "spam4.me", "trashmail.com", "trashmail.me", "trashmail.net",
  "dispostable.com", "mailnull.com", "spamgourmet.com",
  "maildrop.cc", "discard.email", "fakeinbox.com",
  "nwytg.net", "crapmail.org", "mt2015.com",
  "spamfree24.org", "spamfree.eu", "binkmail.com",
  "bob.email", "egosilla.com", "filzmail.com",
  "getairmail.com", "ieh-mail.de", "jetable.fr.nf",
  "killmail.com", "kurzepost.de", "my10minutemail.com",
  "objectmail.com", "obobbo.com", "rcpt.at",
  "sofimail.com", "suremail.info", "thisisnotmyrealemail.com",
  "trbvm.com", "veryrealemail.com", "wegwerfmail.de",
  "zippymail.info",
]);

function generateKey() {
  var bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  var hex = Array.from(bytes).map(function(b) {
    return b.toString(16).padStart(2, "0");
  }).join("");
  return "s2m_" + hex;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST")
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Method not allowed" }) };

  /* IP rate limit: max 5 key generations per IP per hour */
  const ip = (
    event.headers["x-nf-client-connection-ip"] ||
    event.headers["x-forwarded-for"] ||
    "unknown"
  ).split(",")[0].trim();

  const rlKey = "selfserve:ip:" + ip;
  try {
    const rlRes = await fetch(
      (process.env.UPSTASH_REDIS_REST_URL || "") + "/incr/" + encodeURIComponent(rlKey),
      { headers: { Authorization: "Bearer " + (process.env.UPSTASH_REDIS_REST_TOKEN || "") }, signal: AbortSignal.timeout(1500) }
    );
    if (rlRes.ok) {
      const { result: count } = await rlRes.json();
      if (count === 1) {
        /* First request — set 1-hour expiry */
        await fetch(
          (process.env.UPSTASH_REDIS_REST_URL || "") + "/expire/" + encodeURIComponent(rlKey) + "/3600",
          { headers: { Authorization: "Bearer " + (process.env.UPSTASH_REDIS_REST_TOKEN || "") }, signal: AbortSignal.timeout(1500) }
        );
      }
      if (count > 5) {
        return { statusCode: 429, headers: CORS, body: JSON.stringify({ error: "Too many key requests from this IP. Try again in an hour." }) };
      }
    }
  } catch (e) { /* Redis down — proceed */ }

  /* Parse body */
  var body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  var email = (body.email || "").trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Valid email address required" }) };
  }

  /* Block disposable / throwaway email domains */
  var emailDomain = email.split("@")[1] || "";
  if (DISPOSABLE_DOMAINS.has(emailDomain)) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Disposable email addresses are not accepted. Please use a real email." }) };
  }

  /* Self-serve always creates starter keys; upgrade via admin */
  var plan = "starter";

  var sql = getDb();

  /* Generate and insert atomically — CTE prevents TOCTOU race on the per-email key limit.
     The INSERT only fires if the live count is still below MAX_KEYS_PER_EMAIL.
     If two requests race, only one gets a RETURNING row; the other gets 0 rows → 409. */
  var keyId = generateKey();
  var note  = "self-serve via api-portal";
  var inserted;

  try {
    inserted = await sql(
      `WITH active_count AS (
         SELECT COUNT(*)::int AS cnt FROM api_keys WHERE email = $2 AND active = true
       )
       INSERT INTO api_keys (key_id, email, plan, note)
       SELECT $1, $2, $3, $4 FROM active_count WHERE cnt < $5
       RETURNING key_id`,
      [keyId, email, plan, note, MAX_KEYS_PER_EMAIL]
    );
  } catch (e) {
    console.error("[selfServeKey] DB insert error:", e.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "Database error. Please try again." }) };
  }

  if (!inserted || inserted.length === 0) {
    return {
      statusCode: 409,
      headers: CORS,
      body: JSON.stringify({
        error: "This email already has the maximum of " + MAX_KEYS_PER_EMAIL + " active keys. Contact us on X to manage your keys.",
      }),
    };
  }

  console.log("[selfServeKey] Created key for", email);

  const dailyLimit = PLAN_DAILY[plan] || 1000;

  /* Send key by email — fire-and-forget, never block the response */
  sendKeyEmail({ to: email, keyId, plan, planLabel: "Starter", dailyLimit, action: "created" })
    .catch(function(e) { console.warn("[selfServeKey] email failed:", e.message); });

  return {
    statusCode: 201,
    headers: CORS,
    body: JSON.stringify({
      ok:         true,
      keyId:      keyId,
      email:      email,
      plan:       plan,
      dailyLimit: dailyLimit,
      message:    "Your API key is ready. We also sent it to " + email + " — save it, we cannot recover lost keys.",
    }),
  };
};
