// netlify/functions/birdeyeWsKey.js
//
// RETIRED — 2026-04-29
//
// This endpoint previously vended the Birdeye API key to the browser so it
// could open a direct WebSocket connection to Birdeye's servers.
//
// It has been replaced by the secure server-proxy approach in birdeye-ws.js v3.0:
// all price data now flows through /.netlify/functions/priceOnly, which calls
// Birdeye server-side. The API key never reaches the browser.
//
// Returning 410 Gone so any stale browser cache entries get a clean,
// intentional error rather than silently failing.

const { CORS } = require("./db");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  return {
    statusCode: 410,
    headers: { ...CORS, "Cache-Control": "no-store" },
    body: JSON.stringify({
      ok:    false,
      error: "This endpoint has been retired. Price data now flows through the secure server-side proxy.",
    }),
  };
};
