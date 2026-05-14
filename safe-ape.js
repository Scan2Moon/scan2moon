const _DEBUG = false;

/* ============================================================
   Scan2Moon – safe-ape.js  (V2.1 REAL-TIME + WEBSOCKET CANDLES)

   • CandleChart engine – OHLC candles on TradingView Lightweight Charts
   • Birdeye WebSocket — live PRICE_DATA feeds the candle chart directly
     (replaces 3 s REST polling; zero polling lag, true real-time)
   • Metadata (mc, liq, priceChange) polled every 30s from Birdeye REST
   • Portfolio polled every 5s
   • All trades use freshly-fetched price
   ============================================================ */

import { renderNav }                    from "./nav.js";
import { CandleChart }                  from "./candleChart.js";
import { birdeyeWs }                    from "./birdeye-ws.js";
import "./community.js";
import { computeRiskScore, pickSmartPair } from "./scanSignals.js";
import { applyTranslations, t } from "./i18n.js";
import { addToWatchlist, isOnWatchlist } from "./watchlist.js";

const SCAN_TOKEN_API  = "/.netlify/functions/scanToken";       // Full Birdeye scan — same as Risk Scanner
const TOKEN_DATA_API  = "/.netlify/functions/tokenData";       // Birdeye single-token overview (price polls)
const TOKEN_BATCH_API = "/.netlify/functions/batchTokenData";  // Birdeye batch token overview
const SIM_API         = "/.netlify/functions/simulator";
const LB_API         = "/.netlify/functions/leaderboard";
const GECKO_PROXY    = "/.netlify/functions/geckoProxy";  // Birdeye OHLCV (was GeckoTerminal)
const PRICE_ONLY_API = "/.netlify/functions/priceOnly";
const JUP_REF       = "49h527zlp56g";
// SA_FAST_MS removed — replaced by Birdeye WebSocket (true real-time, no polling interval needed)
const SA_SLOW_MS    = 30000;  /* full Birdeye metadata refresh interval (mc, liq, priceChange) */

/* ── Security helpers ───────────────────────────────────────────────────
   esc()      – HTML-escapes any string before injecting into innerHTML.
   safeMint() – Strips non-base58 characters from mint addresses used in
                onclick attributes, preventing any injection via crafted
                API responses. Valid Solana mints are [1-9A-HJ-NP-Za-km-z].
   -------------------------------------------------------------------- */
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function safeMint(mint) {
  return String(mint ?? "").replace(/[^1-9A-HJ-NP-Za-km-z]/g, "");
}
// chartProxy removed — all chart data uses Birdeye via ohlcvData / geckoProxy

/* ── Leaderboard auto-registration ─────────────────────────────────────
   Called after every buy/sell so the wallet always appears in rankings.
   Fire-and-forget — any failure is logged but never blocks the trade. */
function registerInLeaderboard(walletAddr) {
  if (!walletAddr) return;
  fetch(LB_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet: walletAddr })
  }).catch(err => _DEBUG && console.warn("LB register failed (non-critical):", err.message));
}

/* ── Pick the best Solana pair for a token ─────────────────────────────
   DexScreener's chart UI shows the pool with the highest 24h volume —
   that is what traders watch and what the OHLCV data should match.
   Sorting by liquidity instead (old behaviour) often picked a different
   AMM pool (e.g. Raydium vs Meteora) whose price action looks totally
   different, making our candles not match DexScreener's chart at all. */
/* Delegates to the shared smart picker so Safe Ape always matches Risk Scanner.
   Also sets window.scanIsPumpFun / window.scanHasGraduated for computeRiskScore. */
function pickBestPair(mint, pairs) {
  const { pair, isPumpFun, hasGraduated } = pickSmartPair(mint, pairs);
  window.scanIsPumpFun    = isPumpFun;
  window.scanHasGraduated = hasGraduated;
  return pair;
}

/* ── Convert a Birdeye tokenData response to a DexScreener-compatible pair ──
   Lets the existing risk-scoring engine (computeRiskScore) and all panel-
   render functions work unchanged when data comes from Birdeye instead of
   DexScreener.  The shape only needs the fields actually read by Safe Ape. */
function birdeyeTokenToPair(t, mint) {
  if (!t) return null;
  let pairCreatedAt = null;
  if (t.createdAt) {
    pairCreatedAt = typeof t.createdAt === "string"
      ? new Date(t.createdAt).getTime()
      : (t.createdAt < 1e12 ? t.createdAt * 1000 : t.createdAt);
  }
  return {
    pairAddress:  mint,
    chainId:      "solana",
    dexId:        "birdeye",
    baseToken:    { address: mint, name: t.name ?? "Unknown", symbol: t.symbol ?? "?" },
    quoteToken:   { symbol: "USDC" },
    priceUsd:     String(parseFloat(t.priceUsd ?? 0)),
    priceChange: {
      m5:  0,
      h1:  parseFloat(t.priceChange1h  ?? 0),
      h6:  parseFloat(t.priceChange6h  ?? 0),
      h24: parseFloat(t.priceChange24h ?? 0),
    },
    volume: {
      h1:  parseFloat(t.volume1h  ?? 0),
      h24: parseFloat(t.volume24h ?? 0),
    },
    liquidity:  { usd: parseFloat(t.liquidity  ?? 0) },
    marketCap:  parseFloat(t.marketCap ?? 0) || null,
    fdv:        parseFloat(t.fdv ?? t.marketCap ?? 0) || null,  /* BUG-04: use real FDV field, not marketCap alias */
    txns: {
      h1:  { buys: parseInt(t.buy1h  ?? 0), sells: parseInt(t.sell1h  ?? 0) },
      h24: { buys: parseInt(t.buy24h ?? 0), sells: parseInt(t.sell24h ?? 0) },
    },
    pairCreatedAt,
    info: { imageUrl: t.logoUri ?? null },
  };
}

/* GeckoTerminal timeframe map: tf → { path, agg, limit }
   Limits cover a reasonable lookback for each TF.
   "max" is a special virtual TF: daily candles with max limit for full history. */
const TF_GECKO = {
  "1m":  { path: "minute", agg: 1,  limit: 180 },  /* ~3 h  */
  "5m":  { path: "minute", agg: 5,  limit: 200 },  /* ~16 h */
  "15m": { path: "minute", agg: 15, limit: 200 },  /* ~2 d  */
  "1h":  { path: "hour",   agg: 1,  limit: 200 },  /* ~8 d  */
  "4h":  { path: "hour",   agg: 4,  limit: 250 },  /* ~6 wk  */
  "12h": { path: "hour",   agg: 12, limit: 200 },  /* ~3 mo  */
  "1d":  { path: "day",    agg: 1,  limit: 500 },  /* ~16 mo — covers most tokens */
  "max": { path: "day",    agg: 1,  limit: 1000 }, /* all-time: max daily candles   */
};

/* ── Tick buffer — stores real price polls so brand-new tokens that aren't
   yet indexed by GeckoTerminal / DexScreener chart endpoints still get
   historical candles built from the live 1.5-second polling cycle.
   _tickBuffer[mint] = [ { ts_ms, price, vol1h }, … ]  (newest at end) */
const TICK_BUFFER_MAX = 2000; /* ~50 min of 1.5 s ticks per token */
const _tickBuffer     = {};   /* mint → tick array                  */
const _TF_MS = {
  "1m":  60000,   "5m":  300000,  "15m": 900000,
  "1h":  3600000, "4h":  14400000,"12h": 43200000, "1d":  86400000, "max": 86400000,
};

function _storeTick(mint, price, vol1h) {
  if (!_tickBuffer[mint]) _tickBuffer[mint] = [];
  /* BUG-05: track elapsed ms since last tick so OHLCV volume is proportional
     to actual time covered, not a fixed 2400-tick divisor. */
  const now = Date.now();
  /* PERF-03: evict buffers for tokens not viewed in the last 10 minutes */
  for (const m of Object.keys(_tickBuffer)) {
    if (m !== mint && _tickBuffer[m]._lastAccess && (now - _tickBuffer[m]._lastAccess > 600_000)) {
      delete _tickBuffer[m];
    }
  }
  const prevTick = _tickBuffer[mint][_tickBuffer[mint].length - 1];
  const elapsed_ms = prevTick ? Math.min(now - prevTick.ts_ms, 60_000) : 1500;
  _tickBuffer[mint].push({ ts_ms: now, price, vol1h, elapsed_ms });
  _tickBuffer[mint]._lastAccess = now;
  if (_tickBuffer[mint].length > TICK_BUFFER_MAX) _tickBuffer[mint].shift();
}

/* Convert stored ticks to OHLCV array [[ts_sec,o,h,l,c,v], …] for a given TF.
   Returns null when fewer than 2 completed candles exist. */
function _buildOhlcvFromTicks(mint, tf) {
  const ticks = _tickBuffer[mint];
  if (!ticks || ticks.length < 3) return null;
  const tfMs    = _TF_MS[tf] || 300000;
  const candles = {};
  for (const { ts_ms, price, vol1h, elapsed_ms } of ticks) {
    const periodStart = Math.floor(ts_ms / tfMs) * tfMs;
    const ts          = Math.floor(periodStart / 1000); /* seconds — Lightweight Charts format */
    if (!candles[ts]) {
      candles[ts] = [ts, price, price, price, price, 0]; /* [ts,o,h,l,c,v] */
    } else {
      if (price > candles[ts][2]) candles[ts][2] = price; /* high */
      if (price < candles[ts][3]) candles[ts][3] = price; /* low  */
      candles[ts][4] = price;                              /* close */
    }
    /* BUG-05: use actual elapsed ms instead of fixed 2400-tick divisor */
    candles[ts][5] += vol1h * ((elapsed_ms || 1500) / 3_600_000);
  }
  const sorted = Object.values(candles).sort((a, b) => a[0] - b[0]);
  /* Need at least 2 candles — the last one may be still-forming */
  return sorted.length >= 2 ? sorted : null;
}

/* ── Timers ── */
let tokenPollTimer       = null;
let portfolioPollTimer   = null;
let pnlTickTimer         = null;
let solPriceTimer        = null;  /* BUG-01: 60s SOL/USD price refresh — guarded against duplicate timers */
let _saWsUnsub           = null;  /* cleanup fn returned by birdeyeWs.subscribe() */
let _saChartSlowInterval = null;  /* 30s Birdeye metadata poll for mc/liq/priceChange */
let _saChartFastInterval = null;  /* 4s REST poll — WS fallback only, activates after 8s WS silence */
let _lastWsTick          = 0;     /* PERF-04: timestamp of last WS price message for REST fallback logic */
let _fcmModalOpen        = false; /* UX-06: true while fullscreen chart modal is open */

const TOKEN_POLL_MS = 30000; /* full Birdeye scan poll every 30s */

/* ── State ── */
let wallet       = null;
let profile      = null;
let currentToken = null;
let livePrices   = {};   // mint → last VALIDATED price (used for P/L and trades)
let _priceEmas   = {};   // mint → EMA used to filter bad price ticks
let _peakPrices  = {};   // mint → highest validated price seen this session (rug detection)
let _rugTriggered = {};  // mint → true once rug overlay has been shown (no repeat spam)
let candleChart  = null;
let riskScore    = 0;
let currentTab   = "buy";
let currentTf    = "5m";
let solPrice     = 0;       // live SOL/USD price (fetched via /solPrice function)
const SOL_LOGO   = "S2M-Logo.webp";
/* chartReqId: incremented every time we start a new chart load.
   Each fetch captures its own ID; if it no longer matches when the
   fetch completes it means the user switched TF/token — we discard. */
let chartReqId   = 0;
let tfDebounce   = null;   // debounce timer for TF button rapid-clicks

/* ============================================================
   SOL PRICE  — fetched every 60 s so the balance always shows
   an up-to-date "≈ $X" USD equivalent next to the SOL amount.
   Routed through /.netlify/functions/solPrice (server-side).
   Primary: Jupiter · Fallback: CoinGecko · Tertiary: Binance/OKX
   ============================================================ */
async function fetchSolPrice() {
  // Dedicated solPrice function — proxies Binance server-side (no CORS issues).
  try {
    const r = await fetch("/.netlify/functions/solPrice",
      { signal: AbortSignal.timeout(5000) });
    const d = await r.json();
    const p = parseFloat(d.price);
    if (p > 0) { solPrice = p; updateStaticUI(); return; }
  } catch (e) { _DEBUG && console.warn("SOL price fetch failed:", e); }
}

function formatSol(n) {
  if (n === null || n === undefined || isNaN(n)) return "0 S2M";
  const abs = Math.abs(n);
  if (abs === 0)    return "0 S2M";
  if (abs < 0.001)  return n.toFixed(6) + " S2M";
  if (abs < 0.1)    return n.toFixed(4) + " S2M";
  if (abs < 10)     return n.toFixed(3) + " S2M";
  return n.toFixed(2) + " S2M";
}

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener("DOMContentLoaded", () => {
  renderNav();
  applyTranslations();

  const saved = localStorage.getItem("sa_wallet");
  /* SEC-01: re-validate saved address before trusting it — prevents poisoned localStorage from
     reaching the server (e.g. injected by XSS or malicious browser extension). */
  if (saved && isBase58Address(saved)) {
    wallet = saved;
    initSimulator();
  } else if (saved) {
    localStorage.removeItem("sa_wallet"); // discard invalid stored value
  }

  document.getElementById("connectWalletBtn").addEventListener("click", connectWallet);
  document.getElementById("disconnectBtn").addEventListener("click", disconnectWallet);
  document.getElementById("saSearchBtn").addEventListener("click", searchToken);
  document.getElementById("saTokenInput").addEventListener("keydown", e => { if (e.key === "Enter") searchToken(); });

  /* ── Browser Back from token view → return to Your Holdings ──
     When searchToken() pushes #token onto history, pressing Back fires
     popstate with no saView state. We close the terminal and scroll the
     user back to the holdings panel so they land exactly where they were. */
  window.addEventListener("popstate", (e) => {
    if (!e.state || e.state.saView !== "token") {
      if (document.getElementById("saTerminal").style.display !== "none") {
        clearTerminal();
        const holdingsPanel = document.getElementById("saPortfolioPanel");
        if (holdingsPanel) holdingsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  });
  document.getElementById("buyAmount").addEventListener("input", updateBuyInfo);
  document.getElementById("sellAmount").addEventListener("input", updateSellInfo);
  document.getElementById("dailyClaimBtn").addEventListener("click", claimDaily);

  /* ── Auto-load token passed from other pages ────────────────
     Other pages call: localStorage.setItem("s2m_sa_mint", mint)
     then navigate to safe-ape.html. We pick it up here, pre-fill
     the input and fire the search automatically. */
  const autoMint = localStorage.getItem("s2m_sa_mint");
  if (autoMint) {
    localStorage.removeItem("s2m_sa_mint");
    const inp = document.getElementById("saTokenInput");
    if (inp) {
      inp.value = autoMint;
      // Small delay so the page finishes rendering before firing search
      setTimeout(() => window.searchToken(), 200);
    }
  }

  /* ── Re-render dynamic panels on language switch ── */
  window.addEventListener("langchange", () => {
    if (currentToken) {
      renderTokenHeader(currentToken);
      updateRiskPanel(currentToken.pair);
      updateMarketSignals(currentToken.pair);
      renderHoldersPanel(currentToken);
      renderSellHoldingInfo();
    }
    renderPortfolio();
    renderRecentTrades();
  });

  document.querySelectorAll(".sa-tf-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      /* Visual feedback: mark the clicked button active immediately */
      document.querySelectorAll(".sa-tf-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentTf = btn.dataset.tf;

      /* Debounce: if the user rapidly clicks through TFs, only the last
         click fires a network request — avoids stacking up multiple
         simultaneous fetch chains that cause lag and broken charts. */
      clearTimeout(tfDebounce);
      tfDebounce = setTimeout(async () => {
        if (!candleChart || !currentToken) return;

        /* Unique ID per load — stale fetches are discarded on arrival */
        const myReqId = ++chartReqId;
        candleChart.setTimeframe(currentTf);
        candleChart.startLoading();

        /* Re-subscribe WS to the new chartType so live candles match the TF */
        _saStopChartTicker();
        _saStartChartTicker(currentToken.mint);

        let loaded = false;
        {
          const ohlcv = await fetchOhlcv(currentToken.mint, currentTf);
          if (myReqId !== chartReqId) return;   /* user clicked again — discard */
          if (ohlcv && ohlcv.length > 0) {
            candleChart.loadCandles(ohlcv);
            loaded = true;
          }
        }
        /* Tertiary fallback: tick buffer OHLCV */
        if (!loaded) {
          const tickOhlcv = _buildOhlcvFromTicks(currentToken.mint, currentTf);
          if (tickOhlcv) { candleChart.loadCandles(tickOhlcv); loaded = true; }
        }
        /* Last resort: clean empty chart */
        if (!loaded) candleChart.loadCandles([]);
        const p = livePrices[currentToken.mint] || parseFloat(currentToken.pair.priceUsd || "0");
        if (p > 0) candleChart.tick(p, (currentToken.pair.volume?.h1 || 0) / 2400);
      }, 250); /* 250ms debounce — fast enough to feel instant, slow enough to batch rapid clicks */
    });
  });
});

/* ============================================================
   WALLET
   ============================================================ */
function isMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function isBase58Address(addr) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr.trim());
}

