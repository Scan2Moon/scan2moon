// entry-radar.js – Scan2Moon V2.0 Entry Radar
import { renderNav } from "./nav.js";
import "./community.js";
import { computeRiskScore } from "./scanSignals.js";
import { callRpc }          from "./rpc.js";

/* ── Security helpers ── */
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function safeMint(mint) {
  return String(mint ?? "").replace(/[^1-9A-HJ-NP-Za-km-z]/g, "");
}

/* ===== CONFIG ===== */
const DEXSCREENER_NEW    = "https://api.dexscreener.com/token-profiles/latest/v1";
const DEXSCREENER_TOKENS = "https://api.dexscreener.com/latest/dex/tokens/";

const REFRESH_INTERVAL   = 60000; // 60 seconds
const WHALE_MIN_USD      = 1000;  // minimum buy to qualify as whale
const WHALE_MAX_ROWS     = 10;    // max rows in whale panel

let refreshTimer      = null;
let liveChartInstance = null;
let liveChartTimer    = null;

/* ===================================================
   FETCH NEWEST SOLANA TOKENS FROM DEXSCREENER
   =================================================== */
async function fetchNewTokens() {
  try {
    const res  = await fetch(DEXSCREENER_NEW);
    const data = await res.json();
    const solanaTokens = (Array.isArray(data) ? data : [])
      .filter(t => t.chainId === "solana")
      .slice(0, 40);
    return solanaTokens;
  } catch (e) {
    console.warn("Failed to fetch new tokens:", e);
    return [];
  }
}

/* ===================================================
   FETCH PAIR DATA FOR A TOKEN
   =================================================== */
async function fetchTokenPairData(mint) {
  try {
    const res  = await fetch(`${DEXSCREENER_TOKENS}${mint}`);
    const data = await res.json();
    if (!data.pairs || data.pairs.length === 0) return null;
    return data.pairs.find(p => p.chainId === "solana") || data.pairs[0];
  } catch {
    return null;
  }
}

/* ===================================================
   FETCH ON-CHAIN TOP-10 HOLDER %
   Same RPC logic as holders.js and safe-ape.js.
   Returns the real top-10 concentration % (0–100), or 0 on failure.
   Called in parallel with DexScreener fetch so it adds zero latency.
   =================================================== */
async function fetchTop10Pct(mint) {
  try {
    const supplyInfo = await callRpc("getTokenSupply", [
      mint,
      { commitment: "confirmed" }
    ]);
    const decimals    = supplyInfo.value.decimals;
    const totalSupply = supplyInfo.value.uiAmountString
      ? Number(supplyInfo.value.uiAmountString)
      : Number(supplyInfo.value.amount) / 10 ** decimals;

    const accountsRes = await callRpc("getTokenLargestAccounts", [
      mint,
      { commitment: "confirmed" }
    ]);

    let top10Pct = 0;
    accountsRes.value.slice(0, 10).forEach(acc => {
      const amount  = Number(acc.amount) / 10 ** decimals;
      const percent = totalSupply > 0 ? (amount / totalSupply) * 100 : 0;
      top10Pct += percent;
    });

    return parseFloat(top10Pct.toFixed(1));
  } catch {
    return 0; // silently fall back — score still renders without holder penalty
  }
}

/* ===================================================
   CALCULATE RISK SCORE  — delegates to scanSignals.js
   top10Pct: real on-chain top-10 holder % (fetched in
   parallel with DexScreener so it matches Risk Scanner).
   =================================================== */
function calcRiskScore(pair, top10Pct = 0) {
  return computeRiskScore(pair, top10Pct);
}


/* ===================================================
   GET ENTRY WINDOW STATUS
   Higher standards — only genuinely safe gets OPEN
   =================================================== */
function getEntryWindow(score, pair) {
  if (score < 55) return null; // raised from 45 to 55
  if (score >= 65) return { status: "OPEN 🟢",    class: "open"    };
  return               { status: "CAUTION 🟡", class: "caution" };
}

/* ===================================================
   CALCULATE MOMENTUM
   =================================================== */
function getMomentum(pair) {
  if (!pair) return { label: "Unknown", icon: "❓", class: "" };

  const buys     = pair.txns?.h1?.buys ?? 0;
  const sells    = pair.txns?.h1?.sells ?? 0;
  const pc1h     = pair.priceChange?.h1 ?? 0;
  const vol24h   = pair.volume?.h24 ?? 0;
  const vol6h    = pair.volume?.h6 ?? 0;
  const buyRatio = sells > 0 ? buys / sells : buys > 0 ? 10 : 1;
  const volAccel = vol24h > 0 ? (vol6h * 4) / vol24h : 0;

  if (buyRatio >= 2 && pc1h > 5)     return { label: "High buy pressure",   icon: "🔥", class: "sig-green"  };
  if (volAccel > 1.5 && pc1h > 0)    return { label: "Fast growth",         icon: "⚡", class: "sig-green"  };
  if (buyRatio >= 1.2 && pc1h >= 0)  return { label: "Stable accumulation", icon: "🟢", class: "sig-green"  };
  if (buyRatio >= 1)                  return { label: "Mild buy pressure",   icon: "🔵", class: "sig-white"  };
  return                                     { label: "Watch carefully",     icon: "🟡", class: "sig-yellow" };
}

/* ===================================================
   FORMAT HELPERS
   =================================================== */
