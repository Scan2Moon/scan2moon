const DEXSCREENER_API = "https://api.dexscreener.com/latest/dex/tokens/";

export async function detectLiquidity(mint) {
  try {
    const res = await fetch(`${DEXSCREENER_API}${mint}`);
    const data = await res.json();

    if (!data.pairs || data.pairs.length === 0) {
      return "No Liquidity Found";
    }

    // For pump.fun tokens (mint ends in "pump"), exclude the bonding-curve pair
    // but KEEP PumpSwap (pump.fun's graduated AMM — dexId "pumpswap").
    // Only the bonding-curve has dexId "pump-fun"; PumpSwap is a real graduated pool.
    const isPump = mint.toLowerCase().endsWith("pump");
    const solanaPairs = data.pairs.filter(p => p.chainId === "solana");
    const BONDING_CURVE_IDS = ["pump-fun", "pumpfun"];
    const realDexPairs = isPump
      ? solanaPairs.filter(p => {
          const dex = String(p.dexId || "").toLowerCase().replace(/-/g, "");
          return !BONDING_CURVE_IDS.includes(dex);
        })
      : solanaPairs;
    const pool = realDexPairs.length > 0 ? realDexPairs : solanaPairs;
    const pair = pool.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0]
              || data.pairs[0];

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
