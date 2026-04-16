// UPDATED FILE: script.js – V2.0
import { renderMainAnalysis } from "./mainAnalysis.js";
import { renderSignals } from "./scanSignals.js";
import { renderMarketCap, stopMarketCap } from "./marketCap.js";
import { renderHolders } from "./holders.js";
import { renderFinalScore } from "./finalScore.js";
import { renderTokenStats } from "./tokenStats.js";
import { callRpc } from "./rpc.js";
import { renderNav } from "./nav.js";
import { askSentinel } from "./sentinel.js";
import { renderBundlePanel } from "./bundle-panel.js";
import "./community.js";
import bs58 from "https://cdn.jsdelivr.net/npm/bs58@5.0.0/+esm";

const SCANS_KEY = "s2m_last_scans";
const MAX_HISTORY = 12;

function saveScanToHistory(mint) {
  try {
    const result = window.scanResult;
    const meta = window.scanTokenMeta || {};
    if (!result) return;
    let avgTxSize = "N/A";
    const vol24h  = window.scanVol24h  || 0;
    const buys24h = window.scanBuys24h || 0;
    if (vol24h > 0 && buys24h > 0) {
      const avg = vol24h / buys24h;
      if (avg >= 1000000) avgTxSize = "$" + (avg / 1000000).toFixed(2) + "M";
      else if (avg >= 1000) avgTxSize = "$" + (avg / 1000).toFixed(1) + "K";
      else avgTxSize = "$" + avg.toFixed(0);
    }
    const entry = {
      mint, name: meta.name || "Unknown", symbol: meta.symbol || "",
      logo: meta.logo || null, totalScore: result.totalScore,
      riskLevel: result.riskLevel, liquidity: result.liquidity,
      marketCap: result.marketCap, top10: result.top10, avgTxSize,
      scannedAt: new Date().toISOString()
    };
    let history = [];
    try { const raw = localStorage.getItem(SCANS_KEY); history = raw ? JSON.parse(raw) : []; } catch { history = []; }
    history = history.filter(h => h.mint !== mint);
    history.unshift(entry);
    history = history.slice(0, MAX_HISTORY);
    localStorage.setItem(SCANS_KEY, JSON.stringify(history));
  } catch (e) { console.warn("Could not save scan history:", e); }
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.innerText = text;
}

function isValidSolanaAddress(address) {
  try {
    if (!address) return false;
    if (address.length < 32 || address.length > 44) return false;
    bs58.decode(address);
    return true;
  } catch { return false; }
}

function checkPrefill() {
  try {
    const prefill = localStorage.getItem("s2m_prefill_mint");
    if (prefill) {
      const mintInput = document.getElementById("mintInput");
      if (mintInput) mintInput.value = prefill;
      localStorage.removeItem("s2m_prefill_mint");
    }
  } catch { }
}

/* ================================================
   DEV HISTORY PANEL
   ================================================ */
