/* ============================================================
   Scan2Moon – safe-ape.js  (V2.0 REAL-TIME + CANDLE CHART)

   • CandleChart engine – OHLC candles drawn on Canvas2D
   • Active token polled every 1.5s from DexScreener
   • Portfolio polled every 5s
   • P/L + candle tick every 200ms
   • All trades use freshly-fetched price
   ============================================================ */

import { renderNav }                    from "./nav.js";
import { CandleChart }                  from "./candleChart.js";
import "./community.js";
import { computeRiskScore }             from "./scanSignals.js";
import { callRpc }                      from "./rpc.js";
import { addToWatchlist, isOnWatchlist } from "./watchlist.js";

const DEX_API     = "https://api.dexscreener.com/latest/dex/tokens/";
const SIM_API     = "/.netlify/functions/simulator";
const GECKO_API   = "https://api.geckoterminal.com/api/v2/networks/solana/pools/";
const CHART_PROXY = "/.netlify/functions/chartProxy";

/* ── Pick the best Solana pair for a token ─────────────────────────────
   DexScreener's chart UI shows the pool with the highest 24h volume —
   that is what traders watch and what the OHLCV data should match.
   Sorting by liquidity instead (old behaviour) often picked a different
   AMM pool (e.g. Raydium vs Meteora) whose price action looks totally
   different, making our candles not match DexScreener's chart at all. */
function pickBestPair(pairs) {
  return (pairs || [])
    .filter(p => p.chainId === "solana")
    .sort((a, b) => (b.volume?.h24 ?? 0) - (a.volume?.h24 ?? 0))[0] || null;
}

/* GeckoTerminal timeframe map: tf → { path, agg, limit }
   Limits cover a reasonable lookback for each TF.
   "max" is a special virtual TF: daily candles with max limit for full history. */
const TF_GECKO = {
  "1m":  { path: "minute", agg: 1,  limit: 180 },  /* ~3 h  */
  "5m":  { path: "minute", agg: 5,  limit: 200 },  /* ~16 h */
  "15m": { path: "minute", agg: 15, limit: 200 },  /* ~2 d  */
  "1h":  { path: "hour",   agg: 1,  limit: 200 },  /* ~8 d  */
  "4h":  { path: "hour",   agg: 4,  limit: 250 },  /* ~6 wk */
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
  "1h":  3600000, "4h":  14400000,"1d":  86400000, "max": 86400000,
};

function _storeTick(mint, price, vol1h) {
  if (!_tickBuffer[mint]) _tickBuffer[mint] = [];
  _tickBuffer[mint].push({ ts_ms: Date.now(), price, vol1h });
  if (_tickBuffer[mint].length > TICK_BUFFER_MAX) _tickBuffer[mint].shift();
}

/* Convert stored ticks to OHLCV array [[ts_sec,o,h,l,c,v], …] for a given TF.
   Returns null when fewer than 2 completed candles exist. */
function _buildOhlcvFromTicks(mint, tf) {
  const ticks = _tickBuffer[mint];
  if (!ticks || ticks.length < 3) return null;
  const tfMs    = _TF_MS[tf] || 300000;
  const candles = {};
  for (const { ts_ms, price, vol1h } of ticks) {
    const periodStart = Math.floor(ts_ms / tfMs) * tfMs;
    const ts          = Math.floor(periodStart / 1000); /* seconds — Lightweight Charts format */
    if (!candles[ts]) {
      candles[ts] = [ts, price, price, price, price, 0]; /* [ts,o,h,l,c,v] */
    } else {
      if (price > candles[ts][2]) candles[ts][2] = price; /* high */
      if (price < candles[ts][3]) candles[ts][3] = price; /* low  */
      candles[ts][4] = price;                              /* close */
    }
    candles[ts][5] += vol1h / 2400;
  }
  const sorted = Object.values(candles).sort((a, b) => a[0] - b[0]);
  /* Need at least 2 candles — the last one may be still-forming */
  return sorted.length >= 2 ? sorted : null;
}

/* ── Timers ── */
let tokenPollTimer     = null;
let portfolioPollTimer = null;
let pnlTickTimer       = null;

const TOKEN_POLL_MS = 1500; /* poll DexScreener every 1.5s — max safe rate */

/* ── State ── */
let wallet       = null;
let profile      = null;
let currentToken = null;
let livePrices   = {};   // mint → last VALIDATED price (used for P/L and trades)
let _priceEmas   = {};   // mint → EMA used to filter bad DexScreener REST ticks
let _peakPrices  = {};   // mint → highest validated price seen this session (rug detection)
let _rugTriggered = {};  // mint → true once rug overlay has been shown (no repeat spam)
let candleChart  = null;
let riskScore    = 0;
let currentTab   = "buy";
let currentTf    = "5m";
let solPrice     = 0;       // live SOL/USD price (fetched from Binance)
const SOL_LOGO   = "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png";
/* chartReqId: incremented every time we start a new chart load.
   Each fetch captures its own ID; if it no longer matches when the
   fetch completes it means the user switched TF/token — we discard. */
let chartReqId   = 0;
let tfDebounce   = null;   // debounce timer for TF button rapid-clicks

/* ============================================================
   SOL PRICE  — fetched every 60 s so the balance always shows
   an up-to-date "≈ $X" USD equivalent next to the SOL amount.
   Binance public REST is primary; CoinGecko is the fallback.
   ============================================================ */
async function fetchSolPrice() {
  try {
    const r = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT");
    const d = await r.json();
    const p = parseFloat(d.price);
    if (p > 0) { solPrice = p; updateStaticUI(); return; }
  } catch {}
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd");
    const d = await r.json();
    const p = d?.solana?.usd;
    if (p > 0) { solPrice = p; updateStaticUI(); }
  } catch (e) { console.warn("SOL price fetch failed:", e); }
}