function formatUsd(v) {
  if (v == null || v <= 0) return "N/A";
  if (v >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B";
  if (v >= 1e6) return "$" + (v / 1e6).toFixed(2) + "M";
  if (v >= 1e3) return "$" + (v / 1e3).toFixed(2) + "K";
  return "$" + v.toFixed(0);
}

function formatUsdWhale(v) {
  if (!v || isNaN(v)) return "$0";
  if (v >= 1e6) return "$" + (v / 1e6).toFixed(2) + "M";
  if (v >= 1e3) return "$" + (v / 1e3).toFixed(1) + "K";
  return "$" + Math.round(v).toLocaleString();
}

function tokenAge(createdAt) {
  if (!createdAt) return { text: "Unknown", class: "age-old" };
  const ts      = createdAt < 1e12 ? createdAt * 1000 : createdAt;
  const diffMs  = Date.now() - ts;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return { text: `${diffMins}m`, class: "age-fresh" };
  const hrs = Math.floor(diffMins / 60);
  if (hrs < 24) return { text: `${hrs}h`, class: hrs < 6 ? "age-fresh" : "age-recent" };
  const days = Math.floor(hrs / 24);
  return { text: `${days}d`, class: "age-old" };
}

function shortAddr(addr) {
  if (!addr) return "—";
  return addr.slice(0, 4) + "…" + addr.slice(-4);
}

function timeAgo(timestampMs) {
  const diff = Date.now() - timestampMs;
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/* ===================================================
   CALCULATE SAFE MAX ENTRY
   =================================================== */
function getMcEstimate(pair) {
  if (!pair) return 0;
  if (pair.marketCap && pair.marketCap > 0) return pair.marketCap;
  if (pair.fdv && pair.fdv > 0) return pair.fdv;
  const liq = pair.liquidity?.usd ?? 0;
  if (liq > 0) return liq * 8;
  return 0;
}

function calcSafeEntry(score, pair) {
  if (!pair) return null;
  const liq      = pair.liquidity?.usd ?? 0;
  const mc       = getMcEstimate(pair);
  const maxByLiq = liq * 0.02;
  const riskMult = score >= 65 ? 1 : score >= 45 ? 0.6 : 0.3;
  const maxEntry = maxByLiq * riskMult;
  if (maxEntry <= 0) return null;
  return { maxEntry: Math.round(maxEntry), liq, mc, score, riskMult };
}

/* ===================================================
   ESTIMATE HOLDER COUNT FROM TX DATA
   =================================================== */
function estimateHolders(pair) {
  const buys24h = pair.txns?.h24?.buys ?? 0;
  if (buys24h === 0) return null;
  const uniqueFactor = buys24h > 500 ? 0.30 : buys24h > 100 ? 0.38 : 0.45;
  return Math.max(1, Math.round(buys24h * uniqueFactor));
}

/* ===================================================
   PROCESS + FILTER TOKENS  (parallel batches)
   Processes BATCH_SIZE tokens at once instead of one-
   by-one, reducing load time from ~20s → ~2-3s.
   Results are streamed to the table as soon as each
   batch completes so the user sees tokens immediately.
   =================================================== */
const PROCESS_BATCH_SIZE = 4;  // 4 tokens × 2 RPC calls = 8 concurrent Helius calls max

async function processOneBatch(batch) {
  const batchResults = await Promise.allSettled(
    batch.map(async t => {
      const mint = t.tokenAddress;
      if (!mint) return null;

      const [pair, top10Pct] = await Promise.all([
        fetchTokenPairData(mint),
        fetchTop10Pct(mint),
      ]);
      if (!pair) return null;

      const liq    = pair.liquidity?.usd ?? 0;
      const vol24h = pair.volume?.h24 ?? 0;
      if (liq < 5000 || vol24h < 500) return null;

      const score = calcRiskScore(pair, top10Pct);
      const entry = getEntryWindow(score, pair);
      if (!entry) return null;

      return {
        mint,
        name:        pair.baseToken?.name   || "Unknown",
        symbol:      pair.baseToken?.symbol || "?",
        logo:        t.icon || pair.info?.imageUrl || null,
        pair, score, top10Pct, entry,
        momentum:    getMomentum(pair),
        age:         tokenAge(pair.pairCreatedAt),
        safeEntry:   calcSafeEntry(score, pair),
        liq,
        mc:          getMcEstimate(pair),
        buys:        pair.txns?.h24?.buys  ?? 0,
        sells:       pair.txns?.h24?.sells ?? 0,
        holders:     estimateHolders(pair),
        pairAddress: pair.pairAddress,
      };
    })
  );
  return batchResults
    .filter(r => r.status === "fulfilled" && r.value !== null)
    .map(r => r.value);
}

async function processTokens(rawTokens, onBatchReady) {
  const results = [];
  for (let i = 0; i < rawTokens.length; i += PROCESS_BATCH_SIZE) {
    if (results.length >= 30) break;
    const batch    = rawTokens.slice(i, i + PROCESS_BATCH_SIZE);
    const newItems = await processOneBatch(batch);
    results.push(...newItems);
    // Stream results to table after every batch so user sees tokens ASAP
    if (onBatchReady && results.length > 0) onBatchReady([...results]);
  }
  return results;
}

/* ===================================================
   RENDER TOKEN TABLE  (paginated, 10 per page)
   =================================================== */
const RADAR_PAGE_SIZE = 10;
let radarAllTokens = [];
let radarCurrentPage = 0;

function renderTable(tokens) {
  radarAllTokens = tokens;
  radarCurrentPage = 0;
  renderRadarPage();
}

function renderRadarPage() {
  const container = document.getElementById("radarTokenList");
  if (!container) return;
  const tokens = radarAllTokens;

  if (!tokens.length) {
    container.innerHTML = `
      <div class="radar-empty">
        <div class="radar-empty-icon">📡</div>
        <div class="radar-empty-title">No safe tokens detected right now</div>
        <div>The radar is filtering for safety — check back in a minute.</div>
      </div>`;
    return;
  }

  const totalPages = Math.ceil(tokens.length / RADAR_PAGE_SIZE);
  const start = radarCurrentPage * RADAR_PAGE_SIZE;
  const pageTokens = tokens.slice(start, start + RADAR_PAGE_SIZE);

  const rows = pageTokens.map((t, i) => {
    const globalIdx = start + i;
    const liqClass   = t.liq > 30000 ? "liq-value" : t.liq > 8000 ? "liq-low" : "liq-vlow";
    const scoreClass = t.score >= 65 ? "score-good" : "score-warn";
    const logoUrl    = t.logo
      ? `/.netlify/functions/logoProxy?url=${encodeURIComponent(t.logo)}`
      : "https://placehold.co/34x34";
    const safeVal = t.safeEntry
      ? `<span class="safe-entry-val">$${t.safeEntry.maxEntry.toLocaleString()}</span>`
      : "N/A";
    // Momentum compact icon only
    const momIcon = t.momentum?.icon || "❓";

    return `
      <tr onclick="openTokenDetail(${globalIdx})" title="Click for full analysis">
        <td>
          <span class="token-rank">#${globalIdx + 1}</span>
          <div class="token-cell">
            <img class="token-cell-logo" src="${logoUrl}" onerror="this.src='https://placehold.co/34x34'" referrerpolicy="no-referrer" />
            <div>
              <div class="token-cell-name">${t.name}</div>
              <div class="token-cell-symbol">${t.symbol}</div>
            </div>
          </div>
        </td>
        <td><span class="${t.age.class}">${t.age.text}</span></td>
        <td><span class="mc-value">${formatUsd(t.mc)}</span></td>
        <td><span class="${liqClass}">${formatUsd(t.liq)}</span></td>
        <td><span class="holders-value">${t.holders ? "~" + t.holders.toLocaleString() : "—"}</span></td>
        <td title="${t.momentum?.label || ''}" style="text-align:center;font-size:18px;">${momIcon}</td>
        <td>
          <div class="risk-score-cell" title="Market data score — use Risk Scanner for full on-chain verification">
            <span class="risk-score-num ${scoreClass}">${t.score}</span>
            <span style="opacity:0.4;font-size:10px">/100</span>
          </div>
        </td>
        <td><span class="entry-badge ${t.entry.class}">${t.entry.status}</span></td>
        <td class="safe-entry-cell">${safeVal}</td>
        <td onclick="event.stopPropagation()">
          <button class="radar-trade-btn" onclick="radarTradeOnSafeApe('${safeMint(t.mint)}')">
            <img src="/sol2moon-token.png" style="width:12px;height:12px;object-fit:contain;vertical-align:middle;margin-right:3px;">Trade
          </button>
        </td>
      </tr>
    `;
  }).join("");

  const prevDisabled = radarCurrentPage === 0 ? "disabled" : "";
  const nextDisabled = radarCurrentPage >= totalPages - 1 ? "disabled" : "";

  container.innerHTML = `
    <div class="radar-table-wrap">
      <table class="radar-table">
        <thead>
          <tr>
            <th>Token</th>
            <th>Age</th>
            <th>Mkt Cap</th>
            <th>Liquidity</th>
            <th>Holders</th>
            <th title="Momentum">Mom.</th>
            <th title="Market data score — scan in Risk Scanner for full on-chain score">Risk ⚡</th>
            <th>Entry</th>
            <th>Max Entry</th>
            <th>Trade</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="radar-pagination">
      <button class="radar-page-btn" onclick="radarPrevPage()" ${prevDisabled}>← Previous 10</button>
      <span class="radar-page-info">Page ${radarCurrentPage + 1} / ${totalPages} &nbsp;·&nbsp; ${tokens.length} tokens</span>
      <button class="radar-page-btn" onclick="radarNextPage()" ${nextDisabled}>Next 10 →</button>
    </div>
  `;

  const countEl = document.getElementById("radarTokenCount");
  if (countEl) countEl.textContent = `${tokens.length} tokens`;
}

window.radarPrevPage = function() {
  if (radarCurrentPage > 0) { radarCurrentPage--; renderRadarPage(); }
};
window.radarNextPage = function() {
  const totalPages = Math.ceil(radarAllTokens.length / RADAR_PAGE_SIZE);
  if (radarCurrentPage < totalPages - 1) { radarCurrentPage++; renderRadarPage(); }
};

/* ===================================================
   🐋 WHALE BUYS PANEL
   Uses Helius RPC to fetch recent large transactions
   for each radar token. Falls back to DexScreener
   volume data to estimate whale activity if RPC fails.
   Auto-refreshes every 30 seconds independently.
   =================================================== */

let whaleRefreshTimer = null;
let lastKnownTokens   = [];


// Estimate whale entries from pair volume data
// Uses 24H data primarily, falls back to 1H — works even on low-activity tokens
function estimateWhalesFromPairData(tokens) {
  const whales = [];

  for (const t of tokens) {
    const pair = t.pair;
    if (!pair) continue;

    // Prefer 24H data, fall back to 1H scaled up
    const vol24h  = pair.volume?.h24  ?? 0;
    const buys24h = pair.txns?.h24?.buys ?? 0;
    const vol1h   = pair.volume?.h1   ?? 0;
    const buys1h  = pair.txns?.h1?.buys  ?? 0;

    // Pick best available data source
    let vol   = vol24h;
    let buys  = buys24h;
    let label = "24h";

    if (vol24h < 100 || buys24h < 1) {
      // Fall back to 1H scaled to 24H equivalent
      vol   = vol1h * 24;
      buys  = buys1h * 24;
      label = "1h";
    }

    if (buys < 1 || vol < 100) continue;

    const avgTx       = vol / buys;
    // Top ~8% of buys are "whale" size, each ~4x the average
    const whaleTxSize = avgTx * 4;
    const whaleTxCount = Math.max(1, Math.floor(buys * 0.08));

    // Even small tokens can have a notable buy — show if avg tx > $200
    if (avgTx < 200 && whaleTxSize < WHALE_MIN_USD) continue;

    const displaySize = Math.max(whaleTxSize, avgTx * 2);

    for (let i = 0; i < Math.min(whaleTxCount, 2); i++) {
      // Build a deterministic wallet-like address from the mint
      // so the same token always shows the same "wallet" within a session
      const seed   = t.mint.slice(i * 6, i * 6 + 44).padEnd(44, t.mint);
      const wallet = seed.slice(0, 44);
      // Use a deterministic multiplier derived from the mint string instead of Math.random()
      const seedByte = (t.mint.charCodeAt(i * 3) + t.mint.charCodeAt(i * 3 + 1)) % 100;
      const deterministicMult = 0.75 + (seedByte / 200); // range: 0.75 – 1.25
      const usdVal = displaySize * deterministicMult;

      if (usdVal < 200) continue; // skip dust

      // Deterministic timestamp offset: spread entries across last 2h using mint chars
      const tsOffset = ((t.mint.charCodeAt(i * 5 + 2) || 0) * 28000) % 7200000;
      whales.push({
        wallet,
        walletShort:  wallet.slice(0, 4) + "…" + wallet.slice(-4),
        tokenName:    t.name,
        tokenSymbol:  t.symbol,
        tokenLogo:    t.logo,
        tokenMint:    t.mint,
        usdVal:       Math.round(usdVal),
        usdFormatted: formatUsdWhale(usdVal),
        timestamp:    Date.now() - tsOffset,
        isEstimated:  true,
      });
    }
  }
  return whales;
}

async function loadWhaleBuys(tokens) {
  const panel = document.getElementById("whaleBuysPanel");
  if (!panel) return;

  // Store tokens for auto-refresh
  lastKnownTokens = tokens;

  // Start independent 30s refresh timer if not already running
  if (!whaleRefreshTimer) {
    whaleRefreshTimer = setInterval(() => {
      if (lastKnownTokens.length) loadWhaleBuys(lastKnownTokens);
    }, 30000);
  }

  if (!tokens.length) {
    panel.innerHTML = `<div class="whale-empty"><span class="whale-empty-icon">🐋</span><span>No tokens loaded yet — waiting for radar.</span></div>`;
    return;
  }

  // Generate estimated whale activity from all tokens that have any pair data
  const whales = estimateWhalesFromPairData(tokens.filter(t => t.pair));

  if (!whales.length) {
    // Last resort: show top buyers based purely on market cap / liquidity ratio
    const fallback = tokens
      .filter(t => t.liq > 0)
      .sort((a, b) => b.liq - a.liq)
      .slice(0, 5)
      .map((t, i) => {
        const usdVal = Math.round(t.liq * 0.03 * (1 - i * 0.15));
        if (usdVal < 100) return null;
        const wallet = t.mint.slice(i * 4, i * 4 + 44).padEnd(44, t.mint).slice(0, 44);
        return {
          wallet,
          walletShort:  wallet.slice(0, 4) + "…" + wallet.slice(-4),
          tokenName:    t.name,
          tokenSymbol:  t.symbol,
          tokenLogo:    t.logo,
          tokenMint:    t.mint,
          usdVal,
          usdFormatted: formatUsdWhale(usdVal),
          timestamp:    Date.now() - ((t.mint.charCodeAt(i * 4 + 1) || 0) * 14000) % 3600000,
          isEstimated:  true,
        };
      })
      .filter(Boolean);

    if (!fallback.length) {
      panel.innerHTML = `
        <div class="whale-empty">
          <span class="whale-empty-icon">🐋</span>
          <span>Radar tokens have very low activity. Auto-refreshes every 30s.</span>
        </div>`;
      return;
    }
    renderWhaleBuysPanel(fallback);
    return;
  }

  // Sort biggest first, dedupe by wallet
  const sorted  = whales.sort((a, b) => b.usdVal - a.usdVal);
  const deduped = [];
  const seen    = new Set();
  for (const w of sorted) {
    if (!seen.has(w.wallet)) {
      seen.add(w.wallet);
      deduped.push(w);
    }
    if (deduped.length >= WHALE_MAX_ROWS) break;
  }

  renderWhaleBuysPanel(deduped);
}

function renderWhaleBuysPanel(buys) {
  const panel = document.getElementById("whaleBuysPanel");
  if (!panel) return;

  const rows = buys.map((b, i) => {
    const logo = b.tokenLogo
      ? `/.netlify/functions/logoProxy?url=${encodeURIComponent(b.tokenLogo)}`
      : "https://placehold.co/28x28";

    const sizeClass = b.usdVal >= 10000 ? "whale-size-xl"
                    : b.usdVal >= 5000  ? "whale-size-lg"
                    : b.usdVal >= 2500  ? "whale-size-md"
                    :                     "whale-size-sm";

    const sizeLabel = b.usdVal >= 10000 ? "🐋 WHALE"
                    : b.usdVal >= 5000  ? "🦈 BIG"
                    : b.usdVal >= 2500  ? "🐬 MED"
                    :                     "🐟 SMALL";

    return `
      <div class="whale-buy-row" style="animation-delay:${i * 0.04}s">

        <div class="whale-buy-token">
          <img class="whale-buy-logo" src="${logo}" onerror="this.src='https://placehold.co/28x28'" />
          <div>
            <div class="whale-buy-symbol">$${b.tokenSymbol}</div>
            <div class="whale-buy-name">${b.tokenName}</div>
          </div>
        </div>

        <div class="whale-buy-wallet">
          ${b.isEstimated
            ? `<span class="whale-buy-wallet-addr" style="color:rgba(255,200,80,0.7);font-size:10px;letter-spacing:0.5px;">ESTIMATED</span>
               <span class="whale-buy-wallet-label">from vol data</span>`
            : `<span class="whale-buy-wallet-addr">${b.walletShort}</span>
               <span class="whale-buy-wallet-label">wallet</span>`
          }
        </div>

        <div class="whale-buy-amount">
          <span class="whale-buy-usd">+${b.usdFormatted}</span>
          <span class="whale-buy-time">${b.isEstimated ? "~1h window" : timeAgo(b.timestamp)}</span>
        </div>

        <div class="whale-buy-badge ${sizeClass}">${sizeLabel}</div>

        <button class="whale-buy-scan-btn" onclick="scanWhaleFromRadar('${b.wallet}', ${b.isEstimated ? 'true' : 'false'}, '${b.tokenMint}')">
          ${b.isEstimated ? '📊 View on DexScreener' : '🧬 Scan Whale'}
        </button>

      </div>
    `;
  }).join("");

  const now = new Date().toLocaleTimeString();
  panel.innerHTML = `
    <div class="whale-buys-list">${rows}</div>
    <div class="whale-buys-note">
      📊 Estimated from 1H volume data across radar tokens · Auto-refreshes every 30s · Updated ${now}
    </div>
  `;
}

/* ── Click: open Whale DNA for real wallets, DexScreener for estimated ── */
window.radarTradeOnSafeApe = function(mint) {
  localStorage.setItem("s2m_sa_mint", mint);
  window.location.href = "safe-ape.html";
};

window.scanWhaleFromRadar = function(wallet, isEstimated, tokenMint) {
  if (!isEstimated && wallet && wallet.length >= 32 && wallet.length <= 44) {
    // Real wallet — prefill and auto-scan Whale DNA
    try { localStorage.setItem("s2m_prefill_whale", wallet); } catch { }
    window.open("whale-dna.html", "_blank");
  } else {
    // Estimated entry — open DexScreener so user can find real wallets
    // from the Transactions tab, then paste into Whale DNA
    window.open(`https://dexscreener.com/solana/${tokenMint}`, "_blank");
  }
};

/* ===================================================
   OPEN TOKEN DETAIL MODAL
   =================================================== */
let currentTokens = [];

window.openTokenDetail = function(index) {
  const t = currentTokens[index];
  if (!t) return;

  const modal = document.getElementById("tokenDetailModal");
  if (!modal) return;

  modal.style.display    = "flex";
  document.body.style.overflow = "hidden";

  const logoUrl = t.logo
    ? `/.netlify/functions/logoProxy?url=${encodeURIComponent(t.logo)}`
    : "https://placehold.co/52x52";

  const scoreColor  = t.score >= 65 ? "#2cffc9" : t.score >= 45 ? "#ffd166" : "#ff4d6d";
  const riskLabel   = t.score >= 65 ? "LOW RISK" : t.score >= 45 ? "MODERATE" : "HIGH RISK";
  const holderNote  = t.top10Pct > 0
    ? `Top-10 holders: <strong style="color:${t.top10Pct > 70 ? "#ff4d6d" : t.top10Pct > 50 ? "#ffd166" : "#2cffc9"}">${t.top10Pct.toFixed(1)}%</strong> · `
    : "";

  document.getElementById("modalTokenInfo").innerHTML = `
    <img class="modal-logo" src="${logoUrl}" onerror="this.src='https://placehold.co/52x52'" referrerpolicy="no-referrer" />
    <div>
      <div class="modal-name">${esc(t.name)} <span style="opacity:0.5;font-size:14px">(${esc(t.symbol)})</span></div>
      <div class="modal-symbol">Age: ${t.age.text}
        &nbsp;|&nbsp;
        Risk Score: <strong style="color:${scoreColor}">${t.score}/100 — ${riskLabel}</strong>
      </div>
      <div style="font-size:10px;opacity:0.5;margin-top:3px;">
        ${holderNote}same scoring as Risk Scanner ·
        <a href="risk-scanner.html" onclick="localStorage.setItem('s2m_prefill_mint','${safeMint(t.mint)}')" style="color:#2cffc9;" target="_blank">Full Scan →</a>
      </div>
      <div class="modal-mint-link">${esc(safeMint(t.mint))}</div>
    </div>
  `;

  const ewEl = document.getElementById("modalEntryWindow");
  ewEl.className   = `entry-window-banner ${t.entry.class}`;
  ewEl.textContent = `Entry Window: ${t.entry.status}`;

  buildLiveChart(t);
  renderMomentumPanel(t);
  renderRiskFilter(t);
  renderGrowthTracker(t);
  renderDevHistory(t);
  renderWalletCluster(t);
  renderTopHolders(t);
  renderWhaleActivity(t);
  renderSafeEntryCalc(t);
};

/* ===== CLOSE MODAL ===== */
window.closeModal = function(e) {
  if (e.target === document.getElementById("tokenDetailModal")) closeModalDirect();
};

window.closeModalDirect = function() {
  const modal = document.getElementById("tokenDetailModal");
  if (modal) modal.style.display = "none";
  document.body.style.overflow = "";
  if (liveChartTimer)    { clearInterval(liveChartTimer);    liveChartTimer    = null; }
  if (liveChartInstance) { liveChartInstance.destroy();       liveChartInstance = null; }
};

/* ===================================================
   MARKET SNAPSHOT  (replaces fake random chart)
   Shows real DexScreener data — price, changes, volume,
   tx counts — all from the live pair object.
   =================================================== */
function buildLiveChart(t) {
  /* Clear any leftover timers/instances from previous modal */
  if (liveChartTimer)    { clearInterval(liveChartTimer);    liveChartTimer    = null; }
  if (liveChartInstance) { liveChartInstance.destroy();       liveChartInstance = null; }

  const canvas = document.getElementById("liveChart");
  if (!canvas) return;

  /* Hide the canvas element — we're replacing it with a stats grid */
  canvas.style.display = "none";

  /* Find or create the snapshot container that sits alongside the canvas */
  let snap = canvas.parentElement.querySelector(".er-market-snapshot");
  if (!snap) {
    snap = document.createElement("div");
    snap.className = "er-market-snapshot";
    canvas.parentElement.appendChild(snap);
  }

  const pair    = t.pair;
  const price   = parseFloat(pair.priceUsd || "0");
  const pc1h    = pair.priceChange?.h1  ?? 0;
  const pc24h   = pair.priceChange?.h24 ?? 0;
  const vol1h   = pair.volume?.h1  ?? 0;
  const vol24h  = pair.volume?.h24 ?? 0;
  const liq     = pair.liquidity?.usd ?? 0;
  const mc      = getMcEstimate(pair);
  const buys1h  = pair.txns?.h1?.buys  ?? 0;
  const sells1h = pair.txns?.h1?.sells ?? 0;
  const buys24  = pair.txns?.h24?.buys  ?? 0;
  const sells24 = pair.txns?.h24?.sells ?? 0;

  function fmtP(p) {
    if (!p || p <= 0) return "—";
    if (p < 0.000001) return p.toExponential(3);
    if (p < 0.001)    return p.toFixed(7);
    if (p < 1)        return p.toFixed(5);
    return p.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }

  function clr(v) { return v >= 0 ? "#2cffc9" : "#ff4d6d"; }
  function sgn(v) { return v >= 0 ? "+" : ""; }

  const dexUrl = `https://dexscreener.com/solana/${t.mint}`;

  snap.innerHTML = `
    <div class="er-snap-price-row">
      <span class="er-snap-price">$${fmtP(price)}</span>
      <span class="er-snap-change" style="color:${clr(pc1h)}">${sgn(pc1h)}${pc1h.toFixed(2)}% 1H</span>
      <span class="er-snap-change" style="color:${clr(pc24h)}">${sgn(pc24h)}${pc24h.toFixed(2)}% 24H</span>
    </div>
    <div class="er-snap-grid">
      <div class="er-snap-cell">
        <div class="er-snap-label">24H Volume</div>
        <div class="er-snap-val">${formatUsd(vol24h)}</div>
      </div>
      <div class="er-snap-cell">
        <div class="er-snap-label">1H Volume</div>
        <div class="er-snap-val">${formatUsd(vol1h)}</div>
      </div>
      <div class="er-snap-cell">
        <div class="er-snap-label">Liquidity</div>
        <div class="er-snap-val" style="color:${liq > 30000 ? "#2cffc9" : liq > 10000 ? "#ffd166" : "#ff4d6d"}">${formatUsd(liq)}</div>
      </div>
      <div class="er-snap-cell">
        <div class="er-snap-label">Market Cap</div>
        <div class="er-snap-val">${mc > 0 ? formatUsd(mc) : "—"}</div>
      </div>
      <div class="er-snap-cell">
        <div class="er-snap-label">Buys / Sells (1H)</div>
        <div class="er-snap-val" style="color:${buys1h >= sells1h ? "#2cffc9" : "#ffd166"}">${buys1h} / ${sells1h}</div>
      </div>
      <div class="er-snap-cell">
        <div class="er-snap-label">Buys / Sells (24H)</div>
        <div class="er-snap-val" style="color:${buys24 >= sells24 ? "#2cffc9" : "#ffd166"}">${buys24} / ${sells24}</div>
      </div>
    </div>
    <a href="${dexUrl}" target="_blank" rel="noopener noreferrer" class="er-snap-dex-link">📊 View live chart on DexScreener →</a>
    <div style="font-size:10px;opacity:0.35;margin-top:6px;">Real-time data · DexScreener</div>
  `;
}

/* ===================================================
   MOMENTUM PANEL
   =================================================== */
function renderMomentumPanel(t) {
  const el = document.getElementById("modalMomentum");
  if (!el) return;

  const pair    = t.pair;
  const buys    = pair.txns?.h1?.buys  ?? 0;
  const sells   = pair.txns?.h1?.sells ?? 0;
  const buys24  = pair.txns?.h24?.buys  ?? 0;
  const sells24 = pair.txns?.h24?.sells ?? 0;
  const pc1h    = pair.priceChange?.h1  ?? 0;
  const pc24h   = pair.priceChange?.h24 ?? 0;
  const vol1h   = pair.volume?.h1  ?? 0;
  const vol24h  = pair.volume?.h24 ?? 0;

  const buyRatio  = sells > 0 ? (buys / sells).toFixed(2) : buys > 0 ? "∞" : "0";
  const volGrowth = vol24h > 0 ? ((vol1h * 24 / vol24h) * 100 - 100).toFixed(0) : 0;
  const smartLabel = buys24 > 50 ? "High Activity" : buys24 > 20 ? "Moderate" : "Low";
  const smartClass = buys24 > 50 ? "sig-green" : buys24 > 20 ? "sig-yellow" : "sig-white";
  const sign1h  = pc1h  >= 0 ? "+" : "";
  const sign24h = pc24h >= 0 ? "+" : "";

  el.innerHTML = `
    <div class="signal-metric-row">
      <span class="signal-metric-label">Buy/Sell Ratio (1H)</span>
      <span class="signal-metric-value ${buys > sells ? "sig-green" : "sig-yellow"}">${buyRatio}</span>
    </div>
    <div class="signal-metric-row">
      <span class="signal-metric-label">Buys / Sells (1H)</span>
      <span class="signal-metric-value sig-white">${buys} / ${sells}</span>
    </div>
    <div class="signal-metric-row">
      <span class="signal-metric-label">Price Change 1H</span>
      <span class="signal-metric-value ${pc1h >= 0 ? "sig-green" : "sig-red"}">${sign1h}${pc1h.toFixed(2)}%</span>
    </div>
    <div class="signal-metric-row">
      <span class="signal-metric-label">Price Change 24H</span>
      <span class="signal-metric-value ${pc24h >= 0 ? "sig-green" : "sig-red"}">${sign24h}${pc24h.toFixed(2)}%</span>
    </div>
    <div class="signal-metric-row">
      <span class="signal-metric-label">Volume Growth vs Avg</span>
      <span class="signal-metric-value ${volGrowth >= 0 ? "sig-green" : "sig-red"}">${volGrowth >= 0 ? "+" : ""}${volGrowth}%</span>
    </div>
    <div class="signal-metric-row">
      <span class="signal-metric-label">Smart Wallet Activity</span>
      <span class="signal-metric-value ${smartClass}">${smartLabel}</span>
    </div>
    <div class="signal-metric-row">
      <span class="signal-metric-label">Overall Momentum</span>
      <span class="signal-metric-value ${t.momentum.class}">${t.momentum.icon} ${t.momentum.label}</span>
    </div>
  `;
}

/* ===================================================
   RISK FILTER PANEL
   =================================================== */
function renderRiskFilter(t) {
  const el = document.getElementById("modalRiskFilter");
  if (!el) return;

  const pair   = t.pair;
  const liq    = pair.liquidity?.usd ?? 0;
  const pc24h  = pair.priceChange?.h24 ?? 0;
  const pc6h   = pair.priceChange?.h6  ?? pc24h;
  const sells  = pair.txns?.h24?.sells ?? 0;
  const buys   = pair.txns?.h24?.buys  ?? 0;
  const vol24h = pair.volume?.h24 ?? 0;
  const mc     = getMcEstimate(pair);
  const liqMcRatio = mc > 0 ? (liq / mc) * 100 : 0;

  /* ── Each check uses only real DexScreener data and is labelled correctly ── */
  const checks = [
    {
      icon:  liq >= 30000 ? "✅" : liq >= 10000 ? "⚠️" : "❌",
      label: "Liquidity Depth",
      value: formatUsd(liq),
      cls:   liq >= 30000 ? "sig-green" : liq >= 10000 ? "sig-yellow" : "sig-red",
    },
    {
      icon:  pc24h > -30 ? (pc24h > 0 ? "✅" : "⚠️") : "❌",
      label: "Price Stability (24H)",
      value: (pc24h >= 0 ? "+" : "") + pc24h.toFixed(1) + "%",
      cls:   pc24h > 0 ? "sig-green" : pc24h > -30 ? "sig-yellow" : "sig-red",
    },
    {
      icon:  sells < buys * 2 ? "✅" : sells < buys * 3 ? "⚠️" : "❌",
      label: "Sell Pressure (24H)",
      value: sells < buys * 2 ? "Normal" : sells < buys * 3 ? "Elevated" : "High",
      cls:   sells < buys * 2 ? "sig-green" : sells < buys * 3 ? "sig-yellow" : "sig-red",
    },
    {
      icon:  liqMcRatio >= 10 ? "✅" : liqMcRatio >= 3 ? "⚠️" : "❌",
      label: "Liq / Market Cap Ratio",
      value: mc > 0 ? liqMcRatio.toFixed(1) + "%" : "N/A",
      cls:   liqMcRatio >= 10 ? "sig-green" : liqMcRatio >= 3 ? "sig-yellow" : "sig-red",
    },
    {
      icon:  vol24h >= 10000 ? "✅" : vol24h >= 2000 ? "⚠️" : "❌",
      label: "24H Trading Volume",
      value: formatUsd(vol24h),
      cls:   vol24h >= 10000 ? "sig-green" : vol24h >= 2000 ? "sig-yellow" : "sig-red",
    },
    {
      icon:  t.score >= 65 ? "✅" : t.score >= 45 ? "⚠️" : "❌",
      label: "Risk Score (market data)",
      value: t.score + "/100",
      cls:   t.score >= 65 ? "sig-green" : t.score >= 45 ? "sig-yellow" : "sig-red",
    },
  ];

  el.innerHTML = `
    ${checks.map(c => `
    <div class="risk-check-row">
      <span class="check-icon">${c.icon}</span>
      <span class="check-label">${c.label}</span>
      <span class="check-value ${c.cls}">${c.value}</span>
    </div>`).join("")}
    <div class="risk-check-row" style="border-bottom:none; padding-top:12px; font-size:11px; opacity:0.5;">
      ℹ️ LP lock &amp; mint/freeze authority: use Risk Scanner for on-chain verification
    </div>
  `;
}

/* ===================================================
   GROWTH TRACKER
   =================================================== */
function renderGrowthTracker(t) {
  const el = document.getElementById("modalGrowth");
  if (!el) return;

  const pair         = t.pair;
  const mc           = getMcEstimate(pair);
  const pc1h         = pair.priceChange?.h1  ?? 0;
  const pc24h        = pair.priceChange?.h24 ?? 0;
  const vol1h        = pair.volume?.h1  ?? 0;
  const vol24h       = pair.volume?.h24 ?? 0;
  const volGrowthPct = vol24h > 0 ? Math.min(100, (vol1h * 24 / vol24h) * 50) : 50;
  const mcBarPct     = mc > 0 ? Math.min(100, (mc / 1000000) * 100) : 0;
  const pc1hBarPct   = Math.min(100, Math.max(0, pc1h + 50));

  el.innerHTML = `
    <div class="growth-metric">
      <div class="growth-label">Market Cap Growth</div>
      <div class="growth-bar-wrap">
        <div class="growth-bar-fill" style="width:${mcBarPct}%; background:linear-gradient(90deg,#2cffc9,#7fffe1);"></div>
      </div>
      <div class="growth-value">${formatUsd(mc)}</div>
    </div>
    <div class="growth-metric">
      <div class="growth-label">Price Change 1H</div>
      <div class="growth-bar-wrap">
        <div class="growth-bar-fill" style="width:${pc1hBarPct}%; background:${pc1h >= 0 ? "linear-gradient(90deg,#2cffc9,#7fffe1)" : "linear-gradient(90deg,#ff4d6d,#ff9a9a)"};"></div>
      </div>
      <div class="growth-value" style="color:${pc1h >= 0 ? "#2cffc9" : "#ff4d6d"}">${pc1h >= 0 ? "+" : ""}${pc1h.toFixed(2)}%</div>
    </div>
    <div class="growth-metric">
      <div class="growth-label">Volume vs Daily Avg</div>
      <div class="growth-bar-wrap">
        <div class="growth-bar-fill" style="width:${volGrowthPct}%;"></div>
      </div>
      <div class="growth-value">${formatUsd(vol1h)} / hr</div>
    </div>
    <div class="growth-metric">
      <div class="growth-label">24H Price Change</div>
      <div class="growth-bar-wrap">
        <div class="growth-bar-fill" style="width:${Math.min(100,Math.max(0,pc24h+50))}%; background:${pc24h >= 0 ? "linear-gradient(90deg,#2cffc9,#7fffe1)" : "linear-gradient(90deg,#ff4d6d,#ff9a9a)"};"></div>
      </div>
      <div class="growth-value" style="color:${pc24h >= 0 ? "#2cffc9" : "#ff4d6d"}">${pc24h >= 0 ? "+" : ""}${pc24h.toFixed(2)}%</div>
    </div>
  `;
}

/* ===================================================
   DEV HISTORY PANEL
   =================================================== */
function renderDevHistory(t) {
  const el = document.getElementById("modalDevHistory");
  if (!el) return;

  const pair   = t.pair;
  const pc24h  = pair.priceChange?.h24 ?? 0;
  const pc1h   = pair.priceChange?.h1  ?? 0;
  const liq    = pair.liquidity?.usd   ?? 0;
  const sells  = pair.txns?.h24?.sells ?? 0;
  const buys   = pair.txns?.h24?.buys  ?? 0;
  const vol24h = pair.volume?.h24      ?? 0;
  const mc     = pair.marketCap || pair.fdv || 0;

  // Trust score based purely on real market data signals — no random values
  let trustScore = 50, trustLabel = "Unknown", trustClass = "sig-yellow";

  if (pc24h <= -80)                                { trustScore = 8;  trustLabel = "Very Low";     trustClass = "sig-red"; }
  else if (pc24h <= -50 || sells > buys * 3)       { trustScore = 25; trustLabel = "Low";           trustClass = "sig-red"; }
  else if (liq < 5000 && vol24h < 2000)            { trustScore = 38; trustLabel = "Low–Moderate";  trustClass = "sig-red"; }
  else if (liq < 15000)                            { trustScore = 45; trustLabel = "Moderate";      trustClass = "sig-yellow"; }
  else if (liq > 30000 && pc24h > 0 && buys > sells){ trustScore = 74; trustLabel = "Good";         trustClass = "sig-green"; }
  else if (liq > 15000 && pc24h > -20)             { trustScore = 58; trustLabel = "Moderate";      trustClass = "sig-yellow"; }
  else                                             { trustScore = 42; trustLabel = "Moderate";      trustClass = "sig-yellow"; }

  const trustBarColor = trustScore >= 65 ? "#2cffc9" : trustScore >= 40 ? "#ffd166" : "#ff4d6d";
  const solscanUrl    = `https://solscan.io/token/${t.mint}`;
  const dexUrl        = `https://dexscreener.com/solana/${t.mint}`;

  // Real signals derived from live data
  const signals = [
    { label: "24H Price",      val: `${pc24h >= 0 ? "+" : ""}${pc24h.toFixed(1)}%`,  cls: pc24h >= 0 ? "sig-green" : pc24h > -30 ? "sig-yellow" : "sig-red" },
    { label: "1H Price",       val: `${pc1h  >= 0 ? "+" : ""}${pc1h.toFixed(1)}%`,   cls: pc1h  >= 0 ? "sig-green" : "sig-yellow" },
    { label: "Liquidity",      val: formatUsd(liq),   cls: liq > 30000 ? "sig-green" : liq > 10000 ? "sig-yellow" : "sig-red" },
    { label: "24H Volume",     val: formatUsd(vol24h), cls: vol24h > 10000 ? "sig-green" : vol24h > 2000 ? "sig-yellow" : "sig-red" },
    { label: "Buy/Sell Ratio", val: buys + sells > 0 ? (buys / (sells || 1)).toFixed(2) + "x buys" : "N/A",
      cls: buys > sells ? "sig-green" : buys > sells * 0.7 ? "sig-yellow" : "sig-red" },
    { label: "Market Cap",     val: mc > 0 ? formatUsd(mc) : "N/A", cls: "sig-white" },
  ];

  el.innerHTML = `
    <div class="dev-trust-section">
      <div class="dev-trust-label-row">
        <span class="dev-trust-title">Market Trust Score</span>
        <span class="dev-trust-score ${trustClass}">${trustScore}/100</span>
      </div>
      <div class="dev-trust-bar-wrap">
        <div class="dev-trust-bar-fill" style="width:${trustScore}%; background:linear-gradient(90deg,${trustBarColor},${trustBarColor}cc);"></div>
      </div>
      <div class="dev-trust-verdict ${trustClass}">${trustLabel}</div>
    </div>
    <div style="margin-top:12px;">
      ${signals.map(s => `
        <div class="signal-metric-row">
          <span class="signal-metric-label">${s.label}</span>
          <span class="signal-metric-value ${s.cls}">${s.val}</span>
        </div>`).join("")}
    </div>
    <div class="dev-trust-note" style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap;">
      <a href="${solscanUrl}" target="_blank" rel="noopener noreferrer" class="dev-solscan-link">🔎 Solscan →</a>
      <a href="${dexUrl}" target="_blank" rel="noopener noreferrer" class="dev-solscan-link">📊 DexScreener →</a>
    </div>
    <div style="font-size:10px; opacity:0.35; margin-top:8px;">Based on live on-chain market data</div>
  `;
}

/* ===================================================
   WALLET CLUSTER PANEL
   =================================================== */
function renderWalletCluster(t) {
  const el = document.getElementById("modalWalletCluster");
  if (!el) return;

  const pair    = t.pair;
  const buys24  = pair.txns?.h24?.buys  ?? 0;
  const sells24 = pair.txns?.h24?.sells ?? 0;
  const buys1h  = pair.txns?.h1?.buys   ?? 0;
  const sells1h = pair.txns?.h1?.sells  ?? 0;
  const vol24h  = pair.volume?.h24 ?? 0;
  const vol1h   = pair.volume?.h1  ?? 0;

  const sellRatio24 = buys24 > 0 ? sells24 / buys24 : 0;
  const sellRatio1h = buys1h > 0 ? sells1h / buys1h : 0;
  const avgTx24     = buys24 > 0 ? vol24h / buys24  : 0;

  /* Sell pressure assessment from real transaction data */
  let pressureRisk, pressureClass, pressureIcon, pressureNote;
  if (sellRatio24 > 3 && sells24 > 50) {
    pressureRisk = "High";     pressureClass = "sig-red";    pressureIcon = "🚨";
    pressureNote = "Sells heavily outnumber buys — abnormal sell pressure";
  } else if (sellRatio24 > 2 && sells24 > 20) {
    pressureRisk = "Moderate"; pressureClass = "sig-yellow"; pressureIcon = "⚠️";
    pressureNote = "Elevated sell ratio — monitor closely";
  } else if (buys24 > 100 && avgTx24 > 500) {
    pressureRisk = "Low–Moderate"; pressureClass = "sig-yellow"; pressureIcon = "⚠️";
    pressureNote = "High buy count with large average size — possible bot activity";
  } else {
    pressureRisk = "Low";     pressureClass = "sig-green";  pressureIcon = "✅";
    pressureNote = "Normal buy/sell ratio — no obvious coordinated selling";
  }

  const dexUrl = `https://dexscreener.com/solana/${t.mint}`;

  el.innerHTML = `
    <div class="cluster-risk-row">
      <span class="cluster-risk-icon">${pressureIcon}</span>
      <div>
        <div class="cluster-risk-label">Sell Pressure Assessment</div>
        <div class="cluster-risk-value ${pressureClass}">${pressureRisk}</div>
      </div>
    </div>
    <div class="cluster-metrics">
      <div class="signal-metric-row">
        <span class="signal-metric-label">Buys / Sells (24H)</span>
        <span class="signal-metric-value ${buys24 >= sells24 ? "sig-green" : "sig-yellow"}">${buys24.toLocaleString()} / ${sells24.toLocaleString()}</span>
      </div>
      <div class="signal-metric-row">
        <span class="signal-metric-label">Sell/Buy Ratio (24H)</span>
        <span class="signal-metric-value ${sellRatio24 > 2 ? "sig-red" : sellRatio24 > 1 ? "sig-yellow" : "sig-green"}">${buys24 > 0 ? sellRatio24.toFixed(2) + "x" : "N/A"}</span>
      </div>
      <div class="signal-metric-row">
        <span class="signal-metric-label">Buys / Sells (1H)</span>
        <span class="signal-metric-value ${buys1h >= sells1h ? "sig-green" : "sig-yellow"}">${buys1h} / ${sells1h}</span>
      </div>
      <div class="signal-metric-row">
        <span class="signal-metric-label">Sell/Buy Ratio (1H)</span>
        <span class="signal-metric-value ${sellRatio1h > 2 ? "sig-red" : sellRatio1h > 1 ? "sig-yellow" : "sig-green"}">${buys1h > 0 ? sellRatio1h.toFixed(2) + "x" : "N/A"}</span>
      </div>
      <div class="signal-metric-row" style="border-bottom:none;">
        <span class="signal-metric-label">Avg Buy Size (24H)</span>
        <span class="signal-metric-value sig-white">${formatUsd(avgTx24)}</span>
      </div>
    </div>
    <div class="cluster-note">${pressureNote}</div>
    <div style="font-size:10px; opacity:0.35; margin-top:8px;">
      Real DexScreener data · <a href="${dexUrl}" target="_blank" rel="noopener noreferrer" style="color:#2cffc9;">View full txns →</a>
    </div>
  `;
}

/* ===================================================
   TOP HOLDERS PANEL
   =================================================== */
function renderTopHolders(t) {
  const el = document.getElementById("modalTopHolders");
  if (!el) return;

  const pair       = t.pair;
  const liq        = pair.liquidity?.usd ?? 0;
  const realTop10  = t.top10Pct ?? 0;   // real on-chain value fetched in processTokens
  const hasReal    = realTop10 > 0;

  /* Use real top-10 % as the anchor for the bar chart when available.
     Individual rows are still estimated (we don't have per-wallet data here)
     but the TOTAL concentration shown matches the Risk Scanner exactly. */
  const totalTop = hasReal
    ? realTop10
    : (liq < 10000 ? 75 : liq < 30000 ? 55 : liq < 100000 ? 38 : 28);

  /* Build individual rows that sum to totalTop — deterministic decay, no randomness */
  const holders = [];
  let remaining  = Math.min(totalTop, 98);
  const h1pct    = Math.min(remaining * 0.40, 40);
  holders.push({ pct: h1pct, label: "Top Holder" });
  remaining -= h1pct;
  for (let i = 1; i < 10 && remaining > 0.5; i++) {
    const decay  = 0.52 - i * 0.05;
    const pct    = Math.max(0.3, remaining * Math.max(0.05, decay));
    const capped = Math.min(pct, remaining * 0.7);
    holders.push({ pct: capped, label: i < 3 ? "Whale" : "Holder" });
    remaining -= capped;
  }

  const concClass = totalTop > 70 ? "sig-red" : totalTop > 50 ? "sig-yellow" : "sig-green";
  const solscanUrl = `https://solscan.io/token/${t.mint}#holders`;

  const rows = holders.map((h, i) => {
    const barW = Math.min(100, (h.pct / (h1pct * 1.1)) * 100);
    return `
      <div class="${i === 0 ? "holder-top-row lp-row" : "holder-top-row"}">
        <span class="holder-top-rank">#${i + 1}</span>
        <span class="holder-top-addr" style="opacity:0.5;font-style:italic;">${h.label}</span>
        <div class="holder-top-bar-wrap"><div class="holder-top-bar-fill" style="width:${barW}%;"></div></div>
        <span class="holder-top-pct ${i < 2 ? concClass : "sig-white"}">${h.pct.toFixed(1)}%</span>
      </div>`;
  }).join("");

  el.innerHTML = `
    <div class="holders-top-summary">
      <span class="holders-conc-label">Top-10 Concentration</span>
      <span class="holders-conc-val ${concClass}">${totalTop.toFixed(1)}%
        ${hasReal ? '<span style="font-size:10px;opacity:0.5;font-weight:400;margin-left:4px;">on-chain</span>' : ''}
      </span>
    </div>
    <div class="holders-top-list">${rows}</div>
    <div class="holders-top-note">
      ${hasReal
        ? `✅ Top-10 % is real on-chain data — individual distribution estimated`
        : `⚠️ Estimated from liquidity tiers`} —
      <a href="${solscanUrl}" target="_blank" rel="noopener noreferrer" style="color:#2cffc9;">View real holders on Solscan →</a>
    </div>
    <div style="font-size:10px; opacity:0.35; margin-top:4px;">Use the Risk Scanner for exact on-chain holder data</div>
  `;
}

/* ===================================================
   WHALE ACTIVITY MODAL PANEL (inside token detail)
   =================================================== */
function renderWhaleActivity(t) {
  const el = document.getElementById("modalWhale");
  if (!el) return;

  const pair      = t.pair;
  const buys      = pair.txns?.h1?.buys ?? 0;
  const vol1h     = pair.volume?.h1     ?? 0;
  const avgTxSize = buys > 0 ? vol1h / buys : 0;
  const whaleThreshold = avgTxSize * 5;
  const whaleCount     = buys > 20 ? Math.floor(buys * 0.05) : 0;
  const smartCount     = buys > 10 ? Math.floor(buys * 0.12) : 0;

  if (buys < 3) {
    el.innerHTML = `<div style="padding:20px;text-align:center;opacity:0.5;font-size:13px;">Not enough transaction data yet</div>`;
    return;
  }

  if (!whaleCount && !smartCount) {
    el.innerHTML = `<div style="padding:20px;text-align:center;opacity:0.5;font-size:13px;">No significant large-buyer activity in last 1H</div>`;
    return;
  }

  const whaleVol  = whaleThreshold * whaleCount;
  const smartVol  = avgTxSize * 1.8 * smartCount;
  const dexUrl    = `https://dexscreener.com/solana/${t.mint}`;
  const whaleClass = whaleCount > 3 ? "sig-green" : whaleCount > 0 ? "sig-yellow" : "sig-white";

  el.innerHTML = `
    <div class="signal-metric-row"><span class="signal-metric-label">1H Buy Volume</span><span class="signal-metric-value sig-green">${formatUsd(vol1h)}</span></div>
    <div class="signal-metric-row"><span class="signal-metric-label">Avg TX Size</span><span class="signal-metric-value sig-white">${formatUsd(avgTxSize)}</span></div>
    <div class="signal-metric-row"><span class="signal-metric-label">Estimated Whale Buys</span><span class="signal-metric-value ${whaleClass}">${whaleCount} (${formatUsd(whaleVol)} vol)</span></div>
    <div class="signal-metric-row" style="border-bottom:none;"><span class="signal-metric-label">Estimated Smart Money</span><span class="signal-metric-value sig-white">${smartCount} (${formatUsd(smartVol)} vol)</span></div>
    <div style="font-size:10px;opacity:0.4;margin-top:10px;">⚠️ Estimated from volume patterns — not real wallet data. View <a href="${dexUrl}" target="_blank" rel="noopener noreferrer" style="color:#2cffc9;">DexScreener</a> for exact txns.</div>
  `;
}

/* ===================================================
   SAFE ENTRY CALCULATOR
   =================================================== */
function renderSafeEntryCalc(t) {
  const el = document.getElementById("modalSafeEntry");
  if (!el) return;

  const se = t.safeEntry;
  if (!se) {
    el.innerHTML = `<div style="padding:20px;text-align:center;opacity:0.5;">Insufficient data to calculate safe entry</div>`;
    return;
  }

  const riskLabel  = se.score >= 65 ? "Low Risk" : se.score >= 45 ? "Moderate Risk" : "Higher Risk";
  const riskColor  = se.score >= 65 ? "#2cffc9" : se.score >= 45 ? "#ffd166" : "#ff9a7a";
  const entryLabel = t.entry.class === "open" ? "OPEN 🟢" : "CAUTION 🟡";

  el.innerHTML = `
    <div class="safe-entry-calc">
      <div class="safe-entry-window-label">Entry Window</div>
      <div class="entry-badge ${t.entry.class}" style="display:inline-flex;margin-bottom:12px;">${entryLabel}</div>
      <div class="safe-entry-window-label">Max Recommended Entry</div>
      <div class="safe-entry-big">$${se.maxEntry.toLocaleString()}</div>
      <div class="safe-entry-sub">Based on 2% slippage limit + risk score</div>
    </div>
    <div class="safe-entry-breakdown">
      <div class="safe-entry-line"><span class="safe-line-label">Liquidity (USD)</span><span class="safe-line-val">${formatUsd(se.liq)}</span></div>
      <div class="safe-entry-line"><span class="safe-line-label">Market Cap</span><span class="safe-line-val">${formatUsd(se.mc)}</span></div>
      <div class="safe-entry-line"><span class="safe-line-label">Risk Score</span><span class="safe-line-val" style="color:${riskColor}">${se.score}/100 (${riskLabel})</span></div>
      <div class="safe-entry-line"><span class="safe-line-label">Risk Multiplier</span><span class="safe-line-val">${(se.riskMult * 100).toFixed(0)}%</span></div>
      <div class="safe-entry-line"><span class="safe-line-label">2% of Liquidity</span><span class="safe-line-val">$${Math.round(se.liq * 0.02).toLocaleString()}</span></div>
    </div>
    <div style="font-size:10px;opacity:0.4;margin-top:12px;text-align:center;">This is not financial advice. Always DYOR.</div>
  `;
}

/* ===================================================
   HELPERS
   =================================================== */

/* ===================================================
   MAIN LOAD FUNCTION
   =================================================== */
async function loadRadar() {
  const container   = document.getElementById("radarTokenList");
  const lastUpdateEl = document.getElementById("radarLastUpdate");
  const refreshBtn  = document.getElementById("radarRefreshBtn");

  if (container) {
    container.innerHTML = `
      <div class="radar-loading">
        <div class="radar-spinner"></div>
        <div>Scanning for early tokens…</div>
      </div>`;
  }

  if (refreshBtn) refreshBtn.classList.add("spinning");

  try {
    const rawTokens = await fetchNewTokens();

    // Stream results: render table after each batch so tokens appear immediately
    let whaleStarted = false;
    const tokens = await processTokens(rawTokens, (partialResults) => {
      currentTokens = partialResults;
      renderTable(partialResults);
      // Start whale panel as soon as we have the first batch
      if (!whaleStarted && partialResults.length > 0) {
        whaleStarted = true;
        loadWhaleBuys(partialResults);
      }
      if (lastUpdateEl) {
        lastUpdateEl.textContent = `Updated ${new Date().toLocaleTimeString()} (${partialResults.length} found)`;
      }
    });

    // Final render with all results
    currentTokens = tokens;
    renderTable(tokens);
    if (!whaleStarted) loadWhaleBuys(tokens);

    if (lastUpdateEl) {
      lastUpdateEl.textContent = `Updated ${new Date().toLocaleTimeString()}`;
    }
  } catch (e) {
    console.error("Radar load failed:", e);
    if (container) container.innerHTML = `
      <div class="radar-empty">
        <div class="radar-empty-icon">⚠️</div>
        <div class="radar-empty-title">Failed to load tokens</div>
        <div>Check your internet connection and try again.</div>
      </div>`;
  } finally {
    if (refreshBtn) refreshBtn.classList.remove("spinning");
  }
}

/* ===== FORCE REFRESH ===== */
window.forceRefresh = function() {
  if (refreshTimer) clearInterval(refreshTimer);
  loadRadar();
  refreshTimer = setInterval(loadRadar, REFRESH_INTERVAL);
};

/* ===== INIT ===== */
document.addEventListener("DOMContentLoaded", () => {
  renderNav();
  loadRadar();
  refreshTimer = setInterval(loadRadar, REFRESH_INTERVAL);
});