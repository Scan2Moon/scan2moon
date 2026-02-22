export async function callRpc(method, params = []) {
  try {
    const response = await fetch("/.netlify/functions/helius", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ method, params }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Proxy HTTP error: ${response.status} - ${text}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.message || "RPC error");
    }

    return data.result;

  } catch (error) {
    console.error("RPC proxy call failed:", error);
    throw error;
  }
}