function formatSol(n) {
  if (n === null || n === undefined || isNaN(n)) return "0 SOL";
  const abs = Math.abs(n);
  if (abs === 0)    return "0 SOL";
  if (abs < 0.001)  return n.toFixed(6) + " SOL";
  if (abs < 0.1)    return n.toFixed(4) + " SOL";
  if (abs < 10)     return n.toFixed(3) + " SOL";
  return n.toFixed(2) + " SOL";
}

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener("DOMContentLoaded", () => {
  renderNav();

  const saved = localStorage.getItem("sa_wallet");
  if (saved) { wallet = saved; initSimulator(); }

  document.getElementById("connectWalletBtn").addEventListener("click", connectWallet);
  document.getElementById("disconnectBtn").addEventListener("click", disconnectWallet);
  document.getElementById("saSearchBtn").addEventListener("click", searchToken);
  document.getElementById("saTokenInput").addEventListener("keydown", e => { if (e.key === "Enter") searchToken(); });
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

        const pairAddress = currentToken.pair?.pairAddress;
        let loaded = false;
        if (pairAddress) {
          const liveP = livePrices[currentToken.mint] || parseFloat(currentToken.pair?.priceUsd || "0");
          const ohlcv = await fetchOhlcv(pairAddress, currentTf, liveP);
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
  try {
    const ph = window.solana;
    if (!ph || !ph.isPhantom) {
      // No extension — show mobile/manual fallback
      setupMobileConnect();
      return;
    }
    const resp = await ph.connect();
    wallet = resp.publicKey.toString();
    localStorage.setItem("sa_wallet", wallet);
    await initSimulator();
  } catch { showToast("⚠️ Wallet connection cancelled or failed."); }
  finally { document.getElementById("connectBtnText").textContent = "🔗 Connect Phantom Wallet"; btn.disabled = false; }
}

function disconnectWallet() {
  wallet = null; profile = null;
  stopAllTimers();
  if (candleChart) { candleChart.destroy(); candleChart = null; }
  localStorage.removeItem("sa_wallet");
  document.getElementById("connectGate").style.display  = "block";
  document.getElementById("simulatorApp").style.display = "none";
  try { window.solana?.disconnect(); } catch {}
}

/* ============================================================
   INIT SIMULATOR
   ============================================================ */
async function initSimulator() {
  document.getElementById("connectGate").style.display  = "none";
  document.getElementById("simulatorApp").style.display = "block";

  /* Fetch SOL price before loading profile so the balance can show "$X" */
  await fetchSolPrice();
  setInterval(fetchSolPrice, 60_000); // refresh every 60 s

  try {
    const resp = await fetch(`${SIM_API}?wallet=${wallet}`);
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    profile = data.profile;
    if (data.isNew) showToast("🦍 Welcome! Your account starts with 10 SOL!");
    else showToast(`Welcome back, ${profile.accountName}!`);
  } catch (e) { console.error(e); showToast("⚠️ Could not load profile."); return; }

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
        showToast("✅ Account converted to SOL denomination");
      }
    } catch (e) { console.warn("Migration failed:", e); }
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
  clearInterval(tokenPollTimer);     tokenPollTimer     = null;
  clearInterval(portfolioPollTimer); portfolioPollTimer = null;
  clearInterval(pnlTickTimer);       pnlTickTimer       = null;
}

function stopTokenTimers() {
  clearInterval(tokenPollTimer); tokenPollTimer = null;
}

/* ============================================================
   STATIC UI UPDATE
   ============================================================ */
function updateStaticUI() {
  if (!profile) return;
  const balSol = profile.balance;
  const balUsd = solPrice > 0 ? balSol * solPrice : null;
  const balDisplay = balUsd !== null
    ? `${formatSol(balSol)} ≈ ${formatUsd(balUsd)}`
    : formatSol(balSol);
  document.getElementById("heroBalance").textContent  = balDisplay;
  document.getElementById("tradeBalance").textContent = balDisplay;
  document.getElementById("heroStreak").textContent   = `🔥 Streak: ${profile.loginStreak || 0}`;
  renderPortfolio();
  renderRecentTrades();
}

/* ============================================================
   DAILY REWARD
   ============================================================ */
function checkDailyReward() {
  if (!profile) return;
  if (profile.lastLogin !== new Date().toISOString().slice(0, 10)) {
    document.getElementById("dailyBanner").style.display = "flex";
    const DAILY_REWARDS_SOL = [0.5, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
    const streak = Math.max(1, Math.min(7, (profile.loginStreak || 0) + 1));
    const nextReward = DAILY_REWARDS_SOL[streak];
    const btn = document.getElementById("dailyClaimBtn");
    if (btn) btn.textContent = `Claim +${nextReward.toFixed(2)} SOL`;
  }
}

async function claimDaily() {
  const btn = document.getElementById("dailyClaimBtn");
  btn.disabled = true; btn.textContent = "Claiming…";
  try {
    const resp = await fetch(SIM_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet, action: "daily_login" }) });
    const data = await resp.json();
    profile = data.profile;
    updateStaticUI();
    document.getElementById("dailyBanner").style.display = "none";
    if (data.reward > 0) {
      showDailyRewardCard(data);
    } else {
      showToast(`🎁 ${data.message}`);
    }
    if (data.newBadges && data.newBadges.length) {
      setTimeout(() => showBadgeShareCards(data.newBadges), 1200);
    }
  } catch { showToast("⚠️ Could not claim reward."); }
  finally { btn.disabled = false; }
}

/* ============================================================
   REAL-TIME POLLING — 8s for active token, 20s for portfolio
   ============================================================ */
function startTokenPoll(mint) {
  clearInterval(tokenPollTimer);
  pollActivePair(mint);
  tokenPollTimer = setInterval(() => pollActivePair(mint), TOKEN_POLL_MS);
}

async function pollActivePair(mint) {
  if (!mint) return;
  try {
    const res  = await fetch(`${DEX_API}${mint}`);
    const data = await res.json();
    const pair = pickBestPair(data.pairs);
    if (!pair) return;

    const rawPrice = parseFloat(pair.priceUsd || "0");
    const vol1h    = pair.volume?.h1 || 0;
    if (!rawPrice || rawPrice <= 0) return;

    /* ── Price spike filter ─────────────────────────────────────────────
       DexScreener REST occasionally returns a stale/wrong price for one
       poll cycle. We keep a per-mint EMA and reject any price that deviates
       >35% from it.  This stops truly bad prices from corrupting livePrices
       (which drives P/L display and trade execution).
       Same logic as the chart's tick() filter — both must agree. */
    if (!_priceEmas[mint] || _priceEmas[mint] <= 0) _priceEmas[mint] = rawPrice;
    const _dev  = Math.abs(rawPrice - _priceEmas[mint]) / _priceEmas[mint];
    if (_dev > 0.35) {
      /* Slowly adapt EMA so genuine sustained moves eventually pass */
      _priceEmas[mint] = _priceEmas[mint] * 0.90 + rawPrice * 0.10;
      console.warn(`Rejected bad price for ${mint}: ${rawPrice} (EMA ${_priceEmas[mint].toFixed(8)}, dev ${(_dev*100).toFixed(1)}%)`);
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
      currentToken.pair      = pair;
      // Re-use cached on-chain top10Pct so the live-poll score stays consistent
      const cachedTop10 = currentToken.holderData?.pct ?? 0;
      currentToken.riskScore = calcRiskScore(pair, cachedTop10);
      riskScore              = currentToken.riskScore;
    }

    /* ── Feed tick to candlestick chart ──
       vol1h is the 1-hour USD volume. We want the volume contribution for
       this single 1.5 s poll tick so the live candle accumulates to roughly
       the correct per-candle volume when compared to historical bars.
       Ticks per hour = 3600 / 1.5 = 2400 → divide vol1h by 2400. */
    if (candleChart) {
      candleChart.tick(price, vol1h / 2400);
    }

    updatePriceHeader(pair, price);
    updateRiskPanel(pair);
    updateMarketSignals(pair);
    updateBuyInfo();
    updateSellInfo();
    flashLiveIndicator();

  } catch (e) { console.warn("Token poll failed:", e); }
}

function startPortfolioPoll() {
  clearInterval(portfolioPollTimer);
  pollPortfolioPrices();
  portfolioPollTimer = setInterval(pollPortfolioPrices, 5000);
}

