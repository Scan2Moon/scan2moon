// netlify/functions/db.js
// Shared Neon Postgres client + Upstash Redis helpers.
// Both use pure HTTP — no TCP connections, perfect for serverless.

const { neon } = require("@neondatabase/serverless");

/* ── Neon Postgres ─────────────────────────────────────────────
   Returns a tagged-template sql function connected to Neon.
   Usage:
     const sql = getDb();
     const rows = await sql`SELECT * FROM token_cache WHERE mint = ${mint}`;
   ──────────────────────────────────────────────────────────── */
function getDb() {
  if (!process.env.NEON_DATABASE_URL) throw new Error("NEON_DATABASE_URL not set");
  return neon(process.env.NEON_DATABASE_URL);
}

/* ── Upstash Redis (via REST — no npm package needed) ──────────
   L1 cache in front of Neon. Sub-millisecond reads for hot data.
   ──────────────────────────────────────────────────────────── */
const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redisGet(key) {
  if (!REDIS_URL) return null;
  try {
    const r = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
      signal: AbortSignal.timeout(1500),
    });
    if (!r.ok) return null;
    const { result } = await r.json();
    return result ? JSON.parse(result) : null;
  } catch { return null; }
}

async function redisSet(key, value, ttlSeconds = 60) {
  if (!REDIS_URL) return;
  try {
    const encoded = encodeURIComponent(JSON.stringify(value));
    await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}/${encoded}/ex/${ttlSeconds}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
      signal: AbortSignal.timeout(1500),
    });
  } catch { /* non-fatal — Neon is the source of truth */ }
}

async function redisDel(key) {
  if (!REDIS_URL) return;
  try {
    await fetch(`${REDIS_URL}/del/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
      signal: AbortSignal.timeout(1500),
    });
  } catch {}
}

/* ── Standard CORS headers ── */
// Locked to the production domain. Set ALLOWED_ORIGIN env var to override
// (e.g. "http://localhost:8888" during local Netlify Dev).
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://scan2moon.com";
const CORS = {
  "Content-Type":                "application/json",
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/* ── In-process rate limiter (fallback / low-overhead) ──────────────────────
   NOTE: This is process-local and resets on every Netlify cold start.
   For production traffic, use isRateLimitedRedis() below which is stateful
   across all function instances.  isRateLimited() is kept as a fast synchronous
   guard for lightweight endpoints where the Redis round-trip is not worth it.
   ────────────────────────────────────────────────────────────────────────── */
const _rlMap = new Map();

setInterval(() => {
  const cutoff = Date.now() - 60000;
  for (const [k, v] of _rlMap) {
    if (v.start < cutoff) _rlMap.delete(k);
  }
}, 300000).unref?.();

function isRateLimited(ip, maxRequests = 30, windowMs = 10000) {
  const now = Date.now();
  const key = ip || "unknown";
  if (!_rlMap.has(key)) {
    _rlMap.set(key, { count: 1, start: now });
    return false;
  }
  const entry = _rlMap.get(key);
  if (now - entry.start > windowMs) {
    _rlMap.set(key, { count: 1, start: now });
    return false;
  }
  entry.count++;
  return entry.count > maxRequests;
}

/* ── Redis-backed rate limiter (stateful across all Lambda instances) ─────────
   Uses Upstash INCR + EXPIRE via REST — survives cold starts, works across
   all concurrent function invocations.  ~3–5ms overhead per request.

   Usage:
     const limited = await isRateLimitedRedis(ip, 20, 10);
     if (limited) return { statusCode: 429, ... };
   ──────────────────────────────────────────────────────────────────────────── */
async function isRateLimitedRedis(ip, maxRequests = 30, windowSec = 10, fn = "") {
  // Never rate-limit localhost or private networks — dev requests share one IP and would self-block.
  // "unknown" is NOT exempted: all unknown-IP traffic shares one bucket so it still gets throttled.
  if (ip === "127.0.0.1" || ip === "::1" || ip.startsWith("192.168.") || ip.startsWith("10.")) return false;

  const KEY_URL   = process.env.UPSTASH_REDIS_REST_URL;
  const KEY_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!KEY_URL || !KEY_TOKEN) return false; // fail open if Redis not configured

  // Each function gets its own bucket so priceOnly calls don't eat into batchRisk's quota.
  const key = fn ? `rl2:${fn}:${ip}` : `rl2:${ip}`;
  try {
    const incrRes = await fetch(`${KEY_URL}/incr/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${KEY_TOKEN}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!incrRes.ok) return false;
    const { result: count } = await incrRes.json();

    if (count === 1) {
      await fetch(`${KEY_URL}/expire/${encodeURIComponent(key)}/${windowSec}`, {
        headers: { Authorization: `Bearer ${KEY_TOKEN}` },
        signal: AbortSignal.timeout(3000),
      });
    }
    return count > maxRequests;
  } catch {
    // Redis is down — fall back to in-process limiter so rate limiting stays active
    return isRateLimited(ip, maxRequests, windowSec * 1000);
  }
}

/* ── Standard 429 CORS headers (with Retry-After) ── */
const CORS_429 = { ...CORS, "Retry-After": "10" };

