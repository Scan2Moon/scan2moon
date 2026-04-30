# Scan2Moon — Full Web Audit Report
**Date:** April 20, 2026  
**Audited by:** Claude (Cowork)  
**Scope:** Security · Performance · Code Quality  
**Project:** Scan2Moon v2.0 — Solana Token Intelligence Platform  

---

## Executive Summary

Scan2Moon is a well-architected Solana DeFi intelligence app deployed on Netlify with serverless functions, Redis caching, and a Neon PostgreSQL backend. The overall approach — proxying all API keys through serverless functions — is the right pattern and protects secrets from client-side exposure.

However, several **critical and high-severity issues** need immediate attention, particularly around HTTP security headers, image optimization, missing viewport tags, and CORS configuration. These are all fixable in a short sprint.

---

## Severity Legend

| Symbol | Level | Action |
|--------|-------|--------|
| 🔴 | **Critical** | Fix immediately — security risk or major UX breakage |
| 🟠 | **High** | Fix in next deploy |
| 🟡 | **Medium** | Fix soon |
| 🟢 | **Good / Pass** | No action needed |

---

## 1. Security

### 🔴 CRITICAL — No HTTP Security Headers Configured

`netlify.toml` contains zero HTTP response headers. Every page is served without:

- `Content-Security-Policy` (CSP) — allows arbitrary script injection
- `X-Frame-Options` — app can be embedded in iframes (clickjacking)
- `X-Content-Type-Options` — MIME-type sniffing enabled
- `Referrer-Policy` — full URLs leaked to third-party requests
- `Permissions-Policy` — camera/mic/location access unconstrained

**Fix — add to `netlify.toml`:**
```toml
[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"
    Permissions-Policy = "camera=(), microphone=(), geolocation=()"
    Content-Security-Policy = "default-src 'self'; script-src 'self' 'unsafe-inline' cdn.jsdelivr.net unpkg.com; connect-src 'self' *.birdeye.so *.helius-rpc.com api.jup.ag *.upstash.io *.neon.tech; img-src 'self' data: https:; style-src 'self' 'unsafe-inline';"
```

---

### 🔴 CRITICAL — CORS Wildcard `"*"` on All Serverless Functions

`db.js` (shared CORS config), `chartProxy.js`, `geckoProxy.js`, `topGainers.js`, `scanToken.js`, and most other functions use:

```js
"Access-Control-Allow-Origin": "*"
```

This allows **any website on the internet** to call your serverless API endpoints and consume your API quota. An attacker could scrape Birdeye data through your keys for free.

**Fix:** Lock CORS to your domain:
```js
const CORS = {
  "Access-Control-Allow-Origin": "https://scan2moon.com",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
```
Also set `ALLOWED_ORIGIN=https://scan2moon.com` in Netlify environment variables (bundle.js already checks for this env var but defaults to `"*"` if unset).

---

### 🟠 HIGH — CDN Scripts Loaded Without Subresource Integrity (SRI)

Multiple HTML pages load third-party scripts with no integrity check:

```html
<!-- dashboard.html, leaderboard.html, portfolio.html, risk-scanner.html, safe-ape.html -->
<script src="https://unpkg.com/@solana/web3.js@latest/..."></script>
<script src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/..."></script>
<script src="https://unpkg.com/lightweight-charts@4.1.3/..."></script>
```

If any CDN is compromised, malicious JS executes in your users' browsers (crypto wallet draining attack). Also, `@solana/web3.js@latest` is **unpinned** — a breaking change will silently break the app.

**Fix:** Generate SRI hashes and pin versions:
```html
<script
  src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"
  integrity="sha384-[hash]"
  crossorigin="anonymous">
</script>
```
Use https://www.srihash.org/ to generate hashes. Pin `@solana/web3.js` to a specific version (e.g., `@1.98.0`).

---

### 🟠 HIGH — Rate Limiting Only on `helius.js`

Only the `helius.js` function implements IP-based rate limiting. All other functions (`scanToken`, `topGainers`, `watchlist`, `sentinel`, `bundle`, etc.) have no rate limiting at all.

**Risk:** A bot can hammer your endpoints, exhaust your Birdeye/Groq/Helius quota, and take down the app for real users.

**Fix:** Extract the rate-limit logic from `helius.js` into `db.js` (already the shared module) and apply it to all functions.

---

### 🟡 MEDIUM — `innerHTML` With Unsanitized External Data

