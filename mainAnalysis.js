import { detectLiquidity } from "./lpLock.js";
import { callRpc } from "./rpc.js";

const DEXSCREENER_API = "https://api.dexscreener.com/latest/dex/tokens/";

function resolveImage(url) {
  if (!url) return null;
  if (url.startsWith("ipfs://")) return "https://ipfs.io/ipfs/" + url.replace("ipfs://", "");
  return url;
}

function formatMarketCap(num) {
  if (!num) return "N/A";
  if (num >= 1e12) return (num / 1e12).toFixed(2) + "T";
  if (num >= 1e9)  return (num / 1e9).toFixed(2) + "B";
  if (num >= 1e6)  return (num / 1e6).toFixed(2) + "M";
  if (num >= 1e3)  return (num / 1e3).toFixed(2) + "K";
  return num.toString();
}

async function fetchDexMetadata(mint) {
  try {
    const res = await fetch(`${DEXSCREENER_API}${mint}`);
    const data = await res.json();
    if (!data.pairs || data.pairs.length === 0) return null;
    // For pump.fun tokens exclude the bonding-curve pair but KEEP PumpSwap
    // (pump.fun's graduated AMM). Bonding curve has dexId "pump-fun"; PumpSwap is "pumpswap".
    const isPump = String(mint).toLowerCase().endsWith("pump");
    const solPairs = data.pairs.filter(p => p.chainId === "solana");
    const BONDING_CURVE_IDS = ["pump-fun", "pumpfun"];
    const realDexPairs = isPump
      ? solPairs.filter(p => {
          const dex = String(p.dexId || "").toLowerCase().replace(/-/g, "");
          return !BONDING_CURVE_IDS.includes(dex);
        })
      : solPairs;
    const pool = realDexPairs.length > 0 ? realDexPairs : solPairs;
    const pair = pool.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0]
              || data.pairs[0];
    const logo = resolveImage(pair.info?.imageUrl) || resolveImage(pair.baseToken?.logoURI) || resolveImage(pair.info?.openGraph?.image) || null;
    const marketCap = pair.marketCap || pair.fdv || null;
    return { name: pair.baseToken?.name || null, symbol: pair.baseToken?.symbol || null, logo, marketCap };
  } catch (e) { console.warn("DexScreener metadata failed", e); return null; }
}

export async function renderMainAnalysis(mint) {
  const mintKey = new solanaWeb3.PublicKey(mint);

  const mintInfo = await callRpc("getAccountInfo", [mintKey.toString(), { encoding: "jsonParsed", commitment: "confirmed" }]);
  const supplyInfo = await callRpc("getTokenSupply", [mintKey.toString(), { commitment: "confirmed" }]);

  if (!mintInfo) throw new Error("Invalid mint — account not found");

  const info        = mintInfo.value.data.parsed.info;
  const creator     = info.mintAuthority   || "Renounced";
  const freezeAuth  = info.freezeAuthority || "Renounced";
  const totalSupply = supplyInfo.value.uiAmountString ? Number(supplyInfo.value.uiAmountString) : 0;

  let devPercent = "N/A";
  if (creator && creator !== "Renounced") {
    try {
      const devAccountsRes = await callRpc("getTokenAccountsByOwner", [creator, { mint: mintKey.toString() }, { commitment: "confirmed" }]);
      if (devAccountsRes.value && devAccountsRes.value.length > 0) {
        const tokenAcc = devAccountsRes.value[0].account.data.parsed.info;
        const devAmount = Number(tokenAcc.tokenAmount.uiAmount || 0);
        const devPct = totalSupply > 0 ? (devAmount / totalSupply) * 100 : 0;
        devPercent = devPct.toFixed(1) + "%";
      } else { devPercent = "0.0%"; }
    } catch (err) { console.warn("Dev holdings fetch failed:", err); devPercent = "N/A"; }
  } else { devPercent = "Renounced"; }

  // ✅ Expose for Dev History panel
  window.scanDevPercent = devPercent;
  window.scanCreator    = creator;
  window.scanFreezeAuth = freezeAuth;
  window.scanMint       = mint;

  let name = "Unknown Token", symbol = "N/A", logo = "https://placehold.co/80x80", marketCap = "N/A";
  const dexMeta = await fetchDexMetadata(mint);
  if (dexMeta) {
    name = dexMeta.name || name; symbol = dexMeta.symbol || symbol;
    logo = dexMeta.logo || logo;
    marketCap = dexMeta.marketCap ? formatMarketCap(dexMeta.marketCap) : marketCap;
  }

  window.scanTokenMeta = { name, symbol, logo };
  const liquidityStatus = await detectLiquidity(mint);

  document.getElementById("mainAnalysis").innerHTML = `
    <div class="main-analysis">
      <div class="analysis-table">
        <div class="row"><span>Name</span><strong class="value">${name}</strong></div>
        <div class="row"><span>Symbol</span><strong class="value">${symbol}</strong></div>
        <div class="row"><span>Total Supply</span><strong class="value">${totalSupply.toLocaleString()}</strong></div>
        <div class="row"><span>Market Cap</span><strong class="value">${marketCap}</strong></div>
        <div class="row"><span>Creator Wallet</span><strong class="value">${creator}</strong></div>
        <div class="row"><span>Liquidity</span><strong class="value">${liquidityStatus}</strong></div>
      </div>
      <div class="token-logo-frame">
        <img src="${logo}" referrerpolicy="no-referrer" onerror="this.src='https://placehold.co/80x80'" />
      </div>
    </div>
  `;
}