const DEXSCREENER_API = "https://api.dexscreener.com/latest/dex/tokens/";

export async function detectLiquidity(mint) {
  try {
    const res = await fetch(`${DEXSCREENER_API}${mint}`);
    const data = await res.json();

    if (!data.pairs || data.pairs.length === 0) {
      return "No Liquidity Found";
    }

    // Prefer Solana pairs
    const pair =
      data.pairs.find(p => p.chainId === "solana") || data.pairs[0];

    const dex = pair.dexId;
    const liquidity = pair.liquidity?.usd;

    if (!liquidity) {
      return `Liquidity Found (${dex})`;
    }

    const formatted = Number(liquidity).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

    return `$${formatted} (${dex})`;
  } catch (e) {
    console.warn("Liquidity detection failed", e);
    return "Unknown";
  }
}
