// netlify/functions/logoProxy.js
// Proxies token logo images to avoid CORS / CSP issues.
// On any failure (timeout, upstream error, blocked) → 302 to placeholder
// so the browser shows a clean fallback with zero console errors.

const PLACEHOLDER = "https://placehold.co/36x36/0a2a1e/2cffc9?text=%3F";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://scan2moon.com";

function redirect() {
  return {
    statusCode: 302,
    headers: {
      "Location": PLACEHOLDER,
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Cache-Control": "public, max-age=300",
    },
    body: "",
  };
}

exports.handler = async (event) => {
  const url = (event.queryStringParameters || {}).url;
  if (!url || !/^https?:\/\//i.test(url)) return redirect();

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; scan2moon-bot/1.0)",
        "Accept": "image/*,*/*;q=0.8",
      },
    });

    if (!response.ok) return redirect();

    const ct     = response.headers.get("content-type") || "image/png";
    const buffer = await response.arrayBuffer();
    if (!buffer.byteLength) return redirect();

    return {
      statusCode: 200,
      headers: {
        "Content-Type": ct,
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=3600",
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      },
      body: Buffer.from(buffer).toString("base64"),
      isBase64Encoded: true,
    };
  } catch {
    return redirect();
  }
};
