/* ================================================================
   Scan2Moon -- Daily Renewal Checker
   Scheduled: runs once per day at 08:00 UTC via netlify.toml

   Two passes:
     1. REMINDER — keys expiring in exactly 7 days → send warning email
     2. EXPIRY   — keys past renews_at → downgrade to starter + expiry email

   Safe to run multiple times (reminder uses a Redis flag to avoid
   duplicate emails; expiry only touches plans != 'starter').
   ================================================================ */

const { getDb, PLAN_DAILY }                          = require("./db");
const { sendRenewalReminderEmail, sendExpiryEmail }  = require("./email");

/* Upstash Redis helpers (inline — avoids circular dep) */
async function redisGet(key) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const tok = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !tok) return null;
  const r = await fetch(url + "/get/" + encodeURIComponent(key), {
    headers: { Authorization: "Bearer " + tok }, signal: AbortSignal.timeout(2000),
  });
  if (!r.ok) return null;
  const j = await r.json();
  return j.result;
}
async function redisSet(key, val, ttlSecs) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const tok = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !tok) return;
  await fetch(url + "/set/" + encodeURIComponent(key) + "/" + encodeURIComponent(val) + "/ex/" + ttlSecs, {
    headers: { Authorization: "Bearer " + tok }, signal: AbortSignal.timeout(2000),
  });
}

exports.handler = async (event) => {
  /* Block direct HTTP calls — only the Netlify scheduler (no httpMethod) or
     an authorised manual trigger (X-Cron-Secret header) may run this. */
  const CRON_SECRET = process.env.CRON_SECRET;
  if (event?.httpMethod) {
    const auth = (event?.headers?.["x-cron-secret"] || "").trim();
    if (!CRON_SECRET || auth !== CRON_SECRET) {
      return { statusCode: 403, body: JSON.stringify({ error: "Forbidden" }) };
    }
  }

  const sql     = getDb();
  const now     = new Date();
  const summary = { reminders: 0, expired: 0, errors: [] };

  /* ── PASS 1: Reminder — expiring in 6–8 days (catches "7 days out") ── */
  try {
    const soon = await sql(
      `SELECT key_id, email, plan, renews_at
       FROM api_keys
       WHERE active = true
         AND plan != 'starter'
         AND renews_at BETWEEN NOW() + INTERVAL '6 days'
                           AND NOW() + INTERVAL '8 days'`
    );

    for (const row of soon) {
      /* Dedupe: only send one reminder per key */
      const flagKey = "renewal:reminded:" + row.key_id;
      const already = await redisGet(flagKey);
      if (already) continue;

      const daysLeft = Math.ceil((new Date(row.renews_at) - now) / 86400000);
      const limit    = PLAN_DAILY[row.plan] || 25000;

      await sendRenewalReminderEmail({
        to:         row.email,
        keyId:      row.key_id,
        plan:       row.plan,
        planLabel:  row.plan.charAt(0).toUpperCase() + row.plan.slice(1),
        dailyLimit: limit,
        daysLeft,
        renewsAt:   row.renews_at,
      }).catch(e => summary.errors.push("reminder " + row.key_id + ": " + e.message));

      /* Flag for 10 days so we don't spam */
      await redisSet(flagKey, "1", 10 * 86400);
      summary.reminders++;
    }
  } catch (e) {
    summary.errors.push("reminder query: " + e.message);
  }

  /* ── PASS 2: Expiry — downgrade overdue paid keys ── */
  try {
    /* Step 1: read old plan BEFORE update — RETURNING gives post-update value in Postgres */
    const toExpire = await sql(
      `SELECT key_id, email, plan
       FROM api_keys
       WHERE active = true
         AND plan != 'starter'
         AND renews_at < NOW()`
    );

    if (toExpire.length > 0) {
      /* Step 2: atomic bulk downgrade */
      const ids = toExpire.map(r => r.key_id);
      await sql(
        `UPDATE api_keys SET plan = 'starter' WHERE key_id = ANY($1::text[])`,
        [ids]
      );

      /* Step 3: send expiry emails with correct old plan name */
      for (const row of toExpire) {
        const planLabel = row.plan.charAt(0).toUpperCase() + row.plan.slice(1);
        await sendExpiryEmail({
          to:        row.email,
          keyId:     row.key_id,
          plan:      row.plan,
          planLabel: planLabel,
        }).catch(e => summary.errors.push("expiry " + row.key_id + ": " + e.message));

        summary.expired++;
        console.log("[checkRenewals] Downgraded", row.key_id, "(was " + row.plan + ") for", row.email);
      }
    }
  } catch (e) {
    summary.errors.push("expiry query: " + e.message);
  }

  console.log("[checkRenewals] Done —", summary.reminders, "reminders,", summary.expired, "expired");

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, ...summary }),
  };
};
