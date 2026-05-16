const _DEBUG = false;
// Expose site key as a global so sub-modules can use it without import.meta.env
window.__s2mKey = (typeof import.meta !== "undefined" && import.meta.env?.VITE_SITE_KEY) || "";

// UPDATED FILE: script.js – V2.2
import { renderMainAnalysis } from "./mainAnalysis.js";
import { renderSignals } from "./scanSignals.js";
import { renderMarketCap, stopMarketCap } from "./marketCap.js";
import { renderHolders } from "./holders.js";
import { renderFinalScore } from "./finalScore.js?v=2";
import { renderTokenStats } from "./tokenStats.js";
import { renderNav } from "./nav.js";
import { askSentinel } from "./sentinel.js";
import { esc } from "./utils.js";
import { renderBundlePanel } from "./bundle-panel.js?v=4";
import { renderLpPredictorPanel } from "./lp-predictor.js?v=2";
import { prefetchScanData } from "./scanData.js";
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
  } catch (e) { _DEBUG && console.warn("Could not save scan history:", e); }
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
      // Auto-trigger scan so the user lands on results immediately
      setTimeout(() => {
        const btn = document.getElementById("scanBtn");
        if (btn) btn.click();
      }, 300);
    }
  } catch { }
}

/* ── Dev History SVG gauge (270° arc) ── */
function dhGaugeSVG(score) {
  const col = score >= 65 ? "#2cffc9" : score >= 40 ? "#ffd166" : "#ff4d6d";
  const R = 38, cx = 48, cy = 50;
  const C = 2 * Math.PI * R;
  const arcFull = (270 / 360) * C;
  const arcFill = Math.max(4, (score / 100) * arcFull);
  return `<svg class="dh-gauge-svg" viewBox="0 0 96 100" width="96" height="100" xmlns="http://www.w3.org/2000/svg">
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="7"
      stroke-dasharray="${arcFull.toFixed(1)} ${(C-arcFull).toFixed(1)}" stroke-linecap="round" transform="rotate(135 ${cx} ${cy})"/>
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${col}" stroke-width="7" opacity="0.2"
      stroke-dasharray="${arcFill.toFixed(1)} ${(C-arcFill).toFixed(1)}" stroke-linecap="round" transform="rotate(135 ${cx} ${cy})"/>
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${col}" stroke-width="6"
      stroke-dasharray="${arcFill.toFixed(1)} ${(C-arcFill).toFixed(1)}" stroke-linecap="round" transform="rotate(135 ${cx} ${cy})"/>
    <circle cx="${cx}" cy="${cy}" r="26" fill="rgba(0,8,5,0.6)"/>
    <text x="${cx}" y="${cy - 3}" text-anchor="middle" dominant-baseline="middle"
      font-family="JetBrains Mono,monospace" font-size="17" font-weight="900" fill="${col}">${score}</text>
    <text x="${cx}" y="${cy + 12}" text-anchor="middle"
      font-family="JetBrains Mono,monospace" font-size="6" font-weight="700"
      fill="rgba(200,220,210,0.4)" letter-spacing="1">TRUST</text>
  </svg>`;
}

/* ================================================
   DEV HISTORY PANEL
   ================================================ */
