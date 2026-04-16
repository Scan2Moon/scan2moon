/* ============================================================
   Scan2Moon – portfolio.js  (V2.0)
   Portfolio Scanner: fetch all tokens in a wallet,
   enrich with DexScreener, calculate PnL & risk scores.
   ============================================================ */

import { renderNav } from "./nav.js";
import { applyTranslations } from "./i18n.js";
import { callRpc }   from "./rpc.js";
import "./community.js";

const DEX_API = "https://api.dexscreener.com/latest/dex/tokens/";

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener("DOMContentLoaded", () => {
  renderNav();
  applyTranslations();

  document.getElementById("portfolioScanBtn").addEventListener("click", startScan);

  document.getElementById("walletInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") startScan();
  });
});

/* ============================================================
   VALIDATION
   ============================================================ */
function isValidSolanaWallet(addr) {
  if (!addr || addr.length < 32 || addr.length > 44) return false;
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
}

/* ============================================================
   MAIN SCAN ENTRY POINT
   ============================================================ */
async function startScan() {
  const wallet = document.getElementById("walletInput").value.trim();

  if (!wallet) {
    alert("Please paste a Solana wallet address.");
    return;
  }
  if (!isValidSolanaWallet(wallet)) {
    alert("Invalid Solana wallet address. Please check for typos.");
    return;
  }

  const btn = document.getElementById("portfolioScanBtn");
  btn.disabled = true;
  document.getElementById("scanBtnText").textContent = "⏳ Scanning…";

  // Show panels with loading state
  document.getElementById("summaryPanel").style.display = "block";
  document.getElementById("tokensPanel").style.display  = "block";

  showLoadingState("Fetching wallet token accounts…", 5);

  try {
    // ── STEP 1: get all token accounts for wallet ──
    const tokenAccounts = await fetchTokenAccounts(wallet);

    if (!tokenAccounts || tokenAccounts.length === 0) {
      showEmpty("No token holdings found in this wallet.", "This wallet appears to hold no SPL tokens, or it may be empty.");
      return;
    }

    // Filter out dust (< 1 token) and very tiny balances
    const meaningful = tokenAccounts.filter(t => t.uiAmount >= 1);

    if (meaningful.length === 0) {
      showEmpty("No significant holdings found.", "This wallet has token accounts but all balances are dust (< 1 token).");
      return;
    }

    updateProgress(20, `Found ${meaningful.length} token holdings. Enriching data…`);

    // ── STEP 2: enrich each token with DexScreener data ──
    const enriched = await enrichTokens(meaningful);

    // Filter to tokens we could get market data for
    const withData = enriched.filter(t => t.priceUsd !== null);
    const noData   = enriched.filter(t => t.priceUsd === null);

    updateProgress(90, "Calculating PnL and risk scores…");

    // ── STEP 3: calculate PnL (entry price estimation) ──
    // We don't have actual buy prices from on-chain without full tx history.
    // We show current value + 24h/7d price change as P/L proxy.
    const processed = withData.map(t => calcTokenStats(t));

    updateProgress(100, "Done!");

    // ── STEP 4: render everything ──
    renderSummary(wallet, processed, noData.length);
    renderTokenTable(processed);

  } catch (err) {
    console.error("Portfolio scan failed:", err);
    showError("Scan failed: " + (err.message || "Unknown error. Check console."));
  } finally {
    btn.disabled = false;
    document.getElementById("scanBtnText").textContent = "🔍 Scan Wallet";
  }
}

/* ============================================================
   FETCH TOKEN ACCOUNTS VIA HELIUS RPC
   ============================================================ */