async function pollPortfolioPrices() {
  if (!profile) return;
  const mints = Object.keys(profile.holdings || {}).filter(m => profile.holdings[m].amount > 0);
  if (!mints.length) return;
  for (let i = 0; i < mints.length; i += 25) {
    const slice = mints.slice(i, i + 25);
    try {
      const res  = await fetch(`${DEX_API}${slice.join(",")}`);
      const data = await res.json();
      /* ── Group by mint, keep only the highest-volume pair ────────────
         DexScreener returns ALL pools for a mint. Different pools (e.g.
         Raydium vs Meteora) have different prices, so iterating over all
         of them caused livePrices to flip between pools each poll cycle,
         making the P/L jump up and down. We now pick one pair per mint
         (highest 24h volume, same logic as pickBestPair) before storing. */
      const bestByMint = {};
      for (const p of data.pairs || []) {
        const m = p.baseToken?.address;
        if (!m || p.chainId !== "solana") continue;
        if (!bestByMint[m] || (p.volume?.h24 || 0) > (bestByMint[m].volume?.h24 || 0)) {
          bestByMint[m] = p;
        }
      }
      for (const [m, p] of Object.entries(bestByMint)) {
        const price = parseFloat(p.priceUsd || "0");
        if (price <= 0) continue;
        /* Spike filter */
        if (!_priceEmas[m] || _priceEmas[m] <= 0) { _priceEmas[m] = price; livePrices[m] = price; continue; }
        const dev = Math.abs(price - _priceEmas[m]) / _priceEmas[m];
        if (dev > 0.35) { _priceEmas[m] = _priceEmas[m] * 0.90 + price * 0.10; continue; }
        _priceEmas[m] = _priceEmas[m] * 0.75 + price * 0.25;
        livePrices[m] = price;
      }
    } catch {}
  }
  updatePortfolioPnlCards();
}

