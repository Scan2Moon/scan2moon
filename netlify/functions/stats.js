/* ===================================================
   Scan2Moon – stats.js  (Netlify Function)
   Location: netlify/functions/stats.js

   Uses @netlify/blobs when available (live Netlify).
   Falls back to file-based store for local dev —
   same .netlify/local-store.json used by simulator.js
   so stats persist across serverless invocations.
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
const LOCAL_DB = path.join(process.cwd(), ".netlify", "local-store.json");

function respond(code, body) {
  return { statusCode: code, headers: CORS, body: JSON.stringify(body) };
}

/* ── File-based local store (same pattern as simulator.js) ── */
function readLocalDB() {
  try {
    if (fs.existsSync(LOCAL_DB)) return JSON.parse(fs.readFileSync(LOCAL_DB, "utf8"));
  } catch {}
  return {};
}
function writeLocalDB(db) {
  try {
    fs.mkdirSync(path.dirname(LOCAL_DB), { recursive: true });
    fs.writeFileSync(LOCAL_DB, JSON.stringify(db, null, 2));
  } catch (e) {
    console.warn("writeLocalDB error:", e.message);
  }
}

/* ── Try to load @netlify/blobs — only on live Netlify ── */
function getBlobs() {
  try { return require("@netlify/blobs"); } catch { return null; }
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") return respond(200, {});

  const blobs  = getBlobs();
  // NETLIFY_DEV=true is injected by `netlify dev` (local). On live Netlify it is NOT set.
  // We only use Blob storage on live; local dev always uses the file-based store.
  const isLive = !!blobs && !!process.env.NETLIFY_BLOBS_CONTEXT && !process.env.NETLIFY_DEV;

  try {
    let stats = { ...DEFAULT };

    if (isLive) {
      /* ── LIVE NETLIFY: persistent blob storage ── */
      const store = blobs.getStore("scan2moon");
      try {
        const raw = await store.get(BLOB_KEY);
        if (raw) stats = { ...DEFAULT, ...JSON.parse(raw) };
      } catch {}

      if (event.httpMethod === "POST") {
        let body = {};
        try { body = JSON.parse(event.body || "{}"); } catch {}
        const t = body.type;
        if (t === "visit")  stats.visits  = (stats.visits  || 0) + 1;
        if (t === "scan")   stats.scans   = (stats.scans   || 0) + 1;
        if (t === "share")  stats.shares  = (stats.shares  || 0) + 1;
        if (t === "moon")   stats.moon    = (stats.moon    || 0) + 1;
        await store.set(BLOB_KEY, JSON.stringify(stats));
      }

    } else {
      /* ── LOCAL DEV: file-based persistent store ── */
      const db = readLocalDB();
      stats = { ...DEFAULT, ...(db.__stats || {}) };

      if (event.httpMethod === "POST") {
        let body = {};
        try { body = JSON.parse(event.body || "{}"); } catch {}
        const t = body.type;
        if (t === "visit")  stats.visits  = (stats.visits  || 0) + 1;
        if (t === "scan")   stats.scans   = (stats.scans   || 0) + 1;
        if (t === "share")  stats.shares  = (stats.shares  || 0) + 1;
        if (t === "moon")   stats.moon    = (stats.moon    || 0) + 1;
        db.__stats = stats;
        writeLocalDB(db);
      }
    }

    return respond(200, stats);

  } catch (err) {
    console.error("Stats error:", err);
    return respond(200, DEFAULT);
  }
};