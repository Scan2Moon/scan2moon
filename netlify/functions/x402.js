/* ================================================================
   Scan2Moon -- x402 Payment Module
   Shared by all proprietary endpoints.

   Supports two payment rails:
     1. x402 on Base  (EVM, USDC-Base, X-Payment header)
        Verified via Coinbase x402 facilitator (x402.org)
     2. Solana native  (USDC-SPL, X-Solana-Payment header)
        Verified via Helius Enhanced Transactions API

   Access resolution order:
     API key  ->  x402 Base payment  ->  Solana payment  ->  402 paywall

   NOTE: There is no browser-origin bypass. All access requires a valid
   API key or on-chain payment. Origin/Referer headers are client-supplied
   and trivially spoofable — never use them for access control.
   ================================================================ */

const { redisGet, redisSet, extractKey, validateApiKey, CORS_API } = require("./db");

/* ── Addresses ───────────────────────────────────────────────── */
const BASE_RECIPIENT  = "0x57fe97c1be493f100514aaa8ab1adda713ca5ffb";
const SOL_RECIPIENT   = "2NYUevD2m8eRvHFsT3JvDy8poxiWNVEKXqnDvXWrZpyC";
const BASE_USDC       = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; /* USDC on Base */
const SOL_USDC_MINT   = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; /* USDC-SPL */

/* ── x402 Facilitator (Coinbase) ─────────────────────────────── */
const FACILITATOR = "https://x402.org/facilitate";

/* ── Pricing (USDC, 6 decimals: $1 = 1000000 units) ─────────── */
const PRICES = {
  devWallet:             { units: 5000,  usd: 0.005, label: "Dev Wallet History"        },
  lpPredictor:           { units: 5000,  usd: 0.005, label: "LP Pull Predictor"         },
  smartMoneyLeaderboard: { units: 2000,  usd: 0.002, label: "Smart Money Leaderboard"   },
  bundle:                { units: 10000, usd: 0.010, label: "Bundle Attack Detector"    },
  newPairs:              { units: 1000,  usd: 0.001, label: "New Pairs Feed"            },
  batchRisk:             { units: 3000,  usd: 0.003, label: "Batch Risk Scores"         },
};

const SITE_URL = process.env.URL || "https://scan2moon.com";

/* ================================================================
   build402Body(endpointKey)
   Returns the JSON body to send with a 402 response.
   Includes both Base x402 and Solana payment instructions.
   ================================================================ */
function build402Body(endpointKey) {
  var p = PRICES[endpointKey] || PRICES.devWallet;
  var resource = SITE_URL + "/.netlify/functions/" + endpointKey;
  return {
    x402Version: 1,
    accepts: [
      {
        scheme:             "exact",
        network:            "base",
        maxAmountRequired:  String(p.units),
        resource:           resource,
        description:        p.label + " \u2014 Scan2Moon API",
        mimeType:           "application/json",
        payTo:              BASE_RECIPIENT,
        maxTimeoutSeconds:  300,
        asset:              BASE_USDC,
        extra:              { name: "USD Coin", version: "2" },
      },
    ],
    solana: {
      description:  p.label + " \u2014 Scan2Moon API (Solana native)",
      recipient:    SOL_RECIPIENT,
      asset:        "USDC-SPL",
      mint:         SOL_USDC_MINT,
      amountUnits:  p.units,
      amountUsd:    p.usd,
      network:      "mainnet-beta",
      instructions: [
        "1. Send exactly " + p.usd + " USDC-SPL to " + SOL_RECIPIENT,
        "2. Confirm the transaction on Solana mainnet",
        "3. Retry your request with header:  X-Solana-Payment: <tx_signature>",
      ],
    },
    error: "Payment required. Provide X-Payment (Base x402) or X-Solana-Payment (Solana USDC-SPL).",
  };
}

/* ================================================================
   verifyBasePayment(paymentHeader, endpointKey)
   Calls the Coinbase x402 facilitator to verify + settle.
   Returns { valid, payer, txHash, reason }
   ================================================================ */