function startPnlTick() {
  clearInterval(pnlTickTimer);
  pnlTickTimer = setInterval(() => {
    if (currentToken) {
      const price = livePrices[currentToken.mint];
      if (price) {
        updateLivePnl(price);
        /* Feed price to chart every 200ms — keeps live candle close updated smoothly */
        if (candleChart) candleChart.tick(price, 0);
      }
    }
    /* Always update portfolio P/L cards for all holdings */
    updatePortfolioPnlCards();
  }, 200); /* 200ms = 5 ticks/second — smooth candle + P/L updates */
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
   OHLCV FETCH — DexScreener proxy + GeckoTerminal fired IN PARALLEL

   Both sources are requested at the same time.  We use whichever
   returns valid data first.  This eliminates the sequential "wait 7s
   for chartProxy to fail, then try GeckoTerminal" delay that caused
   chart lag when switching timeframes.

   currentPrice: live DexScreener price — used only to sanity-check
   GeckoTerminal data (wrong pool = >90% divergence). DexScreener proxy
   data is always accepted unconditionally since pairAddress is locked.
   "max" TF: always uses GeckoTerminal 1d/1000 for all-time history.
   ============================================================ */
async function fetchOhlcv(pairAddress, tf, currentPrice = 0) {
  if (!pairAddress) return null;

  /* Helper: sanity-check last candle close vs live price.
     Only used for GeckoTerminal (secondary source) to catch truly wrong pool
     data — e.g. a different AMM whose price diverges by more than 5×.
     DexScreener proxy data is always trusted unconditionally because we pass
     the exact pairAddress from DexScreener's own API, so its candles are
     guaranteed to be the right pool, even during fast +2000% pumps. */
  function geckoOk(ohlcvList) {
    if (!currentPrice || currentPrice <= 0 || !ohlcvList?.length) return true;
    const sorted = [...ohlcvList].sort((a, b) => Number(b[0]) - Number(a[0]));
    const lastClose = parseFloat(sorted[0][4]) || 0;
    if (!lastClose) return true;
    /* 90% tolerance — only rejects data from a completely different pool
       (price differs by more than 10×). Pumping tokens are accepted at any
       intra-day move since the pairAddress is already locked to the right pool. */
    const diff = Math.abs(lastClose - currentPrice) / currentPrice;
    if (diff > 0.90) {
      console.warn(`⚠️ GeckoTerminal pool mismatch: close=${lastClose.toFixed(8)} live=${currentPrice.toFixed(8)} diff=${(diff*100).toFixed(1)}% — rejecting`);
      return false;
    }
    return true;
  }

  const cfg = TF_GECKO[tf] || TF_GECKO["5m"];

  /* ── Fire both sources in parallel ── */
  const proxyPromise = (tf !== "max")
    ? fetch(
        `${CHART_PROXY}?pairAddress=${encodeURIComponent(pairAddress)}&tf=${encodeURIComponent(tf)}`,
        { signal: AbortSignal.timeout(6000) }
      ).then(r => r.ok ? r.json() : null).catch(() => null)
    : Promise.resolve(null);  // MAX TF skips DexScreener (no "max" resolution)

  const geckoPromise = fetch(
    `${GECKO_API}${pairAddress}/ohlcv/${cfg.path}?aggregate=${cfg.agg}&limit=${cfg.limit}&token=base`,
    { headers: { "Accept": "application/json;version=20230302" }, signal: AbortSignal.timeout(8000) }
  ).then(r => r.ok ? r.json() : null).catch(() => null);

  const [proxyData, geckoData] = await Promise.all([proxyPromise, geckoPromise]);

  /* Prefer DexScreener proxy — always trusted, exact pairAddress match */
  if (proxyData?.ohlcv?.length > 3) {
    return proxyData.ohlcv;
  }

  /* Fall back to GeckoTerminal — sanity-checked for wrong-pool only */
  const list = geckoData?.data?.attributes?.ohlcv_list || null;
  if (list?.length > 0 && geckoOk(list)) {
    return list;
  }

  return null;
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

  /* Fetch real OHLCV — DexScreener proxy first, GeckoTerminal fallback */
  const pairAddress = t.pair?.pairAddress;
  let loaded = false;
  if (pairAddress) {
    const liveP = livePrices[t.mint] || parseFloat(t.pair?.priceUsd || "0");
    const ohlcv = await fetchOhlcv(pairAddress, currentTf, liveP);
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
  if (price > 0) candleChart.tick(price, (t.pair.volume?.h1 || 0) / 2400);

  /* Plot B/S markers for any previous trades on this token */
  if (profile?.trades) candleChart.setTradeMarkers(profile.trades, t.mint);
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
    <div class="sa-signal-row"><span class="sa-signal-label">Liquidity</span><span class="sa-signal-val" style="color:${liq>50000?'#2cffc9':liq>10000?'#ffd166':'#ff4d6d'}">${formatUsd(liq)}</span></div>
    <div class="sa-signal-row"><span class="sa-signal-label">24H Volume</span><span class="sa-signal-val">${formatUsd(vol)}</span></div>
    <div class="sa-signal-row"><span class="sa-signal-label">Market Cap</span><span class="sa-signal-val">${formatUsd(mc)}</span></div>
    <div class="sa-signal-row"><span class="sa-signal-label">LP Status</span><span class="sa-signal-val" style="color:${liq>20000?'#2cffc9':'#ffd166'}">${liq>20000?"✅ Likely Locked":"⚠️ Unverified"}</span></div>
    <div class="sa-signal-row"><span class="sa-signal-label">Safe to Ape?</span><span class="sa-signal-val" style="color:${cl}">${score>=65?"✅ Yes, proceed":"⚠️ Use caution"}</span></div>
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
  if      (mScore >= 68 && buyPct >= 58 && liq >= 15000) { oIcon="🚀"; oLabel="STRONG BUY SIGNAL";   oCl="#2cffc9"; oBg="rgba(44,255,201,0.09)"; }
  else if (mScore >= 55 && buyPct >= 50)                  { oIcon="📈"; oLabel="BULLISH";              oCl="#7fffe1"; oBg="rgba(44,255,201,0.05)"; }
  else if (mScore >= 45)                                  { oIcon="➡️"; oLabel="NEUTRAL / SIDEWAYS";   oCl="#ffd166"; oBg="rgba(255,209,102,0.06)"; }
  else if (mScore >= 30)                                  { oIcon="📉"; oLabel="BEARISH";              oCl="#ff9a60"; oBg="rgba(255,100,50,0.06)"; }
  else                                                    { oIcon="🚨"; oLabel="STRONG SELL PRESSURE"; oCl="#ff4d6d"; oBg="rgba(255,77,109,0.09)"; }

  const bpCl  = buyPct >= 60 ? "#2cffc9" : buyPct >= 45 ? "#ffd166" : "#ff4d6d";
  const bpLbl = buyPct >= 60 ? "🔥 High buyers" : buyPct >= 45 ? "⚖️ Balanced" : "🔴 Sellers winning";
  const vCl   = volHourly >= 1.5 ? "#2cffc9" : volHourly >= 0.7 ? "#ffd166" : "#ff4d6d";
  const vLbl  = volHourly >= 1.5 ? "📈 Surging" : volHourly >= 0.7 ? "➡️ Normal" : "📉 Drying up";
  const lCl   = liq >= 30000 ? "#2cffc9" : liq >= 10000 ? "#ffd166" : "#ff4d6d";
  const lLbl  = liq >= 100000 ? "💎 Very Strong" : liq >= 30000 ? "✅ Healthy" : liq >= 10000 ? "⚠️ Moderate" : "🚨 Very Low";
  const nCl   = netPressure > 20 ? "#2cffc9" : netPressure > 0 ? "#7fffe1" : netPressure > -20 ? "#ffd166" : "#ff4d6d";
  const nLbl  = netPressure > 20 ? "🐂 Strong buying" : netPressure > 0 ? "📈 Slight buying" : netPressure > -20 ? "⚖️ Balanced" : "🐻 Strong selling";
  const lmCl  = liqMcRatio >= 10 ? "#2cffc9" : liqMcRatio >= 3 ? "#ffd166" : liqMcRatio > 0 ? "#ff4d6d" : "#777";
  const lmLbl = liqMcRatio >= 10 ? "✅ Safe" : liqMcRatio >= 3 ? "⚠️ Watch" : liqMcRatio > 0 ? "🚨 Risky" : "—";
  const atCl  = avgTxSize >= 1000 ? "#2cffc9" : avgTxSize >= 200 ? "#ffd166" : "#777";
  const atLbl = avgTxSize >= 5000 ? "🐋 Whale moves" : avgTxSize >= 1000 ? "🦈 Large" : avgTxSize >= 200 ? "🐬 Normal" : "🐟 Micro";
  const tsCl  = (pc1h > 0 && pc6h > 0) ? "#2cffc9" : pc1h > 0 ? "#ffd166" : "#ff4d6d";
  const tsLbl = pc1h > 0 && pc6h > 0 ? "✅ Higher highs" : pc1h > 0 && pc6h <= 0 ? "⚡ Recovering" : pc1h <= 0 && pc6h > 0 ? "⚠️ Pullback" : "📉 Downtrend";

  el.innerHTML = `
    <div style="background:${oBg};border:1px solid ${oCl}33;border-radius:10px;padding:10px 12px;margin-bottom:10px;display:flex;align-items:center;gap:10px;">
      <span style="font-size:20px;">${oIcon}</span>
      <div style="flex:1;">
        <div style="font-size:13px;font-weight:800;color:${oCl};">${oLabel}</div>
        <div style="font-size:10px;opacity:0.5;margin-top:2px;">Live · DexScreener · 1.5s refresh</div>
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
        <span>🟢 Buys ${buys1h} (${buyPct.toFixed(1)}%)</span>
        <span>Sells ${sells1h} (${sellPct.toFixed(1)}%) 🔴</span>
      </div>
      <div style="height:10px;border-radius:6px;overflow:hidden;background:rgba(255,255,255,0.06);display:flex;">
        <div style="width:${buyPct}%;background:linear-gradient(90deg,#2cffc9,#7fffe1);transition:width 0.8s;"></div>
        <div style="flex:1;background:linear-gradient(90deg,#ff4d6d,#ff8a8a);"></div>
      </div>
    </div>

    <div class="sa-signal-row"><span class="sa-signal-label">⚡ Momentum</span><span class="sa-signal-val" style="color:${mScore>=60?'#2cffc9':mScore>=45?'#ffd166':'#ff4d6d'}">${mScore>=60?"🚀 Bullish":mScore>=45?"➡️ Neutral":"📉 Bearish"} (${mScore}/100)</span></div>
    <div class="sa-signal-row"><span class="sa-signal-label">🎯 Buy Pressure</span><span class="sa-signal-val" style="color:${bpCl}">${bpLbl}</span></div>
    <div class="sa-signal-row"><span class="sa-signal-label">🔀 Net Pressure</span><span class="sa-signal-val" style="color:${nCl}">${nLbl} (${netPressure>0?"+":""}${netPressure})</span></div>
    <div class="sa-signal-row"><span class="sa-signal-label">📊 Volume Trend</span><span class="sa-signal-val" style="color:${vCl}">${vLbl} · ${formatUsd(vol1h)}/h</span></div>
    <div class="sa-signal-row"><span class="sa-signal-label">📐 Trend Structure</span><span class="sa-signal-val" style="color:${tsCl}">${tsLbl}</span></div>
    <div class="sa-signal-row"><span class="sa-signal-label">💧 Liquidity</span><span class="sa-signal-val" style="color:${lCl}">${lLbl} (${formatUsd(liq)})</span></div>
    <div class="sa-signal-row"><span class="sa-signal-label">🔒 Liq/MC Ratio</span><span class="sa-signal-val" style="color:${lmCl}">${lmLbl} (${liqMcRatio.toFixed(1)}%)</span></div>
    <div class="sa-signal-row"><span class="sa-signal-label">🐋 Avg TX Size</span><span class="sa-signal-val" style="color:${atCl}">${atLbl} · ${formatUsd(avgTxSize)}</span></div>
    <div style="font-size:9px;opacity:0.3;text-align:center;padding-top:8px;border-top:1px solid rgba(44,255,201,0.06);">DexScreener · updates every 8s</div>
  `;
}

/* ============================================================
   RISK SCORE (matches scanSignals.js)
   ============================================================ */

/* Fetch real top-10 holder concentration — same RPC logic as holders.js.
   Returns { pct: number, accounts: array, decimals: number, totalSupply: number }
   on success; returns { pct: 0, accounts: [] } silently on failure so the
   score still renders (just without the on-chain holder penalty). */
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

    return {
      pct:         parseFloat(top10Pct.toFixed(1)),
      accounts:    accountsRes.value,
      decimals,
      totalSupply
    };
  } catch (e) {
    console.warn("Safe Ape: holder fetch failed", e);
    return { pct: 0, accounts: [], decimals: 0, totalSupply: 0 };
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
  const mint = document.getElementById("saTokenInput").value.trim();
  if (!mint) { showToast("Paste a token mint address first!"); return; }
  const btn = document.getElementById("saSearchBtn");
  btn.disabled = true; btn.textContent = "⏳ Scanning…";
  clearTerminal();
  try {
    // Fetch DEX market data and on-chain holder data in parallel for speed
    const [res, holderData] = await Promise.all([
      fetch(`${DEX_API}${mint}`),
      fetchTop10Pct(mint)
    ]);
    const data = await res.json();
    const pair = pickBestPair(data.pairs);
    if (!pair) { showToast("⚠️ No market data found for this token."); return; }
    const price = parseFloat(pair.priceUsd || "0");
    if (price > 0) livePrices[mint] = price;
    riskScore    = calcRiskScore(pair, holderData.pct);
    currentToken = { mint, name: pair.baseToken?.name||"Unknown", symbol: pair.baseToken?.symbol||"?", logo: pair.info?.imageUrl||null, pair, riskScore, holderData };
    document.getElementById("saTerminal").style.display = "block";
    renderTokenHeader(currentToken);
    if (riskScore < 45) showRiskGate(currentToken);
    else                showTradingContent(currentToken);
    startTokenPoll(mint);
  } catch { showToast("⚠️ Failed to load token. Check the mint address."); }
  finally { btn.disabled = false; btn.textContent = "🔍 Analyse Token"; }
};

function clearTerminal() {
  stopTokenTimers();
  if (candleChart) { candleChart.destroy(); candleChart = null; }
  document.getElementById("saTerminal").style.display       = "none";
  document.getElementById("saRiskGate").style.display       = "none";
  document.getElementById("saTradingContent").style.display = "none";
  currentToken = null;
}
window.clearTerminal = clearTerminal;

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
  const t    = currentToken;
  const pair = t.pair;
  const mint = t.mint;

  const liqUsd  = pair?.liquidity?.usd ?? 0;
  const mcapUsd = pair?.fdv ?? pair?.marketCap ?? 0;
  const buys    = pair?.txns?.h24?.buys  ?? 0;
  const sells   = pair?.txns?.h24?.sells ?? 0;
  const vol24   = pair?.volume?.h24 ?? 0;
  const txCount = buys + sells;
  const avgTx   = txCount > 0 ? fmtUsdShort(vol24 / txCount) : "N/A";

  const riskScore = t.riskScore ?? 0;
  const riskLevel = riskScore >= 65 ? "LOW RUG RISK"
                  : riskScore >= 45 ? "MODERATE RISK"
                  : "HIGH RUG RISK";

  const entry = {
    mint,
    name:       t.name   || "Unknown",
    symbol:     t.symbol || "",
    logo:       t.logo   || null,
    totalScore: riskScore,
    riskLevel,
    liquidity:  fmtUsdShort(liqUsd),
    marketCap:  fmtUsdShort(mcapUsd),
    top10:      t.holderData?.pct != null ? t.holderData.pct.toFixed(1) + "%" : "N/A",
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
    btn.textContent = nowOn ? "⭐ Watchlisted" : "☆ Watchlist";
    btn.classList.toggle("sa-wl-active", nowOn);
    btn.style.transform = "scale(0.93)";
    setTimeout(() => { if (btn) btn.style.transform = ""; }, 150);
  }
}

