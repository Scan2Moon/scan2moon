/* ===================================================
   Scan2Moon – stats.js  (Netlify Function)

   Storage priority:
   1. Upstash Redis  (UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN)
      → Uses atomic INCR — impossible to wipe, no cold-start issues,
        no eventual consistency, token never expires.
   2. Netlify Blobs  (fallback when Redis not configured)
      → Uses backup key to protect against cold-start nulls.
   3. /tmp file store (local dev only)
=================================================== */

const fs   = require("fs");
const path = require("path");

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const DEFAULT  = { visits: 0, scans: 0, shares: 0, moon: 0 };
const LOCAL_DB = path.join("/tmp", "local-store.json");

function respond(code, body) {
  return { statusCode: code, headers: CORS, body: JSON.stringify(body) };
}

// ── Upstash Redis helpers ──────────────────────────────────────────────────
// Redis keys for each stat counter
const RK = { visit: "s2m:visits", scan: "s2m:scans", share: "s2m:shares", moon: "s2m:moon" };

async function redisPipeline(commands) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const res = await fetch(`${url}/pipeline`, {
    method:  "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body:    JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`Redis pipeline HTTP ${res.status}`);
  return res.json(); // array of { result } objects
}

// ── Blobs helpers (fallback) ───────────────────────────────────────────────
const BLOB_KEY   = "stats";
const BACKUP_KEY = "stats_bak";

function applyIncrement(stats, type) {
  if (type === "visit")  stats.visits  = (stats.visits  || 0) + 1;
  if (type === "scan")   stats.scans   = (stats.scans   || 0) + 1;
  if (type === "share")  stats.shares  = (stats.shares  || 0) + 1;
  if (type === "moon")   stats.moon    = (stats.moon    || 0) + 1;
  return stats;
}

// ── Local /tmp store (local dev only) ─────────────────────────────────────
function readLocalDB() {
  try {
    if (fs.existsSync(LOCAL_DB)) return JSON.parse(fs.readFileSync(LOCAL_DB, "utf8"));
  } catch {}
  return {};
}
function writeLocalDB(db) {
  try { fs.writeFileSync(LOCAL_DB, JSON.stringify(db, null, 2)); } catch {}
}

// ── Handler ───────────────────────────────────────────────────────────────
exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return respond(200, {});

  let body = {};
  if (event.httpMethod === "POST") {
    try { body = JSON.parse(event.body || "{}"); } catch {}
  }

  const isProduction  = !!process.env.NETLIFY_BLOBS_CONTEXT;
  const hasRedis      = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

  // ══════════════════════════════════════════════════════════════════════════
  // PATH 1 — Upstash Redis  (primary, most reliable)
  // Uses atomic INCR so counters can NEVER decrease or be wiped by a read-wipe bug.
  // ══════════════════════════════════════════════════════════════════════════
  if (hasRedis) {
    try {
      if (event.httpMethod === "POST" && RK[body.type]) {
        // Atomic increment: read + write in one command, zero race condition risk.
        const results = await redisPipeline([
          ["INCR", RK[body.type]],
          ["GET",  RK.visits],
          ["GET",  RK.scans],
          ["GET",  RK.shares],
          ["GET",  RK.moon],
        ]);
        // results[0] is the new value of the incremented key; [1-4] are current values.
        const stats = {
          visits: parseInt(results[1].result || "0"),
          scans:  parseInt(results[2].result || "0"),
          shares: parseInt(results[3].result || "0"),
          moon:   parseInt(results[4].result || "0"),
        };
        // Apply the just-incremented value (INCR already happened, GET might lag 1 cycle)
        if (body.type === "visit")  stats.visits  = parseInt(results[0].result);
        if (body.type === "scan")   stats.scans   = parseInt(results[0].result);
        if (body.type === "share")  stats.shares  = parseInt(results[0].result);
        if (body.type === "moon")   stats.moon    = parseInt(results[0].result);
        console.log("Stats Redis INCR OK:", JSON.stringify(stats));
        return respond(200, stats);
      } else {
        // GET: fetch all four counters in one pipeline call.
        const results = await redisPipeline([
          ["GET", RK.visits],
          ["GET", RK.scans],
          ["GET", RK.shares],
          ["GET", RK.moon],
        ]);
        const stats = {
          visits: parseInt(results[0].result || "0"),
          scans:  parseInt(results[1].result || "0"),
          shares: parseInt(results[2].result || "0"),
          moon:   parseInt(results[3].result || "0"),
        };
        console.log("Stats Redis GET OK:", JSON.stringify(stats));
        return respond(200, stats);
      }
    } catch (redisErr) {
      // Redis failed — fall through to Blobs
      console.error("Stats Redis error, falling back to Blobs:", redisErr.message);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PATH 2 — Netlify Blobs  (fallback)
  // ══════════════════════════════════════════════════════════════════════════
  try {
    const { getStore } = require("@netlify/blobs");
    const store = getStore("scan2moon-stats");

    let stats   = { ...DEFAULT };
    let rawNull = false;

    try {
      let raw = await store.get(BLOB_KEY, { consistency: "strong" });
      if (!raw) { await new Promise(r => setTimeout(r, 400)); raw = await store.get(BLOB_KEY, { consistency: "strong" }); }
      if (!raw) { await new Promise(r => setTimeout(r, 700)); raw = await store.get(BLOB_KEY, { consistency: "strong" }); }
      if (raw) { stats = { ...DEFAULT, ...JSON.parse(raw) }; }
      else     { rawNull = true; }
    } catch(readErr) {
      console.error("Stats Blobs read error:", readErr.message);
      if (isProduction) return respond(500, { error: "Stats read failed" });
    }

    if (rawNull && isProduction) {
      try {
        const bak = await store.get(BACKUP_KEY, { consistency: "strong" });
        if (bak) {
          stats   = { ...DEFAULT, ...JSON.parse(bak) };
          rawNull = false;
        } else {
          // Both null — if any counter was > 0 before, this is suspicious.
          // For safety, return 503 on POST so we never write zeros over real data.
          if (event.httpMethod === "POST") {
            console.warn("Stats: both keys null on POST — returning 503 to protect data");
            return respond(503, { error: "Stats temporarily unavailable, please retry" });
          }
        }
      } catch(bakErr) {
        console.warn("Stats: backup read failed, returning 503:", bakErr.message);
        return respond(503, { error: "Stats temporarily unavailable, please retry" });
      }
    }

    if (event.httpMethod === "POST") {
      stats = applyIncrement(stats, body.type);
      try {
        await store.set(BLOB_KEY, JSON.stringify(stats));
        try { await store.set(BACKUP_KEY, JSON.stringify(stats)); } catch {}
      } catch(writeErr) {
        console.error("Stats Blobs write failed:", writeErr.message);
      }
    }

    return respond(200, stats);

  } catch (blobErr) {
    if (isProduction) {
      console.error("Stats Blobs unavailable in production:", blobErr.message);
      return respond(503, { error: "Stats storage unavailable — please retry." });
    }
    console.warn("Blobs unavailable, using tmp store (local dev only):", blobErr.message);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PATH 3 — /tmp file store  (local dev only)
  // ══════════════════════════════════════════════════════════════════════════
  try {
    const db  = readLocalDB();
    let stats = { ...DEFAULT, ...(db.__stats || {}) };
    if (event.httpMethod === "POST") {
      stats = applyIncrement(stats, body.type);
      db.__stats = stats;
      writeLocalDB(db);
    }
    return respond(200, stats);
  } catch (err) {
    console.error("Stats fallback error:", err);
    return respond(200, DEFAULT);
  }
};
