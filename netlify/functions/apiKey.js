/* ================================================================
   DEPRECATED — this endpoint has been superseded by adminKey.js
   which supports the same actions plus GET-based listing and stats.

   All admin key management should go to:
     POST /.netlify/functions/adminKey   (with X-Admin-Secret header)
     GET  /.netlify/functions/adminKey   (with X-Admin-Secret header)
   ================================================================ */

exports.handler = async () => ({
  statusCode: 410,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    error: "This endpoint is deprecated. Use /.netlify/functions/adminKey instead.",
  }),
});
