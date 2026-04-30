# Scan2Moon API System — Hard Audit
**Date:** April 29, 2026  
**Scope:** All Netlify serverless functions, payment rail logic, API key system, CORS/auth configuration, and `netlify.toml` headers  
**Files reviewed:** `db.js`, `x402.js`, `apiKey.js`, `adminKey.js`, `selfServeKey.js`, `upgradeKey.js`, `devWallet.js`, `lpPredictor.js`, `bundle.js`, `birdeyeWsKey.js`, `checkRenewals.js`, `openapi.json`, `netlify.toml`, `.env`

---

## Severity Legend

| Level | Meaning |
|---|---|
| 🔴 CRITICAL | Active financial loss, credential exposure, or auth bypass possible right now |
| 🟠 HIGH | Functional break, silent data corruption, or easily-exploited revenue leak |
| 🟡 MEDIUM | Security weakness that needs mitigating controls, or broken feature |
| 🔵 LOW | Code quality, misleading comments, or dead code that creates confusion |

---

## 🔴 CRITICAL

### C-1 — `birdeyeWsKey.js` publicly vends your live Birdeye API key

**File:** `netlify/functions/birdeyeWsKey.js`

The endpoint `GET /.netlify/functions/birdeyeWsKey` returns `{ ok: true, key: "<BIRDEYE_API_KEY>" }` to **any caller on the internet**. The only defence is a Redis rate limit of 5 requests/IP/hour — trivially bypassed with a residential proxy or by simply rotating through IPs. Anyone who calls this endpoint once has your full Birdeye key and can make unlimited direct API calls to Birdeye on your account.

Your current Birdeye key (`f748...`) is in `.env` and exposed via this endpoint. Consequences: exceeded quotas, unexpected bills, or key revocation by Birdeye.

The code itself acknowledges this is a known, deferred problem:
```
// For the competition build this is acceptable; harden post-competition by
// rotating to a restricted "WS-only" key or switching to a persistent proxy process.
```

**Competition is over. Fix this now.**

**Fix options (pick one):**
- Proxy the WebSocket server-side through a persistent process (Fly.io, Railway, etc.) — the cleanest solution.
- Create a second, restricted Birdeye key that only allows WebSocket connections and rotate the main key.
- At minimum, add `Origin` header validation and restrict to `https://scan2moon.com` only (not a strong security control but raises the bar).

---

### C-2 — Live production credentials in plaintext `.env`

**File:** `.env` (root)

Your `.env` contains live, active secrets:
- `NEON_DATABASE_URL` — full connection string with password to your production Postgres database
- `BIRDEYE_API_KEY` — live key
- `HELIUS_KEY` — live key
- `GEMINI_API_KEY`, `GROQ_API_KEY` — live AI keys
- `UPSTASH_REDIS_REST_TOKEN` — live Redis token

The `.gitignore` correctly excludes `.env` and it is **not committed to git** — that's good. But these are live production credentials that should be considered compromised if anyone has ever had local file access to this machine (pair programmer, screen share, backup service that syncs plaintext files, etc.).

**Recommended actions:**
1. Rotate all secrets listed above immediately, since they appear in plaintext locally.
2. Add a comment at the top of `.env` reminding that it contains production secrets and should never be shared.
3. Consider using a secrets manager (1Password, Doppler) for local dev so credentials never live in plaintext files.

---

### C-3 — `validateApiKey` fails OPEN on database error

**File:** `netlify/functions/db.js`, lines ~183–189

```javascript
} catch (e) {
  // Neon is down — fail open so users aren't locked out during a DB outage.
  // IMPORTANT: this means all paid endpoints are temporarily free during an outage.
  console.error("[validateApiKey] DB error — failing open ...");
  return { valid: true, plan: "unknown", failOpen: true };
}
```

If Neon is unavailable — whether due to a legitimate outage, connection pool exhaustion, or a targeted slowdown attack — **all paid API endpoints (`devWallet`, `lpPredictor`, `bundle`, `smartMoneyLeaderboard`) become free**. An attacker who can cause repeated Neon timeouts can harvest unlimited data at no cost.

This is a deliberate design choice (anti-lockout for paying customers) but has no mitigating controls.

**Fix options:**
- Fail **closed** by default; maintain a Redis-side shadow cache of valid key IDs (set at key creation/update) so you can validate without hitting Neon on every request.
- Or fail open but enforce a Redis-side per-IP rate limit even when `failOpen: true`, so abuse during an outage is still bounded.
- Add an alert (email, PagerDuty, etc.) when `failOpen: true` responses are served so you're aware of outages quickly.