window._saToggleWl = toggleWatchlistFromApe; /* expose for inline onclick */

function renderTokenHeader(t) {
  const logoUrl = t.logo ? `/.netlify/functions/logoProxy?url=${encodeURIComponent(t.logo)}` : "https://placehold.co/52x52";
  document.getElementById("saTokenHeader").innerHTML = `
    <img class="sa-token-logo" src="${logoUrl}" onerror="this.src='https://placehold.co/52x52'" />
    <div style="flex:1;min-width:0;">
      <div class="sa-token-name">${t.name} <span style="opacity:0.5;font-size:14px">(${t.symbol})</span></div>
      <div class="sa-token-symbol">Risk Score: <strong style="color:${t.riskScore>=65?'#2cffc9':t.riskScore>=45?'#ffd166':'#ff4d6d'}">${t.riskScore}/100</strong>
        <span style="font-size:9px;opacity:0.35;font-weight:400;letter-spacing:1px;margin-left:8px;">⬤ LIVE · 1.5s</span>
      </div>
      <div class="sa-token-mint">${t.mint}</div>
    </div>
    <div class="sa-token-header-right">
      <a href="https://dexscreener.com/solana/${t.mint}" target="_blank" rel="noopener noreferrer" class="sa-token-link">📊 DexScreener</a>
      <a href="https://solscan.io/token/${t.mint}" target="_blank" rel="noopener noreferrer" class="sa-token-link">🔎 Solscan</a>
      <a href="risk-scanner.html" onclick="localStorage.setItem('s2m_prefill_mint','${t.mint}')" class="sa-token-link">🛡️ Full Scan</a>
      <button id="saWlBtn" class="sa-token-link sa-wl-btn ${isOnWatchlist(t.mint) ? 'sa-wl-active' : ''}" onclick="window._saToggleWl()">
        ${isOnWatchlist(t.mint) ? "⭐ Watchlisted" : "☆ Watchlist"}
      </button>
    </div>
  `;
}

/* ============================================================
   RISK GATE
   ============================================================ */
function showRiskGate(t) {
  document.getElementById("saRiskGate").style.display       = "block";
  document.getElementById("saTradingContent").style.display = "none";
  document.getElementById("saRiskGateMsg").innerHTML = `
    This token's Scan2Moon Risk Score is <strong style="color:#ff4d6d">${t.riskScore}/100</strong> — below the safe threshold of 45.<br/><br/>
    Liquidity, volume, and market signals suggest elevated risk of price manipulation or rug pull.<br/><br/>
    <strong>This is a training simulation — but make the right decision you'd make with real money.</strong>
  `;
  document.getElementById("saRiskProceedBtn").onclick = () => {
    document.getElementById("saRiskGate").style.display = "none";
    showTradingContent(t);
  };
}

/* ============================================================
   TRADING CONTENT
   ============================================================ */
function showTradingContent(t) {
  document.getElementById("saTradingContent").style.display = "block";
  updateRiskPanel(t.pair);
  updateMarketSignals(t.pair);
  renderHoldersPanel(t);
  renderPriceRow(t.pair);
  updateTradeTab();
  /* Clear any rug overlay/banner from the previous token */
  document.getElementById("saRugOverlay")?.remove();
  document.getElementById("saRugBanner")?.remove();
  /* Reset rug state for the new token so detection starts fresh */
  delete _peakPrices[t.mint];
  delete _rugTriggered[t.mint];
  initChart(t);
}

/* ============================================================
   TOP HOLDERS
   Uses real on-chain data when available (holderData from fetchTop10Pct),
   falls back to estimated distribution for tokens where RPC failed.
   ============================================================ */
