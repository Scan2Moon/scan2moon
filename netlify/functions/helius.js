// netlify/functions/helius.js
// DECOMMISSIONED — this endpoint has been replaced.
// All data is now sourced exclusively from Birdeye API.
// Returns 410 Gone so any stale client calls fail loudly instead of silently.

exports.handler = async () => ({
  statusCode: 410,
  headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "https://scan2moon.com",
  },
  body: JSON.stringify({
    error: "This endpoint has been decommissioned. All data is now served via Birdeye API.",
  }),
});