async function fetchTokenAccounts(wallet) {
  /* Query both token programs in parallel:
     - TokenkegQfe…  = standard SPL Token (most tokens)
     - TokenzQdBNb…  = Token-2022 (newer tokens — missed by single-program query) */
  const [respV1, respV2] = await Promise.all([
    callRpc("getTokenAccountsByOwner", [
      wallet,
      { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
      { encoding: "jsonParsed", commitment: "confirmed" }
    ]).catch(() => null),
    callRpc("getTokenAccountsByOwner", [
      wallet,
      { programId: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" },
      { encoding: "jsonParsed", commitment: "confirmed" }
    ]).catch(() => null),
  ]);

  const allAccounts = [
    ...(respV1?.value ?? []),
    ...(respV2?.value ?? []),
  ];

  if (!allAccounts.length) return [];

  return allAccounts
    .map(acc => {
      const info = acc.account?.data?.parsed?.info;
      if (!info) return null;
      return {
        mint:     info.mint,
        decimals: info.tokenAmount?.decimals ?? 0,
        uiAmount: Number(info.tokenAmount?.uiAmount ?? 0),
        rawAmount: info.tokenAmount?.amount ?? "0",
      };
    })
    .filter(Boolean);
}

/* ============================================================
   ENRICH WITH DEXSCREENER — batched
   ============================================================ */
async function enrichTokens(accounts) {
  // DexScreener supports comma-separated mints (up to 30)
  const BATCH = 25;
  const results = [];

  for (let i = 0; i < accounts.length; i += BATCH) {
    const slice = accounts.slice(i, i + BATCH);
    const mints = slice.map(a => a.mint).join(",");

    const progress = 20 + Math.round(((i + BATCH) / accounts.length) * 65);
    updateProgress(Math.min(progress, 85), `Enriching tokens ${i + 1}–${Math.min(i + BATCH, accounts.length)} of ${accounts.length}…`);

    try {
      const res  = await fetch(`${DEX_API}${mints}`);
      const data = await res.json();
      const pairs = data.pairs || [];

      for (const acc of slice) {
        // Find best Solana pair for this mint
        const pair = pairs
          .filter(p => p.baseToken?.address === acc.mint && p.chainId === "solana")
          .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0] || null;

        results.push({
          ...acc,
          pair,
          name:      pair?.baseToken?.name   ?? "Unknown Token",
          symbol:    pair?.baseToken?.symbol ?? acc.mint.slice(0, 6) + "…",
          logo:      pair?.info?.imageUrl    ?? null,
          priceUsd:  pair ? parseFloat(pair.priceUsd || "0") : null,
          mcap:      pair?.fdv ?? pair?.marketCap ?? 0,
          liq:       pair?.liquidity?.usd ?? 0,
          pc1h:      pair?.priceChange?.h1  ?? null,
          pc24h:     pair?.priceChange?.h24 ?? null,
          pc6h:      pair?.priceChange?.h6  ?? null, /* DexScreener max non-24h window */
          vol24h:    pair?.volume?.h24 ?? 0,
          buys24h:   pair?.txns?.h24?.buys  ?? 0,
          sells24h:  pair?.txns?.h24?.sells ?? 0,
          pairAddr:  pair?.pairAddress ?? null,
        });
      }

    } catch (err) {
      console.warn("DexScreener batch failed:", err);
      // Push accounts without enrichment
      for (const acc of slice) {
        results.push({ ...acc, pair: null, name: "Unknown", symbol: "???", logo: null, priceUsd: null });
      }
    }
  }

  return results;
}

/* ============================================================
   CALCULATE TOKEN STATS & RISK SCORE
   ============================================================ */
function calcTokenStats(t) {
  const currentValueUsd = (t.priceUsd ?? 0) * t.uiAmount;

  // PnL proxy: we don't have buy price, so we show:
  // - 24h change in portfolio value for that token
  // - 7d change as "all time proxy" (best we can do without tx history)
  const pc24h = t.pc24h ?? 0;
  const pc6h  = t.pc6h  ?? 0;

  // Value change last 24h (USD)
  const valueChange24hUsd = currentValueUsd * (pc24h / 100);
  const valueAtOpen24h    = currentValueUsd - valueChange24hUsd;

  // Risk score (reuse logic from entry radar)
  const score = calcRiskScore(t);
  const riskLabel = score >= 65 ? "LOW RISK" : score >= 40 ? "MODERATE" : "HIGH RISK";
  const riskClass = score >= 65 ? "risk-low"  : score >= 40 ? "risk-mod"  : "risk-high";

  return {
    ...t,
    currentValueUsd,
    pc24h,
    pc6h,
    valueChange24hUsd,
    score,
    riskLabel,
    riskClass,
  };
}

function calcRiskScore(t) {
  let score = 55;

  const liq    = t.liq    ?? 0;
  const vol    = t.vol24h ?? 0;
  const pc24h  = t.pc24h  ?? 0;
  const buys   = t.buys24h  ?? 0;
  const sells  = t.sells24h ?? 0;

  if (liq > 100000) score += 15;
  else if (liq > 30000) score += 8;
  else if (liq < 5000)  score -= 20;
  else if (liq < 15000) score -= 10;

  if (buys + sells > 0) {
    const bp = buys / (buys + sells);
    if (bp > 0.6) score += 8;
    else if (bp < 0.35) score -= 12;
  }

  if (pc24h < -50) score -= 20;
  else if (pc24h < -25) score -= 10;
  else if (pc24h > 10 && pc24h < 200) score += 5;

  if (vol < 1000) score -= 8;
  else if (vol > 50000) score += 5;

  return Math.max(0, Math.min(100, Math.round(score)));
}

/* ============================================================
   RENDER SUMMARY
   ============================================================ */
function renderSummary(wallet, tokens, unknownCount) {
  const totalUsd   = tokens.reduce((s, t) => s + t.currentValueUsd, 0);
  const totalChange24h = tokens.reduce((s, t) => s + t.valueChange24hUsd, 0);
  const pct24h     = totalUsd > 0 ? ((totalChange24h / (totalUsd - totalChange24h)) * 100) : 0;

  const lowRisk  = tokens.filter(t => t.score >= 65).length;
  const modRisk  = tokens.filter(t => t.score >= 40 && t.score < 65).length;
  const highRisk = tokens.filter(t => t.score < 40).length;

  const avgScore = tokens.length > 0
    ? Math.round(tokens.reduce((s, t) => s + t.score, 0) / tokens.length)
    : 0;

  const scoreClass = avgScore >= 65 ? "val-good" : avgScore >= 40 ? "val-warn" : "val-bad";
  const pctClass   = pct24h  >= 0   ? "val-good" : "val-bad";

  const lowW  = tokens.length > 0 ? (lowRisk  / tokens.length * 100).toFixed(1) : 0;
  const modW  = tokens.length > 0 ? (modRisk  / tokens.length * 100).toFixed(1) : 0;
  const highW = tokens.length > 0 ? (highRisk / tokens.length * 100).toFixed(1) : 0;

  const unknownNote = unknownCount > 0
    ? `<div style="font-size:12px;opacity:.45;margin-top:6px;text-align:center;">+ ${unknownCount} token${unknownCount > 1 ? 's' : ''} with no market data (possibly unlisted or worthless)</div>`
    : "";

  document.getElementById("summaryBody").innerHTML = `

    <!-- WALLET STRIP -->
    <div class="port-wallet-strip">
      <div>
        <div style="font-size:11px;opacity:.5;margin-bottom:3px;letter-spacing:.5px;">SCANNING WALLET</div>
        <a href="https://solscan.io/account/${wallet}" target="_blank" rel="noopener noreferrer" class="port-wallet-addr" title="View on Solscan">${wallet}</a>
      </div>
      <div class="port-wallet-actions">
        <a href="https://solscan.io/account/${wallet}" target="_blank" class="port-wallet-action-btn">View on Solscan ↗</a>
        <button class="port-wallet-action-btn" onclick="navigator.clipboard.writeText('${wallet}')">Copy Address</button>
      </div>
    </div>

    <!-- STAT CARDS -->
    <div class="port-summary-grid">
      <div class="port-stat-card">
        <div class="port-stat-label">Total Portfolio Value</div>
        <div class="port-stat-value val-good">${formatUsd(totalUsd)}</div>
        <div class="port-stat-sub">${tokens.length} tokens with market data</div>
      </div>
      <div class="port-stat-card">
        <div class="port-stat-label">24H Change</div>
        <div class="port-stat-value ${pctClass}">${pct24h >= 0 ? "+" : ""}${pct24h.toFixed(2)}%</div>
        <div class="port-stat-sub">${totalChange24h >= 0 ? "+" : ""}${formatUsd(totalChange24h)} today</div>
      </div>
      <div class="port-stat-card">
        <div class="port-stat-label">Avg Risk Score</div>
        <div class="port-stat-value ${scoreClass}">${avgScore}<span style="font-size:14px;opacity:.5">/100</span></div>
        <div class="port-stat-sub">Portfolio health</div>
      </div>
      <div class="port-stat-card">
        <div class="port-stat-label">High Risk Tokens</div>
        <div class="port-stat-value ${highRisk > 0 ? "val-bad" : "val-good"}">${highRisk}</div>
        <div class="port-stat-sub">out of ${tokens.length} scanned</div>
      </div>
    </div>

    <!-- HEALTH BAR -->
    <div class="port-health-wrap">
      <div class="port-health-title">🛡️ PORTFOLIO RISK BREAKDOWN</div>
      <div class="port-health-bar-wrap">
        <div class="port-health-seg-low"  style="width:${lowW}%"></div>
        <div class="port-health-seg-mod"  style="width:${modW}%"></div>
        <div class="port-health-seg-high" style="width:${highW}%"></div>
      </div>
      <div class="port-health-legend">
        <span><span class="leg-dot leg-low"></span>  Low Risk: ${lowRisk} (${lowW}%)</span>
        <span><span class="leg-dot leg-mod"></span>  Moderate: ${modRisk} (${modW}%)</span>
        <span><span class="leg-dot leg-high"></span> High Risk: ${highRisk} (${highW}%)</span>
      </div>
    </div>

    ${unknownNote}
  `;
}

/* ============================================================
   RENDER TOKEN TABLE
   ============================================================ */
let allTokens   = [];
let activeFilter = "all";

function renderTokenTable(tokens) {
  allTokens = tokens;

  // Sort by value descending by default
  tokens.sort((a, b) => b.currentValueUsd - a.currentValueUsd);

  // Build filter buttons
  document.getElementById("filterRow").innerHTML = `
    <button class="port-filter-btn active" data-filter="all"    onclick="applyFilter('all')">All</button>
    <button class="port-filter-btn"        data-filter="profit" onclick="applyFilter('profit')">📈 Profit 24h</button>
    <button class="port-filter-btn"        data-filter="loss"   onclick="applyFilter('loss')">📉 Loss 24h</button>
    <button class="port-filter-btn"        data-filter="high"   onclick="applyFilter('high')">⚠️ High Risk</button>
    <button class="port-filter-btn"        data-filter="low"    onclick="applyFilter('low')">✅ Low Risk</button>
  `;

  renderRows(tokens);
}

window.applyFilter = function(filter) {
  activeFilter = filter;
  document.querySelectorAll(".port-filter-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.filter === filter);
  });

  let filtered = [...allTokens];
  if (filter === "profit") filtered = filtered.filter(t => t.pc24h > 0);
  if (filter === "loss")   filtered = filtered.filter(t => t.pc24h < 0);
  if (filter === "high")   filtered = filtered.filter(t => t.score < 40);
  if (filter === "low")    filtered = filtered.filter(t => t.score >= 65);

  renderRows(filtered);
};

