# Scan2Moon — Full API System Audit
### Date: 2026-04-29 | Scope: All API endpoints, payment rails, key lifecycle, email, access control

---

## Executive Summary

**Score: 7.2 / 10**

The API system is architecturally ambitious — dual payment rails (x402 Base + Solana USDC-SPL), plan-based keys, auto-renewal, email lifecycle, and a self-serve portal. For a 4-week build this is remarkable. However there are **3 critical bugs that cost you real money right now** and several high-severity issues that undermine the payment system's integrity. Fix the critical ones before any paying customer hits them.

---

## System Map

```
Public endpoints (free, rate-limited):
  selfServeKey     → generate starter key (email + IP rate limit)
  keyStatus        → check quota/plan for a known key
  revokeMyKey      → self-revoke a key
  prices           → machine-readable pricing discovery

Payment-gated endpoints (x402 resolveAccess):
  devWallet        → $0.005/call — deployer history (Helius + Birdeye)
  lpPredictor      → $0.005/call — LP pull risk predictor
  smartMoneyLeaderboard → $0.002/call — smart wallet rankings
  bundle           → $0.010/call — bundle attack detector
  newPairs         → $0.001/call — new token feed

Subscription upgrade:
  upgradeKey       → verify USDC-SPL tx → create/upgrade key (Pro/Power)
  checkRenewals    → daily cron → downgrade expired paid keys

Admin only:
  adminKey         → full CRUD on api_keys table
  apiKey           → (older admin file — duplicate)
  initDb           → schema bootstrap

Social tasks:
  verify-social-task → claim XP + SOL rewards for follows/joins
```

---

## 🔴 CRITICAL — Bugs That Cost You Money Right Now

---

### C1 — Origin/Referer Spoofing Completely Bypasses the Paywall

**File:** `netlify/functions/x402.js` lines 266–274

```javascript
// ❌ CURRENT CODE — trivially bypassable
if (
  origin.includes("scan2moon.com")  || origin.includes("localhost") ||
  referer.includes("scan2moon.com") || referer.includes("localhost") ||
  origin.includes("netlify.app")    || referer.includes("netlify.app")
) {
  return { access: "site" };
}
```

`Origin` and `Referer` are **HTTP headers set by the client**. Any developer, script, or AI agent can set `Origin: https://scan2moon.com` in their `curl` command and get unlimited free access to all your paid endpoints (`devWallet`, `lpPredictor`, `bundle`, etc.). This defeats the entire paywall.

**Proof of exploit:**
```bash
curl -H "Origin: https://scan2moon.com" \
  "https://scan2moon.com/.netlify/functions/devWallet?wallet=ANYADDRESS"
# → 200 OK — free access, no payment, no key
```

**Fix — remove the Origin/Referer bypass entirely:**

The "site visitor" bypass was designed so your own pages can call these endpoints without requiring users to have a key. But your own pages don't call `devWallet`, `lpPredictor`, or `bundle` directly — those are surfaced through your UI which calls `scanToken` (free) first. The paid endpoints are API-only.

```javascript
// x402.js — resolveAccess() — remove the site bypass block:
// DELETE lines 266–274 entirely

// Replace with: nothing. If no key and no payment → paywall.
// Your own site's UI pages don't need to call paid API endpoints directly.
// If they do in future, use an API key stored server-side.

/* 4. Nothing -- paywall */
return { access: "paywall" };
```

If you genuinely need site visitors to access some endpoints for free, add a server-side internal key stored in env vars — never trust client-supplied headers for access control.

---

### C2 — `batchRisk` Serves Birdeye Data Freely With No Paywall

**File:** `netlify/functions/batchRisk.js`

