const _DEBUG = false;

// lpLock.js — Liquidity detection
// Uses Birdeye data from the scanData singleton (already cached from the scan).
// Falls back to the tokenData serverless function (also Birdeye) if scanData isn't populated yet.

import { getScanData } from "./scanData.js";

export async function detectLiquidity(mint) {
  // ── Primary: Birdeye via scanData singleton (no extra API call) ──────────
  try {
    const data = await getScanData(mint);
    const pair = data?.pair;
    if (pair) {
      const liq = pair.liquidity?.usd ?? 0;
      if (!liq) return "No Liquidity Found";
      const formatted = Number(liq).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      // Try to show a real DEX name if available
      const dexLabel = pair._dexSource || "DEX";
      return `$${formatted} (${dexLabel})`;
    }
  } catch (e) { _DEBUG && console.warn("[lpLock] scanData lookup failed:", e.message); }

  // ── Fallback: tokenData serverless function (Birdeye) ───────────────────
  try {
    const res  = await fetch(`/.netlify/functions/tokenData?mint=${encodeURIComponent(mint)}`, {
      signal: AbortSignal.timeout(7000),
    });
    const data = await res.json();
    if (!data.ok || !data.token) return "No Liquidity Found";

    const liq = parseFloat(data.token.liquidity ?? 0);
    if (!liq) return "No Liquidity Found";

    const formatted = liq.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return `$${formatted} (Birdeye)`;
  } catch (e) {
    _DEBUG && console.warn("[lpLock] Birdeye tokenData fallback failed:", e);
    return "Unknown";
  }
}
