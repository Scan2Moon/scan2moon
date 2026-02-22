import { callRpc } from "./rpc.js";
// ────────────────────────────────────────────────
// We expect callRpc to be available globally (imported/defined in script.js)
// ────────────────────────────────────────────────

export async function renderHolders(mint) {
  const container = document.getElementById("holdersTable");
  container.innerHTML = "Loading holders...";

  try {
    const mintKey = new solanaWeb3.PublicKey(mint);

    // Use proxy calls instead of direct connection
    const supplyInfo = await callRpc("getTokenSupply", [
      mintKey.toString(),
      { commitment: "confirmed" }
    ]);

    const decimals = supplyInfo.value.decimals;
    // Use uiAmountString if available (more precise), fallback to raw amount calculation
    const totalSupply = supplyInfo.value.uiAmountString
      ? Number(supplyInfo.value.uiAmountString)
      : Number(supplyInfo.value.amount) / 10 ** decimals;

    const accountsResponse = await callRpc("getTokenLargestAccounts", [
      mintKey.toString(),
      { commitment: "confirmed" }
    ]);

    container.innerHTML = "";

    // Slice to top 15 holders
    accountsResponse.value.slice(0, 15).forEach((acc, i) => {
      const rawAmount = Number(acc.amount);
      const amount = rawAmount / 10 ** decimals;
      const percent = totalSupply > 0 ? (amount / totalSupply) * 100 : 0;
      const address = acc.address.toString();

      container.innerHTML += `
        <div class="holder-row">
          <span>#${i + 1}</span>
          <a 
            href="https://solscan.io/account/${address}" 
            target="_blank" 
            rel="noopener noreferrer"
            class="holder-link"
          >
            ${shortAddress(address)}
          </a>
          <span>${percent.toFixed(2)}%</span>
          <span>${formatAmount(amount)}</span>
        </div>
      `;
    });

    if (accountsResponse.value.length === 0) {
      container.innerHTML = "<div>No large holders found.</div>";
    }

  } catch (e) {
    console.error("Failed to load holders:", e);
    container.innerHTML = "Failed to load holders. Check console for details.";
  }
}

/* ===== HELPERS ===== */

function shortAddress(addr) {
  return addr.slice(0, 4) + "..." + addr.slice(-4);
}

function formatAmount(num) {
  if (num >= 1e12) return (num / 1e12).toFixed(2) + "T";
  if (num >= 1e9) return (num / 1e9).toFixed(2) + "B";
  if (num >= 1e6) return (num / 1e6).toFixed(2) + "M";
  if (num >= 1e3) return (num / 1e3).toFixed(2) + "K";
  return num.toFixed(2);
}