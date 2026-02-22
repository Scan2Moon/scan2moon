/* ===== CONFIG ===== */
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const RATE_LIMIT_WINDOW = 10000; // 10 seconds
const MAX_REQUESTS_PER_WINDOW = 40;

/* ===== SIMPLE RATE LIMIT ===== */
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

  if (entry.count > MAX_REQUESTS_PER_WINDOW) {
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
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    },
    body: JSON.stringify(body),
  };
}

/* ===== HANDLER ===== */
exports.handler = async function (event) {
  try {
    const method = event.httpMethod;

    // Handle preflight
    if (method === "OPTIONS") {
      return jsonResponse(200, {});
    }

    if (method !== "POST") {
      return jsonResponse(405, { error: "Method not allowed" });
    }

    const ip =
      event.headers["x-forwarded-for"] ||
      event.headers["client-ip"] ||
      "unknown";

    if (isRateLimited(ip)) {
      return jsonResponse(429, { error: "Too many requests" });
    }

    let body;

    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return jsonResponse(400, { error: "Invalid JSON body" });
    }

    const { method: rpcMethod, params = [] } = body;

    if (!rpcMethod || typeof rpcMethod !== "string") {
      return jsonResponse(400, { error: "Invalid RPC method" });
    }

    const HELIUS_KEY = process.env.HELIUS_KEY;
    if (!HELIUS_KEY) {
      return jsonResponse(500, { error: "Helius key not configured" });
    }

    /* ===== TIMEOUT PROTECTION ===== */
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const heliusResponse = await fetch(
      `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: rpcMethod,
          params,
        }),
        signal: controller.signal,
      }
    );

    clearTimeout(timeout);

    if (!heliusResponse.ok) {
      return jsonResponse(502, { error: "Upstream RPC error" });
    }

    const data = await heliusResponse.json();

    return jsonResponse(200, data);

  } catch (error) {
    console.error("Helius proxy error:", error);

    return jsonResponse(500, {
      error: "Internal proxy error",
    });
  }
};