async function renderDevHistory() {
  const el = document.getElementById("devHistoryPanel");
  if (!el) return;

  const creator    = window.scanCreator    || "N/A";
  const mintAuth   = window.scanMintAuth   || "Unknown";
  const freezeAuth = window.scanFreezeAuth || "Unknown";
  const devPercent = window.scanDevPercent || "N/A";

  // isRenounced = no real deployer wallet (mint was renounced from the start)
  const isRenounced   = creator === "Renounced" || !creator || creator === "N/A";
  // isMintRenounced reads the actual mintAuthority field, not the creator wallet
  const isMintRenounced = mintAuth === "Renounced" || mintAuth === null;
  const isFrozen        = freezeAuth !== "Renounced" && freezeAuth !== "Unknown" && freezeAuth !== "N/A";
  const devPctNum       = parseFloat(devPercent) || 0;

  const mintIcon  = isMintRenounced ? "✅" : "⚠️";
  const mintLabel = isMintRenounced ? "Renounced" : "Active";
  const mintClass = isMintRenounced ? "dh-good" : "dh-warn";

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

  // Base trust score from on-chain authority data (fast, no API needed)
  let trustScore = 80;
  if (!isMintRenounced) trustScore -= 25;
  if (isFrozen)     trustScore -= 30;
  if (devPctNum > 15) trustScore -= 25;
  else if (devPctNum > 5) trustScore -= 12;
  else if (devPctNum > 2) trustScore -= 5;
  trustScore = Math.max(0, Math.min(100, trustScore));

  const shortCreator   = isRenounced ? "Renounced" : creator.slice(0, 6) + "…" + creator.slice(-6);
  const solscanCreator = isRenounced ? "#" : `https://solscan.io/account/${creator}`;

  // ── Step 1: render static panel immediately (no network wait) ───────────
  function buildStaticHTML(score) {
    const tc = score >= 65 ? "dh-good" : score >= 40 ? "dh-warn" : "dh-bad";
    const tl = score >= 65 ? "Trustworthy" : score >= 40 ? "Use Caution" : "High Risk";
    return `
      <div class="dh-top">
        <div class="dh-gauge-col">${dhGaugeSVG(score)}</div>
        <div class="dh-info-col">
          <div class="dh-verdict-pill ${tc}">${tl}</div>
          <div class="dh-checks">
            <div class="dh-check-row">
              <span class="dh-check-icon">${mintIcon}</span>
              <span class="dh-check-label">Mint Auth</span>
              <span class="dh-check-val ${mintClass}">${mintLabel}</span>
            </div>
            <div class="dh-check-row">
              <span class="dh-check-icon">${freezeIcon}</span>
              <span class="dh-check-label">Freeze Auth</span>
              <span class="dh-check-val ${freezeClass}">${freezeLabel}</span>
            </div>
            <div class="dh-check-row">
              <span class="dh-check-icon">${devIcon}</span>
              <span class="dh-check-label">Dev Holdings</span>
              <span class="dh-check-val ${devClass}">${esc(devPercent)} — ${devRisk}</span>
            </div>
            <div class="dh-check-row">
              <span class="dh-check-icon">👛</span>
              <span class="dh-check-label">Creator</span>
              <a href="${esc(solscanCreator)}" target="_blank" rel="noopener noreferrer"
                class="dh-wallet-link ${isRenounced ? "dh-good" : "dh-warn"}">${esc(shortCreator)}</a>
            </div>
          </div>
        </div>
      </div>`;
  }

  el.innerHTML = '<div class="dh-card">'
    + buildStaticHTML(trustScore)
    + `<div id="dh-history-section" class="dh-history-loading">
         <span class="dh-history-spinner"></span> Scanning deploy history…
       </div>`
    + '<div class="dh-footer">⛓️ Helius · Birdeye</div>'
    + '</div>';

  // ── Step 2: if wallet is known → skip history fetch ─────────────────────
  if (isRenounced || !creator || creator === "N/A" || creator === "Unknown") {
    document.getElementById("dh-history-section").innerHTML =
      `<div class="dh-history-empty">No deployer wallet on-chain</div>`;
    return;
  }

  // ── Step 3: fetch dev wallet history from our new endpoint ──────────────
  try {
    const res = await fetch(`/.netlify/functions/devWallet?wallet=${encodeURIComponent(creator)}`, {
      headers: { "X-Api-Key": window.__s2mKey || "" },
    });
    const data = res.ok ? await res.json() : null;

    const histSec = document.getElementById("dh-history-section");
    if (!histSec) return;

    if (!data || data.totalDeployed === 0) {
      histSec.innerHTML = `<div class="dh-history-empty">First-time deployer — no prior tokens found</div>`;
      return;
    }

    // Apply history penalty to trust score
    const finalTrust = Math.max(0, trustScore - (data.historyPenalty ?? 0));
    if (data.historyPenalty > 0) {
      // Re-render the trust block with updated score using safe DOM replacement
      const trustEl = el.querySelector(".dh-trust-block");
      if (trustEl) {
        const tmp = document.createElement("div");
        tmp.innerHTML = buildStaticHTML(finalTrust);
        const newBlock = tmp.querySelector(".dh-trust-block");
        if (newBlock) trustEl.replaceWith(newBlock);
      }
    }

    // Token status badge helper
    const badge = (status) => {
      const map = {
        ACTIVE:  ["dh-badge-active",  "ACTIVE"],
        DEAD:    ["dh-badge-dead",    "DEAD"],
        DUMPED:  ["dh-badge-dumped",  "DUMPED"],
        RUG:     ["dh-badge-rug",     "RUG 🚨"],
        UNKNOWN: ["dh-badge-unknown", "?"],
      };
      const [cls, lbl] = map[status] ?? map.UNKNOWN;
      return `<span class="dh-badge ${cls}">${lbl}</span>`;
    };

    const rugIcon  = data.rugRate >= 50 ? "🚨" : data.rugRate >= 20 ? "⚠️" : "✅";
    const rugClass = data.rugRate >= 50 ? "dh-bad" : data.rugRate >= 20 ? "dh-warn" : "dh-good";

    const tokenRows = data.tokens.slice(0, 8).map(t => {
      const short = t.mint.slice(0, 5) + "…" + t.mint.slice(-4);
      const liq   = t.liquidity >= 1000
        ? "$" + (t.liquidity / 1000).toFixed(1) + "k"
        : "$" + Math.round(t.liquidity);
      return `
        <div class="dh-token-row">
          <span class="dh-token-name">${esc(t.symbol || "?")} <span class="dh-token-mint">${short}</span></span>
          <span class="dh-token-liq">${liq}</span>
          ${badge(t.status)}
        </div>`;
    }).join("");

    histSec.className = "dh-history-loaded";
    histSec.innerHTML = `
      <div class="dh-history-header">
        <span class="dh-history-title">🕵️ Deploy History</span>
        <span class="dh-history-stats">
          ${data.totalDeployed} tokens &nbsp;·&nbsp;
          <span class="${rugClass}">${rugIcon} ${data.rugRate}% rug rate</span>
        </span>
      </div>
      <div class="dh-token-list">${tokenRows}</div>
      ${data.totalDeployed > 8 ? `<div class="dh-history-more">+${data.totalDeployed - 8} more tokens</div>` : ""}
    `;

  } catch (e) {
    const histSec = document.getElementById("dh-history-section");
    if (histSec) histSec.innerHTML = `<div class="dh-history-empty">History unavailable</div>`;
    _DEBUG && console.warn("[devHistory]", e);
  }
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
    { icon: "📈", label: "DexScreener",  sub: "Charts & price",      url: `https://dexscreener.com/solana/${mint}`,                                                                cls: "tl-dex"  },
    { icon: "🔎", label: "Solscan",       sub: "On-chain explorer",   url: `https://solscan.io/token/${mint}`,                                                                     cls: "tl-sol"  },
    { icon: "🦅", label: "Birdeye",       sub: "Advanced analytics",  url: `https://birdeye.so/token/${mint}?chain=solana`,                                                        cls: "tl-bird" },
    { icon: "🪐", label: "Jupiter",       sub: "Swap token",          url: `https://jup.ag/swap/SOL-${mint}`,                                                                      cls: "tl-jup"  },
    { icon: "🌊", label: "Raydium",       sub: "DEX pool",            url: `https://raydium.io/swap/?inputCurrency=sol&outputCurrency=${mint}`,                                    cls: "tl-ray"  },
    { icon: "🐦", label: "Post to X",     sub: "Share your scan",     url: `https://twitter.com/intent/tweet?text=${encodeURIComponent(`Scanned ${name} ($${symbol}) on @Scan2Moon 🔍\nScore: ${score}/100 — ${risk}\nhttps://scan2moon.com`)}`, cls: "tl-x" },
  ];

  el.innerHTML = `
    <div class="tl-card">
      <div class="tl-mint-row">
        <span class="tl-mint-label">MINT</span>
        <span class="tl-mint-addr" title="${esc(mint)}">${esc(mint.slice(0,8))}…${esc(mint.slice(-8))}</span>
        <button class="tl-copy-btn" data-mint="${esc(mint)}">Copy</button>
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
      <div class="tl-footer">⛓️ Solana · Links open in new tab</div>
    </div>
  `;

  // Bind copy button safely (avoids inline onclick with user data)
  const copyBtn = el.querySelector(".tl-copy-btn[data-mint]");
  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(copyBtn.dataset.mint).then(() => {
        copyBtn.textContent = "Copied!";
        setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
      });
    });
  }
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
const _scanBtn = document.getElementById("scanBtn");
if (_scanBtn) _scanBtn.onclick = async () => {
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

  try {
    stopMarketCap();
    await prefetchScanData(mint);
    await renderMainAnalysis(mint);
    await renderHolders(mint);
    await renderSignals(mint);
    await renderTokenStats(mint);
    await renderFinalScore();

    // Cache exact scanner score in localStorage so other pages (gainers, new-pairs,
    // watchlist) can show the identical score for tokens you've just scanned.
    if (window.scanResult?.totalScore != null) {
      try {
        const scoreCache = {
          score: window.scanResult.totalScore,
          level: window.scanResult.riskLevel,
          ts: Date.now(),
        };
        localStorage.setItem(`s2m_score_cache:${mint}`, JSON.stringify(scoreCache));
      } catch { /* non-fatal */ }
    }

    renderDevHistory();
    renderTokenLinks(mint);
    saveScanToHistory(mint);
    renderSentinelButton();
    renderBundlePanel(mint);
    renderLpPredictorPanel(mint);

    if (window.incrementGlobalStat) window.incrementGlobalStat("scan");
    if (window.scanResult?.totalScore >= 80 && window.incrementGlobalStat) window.incrementGlobalStat("moon");

  } catch (e) {
    _DEBUG && console.error("Core scan failed:", e);
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
  catch (e) { _DEBUG && console.warn("Market cap failed:", e); setText("marketCap", "Market cap unavailable"); }
};