`innerHTML` is used extensively across `dashboard.js`, `academy.js`, `safe-ape.js`, `watchlist.js`, and others. In several cases, external token data (names, symbols) from the Birdeye API is injected directly into the DOM:

```js
// Example pattern found in multiple files
el.innerHTML = `<div class="token-name">${data.name}</div>`
```

If a token on-chain has a name like `<img src=x onerror=alert(1)>`, it will execute in the user's browser. While this is unlikely in practice, it is a real attack vector.

**Fix:** Sanitize external strings before insertion, or use `textContent` / `createElement` instead of `innerHTML` for any user/API-controlled values. Consider using [DOMPurify](https://github.com/cure53/DOMPurify).

---

### 🟢 PASS — API Keys Not Hardcoded in Frontend

All API keys (`BIRDEYE_API_KEY`, `HELIUS_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`, `UPSTASH_REDIS_REST_TOKEN`, `NEON_DATABASE_URL`) are correctly accessed via `process.env` in serverless functions only. No key values appear in any client-side JS or HTML file.

### 🟢 PASS — `.env` Not Committed to Git

The `.gitignore` correctly excludes `.env`, and git log confirms the file has never been committed. The keys in `.env` remain local.

> **Note:** Since `.env` lives in the project root and the Netlify publish directory is `"."`, double-check that Netlify's build does not serve `.env` as a static file. Add a `_redirects` rule or Netlify `ignore` config if needed.

---

## 2. Performance

### 🔴 CRITICAL — Images Are Massively Oversized

| File | Size | Problem |
|------|------|---------|
| `headerweb.png` | **1.68 MB** | Used as OG image — way too large |
| `favicon.png` | **480 KB** | A favicon should be ≤ 32 KB |
| `sol2moon-token.png` | **307 KB** | Token logo, should be ≤ 20 KB |
| `Sol2Moon_token.jpg` | **152 KB** | Duplicate token image |

Total unoptimized image weight: **~2.6 MB**. This alone will cause a poor Lighthouse score and slow initial load on mobile.

**Fix:**
- Convert all images to WebP or AVIF format
- Compress `headerweb.png` to under 200 KB (use https://squoosh.app)
- Reduce `favicon.png` to a 32×32 or 64×64 PNG under 10 KB
- Deduplicate `sol2moon-token.png` vs `Sol2Moon_token.jpg` — keep one

---

### 🟠 HIGH — No JS/CSS Minification or Bundling

The app ships raw, unminified source files directly to users:

| File | Raw Size |
|------|----------|
| `dashboard.js` | 150 KB |
| `i18n.js` | 104 KB |
| `safe-ape.js` | 119 KB |
| `watchlist.js` | 100 KB |
| `dashboard.css` | 86 KB |

A bundler + minifier (Vite, esbuild, or Parcel) would reduce these by 40–60% and enable tree-shaking to drop unused code entirely. This is the single biggest performance win available.

**Fix:** Add Vite as a build tool:
```bash
npm install -D vite
```
Configure `vite.config.js` with a multi-page build entry and run `vite build` before each deploy.

---

### 🟠 HIGH — No Asset Caching Headers

`netlify.toml` sets no `Cache-Control` headers. Netlify serves JS/CSS/images with default short-lived caching, meaning browsers re-download everything on each visit.

**Fix — add to `netlify.toml`:**
```toml
[[headers]]
  for = "/assets/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"

[[headers]]
  for = "/*.html"
  [headers.values]
    Cache-Control = "no-cache"
```

---

### 🟡 MEDIUM — External GitHub Raw Image Used for SOL Logo

Both `index.html` and `dashboard.html` load the Solana logo from:
```
https://raw.githubusercontent.com/solana-labs/token-list/main/assets/...
```

`raw.githubusercontent.com` is not a CDN — it has no edge caching, is rate-limited, and can be slow or unavailable. This image loads on the homepage.

**Fix:** Download the SVG/PNG and serve it locally from your own domain.

---

### 🟡 MEDIUM — No Lazy Loading on Images

No `loading="lazy"` attributes are present on any `<img>` tag. All images load eagerly on page render.

**Fix:** Add `loading="lazy"` to all images that are below the fold.

---

### 🟢 PASS — Redis + Neon Caching Architecture

The serverless functions use a two-layer cache (Upstash Redis TTL → Neon PostgreSQL fallback) that keeps Birdeye/Helius API calls minimal. The `warmCache` scheduled function running every 2 minutes ensures popular tokens are always fresh. This is well-designed.

---

## 3. Code Quality

### 🔴 CRITICAL — Viewport Meta Tag Missing on 11 of 14 Pages

Only `about.html`, `guide.html`, and `guide-risk-scanner.html` include:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
```

The following pages are **missing it entirely**, which means they render at desktop scale on mobile — completely broken for smartphone users:

`index.html`, `dashboard.html`, `academy.html`, `entry-radar.html`, `leaderboard.html`, `portfolio.html`, `risk-scanner.html`, `safe-ape.html`, `tasks.html`, `watchlist.html`, `whale-dna.html`

**Fix:** Add to the `<head>` of every page immediately:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
```

---

### 🟠 HIGH — 87 `console.log/warn/error` Calls Left in Production Frontend

There are 87 debug logging statements scattered across all frontend JS files. These:
- Leak internal data structures and API responses to any user who opens DevTools
- Marginally impact runtime performance
- Look unprofessional to technical users

**Fix:** Strip console statements during the build process using Vite's `drop: ['console']` option, or wrap them in a `DEBUG` flag:
```js
const DEBUG = false;
if (DEBUG) console.log(...);
```

---

### 🟠 HIGH — Missing `alt` Attributes on Images

Several `<img>` tags across HTML files are missing `alt` attributes, which is an accessibility failure (WCAG 2.1 criterion 1.1.1):

- `about.html` — 2 instances (token logo images)
- `dashboard.html` — 1 instance (SOL chain logo)
- `index.html` — 1 instance (SOL chain logo)
- `watchlist.html` — 2 instances (placeholder logos)

**Fix:** Add descriptive `alt` text to all images, or `alt=""` for purely decorative ones.

---

### 🟡 MEDIUM — No Build Pipeline / Raw Source Serving

The project ships source files directly — no transpilation, no dead code elimination, no tree-shaking. `i18n.js` is 104 KB of raw JavaScript translation strings that could be split per-locale and loaded on demand.

**Fix:** As noted in Performance, adopting Vite solves this. Even just running `esbuild` (already available since Netlify uses it for functions) would help significantly.

---

### 🟡 MEDIUM — `placeholder` Images from `placehold.co` in Production Code

`watchlist.html` references `https://placehold.co/40x40` as `src` for two `<img>` elements. These are development placeholders that made it into production and will render as grey boxes for users.

**Fix:** Replace with a proper default token logo SVG or a local fallback image.

---

### 🟡 MEDIUM — Duplicate/Dead Image Files

`Sol2Moon_token.jpg` (152 KB) and `sol2moon-token.png` (307 KB) appear to be the same asset in two formats. Similarly `favicon.png` and `favicon1.png` exist (both large). Consolidate to avoid serving stale or incorrect assets.

---

### 🟢 PASS — Serverless Function Architecture

The split between frontend and Netlify serverless functions is clean and correct. All third-party API calls happen server-side. The shared `db.js` module for Redis/Neon access avoids code duplication. The `warmCache` cron job is a smart pattern for a DeFi app where token data freshness matters.

### 🟢 PASS — Error Handling Present

61 `try/catch` and `.catch()` blocks exist across the codebase, with graceful fallback states shown to users (spinner → error message → retry button pattern). This is solid.

### 🟢 PASS — OG / Twitter Meta Tags

`index.html` has complete Open Graph and Twitter Card meta tags. Social sharing will work correctly for the homepage.

---

## Priority Fix List

| Priority | Issue | Effort |
|----------|-------|--------|
| 🔴 1 | Add HTTP security headers to `netlify.toml` | 15 min |
| 🔴 2 | Add viewport meta tag to all 11 pages | 10 min |
| 🔴 3 | Compress/optimize images (esp. headerweb.png, favicon.png) | 30 min |
| 🔴 4 | Lock CORS from `"*"` to `"https://scan2moon.com"` | 20 min |
| 🟠 5 | Add SRI hashes + pin CDN script versions | 30 min |
| 🟠 6 | Add rate limiting to all serverless functions | 45 min |
| 🟠 7 | Fix missing alt attributes on images | 15 min |
| 🟠 8 | Remove/guard 87 console.log statements | 20 min |
| 🟠 9 | Replace placehold.co images with real fallbacks | 10 min |
| 🟡 10 | Set `Cache-Control` headers in netlify.toml | 10 min |
| 🟡 11 | Replace raw.githubusercontent.com SOL logo with local file | 5 min |
| 🟡 12 | Add Vite build pipeline for minification | 2–3 hrs |

---

*Report generated April 20, 2026 — Scan2Moon v2.0*
