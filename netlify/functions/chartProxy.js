// netlify/functions/chartProxy.js
//
// ⛔ DEPRECATED — DexScreener chart scraping has been REMOVED.
//
// All OHLCV chart data now comes exclusively from Birdeye via:
//   - /.netlify/functions/geckoProxy  (Birdeye /defi/ohlcv — real-time, any TF)
//   - /.netlify/functions/ohlcvData   (Birdeye /defi/ohlcv with Redis+Neon 3-layer cache)
//
// This stub returns a 410 Gone so any stale callers get a clear signal to update.

const { CORS } = require("./db");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };

  console.warn("[chartProxy] Called but deprecated — all chart data must use geckoProxy or ohlcvData (Birdeye).");

  return {
    statusCode: 410,
    headers: CORS,
    body: JSON.stringify({
      ok:    false,
      error: "chartProxy removed. Use /.netlify/functions/ohlcvData or /.netlify/functions/geckoProxy for Birdeye OHLCV.",
      ohlcv: [],
      count: 0,
    }),
  };
};