async function verifyBasePayment(paymentHeader, endpointKey) {
  var p = PRICES[endpointKey] || PRICES.devWallet;
  var resource = SITE_URL + "/.netlify/functions/" + endpointKey;

  var requirements = {
    scheme:            "exact",
    network:           "base",
    maxAmountRequired: String(p.units),
    resource:          resource,
    description:       p.label + " \u2014 Scan2Moon API",
    mimeType:          "application/json",
    payTo:             BASE_RECIPIENT,
    maxTimeoutSeconds: 300,
    asset:             BASE_USDC,
    extra:             { name: "USD Coin", version: "2" },
  };

  /* -- Verify first ── */
  try {
    var vRes = await fetch(FACILITATOR + "/verify", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ payment: paymentHeader, paymentRequirements: requirements }),
      signal:  AbortSignal.timeout(8000),
    });

    var vBody = await vRes.json().catch(function() { return {}; });

    if (!vRes.ok || !vBody.isValid) {
      return { valid: false, reason: vBody.invalidReason || vBody.error || ("Facilitator rejected payment (HTTP " + vRes.status + ")") };
    }
  } catch (e) {
    return { valid: false, reason: "Could not reach payment facilitator: " + e.message };
  }

  /* -- Settle (triggers on-chain USDC transfer to our wallet) ── */
  try {
    var sRes = await fetch(FACILITATOR + "/settle", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ payment: paymentHeader, paymentRequirements: requirements }),
      signal:  AbortSignal.timeout(12000),
    });

    var sBody = await sRes.json().catch(function() { return {}; });

    if (!sRes.ok || !sBody.success) {
      /* Verification passed but settle failed — reject rather than serve free data.
         Log to Redis for manual reconciliation so we know what we're owed. */
      console.warn("[x402] settle failed for", endpointKey, ":", sBody.error || sRes.status);
      try {
        var unsettledKey = "x402:unsettled:" + Date.now() + ":" + Math.random().toString(36).slice(2);
        await redisSet(unsettledKey, JSON.stringify({
          endpointKey,
          payer:     sBody.payer  || "unknown",
          error:     sBody.error  || ("HTTP " + sRes.status),
          timestamp: new Date().toISOString(),
        }), 7 * 86400);
      } catch (_) {}
      return { valid: false, reason: "Payment settlement failed — funds may not have transferred. Please retry." };
    }

    return { valid: true, payer: sBody.payer || "unknown", txHash: sBody.transaction || null, settled: true };
  } catch (e) {
    /* Settle threw — same policy: reject, log it */
    console.warn("[x402] settle error:", e.message);
    try {
      var errKey = "x402:unsettled:" + Date.now() + ":" + Math.random().toString(36).slice(2);
      await redisSet(errKey, JSON.stringify({
        endpointKey,
        payer:     "unknown",
        error:     e.message,
        timestamp: new Date().toISOString(),
      }), 7 * 86400);
    } catch (_) {}
    return { valid: false, reason: "Payment settlement error — please retry in a moment." };
  }
}

/* ================================================================
   verifySolanaPayment(txSignature, endpointKey)
   Verifies an on-chain USDC-SPL payment via Helius.
   Returns { valid, reason }
   ================================================================ */
