// scanData.js — Shared scan data singleton
// All scanner modules (mainAnalysis, scanSignals, tokenStats) call getScanData()
// instead of hitting DexScreener independently.
// ONE Birdeye backend call feeds the entire scan. Result cached for 30s.

const SCAN_API = "/.netlify/functions/scanToken";
let _cache = {};   // mint → { data, ts }

export async function prefetchScanData(mint) {
  // Always re-fetch fresh data at the start of a new scan
  delete _cache[mint];
  return getScanData(mint);
}

export async function getScanData(mint) {
  const now = Date.now();
  if (_cache[mint] && (now - _cache[mint].ts) < 30000) {
    return _cache[mint].data;
  }

  const res = await fetch(`${SCAN_API}?mint=${encodeURIComponent(mint)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.error || `scanToken failed (${res.status})`);
  }

  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "scanToken returned not-ok");

  _cache[mint] = { data, ts: now };
  return data;
}
