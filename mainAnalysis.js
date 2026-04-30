// mainAnalysis.js — Token metadata + authority panel
// All data: Birdeye via /.netlify/functions/tokenSecurity and tokenData
// Replaces: callRpc("getAccountInfo") + callRpc("getTokenSupply") via Helius.
// Replaces: DexScreener API for name/logo/marketcap.

import { detectLiquidity } from "./lpLock.js";
import { esc } from "./utils.js";

const TOKEN_SECURITY_API = "/.netlify/functions/tokenSecurity";
const TOKEN_DATA_API     = "/.netlify/functions/tokenData";

function formatMarketCap(num) {
  if (!num) return "N/A";
  if (num >= 1e12) return (num / 1e12).toFixed(2) + "T";
  if (num >= 1e9)  return (num / 1e9).toFixed(2) + "B";
  if (num >= 1e6)  return (num / 1e6).toFixed(2) + "M";
  if (num >= 1e3)  return (num / 1e3).toFixed(2) + "K";
  return num.toString();
}

export async function renderMainAnalysis(mint) {
  // Fetch security data + token metadata in parallel — both from Birdeye
  const [secRes, tokenRes] = await Promise.all([
    fetch(`${TOKEN_SECURITY_API}?mint=${encodeURIComponent(mint)}`).catch(() => null),
    fetch(`${TOKEN_DATA_API}?mint=${encodeURIComponent(mint)}`).catch(() => null),
  ]);

  const secJson   = secRes?.ok   ? await secRes.json()   : null;
  const tokenJson = tokenRes?.ok ? await tokenRes.json() : null;

  const sec = secJson?.ok ? secJson : null;
  const tok = tokenJson?.ok ? tokenJson.token : null;

  if (!sec && !tok) throw new Error("Token data unavailable — check mint address");

  // ── Authority / supply data (from tokenSecurity → Birdeye) ──
  const mintAuth    = sec?.mintAuthority   ?? "Unknown";
  const freezeAuth  = sec?.freezeAuthority ?? "Unknown";
  const totalSupply = sec?.totalSupply     ? Number(sec.totalSupply).toLocaleString() : "N/A";
  const creator     = sec?.creatorAddress  ?? mintAuth;
  const devPct      = sec?.creatorPercent  != null
    ? sec.creatorPercent.toFixed(1) + "%"
    : "N/A";

  // ── Metadata (from tokenData → Birdeye) ──
  const name       = tok?.name      || "Unknown Token";
  const symbol     = tok?.symbol    || "N/A";
  const logo       = tok?.logoUri   || "https://placehold.co/80x80";
  const marketCap  = tok?.marketCap ? formatMarketCap(tok.marketCap) : "N/A";

  // ── Expose globals for other panels (Dev History, risk scorer, etc.) ──
  window.scanCreator    = creator;
  window.scanFreezeAuth = freezeAuth;
  window.scanDevPercent = devPct;
  window.scanMint       = mint;
  window.scanTokenMeta  = { name, symbol, logo };

  const liquidityStatus = await detectLiquidity(mint);

  document.getElementById("mainAnalysis").innerHTML = `
    <div class="main-analysis">
      <div class="analysis-table">
        <div class="row"><span>Name</span><strong class="value">${esc(name)}</strong></div>
        <div class="row"><span>Symbol</span><strong class="value">${esc(symbol)}</strong></div>
        <div class="row"><span>Total Supply</span><strong class="value">${esc(totalSupply)}</strong></div>
        <div class="row"><span>Market Cap</span><strong class="value">${esc(marketCap)}</strong></div>
        <div class="row"><span>Mint Authority</span><strong class="value">${esc(mintAuth)}</strong></div>
        <div class="row"><span>Freeze Authority</span><strong class="value">${esc(freezeAuth)}</strong></div>
        <div class="row"><span>Creator Wallet</span><strong class="value" style="font-size:10px;word-break:break-all">${esc(creator)}</strong></div>
        <div class="row"><span>Dev Holdings</span><strong class="value">${esc(devPct)}</strong></div>
        <div class="row"><span>Liquidity</span><strong class="value">${esc(String(liquidityStatus))}</strong></div>
      </div>
      <div class="token-logo-frame">
        <img src="${esc(logo)}" referrerpolicy="no-referrer" onerror="this.src='https://placehold.co/80x80'" />
      </div>
    </div>
  `;
}
