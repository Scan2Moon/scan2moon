/* ================================================================
   Scan2Moon -- Pro Key via USDC Payment
   POST /.netlify/functions/upgradeKey
   Body: { txSignature, email, existingKeyId? }

   User sends 49 USDC-SPL to the Scan2Moon Solana wallet,
   pastes the tx signature here, gets a Pro key instantly.

   Verification (Helius Enhanced Transactions):
     - Recipient = SOL_RECIPIENT
     - Token = USDC-SPL mint
     - Amount >= 49 USDC
     - Tx not already used (Redis double-spend check)
     - Tx age <= 48 hours (generous window for subscription payments)

   If existingKeyId provided -> upgrade that key to "pro"
   Otherwise -> create a new pro key for the email
   ================================================================ */

const { getDb, redisGet, redisSet, isRateLimitedRedis } = require("./db");
const { sendKeyEmail, sendReceiptEmail } = require("./email");

const CORS = {
  "Content-Type":                 "application/json",
  "Access-Control-Allow-Origin":  process.env.ALLOWED_ORIGIN || "https://scan2moon.com",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const SOL_RECIPIENT     = "2NYUevD2m8eRvHFsT3JvDy8poxiWNVEKXqnDvXWrZpyC";
const SOL_USDC_MINT     = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const MIN_PRICE_USDC    = 15.0;          /* minimum accepted payment */
const MAX_TX_AGE_SECS   = 48 * 3600;    /* 48-hour claim window */
const PLAN_BY_AMOUNT    = [
  { minUsd: 99 - 0.01,  plan: "power", dailyLimit: 100000, label: "Power" },
  { minUsd: 49 - 0.01,  plan: "pro",   dailyLimit: 25000,  label: "Pro"   },
  { minUsd: 15 - 0.01,  plan: "indie", dailyLimit: 3000,   label: "Indie" },
];
const EMAIL_RE        = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const KEY_RE          = /^s2m_[0-9a-f]{32}$/;
/* Solana tx signatures are 87–88 base58 characters. Anything else is not a real sig. */
const TX_SIG_RE       = /^[1-9A-HJ-NP-Za-km-z]{87,88}$/;

function generateKey() {
  var bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return "s2m_" + Array.from(bytes).map(function(b) {
    return b.toString(16).padStart(2, "0");
  }).join("");
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST")
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Method not allowed" }) };

  /* IP rate limit: max 5 upgrade attempts per IP per hour */
  var ip = (
    event.headers["x-nf-client-connection-ip"] ||
    event.headers["x-forwarded-for"] ||
    "unknown"
  ).split(",")[0].trim();

  if (await isRateLimitedRedis("upgrade:ip:" + ip, 5, 3600)) {
    return { statusCode: 429, headers: CORS, body: JSON.stringify({ error: "Too many upgrade attempts from this IP. Try again in an hour." }) };
  }

  var body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  var txSig        = (body.txSignature || "").trim();
  var email        = (body.email       || "").trim().toLowerCase();
  var existingKey  = (body.existingKeyId || "").trim();

  if (!txSig || !TX_SIG_RE.test(txSig))
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid transaction signature. Solana signatures are 87–88 base58 characters." }) };
  if (!email || !EMAIL_RE.test(email))
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Valid email required" }) };

  /* -- Double-spend check -- fail CLOSED if Redis is unavailable -- */
  var spendKey = "upgrade:sol:" + txSig;
  try {
    var already = await redisGet(spendKey);
    if (already) return { statusCode: 409, headers: CORS, body: JSON.stringify({ error: "This transaction has already been used to claim a key." }) };
  } catch (e) {
    // Redis down -- reject rather than risk issuing duplicate keys
    console.error("[upgradeKey] Redis unavailable for double-spend check:", e.message);
    return {
      statusCode: 503,
      headers: CORS,
      body: JSON.stringify({
        error: "Payment verification temporarily unavailable. Please try again in 30 seconds.",
        retryAfter: 30,
      }),
    };
  }

  /* -- Verify payment via Helius -- */
  var HELIUS_KEY = process.env.HELIUS_KEY;
  if (!HELIUS_KEY)
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "Payment verification unavailable. Contact us on X." }) };

  var txData;
  try {
    var hRes = await fetch(
      "https://api.helius.xyz/v0/transactions?api-key=" + HELIUS_KEY,
      {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ transactions: [txSig] }),
        signal:  AbortSignal.timeout(10000),
      }
    );
    if (!hRes.ok) throw new Error("Helius returned " + hRes.status);
    var txList = await hRes.json();
    txData = Array.isArray(txList) ? txList[0] : null;
  } catch (e) {
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: "Could not verify transaction: " + e.message }) };
  }

  if (!txData)
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Transaction not found on Solana. Make sure it is confirmed on mainnet." }) };

  /* -- Age check: <= 48 hours -- */
  var ageSecs = Math.floor(Date.now() / 1000) - (txData.timestamp || 0);
  if (ageSecs > MAX_TX_AGE_SECS)
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Transaction is too old (must be within 48 hours). Please make a fresh payment." }) };
  if (ageSecs < 0)
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Transaction timestamp is in the future." }) };

  /* -- Find valid USDC-SPL transfer to our wallet -- */
  var transfers = Array.isArray(txData.tokenTransfers) ? txData.tokenTransfers : [];
  var match = null;
  for (var i = 0; i < transfers.length; i++) {
    var t = transfers[i];
    if (
      t.mint === SOL_USDC_MINT &&
      t.toUserAccount === SOL_RECIPIENT &&
      parseFloat(t.tokenAmount || 0) >= MIN_PRICE_USDC - 0.01 /* tiny rounding tolerance */
    ) {
      match = t;
      break;
    }
  }

  if (!match) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({
        error: "No valid USDC transfer of >= $" + MIN_PRICE_USDC + " to Scan2Moon wallet found in this transaction.",
        hint:  "Recipient must be " + SOL_RECIPIENT + " and token must be USDC-SPL.",
      }),
    };
  }

  var amountPaid = parseFloat(match.tokenAmount);

  /* -- Resolve plan tier from amount paid -- */
  var tier = null;
  for (var pi = 0; pi < PLAN_BY_AMOUNT.length; pi++) {
    if (amountPaid >= PLAN_BY_AMOUNT[pi].minUsd) {
      tier = PLAN_BY_AMOUNT[pi];
      break;
    }
  }
  if (!tier) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Amount paid ($" + amountPaid.toFixed(2) + ") is below the minimum $" + MIN_PRICE_USDC + " required." }) };
  }

  /* -- Mark tx as used (365-day TTL -- prevents reuse well past any subscription period) -- */
  try { await redisSet(spendKey, "1", 365 * 86400); } catch (e) {}

  /* -- Create or upgrade key -- */
  var sql = getDb();
  var keyId;
  var action;

  try {
    /* renews_at = 30 days from now for all paid tiers */
    var renewsAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

    if (existingKey && KEY_RE.test(existingKey)) {
      /* Upgrade existing key in-place -- also reset renews_at for renewals */
      var rows = await sql(
        "UPDATE api_keys SET plan = $3, renews_at = $4 WHERE key_id = $1 AND email = $2 AND active = true RETURNING key_id",
        [existingKey, email, tier.plan, renewsAt]
      );
      if (rows.length === 0) {
        /* M-5: return 403 (Forbidden) not 404 on email/key mismatch */
        return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: "Key not found or email does not match. Leave the key field empty to create a new key." }) };
      }
      keyId  = existingKey;
      action = "upgraded";
    } else {
      /* Create new key at resolved tier */
      keyId = generateKey();
      await sql(
        "INSERT INTO api_keys (key_id, email, plan, note, renews_at) VALUES ($1, $2, $3, $4, $5)",
        [keyId, email, tier.plan, tier.plan + " via usdc tx:" + txSig.slice(0, 20), renewsAt]
      );
      action = "created";
    }
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "Database error: " + e.message }) };
  }

  console.log("[upgradeKey]", tier.label, "key", action, "for", email, "- paid $" + amountPaid + " USDC, tx:", txSig.slice(0, 20));

  /* Send key email + receipt -- both fire-and-forget */
  sendKeyEmail({ to: email, keyId, plan: tier.plan, planLabel: tier.label, dailyLimit: tier.dailyLimit, action })
    .catch(function(e) { console.warn("[upgradeKey] key email failed:", e.message); });
  sendReceiptEmail({ to: email, keyId, plan: tier.plan, planLabel: tier.label, dailyLimit: tier.dailyLimit, amountPaid, txSig, action, renewsAt })
    .catch(function(e) { console.warn("[upgradeKey] receipt email failed:", e.message); });

  return {
    statusCode: 201,
    headers: CORS,
    body: JSON.stringify({
      ok:         true,
      action:     action,
      keyId:      keyId,
      email:      email,
      plan:       tier.plan,
      planLabel:  tier.label,
      dailyLimit: tier.dailyLimit,
      amountPaid: amountPaid,
      renewsAt:   renewsAt,
      message:    tier.label + " key " + action + ". Save it -- we cannot recover lost keys.",
    }),
  };
};
