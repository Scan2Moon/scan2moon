/* ===================================================
   Scan2Moon – stats.js  (Netlify Function)
   Location: netlify/functions/stats.js

   Tries @netlify/blobs first (live Netlify).
   Falls back to file-based store for local dev.
   Never crashes. Never throws a build error.
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
const BLOB_KEY = "stats";
const LOCAL_DB = path.join("/tmp", "local-store.json");

function respond(code, body) {
  return { statusCode: code, headers: CORS, body: JSON.stringify(body) };
}

/* ── Increment helper ── */
function applyIncrement(stats, type) {
  if (type === "visit")  stats.visits  = (stats.visits  || 0) + 1;
  if (type === "scan")   stats.scans   = (stats.scans   || 0) + 1;
  if (type === "share")  stats.shares  = (stats.shares  || 0) + 1;
  if (type === "moon")   stats.moon    = (stats.moon    || 0) + 1;
  return stats;
}

/* ── File-based local/tmp store ── */
function readLocalDB() {
  try {
    if (fs.existsSync(LOCAL_DB)) return JSON.parse(fs.readFileSync(LOCAL_DB, "utf8"));
  } catch {}
  return {};
}
function writeLocalDB(db) {
  try { fs.writeFileSync(LOCAL_DB, JSON.stringify(db, null, 2)); } catch {}
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return respond(200, {});

  let body = {};
  if (event.httpMethod === "POST") {
    try { body = JSON.parse(event.body || "{}"); } catch {}
  }

  /* ── Try Netlify Blobs first ── */
  try {
    const { getStore } = require("@netlify/blobs");
    const store = getStore("scan2moon-stats");

    let stats = { ...DEFAULT };
    try {
      const raw = await store.get(BLOB_KEY, { consistency: "strong" });
      if (raw) stats = { ...DEFAULT, ...JSON.parse(raw) };
      else console.log("Stats Blobs: no data yet, starting from DEFAULT");
    } catch(readErr) {
      console.warn("Stats Blobs read error:", readErr.message);
    }

    if (event.httpMethod === "POST") {
      stats = applyIncrement(stats, body.type);
      try {
        await store.set(BLOB_KEY, JSON.stringify(stats));
        console.log("Stats Blobs write OK:", JSON.stringify(stats));
      } catch(writeErr) {
        // Write failed — log it but still return the incremented value.
        // Do NOT fall through to /tmp or the site-level data will be lost.
        console.error("Stats Blobs write failed:", writeErr.message);
      }
    }

    return respond(200, stats);

  } catch (blobErr) {
    console.warn("Blobs unavailable, using tmp store:", blobErr.message);
  }

  /* ── Fallback: /tmp file store (local dev) ── */
  try {
    const db    = readLocalDB();
    let stats   = { ...DEFAULT, ...(db.__stats || {}) };

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
