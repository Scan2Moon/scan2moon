// holders.js — Token holder data via Birdeye (holderData serverless function)
// Replaces direct Helius RPC calls (getTokenLargestAccounts / getTokenSupply).
// All data from Birdeye /defi/v3/token/holder + token_overview — 100% Birdeye.

const _DEBUG = false;

export async function renderHolders(mint) {
  const container = document.getElementById("holdersTable");
  if (!container) return;
  container.innerHTML = "Loading holders…";

  try {
    const res  = await fetch(`/.netlify/functions/holderData?mint=${encodeURIComponent(mint)}`, {
      signal: AbortSignal.timeout(12000),
    });
    const data = await res.json();

    if (!data.ok) {
      if (data.planRestricted) {
        // top10Percent is still populated from token_overview even when list is restricted
        window.scanTop10 = data.top10Percent > 0
          ? data.top10Percent.toFixed(1) + "%"
          : "N/A";
        container.innerHTML = `<div class="holder-note">Top 10: ${window.scanTop10} · Full holder list requires Birdeye Standard plan.</div>`;
        return;
      }
      throw new Error(data.error || "Holder fetch failed");
    }

    const holders = data.holders || [];
    container.innerHTML = "";

    if (!holders.length) {
      window.scanTop10 = data.top10Percent > 0 ? data.top10Percent.toFixed(1) + "%" : "N/A";
      container.innerHTML = "<div>No holder data available.</div>";
      return;
    }

    holders.slice(0, 15).forEach((h, i) => {
      const owner = h.owner ?? "Unknown";
      container.innerHTML += `
        <div class="holder-row">
          <span>#${i + 1}</span>
          <a
            href="https://solscan.io/account/${owner}"
            target="_blank"
            rel="noopener noreferrer"
            class="holder-link"
          >${owner.slice(0, 4)}…${owner.slice(-4)}</a>
          <span>${Number(h.percentage).toFixed(2)}%</span>
          <span>${formatAmount(h.uiAmount)}</span>
        </div>
      `;
    });

    // Expose top-10 concentration for the final score card
    // top10Percent comes from token_overview (authoritative, matches Birdeye UI)
    window.scanTop10 = (data.top10Percent ?? 0).toFixed(1) + "%";

  } catch (e) {
    _DEBUG && console.error("holders.js: fetch failed:", e);
    container.innerHTML = "Failed to load holder data.";
    window.scanTop10 = "N/A";
  }
}

/* ── Helpers ── */
function formatAmount(num) {
  if (num >= 1e12) return (num / 1e12).toFixed(2) + "T";
  if (num >= 1e9)  return (num / 1e9).toFixed(2) + "B";
  if (num >= 1e6)  return (num / 1e6).toFixed(2) + "M";
  if (num >= 1e3)  return (num / 1e3).toFixed(2) + "K";
  return num.toFixed(2);
}