function renderRows(tokens) {
  const body = document.getElementById("tokensBody");

  if (!tokens.length) {
    body.innerHTML = `<div class="port-empty"><div class="port-empty-icon">🔍</div><div class="port-empty-title">No tokens match this filter</div></div>`;
    return;
  }

  const rows = tokens.map((t, i) => {
    const logo = t.logo
      ? `/.netlify/functions/logoProxy?url=${encodeURIComponent(t.logo)}`
      : "https://placehold.co/36x36";

    // Value
    const valStr    = formatUsd(t.currentValueUsd);
    const tokenStr  = formatAmount(t.uiAmount) + " " + t.symbol;

    // 24h PnL
    const pnl24pct  = t.pc24h ?? 0;
    const pnl24usd  = t.valueChange24hUsd ?? 0;
    const pnl24Cls  = pnl24pct > 0 ? "pnl-profit" : pnl24pct < 0 ? "pnl-loss" : "pnl-neutral";
    const pnl24Sign = pnl24pct >= 0 ? "+" : "";

    // 6h P/L (DexScreener's largest window besides 24h — genuinely different from 24h column)
    const pnl6pct   = t.pc6h ?? 0;
    const pnl6Cls   = pnl6pct > 0 ? "pnl-profit" : pnl6pct < 0 ? "pnl-loss" : "pnl-neutral";
    const pnl6Sign  = pnl6pct >= 0 ? "+" : "";

    // Risk
    const scCls = t.score >= 65 ? "score-g" : t.score >= 40 ? "score-w" : "score-b";

    // 1h trend
    const pc1h    = t.pc1h ?? 0;
    const trendCls = pc1h > 0 ? "trend-up" : pc1h < 0 ? "trend-down" : "trend-flat";
    const trendIcon = pc1h > 0 ? "↑" : pc1h < 0 ? "↓" : "→";

    return `
      <tr style="animation-delay:${i * 0.03}s">
        <td>
          <div class="port-token-cell">
            <img class="port-token-logo"
                 src="${logo}"
                 onerror="this.src='https://placehold.co/36x36'"
                 alt="${t.name}" />
            <div>
              <a href="https://solscan.io/token/${t.mint}" target="_blank" rel="noopener noreferrer" class="port-token-name-link">
                <div class="port-token-name">${t.name}</div>
              </a>
              <div class="port-token-symbol">${t.symbol}</div>
            </div>
          </div>
        </td>
        <td>
          <div class="port-value-usd">${valStr}</div>
          <div class="port-value-tokens">${tokenStr}</div>
        </td>
        <td>
          <div class="port-pnl-cell">
            <div class="port-pnl-pct ${pnl24Cls}">${pnl24Sign}${pnl24pct.toFixed(2)}%</div>
            <div class="port-pnl-usd ${pnl24Cls}">${pnl24Sign}${formatUsd(Math.abs(pnl24usd))}</div>
          </div>
        </td>
        <td>
          <div class="port-pnl-cell">
            <div class="port-pnl-pct ${pnl6Cls}">${pnl6Sign}${pnl6pct.toFixed(2)}%</div>
            <div class="port-pnl-usd" style="opacity:.5;font-size:10px;">6h change</div>
          </div>
        </td>
        <td>
          <div class="port-trend">
            <span class="port-trend-val ${trendCls}">${trendIcon} ${Math.abs(pc1h).toFixed(2)}%</span>
            <span style="font-size:10px;opacity:.45;">1h change</span>
          </div>
        </td>
        <td>
          <div class="port-score-num ${scCls}">${t.score}<span style="font-size:11px;opacity:.4">/100</span></div>
        </td>
        <td>
          <span class="port-risk-badge ${t.riskClass}">${t.riskLabel}</span>
        </td>
      </tr>
    `;
  }).join("");

  body.innerHTML = `
    <div class="port-table-wrap">
      <table class="port-table">
        <thead>
          <tr>
            <th>Token</th>
            <th>Holding Value</th>
            <th>24H P/L</th>
            <th>6H P/L</th>
            <th>1H Trend</th>
            <th>Risk Score</th>
            <th>Risk Level</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="font-size:11px;opacity:.35;padding:12px 4px;">
        * Price change data sourced from DexScreener. Always DYOR.
      </div>
    </div>
  `;
}