function renderDevHistory() {
  const el = document.getElementById("devHistoryPanel");
  if (!el) return;

  const creator    = window.scanCreator    || "N/A";
  const freezeAuth = window.scanFreezeAuth || "Renounced";
  const devPercent = window.scanDevPercent || "N/A";
  const mint       = window.scanMint       || "";

  const isRenounced = creator === "Renounced";
  const isFrozen    = freezeAuth !== "Renounced" && freezeAuth !== "N/A";
  const devPctNum   = parseFloat(devPercent) || 0;

  const mintIcon  = isRenounced ? "✅" : "⚠️";
  const mintLabel = isRenounced ? "Renounced" : "Active";
  const mintClass = isRenounced ? "dh-good" : "dh-warn";

  const freezeIcon  = isFrozen ? "🚨" : "✅";
  const freezeLabel = isFrozen ? "Active – Risky" : "Renounced";
  const freezeClass = isFrozen ? "dh-bad" : "dh-good";

  let devIcon, devClass, devRisk;
  if (devPercent === "Renounced" || devPctNum === 0) {
    devIcon = "✅"; devClass = "dh-good"; devRisk = "None";
  } else if (devPctNum <= 2) {
    devIcon = "✅"; devClass = "dh-good"; devRisk = "Very Low";
  } else if (devPctNum <= 5) {
    devIcon = "⚠️"; devClass = "dh-warn"; devRisk = "Low";
  } else if (devPctNum <= 15) {
    devIcon = "⚠️"; devClass = "dh-warn"; devRisk = "Moderate";
  } else {
    devIcon = "🚨"; devClass = "dh-bad"; devRisk = "HIGH";
  }

  let trustScore = 80;
  if (!isRenounced) trustScore -= 25;
  if (isFrozen)     trustScore -= 30;
  if (devPctNum > 15) trustScore -= 25;
  else if (devPctNum > 5) trustScore -= 12;
  else if (devPctNum > 2) trustScore -= 5;
  trustScore = Math.max(0, Math.min(100, trustScore));

  const trustClass = trustScore >= 65 ? "dh-good" : trustScore >= 40 ? "dh-warn" : "dh-bad";
  const trustLabel = trustScore >= 65 ? "Trustworthy" : trustScore >= 40 ? "Use Caution" : "High Risk";
  const trustBarColor = trustScore >= 65 ? "#2cffc9" : trustScore >= 40 ? "#ffd166" : "#ff4d6d";

  const shortCreator = isRenounced ? "Renounced" : creator.slice(0, 6) + "…" + creator.slice(-6);
  const solscanCreator = isRenounced ? "#" : `https://solscan.io/account/${creator}`;

  el.innerHTML = `
    <div class="dh-trust-block">
      <div class="dh-trust-top">
        <span class="dh-trust-title">Dev Trust Score</span>
        <span class="dh-trust-num ${trustClass}">${trustScore}/100</span>
      </div>
      <div class="dh-bar-wrap">
        <div class="dh-bar-fill" style="width:${trustScore}%; background: linear-gradient(90deg, ${trustBarColor}, ${trustBarColor}bb);"></div>
      </div>
      <div class="dh-trust-verdict ${trustClass}">${trustLabel}</div>
    </div>
    <div class="dh-checks">
      <div class="dh-check-row">
        <span class="dh-check-icon">${mintIcon}</span>
        <span class="dh-check-label">Mint Authority</span>
        <span class="dh-check-val ${mintClass}">${mintLabel}</span>
      </div>
      <div class="dh-check-row">
        <span class="dh-check-icon">${freezeIcon}</span>
        <span class="dh-check-label">Freeze Authority</span>
        <span class="dh-check-val ${freezeClass}">${freezeLabel}</span>
      </div>
      <div class="dh-check-row">
        <span class="dh-check-icon">${devIcon}</span>
        <span class="dh-check-label">Dev Holdings</span>
        <span class="dh-check-val ${devClass}">${devPercent} — ${devRisk}</span>
      </div>
      <div class="dh-check-row">
        <span class="dh-check-icon">👛</span>
        <span class="dh-check-label">Creator Wallet</span>
        <a href="${solscanCreator}" target="_blank" rel="noopener noreferrer"
          class="dh-wallet-link ${isRenounced ? "dh-good" : "dh-warn"}">${shortCreator}</a>
      </div>
    </div>
    <div class="dh-note">⛓️ All data verified on-chain via Solana RPC</div>
  `;
}

/* ================================================
   TOKEN LINKS PANEL
   ================================================ */