---

## 🟠 HIGH

### H-1 — `lpPredictor` internal `devWallet` call always returns `available: false`

**Files:** `netlify/functions/lpPredictor.js` (fn `getDevHistory`), `netlify/functions/x402.js` (`resolveAccess`)

`lpPredictor` calls the `devWallet` endpoint internally to enrich the LP score with deployer rug history:

```javascript
const res = await fetch(
  siteUrl + "/.netlify/functions/devWallet?wallet=" + encodeURIComponent(creator),
  { signal: AbortSignal.timeout(8000) }
);
if (!res.ok) return { totalDeployed: 0, rugRate: 0, available: false };
```

This call carries **no API key and no payment header**. `resolveAccess` no longer has a "site visitor" bypass (it was removed — correctly, for security). So the internal call always hits the paywall, gets a 402, and `getDevHistory` silently returns `{ available: false }`.

**Result:** The dev history signal is permanently missing from every `lpPredictor` response. Users are paying for a score advertised to include deployer rug history, but they never get it. This is a silent functional regression.

**Fix:** Pass a server-side API key in the internal call, or bypass `resolveAccess` entirely for server-to-server calls by calling the data-fetching logic directly (import the function rather than HTTP-fetching it).

---

### H-2 — x402 settlement failure serves data for free

**File:** `netlify/functions/x402.js`, `verifyBasePayment`

When the x402 facilitator **verifies** a payment but **settle** fails (network issue, facilitator downtime):

```javascript
// Verification passed but settle failed — still serve data
return { valid: true, payer: sBody.payer || "unknown", txHash: null, settled: false };
```

The unsettled payment is logged to Redis, but data is served without money changing hands. An adversary who can repeatedly cause settle failures (e.g., by cutting network connectivity between your function and `x402.org` at exactly the right moment) gets free access. At $0.005/call this is low per-call impact, but a script running this attack could drain significant value.

**Fix:** On settlement failure, return a 402 with a retry message rather than serving data. Log the verified-but-unsettled payment for audit, but don't treat a failed settle as authorized access.

---

### H-3 — Duplicate admin endpoints with overlapping functionality

**Files:** `netlify/functions/apiKey.js`, `netlify/functions/adminKey.js`