/* ============================================================
   UI STATE HELPERS
   ============================================================ */
function showLoadingState(label, pct) {
  const summaryBody = document.getElementById("summaryBody");
  const tokensBody  = document.getElementById("tokensBody");

  summaryBody.innerHTML = `
    <div class="port-loading">
      <div class="port-spinner"></div>
      <div class="port-loading-label" id="loadingLabel">${label}</div>
      <div class="port-progress-wrap">
        <div class="port-progress-fill" id="progressFill" style="width:${pct}%"></div>
      </div>
    </div>
  `;

  tokensBody.innerHTML = `
    <div class="port-loading">
      <div class="port-loading-sub">Waiting for wallet data…</div>
    </div>
  `;
}

function updateProgress(pct, label) {
  const fill  = document.getElementById("progressFill");
  const lbl   = document.getElementById("loadingLabel");
  if (fill) fill.style.width = pct + "%";
  if (lbl)  lbl.textContent  = label;
}

function showEmpty(title, sub) {
  document.getElementById("summaryBody").innerHTML = `
    <div class="port-empty">
      <div class="port-empty-icon">💼</div>
      <div class="port-empty-title">${title}</div>
      <div>${sub}</div>
    </div>
  `;
  document.getElementById("tokensBody").innerHTML = "";
  document.getElementById("filterRow").innerHTML  = "";
}