function setupMobileConnect() {
  const hint = document.getElementById("mobilePhantomHint");
  if (!hint) return;
  hint.style.display = "block";

  // Deep-link: open current URL inside Phantom's in-app browser
  const deepLinkEl = document.getElementById("phantomDeepLink");
  if (deepLinkEl) {
    const pageUrl = encodeURIComponent(window.location.href);
    deepLinkEl.href = `https://phantom.app/ul/browse/${pageUrl}?ref=${encodeURIComponent(window.location.origin)}`;
  }

  // Manual wallet address entry
  const manualBtn = document.getElementById("manualWalletBtn");
  const manualInput = document.getElementById("manualWalletInput");
  if (manualBtn && manualInput) {
    const tryManual = async () => {
      const addr = manualInput.value.trim();
      if (!isBase58Address(addr)) { showToast("⚠️ Enter a valid Solana wallet address."); return; }
      wallet = addr;
      localStorage.setItem("sa_wallet", wallet);
      await initSimulator();
    };
    manualBtn.addEventListener("click", tryManual);
    manualInput.addEventListener("keydown", e => { if (e.key === "Enter") tryManual(); });
  }
}

async function connectWallet() {
  const btn = document.getElementById("connectWalletBtn");
  document.getElementById("connectBtnText").textContent = "⏳ Connecting…";
  btn.disabled = true;
  let _mobilePathTaken = false; /* UX-07: flag so finally block doesn't reset mobile UI */
  try {
    const ph = window.solana;
    if (!ph || !ph.isPhantom) {
      // No extension — show mobile/manual fallback
      _mobilePathTaken = true;
      setupMobileConnect();
      return;
    }
    const resp = await ph.connect();
    wallet = resp.publicKey.toString();
    localStorage.setItem("sa_wallet", wallet);
    await initSimulator();
  } catch { showToast("⚠️ Wallet connection cancelled or failed."); }
  finally {
    if (!_mobilePathTaken) { /* UX-07: don't overwrite text set by setupMobileConnect */
      document.getElementById("connectBtnText").textContent = "Connect Phantom Wallet";
      btn.disabled = false;
    }
  }
}

function disconnectWallet() {
  const reconnectBanner = document.getElementById("saReconnectBanner");
  if (reconnectBanner) reconnectBanner.style.display = "none";
  wallet = null; profile = null;
  stopAllTimers();
  if (candleChart) { candleChart.destroy(); candleChart = null; }
  localStorage.removeItem("sa_wallet");
  document.getElementById("connectGate").style.display  = "block";
  document.getElementById("simulatorApp").style.display = "none";
  try { window.solana?.disconnect(); } catch {}
}

/* ============================================================
   START FRESH — escape hatch for wallets stuck in 503 loop
   Called from the reconnect banner when profile is genuinely
   lost. POSTs action=reset which bypasses the registered-wallet
   503 guard server-side, creating a clean 10 SOL profile.
   ============================================================ */
async function saStartFresh() {
  if (!wallet) { disconnectWallet(); return; }
  /* SEC-04: rate-limit to once per 60 s to prevent accidental rapid resets */
  try {
    const lastReset = parseInt(localStorage.getItem("s2m_last_fresh") || "0", 10);
    if (Date.now() - lastReset < 60_000) {
      showToast("⚠️ Please wait a moment before resetting again.");
      return;
    }
  } catch {}
  const confirmed = window.confirm(
    "⚠️ Start fresh?\n\nThis will create a brand-new profile with 10 S2M.\n" +
    "Any previous balance or trade history will be gone.\n\nContinue?"
  );
  if (!confirmed) return;

  showToast("Creating fresh profile…");
  try {
    const resp = await fetch(SIM_API, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ wallet, action: "reset" }),
    });
    if (!resp.ok) {
      showToast("❌ Failed to create profile — please try again.");
      return;
    }
    const data = await resp.json();
    profile = data.profile;
    try { localStorage.setItem("s2m_last_fresh", String(Date.now())); } catch {} /* SEC-04 */
    /* Clear guide/quiz completion flags so the guide hub reflects the fresh account */
    try {
      localStorage.removeItem("s2m_daily_claimed");
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("s2m_completed_")) localStorage.removeItem(key);
      }
    } catch {}
    // Hide reconnect banner and reload the simulator normally
    const reconnectBanner = document.getElementById("saReconnectBanner");
    if (reconnectBanner) reconnectBanner.style.display = "none";
    showToast("✅ Fresh profile created! Starting with 10 S2M.");
    await initSimulator();
  } catch(e) {
    showToast("❌ Network error — please refresh and try again.");
  }
}

/* ============================================================
   PROFILE BACKUP — localStorage safety net
   Saves a copy of the profile locally after every server update.
   If Netlify Blobs ever returns null for an existing wallet,
   the client restores the profile from this backup automatically.
   ============================================================ */
let _lastBackupSave = 0; /* PERF-07: throttle guard */
function saveProfileBackup(p) {
  if (!p || !wallet) return;
  /* PERF-07: cap localStorage writes to once every 10 seconds */
  const now = Date.now();
  if (now - _lastBackupSave < 10_000) return;
  _lastBackupSave = now;
  try {
    localStorage.setItem("sa_backup_" + wallet, JSON.stringify({
      profile: p,
      savedAt: now,
    }));
  } catch(e) { _DEBUG && console.warn("Backup save failed:", e); }
}

async function tryRestoreFromBackup() {
  // Only called when server returned isNew:true for a non-new wallet.
  // Check localStorage for a recent backup and attempt server-side restore.
  try {
    const raw = localStorage.getItem("sa_backup_" + wallet);
    if (!raw) return null;
    const { profile: bp, savedAt } = JSON.parse(raw);
    if (!bp || !bp.wallet) return null;
    const ageHours = (Date.now() - savedAt) / 3_600_000;
    if (ageHours > 168) return null; // backup older than 7 days — don't use
    if (bp.balance === 10 && !bp.trades?.length) return null; // fresh/empty backup — skip
    showToast("🔄 Restoring your profile...");
    /* SEC-02: sanitise backup before sending — reject implausible values that
       could be injected via DevTools or XSS-modified localStorage */
    const sanitisedBp = {
      ...bp,
      balance:     Math.min(Math.max(0, Number(bp.balance)     || 0), 10_000),
      tradeXp:     Math.min(Math.max(0, Number(bp.tradeXp)     || 0), 1_000_000),
      loginStreak: Math.min(Math.max(0, Number(bp.loginStreak) || 0), 365),
    };
    const resp = await fetch(SIM_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet, action: "restore_backup", backupProfile: sanitisedBp }),
    });
    const data = await resp.json();
    if (data.error) { _DEBUG && console.warn("Restore failed:", data.error); return null; }
    return data.profile || null;
  } catch(e) {
    _DEBUG && console.warn("tryRestoreFromBackup error:", e);
    return null;
  }
}

/* ============================================================
   INIT SIMULATOR
   ============================================================ */