`batchRisk` is one of your highest-value endpoints — it scores up to 15 tokens in one call using 2–3 Birdeye API calls per mint (that's up to 45 Birdeye calls per request). It is **not behind the x402 paywall**. Anyone can call it freely at 30 req/10s per IP.

At 30 req/10s × 15 mints × 3 Birdeye calls = **135 Birdeye API calls per second per attacker IP**. With IP rotation this is unlimited Birdeye quota theft.

**Fix — add `resolveAccess` to batchRisk:**

```javascript
// netlify/functions/batchRisk.js — add at top:
const { resolveAccess, respond402, CORS_API } = require("./x402");

// Inside exports.handler, after the rate limit check:
const access = await resolveAccess(event, "batchRisk");
if (access.access === "paywall") return respond402("batchRisk");
if (access.access === "denied")
  return { statusCode: access.status, headers: CORS_API, body: JSON.stringify({ error: access.error }) };
// "site" and "key" and "payment" → proceed normally
```

Also add `batchRisk` to the `PRICES` object in `x402.js`:
```javascript
batchRisk: { units: 3000, usd: 0.003, label: "Batch Risk Scores" },
```

*(The price is already listed in `openapi.json` — just not wired to the paywall.)*

---

### C3 — Double-Spend Protection Silently Fails When Redis Is Down

**File:** `netlify/functions/upgradeKey.js` lines 68–72

```javascript
// ❌ CURRENT — Redis down = no double-spend protection
try {
  var already = await redisGet(spendKey);
  if (already) return { statusCode: 409, ... };
} catch (e) { /* Redis down -- proceed */ }
```

If Upstash Redis is unavailable (cold start spike, network hiccup, plan limit), the double-spend check is silently skipped. A user who knows about this could fire the same USDC transaction signature twice in rapid succession during a Redis blip and get **two Pro keys for one payment**.

Same problem exists in `x402.js`'s `verifySolanaPayment()` at the per-call payment level.

**Fix — fail closed, not open:**

```javascript
// upgradeKey.js — replace the try/catch:
let alreadyUsed = false;
try {
  const existing = await redisGet(spendKey);
  if (existing) return { statusCode: 409, headers: CORS, body: JSON.stringify({ error: "This transaction has already been used." }) };
} catch (e) {
  // Redis down — FAIL CLOSED: reject rather than risk double-spend
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
```

Apply the same fix in `x402.js`'s `verifySolanaPayment()`.

---

## 🟠 HIGH — Fix Within 48 Hours

---

### H1 — `selfServeKey` Race Condition — Email Limit Bypassable

**File:** `netlify/functions/selfServeKey.js`

The "max 3 keys per email" check uses a SELECT COUNT then INSERT — not atomic:

```javascript
// Step 1: check count
var existing = await sql("SELECT COUNT(*)::int AS cnt FROM api_keys WHERE email=$1 ...", [email]);
// ... time gap here ...
// Step 2: insert (two concurrent requests can both pass step 1 before either inserts)
await sql("INSERT INTO api_keys ...", [keyId, email, plan, note]);
```

Two simultaneous requests with the same email can both see count=2 and both insert, resulting in 4+ keys.

**Fix — use a database-level unique constraint + ON CONFLICT, or a Postgres advisory lock:**

```sql
-- Option A: Add unique partial index (run once in initDb or as migration)
CREATE UNIQUE INDEX IF NOT EXISTS ak_email_plan_unique
  ON api_keys (email)
  WHERE plan = 'starter' AND active = true;
-- This enforces one active starter key per email at the DB level.
-- For 3 keys, use a check constraint + trigger instead.

-- Option B (simpler): use INSERT ... ON CONFLICT DO NOTHING with a counter
```

Or simpler — wrap the count+insert in a Postgres function/transaction:

```javascript
// selfServeKey.js — replace the count + insert with atomic version:
const result = await sql(`
  WITH key_count AS (
    SELECT COUNT(*)::int AS cnt FROM api_keys WHERE email = $1 AND active = true
  )
  INSERT INTO api_keys (key_id, email, plan, note)
  SELECT $2, $1, 'starter', $3
  FROM key_count
  WHERE cnt < $4
  RETURNING key_id
`, [email, keyId, note, MAX_KEYS_PER_EMAIL]);

if (result.length === 0) {
  return { statusCode: 409, headers: CORS, body: JSON.stringify({ error: "Max keys reached." }) };
}
```

---

### H2 — `checkRenewals` Sends Wrong Plan Name in Expiry Emails

**File:** `netlify/functions/checkRenewals.js` lines 88–103

The expiry email always says "Pro / Power" regardless of the actual plan that expired. The comment even admits the bug:

```javascript
// ❌ BUG — row.plan is 'starter' after the UPDATE, hardcoded fallback is wrong
await sendExpiryEmail({
  to:        row.email,
  keyId:     row.key_id,
  plan:      "pro",           // ← always "pro" — even for Power users
  planLabel: "Pro / Power",   // ← always this — never the real plan
});
```

This is confusing to users and unprofessional. Power users ($99/mo) get an email saying "Pro" expired.

**Fix — capture the old plan with a CTE before the update:**

```javascript
// Replace the expiry UPDATE with a CTE that captures the old plan:
const expired = await sql(`
  WITH before AS (
    SELECT key_id, email, plan FROM api_keys
    WHERE active = true AND plan != 'starter' AND renews_at < NOW()
  ),
  updated AS (
    UPDATE api_keys SET plan = 'starter'
    WHERE key_id IN (SELECT key_id FROM before)
    RETURNING key_id
  )
  SELECT b.key_id, b.email, b.plan AS old_plan FROM before b
`);

for (const row of expired) {
  const planLabel = row.old_plan.charAt(0).toUpperCase() + row.old_plan.slice(1);
  await sendExpiryEmail({
    to:        row.email,
    keyId:     row.key_id,
    plan:      row.old_plan,   // ← correct plan
    planLabel: planLabel,       // ← "Pro" or "Power"
  });
  summary.expired++;
}
```

---

### H3 — `verify-social-task` Has No Rate Limiting and No Real Verification

**File:** `netlify/functions/verify-social-task.js`

Two problems:

**1) No rate limiting at all.** The endpoint has no IP rate limiter. An attacker can create wallets in a loop and call `verify-social-task` for each to farm XP. There are no limits.