function renderHoldersPanel(t) {
  const hd      = t.holderData;
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
    const liq  = t.pair.liquidity?.usd ?? 0;
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
    total       = holders.reduce((a, h) => a + parseFloat(h.pct), 0);
    isEstimated = true;
  }

  const cl = total > 60 ? "#ff4d6d" : total > 40 ? "#ffd166" : "#2cffc9";

  document.getElementById("saHoldersPanel").innerHTML = `
    <div style="display:flex;justify-content:space-between;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid rgba(44,255,201,0.1);">
      <span style="font-size:12px;opacity:0.6;">Top ${holders.length} Concentration</span>
      <span style="font-weight:700;color:${cl}">${typeof total === "number" ? total.toFixed(1) : total}%</span>
    </div>
    ${holders.map((h,i)=>`<div class="sa-holder-row"><span class="sa-holder-rank">#${i+1}</span><span class="sa-holder-addr">${h.addr}</span><span class="sa-holder-pct" style="color:${i<2?cl:'#cffff4'}">${h.pct}%</span></div>`).join("")}
    <div style="font-size:10px;opacity:0.3;margin-top:8px;text-align:center;">${isEstimated ? "Estimated distribution" : "On-chain · Solana RPC"}</div>
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
  if (!h||h.amount<=0) { el.innerHTML=`<div class="sa-no-holding">You don't hold ${currentToken?.symbol||"this token"} yet.</div>`; return; }
  const price     = livePrices[currentToken.mint]||parseFloat(currentToken.pair?.priceUsd||"0");
  const costSol   = h.totalCostSol||0;
  // curValSol uses price ratio — immune to solPrice API errors
  const curValSol = (price>0&&h.avgPrice>0&&costSol>0) ? costSol*(price/h.avgPrice) : costSol;
  const curValUsd = solPrice>0 ? curValSol*solPrice : price*h.amount;
  // P/L = actual SOL value change
  const pnlSol    = curValSol - costSol;
  const pnlPct    = costSol>0?(pnlSol/costSol)*100:0;
  const sign      = pnlSol>=0?"+":"";
  el.innerHTML = `
    <div class="sa-holding-stat"><span class="sa-holding-label">Holdings</span><span class="sa-holding-val">${formatAmount(h.amount)} ${currentToken.symbol}</span></div>
    <div class="sa-holding-stat"><span class="sa-holding-label">Avg Buy Price</span><span class="sa-holding-val">${formatPrice(h.avgPrice)}</span></div>
    <div class="sa-holding-stat"><span class="sa-holding-label">Current Value</span><span class="sa-holding-val" id="saLiveCurrentValue">${formatSol(curValSol)}${solPrice>0?` ≈ ${formatUsd(curValUsd)}`:''}</span></div>
    <div class="sa-holding-stat sa-pnl-live-row">
      <span class="sa-holding-label">Unrealised P/L</span>
      <span class="sa-holding-val sa-holding-pnl ${pnlSol>=0?"pos":"neg"}" id="saLivePnl">${sign}${formatSol(pnlSol)} (${sign}${pnlPct.toFixed(4)}%)</span>
    </div>
  `;
}

function updateLivePnl(price) {
  if (!currentToken||!profile) return;
  const h = profile.holdings?.[currentToken.mint];
  if (!h||h.amount<=0) return;
  const costSol   = h.totalCostSol||0;
  // curValSol uses price ratio — immune to solPrice API errors
  const curValSol = (price>0&&h.avgPrice>0&&costSol>0) ? costSol*(price/h.avgPrice) : costSol;
  const curValUsd = solPrice>0 ? curValSol*solPrice : price*h.amount;
  // P/L = actual SOL value change
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
  for (const [mint,h] of Object.entries(profile.holdings||{})) {
    if (!h||h.amount<=0) continue;
    const price = livePrices[mint]; if (!price) continue;
    const costSol   = h.totalCostSol||0;
    // curValSol uses price ratio — immune to solPrice API errors
    const curValSol = (h.avgPrice>0&&costSol>0) ? costSol*(price/h.avgPrice) : costSol;
    const curValUsd = solPrice>0 ? curValSol*solPrice : price*h.amount;
    // P/L = actual SOL value change
    const pnlSol    = curValSol - costSol;
    const pnlPct    = costSol>0?(pnlSol/costSol)*100:0;
    const sign      = pnlSol>=0?"+":"";
    const pnlEl     = document.getElementById(`sa-atm-pnl-${mint}`);
    const valEl     = document.getElementById(`sa-cur-val-${mint}`);
    if (pnlEl) { pnlEl.textContent=`${sign}${formatSol(pnlSol)} (${sign}${pnlPct.toFixed(4)}%)`; pnlEl.className=`sa-card-atm-pnl ${pnlSol>=0?"pnl-pos":"pnl-neg"}`; }
    if (valEl)   valEl.textContent=`${formatSol(curValSol)}${solPrice>0?` ≈ ${formatUsd(curValUsd)}`:''}`;
  }
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
  const amt         = parseFloat(document.getElementById("sellAmount").value)||0;
  const price       = livePrices[currentToken.mint]||parseFloat(currentToken.pair.priceUsd||"0");
  const slippage    = parseFloat(document.getElementById("slippageSelect").value);
  const receivedUsd = amt*price*(1-slippage);
  const receivedSol = solPrice>0?receivedUsd/solPrice:0;
  document.getElementById("sellInfo").innerHTML = amt>0
    ?`You sell: ${formatAmount(amt)} ${currentToken.symbol}<br/>Receive: ${formatSol(receivedSol)}${solPrice>0?` ≈ ${formatUsd(receivedUsd)}`:''} (${(slippage*100).toFixed(1)}% slip)`
    :"Enter token amount to sell.";
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
  if (amountSol>profile.balance)   { showToast("⚠️ Insufficient SOL balance!"); return; }
  if (!solPrice||solPrice<=0)      { showToast("⚠️ SOL price unavailable. Try again."); return; }
  const btn = document.getElementById("saBuyBtn");
  btn.disabled=true; btn.textContent="⏳ Fetching price…";
  await pollActivePair(currentToken.mint);
  const price = livePrices[currentToken.mint]||0;
  if (!price) { showToast("⚠️ Could not get price. Try again."); btn.disabled=false; btn.textContent="🦍 APE IN (BUY)"; return; }
  const amountUsd = amountSol*solPrice;
  const tokens    = amountUsd/(price*(1+slippage));
  btn.textContent="⏳ Processing…";
  try {
    // Send solAmount so the server deducts exactly what the user requested,
    // regardless of any SOL-price divergence between client and server.
    const resp = await fetch(SIM_API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({wallet,action:"buy",mint:currentToken.mint,symbol:currentToken.symbol,name:currentToken.name,logo:currentToken.logo,priceUsd:price,solAmount:amountSol,slippage,riskScore:currentToken.riskScore,solPrice})});
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    profile = data.profile;
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
    document.getElementById("buyAmount").value=""; updateBuyInfo();
  } catch(e) { showToast("⚠️ Buy failed: "+e.message); }
  finally { btn.disabled=false; btn.textContent="🦍 APE IN (BUY)"; }
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
  if (!price) { showToast("⚠️ Could not get price. Try again."); btn.disabled=false; btn.textContent="🔴 EXIT POSITION (SELL)"; return; }
  btn.textContent="⏳ Processing…";
  try {
    const resp = await fetch(SIM_API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({wallet,action:"sell",mint:currentToken.mint,priceUsd:price,amount:actualAmount,slippage,riskScore:currentToken.riskScore,solPrice})});
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    profile = data.profile;
    updateStaticUI();
    /* Use setTradeMarkers (server timestamps) instead of addTradeMarker
       (Date.now) so the S marker lands on the correct historical candle. */
    if (candleChart) candleChart.setTradeMarkers(profile.trades, currentToken.mint);
    const _receivedUsd = actualAmount*price*(1-slippage);
    const _receivedSol = solPrice>0?_receivedUsd/solPrice:0;
    showToast(`✅ Sold ${formatAmount(actualAmount)} ${currentToken.symbol} — received ${formatSol(_receivedSol)}`);
    showBadgeToasts(data.newBadges);
    showDebrief(data.trade,"sell",currentToken.riskScore);
    document.getElementById("sellAmount").value=""; updateSellInfo(); renderSellHoldingInfo();
  } catch(e) { showToast("⚠️ Sell failed: "+e.message); }
  finally { btn.disabled=false; btn.textContent="🔴 EXIT POSITION (SELL)"; }
};

