const { getStore } = require("@netlify/blobs");

/* ===== CONFIG ===== */
const ALLOWED_TYPES = ["visit", "scan", "share", "moon"];
const RATE_LIMIT_WINDOW = 10000; // 10 seconds
const MAX_ACTIONS_PER_WINDOW = 20;

/* ===== SIMPLE IN-MEMORY RATE LIMIT (per function instance) ===== */
const rateLimitMap = new Map();

function isRateLimited(ip) {
  const now = Date.now();

  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, { count: 1, start: now });
    return false;
  }

  const entry = rateLimitMap.get(ip);

  if (now - entry.start > RATE_LIMIT_WINDOW) {
    rateLimitMap.set(ip, { count: 1, start: now });
    return false;
  }

  entry.count++;

  if (entry.count > MAX_ACTIONS_PER_WINDOW) {
    return true;
  }

  return false;
}

/* ===== RESPONSE HELPER ===== */
function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    },
    body: JSON.stringify(body),
  };
}

/* ===== HANDLER ===== */
exports.handler = async function (event) {
  try {
    const method = event.httpMethod;

    // Handle CORS preflight
    if (method === "OPTIONS") {
      return jsonResponse(200, {});
    }

    if (!["GET", "POST"].includes(method)) {
      return jsonResponse(405, { error: "Method not allowed" });
    }

    const ip =
      event.headers["x-forwarded-for"] ||
      event.headers["client-ip"] ||
      "unknown";

    if (isRateLimited(ip)) {
      return jsonResponse(429, { error: "Too many requests" });
    }

    const store = getStore("scan2moonStats");

    let globalStats =
      (await store.getJSON("global")) || {
        visits: 0,
        scans: 0,
        shares: 0,
        moon: 0,
      };

    if (method === "POST") {
      let body;

      try {
        body = JSON.parse(event.body || "{}");
      } catch {
        return jsonResponse(400, { error: "Invalid JSON body" });
      }

      if (!ALLOWED_TYPES.includes(body.type)) {
        return jsonResponse(400, { error: "Invalid stat type" });
      }

      // Increment safely
      globalStats[`${body.type}s`] =
        Number(globalStats[`${body.type}s`] || 0) + 1;

      await store.setJSON("global", globalStats);

      return jsonResponse(200, globalStats);
    }

    // GET
    return jsonResponse(200, globalStats);

  } catch (error) {
    console.error("Stats error:", error);

    return jsonResponse(500, {
      error: "Internal server error",
    });
  }
};