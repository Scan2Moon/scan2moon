export async function callRpc(method, params = [], _retry = 0) {
  try {
    const response = await fetch("/.netlify/functions/helius", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, params }),
    });

    // Rate-limited or server-side transient error — retry with backoff
    if ((response.status === 429 || response.status === 502 || response.status === 503) && _retry < 3) {
      const delay = (2 ** _retry) * 400; // 400ms, 800ms, 1600ms
      await new Promise(r => setTimeout(r, delay));
      return callRpc(method, params, _retry + 1);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Proxy HTTP error: ${response.status} - ${text}`);
    }

    const data = await response.json();
    if (data.error) throw new Error(data.error.message || "RPC error");
    return data.result;

  } catch (error) {
    // Network error — retry with backoff
    if (_retry < 3 && (error.name === "TypeError" || error.message?.includes("fetch"))) {
      const delay = (2 ** _retry) * 400;
      await new Promise(r => setTimeout(r, delay));
      return callRpc(method, params, _retry + 1);
    }
    console.error("RPC proxy call failed:", error);
    throw error;
  }
}