function renderTokenLinks(mint) {
  const el = document.getElementById("tokenLinksPanel");
  if (!el) return;

  const meta   = window.scanTokenMeta || {};
  const name   = meta.name   || "Token";
  const symbol = meta.symbol || "";
  const score  = window.scanResult?.totalScore ?? "N/A";
  const risk   = window.scanResult?.riskLevel  ?? "";

  const links = [
    { icon: "📊", label: "DexScreener",  sub: "Charts & liquidity",   url: `https://dexscreener.com/solana/${mint}`,                                                        cls: "tl-dex"  },
    { icon: "🔎", label: "Solscan",      sub: "On-chain explorer",     url: `https://solscan.io/token/${mint}`,                                                              cls: "tl-sol"  },
    { icon: "🦅", label: "Birdeye",      sub: "Advanced analytics",    url: `https://birdeye.so/token/${mint}?chain=solana`,                                                 cls: "tl-bird" },
    { icon: "🪐", label: "Jupiter",      sub: "Swap token",            url: `https://jup.ag/swap/SOL-${mint}`,                                                              cls: "tl-jup"  },
    { icon: "🌊", label: "Raydium",      sub: "DEX pool",              url: `https://raydium.io/swap/?inputCurrency=sol&outputCurrency=${mint}`,                             cls: "tl-ray"  },
    { icon: "🐦", label: "Post to X",    sub: "Share your scan",       url: `https://twitter.com/intent/tweet?text=${encodeURIComponent(`Scanned ${name} ($${symbol}) on @Scan2Moon 🔍\nScore: ${score}/100 — ${risk}\nhttps://scan2moon.com`)}`, cls: "tl-x" },
  ];

  el.innerHTML = `
    <div class="tl-mint-row">
      <span class="tl-mint-label">Token Mint</span>
      <span class="tl-mint-addr" title="${mint}">${mint.slice(0,8)}…${mint.slice(-8)}</span>
      <button class="tl-copy-btn" onclick="navigator.clipboard.writeText('${mint}').then(()=>{this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',1500)})">Copy</button>
    </div>
    <div class="tl-grid">
      ${links.map(l => `
        <a href="${l.url}" target="_blank" rel="noopener noreferrer" class="tl-btn ${l.cls}">
          <span class="tl-btn-icon">${l.icon}</span>
          <div class="tl-btn-text">
            <div class="tl-btn-label">${l.label}</div>
            <div class="tl-btn-sub">${l.sub}</div>
          </div>
          <span class="tl-arrow">↗</span>
        </a>
      `).join("")}
    </div>
  `;
}

/* ================================================
   SENTINEL BUTTON — appears after scan completes
   ================================================ */
function renderSentinelButton() {
  let wrap = document.getElementById("sentinelBtnWrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "sentinelBtnWrap";
    wrap.className = "ask-sentinel-btn-wrap";
    /* Insert after the final score panel */
    const finalScoreEl = document.getElementById("finalScore");
    if (finalScoreEl && finalScoreEl.parentElement) {
      finalScoreEl.parentElement.insertBefore(wrap, finalScoreEl.nextSibling);
    }
  }
  wrap.innerHTML = `
    <button class="ask-sentinel-btn" onclick="window.askSentinel()">
      <span class="ask-sentinel-btn-icon">🤖</span>
      Ask Sentinel — AI Analysis
    </button>
  `;
}

/* ============================= */
/* NAV + PREFILL ON LOAD         */
/* ============================= */
document.addEventListener("DOMContentLoaded", () => {
  renderNav();
  checkPrefill();
});

/* ============================= */
/* SCAN BUTTON HANDLER           */
/* ============================= */
document.getElementById("scanBtn").onclick = async () => {
  const mintInput = document.getElementById("mintInput");
  const mint = mintInput.value.trim();

  if (!mint) { alert("Paste token mint address"); return; }
  if (!isValidSolanaAddress(mint)) {
    alert("Invalid Solana mint address.\nPlease check for typos (no 0, O, I, l allowed).");
    return;
  }

  setText("mainAnalysis",    "Loading...");
  setText("holdersTable",    "Loading...");
  setText("scanSignals",     "Analyzing market...");
  setText("finalScore",      "Calculating score...");
  setText("marketCap",       "Loading...");
  setText("tokenStats",      "Loading token stats...");
  setText("devHistoryPanel", "Loading...");
  setText("tokenLinksPanel", "Loading...");

  window.scanVol24h  = 0;
  window.scanBuys24h = 0;
  stopMarketCap();

  try {
    await renderMainAnalysis(mint);
    await renderHolders(mint);
    await renderSignals(mint);
    await renderTokenStats(mint);
    await renderFinalScore();

    renderDevHistory();
    renderTokenLinks(mint);
    saveScanToHistory(mint);
    renderSentinelButton();
    renderBundlePanel(mint);

    if (window.incrementGlobalStat) window.incrementGlobalStat("scan");
    if (window.scanResult?.totalScore >= 80 && window.incrementGlobalStat) window.incrementGlobalStat("moon");

  } catch (e) {
    console.error("Core scan failed:", e);
    setText("mainAnalysis",    "Scan failed");
    setText("holdersTable",    "Unavailable");
    setText("scanSignals",     "Unavailable");
    setText("finalScore",      "0");
    setText("tokenStats",      "Unavailable");
    setText("devHistoryPanel", "Unavailable");
    setText("tokenLinksPanel", "Unavailable");
    const msg = e.message || "";
    if (msg.includes("not a Token mint")) {
      alert("❌ Wrong address type!\n\nYou pasted a WALLET address.\nRisk Scanner needs a TOKEN MINT address.\n\nTo find a token mint:\n• Go to Dexscreener.com and find your token\n• Copy the contract address (CA)\n• Paste that here\n\nTo scan a wallet, use the 💼 PORTFOLIO page.");
    } else {
      alert("Scan failed.\nInvalid mint or backend error.\nCheck console for details.");
    }
    return;
  }

  try { renderMarketCap(mint); }
  catch (e) { console.warn("Market cap failed:", e); setText("marketCap", "Market cap unavailable"); }
};