Both files implement admin key management (create, revoke, list, stats). They have slightly different action sets and were likely built at different times. Having two separately-maintained admin endpoints creates:
- Double the attack surface for brute-forcing `ADMIN_SECRET`.
- Risk of divergent logic (one may allow actions the other doesn't, creating gaps).
- Confusion about which is canonical.

**Fix:** Consolidate to `adminKey.js` (it's the more complete implementation with GET+POST support). Remove or disable `apiKey.js` by returning 410 Gone, or deleting it entirely.

---

### H-4 — `CORS_API` wildcard origin on paid data endpoints

**File:** `netlify/functions/db.js`, lines 221–227

```javascript
const CORS_API = {
  "Access-Control-Allow-Origin": "*",
  ...
};
```

All paid endpoints (`devWallet`, `lpPredictor`, `bundle`, `smartMoneyLeaderboard`) use `CORS_API`. Any website on the internet can make browser-side AJAX calls to these endpoints. This is likely intentional for API portability, but it means a compromised or stolen API key can be used from any origin with no CORS barrier. Combined with the `?apiKey=` query parameter (which leaks keys into browser history and server logs), this widens the blast radius of a stolen key.

**Fix:** Consider restricting `CORS_API` to a known allowlist, or document that wildcard is intentional and ensure API key exposure via query param is discouraged in all documentation.

---

## 🟡 MEDIUM

### M-1 — Dead `"site"` access path in `devWallet.js`

**File:** `netlify/functions/devWallet.js`, line 147

```javascript
if (access.access === "site") {
  if (await isRateLimitedRedis(ip, 20, 60))
    return { statusCode: 429, ... };
}
```

`resolveAccess` in `x402.js` only ever returns `"key"`, `"payment"`, `"paywall"`, or `"denied"`. It never returns `"site"`. This block is completely dead code — the "site visitor" bypass was intentionally removed from `x402.js` for security, but the caller was never cleaned up.

**Impact:** The dead code isn't dangerous, but it's misleading — a reader might think there's a free tier for site visitors when there isn't. Clean it up.

---

### M-2 — `ADMIN_SECRET` and `CRON_SECRET` missing from `.env`

**Files:** `.env`, `checkRenewals.js`, `apiKey.js`, `adminKey.js`

Neither `ADMIN_SECRET` nor `CRON_SECRET` appears in `.env`. In local Netlify Dev, all admin endpoints would either fail (500) or reject all requests. The renewal cron job can't be manually triggered or tested. This isn't dangerous for production (Netlify env vars are set separately), but it makes local testing broken without documentation.

**Fix:** Add `ADMIN_SECRET=<local-dev-value>` and `CRON_SECRET=<local-dev-value>` to `.env` with comments. Add a `.env.example` file to the repo documenting all required env vars.

---

### M-3 — CSP `unsafe-inline` for scripts undermines XSS protection

**File:** `netlify.toml`, `Content-Security-Policy` header

```
script-src 'self' 'unsafe-inline' cdn.jsdelivr.net unpkg.com
```

`'unsafe-inline'` allows any injected inline script to execute, eliminating the primary XSS mitigation that CSP provides. If any user-controlled content is ever rendered in the DOM (token names, wallet addresses, etc.), this is a viable XSS vector.

**Fix:** Remove `'unsafe-inline'` and migrate all inline scripts to external `.js` files already loaded from `'self'`. If inline scripts are unavoidable, use a per-response nonce (`'nonce-<random>'`) which still blocks injected scripts.

---

### M-4 — Static asset cache headers mislabelled as "1 year" but set to 5 minutes

**File:** `netlify.toml`

The comment says `Cache static assets aggressively (1 year)` but the actual header is:
```toml
Cache-Control = "public, max-age=300, stale-while-revalidate=86400"
```

`max-age=300` = **5 minutes**, not 1 year (`max-age=31536000`). This means every returning visitor re-fetches all JS/CSS every 5 minutes, adding unnecessary latency and Netlify bandwidth.

**Fix:** Set `max-age=31536000` for truly static assets. Use content-hashed filenames (e.g. `app.a1b2c3.js`) so you can cache forever and bust the cache only on deploys.

---

### M-5 — `upgradeKey` email/key mismatch returns 404, not 400

**File:** `netlify/functions/upgradeKey.js`

When a user provides an `existingKeyId` that doesn't match the provided email, the response is:
```json
{ "error": "Key not found or email does not match." }
```
with status 404. But the key *was* found — it just doesn't belong to that email. A 404 gives an attacker information that the key *doesn't exist*, while a 403 Forbidden would be more semantically correct and slightly less informative. Minor but worth correcting.

---

### M-6 — `ohlcvData.js.orig` committed to functions directory

**File:** `netlify/functions/ohlcvData.js.orig`

A `.orig` backup file from a merge conflict or manual edit is present in the functions directory. Netlify may or may not attempt to deploy this as a function (depending on esbuild's glob patterns). At minimum it's dead code in a deployed directory; at worst it gets bundled.

**Fix:** Delete it and commit the deletion.

---

## 🔵 LOW / CODE QUALITY

### L-1 — `db.js` split `module.exports` antipattern

**File:** `netlify/functions/db.js`, lines 142 and 229

```javascript
// Line 142:
module.exports = { getDb, redisGet, redisSet, redisDel, CORS, CORS_429, isRateLimited, isRateLimitedRedis };

// Line 229:
module.exports = Object.assign(module.exports, { validateApiKey, extractKey, CORS_API, PLAN_DAILY });
```

Splitting exports across two `module.exports` statements is fragile — if a circular dependency causes the module to be partially evaluated, the second set of exports may be missing. It also makes the module's public API hard to see at a glance.

**Fix:** Move all `module.exports` to a single statement at the bottom of the file.

---

### L-2 — `apiKey` query parameter exposes API keys in logs and Referer headers

**File:** `netlify/functions/db.js`, `extractKey()`

```javascript
const q = (event.queryStringParameters && event.queryStringParameters.apiKey) || "";
```

Query string parameters appear in: server access logs, browser history, Referer headers (when navigating away), and any analytics/monitoring tools. API keys should only travel in request headers, not URLs.

**Fix:** Remove the `?apiKey=` fallback from `extractKey()`. Document that `X-Api-Key` header is the only supported authentication method. Update `openapi.json` to remove the `ApiKeyQuery` security scheme.

---

### L-3 — Token classification thresholds in `devWallet.js` are too coarse

**File:** `netlify/functions/devWallet.js`, `classifyToken()`

```javascript
if      (liquidity < 500  && mc < 1000)             status = "RUG";
else if (priceChange24h < -70 && liquidity < 10000) status = "DUMPED";
else if (liquidity < 2000)                          status = "DEAD";
else                                                status = "ACTIVE";
```

This produces false positives: a micro-cap with $499 liquidity and $999 MC (a normal new token) is immediately classified as `RUG`. It also produces false negatives: a rug that still has $3,000 in LP (not uncommon for slow rugs) gets classified as `ACTIVE`.

**Fix:** Incorporate time-since-launch into the classification. A 3-day-old token with $499 liquidity is very different from a 3-week-old one. Consider adding a `MICRO` or `SUSPECT` tier before jumping straight to `RUG`.

---

### L-4 — `deno.lock` in repo root

**File:** `deno.lock`

A Deno lockfile is present but the entire backend is Node.js on Netlify Functions. This appears to be a leftover from early development. It adds confusion and false signals to anyone auditing the stack.

**Fix:** Delete it.

---

### L-5 — `test-birdeye.js` in public-serving root

**File:** `test-birdeye.js`

A test script is in the root of the directory served by Netlify. While it doesn't expose secrets (all keys are via `process.env`), it adds noise to the public directory and reveals implementation details about your Birdeye integration.

**Fix:** Move to a `scripts/` or `dev/` folder excluded from Netlify's publish directory, or delete it.

---

## Summary Table

| ID | Severity | File(s) | Issue |
|---|---|---|---|
| C-1 | 🔴 CRITICAL | `birdeyeWsKey.js` | Birdeye API key publicly accessible to any caller |
| C-2 | 🔴 CRITICAL | `.env` | Live production secrets in plaintext — rotate all |
| C-3 | 🔴 CRITICAL | `db.js` | Auth fails open on DB error — all endpoints free during outage |
| H-1 | 🟠 HIGH | `lpPredictor.js` | Dev history signal always missing — internal call gets 402 |
| H-2 | 🟠 HIGH | `x402.js` | Settlement failure serves data without payment |
| H-3 | 🟠 HIGH | `apiKey.js`, `adminKey.js` | Duplicate admin endpoints — double attack surface |
| H-4 | 🟠 HIGH | `db.js` | `CORS_API` wildcard origin on all paid endpoints |
| M-1 | 🟡 MEDIUM | `devWallet.js` | Dead `"site"` access path misleads readers |
| M-2 | 🟡 MEDIUM | `.env` | `ADMIN_SECRET` / `CRON_SECRET` missing — local dev broken |
| M-3 | 🟡 MEDIUM | `netlify.toml` | CSP `unsafe-inline` scripts undermines XSS protection |
| M-4 | 🟡 MEDIUM | `netlify.toml` | Cache headers say 1 year, actually set to 5 minutes |
| M-5 | 🟡 MEDIUM | `upgradeKey.js` | Wrong status code on email/key mismatch (404 vs 403) |
| M-6 | 🟡 MEDIUM | `ohlcvData.js.orig` | Backup file committed to deployed functions directory |
| L-1 | 🔵 LOW | `db.js` | Split `module.exports` antipattern |
| L-2 | 🔵 LOW | `db.js` | `?apiKey=` query param leaks key into logs/Referer |
| L-3 | 🔵 LOW | `devWallet.js` | Rug classification thresholds too coarse |
| L-4 | 🔵 LOW | `deno.lock` | Stale Deno lockfile in repo root |
| L-5 | 🔵 LOW | `test-birdeye.js` | Test script in public root |

---

## Priority Action Plan

**Do immediately (before next deploy):**
1. **C-1** — Rotate the Birdeye key and implement a server-side WS proxy or restricted key. Remove `birdeyeWsKey.js`.
2. **C-2** — Rotate all secrets in `.env` (Neon password, Birdeye key, Helius key, Upstash token, AI keys).
3. **H-1** — Fix the internal `devWallet` call in `lpPredictor` — this is a silent, broken feature.

**This week:**
4. **C-3** — Add Redis-backed shadow key validation so auth doesn't fully collapse during a DB outage.
5. **H-2** — Return 402 on settlement failure instead of serving data free.
6. **H-3** — Consolidate `apiKey.js` into `adminKey.js`. Remove the old endpoint.
7. **M-4** — Fix cache header values (`max-age=31536000` for hashed assets).

**Before next billing cycle:**
8. **M-3** — Remove `unsafe-inline` from CSP.
9. **L-2** — Remove `?apiKey=` query param support.
10. **M-6 / L-4 / L-5** — Clean up `ohlcvData.js.orig`, `deno.lock`, `test-birdeye.js`.

---

*Audit performed by Claude (Cowork mode) on April 29, 2026.*