**2) Social tasks are self-reported.** The `follow_x` and `join_tg` tasks are honored purely on the user's say-so. You're promising `0.5 SOL` ($42 at current prices) for following on X with **zero verification**. This is a financial liability — anyone can claim it without actually following.

**Fix for rate limiting (5 minutes):**

```javascript
// verify-social-task.js — add at top of handler:
const { isRateLimitedRedis } = require("./db");
const ip = (event.headers["x-nf-client-connection-ip"] || event.headers["x-forwarded-for"] || "unknown").split(",")[0].trim();
if (await isRateLimitedRedis(ip, 5, 60)) {
  return respond(429, { error: "Too many task claims. Wait a minute." });
}
```

**Fix for SOL payout verification — reduce or eliminate the promise:**

Either:
- Remove the SOL reward entirely and make it XP-only (safe, simple)
- Or require the user to DM you on X with proof before you manually pay
- Or integrate a Twitter API verification step (complex)

At minimum, change the message so it doesn't promise automatic payout:
```javascript
// Change:
message: `✅ Task verified! +${task.xpReward} XP awarded. ${task.solReward} SOL reward will be sent to your wallet within 24 hours.`
// To:
message: `✅ Task recorded! +${task.xpReward} XP awarded. SOL rewards are reviewed weekly and paid manually — DM @Scan2Moon with proof.`
```

---

### H4 — `upgradeKey` Has No Rate Limiting

**File:** `netlify/functions/upgradeKey.js`

The payment upgrade endpoint accepts arbitrary transaction signatures with no rate limit. An attacker can enumerate old/invalid signatures at high speed trying to find one that passes the Helius lookup before the double-spend check writes to Redis. At worst this is a DoS on Helius (burning your Helius credits).

**Fix — add rate limiting before the Helius call:**