/* ── API Key validation ─────────────────────────────────────────
   Called by devWallet, lpPredictor, smartMoneyLeaderboard before
   serving data. Checks Postgres api_keys table, enforces daily
   plan limits, and increments usage counters (fire-and-forget).

   Resilience strategy (C-3):
     On every successful validation, the key's plan is written to Redis
     with a 2-hour TTL ("kvk:<keyId>"). If Neon is unavailable, that
     shadow cache is checked instead of failing open — only keys that
     have been used recently will pass. New/unknown keys fail closed.

     When a key is revoked, the negative cache is written with a 3-hour
     TTL — longer than the positive TTL — so revocation always wins.

   Returns:
     { valid:false, error, status }    -- bad/revoked/over-limit
     { valid:true,  plan, email }      -- authorised
   ────────────────────────────────────────────────────────────── */
const KEY_RE    = /^s2m_[0-9a-f]{32}$/;
const PLAN_DAILY = { starter: 100, indie: 3000, pro: 25000, power: 100000, enterprise: 1000000 };

/* Redis key prefixes */
const NEG_CACHE_PREFIX = "apik:";   // negative cache (invalid/revoked)
const POS_CACHE_PREFIX = "kvk:";    // positive shadow cache (valid key → plan)
const POS_CACHE_TTL    = 7200;      // 2 hours — outage fallback window
const NEG_REVOKE_TTL   = 10800;     // 3 hours — must outlast positive TTL

function extractKey(event) {
  // API key accepted only via header — NOT via query string.
  // Query params appear in server logs and Referer headers; keys must stay out of URLs.
  const h = (event.headers && (event.headers["x-api-key"] || event.headers["X-Api-Key"])) || "";
  return h.trim();
}

async function validateApiKey(keyId) {
  if (!keyId || !KEY_RE.test(keyId)) {
    return { valid: false, status: 401, error: "Invalid API key format. Keys must start with s2m_ followed by 32 hex chars." };
  }

  /* ── 1. Negative cache (revoked / not-found) — checked first ── */
  const negKey = NEG_CACHE_PREFIX + keyId;
  try {
    const hit = await redisGet(negKey);
    if (hit && !hit.valid) return hit;
  } catch {}

  /* ── 2. Query Neon ── */
  const sql = getDb();
  let row;
  try {
    const rows = await sql(
      "SELECT key_id, email, plan, active, daily_requests, daily_reset, total_requests FROM api_keys WHERE key_id = $1",
      [keyId]
    );
    row = rows[0];
  } catch (e) {
    // Neon is down — check the positive shadow cache before deciding.
    // Only keys used recently (within POS_CACHE_TTL) pass through; all others fail closed.
    console.error("[validateApiKey] Neon unavailable — checking Redis shadow cache:", e.message);
    const posKey = POS_CACHE_PREFIX + keyId;
    try {
      const shadow = await redisGet(posKey);
      if (shadow && shadow.plan) {
        console.warn("[validateApiKey] Serving from Redis shadow cache for key:", keyId.slice(0, 12) + "...");
        return { valid: true, plan: shadow.plan, email: shadow.email || null, failOpen: true };
      }
    } catch {}
    // Unknown key + Neon down = fail closed
    return { valid: false, status: 503, error: "Authentication service temporarily unavailable. Please retry in a few seconds." };
  }

  if (!row) {
    const r = { valid: false, status: 401, error: "API key not found." };
    try { await redisSet(negKey, r, 300); } catch {}
    return r;
  }
  if (!row.active) {
    // Use a long TTL for revocation so it outlasts any positive shadow cache entry
    const r = { valid: false, status: 401, error: "API key has been revoked." };
    try { await redisSet(negKey, r, NEG_REVOKE_TTL); } catch {}
    return r;
  }

  const limit = PLAN_DAILY[row.plan] || 5000;
  const today = new Date().toISOString().slice(0, 10);
  const resetDay = row.daily_reset ? String(row.daily_reset).slice(0, 10) : null;
  const dailyUsed = resetDay === today ? (row.daily_requests || 0) : 0;

  if (dailyUsed >= limit) {
    return { valid: false, status: 429, error: "Daily limit reached (" + limit + " req/day on " + row.plan + " plan). Resets at midnight UTC.", plan: row.plan, dailyLimit: limit, dailyUsed };
  }

  /* ── Fire-and-forget: increment usage counter + refresh shadow cache ── */
  sql(
    "UPDATE api_keys SET daily_requests = CASE WHEN daily_reset = CURRENT_DATE THEN daily_requests + 1 ELSE 1 END, daily_reset = CURRENT_DATE, total_requests = total_requests + 1, last_used_at = NOW() WHERE key_id = $1",
    [keyId]
  ).catch(function() {});

  // Write positive shadow cache — allows this key to pass during a short Neon outage
  redisSet(POS_CACHE_PREFIX + keyId, { plan: row.plan, email: row.email }, POS_CACHE_TTL).catch(function() {});

  return { valid: true, plan: row.plan, email: row.email, dailyLimit: limit, dailyUsed: dailyUsed + 1 };
}

/* CORS headers that also allow the X-Api-Key request header.
   Wildcard origin is intentional — this is a public API consumed by
   third-party developers who may build browser-based apps on top of it. */
const CORS_API = {
  "Content-Type":                  "application/json",
  "Access-Control-Allow-Origin":   "*",
  "Access-Control-Allow-Methods":  "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":  "Content-Type, X-Api-Key",
};

module.exports = {
  getDb,
  redisGet, redisSet, redisDel,
  CORS, CORS_429, CORS_API,
  isRateLimited, isRateLimitedRedis,
  extractKey, validateApiKey,
  PLAN_DAILY,
  NEG_CACHE_PREFIX, NEG_REVOKE_TTL,
};