async function initSimulator() {
  document.getElementById("connectGate").style.display  = "none";
  document.getElementById("simulatorApp").style.display = "block";

  /* Fetch SOL price before loading profile so the balance can show "$X" */
  await fetchSolPrice();
  /* BUG-01: guard against duplicate timers on re-entry (bgRetry / saStartFresh) */
  if (!solPriceTimer) solPriceTimer = setInterval(fetchSolPrice, 60_000);

  /* ── Resilient profile fetch with client-side retries ───────────────────
     The server already retries Blobs reads internally (up to 3 attempts).
     We add up to 3 more client-side retries in case the server returns 503
     (storage temporarily unavailable) or isNew:true for an existing wallet.
     This prevents the "everything reset to 0" experience caused by Blobs
     cold-start glitches. Only after all retries exhaust do we accept isNew. */
  let data;
  let retryCount = 0;
  const MAX_RETRIES = 4;

  while (retryCount <= MAX_RETRIES) {
    try {
      const resp = await fetch(`${SIM_API}?wallet=${wallet}`);

      // 503 = Blobs token expired — server is reconnecting. Keep retrying with
      // increasing delays. After MAX_RETRIES show a UI banner and schedule a
      // background retry every 20s so the page recovers automatically.
      if (resp.status === 503) {
        if (retryCount < MAX_RETRIES) {
          retryCount++;
          const delay = Math.min(retryCount * 2000, 8000); // 2s, 4s, 6s, 8s
          showToast(`⏳ Connecting to profile… (attempt ${retryCount}/${MAX_RETRIES})`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        // All retries exhausted — show reconnecting banner and keep trying in background
        showToast("🔄 Profile storage reconnecting… will retry automatically");
        const reconnectBanner = document.getElementById("saReconnectBanner");
        if (reconnectBanner) reconnectBanner.style.display = "flex";
        // Background retry every 20 seconds
        const bgRetry = setInterval(async () => {
          try {
            const r = await fetch(`${SIM_API}?wallet=${wallet}`);
            if (r.ok) {
              clearInterval(bgRetry);
              if (reconnectBanner) reconnectBanner.style.display = "none";
              stopAllTimers(); /* BUG-02: clear existing timers before re-init to prevent accumulation */
              initSimulator(); // reload the full simulator
            }
          } catch {}
        }, 20000);
        return; // stop blocking — let user see the page
      }

      data = await resp.json();
      if (data.error) throw new Error(data.error);

      // If the server says isNew but we have a local backup, the server might
      // be seeing a Blobs glitch. Try restoring from backup first; if that
      // fails, retry the GET a couple more times before accepting isNew.
      if (data.isNew && retryCount < MAX_RETRIES) {
        const backup = localStorage.getItem("sa_backup_" + wallet);
        if (backup) {
          // We have a backup — don't retry the GET, go straight to restore
          break;
        }
        retryCount++;
        const delay = retryCount * 1500;
        showToast(`⏳ Verifying profile… (attempt ${retryCount + 1})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      break; // success or final retry exhausted
    } catch(e) {
      if (retryCount >= MAX_RETRIES) {
        _DEBUG && console.error(e);
        showToast("⚠️ Could not load profile. Please refresh the page.");
        return;
      }
      retryCount++;
      await new Promise(r => setTimeout(r, retryCount * 1500));
    }
  }

  try {
    if (!data) throw new Error("No response from server");

    if (data.isNew) {
      // Server says no profile found after all retries. Check localStorage backup.
      const restored = await tryRestoreFromBackup();
      if (restored) {
        profile = restored;
        saveProfileBackup(profile);
        showToast(`✅ Profile restored! Welcome back, ${profile.accountName}!`);
      } else {
        profile = data.profile;
        showToast("Welcome! Your account starts with 10 S2M.");
      }
    } else {
      profile = data.profile;
      saveProfileBackup(profile); // always keep backup fresh
      showToast(`Welcome back, ${profile.accountName}!`);
    }
  } catch (e) { _DEBUG && console.error(e); showToast("⚠️ Could not load profile."); return; }

  /* Sync display name to server if set in Dashboard — keeps Leaderboard in sync */
  const savedDisplayName = localStorage.getItem("sa_display_name");
  /* SEC-06: validate length and content before sending to server */
  const _dnClean = typeof savedDisplayName === "string"
    ? savedDisplayName.trim().slice(0, 30).replace(/[^\w\s\-_.]/g, "")
    : "";
  if (_dnClean && _dnClean !== profile.accountName) {
    fetch(SIM_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet, action: "update_name", accountName: _dnClean }),
    }).catch(() => {});
  }

  /* Migrate legacy USD-denominated profiles to SOL automatically */
  if (profile.balanceCurrency !== "sol" && solPrice > 0) {
    try {
      const mr = await fetch(SIM_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, action: "migrate_to_sol", solPrice }),
      });
      const md = await mr.json();
      if (!md.error && md.profile) {
        profile = md.profile;
        saveProfileBackup(profile);
        showToast("✅ Account converted to SOL denomination");
      }
    } catch (e) { _DEBUG && console.warn("Migration failed:", e); }
  }

  updateStaticUI();
  checkDailyReward();
  startPortfolioPoll();
  startPnlTick();
}

/* ============================================================
   TIMERS
   ============================================================ */
function stopAllTimers() {
  clearInterval(tokenPollTimer);       tokenPollTimer     = null;
  clearInterval(portfolioPollTimer);   portfolioPollTimer = null;
  clearInterval(pnlTickTimer);         pnlTickTimer       = null;
  clearInterval(solPriceTimer);        solPriceTimer      = null;  /* BUG-01 */
  _saStopChartTicker(); // also unsubscribes from Birdeye WS
}

function stopTokenTimers() {
  clearInterval(tokenPollTimer); tokenPollTimer = null;
  _saStopChartTicker(); // also unsubscribes from Birdeye WS
}

/* ============================================================
   STATIC UI UPDATE
   ============================================================ */
function updateStaticUI() {
  if (!profile) return;
  // Guard: if server sent a corrupted profile (null/Infinity from a past bug),
  // treat the balance as 0 rather than showing "NaN" or "Infinity".
  if (!isFinite(profile.balance) || profile.balance == null) profile.balance = 0;
  const balSol = Math.max(0, profile.balance);
  const balUsd = solPrice > 0 ? balSol * solPrice : null;
  const balDisplay = balUsd !== null
    ? `${formatSol(balSol)} ≈ ${formatUsd(balUsd)}`
    : formatSol(balSol);
  document.getElementById("heroBalance").textContent  = balDisplay;
  document.getElementById("tradeBalance").textContent = balDisplay;
  document.getElementById("heroStreak").textContent   = `▲ ${profile.loginStreak || 0}-day streak`;
  const xpEl = document.getElementById("heroXp");
  if (xpEl) xpEl.textContent = (profile.tradeXp || 0).toLocaleString();
  const xpBadge = document.getElementById("saPortfolioXpBadge");
  if (xpBadge) xpBadge.textContent = `⚡ ${(profile.tradeXp || 0).toLocaleString()} XP`;
  renderPortfolio();
  renderRecentTrades();
}

/* ============================================================
   DAILY REWARD
   ============================================================ */
function checkDailyReward() {
  if (!profile) return;
  const today = new Date().toISOString().slice(0, 10);
  const lastLogin = (profile.lastLogin || '').slice(0, 10);

  /* If server shows no login or an older date (e.g. after account reset),
     clear any stale localStorage guard so the banner appears correctly. */
  if (lastLogin < today) {
    try { localStorage.removeItem('s2m_daily_claimed'); } catch {}
  }

  let localClaimed = false;
  try { localClaimed = localStorage.getItem('s2m_daily_claimed') === today; } catch {}
  if (lastLogin === today || localClaimed) return; /* already claimed today */
  document.getElementById("dailyBanner").style.display = "flex";
  const DAILY_REWARDS_SOL = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
  const streak = Math.max(1, Math.min(7, (profile.loginStreak || 0) + 1));
  const nextReward = DAILY_REWARDS_SOL[streak];
  const btn = document.getElementById("dailyClaimBtn");
  if (btn) btn.textContent = `Claim +${nextReward.toFixed(2)} S2M`;
}

async function claimDaily() {
  const btn = document.getElementById("dailyClaimBtn");
  if (btn && btn.disabled) return; /* prevent double-click while in-progress */
  const origText = btn ? btn.textContent : "Claim";
  btn.disabled = true; btn.textContent = "Claiming…";
  try {
    const resp = await fetch(SIM_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet, action: "daily_login" }) });
    if (resp.status === 503) {
      showToast("⚠️ Server busy, please try again in a moment.");
      return;
    }
    const data = await resp.json();
    if (data.error) {
      showToast("⚠️ " + data.error);
      try { localStorage.setItem('s2m_daily_claimed', new Date().toISOString().slice(0,10)); } catch {}
      document.getElementById("dailyBanner").style.display = "none"; /* hide even if already claimed */
      return;
    }
    profile = data.profile;
    saveProfileBackup(profile);
    updateStaticUI();
    try { localStorage.setItem('s2m_daily_claimed', new Date().toISOString().slice(0,10)); } catch {}
    document.getElementById("dailyBanner").style.display = "none";
    if (data.reward > 0) {
      showDailyRewardCard(data);
    } else {
      showToast(data.message);
    }
    if (data.newBadges && data.newBadges.length) {
      setTimeout(() => showBadgeShareCards(data.newBadges), 1200);
    }
  } catch {
    showToast("⚠️ Could not claim reward.");
    document.getElementById("dailyBanner").style.display = "none"; /* BUG-03: hide on any error, not just "already claimed" */
  }
  finally { if (btn) { btn.disabled = false; btn.textContent = origText; } }
}

/* ============================================================
   REAL-TIME LIVE FEED — Birdeye WebSocket (replaces REST polling)
   ============================================================ */

/**
 * Called on every PRICE_DATA message from Birdeye WS.
 * data = { address, o, h, l, c, v, unixTime, type }
 * "c" is the live close price (current price).
 */
function _saOnWsTick(data) {
  // data is already normalised by birdeye-ws.js: { address, price, o,h,l,c,v, unixTime }
  const mint  = data?.address;
  const price = data?.price;   // always set; normalised from c/close/value
  if (!mint || !(price > 0)) return;

  // ── EMA spike filter (same logic as old REST poller) ──
  if (!_priceEmas[mint] || _priceEmas[mint] <= 0) _priceEmas[mint] = price;
  const dev = Math.abs(price - _priceEmas[mint]) / _priceEmas[mint];
  if (dev > 0.35) {
    _priceEmas[mint] = _priceEmas[mint] * 0.90 + price * 0.10;
    livePrices[mint] = _priceEmas[mint];
    return;
  }
  _priceEmas[mint] = _priceEmas[mint] * 0.75 + price * 0.25;
  livePrices[mint] = price;
  _lastWsTick = Date.now(); /* PERF-04: track last WS activity for REST fallback logic */
  /* BUG-06: keep tick buffer in sync with chart so OHLCV reconstruction matches display */
  _storeTick(mint, price, currentToken?.pair?.volume?.h1 || 0);

  // ── Rug detection ──
  if (!_peakPrices[mint] || price > _peakPrices[mint]) _peakPrices[mint] = price;
  if (!_rugTriggered[mint] && _peakPrices[mint] > 0) {
    const drawdown = (_peakPrices[mint] - price) / _peakPrices[mint];
    if (drawdown >= 0.60 && currentToken?.mint === mint) {
      _rugTriggered[mint] = true;
      showRugOverlay(drawdown);
    }
  }

  // ── Tick the chart — data.v is already normalised by birdeye-ws.js ──
  /* PERF-01: only feed chart tick here; all DOM/UI updates are in the 200ms pnlTick loop.
     UX-06: skip main chart tick while fullscreen modal is open (avoids wasted computation). */
  if (candleChart && currentToken?.mint === mint && !_fcmModalOpen) {
    const vol = (data.v > 0) ? data.v
             : (currentToken?.pair?.volume?.h1 || 0) / 3600;
    candleChart.tick(price, vol);
    flashLiveIndicator();  /* keep timestamp update in WS handler for accuracy */
  }
}

/**
 * Subscribe to Birdeye WS for the active token + current timeframe.
 * Also subscribes to a price-only (no chartType) feed as a fallback
 * so we always get price updates even if the chartType sub is slow.
 */
function _saStartChartTicker(mint) {
  _saStopChartTicker();
  if (!mint) return;

  // ── WebSocket subscriptions (primary — true real-time) ──
  const normTf = { "1m":"1m","5m":"5m","15m":"15m","1h":"1H","4h":"4H","12h":"12H","1d":"1D","max":"1D" }[currentTf] || "5m";
  const unsub1 = birdeyeWs.subscribe(mint, normTf,  _saOnWsTick);
  // Price-only fallback — gets a tick on every trade regardless of TF
  const unsub2 = birdeyeWs.subscribe(mint, null,    _saOnWsTick);
  _saWsUnsub = () => { unsub1(); unsub2(); };

  // ── REST poll — true WS fallback (PERF-04) ───────────────────────────────
  // Only fires when WS has been silent for more than 8 seconds, avoiding
  // the previous always-on pattern that generated 15 redundant calls/min.
  const _restPoll = async () => {
    try {
      const res = await fetch(`${PRICE_ONLY_API}?mint=${encodeURIComponent(mint)}`);
      if (!res.ok) return;
      const d = await res.json();
      if (d?.ok && d.price > 0) _saOnWsTick({ address: mint, price: d.price, v: 0 });
    } catch { /* non-critical */ }
  };
  _saChartFastInterval = setInterval(() => {
    /* PERF-04: only poll REST if WS has been silent for 8+ seconds */
    if (Date.now() - _lastWsTick > 8000) _restPoll();
  }, 4000);
  _restPoll(); // immediate first tick for new token — don't wait 4s

  // Slow metadata refresh (mc, liq, priceChange) — REST is fine here
  pollActivePair(mint);
  _saChartSlowInterval = setInterval(() => pollActivePair(mint), SA_SLOW_MS);
}

function _saStopChartTicker() {
  if (_saWsUnsub) { _saWsUnsub(); _saWsUnsub = null; }
  clearInterval(_saChartSlowInterval); _saChartSlowInterval = null;
  clearInterval(_saChartFastInterval); _saChartFastInterval = null;
}

function startTokenPoll(mint) {
  _saStartChartTicker(mint);
}

async function pollActivePair(mint) {
  if (!mint) return;
  try {
    // Use scanToken for polls so liquidity/priceChange/txns data is always correct.
    // scanToken has a 90s Redis cache so most polls hit the cache and are instant.
    const res  = await fetch(`${SCAN_TOKEN_API}?mint=${encodeURIComponent(mint)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.ok || !data.pair) return;

    // Update pump.fun globals in case they changed
    window.scanIsPumpFun    = data.isPumpFun    ?? false;
    window.scanHasGraduated = data.hasGraduated ?? false;

    const pair = data.pair;  // proper pair directly from scanToken
    if (!pair) return;

    const rawPrice = parseFloat(pair.priceUsd || "0");
    const vol1h    = pair.volume?.h1 || 0;
    if (!rawPrice || rawPrice <= 0) return;

    /* ── Price spike filter ─────────────────────────────────────────────
       Birdeye occasionally returns a stale/wrong price for one
       poll cycle. We keep a per-mint EMA and reject any price that deviates
       >35% from it.  This stops truly bad prices from corrupting livePrices
       (which drives P/L display and trade execution).
       Same logic as the chart's tick() filter — both must agree. */
    if (!_priceEmas[mint] || _priceEmas[mint] <= 0) _priceEmas[mint] = rawPrice;
    const _dev  = Math.abs(rawPrice - _priceEmas[mint]) / _priceEmas[mint];
    if (_dev > 0.35) {
      /* Slowly adapt EMA so genuine sustained moves eventually pass */
      _priceEmas[mint] = _priceEmas[mint] * 0.90 + rawPrice * 0.10;
      _DEBUG && console.warn(`Rejected bad price for ${mint}: ${rawPrice} (EMA ${_priceEmas[mint].toFixed(8)}, dev ${(_dev*100).toFixed(1)}%)`);
      /* Still update livePrices to the EMA value so trades always have a
         price available — the server validates independently anyway. */
      livePrices[mint] = _priceEmas[mint];
      return; // skip chart/tick update — price was too spiky for display
    }
    /* Valid price — update EMA and store */
    _priceEmas[mint] = _priceEmas[mint] * 0.75 + rawPrice * 0.25;
    const price = rawPrice;
    livePrices[mint] = price;
    _storeTick(mint, price, vol1h); /* accumulate for local OHLCV fallback */

    /* ── Rug detection ──
       Track the session peak. If price drops >60% from peak while the chart
       is visible, show the rug overlay once. Reset when a new token is loaded. */
    if (!_peakPrices[mint] || price > _peakPrices[mint]) _peakPrices[mint] = price;
    if (!_rugTriggered[mint] && _peakPrices[mint] > 0) {
      const drawdown = (_peakPrices[mint] - price) / _peakPrices[mint];
      if (drawdown >= 0.60 && currentToken?.mint === mint) {
        _rugTriggered[mint] = true;
        showRugOverlay(drawdown);
      }
    }

    if (currentToken && currentToken.mint === mint) {
      currentToken.pair = pair;
      // Keep the risk score from the initial full scan (includes Helius bundle + top10).
      // Do not recalculate from live poll data — the score only changes on Re-scan.
      riskScore = currentToken.riskScore;
    }

    /* Chart tick is handled by the 5s fast ticker (_saChartFastTick).
       The slow poll just refreshes pair metadata / risk / signals. */

    updatePriceHeader(pair, price);
    updateRiskPanel(pair);
    updateMarketSignals(pair);
    /* BUG-10: only update trade panels when trading content is visible (not behind risk gate) */
    if (document.getElementById("saTradingContent")?.style.display !== "none") {
      updateBuyInfo();
      updateSellInfo();
    }

  } catch (e) { _DEBUG && console.warn("Token poll failed:", e); }
}

function startPortfolioPoll() {
  clearInterval(portfolioPollTimer);
  pollPortfolioPrices();
  /* PERF-02: 20s is sufficient for background holdings — active token gets real-time WS prices */
  portfolioPollTimer = setInterval(pollPortfolioPrices, 20000);
}

async function pollPortfolioPrices() {
  if (!profile) return;
  const mints = Object.keys(profile.holdings || {}).filter(m => profile.holdings[m].amount > 0);
  if (!mints.length) return;
  /* UX-08: signal that portfolio prices are refreshing */
  const _pbEl = document.getElementById("saPortfolioBody");
  if (_pbEl) _pbEl.dataset.saRefreshing = "1";
  for (let i = 0; i < mints.length; i += 25) {
    const slice = mints.slice(i, i + 25);
    try {
      const res  = await fetch(
        `${TOKEN_BATCH_API}?mints=${encodeURIComponent(slice.join(","))}`,
        { signal: AbortSignal.timeout(12000) }
      );
      const data = await res.json();
      /* ── One Birdeye token object per mint — no multi-pool ambiguity ──
         tokenData/batchTokenData returns one canonical price per mint
         (Birdeye best-price), eliminating the pool-switching P/L flicker
         that could happen with DexScreener's multi-pool response. */
      for (const t of data.tokens || []) {
        const m = t?.mint;
        if (!m) continue;
        const price = parseFloat(t.priceUsd ?? 0);
        if (price <= 0) continue;
        /* Spike filter — same EMA logic as before */
        if (!_priceEmas[m] || _priceEmas[m] <= 0) { _priceEmas[m] = price; livePrices[m] = price; continue; }
        const dev = Math.abs(price - _priceEmas[m]) / _priceEmas[m];
        if (dev > 0.35) { _priceEmas[m] = _priceEmas[m] * 0.90 + price * 0.10; continue; }
        _priceEmas[m] = _priceEmas[m] * 0.75 + price * 0.25;
        livePrices[m] = price;
      }
    } catch {}
  }
  if (_pbEl) delete _pbEl.dataset.saRefreshing; /* UX-08: clear loading state */
  updatePortfolioPnlCards();
}

function startPnlTick() {
  clearInterval(pnlTickTimer);
  pnlTickTimer = setInterval(() => {
    if (!profile) return;
    /* PERF-01: single 200ms render loop owns all price-driven DOM updates.
       Replaces the previous pattern where _saOnWsTick also called these
       functions, creating two overlapping update paths at 5Hz+. */
    if (currentToken) {
      const price = livePrices[currentToken.mint] || 0;
      if (price > 0) {
        if (currentToken.pair) updatePriceHeader(currentToken.pair, price);
        updateLivePnl(price);
        updateBuyInfo();
        updateSellInfo();
      }
    }
    /* Portfolio P/L cards — updated for all open positions */
    updatePortfolioPnlCards();
  }, 200); /* 200ms = 5 ticks/second — smooth P/L updates */
}

function flashLiveIndicator() {
  const el = document.getElementById("saLastUpdate");
  if (el) el.textContent = new Date().toLocaleTimeString();
}

/* ============================================================
   RUG PULL DETECTION — overlay + warning banner
   ============================================================ */
function showRugOverlay(drawdown) {
  const chartWrap = document.getElementById("saLiveChart")?.parentElement;
  if (!chartWrap) return;

  /* Remove any previous overlay first */
  document.getElementById("saRugOverlay")?.remove();

  const pct = Math.round(drawdown * 100);

  const overlay = document.createElement("div");
  overlay.id = "saRugOverlay";
  overlay.style.cssText = `
    position:absolute; inset:0; z-index:50; pointer-events:none;
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    background: repeating-linear-gradient(
      -45deg,
      rgba(255,30,30,0.13) 0px, rgba(255,30,30,0.13) 18px,
      rgba(0,0,0,0) 18px, rgba(0,0,0,0) 36px
    );
    border: 2px solid rgba(255,50,50,0.55);
    border-radius: 8px;
    animation: rugFadeIn 0.4s ease;
  `;

  overlay.innerHTML = `
    <div style="
      font-size:clamp(28px,5vw,52px); font-weight:900; letter-spacing:4px;
      color:#ff2222; text-shadow:0 0 24px #ff000088, 0 2px 0 #000;
      font-family:monospace; opacity:0.82; user-select:none;
      transform:rotate(-8deg); margin-bottom:8px;
    ">⚠ RUGGED ⚠</div>
    <div style="
      font-size:13px; font-weight:700; color:#ff6666;
      background:rgba(0,0,0,0.7); padding:4px 14px; border-radius:6px;
      letter-spacing:1px; user-select:none;
    ">-${pct}% FROM PEAK</div>
  `;

  /* chart wrap needs relative positioning for the overlay to sit inside it */
  const prevPosition = chartWrap.style.position;
  if (!prevPosition || prevPosition === "static") chartWrap.style.position = "relative";

  chartWrap.appendChild(overlay);

  /* Warning banner below the chart */
  document.getElementById("saRugBanner")?.remove();
  const banner = document.createElement("div");
  banner.id = "saRugBanner";
  banner.style.cssText = `
    margin-top:8px; padding:10px 16px;
    background:rgba(255,30,30,0.12); border:1px solid rgba(255,50,50,0.45);
    border-radius:8px; color:#ff6b6b; font-size:13px; font-weight:600;
    display:flex; align-items:center; gap:10px;
    animation: rugFadeIn 0.5s ease;
  `;
  banner.innerHTML = `
    <span style="font-size:20px;">🚨</span>
    <span>
      <strong>Possible Rug Pull Detected</strong> — price dropped
      <strong>-${pct}%</strong> from its session high.
      Liquidity may have been removed. Do NOT buy. Check DexScreener immediately.
    </span>
    <button onclick="document.getElementById('saRugOverlay')?.remove();document.getElementById('saRugBanner')?.remove();"
      style="margin-left:auto;background:none;border:1px solid rgba(255,100,100,0.4);color:#ff6b6b;
             border-radius:6px;padding:4px 10px;cursor:pointer;font-size:11px;white-space:nowrap;">
      Dismiss
    </button>
  `;
  chartWrap.parentElement?.appendChild(banner);

  /* Add keyframe if not already present */
  if (!document.getElementById("rugAnimStyle")) {
    const style = document.createElement("style");
    style.id = "rugAnimStyle";
    style.textContent = `@keyframes rugFadeIn { from { opacity:0; transform:scale(0.96); } to { opacity:1; transform:scale(1); } }`;
    document.head.appendChild(style);
  }
}

/* ============================================================
   OHLCV FETCH — Birdeye via ohlcvData (3-layer cache: Redis → Neon → Birdeye)

   Uses the mint address directly (not a pool/pair address) so the
   data always matches what Birdeye shows — no wrong-pool mismatches.
   "max" TF maps to "1d" (daily candles, full history).
   ============================================================ */
async function fetchOhlcv(mint, tf) {
  if (!mint) return null;
  /* "max" → daily candles (ohlcvData doesn't have a "max" key) */
  const tf_eff = (tf === "max") ? "1d" : tf;
  try {
    const res = await fetch(
      `/.netlify/functions/ohlcvData?mint=${encodeURIComponent(mint)}&tf=${encodeURIComponent(tf_eff)}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.ok || !json.bars?.length) return null;
    /* Return [[ts_sec, o, h, l, c, v], …] — same format CandleChart.loadCandles() expects */
    return json.bars.map(b => [b.time, b.open, b.high, b.low, b.close, b.volume || 0]);
  } catch (e) {
    _DEBUG && console.warn("fetchOhlcv failed:", e);
    return null;
  }
}

/* ============================================================
   CANDLESTICK CHART  (CandleChart engine)
   ============================================================ */
async function initChart(t) {
  if (candleChart) { candleChart.destroy(); candleChart = null; }
  const canvas = document.getElementById("saLiveChart");
  if (!canvas) return;

  /* Each chart init gets a unique ID — protects against searching a new
     token before the previous OHLCV fetch completes. */
  const myReqId = ++chartReqId;

  candleChart = new CandleChart("saLiveChart");
  candleChart.setToken(t.name, t.symbol);
  candleChart.setTimeframe(currentTf);
  candleChart.startLoading(); /* show "Loading chart data…" while fetching */

  /* Fetch real OHLCV from Birdeye (via ohlcvData 3-layer cache) */
  let loaded = false;
  {
    const ohlcv = await fetchOhlcv(t.mint, currentTf);
    /* Abort if the user already searched a different token */
    if (myReqId !== chartReqId) return;
    if (ohlcv && ohlcv.length > 0) {
      candleChart.loadCandles(ohlcv);
      loaded = true;
    }
  }
  /* Tertiary fallback: reconstruct OHLCV from the in-memory tick buffer.
     Brand-new tokens that aren't yet indexed by any external chart API
     will still show real history built from the live 1.5 s polling data. */
  if (!loaded) {
    const tickOhlcv = _buildOhlcvFromTicks(t.mint, currentTf);
    if (tickOhlcv) { candleChart.loadCandles(tickOhlcv); loaded = true; }
  }
  /* Last resort: clean empty chart — live ticks build the current candle */
  if (!loaded) candleChart.loadCandles([]);

  /* Feed current price as first tick for live candle */
  const price = livePrices[t.mint] || parseFloat(t.pair.priceUsd || "0");
  if (price > 0) candleChart.tick(price, (t.pair.volume?.h1 || 0) / 1200);

  /* Plot B/S markers for any previous trades on this token */
  if (profile?.trades) candleChart.setTradeMarkers(profile.trades, t.mint);

  /* Start the two-speed live ticker now that the chart is loaded */
  _saStartChartTicker(t.mint);
}

/* ============================================================
   UPDATE PRICE HEADER
   ============================================================ */
function updatePriceHeader(pair, price) {
  const priceEl  = document.querySelector(".sa-price-main");
  const changeEl = document.querySelector(".sa-price-change");
  const pc24h    = pair.priceChange?.h24 ?? 0;
  if (priceEl)  priceEl.textContent = formatPrice(price);
  if (changeEl) {
    changeEl.textContent = `${pc24h >= 0 ? "+" : ""}${pc24h.toFixed(2)}%  24H`;
    changeEl.className   = `sa-price-change ${pc24h >= 0 ? "sa-price-up" : "sa-price-down"}`;
  }
}

/* ============================================================
   RISK PANEL
   ============================================================ */
function updateRiskPanel(pair) {
  if (!currentToken) return;
  const score = currentToken.riskScore;
  const cl  = score >= 65 ? "#2cffc9" : score >= 45 ? "#ffd166" : "#ff4d6d";
  const lv  = score >= 65 ? "LOW RISK" : score >= 45 ? "MODERATE" : "HIGH RISK";
  const liq = pair.liquidity?.usd ?? 0;
  const vol = pair.volume?.h24    ?? 0;
  const mc  = pair.fdv ?? pair.marketCap ?? 0;
  const el  = document.getElementById("saRiskPanel");
  if (!el) return;
  el.innerHTML = `
    <div class="sa-risk-score-big">
      <div class="sa-risk-num" style="color:${cl};text-shadow:0 0 20px ${cl}66">${score}<span class="sa-risk-max">/100</span></div>
      <div class="sa-risk-level" style="color:${cl}">${lv}</div>
    </div>
    <div class="sa-signal-row"><span class="sa-signal-label">${t("liquidity_label")}</span><span class="sa-signal-val" style="color:${liq>50000?'#2cffc9':liq>10000?'#ffd166':'#ff4d6d'}">${formatUsd(liq)}</span></div>
    <div class="sa-signal-row"><span class="sa-signal-label">${t("sa_lbl_24h_vol")}</span><span class="sa-signal-val">${formatUsd(vol)}</span></div>
    <div class="sa-signal-row"><span class="sa-signal-label">${t("market_cap_label")}</span><span class="sa-signal-val">${formatUsd(mc)}</span></div>
    <div class="sa-signal-row"><span class="sa-signal-label">${t("sa_lbl_lp_status")}</span><span class="sa-signal-val" style="color:${liq>20000?'#2cffc9':'#ffd166'}">${liq>20000?t("sa_lp_likely_locked"):t("sa_lp_unverified")}</span></div>
    <div class="sa-signal-row"><span class="sa-signal-label">${t("sa_lbl_safe_to_ape")}</span><span class="sa-signal-val" style="color:${cl}">${score>=65?t("sa_safe_yes"):t("sa_safe_caution")}</span></div>
  `;
}

/* ============================================================
   MARKET SIGNALS PANEL
   ============================================================ */
function updateMarketSignals(pair) {
  const el = document.getElementById("saSignalsPanel");
  if (!el) return;

  const pc5m   = pair.priceChange?.m5   ?? null;
  const pc1h   = pair.priceChange?.h1   ?? 0;
  const pc6h   = pair.priceChange?.h6   ?? 0;
  const pc24h  = pair.priceChange?.h24  ?? 0;
  const vol1h  = pair.volume?.h1        ?? 0;
  const vol24h = pair.volume?.h24       ?? 0;
  const liq    = pair.liquidity?.usd    ?? 0;
  const buys1h = pair.txns?.h1?.buys    ?? 0;
  const sells1h= pair.txns?.h1?.sells   ?? 0;
  const buys24 = pair.txns?.h24?.buys   ?? 0;
  const sells24= pair.txns?.h24?.sells  ?? 0;
  const mc     = pair.fdv ?? pair.marketCap ?? 0;

  const totalTx1h   = buys1h + sells1h || 1;
  const buyPct      = buys1h / totalTx1h * 100;
  const sellPct     = 100 - buyPct;
  const netPressure = buys1h - sells1h;
  const volHourly   = vol24h > 0 ? vol1h / (vol24h / 24) : 0;
  const liqMcRatio  = mc > 0 ? (liq / mc * 100) : 0;
  const avgTxSize   = (buys24 + sells24) > 0 ? vol24h / (buys24 + sells24) : 0;

  let mScore = 50;
  if (pc5m !== null) mScore += pc5m > 3 ? 12 : pc5m > 0 ? 5 : pc5m > -3 ? -2 : -10;
  mScore += pc1h  > 5 ? 14 : pc1h  > 0 ? 6 : pc1h  > -5  ? -3 : -12;
  mScore += pc6h  > 10 ? 10 : pc6h  > 0 ? 4 : pc6h  > -10 ? -2 : -8;
  mScore += pc24h > 20 ? 8  : pc24h > 0 ? 3 : pc24h > -20 ? -1 : -6;
  mScore = Math.max(0, Math.min(100, Math.round(mScore)));

  let oIcon, oLabel, oCl, oBg;
  if      (mScore >= 68 && buyPct >= 58 && liq >= 15000) { oIcon="🚀"; oLabel=t("sa_sig_strong_buy"); oCl="#2cffc9"; oBg="rgba(44,255,201,0.09)"; }
  else if (mScore >= 55 && buyPct >= 50)                  { oIcon="▲"; oLabel=t("sa_sig_bullish");    oCl="#7fffe1"; oBg="rgba(44,255,201,0.05)"; }
  else if (mScore >= 45)                                  { oIcon="➡️"; oLabel=t("sa_sig_neutral");    oCl="#ffd166"; oBg="rgba(255,209,102,0.06)"; }
  else if (mScore >= 30)                                  { oIcon="▼"; oLabel=t("sa_sig_bearish");    oCl="#ff9a60"; oBg="rgba(255,100,50,0.06)"; }
  else                                                    { oIcon="🚨"; oLabel=t("sa_sig_strong_sell");oCl="#ff4d6d"; oBg="rgba(255,77,109,0.09)"; }

  const bpCl  = buyPct >= 60 ? "#2cffc9" : buyPct >= 45 ? "#ffd166" : "#ff4d6d";
  const bpLbl = buyPct >= 60 ? t("sa_bp_high") : buyPct >= 45 ? t("sa_bp_balanced") : t("sa_bp_sellers");
  const vCl   = volHourly >= 1.5 ? "#2cffc9" : volHourly >= 0.7 ? "#ffd166" : "#ff4d6d";
  const vLbl  = volHourly >= 1.5 ? t("sa_vol_surging") : volHourly >= 0.7 ? t("sa_vol_normal") : t("sa_vol_drying");
  const lCl   = liq >= 30000 ? "#2cffc9" : liq >= 10000 ? "#ffd166" : "#ff4d6d";
  const lLbl  = liq >= 100000 ? t("sa_liq_very_strong") : liq >= 30000 ? t("sa_liq_healthy") : liq >= 10000 ? t("sa_liq_moderate") : t("sa_liq_very_low");
  const nCl   = netPressure > 20 ? "#2cffc9" : netPressure > 0 ? "#7fffe1" : netPressure > -20 ? "#ffd166" : "#ff4d6d";
  const nLbl  = netPressure > 20 ? t("sa_net_strong_buy") : netPressure > 0 ? t("sa_net_slight_buy") : netPressure > -20 ? t("sa_net_balanced") : t("sa_net_strong_sell");
  const lmCl  = liqMcRatio >= 10 ? "#2cffc9" : liqMcRatio >= 3 ? "#ffd166" : liqMcRatio > 0 ? "#ff4d6d" : "#777";
  const lmLbl = liqMcRatio >= 10 ? t("sa_lm_safe") : liqMcRatio >= 3 ? t("sa_lm_watch") : liqMcRatio > 0 ? t("sa_lm_risky") : "—";
  const atCl  = avgTxSize >= 1000 ? "#2cffc9" : avgTxSize >= 200 ? "#ffd166" : "#777";
  const atLbl = avgTxSize >= 5000 ? t("sa_tx_whale") : avgTxSize >= 1000 ? t("sa_tx_large") : avgTxSize >= 200 ? t("sa_tx_normal") : t("sa_tx_micro");
  const tsCl  = (pc1h > 0 && pc6h > 0) ? "#2cffc9" : pc1h > 0 ? "#ffd166" : "#ff4d6d";
  const tsLbl = pc1h > 0 && pc6h > 0 ? t("sa_trend_higher") : pc1h > 0 && pc6h <= 0 ? t("sa_trend_recovering") : pc1h <= 0 && pc6h > 0 ? t("sa_trend_pullback") : t("sa_trend_downtrend");

  el.innerHTML = `
    <div style="background:${oBg};border:1px solid ${oCl}33;border-radius:10px;padding:10px 12px;margin-bottom:10px;display:flex;align-items:center;gap:10px;">
      <span style="font-size:20px;">${oIcon}</span>
      <div style="flex:1;">
        <div style="font-size:13px;font-weight:800;color:${oCl};">${oLabel}</div>
        <div style="font-size:10px;opacity:0.5;margin-top:2px;">Live · Birdeye · 30s refresh</div>
      </div>
      <div style="text-align:right;font-size:9px;color:#2cffc9;opacity:0.7;">⬤ LIVE<br/><span style="opacity:0.5;" id="saLastUpdate">just now</span></div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(${pc5m!==null?5:4},1fr);gap:5px;margin-bottom:10px;">
      ${pc5m!==null?`<div style="background:rgba(0,0,0,0.3);border-radius:7px;padding:6px 3px;text-align:center;"><div style="font-size:9px;opacity:0.5;">5M</div><div style="font-size:12px;font-weight:700;color:${pc5m>=0?'#2cffc9':'#ff4d6d'}">${pc5m>=0?"+":""}${pc5m.toFixed(2)}%</div></div>`:""}
      <div style="background:rgba(0,0,0,0.3);border-radius:7px;padding:6px 3px;text-align:center;"><div style="font-size:9px;opacity:0.5;">1H</div><div style="font-size:12px;font-weight:700;color:${pc1h>=0?'#2cffc9':'#ff4d6d'}">${pc1h>=0?"+":""}${pc1h.toFixed(2)}%</div></div>
      <div style="background:rgba(0,0,0,0.3);border-radius:7px;padding:6px 3px;text-align:center;"><div style="font-size:9px;opacity:0.5;">6H</div><div style="font-size:12px;font-weight:700;color:${pc6h>=0?'#2cffc9':'#ff4d6d'}">${pc6h>=0?"+":""}${pc6h.toFixed(2)}%</div></div>
      <div style="background:rgba(0,0,0,0.3);border-radius:7px;padding:6px 3px;text-align:center;"><div style="font-size:9px;opacity:0.5;">24H</div><div style="font-size:12px;font-weight:700;color:${pc24h>=0?'#2cffc9':'#ff4d6d'}">${pc24h>=0?"+":""}${pc24h.toFixed(2)}%</div></div>
      <div style="background:rgba(0,0,0,0.3);border-radius:7px;padding:6px 3px;text-align:center;"><div style="font-size:9px;opacity:0.5;">VOL</div><div style="font-size:11px;font-weight:700;color:#7fffe1">${formatUsd(vol24h)}</div></div>
    </div>

    <div style="margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;font-size:10px;opacity:0.6;margin-bottom:4px;">
        <span>${t("sa_buys_lbl")} ${buys1h} (${buyPct.toFixed(1)}%)</span>
        <span>${t("sa_sells_lbl")} ${sells1h} (${sellPct.toFixed(1)}%)</span>
      </div>
      <div style="height:10px;border-radius:6px;overflow:hidden;background:rgba(255,255,255,0.06);display:flex;">
        <div style="width:${buyPct}%;background:linear-gradient(90deg,#2cffc9,#7fffe1);transition:width 0.8s;"></div>
        <div style="flex:1;background:linear-gradient(90deg,#ff4d6d,#ff8a8a);"></div>
      </div>
    </div>

    <div class="sa-signal-row"><span class="sa-signal-label">${t("sa_lbl_momentum")}</span><span class="sa-signal-val" style="color:${mScore>=60?'#2cffc9':mScore>=45?'#ffd166':'#ff4d6d'}">${mScore>=60?t("sa_mom_bullish"):mScore>=45?t("sa_mom_neutral"):t("sa_mom_bearish")} (${mScore}/100)</span></div>
    <div class="sa-signal-row"><span class="sa-signal-label">${t("sa_lbl_buy_pressure")}</span><span class="sa-signal-val" style="color:${bpCl}">${bpLbl}</span></div>
    <div class="sa-signal-row"><span class="sa-signal-label">${t("sa_lbl_net_pressure")}</span><span class="sa-signal-val" style="color:${nCl}">${nLbl} (${netPressure>0?"+":""}${netPressure})</span></div>
    <div class="sa-signal-row"><span class="sa-signal-label">${t("sa_lbl_vol_trend")}</span><span class="sa-signal-val" style="color:${vCl}">${vLbl} · ${formatUsd(vol1h)}/h</span></div>
    <div class="sa-signal-row"><span class="sa-signal-label">${t("sa_lbl_trend_struct")}</span><span class="sa-signal-val" style="color:${tsCl}">${tsLbl}</span></div>
    <div class="sa-signal-row"><span class="sa-signal-label">${t("sa_lbl_liq")}</span><span class="sa-signal-val" style="color:${lCl}">${lLbl} (${formatUsd(liq)})</span></div>
    <div class="sa-signal-row"><span class="sa-signal-label">${t("sa_lbl_liq_mc")}</span><span class="sa-signal-val" style="color:${lmCl}">${lmLbl} (${liqMcRatio.toFixed(1)}%)</span></div>
    <div class="sa-signal-row"><span class="sa-signal-label">${t("sa_lbl_avg_tx")}</span><span class="sa-signal-val" style="color:${atCl}">${atLbl} · ${formatUsd(avgTxSize)}</span></div>
    <div style="font-size:9px;opacity:0.3;text-align:center;padding-top:8px;border-top:1px solid rgba(44,255,201,0.06);">Birdeye · updates every 30s</div>
  `;
}

/* ============================================================
   RISK SCORE (matches scanSignals.js)
   ============================================================ */

/* Fetch real top-10 holder concentration via Birdeye holderData serverless fn.
   Replaces Helius RPC (getTokenLargestAccounts + getTokenSupply) — Birdeye only.
   Returns { pct: number } on success; { pct: 0 } silently on failure. */
async function fetchTop10Pct(mint) {
  try {
    const res  = await fetch(`/.netlify/functions/holderData?mint=${encodeURIComponent(mint)}`, {
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    if (!data.ok || data.planRestricted) return { pct: 0 };
    return { pct: parseFloat((data.top10Percent ?? 0).toFixed(1)) };
  } catch (e) {
    _DEBUG && console.warn("Safe Ape: holderData fetch failed:", e.message);
    return { pct: 0 };
  }
}

// Unified risk scorer — delegates to scanSignals.js so all pages give the same score.
// top10Pct is fetched from on-chain data for accurate holder-concentration penalty.
function calcRiskScore(pair, top10Pct = 0) {
  return computeRiskScore(pair, top10Pct);
}

/* ============================================================
   SEARCH TOKEN
   ============================================================ */
window.searchToken = async function() {
  /* UX-03: guard — wallet must be connected before searching */
  if (!wallet || !profile) { showToast("Connect your wallet first!"); return; }

  const mint = document.getElementById("saTokenInput").value.trim();
  if (!mint) { showToast("Paste a token mint address first!"); return; }

  /* Basic Solana address sanity check (base58, 32-44 chars) */
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
    showToast("⚠️ That doesn't look like a valid Solana mint address.");
    return;
  }

  const btn = document.getElementById("saSearchBtn");
  btn.disabled = true; btn.textContent = "⏳ Scanning…";
  clearTerminal();
  /* UX-09: show a loading skeleton in the terminal while APIs fetch — prevents blank gap */
  { const _tEl = document.getElementById("saTerminal");
    if (_tEl) { _tEl.style.display = "block"; _tEl.dataset.saLoading = "1"; } }
  try {
    const isPumpFunCheck = String(mint).toLowerCase().endsWith("pump");

    /* ── Fire all 3 fetches immediately in parallel ──────────────────────
       We do NOT await them together — scanToken is fast (Redis-cached) and
       should show the UI as soon as it resolves. holderData + bundle are
       slow (on-chain / Helius) and finish in the background. */
    const scanPromise   = fetch(`${SCAN_TOKEN_API}?mint=${encodeURIComponent(mint)}`, { signal: AbortSignal.timeout(12000) });
    const holderPromise = fetchTop10Pct(mint);   // 10 s timeout inside fetchTop10Pct
    const bundlePromise = fetch("/.netlify/functions/bundle", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ mint, hasGraduated: isPumpFunCheck }),
      signal:  AbortSignal.timeout(12000),
    }).catch(() => null);  // bundle failure is non-fatal — defaults to 50

    /* ── STEP 1: Render immediately when scanToken resolves ─────────────
       scanToken has a 90 s Redis cache so it typically returns in < 1 s.
       We show the full token UI right away without waiting for the slow calls. */
    const res = await scanPromise;
    if (!res.ok) {
      if (res.status === 429) showToast("⚠️ Rate limited — wait a moment and try again.");
      else showToast(`⚠️ Token lookup failed (HTTP ${res.status}). Try again shortly.`);
      return;
    }

    let data;
    try { data = await res.json(); }
    catch { showToast("⚠️ Unexpected response from market data API. Try again."); return; }

    // scanToken returns { ok, pair, meta, isPumpFun, hasGraduated, solPrice, mint }
    if (!data.ok || !data.pair) { showToast("⚠️ No market data found for this token."); return; }

    window.scanIsPumpFun    = data.isPumpFun    ?? false;
    window.scanHasGraduated = data.hasGraduated ?? false;

    const pair        = data.pair;
    const price       = parseFloat(pair.priceUsd || "0");
    if (price > 0) livePrices[mint] = price;

    const tokenName   = data.meta?.name   || pair.baseToken?.name   || "Unknown";
    const tokenSymbol = data.meta?.symbol || pair.baseToken?.symbol || "?";
    const tokenLogo   = data.meta?.logo   || pair.info?.imageUrl    || null;

    /* Initial score uses neutral placeholders (pct:0, bundleScore:50) —
       will be refined once holderData + bundle arrive below. */
    riskScore    = computeRiskScore(pair, 0, 50);
    currentToken = { mint, name: tokenName, symbol: tokenSymbol, logo: tokenLogo,
                     pair, riskScore, holderData: { pct: 0 }, bundleScore: 50 };

    { const _tEl = document.getElementById("saTerminal");
      if (_tEl) { _tEl.style.display = "block"; delete _tEl.dataset.saLoading; } } /* UX-09: clear loading state */
    renderTokenHeader(currentToken);
    const initiallyGated = riskScore < 45;
    if (initiallyGated) showRiskGate(currentToken);
    else                showTradingContent(currentToken);  // inits chart here
    startTokenPoll(mint);
    history.pushState({ saView: "token", mint }, "", "#token");

    /* ── STEP 2: Refine with real holder + bundle data (background) ─────
       These may take several more seconds. We update only the panels that
       depend on them — the chart is already running and is NOT re-inited. */
    const [holderData, bundleRes] = await Promise.all([holderPromise, bundlePromise]);

    // Guard: user may have searched a different token while we were waiting
    if (currentToken?.mint !== mint) return;

    const bundleData  = (bundleRes?.ok) ? await bundleRes.json().catch(() => null) : null;
    const bundleScore = bundleData?.bundleScore ?? 50;  // 50 = unknown/neutral

    const refinedScore = computeRiskScore(pair, holderData.pct, bundleScore);
    riskScore                = refinedScore;
    currentToken.riskScore   = refinedScore;
    currentToken.holderData  = holderData;
    currentToken.bundleScore = bundleScore;

    // Refresh header (risk score badge) + panels that depend on holder/bundle data
    renderTokenHeader(currentToken);
    if (!initiallyGated) {
      updateRiskPanel(currentToken.pair);
      updateMarketSignals(currentToken.pair);
      renderHoldersPanel(currentToken);
    }
    // If real data reveals a dangerous token — flip to risk gate now
    if (!initiallyGated && refinedScore < 45) showRiskGate(currentToken);
    // UX-01: if gate was shown on neutral data but real data says it's safe,
    // update the gate message in-place — do NOT auto-open (let the user decide).
    if (initiallyGated && refinedScore >= 45) {
      document.getElementById("saRiskGateMsg").innerHTML = `
        Risk score updated to <strong style="color:#ffd166">${refinedScore}/100</strong>
        — this token is now rated <strong style="color:#ffd166">MODERATE RISK</strong>.<br/><br/>
        Click <em>I understand the risk — proceed anyway</em> below to open the trading terminal.
      `;
    }

  } catch (e) {
    _DEBUG && console.error("searchToken error:", e);
    const msg = e?.name === "TimeoutError" || e?.name === "AbortError"
      ? "⚠️ Token lookup timed out. Check your internet connection."
      : "⚠️ Failed to load token. Check the mint address.";
    showToast(msg);
  } finally {
    btn.disabled = false; btn.textContent = "🔍 Analyse Token";
  }
};

function clearTerminal() {
  stopTokenTimers();
  if (candleChart) { candleChart.destroy(); candleChart = null; }
  document.getElementById("saTerminal").style.display       = "none";
  document.getElementById("saRiskGate").style.display       = "none";
  document.getElementById("saTradingContent").style.display = "none";
  currentToken = null;
  /* Clean up the #token hash from the URL without adding another history entry */
  if (location.hash === "#token") history.replaceState(null, "", location.pathname + location.search);
}
window.clearTerminal = clearTerminal;

/* ============================================================
   FULLSCREEN CHART MODAL
   ============================================================ */
let _fcmChart    = null;   /* CandleChart instance inside the modal     */
let _fcmTf       = "5m";   /* active timeframe inside the modal         */
let _fcmReqId    = 0;      /* abort stale loads when TF switches quickly */
let _fcmPriceTick = null;  /* setInterval for price row updates          */

window.openChartModal = async function() {
  if (!currentToken) return;
  const modal = document.getElementById("saChartModal");
  if (!modal) return;

  /* Reset and show overlay */
  _fcmModalOpen = true; /* UX-06: suppress main chart ticks while modal is visible */
  modal.style.display = "flex";
  document.body.style.overflow = "hidden";  /* prevent page scroll behind modal */

  /* Sync TF with the main chart */
  _fcmTf = currentTf;

  /* Highlight the active TF button */
  _fcmSyncTfBtns(_fcmTf);

  /* Token name */
  const nameEl = document.getElementById("saFcmTokenName");
  if (nameEl) nameEl.textContent = `${currentToken.name} (${currentToken.symbol})`;

  /* Build the CandleChart inside the modal */
  if (_fcmChart) { _fcmChart.destroy(); _fcmChart = null; }
  _fcmChart = new CandleChart("saFcmChart");
  _fcmChart.setToken(currentToken.name, currentToken.symbol);
  _fcmChart.setTimeframe(_fcmTf);
  _fcmChart.startLoading();

  /* Load OHLCV */
  await _fcmLoadCandles();

  /* Mirror B/S trade markers from the main chart */
  if (profile?.trades) _fcmChart.setTradeMarkers(profile.trades, currentToken.mint);

  /* Mirror manual drawings (hlines, trendlines, manual B/S pins) from the main chart */
  if (candleChart) _fcmChart.importSerializedDrawings(candleChart.getSerializedDrawings());

  /* Live price row */
  _fcmUpdatePriceRow();
  clearInterval(_fcmPriceTick);
  _fcmPriceTick = setInterval(_fcmUpdatePriceRow, 1500);

  /* ESC to close */
  document.addEventListener("keydown", _fcmEscHandler);
};

window.closeChartModal = function() {
  _fcmModalOpen = false; /* UX-06: resume main chart ticks */
  const modal = document.getElementById("saChartModal");
  if (modal) modal.style.display = "none";
  document.body.style.overflow = "";
  document.removeEventListener("keydown", _fcmEscHandler);
  clearInterval(_fcmPriceTick);

  /* Sync drawings made inside the modal back to the main chart */
  if (_fcmChart && candleChart) {
    const data = _fcmChart.getSerializedDrawings();
    candleChart.clearDrawings();
    candleChart.importSerializedDrawings(data);
  }

  /* If the user switched TF inside the modal, apply it to the main chart too */
  if (_fcmTf && _fcmTf !== currentTf && candleChart) {
    currentTf = _fcmTf;
    /* Sync TF button highlights */
    document.querySelectorAll(".sa-tf-btn[data-tf]").forEach(b => {
      b.classList.toggle("active", b.dataset.tf === currentTf);
    });
    /* Reload the main chart with the new TF */
    candleChart.setTimeframe(currentTf);
    candleChart.startLoading();
    _saStopChartTicker();
    (async () => {
      const ohlcv = await fetchOhlcv(currentToken?.mint, currentTf);
      if (ohlcv?.length && candleChart) {
        candleChart.loadCandles(ohlcv);
        const p = livePrices[currentToken?.mint] || parseFloat(currentToken?.pair?.priceUsd || "0");
        if (p > 0) candleChart.tick(p, (currentToken?.pair?.volume?.h1 || 0) / 2400);
      }
      if (currentToken?.mint) _saStartChartTicker(currentToken.mint);
    })();
  } else if (candleChart) {
    /* Same TF — just refresh layout (re-measure container after modal layout shift) */
    candleChart.refresh();
  }

  if (_fcmChart) { _fcmChart.destroy(); _fcmChart = null; }
};

/* Click on the dark backdrop (not the inner panel) → close */
window._fcmBgClick = function(e) {
  if (e.target === document.getElementById("saChartModal")) window.closeChartModal();
};

function _fcmEscHandler(e) {
  if (e.key === "Escape") window.closeChartModal();
}

async function _fcmLoadCandles() {
  if (!currentToken || !_fcmChart) return;
  const myId = ++_fcmReqId;

  const liveP = livePrices[currentToken.mint] || parseFloat(currentToken.pair?.priceUsd || "0");

  let loaded = false;
  {
    const ohlcv = await fetchOhlcv(currentToken.mint, _fcmTf);
    if (myId !== _fcmReqId || !_fcmChart) return; /* stale — user switched TF */
    if (ohlcv && ohlcv.length > 0) {
      _fcmChart.loadCandles(ohlcv);
      loaded = true;
    }
  }
  if (!loaded) {
    const tickOhlcv = _buildOhlcvFromTicks(currentToken.mint, _fcmTf);
    if (tickOhlcv && _fcmChart) { _fcmChart.loadCandles(tickOhlcv); loaded = true; }
  }
  if (!loaded && _fcmChart) _fcmChart.loadCandles([]);

  /* Seed first tick */
  if (_fcmChart && liveP > 0) {
    _fcmChart.tick(liveP, (currentToken.pair?.volume?.h1 || 0) / 2400);
  }
}

function _fcmUpdatePriceRow() {
  if (!currentToken || !_fcmChart) return;
  const price = livePrices[currentToken.mint] || parseFloat(currentToken.pair?.priceUsd || "0");
  const pc24  = currentToken.pair?.priceChange?.h24 ?? 0;
  const cl    = pc24 >= 0 ? "#2cffc9" : "#ff4d6d";
  const el    = document.getElementById("saFcmPriceRow");
  if (el) {
    el.innerHTML = `
      <span class="sa-price-main" style="color:${cl}">${formatPrice(price)}</span>
      <span class="sa-price-change" style="background:${pc24>=0?'rgba(44,255,201,0.12)':'rgba(255,77,109,0.12)'};color:${cl}">
        ${pc24>=0?"+":""}${pc24.toFixed(2)}%
      </span>`;
  }
  /* Feed live tick to the modal chart */
  if (_fcmChart && price > 0) {
    _fcmChart.tick(price, (currentToken.pair?.volume?.h1 || 0) / 2400);
  }
}

function _fcmSyncTfBtns(activeTf) {
  document.querySelectorAll("[data-fcm-tf]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.fcmTf === activeTf);
  });
}

/* Wire up modal TF buttons */
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-fcm-tf]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!_fcmChart) return;
      _fcmTf = btn.dataset.fcmTf;
      _fcmSyncTfBtns(_fcmTf);
      _fcmChart.setTimeframe(_fcmTf);
      _fcmChart.startLoading();
      await _fcmLoadCandles();
    });
  });
});

/* ============================================================
   TOKEN HEADER
   ============================================================ */
/* ── Watchlist helpers ── */
function fmtUsdShort(n) {
  if (!n) return "N/A";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(2) + "K";
  return "$" + n.toFixed(2);
}

function toggleWatchlistFromApe() {
  if (!currentToken) return;
  const tok  = currentToken;
  const pair = tok.pair;
  const mint = tok.mint;

  const liqUsd  = pair?.liquidity?.usd ?? 0;
  const mcapUsd = pair?.fdv ?? pair?.marketCap ?? 0;
  const buys    = pair?.txns?.h24?.buys  ?? 0;
  const sells   = pair?.txns?.h24?.sells ?? 0;
  const vol24   = pair?.volume?.h24 ?? 0;
  const txCount = buys + sells;
  const avgTx   = txCount > 0 ? fmtUsdShort(vol24 / txCount) : "N/A";

  const riskScore = tok.riskScore ?? 0;
  const riskLevel = riskScore >= 65 ? "LOW RUG RISK"
                  : riskScore >= 45 ? "MODERATE RISK"
                  : "HIGH RUG RISK";

  const entry = {
    mint,
    name:       tok.name   || "Unknown",
    symbol:     tok.symbol || "",
    logo:       tok.logo   || null,
    totalScore: riskScore,
    riskLevel,
    liquidity:  fmtUsdShort(liqUsd),
    marketCap:  fmtUsdShort(mcapUsd),
    top10:      tok.holderData?.pct != null ? tok.holderData.pct.toFixed(1) + "%" : "N/A",
    avgTxSize:  avgTx,
    scannedAt:  new Date().toISOString(),
  };

  const alreadyOn = isOnWatchlist(mint);
  if (alreadyOn) {
    /* remove */
    const list = JSON.parse(localStorage.getItem("s2m_watchlist") || "[]");
    localStorage.setItem("s2m_watchlist", JSON.stringify(list.filter(x => x.mint !== mint)));
  } else {
    addToWatchlist(entry);
  }

  /* Update button state */
  const btn = document.getElementById("saWlBtn");
  if (btn) {
    const nowOn = !alreadyOn;
    btn.textContent = nowOn ? t("sa_wl_added") : t("sa_wl_add");
    btn.classList.toggle("sa-wl-active", nowOn);
    btn.style.transform = "scale(0.93)";
    setTimeout(() => { if (btn) btn.style.transform = ""; }, 150);
  }
}

window._saToggleWl = toggleWatchlistFromApe; /* expose for inline onclick */

function renderTokenHeader(tok) {
  const logoUrl = tok.logo ? `/.netlify/functions/logoProxy?url=${encodeURIComponent(tok.logo)}` : "https://placehold.co/52x52";
  const sm = safeMint(tok.mint);
  document.getElementById("saTokenHeader").innerHTML = `
    <img class="sa-token-logo" src="${logoUrl}" onerror="this.src='https://placehold.co/52x52'" />
    <div style="flex:1;min-width:0;">
      <div class="sa-token-name">${esc(tok.name)} <span style="opacity:0.5;font-size:14px">(${esc(tok.symbol)})</span></div>
      <div class="sa-token-symbol">${t("sa_risk_score_lbl")} <strong style="color:${tok.riskScore>=65?'#2cffc9':tok.riskScore>=45?'#ffd166':'#ff4d6d'}">${tok.riskScore}/100</strong>
        <span style="font-size:9px;opacity:0.35;font-weight:400;letter-spacing:1px;margin-left:8px;">⬤ LIVE · 1.5s</span>
      </div>
      <div class="sa-token-mint">${esc(sm)}</div>
    </div>
    <div class="sa-token-header-right">
      <a href="https://birdeye.so/token/${sm}?chain=solana" target="_blank" rel="noopener noreferrer" class="sa-token-link">Birdeye</a>
      <a href="https://solscan.io/token/${sm}" target="_blank" rel="noopener noreferrer" class="sa-token-link">🔎 Solscan</a>
      <a href="risk-scanner.html" onclick="localStorage.setItem('s2m_prefill_mint','${sm}')" class="sa-token-link">🛡️ Full Scan</a>
      <button id="saWlBtn" class="sa-token-link sa-wl-btn ${isOnWatchlist(tok.mint) ? 'sa-wl-active' : ''}" onclick="window._saToggleWl()">
        ${isOnWatchlist(tok.mint) ? t("sa_wl_added") : t("sa_wl_add")}
      </button>
    </div>
  `;
}

/* ============================================================
   RISK GATE
   ============================================================ */
function showRiskGate(tok) {
  document.getElementById("saRiskGate").style.display       = "block";
  document.getElementById("saTradingContent").style.display = "none";
  document.getElementById("saRiskGateMsg").innerHTML = `
    This token's Scan2Moon Risk Score is <strong style="color:#ff4d6d">${tok.riskScore}/100</strong> — ${t("sa_risk_gate_p1")}<br/><br/>
    ${t("sa_risk_gate_p2")}<br/><br/>
    <strong>${t("sa_risk_gate_p3")}</strong>
  `;
  document.getElementById("saRiskProceedBtn").onclick = () => {
    document.getElementById("saRiskGate").style.display = "none";
    showTradingContent(tok);
  };
}

/* ============================================================
   TRADING CONTENT
   ============================================================ */
function showTradingContent(tok) {
  document.getElementById("saTradingContent").style.display = "block";
  updateRiskPanel(tok.pair);
  updateMarketSignals(tok.pair);
  renderHoldersPanel(tok);
  renderPriceRow(tok.pair);
  updateTradeTab();
  /* Clear any rug overlay/banner from the previous token */
  document.getElementById("saRugOverlay")?.remove();
  document.getElementById("saRugBanner")?.remove();
  /* BUG-09: preserve rug state across re-visits — do NOT reset _peakPrices or
     _rugTriggered here. The peak price keeps accumulating and the overlay won't
     spam the user again once it has fired. Both objects are keyed by mint so
     state for one token never bleeds into another. */
  initChart(tok);
}

/* ============================================================
   TOP HOLDERS
   Uses real on-chain data when available (holderData from fetchTop10Pct),
   falls back to estimated distribution for tokens where RPC failed.
   ============================================================ */
function renderHoldersPanel(tok) {
  const hd      = tok.holderData;
  const hasReal = hd && hd.accounts && hd.accounts.length > 0;

  let holders, total, isEstimated;

  if (hasReal) {
    /* ── Real on-chain data ── */
    const decimals    = hd.decimals;
    const totalSupply = hd.totalSupply;
    holders = hd.accounts.slice(0, 10).map((acc, i) => {
      const amount  = Number(acc.amount) / 10 ** decimals;
      const pct     = totalSupply > 0 ? (amount / totalSupply) * 100 : 0;
      const addr    = acc.address?.toString() || "–";
      const short   = addr.length > 8 ? addr.slice(0, 4) + "…" + addr.slice(-4) : addr;
      return { pct: pct.toFixed(1), label: i === 0 ? "Top Holder" : `#${i + 1}`, addr: short };
    });
    total       = hd.pct;
    isEstimated = false;
  } else {
    /* ── Fallback: estimated distribution based on liquidity ── */
    /* BUG-08: cache on tok so addresses don't re-randomise on every render call.
       BUG-13: use optional chaining (tok.pair?.liquidity) to guard against null tok.pair. */
    if (tok.estimatedHolders) {
      holders = tok.estimatedHolders.holders;
      total   = tok.estimatedHolders.total;
    } else {
      const liq  = tok.pair?.liquidity?.usd ?? 0;
      const base = liq < 10000 ? 70 : liq < 50000 ? 50 : 30;
      const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
      const ra    = () => { const f = Array.from({length:44}, () => chars[Math.floor(Math.random()*chars.length)]).join(""); return f.slice(0,4)+"…"+f.slice(-4); };
      holders = [];
      let rem = Math.min(base, 85);
      holders.push({ pct: Math.min(rem * 0.38, 32).toFixed(1), label: "LP / Dev", addr: ra() });
      rem -= parseFloat(holders[0].pct);
      for (let i = 1; i < 7 && rem > 1; i++) {
        const pct = Math.max(1, rem*(0.45-i*0.04)*(0.85+Math.random()*0.3));
        holders.push({ pct: Math.min(pct, rem*0.65).toFixed(1), label: i<3?"Whale":"Holder", addr: ra() });
        rem -= parseFloat(holders[holders.length-1].pct);
      }
      total = holders.reduce((a, h) => a + parseFloat(h.pct), 0);
      tok.estimatedHolders = { holders, total }; /* cache for subsequent renders */
    }
    isEstimated = true;
  }

  const cl = total > 60 ? "#ff4d6d" : total > 40 ? "#ffd166" : "#2cffc9";

  document.getElementById("saHoldersPanel").innerHTML = `
    <div style="display:flex;justify-content:space-between;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid rgba(44,255,201,0.1);">
      <span style="font-size:12px;opacity:0.6;">Top ${holders.length} ${t("sa_concentration")}</span>
      <span style="font-weight:700;color:${cl}">${typeof total === "number" ? total.toFixed(1) : total}%</span>
    </div>
    ${holders.map((h,i)=>`<div class="sa-holder-row"><span class="sa-holder-rank">#${i+1}</span><span class="sa-holder-addr">${esc(h.addr)}</span><span class="sa-holder-pct" style="color:${i<2?cl:'#cffff4'}">${esc(String(h.pct))}%</span></div>`).join("")}
    <div style="font-size:10px;opacity:0.3;margin-top:8px;text-align:center;">${isEstimated ? t("sa_est_dist") : t("sa_onchain_rpc")}</div>
  `;
}

/* ============================================================
   PRICE ROW (above chart)
   ============================================================ */
function renderPriceRow(pair) {
  const price = livePrices[currentToken?.mint] || parseFloat(pair?.priceUsd||"0");
  const pc24h = pair?.priceChange?.h24 ?? 0;
  document.getElementById("saPriceRow").innerHTML = `
    <div class="sa-price-main">${formatPrice(price)}</div>
    <div class="sa-price-change ${pc24h>=0?'sa-price-up':'sa-price-down'}">${pc24h>=0?"+":""}${pc24h.toFixed(2)}%  24H</div>
  `;
}

/* ============================================================
   TRADE TABS
   ============================================================ */
window.setTradeTab = function(tab) { currentTab = tab; updateTradeTab(); };
function updateTradeTab() {
  const isBuy = currentTab === "buy";
  document.getElementById("tabBuy").classList.toggle("active", isBuy);
  document.getElementById("tabSell").classList.toggle("active", !isBuy);
  document.getElementById("saBuyPanel").style.display  = isBuy  ? "block" : "none";
  document.getElementById("saSellPanel").style.display = !isBuy ? "block" : "none";
  if (!isBuy && currentToken) renderSellHoldingInfo();
}

function renderSellHoldingInfo() {
  const h  = profile?.holdings?.[currentToken?.mint];
  const el = document.getElementById("saHoldingInfo");
  if (!h||h.amount<=0) { el.innerHTML=`<div class="sa-no-holding">${t("sa_no_holding_yet")} ${currentToken?.symbol||"this token"} ${t("sa_no_holding_yet2")}</div>`; return; }
  const price     = livePrices[currentToken.mint]||parseFloat(currentToken.pair?.priceUsd||"0");
  const costSol   = h.totalCostSol||0;
  // Use actual SOL price for accurate P/L. Ratio fallback only if solPrice not loaded.
  const curValSol = (price>0 && solPrice>0)
    ? (h.amount * price / solPrice)
    : (h.avgPrice>0&&costSol>0 ? costSol*(price/h.avgPrice) : costSol);
  const curValUsd = solPrice>0 ? curValSol*solPrice : price*h.amount;
  const pnlSol    = curValSol - costSol;
  const pnlPct    = costSol>0?(pnlSol/costSol)*100:0;
  const sign      = pnlSol>=0?"+":"";
  el.innerHTML = `
    <div class="sa-holding-stat"><span class="sa-holding-label">${t("sa_lbl_holdings")}</span><span class="sa-holding-val">${formatAmount(h.amount)} ${currentToken.symbol}</span></div>
    <div class="sa-holding-stat"><span class="sa-holding-label">${t("sa_lbl_avg_buy")}</span><span class="sa-holding-val">${formatPrice(h.avgPrice)}</span></div>
    <div class="sa-holding-stat"><span class="sa-holding-label">${t("sa_lbl_cur_val")}</span><span class="sa-holding-val" id="saLiveCurrentValue">${formatSol(curValSol)}${solPrice>0?` ≈ ${formatUsd(curValUsd)}`:''}</span></div>
    <div class="sa-holding-stat sa-pnl-live-row">
      <span class="sa-holding-label">${t("sa_lbl_unrealised")}</span>
      <span class="sa-holding-val sa-holding-pnl ${pnlSol>=0?"pos":"neg"}" id="saLivePnl">${sign}${formatSol(pnlSol)} (${sign}${pnlPct.toFixed(4)}%)</span>
    </div>
  `;
}

function updateLivePnl(price) {
  if (!currentToken||!profile) return;
  const h = profile.holdings?.[currentToken.mint];
  if (!h||h.amount<=0) return;
  const costSol   = h.totalCostSol||0;
  const curValSol = (price>0 && solPrice>0)
    ? (h.amount * price / solPrice)
    : (h.avgPrice>0&&costSol>0 ? costSol*(price/h.avgPrice) : costSol);
  const curValUsd = solPrice>0 ? curValSol*solPrice : price*h.amount;
  const pnlSol    = curValSol - costSol;
  const pnlPct    = costSol>0?(pnlSol/costSol)*100:0;
  const sign      = pnlSol>=0?"+":"";
  const pnlEl     = document.getElementById("saLivePnl");
  const valEl     = document.getElementById("saLiveCurrentValue");
  if (pnlEl) { pnlEl.textContent=`${sign}${formatSol(pnlSol)} (${sign}${pnlPct.toFixed(4)}%)`; pnlEl.className=`sa-holding-val sa-holding-pnl ${pnlSol>=0?"pos":"neg"}`; }
  if (valEl)   valEl.textContent=`${formatSol(curValSol)}${solPrice>0?` ≈ ${formatUsd(curValUsd)}`:''}`;
}

function updatePortfolioPnlCards() {
  if (!profile) return;
  let totalCost = 0, totalVal = 0, wins = 0, losses = 0, pending = 0;

  for (const [mint,h] of Object.entries(profile.holdings||{})) {
    if (!h||h.amount<=0) continue;
    const price     = livePrices[mint];
    const costSol   = h.totalCostSol||0;
    totalCost += costSol;

    if (!price) { totalVal += costSol; pending++; continue; }

    /* BUG-11: use calcPositionValue so formula matches renderPortfolioSummary exactly */
    const curValSol = calcPositionValue(h, price, solPrice);
    const curValUsd = solPrice>0 ? curValSol*solPrice : price*h.amount;
    const pnlSol    = curValSol - costSol;
    const pnlPct    = costSol>0?(pnlSol/costSol)*100:0;
    const sign      = pnlSol>=0?"+":"";
    totalVal += curValSol;
    if (pnlSol >= 0) wins++; else losses++;

    const pnlEl = document.getElementById(`sa-atm-pnl-${mint}`);
    const valEl = document.getElementById(`sa-cur-val-${mint}`);
    if (pnlEl) { pnlEl.textContent=`${sign}${formatSol(pnlSol)} (${sign}${pnlPct.toFixed(4)}%)`; pnlEl.className=`sa-card-atm-pnl ${pnlSol>=0?"pnl-pos":"pnl-neg"}`; }
    if (valEl)   valEl.textContent=`${formatSol(curValSol)}${solPrice>0?` ≈ ${formatUsd(curValUsd)}`:''}`;
  }

  /* Live-update the summary bar totals */
  const totalPnlEl = document.getElementById("sa-total-pnl");
  if (totalPnlEl && totalCost > 0) {
    const pnlSol = totalVal - totalCost;
    const pnlPct = (pnlSol / totalCost) * 100;
    const pnlUsd = solPrice > 0 ? pnlSol * solPrice : null;
    const sign   = pnlSol >= 0 ? "+" : "";
    const cls    = pnlSol >= 0 ? "pnl-pos" : "pnl-neg";
    totalPnlEl.className = `sa-summary-val ${cls}`;
    totalPnlEl.innerHTML = `${sign}${formatSol(pnlSol)}${pnlUsd !== null ? ` <span style="opacity:0.6;font-size:11px;">≈ ${sign}${formatUsd(Math.abs(pnlUsd))}</span>` : ""}
      <span style="opacity:0.7;font-size:11px;margin-left:4px;">(${sign}${pnlPct.toFixed(2)}%)</span>`;
  }
}

/* ── Unified position value helper (BUG-11) ─────────────────────────────────
   Single source of truth for "current value in SOL" so renderPortfolioSummary
   and updatePortfolioPnlCards always use the same formula and can never diverge. */
function calcPositionValue(h, price, _solPrice) {
  if (!h || !(h.amount > 0)) return 0;
  const costSol = h.totalCostSol || 0;
  if (price > 0 && _solPrice > 0) return h.amount * price / _solPrice;
  if (price > 0 && h.avgPrice > 0 && costSol > 0) return costSol * (price / h.avgPrice);
  return costSol; // neutral — price not yet loaded
}

/* ============================================================
   BUY / SELL INFO
   ============================================================ */
function updateBuyInfo() {
  if (!currentToken) return;
  const amountSol = parseFloat(document.getElementById("buyAmount").value)||0;
  const price     = livePrices[currentToken.mint]||parseFloat(currentToken.pair.priceUsd||"0");
  const slippage  = parseFloat(document.getElementById("slippageSelect").value);
  const effPrice  = price*(1+slippage);
  const amountUsd = solPrice>0?amountSol*solPrice:0;
  const tokens    = amountSol>0&&effPrice>0&&solPrice>0?amountUsd/effPrice:0;
  document.getElementById("buyInfo").innerHTML = amountSol>0
    ?`You buy: ~${formatAmount(tokens)} ${currentToken.symbol}<br/>Price: ${formatPrice(effPrice)} (${(slippage*100).toFixed(1)}% slip)<br/>Cost: ${formatSol(amountSol)}${solPrice>0?` ≈ ${formatUsd(amountUsd)}`:''}`
    :"Enter an amount to see details.";
}

function updateSellInfo() {
  if (!currentToken) return;
  const amt      = parseFloat(document.getElementById("sellAmount").value)||0;
  const price    = livePrices[currentToken.mint]||parseFloat(currentToken.pair.priceUsd||"0");
  const slippage = parseFloat(document.getElementById("slippageSelect").value);

  // Use price-ratio formula so "Receive" matches Current Value display
  const h = profile?.holdings?.[currentToken.mint];
  const costSol   = h?.totalCostSol || 0;
  const totalHeld = h?.amount || 0;
  let receivedSol = 0;
  let receivedUsd = 0;
  if (price > 0 && costSol > 0 && totalHeld > 0 && amt > 0) {
    /* Use live SOL price for accurate estimate; fall back to ratio only if solPrice=0 */
    const fullValSol = (solPrice > 0)
      ? (totalHeld * price / solPrice)
      : (h?.avgPrice > 0 ? costSol * (price / h.avgPrice) : costSol);
    const fraction  = Math.min(amt / totalHeld, 1);
    receivedSol = fullValSol * fraction * (1 - slippage);
    receivedUsd = solPrice > 0 ? receivedSol * solPrice : amt * price * (1 - slippage);
  }

  /* UX-04: show explicit "no holdings" hint instead of generic "enter amount" when there's nothing to sell */
  const _hasHolding = h && h.amount > 0;
  document.getElementById("sellInfo").innerHTML = amt > 0
    ? `You sell: ${formatAmount(amt)} ${currentToken.symbol}<br/>Receive: ${formatSol(receivedSol)}${solPrice>0?` ≈ ${formatUsd(receivedUsd)}`:''} (${(slippage*100).toFixed(1)}% slip)`
    : _hasHolding ? "Enter token amount to sell." : `No ${currentToken.symbol} holdings — buy first.`;
}

window.setQuickBuy  = (pct) => { if (!profile) return; document.getElementById("buyAmount").value=(profile.balance*pct/100).toFixed(4); updateBuyInfo(); };
window.setQuickSell = (pct) => {
  if (!currentToken) return;
  const h=profile?.holdings?.[currentToken.mint]; if (!h) return;
  document.getElementById("sellAmount").value = pct>=100?h.amount.toString():(h.amount*pct/100).toFixed(6);
  updateSellInfo();
};

/* ============================================================
   EXECUTE BUY — fresh price before trade
   ============================================================ */
window.executeBuy = async function() {
  if (!currentToken||!profile) return;
  const amountSol = parseFloat(document.getElementById("buyAmount").value);
  const slippage  = parseFloat(document.getElementById("slippageSelect").value);
  if (!amountSol||amountSol<=0)    { showToast("Enter an amount to buy!"); return; }
  if (amountSol>profile.balance)   { showToast("⚠️ Insufficient S2M balance!"); return; }
  if (!solPrice||solPrice<=0)      { showToast("⚠️ SOL price unavailable. Try again."); return; }
  const btn = document.getElementById("saBuyBtn");
  btn.disabled=true; btn.textContent="⏳ Fetching price…";
  await pollActivePair(currentToken.mint);
  const price = livePrices[currentToken.mint]||0;
  if (!price) { showToast("⚠️ Could not get price. Try again."); btn.disabled=false; btn.textContent="BUY POSITION"; return; }
  const amountUsd = amountSol*solPrice;
  const tokens    = amountUsd/(price*(1+slippage));
  btn.textContent="⏳ Processing…";
  try {
    // Send solAmount so the server deducts exactly what the user requested,
    // regardless of any SOL-price divergence between client and server.
    const resp = await fetch(SIM_API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({wallet,action:"buy",mint:currentToken.mint,symbol:currentToken.symbol,name:currentToken.name,logo:currentToken.logo,priceUsd:price,solAmount:amountSol,slippage,riskScore:currentToken.riskScore,solPrice})});
    if (resp.status === 503) { showToast("⚠️ Server busy, please try again."); return; }
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    profile = data.profile;
    saveProfileBackup(profile);
    updateStaticUI();
    /* Use setTradeMarkers (server timestamps) instead of addTradeMarker
       (Date.now) so the B marker lands on the correct historical candle. */
    if (candleChart) candleChart.setTradeMarkers(profile.trades, currentToken.mint);
    // Use server's actual cost (trade.totalCostSol) for accurate display
    const actualCostSol = data.trade?.totalCostSol || amountSol;
    const actualTokens  = data.trade?.amount || tokens;
    showToast(`✅ Bought ${formatAmount(actualTokens)} ${currentToken.symbol} for ${formatSol(actualCostSol)}`);
    showBadgeToasts(data.newBadges);
    showDebrief(data.trade,"buy",currentToken.riskScore);
    registerInLeaderboard(wallet);
    document.getElementById("buyAmount").value=""; updateBuyInfo();
  } catch(e) { showToast("⚠️ Buy failed: "+e.message); }
  finally { btn.disabled=false; btn.textContent="BUY POSITION"; }
};

/* ============================================================
   EXECUTE SELL — fresh price before trade
   ============================================================ */
window.executeSell = async function() {
  if (!currentToken||!profile) return;
  const h        = profile.holdings?.[currentToken.mint];
  const amount   = parseFloat(document.getElementById("sellAmount").value);
  const slippage = parseFloat(document.getElementById("slippageSelect").value);
  if (!amount||amount<=0)                  { showToast("Enter an amount to sell!"); return; }
  if (!h||h.amount+0.000001<amount)         { showToast("⚠️ Not enough tokens."); return; }
  const actualAmount = Math.min(amount,h.amount);
  const btn = document.getElementById("saSellBtn");
  btn.disabled=true; btn.textContent="⏳ Fetching price…";
  await pollActivePair(currentToken.mint);
  // Use livePrices (EMA-filtered) OR the pair's last known priceUsd, whichever is available.
  // For sells, a lower price is conservative (user gets less SOL) and always server-accepted.
  const pairPrice = parseFloat(currentToken.pair?.priceUsd||"0");
  const price = livePrices[currentToken.mint] || pairPrice || 0;
  if (!price) { showToast("⚠️ Could not get price. Try again."); btn.disabled=false; btn.textContent="EXIT POSITION"; return; }
  btn.textContent="⏳ Processing…";
  try {
    const resp = await fetch(SIM_API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({wallet,action:"sell",mint:currentToken.mint,priceUsd:price,amount:actualAmount,slippage,riskScore:currentToken.riskScore,solPrice})});
    if (resp.status === 503) { showToast("⚠️ Server busy, please try again."); return; }
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    profile = data.profile;
    saveProfileBackup(profile);
    updateStaticUI();
    /* Use setTradeMarkers (server timestamps) instead of addTradeMarker
       (Date.now) so the S marker lands on the correct historical candle. */
    if (candleChart) candleChart.setTradeMarkers(profile.trades, currentToken.mint);
    /* BUG-07: use calcPositionValue() so sell toast matches Current Value display */
    let _receivedSol = 0;
    const _totalHeld = h?.amount || 0;
    if (_totalHeld > 0) {
      const _curValSol = calcPositionValue(h, price, solPrice);
      const _fraction  = Math.min(actualAmount / _totalHeld, 1);
      _receivedSol = _curValSol * _fraction * (1 - slippage);
    }
    showToast(`✅ Sold ${formatAmount(actualAmount)} ${currentToken.symbol} — received ${formatSol(_receivedSol)}`);
    if (data.trade?.xpEarned > 0) setTimeout(() => showXpToast(data.trade.xpEarned), 600);
    showBadgeToasts(data.newBadges);
    showDebrief(data.trade,"sell",currentToken.riskScore);
    registerInLeaderboard(wallet);
    document.getElementById("sellAmount").value=""; updateSellInfo(); renderSellHoldingInfo();
  } catch(e) { showToast("⚠️ Sell failed: "+e.message); }
  finally { btn.disabled=false; btn.textContent="EXIT POSITION"; }
};

/* ============================================================
   DEBRIEF
   ============================================================ */
/* SEC-05: window.* exports below are intentional — this file is loaded as an ES module
   (type="module") so top-level declarations are NOT global by default. Explicit window
   assignments are required so that inline onclick="…" handlers in safe-ape.html can
   reach these functions. This is NOT a namespace pollution issue. */
window.closeDebrief    = () => { document.getElementById("debriefModal").style.display="none"; };
window.disconnectWallet = disconnectWallet; /* UX-10: needed — ES module functions don't auto-expose to global scope */
window.saStartFresh     = saStartFresh;

/* ============================================================
   JUPITER SWAP — opens in new tab with affiliate ref= code.
   Jupiter blocks iframe embedding (X-Frame-Options), so new tab is the correct approach.
   ============================================================ */
window.openJupModal = function() {
  if (!currentToken) return;
  // Jupiter blocks iframe embedding — open in new tab with affiliate ref code
  // Pre-fill input amount from the current buy panel value (converted to lamports)
  const mint    = safeMint(currentToken.mint);
  const solAmt  = parseFloat(document.getElementById("buyAmount")?.value) || 0.1;
  const lamports = Math.round(solAmt * 1_000_000_000);
  const jupUrl  = `https://jup.ag/swap/SOL-${mint}?inAmount=${lamports}&ref=${JUP_REF}`;
  window.open(jupUrl, "_blank", "noopener,noreferrer");
};

window.closeJupModal = function() {
  // No-op — Jupiter now opens in a new tab, no modal to close
};

function _simJupEscHandler(e) {
  if (e.key === "Escape") window.closeJupModal();
}

window._simJupBgClick = function(e) {
  if (e.target === document.getElementById("simJupModal")) window.closeJupModal();
};

/* ============================================================
   XP TOAST — shown after a sell earns XP
   ============================================================ */
function showXpToast(xp) {
  const old = document.getElementById("saXpToast");
  if (old) old.remove();
  const el = document.createElement("div");
  el.id = "saXpToast";
  el.className = "sa-xp-toast";
  el.textContent = `⚡ +${xp} XP earned!`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function showDebrief(trade,type,score) {
  document.getElementById("debriefModal").style.display="flex";
  let html="";
  if (type==="sell") {
    const pnl=trade.pnl; const isWin=pnl>=0; // pnl is in SOL
    const emoji=pnl>0.5?"🚀":pnl>0?"✅":pnl>-0.2?"😬":"💀";
    const verdict=pnl>0.5?t("sa_verdict_great"):pnl>0?t("sa_verdict_profit"):pnl>-0.2?t("sa_verdict_loss"):t("sa_verdict_rug");
    const lesson=score<45?`⚠️ HIGH RISK token (${score}/100).`:pnl>=0?`✅ Good trade! Score ${score}/100.`:`▼ Loss on ${score>=65?"low":"moderate"}-risk token. Consider stop-losses.`;
    const lCls=score<45?"sa-lesson-risk":pnl>=0?"sa-lesson-win":"sa-lesson-loss";
    const xpLine = trade.xpEarned > 0 ? `<div style="font-size:13px;color:#ab9ff2;margin-top:6px;font-weight:700">⚡ +${trade.xpEarned} XP earned</div>` : "";
    /* SEC-03: escape all third-party data before injecting into innerHTML */
    html=`<div class="sa-debrief-result"><div class="sa-debrief-emoji">${emoji}</div><div class="sa-debrief-verdict" style="color:${isWin?'#2cffc9':'#ff4d6d'}">${verdict}</div><div class="sa-debrief-pnl ${isWin?'win':'loss'}">${pnl>=0?'+':''}${formatSol(pnl)}</div><div style="opacity:0.6;font-size:13px">${pnl>=0?'+':''}${esc(String(trade.pnlPct))}% return</div>${xpLine}</div>
    <div class="sa-debrief-stats"><div class="sa-debrief-stat"><div class="sa-debrief-stat-label">${t("sa_debrief_token")}</div><div class="sa-debrief-stat-val">${esc(trade.symbol)}</div></div><div class="sa-debrief-stat"><div class="sa-debrief-stat-label">${t("sa_debrief_risk")}</div><div class="sa-debrief-stat-val" style="color:${score>=65?'#2cffc9':score>=45?'#ffd166':'#ff4d6d'}">${score}/100</div></div><div class="sa-debrief-stat"><div class="sa-debrief-stat-label">${t("sa_debrief_sold_at")}</div><div class="sa-debrief-stat-val">${formatPrice(trade.priceUsd)}</div></div><div class="sa-debrief-stat"><div class="sa-debrief-stat-label">${t("sa_debrief_avg_buy")}</div><div class="sa-debrief-stat-val">${formatPrice(trade.amount>0?trade.costBasis/trade.amount:0)}</div></div></div>
    <div class="sa-debrief-lesson ${lCls}">${t("sa_lesson")} ${lesson}</div>`;
  } else {
    const totalCostSol=trade.totalCostSol||(solPrice>0?trade.totalCost/solPrice:0);
    const lesson=score<45?`🚨 HIGH RISK (${score}/100).`:score>=65?`✅ Smart entry! Set a target and stop-loss.`:`⚠️ Moderate risk (${score}/100). Have an exit plan.`;
    const lCls=score<45?"sa-lesson-risk":score>=65?"sa-lesson-win":"sa-lesson-loss";
    /* SEC-03: escape all third-party data before injecting into innerHTML */
    html=`<div class="sa-debrief-result"><div class="sa-debrief-diamond"></div><div class="sa-debrief-verdict" style="color:#ffb432">${t("sa_verdict_opened")}</div><div style="font-size:28px;font-weight:700;color:#ffb432;margin:8px 0">${formatSol(totalCostSol)}</div><div style="opacity:0.6;font-size:13px">invested in ${esc(trade.symbol)}</div></div>
    <div class="sa-debrief-stats"><div class="sa-debrief-stat"><div class="sa-debrief-stat-label">${t("sa_debrief_token")}</div><div class="sa-debrief-stat-val">${esc(trade.symbol)}</div></div><div class="sa-debrief-stat"><div class="sa-debrief-stat-label">${t("sa_debrief_risk")}</div><div class="sa-debrief-stat-val" style="color:${score>=65?'#2cffc9':score>=45?'#ffd166':'#ff4d6d'}">${score}/100</div></div><div class="sa-debrief-stat"><div class="sa-debrief-stat-label">${t("sa_debrief_entry")}</div><div class="sa-debrief-stat-val">${formatPrice(trade.priceUsd)}</div></div><div class="sa-debrief-stat"><div class="sa-debrief-stat-label">${t("sa_debrief_tokens")}</div><div class="sa-debrief-stat-val">${formatAmount(trade.amount)}</div></div></div>
    <div class="sa-debrief-lesson ${lCls}">${t("sa_lesson")} ${lesson}</div>`;
  }
  document.getElementById("debriefContent").innerHTML=html;
}

window.exportDebrief = async function() {
  try {
    const c=await html2canvas(document.getElementById("debriefCard"),{backgroundColor:"#071f1a",scale:2,useCORS:true});
    const a=document.createElement("a"); a.download=`SafeApe-${Date.now()}.png`; a.href=c.toDataURL("image/png"); a.click();
    showToast("📸 Recap saved!");
  } catch { showToast("⚠️ Export failed."); }
};

/* ============================================================
   PORTFOLIO
   ============================================================ */
function renderPortfolioSummary(keys, holdings) {
  const el = document.getElementById("saPortfolioSummary");
  if (!el) return;
  if (!keys || !keys.length) { el.innerHTML = ""; return; }

  let totalCost = 0, totalVal = 0, wins = 0, losses = 0, pending = 0;
  for (const mint of keys) {
    const h = holdings[mint];
    const price = livePrices[mint];
    const costSol = h.totalCostSol || 0;
    totalCost += costSol;
    /* BUG-11: use calcPositionValue so formula matches updatePortfolioPnlCards exactly */
    if (price) {
      const curVal = calcPositionValue(h, price, solPrice);
      totalVal += curVal;
      if (curVal >= costSol) wins++; else losses++;
    } else {
      totalVal += costSol; // neutral until price loads
      pending++;
    }
  }

  const pnlSol = totalVal - totalCost;
  const pnlPct = totalCost > 0 ? (pnlSol / totalCost) * 100 : 0;
  const pnlUsd = solPrice > 0 ? pnlSol * solPrice : null;
  const sign   = pnlSol >= 0 ? "+" : "";
  const pnlCls = pnlSol >= 0 ? "pnl-pos" : "pnl-neg";

  el.innerHTML = `
    <div class="sa-summary-bar">
      <div class="sa-summary-item">
        <div class="sa-summary-label">${t("sa_total_pnl")}</div>
        <div class="sa-summary-val ${pnlCls}" id="sa-total-pnl">
          ${sign}${formatSol(pnlSol)}${pnlUsd !== null ? ` <span style="opacity:0.6;font-size:11px;">≈ ${sign}${formatUsd(Math.abs(pnlUsd))}</span>` : ""}
          <span style="opacity:0.7;font-size:11px;margin-left:4px;">(${sign}${pnlPct.toFixed(2)}%)</span>
        </div>
      </div>
      <div class="sa-summary-divider"></div>
      <div class="sa-summary-item">
        <div class="sa-summary-label">${t("sa_open_positions")}</div>
        <div class="sa-summary-counts">
          <span class="sa-summary-wins">▲ ${wins} ${wins !== 1 ? t("sa_wins_p") : t("sa_win_s")}</span>
          <span class="sa-summary-losses">▼ ${losses} ${losses !== 1 ? t("sa_losses_p") : t("sa_loss_s")}</span>
          ${pending ? `<span style="opacity:0.4;font-size:11px;">· ${pending} ${t("sa_loading")}</span>` : ""}
        </div>
      </div>
    </div>`;
}

function renderPortfolio() {
  /* PERF-05: full grid rebuild is intentional — called only on profile load and after
     trades (infrequent). Live P/L updates use updatePortfolioPnlCards() at 200ms. */
  const body=document.getElementById("saPortfolioBody");
  const holdings=profile?.holdings||{};
  const keys=Object.keys(holdings).filter(k=>holdings[k].amount>0);
  if (!keys.length) {
    document.getElementById("saPortfolioSummary").innerHTML = "";
    body.innerHTML=`<div class="sa-empty-portfolio"><div class="sa-empty-icon">◆ ◆ ◆</div><div class="sa-empty-title">${t("sa_no_positions")}</div><div class="sa-empty-sub">${t("sa_no_pos_sub")}</div></div>`;
    return;
  }
  renderPortfolioSummary(keys, holdings);
  body.innerHTML=`<div class="sa-portfolio-grid">${keys.map(mint=>{
    const h=holdings[mint];
    const logo=h.logo?`/.netlify/functions/logoProxy?url=${encodeURIComponent(h.logo)}`:"https://placehold.co/36x36";
    const price=livePrices[mint]||0;
    const costSol=h.totalCostSol||0;
    // curValSol: prefer live SOL price; ratio fallback if solPrice unavailable
    const curValSol=(price>0&&costSol>0)
      ? (solPrice>0 ? (h.amount*price/solPrice) : (h.avgPrice>0?costSol*(price/h.avgPrice):costSol))
      : null;
    const curValUsd=curValSol!==null&&solPrice>0?curValSol*solPrice:(price>0?price*h.amount:null);
    // P/L = actual SOL value change
    const pnlSol=curValSol!==null?curValSol-costSol:null;
    const pnlPct=pnlSol!==null&&costSol>0?(pnlSol/costSol)*100:null;
    const sign=pnlSol!==null?(pnlSol>=0?"+":""):"";
    const pnlCls=pnlSol!==null?(pnlSol>=0?"pnl-pos":"pnl-neg"):"";
    const sm2 = safeMint(mint);
    return `<div class="sa-holding-card" onclick="document.getElementById('saTokenInput').value='${sm2}';window.searchToken()">
      <div class="sa-holding-card-top"><img class="sa-holding-logo" src="${logo}" onerror="this.src='https://placehold.co/36x36'" /><div><div class="sa-holding-name">${esc(h.name)}</div><div class="sa-holding-symbol">${esc(h.symbol)}</div></div></div>
      <div class="sa-holding-card-stats">
        <div class="sa-holding-card-stat"><div class="sa-holding-card-stat-label">${t("sa_lbl_cur_val")}</div><div class="sa-holding-card-stat-val" id="sa-cur-val-${mint}">${curValSol!==null?formatSol(curValSol):formatSol(costSol)}</div></div>
        <div class="sa-holding-card-stat"><div class="sa-holding-card-stat-label">${t("sa_cost_basis")}</div><div class="sa-holding-card-stat-val">${formatSol(costSol)}</div></div>
        <div class="sa-holding-card-stat"><div class="sa-holding-card-stat-label">${t("sa_atm_pnl")} ${price>0?"· LIVE":""}</div><div class="sa-card-atm-pnl ${pnlCls}" id="sa-atm-pnl-${mint}">${pnlSol!==null?`${sign}${formatSol(pnlSol)} (${sign}${pnlPct.toFixed(4)}%)`:"Loading…"}</div></div>
      </div>
      <div style="font-size:11px;opacity:0.45;margin-top:6px;">${formatAmount(h.amount)} tokens @ avg ${formatPrice(h.avgPrice)}</div>
    </div>`;
  }).join("")}</div>`;
}

/* ============================================================
   RECENT TRADES
   ============================================================ */
function renderRecentTrades() {
  const body=document.getElementById("saTradesBody");
  const trades=profile?.trades?.slice(0,15)||[];
  if (!trades.length) { body.innerHTML=`<div style="text-align:center;opacity:0.5;padding:30px;">${t("sa_no_trades")}</div>`; return; }
  body.innerHTML=trades.map(tr=>{
    const isBuy=tr.type==="buy";
    const logo=tr.logo?`/.netlify/functions/logoProxy?url=${encodeURIComponent(tr.logo)}`:"https://placehold.co/28x28";
    const amountSol=isBuy
      ?(tr.totalCostSol||(solPrice>0?tr.totalCost/solPrice:null))
      :(tr.totalReceivedSol||(solPrice>0?tr.totalReceived/solPrice:null));
    const amountFmt=amountSol!==null?formatSol(amountSol):(isBuy?formatUsd(tr.totalCost):formatUsd(tr.totalReceived));
    const pnlHtml=!isBuy&&tr.pnl!==undefined?`<span style="color:${tr.pnl>=0?'#2cffc9':'#ff4d6d'};font-weight:700">${tr.pnl>=0?'+':''}${formatSol(tr.pnl)}</span>`:`<span style="opacity:0.45">—</span>`;
    return `<div class="sa-trade-row"><div><span class="sa-trade-type-badge ${isBuy?'sa-trade-buy':'sa-trade-sell'}">${isBuy?t("sa_trade_buy"):t("sa_trade_sell")}</span></div><div class="sa-trade-token-cell"><img class="sa-trade-token-logo" src="${logo}" onerror="this.src='https://placehold.co/28x28'" /><div><div class="sa-trade-token-name">${esc(tr.name||tr.symbol)}</div><div class="sa-trade-token-symbol">${esc(tr.symbol)}</div></div></div><div>${amountFmt}</div><div class="sa-trade-pnl">${pnlHtml}</div><div class="sa-trade-time">${new Date(tr.timestamp).toLocaleString()}</div></div>`;
  }).join("");
}

/* ============================================================
   BADGE TOAST
   ============================================================ */
const BADGE_NAMES_SA = {
  first_profit:   "First Profit",
  win_streak_5:   "Win Streak ×5",
  safe_trader:    "Safe Trader",
  diamond_hands:  "Diamond Hands",
  degen_survivor: "Degen Survivor",
  portfolio_100:  "100% Growth",
  wins_25:        "25 Safe Wins",
  wins_50:        "50 Safe Wins",
  wins_100:       "100 Safe Wins",
  wins_500:       "500 Safe Wins",
  wins_1000:            "1000 Safe Wins — GOAT",
  sol2moon_millionaire: "Sol2Moon Millionaire",
};
const BADGE_IMGS_SA = {
  first_profit:         "/badges/First_Profit.png",
  win_streak_5:         "/badges/win_streak_5.png",
  safe_trader:          "/badges/Safe_Trader.png",
  diamond_hands:        "/badges/Diamond_Hands.png",
  degen_survivor:       "/badges/Degen_Survivor.png",
  portfolio_100:        "/badges/portfolio_100.png",
  wins_25:              "/badges/Wins_25.png",
  wins_50:              "/badges/Wins_50.png",
  wins_100:             "/badges/Wins_100.png",
  wins_500:             "/badges/Wins_500.png",
  wins_1000:            "/badges/Wins_1000.png",
  sol2moon_millionaire: "/badges/Sol2Moon.png",
};
const BADGE_REWARD_SA = {
  wins_50:              0.5,
  wins_100:             1.0,
  wins_500:             2.0,
  wins_1000:            5.0,
  sol2moon_millionaire: 500.0,
};
function showBadgeToasts(newBadges) {
  if (!newBadges || !newBadges.length) return;
  showBadgeShareCards(newBadges);
}

function showBadgeShareCards(newBadges) {
  if (!newBadges || !newBadges.length) return;
  newBadges.forEach((id, i) => {
    setTimeout(() => {
      const name   = BADGE_NAMES_SA[id] || id;
      const imgSrc = BADGE_IMGS_SA[id];
      const reward = BADGE_REWARD_SA[id] || 0.1;
      showBadgeShareCard(id, name, imgSrc, reward);
    }, i * 800);
  });
}
/* ============================================================
   DAILY REWARD SHAREABLE CARD
   ============================================================ */
function showDailyRewardCard(data) {
  const { reward, streak, dayLabel, isFirstEver } = data;
  const rewardFmt = formatSol(reward); // reward is in SOL
  const streakDisplay = isFirstEver ? "Welcome!" : `▲ Day ${streak} streak`;
  const walletShort = wallet ? wallet.slice(0,4) + "…" + wallet.slice(-4) : "";

  // Build day progress dots (7 days)
  const DAILY_REWARDS_SOL = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
  const dots = Array.from({length:7}, (_, i) => {
    const day = i + 1;
    const done = day <= (streak || 1);
    return `<div style="text-align:center;flex:1;">
      <div style="width:32px;height:32px;border-radius:50%;margin:0 auto 4px;
        background:${done ? 'linear-gradient(135deg,#ffb432,#ff8c00)' : 'rgba(255,180,50,0.08)'};
        border:2px solid ${done ? '#ffb432' : 'rgba(255,180,50,0.2)'};
        display:flex;align-items:center;justify-content:center;
        font-size:12px;font-weight:800;color:${done ? '#1a0a00' : 'rgba(255,180,50,0.4)'};">
        ${done ? '✓' : day}
      </div>
      <div style="font-size:9px;color:${done ? '#ffb432' : 'rgba(255,180,50,0.3)'};font-weight:700;">${DAILY_REWARDS_SOL[i]} S2M</div>
    </div>`;
  }).join("");

  const overlay = document.createElement("div");
  overlay.id = "dailyRewardOverlay";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.82);backdrop-filter:blur(8px);z-index:10000;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.25s ease;";

  overlay.innerHTML = `
    <div id="dailyRewardCard" style="
      background:linear-gradient(145deg,#0d1f1a 0%,#111a12 40%,#1a1200 100%);
      border:2px solid rgba(255,180,50,0.5);
      border-radius:24px;padding:36px 32px 28px;
      max-width:380px;width:90vw;text-align:center;
      box-shadow:0 0 80px rgba(255,170,30,0.25),0 0 0 1px rgba(255,180,50,0.1);
      position:relative;">

      <!-- Close -->
      <button onclick="document.getElementById('dailyRewardOverlay').remove()"
        style="position:absolute;top:14px;right:16px;background:none;border:none;color:rgba(255,255,255,0.35);font-size:20px;cursor:pointer;line-height:1;">✕</button>

      <!-- Header -->
      <div style="font-size:11px;font-weight:700;letter-spacing:2px;color:rgba(255,180,50,0.6);text-transform:uppercase;margin-bottom:8px;">Daily Reward Claimed</div>
      <div class="sa-daily-dot" style="margin:0 auto 12px;width:16px;height:16px;"></div>
      <div style="font-size:15px;font-weight:700;color:#ffb432;margin-bottom:20px;">${streakDisplay}</div>

      <!-- Big reward number -->
      <div style="background:rgba(255,180,50,0.08);border:1px solid rgba(255,180,50,0.2);border-radius:16px;padding:20px;margin-bottom:22px;">
        <div style="font-size:13px;opacity:0.5;margin-bottom:6px;letter-spacing:1px;">REWARD EARNED</div>
        <div style="font-size:52px;font-weight:900;color:#ffb432;line-height:1;letter-spacing:-2px;">+${rewardFmt}</div>
        <div style="display:flex;align-items:center;justify-content:center;gap:6px;margin-top:6px;font-size:13px;color:#ffd770;font-weight:600;">
          S2M <img src="${SOL_LOGO}" style="width:18px;height:18px;border-radius:50%;vertical-align:middle;">
        </div>
      </div>

      <!-- Day progress dots -->
      <div style="font-size:10px;letter-spacing:1px;opacity:0.4;margin-bottom:10px;text-transform:uppercase;">Streak Progress</div>
      <div style="display:flex;gap:6px;justify-content:center;margin-bottom:24px;">${dots}</div>

      <!-- Wallet -->
      <div style="font-size:11px;opacity:0.3;margin-bottom:20px;font-family:monospace;">${walletShort} · scan2moon.com</div>

      <!-- Buttons -->
      <div style="display:flex;gap:10px;">
        <button id="dailyCardSaveBtn" style="flex:1;padding:11px;background:rgba(44,255,201,0.08);border:1px solid rgba(44,255,201,0.25);border-radius:10px;color:#2cffc9;font-size:13px;font-weight:700;cursor:pointer;">💾 Save Image</button>
        <button id="dailyCardShareBtn" style="flex:1;padding:11px;background:linear-gradient(135deg,rgba(255,180,50,0.15),rgba(255,130,0,0.1));border:1px solid rgba(255,180,50,0.4);border-radius:10px;color:#ffb432;font-size:13px;font-weight:700;cursor:pointer;">𝕏 Share to X</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });

  const card = document.getElementById("dailyRewardCard");
  const shareText = `Day ${streak} streak! Just claimed ${rewardFmt} on @Scan2Moon Paper Trading Simulator!\n\nTrade smarter. Earn daily.\nhttps://scan2moon.com`;

  document.getElementById("dailyCardSaveBtn").onclick = async () => {
    try {
      const canvas = await html2canvas(card, { backgroundColor: "#0d1f1a", scale: 2, useCORS: true });
      const link = document.createElement("a");
      link.download = `Scan2Moon-Day${streak}-Reward.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch(e) { showToast("⚠️ Could not save image."); }
  };
  document.getElementById("dailyCardShareBtn").onclick = async () => {
    try {
      const canvas = await html2canvas(card, { backgroundColor: "#0d1f1a", scale: 2, useCORS: true });
      const link = document.createElement("a");
      link.download = `Scan2Moon-Day${streak}-Reward.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch(e) {}
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`, "_blank");
  };
}

/* ============================================================
   BADGE EARNED SHAREABLE CARD
   ============================================================ */
function showBadgeShareCard(id, name, imgSrc, reward) {
  const rewardFmt = formatSol(reward); // reward is in SOL
  const walletShort = wallet ? wallet.slice(0,4) + "…" + wallet.slice(-4) : "";

  const overlay = document.createElement("div");
  overlay.className = "badge-share-overlay";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.82);backdrop-filter:blur(8px);z-index:10001;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.25s ease;";

  overlay.innerHTML = `
    <div id="badgeShareCard_${id}" style="
      background:linear-gradient(145deg,#0d1310 0%,#12100a 40%,#1a1000 100%);
      border:2px solid rgba(255,180,50,0.6);
      border-radius:24px;padding:36px 32px 28px;
      max-width:360px;width:90vw;text-align:center;
      box-shadow:0 0 100px rgba(255,170,30,0.3),0 0 0 1px rgba(255,180,50,0.15);
      position:relative;">

      <!-- Close -->
      <button onclick="this.closest('.badge-share-overlay').remove()"
        style="position:absolute;top:14px;right:16px;background:none;border:none;color:rgba(255,255,255,0.35);font-size:20px;cursor:pointer;line-height:1;">✕</button>

      <!-- Glow ring + badge image -->
      <div style="position:relative;width:110px;height:110px;margin:0 auto 20px;display:flex;align-items:center;justify-content:center;">
        <div style="position:absolute;inset:0;border-radius:50%;background:radial-gradient(circle,rgba(255,180,50,0.2),transparent 70%);animation:pulse 2s infinite;"></div>
        <img src="${imgSrc || ''}" onerror="this.style.display='none'"
          style="width:96px;height:96px;object-fit:contain;mix-blend-mode:multiply;filter:drop-shadow(0 0 16px rgba(255,200,50,0.7));position:relative;z-index:1;">
      </div>

      <!-- Title -->
      <div style="font-size:10px;font-weight:700;letter-spacing:2px;color:rgba(255,180,50,0.5);text-transform:uppercase;margin-bottom:6px;">◆ BADGE UNLOCKED!</div>
      <div style="font-size:22px;font-weight:900;color:#fff;margin-bottom:18px;line-height:1.2;">${name}</div>

      <!-- Reward -->
      <div style="background:rgba(255,180,50,0.07);border:1px solid rgba(255,180,50,0.2);border-radius:14px;padding:16px;margin-bottom:22px;">
        <div style="font-size:11px;opacity:0.4;letter-spacing:1px;margin-bottom:4px;text-transform:uppercase;">Bonus Reward</div>
        <div style="display:flex;align-items:center;justify-content:center;gap:8px;">
          <span style="font-size:36px;font-weight:900;color:#ffb432;letter-spacing:-1px;">+${rewardFmt}</span>
          <img src="${SOL_LOGO}" style="width:28px;height:28px;border-radius:50%;filter:drop-shadow(0 0 6px rgba(255,180,50,0.6));">
        </div>
      </div>

      <!-- Wallet + branding -->
      <div style="font-size:11px;opacity:0.25;margin-bottom:20px;font-family:monospace;">${walletShort} · scan2moon.com</div>

      <!-- Buttons -->
      <div style="display:flex;gap:10px;">
        <button class="badge-save-btn" style="flex:1;padding:11px;background:rgba(44,255,201,0.08);border:1px solid rgba(44,255,201,0.25);border-radius:10px;color:#2cffc9;font-size:13px;font-weight:700;cursor:pointer;">💾 Save Image</button>
        <button class="badge-share-btn" style="flex:1;padding:11px;background:linear-gradient(135deg,rgba(255,180,50,0.15),rgba(255,130,0,0.1));border:1px solid rgba(255,180,50,0.4);border-radius:10px;color:#ffb432;font-size:13px;font-weight:700;cursor:pointer;">𝕏 Share to X</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });

  const card = document.getElementById(`badgeShareCard_${id}`);
  const shareText = `Just earned the "${name}" badge on @Scan2Moon!\n\nTrade smart. Collect badges. Earn S2M.\nhttps://scan2moon.com`; /* UX-05 */

  /* PERF-06: cache the rendered canvas so Save and Share both reuse it */
  let _cachedBadgeCanvas = null;
  async function _renderBadgeCanvas() {
    if (_cachedBadgeCanvas) return _cachedBadgeCanvas;
    _cachedBadgeCanvas = await html2canvas(card, { backgroundColor: "#0d1310", scale: 2, useCORS: true });
    return _cachedBadgeCanvas;
  }

  overlay.querySelector(".badge-save-btn").onclick = async () => {
    try {
      const canvas = await _renderBadgeCanvas();
      const link = document.createElement("a");
      link.download = `Scan2Moon-Badge-${name.replace(/\s+/g,"-")}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch(e) { showToast("⚠️ Could not save image."); }
  };
  overlay.querySelector(".badge-share-btn").onclick = async () => {
    /* PERF-06: share button opens Twitter — no auto-download */
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`, "_blank");
  };
}

function showBadgeToast(imgSrc, name, reward = 1000) {
  let t = document.getElementById("saBadgeToast");
  if (!t) {
    t = document.createElement("div");
    t.id = "saBadgeToast";
    t.style.cssText = "position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:linear-gradient(135deg,rgba(20,10,0,0.97),rgba(40,20,0,0.97));border:2px solid rgba(255,180,50,0.7);border-radius:16px;padding:12px 20px 12px 14px;z-index:9999;box-shadow:0 0 40px rgba(255,170,30,0.4),0 0 0 1px rgba(255,180,50,0.15);transition:opacity 0.4s,transform 0.4s;display:flex;align-items:center;gap:14px;min-width:280px;max-width:90vw;";
    document.body.appendChild(t);
  }
  const rewardLabel = `+${formatSol(reward)}`;
  t.innerHTML = `
    <img src="${imgSrc}" style="width:56px;height:56px;object-fit:contain;mix-blend-mode:multiply;filter:drop-shadow(0 0 8px rgba(255,200,50,0.5));" onerror="this.style.display='none'">
    <div>
      <div style="font-size:10px;font-weight:700;color:#ffb432;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:3px;">◆ BADGE UNLOCKED!</div>
      <div style="font-size:15px;font-weight:800;color:#fff;line-height:1.2;">${name}</div>
      <div style="font-size:12px;color:#ffd770;font-weight:600;margin-top:3px;display:flex;align-items:center;gap:5px;">${rewardLabel} added <img src="${SOL_LOGO}" style="width:16px;height:16px;border-radius:50%;vertical-align:middle;"></div>
    </div>`;
  t.style.opacity = "1";
  t.style.transform = "translateX(-50%) translateY(0)";
  clearTimeout(t._timer);
  t._timer = setTimeout(() => {
    t.style.opacity = "0";
    t.style.transform = "translateX(-50%) translateY(20px)";
  }, 5000);
}

/* ============================================================
   TOAST — UX-02: queue so rapid messages don't overwrite each other
   ============================================================ */
const _toastQueue = [];
let   _toastBusy  = false;

function _drainToastQueue() {
  if (_toastBusy || !_toastQueue.length) return;
  const { msg, isBadge } = _toastQueue.shift();
  _toastBusy = true;
  let t = document.getElementById("saToast");
  if (!t) {
    t = document.createElement("div");
    t.id = "saToast";
    t.style.cssText = "position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:rgba(6,32,26,0.97);border:1px solid rgba(44,255,201,0.4);border-radius:10px;padding:12px 24px;font-size:14px;font-weight:600;color:#cffff4;z-index:9999;box-shadow:0 0 30px rgba(44,255,201,0.2);transition:opacity 0.3s;white-space:nowrap;max-width:90vw;";
    document.body.appendChild(t);
  }
  if (isBadge) {
    t.style.background   = "linear-gradient(135deg,rgba(255,180,50,0.18),rgba(6,32,26,0.97))";
    t.style.borderColor  = "rgba(255,180,50,0.65)";
    t.style.boxShadow    = "0 0 30px rgba(255,180,50,0.35)";
  } else {
    t.style.background   = "rgba(6,32,26,0.97)";
    t.style.borderColor  = "rgba(44,255,201,0.4)";
    t.style.boxShadow    = "0 0 30px rgba(44,255,201,0.2)";
  }
  t.textContent = msg;
  t.style.opacity = "1";
  const duration = isBadge ? 5000 : 3500;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => {
    t.style.opacity = "0";
    setTimeout(() => { _toastBusy = false; _drainToastQueue(); }, 350);
  }, duration);
}

function showToast(msg, isBadge=false) {
  _toastQueue.push({ msg, isBadge });
  _drainToastQueue();
}

/* ============================================================
   FORMAT HELPERS
   ============================================================ */
function formatUsd(v) {
  if (v===null||v===undefined||isNaN(v)) return "$0.00";
  const a=Math.abs(v); let s=a>=1e9?"$"+(a/1e9).toFixed(2)+"B":a>=1e6?"$"+(a/1e6).toFixed(2)+"M":a>=1e3?"$"+(a/1e3).toFixed(2)+"K":a>=0.01?"$"+a.toFixed(2):"$"+a.toFixed(6);
  return v<0?"-"+s:s;
}
function formatPrice(v) {
  if (v == null || isNaN(v) || v <= 0) return "$0"; /* BUG-12: `!v` wrongly blocked valid near-zero prices */
  if (v >= 1)      return "$" + v.toFixed(4);
  if (v >= 0.01)   return "$" + v.toFixed(5);
  if (v >= 0.001)  return "$" + v.toFixed(6);
  // For tiny prices: auto-scale to always show 3 meaningful significant figures
  // e.g. $0.00000158 → 8 decimals, $0.000000027 → 10 decimals
  const mag      = Math.floor(Math.log10(v));   // e.g. 1.58e-6 → mag = -6
  const decimals = Math.min(-mag + 2, 12);       // -(-6)+2 = 8 decimal places
  return "$" + v.toFixed(decimals);
}
function formatAmount(n) {
  if (!n||isNaN(n)) return "0";
  if (n>=1e12) return (n/1e12).toFixed(2)+"T";
  if (n>=1e9)  return (n/1e9).toFixed(2)+"B";
  if (n>=1e6)  return (n/1e6).toFixed(2)+"M";
  if (n>=1e3)  return (n/1e3).toFixed(2)+"K";
  return n.toLocaleString(undefined,{maximumFractionDigits:4});
}

/* i18n handles data-i18n elements automatically on langchange — no manual call needed */
window.addEventListener("langchange", () => { /* i18n system handles this */ });