async function verifySolanaPayment(txSignature, endpointKey) {
  var sig = (txSignature || "").trim();
  if (!sig || sig.length < 40) {
    return { valid: false, reason: "Invalid transaction signature" };
  }

  /* Double-spend check — fail CLOSED if Redis is unavailable */
  var spendKey = "pmt:sol:" + sig;
  try {
    var alreadyUsed = await redisGet(spendKey);
    if (alreadyUsed) return { valid: false, reason: "Payment already used" };
  } catch (e) {
    // Redis down — reject rather than risk accepting a reused payment
    console.error("[x402] Redis unavailable for double-spend check:", e.message);
    return { valid: false, reason: "Payment verification temporarily unavailable — please retry in 30 seconds." };
  }

  var HELIUS_KEY = process.env.HELIUS_KEY;
  if (!HELIUS_KEY) return { valid: false, reason: "Helius key not configured" };

  /* Fetch parsed transaction from Helius Enhanced Transactions */
  var txData;
  try {
    var hRes = await fetch(
      "https://api.helius.xyz/v0/transactions?api-key=" + HELIUS_KEY,
      {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ transactions: [sig] }),
        signal:  AbortSignal.timeout(8000),
      }
    );
    if (!hRes.ok) return { valid: false, reason: "Helius returned " + hRes.status };
    var txList = await hRes.json();
    txData = Array.isArray(txList) ? txList[0] : null;
  } catch (e) {
    return { valid: false, reason: "Cannot verify transaction: " + e.message };
  }

  if (!txData) return { valid: false, reason: "Transaction not found on-chain" };

  /* Recency check: must be < 5 minutes old */
  var ageSecs = Date.now() / 1000 - (txData.timestamp || 0);
  if (ageSecs > 300) return { valid: false, reason: "Payment expired (transaction is > 5 minutes old)" };
  if (ageSecs < 0)   return { valid: false, reason: "Transaction timestamp is in the future" };

  /* Find a valid USDC-SPL transfer to our wallet */
  var required = PRICES[endpointKey] ? PRICES[endpointKey].usd : 0.001;
  var transfers = Array.isArray(txData.tokenTransfers) ? txData.tokenTransfers : [];

  var match = null;
  for (var i = 0; i < transfers.length; i++) {
    var t = transfers[i];
    if (
      t.mint === SOL_USDC_MINT &&
      (t.toUserAccount === SOL_RECIPIENT || t.toTokenAccount) &&
      parseFloat(t.tokenAmount || 0) >= required - 0.0001  /* tiny tolerance for rounding */
    ) {
      /* Extra check: toUserAccount OR derive from toTokenAccount */
      if (t.toUserAccount === SOL_RECIPIENT) {
        match = t;
        break;
      }
    }
  }

  if (!match) {
    return {
      valid: false,
      reason: "No valid USDC-SPL transfer of >= $" + required + " to Scan2Moon wallet found in this transaction",
    };
  }

  /* Mark as used in Redis (TTL = 1 hour, well past the 5 min recency window) */
  try { await redisSet(spendKey, "1", 3600); } catch (e) {}

  return { valid: true, amountPaid: parseFloat(match.tokenAmount) };
}

/* ================================================================
   resolveAccess(event, endpointKey)
   Single entry point called by every proprietary endpoint.

   Returns one of:
     { access: "key",     plan, email }           API key valid
     { access: "payment", method, payer? }         x402 or Solana
     { access: "paywall" }                         no auth at all -> send 402
     { access: "denied",  status, error }          bad key / bad payment
   ================================================================ */
async function resolveAccess(event, endpointKey) {

  /* 1. API key ── */
  var keyId = extractKey(event);
  if (keyId) {
    var auth = await validateApiKey(keyId);
    if (auth.valid) return { access: "key", plan: auth.plan, email: auth.email };
    return { access: "denied", status: auth.status, error: auth.error };
  }

  /* 2. x402 Base payment (X-Payment header) ── */
  var baseHeader = (event.headers && (event.headers["x-payment"] || event.headers["X-Payment"])) || "";
  if (baseHeader) {
    var bResult = await verifyBasePayment(baseHeader, endpointKey);
    if (bResult.valid) return { access: "payment", method: "base", payer: bResult.payer, txHash: bResult.txHash };
    return { access: "denied", status: 402, error: bResult.reason };
  }

  /* 3. Solana USDC-SPL payment (X-Solana-Payment header) ── */
  var solHeader = (event.headers && (event.headers["x-solana-payment"] || event.headers["X-Solana-Payment"])) || "";
  if (solHeader) {
    var sResult = await verifySolanaPayment(solHeader, endpointKey);
    if (sResult.valid) return { access: "payment", method: "solana" };
    return { access: "denied", status: 402, error: sResult.reason };
  }

  /* 4. Nothing -- paywall ── */
  // NOTE: Origin/Referer bypass removed — these are client-supplied headers
  // that any script can spoof (e.g. `curl -H "Origin: https://scan2moon.com"`).
  // All access now requires a valid API key or on-chain payment.
  return { access: "paywall" };
}

/* ================================================================
   respond402(endpointKey)
   Convenience -- builds the full 402 Netlify response object.
   ================================================================ */
function respond402(endpointKey) {
  return {
    statusCode: 402,
    headers: Object.assign({}, CORS_API, {
      "X-Payment-Requirements": "x402",
    }),
    body: JSON.stringify(build402Body(endpointKey)),
  };
}

module.exports = { PRICES, build402Body, respond402, resolveAccess, verifyBasePayment, verifySolanaPayment, BASE_RECIPIENT, SOL_RECIPIENT };