/* ============================================================
   DEBRIEF
   ============================================================ */
window.closeDebrief = () => { document.getElementById("debriefModal").style.display="none"; };

function showDebrief(trade,type,score) {
  document.getElementById("debriefModal").style.display="flex";
  let html="";
  if (type==="sell") {
    const pnl=trade.pnl; const isWin=pnl>=0; // pnl is in SOL
    const emoji=pnl>0.5?"🚀":pnl>0?"✅":pnl>-0.2?"😬":"💀";
    const verdict=pnl>0.5?"GREAT TRADE!":pnl>0?"PROFITABLE!":pnl>-0.2?"SMALL LOSS":"OUCH — RUG?";
    const lesson=score<45?`⚠️ HIGH RISK token (${score}/100).`:pnl>=0?`✅ Good trade! Score ${score}/100.`:`📉 Loss on ${score>=65?"low":"moderate"}-risk token. Use stop-losses.`;
    const lCls=score<45?"sa-lesson-risk":pnl>=0?"sa-lesson-win":"sa-lesson-loss";
    html=`<div class="sa-debrief-result"><div class="sa-debrief-emoji">${emoji}</div><div class="sa-debrief-verdict" style="color:${isWin?'#2cffc9':'#ff4d6d'}">${verdict}</div><div class="sa-debrief-pnl ${isWin?'win':'loss'}">${pnl>=0?'+':''}${formatSol(pnl)}</div><div style="opacity:0.6;font-size:13px">${pnl>=0?'+':''}${trade.pnlPct}% return</div></div>
    <div class="sa-debrief-stats"><div class="sa-debrief-stat"><div class="sa-debrief-stat-label">Token</div><div class="sa-debrief-stat-val">${trade.symbol}</div></div><div class="sa-debrief-stat"><div class="sa-debrief-stat-label">Risk Score</div><div class="sa-debrief-stat-val" style="color:${score>=65?'#2cffc9':score>=45?'#ffd166':'#ff4d6d'}">${score}/100</div></div><div class="sa-debrief-stat"><div class="sa-debrief-stat-label">Sold at</div><div class="sa-debrief-stat-val">${formatPrice(trade.priceUsd)}</div></div><div class="sa-debrief-stat"><div class="sa-debrief-stat-label">Avg Buy</div><div class="sa-debrief-stat-val">${formatPrice(trade.amount>0?trade.costBasis/trade.amount:0)}</div></div></div>
    <div class="sa-debrief-lesson ${lCls}">💡 <strong>Lesson:</strong> ${lesson}</div>`;
  } else {
    const totalCostSol=trade.totalCostSol||(solPrice>0?trade.totalCost/solPrice:0);
    const lesson=score<45?`🚨 HIGH RISK (${score}/100).`:score>=65?`✅ Smart entry! Set a target and stop-loss.`:`⚠️ Moderate risk (${score}/100). Have an exit plan.`;
    const lCls=score<45?"sa-lesson-risk":score>=65?"sa-lesson-win":"sa-lesson-loss";
    html=`<div class="sa-debrief-result"><div class="sa-debrief-emoji">🦍</div><div class="sa-debrief-verdict" style="color:#ffb432">POSITION OPENED</div><div style="font-size:28px;font-weight:700;color:#ffb432;margin:8px 0">${formatSol(totalCostSol)}</div><div style="opacity:0.6;font-size:13px">invested in ${trade.symbol}</div></div>
    <div class="sa-debrief-stats"><div class="sa-debrief-stat"><div class="sa-debrief-stat-label">Token</div><div class="sa-debrief-stat-val">${trade.symbol}</div></div><div class="sa-debrief-stat"><div class="sa-debrief-stat-label">Risk Score</div><div class="sa-debrief-stat-val" style="color:${score>=65?'#2cffc9':score>=45?'#ffd166':'#ff4d6d'}">${score}/100</div></div><div class="sa-debrief-stat"><div class="sa-debrief-stat-label">Entry Price</div><div class="sa-debrief-stat-val">${formatPrice(trade.priceUsd)}</div></div><div class="sa-debrief-stat"><div class="sa-debrief-stat-label">Tokens</div><div class="sa-debrief-stat-val">${formatAmount(trade.amount)}</div></div></div>
    <div class="sa-debrief-lesson ${lCls}">💡 <strong>Lesson:</strong> ${lesson}</div>`;
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
function renderPortfolio() {
  const body=document.getElementById("saPortfolioBody");
  const holdings=profile?.holdings||{};
  const keys=Object.keys(holdings).filter(k=>holdings[k].amount>0);
  if (!keys.length) {
    body.innerHTML=`<div class="sa-empty-portfolio"><div style="font-size:36px;margin-bottom:10px;">🦍</div><div style="color:#7fffe1;font-weight:600;margin-bottom:6px;">No positions yet</div><div style="opacity:0.5;font-size:13px;">Search a token above and make your first simulated trade!</div></div>`;
    return;
  }
  body.innerHTML=`<div class="sa-portfolio-grid">${keys.map(mint=>{
    const h=holdings[mint];
    const logo=h.logo?`/.netlify/functions/logoProxy?url=${encodeURIComponent(h.logo)}`:"https://placehold.co/36x36";
    const price=livePrices[mint]||0;
    const costSol=h.totalCostSol||0;
    // curValSol uses price ratio — immune to solPrice API errors
    const curValSol=(price>0&&h.avgPrice>0&&costSol>0)?costSol*(price/h.avgPrice):null;
    const curValUsd=curValSol!==null&&solPrice>0?curValSol*solPrice:(price>0?price*h.amount:null);
    // P/L = actual SOL value change
    const pnlSol=curValSol!==null?curValSol-costSol:null;
    const pnlPct=pnlSol!==null&&costSol>0?(pnlSol/costSol)*100:null;
    const sign=pnlSol!==null?(pnlSol>=0?"+":""):"";
    const pnlCls=pnlSol!==null?(pnlSol>=0?"pnl-pos":"pnl-neg"):"";
    return `<div class="sa-holding-card" onclick="document.getElementById('saTokenInput').value='${mint}';window.searchToken()">
      <div class="sa-holding-card-top"><img class="sa-holding-logo" src="${logo}" onerror="this.src='https://placehold.co/36x36'" /><div><div class="sa-holding-name">${h.name}</div><div class="sa-holding-symbol">${h.symbol}</div></div></div>
      <div class="sa-holding-card-stats">
        <div class="sa-holding-card-stat"><div class="sa-holding-card-stat-label">Current Value</div><div class="sa-holding-card-stat-val" id="sa-cur-val-${mint}">${curValSol!==null?formatSol(curValSol):formatSol(costSol)}</div></div>
        <div class="sa-holding-card-stat"><div class="sa-holding-card-stat-label">Cost Basis</div><div class="sa-holding-card-stat-val">${formatSol(costSol)}</div></div>
        <div class="sa-holding-card-stat"><div class="sa-holding-card-stat-label">ATM P/L ${price>0?"🔴 LIVE":""}</div><div class="sa-card-atm-pnl ${pnlCls}" id="sa-atm-pnl-${mint}">${pnlSol!==null?`${sign}${formatSol(pnlSol)} (${sign}${pnlPct.toFixed(4)}%)`:"Loading…"}</div></div>
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
  if (!trades.length) { body.innerHTML=`<div style="text-align:center;opacity:0.5;padding:30px;">No trades yet!</div>`; return; }
  body.innerHTML=trades.map(t=>{
    const isBuy=t.type==="buy";
    const logo=t.logo?`/.netlify/functions/logoProxy?url=${encodeURIComponent(t.logo)}`:"https://placehold.co/28x28";
    const amountSol=isBuy
      ?(t.totalCostSol||(solPrice>0?t.totalCost/solPrice:null))
      :(t.totalReceivedSol||(solPrice>0?t.totalReceived/solPrice:null));
    const amountFmt=amountSol!==null?formatSol(amountSol):(isBuy?formatUsd(t.totalCost):formatUsd(t.totalReceived));
    const pnlHtml=!isBuy&&t.pnl!==undefined?`<span style="color:${t.pnl>=0?'#2cffc9':'#ff4d6d'};font-weight:700">${t.pnl>=0?'+':''}${formatSol(t.pnl)}</span>`:`<span style="opacity:0.45">—</span>`;
    return `<div class="sa-trade-row"><div><span class="sa-trade-type-badge ${isBuy?'sa-trade-buy':'sa-trade-sell'}">${isBuy?'BUY':'SELL'}</span></div><div class="sa-trade-token-cell"><img class="sa-trade-token-logo" src="${logo}" onerror="this.src='https://placehold.co/28x28'" /><div><div class="sa-trade-token-name">${t.name||t.symbol}</div><div class="sa-trade-token-symbol">${t.symbol}</div></div></div><div>${amountFmt}</div><div class="sa-trade-pnl">${pnlHtml}</div><div class="sa-trade-time">${new Date(t.timestamp).toLocaleString()}</div></div>`;
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
  const streakDisplay = isFirstEver ? "Welcome!" : `Day ${streak} Streak 🔥`;
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
      <div style="font-size:9px;color:${done ? '#ffb432' : 'rgba(255,180,50,0.3)'};font-weight:700;">${DAILY_REWARDS_SOL[i]} SOL</div>
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
      <div style="font-size:38px;margin-bottom:4px;">🎁</div>
      <div style="font-size:15px;font-weight:700;color:#ffb432;margin-bottom:20px;">${streakDisplay}</div>

      <!-- Big reward number -->
      <div style="background:rgba(255,180,50,0.08);border:1px solid rgba(255,180,50,0.2);border-radius:16px;padding:20px;margin-bottom:22px;">
        <div style="font-size:13px;opacity:0.5;margin-bottom:6px;letter-spacing:1px;">REWARD EARNED</div>
        <div style="font-size:52px;font-weight:900;color:#ffb432;line-height:1;letter-spacing:-2px;">+${rewardFmt}</div>
        <div style="display:flex;align-items:center;justify-content:center;gap:6px;margin-top:6px;font-size:13px;color:#ffd770;font-weight:600;">
          SOL <img src="${SOL_LOGO}" style="width:18px;height:18px;border-radius:50%;vertical-align:middle;">
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
  const shareText = `🎁 Day ${streak} Streak! Just claimed ${rewardFmt} on @Scan2Moon Safe Ape Simulator!\n\nTrade smarter. Earn daily. 🌙\nhttps://scan2moon.com`;

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
      <div style="font-size:10px;font-weight:700;letter-spacing:2px;color:rgba(255,180,50,0.5);text-transform:uppercase;margin-bottom:6px;">🎖️ Badge Unlocked!</div>
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
  const shareText = `🎖️ Just earned the "${name}" badge on @Scan2Moon!\n\nTrade smart. Collect badges. Earn SOL. 🌙\nhttps://scan2moon.com`;

  overlay.querySelector(".badge-save-btn").onclick = async () => {
    try {
      const canvas = await html2canvas(card, { backgroundColor: "#0d1310", scale: 2, useCORS: true });
      const link = document.createElement("a");
      link.download = `Scan2Moon-Badge-${name.replace(/\s+/g,"-")}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch(e) { showToast("⚠️ Could not save image."); }
  };
  overlay.querySelector(".badge-share-btn").onclick = async () => {
    try {
      const canvas = await html2canvas(card, { backgroundColor: "#0d1310", scale: 2, useCORS: true });
      const link = document.createElement("a");
      link.download = `Scan2Moon-Badge-${name.replace(/\s+/g,"-")}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch(e) {}
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
      <div style="font-size:10px;font-weight:700;color:#ffb432;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:3px;">🎖️ Badge Unlocked!</div>
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
   TOAST
   ============================================================ */
function showToast(msg, isBadge=false) {
  let t=document.getElementById("saToast");
  if (!t) { t=document.createElement("div"); t.id="saToast"; t.style.cssText="position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:rgba(6,32,26,0.97);border:1px solid rgba(44,255,201,0.4);border-radius:10px;padding:12px 24px;font-size:14px;font-weight:600;color:#cffff4;z-index:9999;box-shadow:0 0 30px rgba(44,255,201,0.2);transition:opacity 0.3s;white-space:nowrap;max-width:90vw;"; document.body.appendChild(t); }
  if (isBadge) {
    t.style.background="linear-gradient(135deg,rgba(255,180,50,0.18),rgba(6,32,26,0.97))";
    t.style.borderColor="rgba(255,180,50,0.65)";
    t.style.boxShadow="0 0 30px rgba(255,180,50,0.35)";
  } else {
    t.style.background="rgba(6,32,26,0.97)";
    t.style.borderColor="rgba(44,255,201,0.4)";
    t.style.boxShadow="0 0 30px rgba(44,255,201,0.2)";
  }
  t.textContent=msg; t.style.opacity="1";
  clearTimeout(t._timer); t._timer=setTimeout(()=>{t.style.opacity="0";},isBadge?5000:3500);
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
  if (!v||isNaN(v)) return "$0";
  if (v<0.000001) return "$"+v.toFixed(10);
  if (v<0.001)    return "$"+v.toFixed(7);
  if (v<1)        return "$"+v.toFixed(5);
  return "$"+v.toFixed(4);
}
function formatAmount(n) {
  if (!n||isNaN(n)) return "0";
  if (n>=1e12) return (n/1e12).toFixed(2)+"T";
  if (n>=1e9)  return (n/1e9).toFixed(2)+"B";
  if (n>=1e6)  return (n/1e6).toFixed(2)+"M";
  if (n>=1e3)  return (n/1e3).toFixed(2)+"K";
  return n.toLocaleString(undefined,{maximumFractionDigits:4});
}