function showError(msg) {
  document.getElementById("summaryBody").innerHTML = `
    <div class="port-empty">
      <div class="port-empty-icon">⚠️</div>
      <div class="port-empty-title">Scan Failed</div>
      <div style="color:#ff6b6b;font-size:13px;">${msg}</div>
    </div>
  `;
  document.getElementById("tokensBody").innerHTML = "";
}

/* ============================================================
   FORMAT HELPERS
   ============================================================ */
function formatUsd(v) {
  if (!v || isNaN(v)) return "$0.00";
  const abs = Math.abs(v);
  let str;
  if (abs >= 1e9)       str = "$" + (abs / 1e9).toFixed(2) + "B";
  else if (abs >= 1e6)  str = "$" + (abs / 1e6).toFixed(2) + "M";
  else if (abs >= 1e3)  str = "$" + (abs / 1e3).toFixed(2) + "K";
  else if (abs >= 0.01) str = "$" + abs.toFixed(2);
  else                  str = "$" + abs.toFixed(6);
  return v < 0 ? "-" + str : str;
}

function formatAmount(num) {
  if (!num || isNaN(num)) return "0";
  if (num >= 1e12) return (num / 1e12).toFixed(2) + "T";
  if (num >= 1e9)  return (num / 1e9).toFixed(2)  + "B";
  if (num >= 1e6)  return (num / 1e6).toFixed(2)  + "M";
  if (num >= 1e3)  return (num / 1e3).toFixed(2)  + "K";
  return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/* i18n handles data-i18n elements automatically on langchange — no manual call needed */
window.addEventListener("langchange", () => { /* i18n system handles this */ });