```javascript
// upgradeKey.js — add near the top of the handler:
const { isRateLimitedRedis } = require("./db");
const ip = (event.headers["x-nf-client-connection-ip"] || event.headers["x-forwarded-for"] || "unknown").split(",")[0].trim();
// 5 upgrade attempts per IP per hour — generous for legitimate use
if (await isRateLimitedRedis(ip, 5, 3600)) {
  return { statusCode: 429, headers: CORS, body: JSON.stringify({ error: "Too many upgrade attempts. Try again in an hour." }) };
}
```

---

### H5 — CORS `*` on Payment Endpoints Enables CSRF

**Files:** `selfServeKey.js`, `revokeMyKey.js`, `upgradeKey.js`

All three use `"Access-Control-Allow-Origin": "*"`. This allows any website to call these endpoints on behalf of your users via JavaScript — enabling CSRF attacks (e.g., a malicious page that auto-revokes a victim's key using their stored browser state).

**Fix:**

```javascript
// Replace in all three files:
const CORS = {
  "Content-Type":                 "application/json",
  "Access-Control-Allow-Origin":  process.env.ALLOWED_ORIGIN || "https://scan2moon.com",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
```

---

## 🟡 MEDIUM — Fix Within First Week

---

### M1 — `openapi.json` Advertises Wrong Starter Plan Quota

The OpenAPI spec and description say **"Starter: 5,000 req/day free"** but the actual code in `db.js` enforces `starter: 1000`. Real users will sign up expecting 5,000 calls and get rejected at 1,000.

Affected text in `openapi.json`:
```
"Starter: 5,000 req/day free, Pro: 50,000/day $49/mo"
```

Actual values in `db.js`:
```javascript
const PLAN_DAILY = { starter: 1000, pro: 25000, power: 100000, enterprise: 1000000 };
```

Also the Pro advertised limit is `50,000` in the description but `25,000` in code. **Update the spec to match the code** — or decide which number is right and update the code.

---

### M2 — `keyStatus` Rate-Limits Per Key, Not Per IP

**File:** `netlify/functions/keyStatus.js`

The rate limiter key is `"ks:rl:" + keyId` — 20 checks per minute **per key**. This means an attacker who doesn't have a key can enumerate the key format (`s2m_` + 32 hex chars) at 20 req/min per attempt key. The correct rate limit should be **per IP**:

```javascript
// Replace keyId-based rate limit with IP-based:
const ip = (event.headers["x-nf-client-connection-ip"] || event.headers["x-forwarded-for"] || "unknown").split(",")[0].trim();
const rlRedisKey = "ks:rl:ip:" + ip;  // per-IP, not per-key
```

---

### M3 — No Unique DB Constraint on `api_keys.email` + `plan`

The application prevents >3 keys per email in code (selfServeKey), but there's no database-level constraint. A direct DB injection, a race condition (H1), or a future code bug could insert unlimited rows. Add a check constraint:

```sql
-- Run in initDb or as a migration:
ALTER TABLE api_keys
  ADD CONSTRAINT check_plan_valid
  CHECK (plan IN ('starter', 'pro', 'power', 'enterprise'));
```

At minimum this prevents garbage plan values from being inserted.

---

### M4 — `apiKey.js` Is a Duplicate of `adminKey.js` — Security Debt

Both `apiKey.js` and `adminKey.js` do the same thing (admin key management) with slightly different action sets. Having two admin surfaces means security fixes applied to one may not reach the other. `apiKey.js` does **not** have the rate limiting fix we applied to `adminKey.js` in the previous audit.

**Fix — add rate limiting to `apiKey.js` too** (same pattern as `adminKey.js`):

```javascript
// apiKey.js — add after the OPTIONS check:
const { isRateLimitedRedis } = require("./db");
const ip = (event.headers["x-nf-client-connection-ip"] || event.headers["x-forwarded-for"] || "unknown").split(",")[0].trim();
if (await isRateLimitedRedis(ip, 10, 60)) {
  return { statusCode: 429, headers: CORS_ADMIN, body: JSON.stringify({ error: "Too many requests." }) };
}
```

Then plan to delete `apiKey.js` and consolidate to just `adminKey.js`.

---

### M5 — x402 Settle Failure Silently Serves Data

**File:** `netlify/functions/x402.js` — `verifyBasePayment()`

```javascript
// ❌ If settle fails, data is served anyway and you don't get paid
if (!sRes.ok || !sBody.success) {
  console.warn("[x402] settle failed ...");
  return { valid: true, ..., settled: false };  // ← still "valid"!
}
```

If the Coinbase x402 facilitator verifies but then fails to settle (network error, gas issue), you serve the response but receive no USDC. This is by design in your comment ("don't punish user for infra issue") but you should at minimum log these to a monitoring list for manual reconciliation.

**Fix — track unsettled transactions:**

```javascript
if (!sRes.ok || !sBody.success) {
  console.warn("[x402] settle failed for", endpointKey, ":", sBody.error || sRes.status);
  // Log to Redis for reconciliation
  try {
    await redisSet("x402:unsettled:" + Date.now(), JSON.stringify({ endpointKey, payer: sBody.payer, error: sBody.error }), 7 * 86400);
  } catch {}
  return { valid: true, payer: sBody.payer || "unknown", txHash: null, settled: false };
}
```

---

### M6 — `RESEND_API_KEY` Not Set = Silent Email Failure

**File:** `netlify/functions/email.js`

When `RESEND_API_KEY` is missing, all email functions return `{ ok: false }` silently. Users get their key in the API response but **never receive the backup email**. For paid users ($49+), losing the key means losing access since you explicitly say "we cannot recover lost keys."

**Fix — at minimum log loudly:**
```javascript
if (!RESEND_KEY) {
  console.error("[email] CRITICAL: RESEND_API_KEY not set — key email NOT sent to", to);
  return { ok: false, reason: "email not configured" };
}
```

And add `RESEND_API_KEY` to your Netlify environment variables checklist. Verify it's set before going live by calling `/.netlify/functions/selfServeKey` with a test email and confirming receipt.

---

## 🟢 LOW — Polish and Reliability

---

### L1 — `upgradeKey` Double-Spend TTL Is Only 30 Days

```javascript
await redisSet(spendKey, "1", 30 * 86400);  // 30-day TTL
```

After 30 days, the same transaction signature could theoretically be reused for a "renewal." Solana transaction signatures never expire on-chain but your Redis record does. Use a longer TTL or store in Postgres instead:

```javascript
// Better: store used tx signatures in Postgres permanently
await sql`
  INSERT INTO used_tx_sigs (sig, used_at, endpoint, email)
  VALUES (${txSig}, NOW(), 'upgradeKey', ${email})
  ON CONFLICT (sig) DO NOTHING
  RETURNING sig
`;
// If nothing inserted → already used
```

---

### L2 — `selfServeKey` Allows Disposable Email Addresses

The email regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` accepts any format including `a@b.c`. Disposable email providers (Mailinator, 10minutemail, etc.) let attackers bypass the "3 keys per email" limit trivially.

**Fix (lightweight):** Block known disposable domains:

```javascript
const BLOCKED_DOMAINS = new Set([
  "mailinator.com", "10minutemail.com", "guerrillamail.com",
  "tempmail.com", "throwam.com", "yopmail.com", "sharklasers.com",
]);

const domain = email.split("@")[1] || "";
if (BLOCKED_DOMAINS.has(domain)) {
  return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Disposable email addresses are not accepted." }) };
}
```

---

### L3 — No `Retry-After` Header on Rate-Limited Responses in `upgradeKey`

When you add rate limiting (H4), include `Retry-After` so clients know when to retry:

```javascript
return {
  statusCode: 429,
  headers: { ...CORS, "Retry-After": "3600" },
  body: JSON.stringify({ error: "Too many upgrade attempts.", retryAfter: 3600 }),
};
```

---

### L4 — `keyStatus` Exposes Exact Email Pattern (Partial Masking Weak)

```javascript
// Current masking: dev@example.com → d****@example.com
const emailMasked = email.replace(/^(.)(.*)(@.*)$/, (_, first, mid, domain) => first + "*".repeat(...) + domain);
```

The domain part is fully visible (`@gmail.com`, `@protonmail.com` etc.). For a key that proves ownership, this leaks enough for targeted phishing. The domain is the most identifying part for corporate keys. Consider masking the domain too, or just showing the first character and last 2 of the local part only.

---

### L5 — `verify-social-task` Uses Netlify Blobs, Not Neon

Social task claims are stored in Netlify Blobs (same store as the simulator), while all other persistent data is in Neon Postgres. This creates a split storage system. If you ever need to query "how many users completed task X" or "who hasn't been paid yet," Blobs gives you no SQL query capability.

**Fix for new tasks:** Migrate to Neon:

```sql
CREATE TABLE IF NOT EXISTS social_task_claims (
  wallet      TEXT NOT NULL,
  task_id     TEXT NOT NULL,
  handle      TEXT,
  xp_awarded  INTEGER DEFAULT 0,
  sol_pending NUMERIC DEFAULT 0,
  paid        BOOLEAN DEFAULT false,
  claimed_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (wallet, task_id)
);
```

---

## Priority Fix Order

| # | Issue | File | Effort | Impact |
|---|---|---|---|---|
| 1 | Origin spoof bypasses paywall | `x402.js` | 10 min | 🔴 Revenue loss |
| 2 | batchRisk not behind paywall | `batchRisk.js` | 15 min | 🔴 Birdeye quota theft |
| 3 | Double-spend fails open | `upgradeKey.js`, `x402.js` | 20 min | 🔴 Free key fraud |
| 4 | checkRenewals wrong plan email | `checkRenewals.js` | 20 min | 🟠 Customer confusion |
| 5 | selfServeKey race condition | `selfServeKey.js` | 30 min | 🟠 Limit bypass |
| 6 | verify-social-task no rate limit + unverified SOL | `verify-social-task.js` | 30 min | 🟠 SOL drain |
| 7 | upgradeKey no rate limit | `upgradeKey.js` | 10 min | 🟠 Helius credit drain |
| 8 | CORS `*` on payment endpoints | 3 files | 15 min | 🟠 CSRF risk |
| 9 | openapi.json wrong quota numbers | `openapi.json` | 10 min | 🟡 User trust |
| 10 | apiKey.js duplicate + no rate limit | `apiKey.js` | 15 min | 🟡 Security debt |
| 11 | keyStatus rate-limits per key not IP | `keyStatus.js` | 5 min | 🟡 Enum risk |
| 12 | RESEND_API_KEY silent failure | `email.js` | 5 min | 🟡 UX |

---

## What's Working Well

- **`resolveAccess()` access chain** is clean and consistent — API key → x402 → Solana → site → paywall. The abstraction is right.
- **`validateApiKey()` in `db.js`** handles daily quota, plan detection, and fire-and-forget usage increment correctly with a Redis negative-result cache for revoked keys.
- **Email templates** are high quality — dark-mode, branded, mobile-responsive with all the right information (key, limit, receipt, solscan link).
- **`checkRenewals` deduplication** via Redis flag is smart — no duplicate reminder emails.
- **`revokeMyKey` enumeration protection** — returns same 404 for "not found" and "already revoked."
- **`upgradeKey` plan-by-amount tiering** — automatically resolves Pro vs Power based on payment amount, no manual admin needed.
- **`prices.js` discovery endpoint** — machine-readable pricing for AI agents is exactly the right move for the x402 ecosystem.

---

*Audit complete. Fix C1 first — the Origin spoof is costing you Birdeye credits on every bot that's already discovered it.*
