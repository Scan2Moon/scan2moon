// netlify/functions/simulator.js
// Safe Ape Simulator — CommonJS format
// Balance denomination: SOL (not USD).  All trade costs / P&L are in SOL.

const STARTING_BALANCE_SOL = 10; // every new wallet starts with 10 SOL
const https = require("https");

/* ── Server-side price validation ──────────────────────────────────
   Fetches the real current price from DexScreener for a given mint.
   Returns the best Solana pair price, or null if unavailable.
   This prevents clients from submitting manipulated priceUsd values. */
async function fetchRealPrice(mint) {
  return new Promise((resolve) => {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${mint}`;
    const req = https.get(url, { timeout: 4000 }, (res) => {
      let data = "";
      res.on("data", chunk => { data += chunk; });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          const pairs = (json.pairs || []).filter(p => p.chainId === "solana");
          if (!pairs.length) return resolve(null);
          const pair = pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
          const price = parseFloat(pair.priceUsd || "0");
          resolve(price > 0 ? price : null);
        } catch { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

/* ── Server-side SOL/USD price (Binance) ───────────────────────────────
   Always fetched server-side for every buy/sell — runs in parallel with
   the DexScreener token-price call so it adds zero extra latency.
   Using only the server price prevents clients from submitting a
   manipulated solPrice to inflate their SOL balance.
   Defaults to 150 on any failure so trades never hard-break. */
async function fetchSolPriceServer() {
  return new Promise((resolve) => {
    const url = "https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT";
    const req = https.get(url, { timeout: 3000 }, (res) => {
      let data = "";
      res.on("data", c => { data += c; });
      res.on("end", () => {
        try {
          const p = parseFloat(JSON.parse(data).price);
          resolve(p > 0 ? p : 150);
        } catch { resolve(150); }
      });
    });
    req.on("error",   () => resolve(150));
    req.on("timeout", () => { req.destroy(); resolve(150); });
  });
}

/* Price tolerance: submitted price must be within ±25% of real price.
   25% allows for slippage and any slight lag between client and server. */
const PRICE_TOLERANCE = 0.25;

// Day-based login rewards — values in SOL.
// Index 1–7 = streak day rewards. Day 1 starts at 0.1, caps at Day 7 = 0.7 SOL.
const DAILY_REWARDS_SOL = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
function getDailyReward(streak) {
  const day = Math.max(1, Math.min(7, streak));
  return DAILY_REWARDS_SOL[day];
}
// Welcome gift — claimed once per wallet from the APE Profile page.
const WELCOME_GIFT_SOL = 0.5;

// File-based fallback for local dev only.
// On live Netlify we always use Blobs (see getStore below).
const fs   = require("fs");
const path = require("path");
const LOCAL_DB_PATH = path.join("/tmp", "sim-local-store.json");

function _readDb() {
  try { return JSON.parse(fs.readFileSync(LOCAL_DB_PATH, "utf8")); }
  catch { return {}; }
}
function _writeDb(data) {
  try {
    fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify(data), "utf8");
  } catch(e) { console.warn("_writeDb error:", e.message); }
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

async function getStore() {
  const isProduction = !!process.env.NETLIFY_BLOBS_CONTEXT;
  try {
    const { getStore } = require("@netlify/blobs");
    const store = getStore("simulator");
    return {
      // consistency:"strong" ensures we always read the latest write,
      // even if the previous Lambda invocation just wrote it milliseconds ago.
      async get(key) {
        try {
          const v = await store.get(key, { consistency: "strong" });
          console.log("Blobs GET", key.slice(0,8), "→", v ? "found" : "null");
          return v;
        } catch(e) {
          console.error("Blobs GET failed:", key.slice(0,8), e.message);
          throw e; // propagate so caller can return 500
        }
      },
      async set(key, val) {
        try {
          await store.set(key, val);
          console.log("Blobs SET", key.slice(0,8), "→ OK");
        } catch(e) {
          console.error("Blobs SET failed:", key.slice(0,8), e.message);
          throw e; // propagate so caller can return 500
        }
      }
    };
  } catch(e) {
    if (isProduction) {
      // In production, Blobs MUST be available. Falling back to /tmp would
      // silently corrupt or reset user profiles because /tmp is ephemeral
      // per Lambda invocation. Throw so the caller returns a 500 instead.
      console.error("FATAL: @netlify/blobs unavailable in production:", e.message);
      throw new Error("Storage unavailable — please retry.");
    }
    // Local dev only — /tmp is fine as a scratch store
    console.warn("@netlify/blobs not available, using /tmp file store (local dev only):", e.message);
    return {
      async get(key) { return _readDb()[key] || null; },
      async set(key, val) { const db = _readDb(); db[key] = val; _writeDb(db); }
    };
  }
}

// ── Badge computation & rewards — values in SOL ──
const BADGE_REWARD_AMOUNT = 0.1;   // default per-badge reward (SOL)
const BADGE_REWARD_OVERRIDES = {
  wins_50:              0.5,
  wins_100:             1.0,
  wins_500:             2.0,
  wins_1000:            5.0,
  sol2moon_millionaire: 500.0,
};

function _bStreak(sells, n) {
  let s = 0;
  for (const t of sells) {
    if ((t.pnl || 0) > 0) { s++; if (s >= n) return true; } else s = 0;
  }
  return false;
}
function _bDiamond(trades) {
  const buys  = trades.filter(t => t.type === "buy");
  const sells = trades.filter(t => t.type === "sell");
  for (const b of buys) {
    const s = sells.find(s => s.mint === b.mint && new Date(s.timestamp) > new Date(b.timestamp));
    if (s && (new Date(s.timestamp) - new Date(b.timestamp)) / 86400000 >= 7) return true;
  }
  return false;
}
/* Safe Trader: at least 10 individual buy trades where entry riskScore >= 65 */
function _bSafeTrader(trades) {
  const qualifying = trades.filter(
    t => t.type === "buy" && t.riskScore != null && Number(t.riskScore) >= 65
  );
  return qualifying.length >= 10;
}
/* Degen Survivor: at least 10 profitable sells on tokens with riskScore < 45,
   counting strictly 1 sell per buy — no replaying the same buy multiple times. */
function _bDegenSurvivor(trades) {
  const buys  = [...trades.filter(t => t.type === "buy")]
                  .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const sells = [...trades.filter(t => t.type === "sell")]
                  .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const usedSellIdx = new Set();
  let count = 0;
  for (const buy of buys) {
    const idx = sells.findIndex((s, i) =>
      !usedSellIdx.has(i) &&
      s.mint === buy.mint &&
      new Date(s.timestamp) > new Date(buy.timestamp) &&
      (s.pnl || 0) > 0 &&
      s.riskScore != null && Number(s.riskScore) < 45
    );
    if (idx !== -1) { usedSellIdx.add(idx); count++; }
  }
  return count >= 10;
}
function computeBadges(profile) {
  const badges   = [];
  const trades   = profile.trades   || [];
  const sells    = trades.filter(t => t.type === "sell");
  const winCount = profile.winCount || 0;
  if (sells.some(t => (t.pnl || 0) > 0))        badges.push("first_profit");
  if (_bStreak(sells, 5))                         badges.push("win_streak_5");
  if (_bSafeTrader(trades))                       badges.push("safe_trader");
  if (_bDiamond(trades))                          badges.push("diamond_hands");
  if (_bDegenSurvivor(trades))                    badges.push("degen_survivor");
  /* portfolio_100: 2× starting (20 SOL = 100% growth) | sol2moon_millionaire: 10,000 SOL */
  if ((profile.balance || 0) >= 20)              badges.push("portfolio_100");
  if (winCount >= 25)   badges.push("wins_25");
  if (winCount >= 50)   badges.push("wins_50");
  if (winCount >= 100)  badges.push("wins_100");
  if (winCount >= 500)  badges.push("wins_500");
  if (winCount >= 1000)                          badges.push("wins_1000");
  if ((profile.balance || 0) >= 10000)           badges.push("sol2moon_millionaire");
  return badges;
}
function awardNewBadges(profile) {
  const prev    = profile.badges || [];
  const current = computeBadges(profile);
  const newly   = current.filter(b => !prev.includes(b));
  if (newly.length > 0) {
    const rewardTotal = newly.reduce((s, b) => s + (BADGE_REWARD_OVERRIDES[b] || BADGE_REWARD_AMOUNT), 0);
    profile.balance += rewardTotal;
  }
  profile.badges = current;
  return newly;
}

// ── Leaderboard index helpers ──
// Keeps a JSON array at key "__lb_index__" with all wallet addresses.
// This avoids needing store.list() which fails in local dev.
async function getIndex(store) {
  try {
    const raw = await store.get("__lb_index__");
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

async function registerInLeaderboard(store, wallet) {
  try {
    const index = await getIndex(store);
    if (!index.includes(wallet)) {
      index.push(wallet);
      await store.set("__lb_index__", JSON.stringify(index));
    }
  } catch(e) {
    console.warn("Could not update leaderboard index:", e.message);
  }
}

exports.handler = async function(event, context) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  let store;
  try {
    store = await getStore();
  } catch(storeErr) {
    console.error("getStore() failed:", storeErr.message);
    return { statusCode: 503, headers, body: JSON.stringify({ error: storeErr.message || "Storage unavailable" }) };
  }

  // ── GET: load user profile ──
  if (event.httpMethod === "GET") {
    const wallet = event.queryStringParameters && event.queryStringParameters.wallet;
    if (!wallet) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing wallet" }) };
    }

    try {
      const raw = await store.get(wallet);
      if (!raw) {
        // No profile found. DO NOT save here — if Blobs has a momentary
        // null-return glitch, saving now would overwrite the real profile
        // with a fresh 10-SOL one and wipe all history. The profile is
        // created (and persisted) on the first real action (daily_login,
        // buy, sell, etc.) in the POST handler below.
        const profile = {
          wallet,
          accountName: "Ape #" + wallet.slice(0, 4).toUpperCase(),
          createdAt:   new Date().toISOString(),
          balance:         STARTING_BALANCE_SOL,
          balanceCurrency: "sol",
          holdings:    {},
          trades:      [],
          totalPnL:    0,
          winCount:    0,
          lossCount:   0,
          lastLogin:   null,
          loginStreak: 0,
        };
        return { statusCode: 200, headers, body: JSON.stringify({ profile, isNew: true }) };
      }
      // Existing profile — ensure it is registered in leaderboard (catches old profiles)
      await registerInLeaderboard(store, wallet);
      return { statusCode: 200, headers, body: JSON.stringify({ profile: JSON.parse(raw), isNew: false }) };
    } catch (e) {
      console.error("GET error:", e);
      return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
    }
  }

  // ── POST: actions ──
  if (event.httpMethod === "POST") {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch(e) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Bad JSON body" }) };
    }

    const wallet = body.wallet;
    const action = body.action;

    if (!wallet || !action) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing wallet or action" }) };
    }

    // Load profile — with one retry to guard against momentary Blobs null-returns.
    // If the first read returns null but the wallet has an existing profile in
    // Blobs, a second read 400ms later will find it. Only create a fresh profile
    // if both reads return null (genuinely new wallet).
    let profile;
    try {
      let raw = await store.get(wallet);
      if (!raw) {
        // First read returned null — wait briefly and retry once before
        // assuming this is a brand-new wallet.
        await new Promise(r => setTimeout(r, 400));
        raw = await store.get(wallet);
      }
      if (!raw) {
        profile = {
          wallet,
          accountName: "Ape #" + wallet.slice(0, 4).toUpperCase(),
          createdAt:   new Date().toISOString(),
          balance:         STARTING_BALANCE_SOL,
          balanceCurrency: "sol",
          holdings:    {},
          trades:      [],
          totalPnL:    0,
          winCount:    0,
          lossCount:   0,
          lastLogin:   null,
          loginStreak: 0,
        };
      } else {
        profile = JSON.parse(raw);
      }
    } catch (e) {
      console.error("Profile load error:", e);
      return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
    }

    // ── DAILY LOGIN ──
    if (action === "daily_login") {
      const today     = todayStr();
      const lastLogin = profile.lastLogin || null;
      if (lastLogin === today) {
        return { statusCode: 200, headers, body: JSON.stringify({ profile, reward: 0, message: "Already claimed today" }) };
      }

      let streak = profile.loginStreak || 0;
      if (lastLogin) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().slice(0, 10);
        streak = lastLogin === yesterdayStr ? Math.min(7, streak + 1) : 1;
      } else {
        streak = 1; // first-ever login counts as Day 1
      }

      const reward = getDailyReward(streak);
      profile.balance     += reward;
      profile.lastLogin    = today;
      profile.loginStreak  = streak;

      const dayLabel = `Day ${streak}`;
      const newBadgesLogin = awardNewBadges(profile);
      await store.set(wallet, JSON.stringify(profile));
      await registerInLeaderboard(store, wallet);
      return { statusCode: 200, headers, body: JSON.stringify({
        profile,
        reward,
        streak,
        dayLabel,
        isFirstEver: false,
        message: `${dayLabel} — +${reward.toFixed(3)} SOL claimed!`,
        newBadges: newBadgesLogin
      })};
    }

    // ── WELCOME GIFT ──
    if (action === "welcome_gift") {
      if (profile.welcomeGiftClaimed) {
        return { statusCode: 200, headers, body: JSON.stringify({ profile, reward: 0, message: "Welcome gift already claimed" }) };
      }
      profile.balance            += WELCOME_GIFT_SOL;
      profile.welcomeGiftClaimed  = true;
      const newBadgesWelcome = awardNewBadges(profile);
      await store.set(wallet, JSON.stringify(profile));
      await registerInLeaderboard(store, wallet);
      return { statusCode: 200, headers, body: JSON.stringify({
        profile,
        reward: WELCOME_GIFT_SOL,
        message: `🎁 Welcome gift claimed! +${WELCOME_GIFT_SOL} SOL added to your balance.`,
        newBadges: newBadgesWelcome
      })};
    }

    // ── BUY ──
    if (action === "buy") {
      const { mint, symbol, name, logo, priceUsd, amount, slippage, riskScore,
              solAmount: clientSolAmount, solPrice: clientSolPrice } = body;
      if (!mint || !priceUsd) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing trade data" }) };
      }

      // ── Input sanity checks ──
      const parsedPrice  = parseFloat(priceUsd);
      if (!isFinite(parsedPrice) || parsedPrice <= 0) return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid price" }) };

      // ── Server-side price validation (token + SOL price fetched in parallel) ──
      const [realPrice, solPriceForTrade] = await Promise.all([
        fetchRealPrice(mint),
        fetchSolPriceServer(),
      ]);
      if (realPrice !== null) {
        const deviation = Math.abs(parsedPrice - realPrice) / realPrice;
        if (deviation > PRICE_TOLERANCE) {
          console.warn(`BUY price rejected: submitted=${parsedPrice}, real=${realPrice}, dev=${(deviation*100).toFixed(1)}%`);
          return { statusCode: 400, headers, body: JSON.stringify({ error: `Price mismatch — submitted $${parsedPrice.toFixed(8)} vs market $${realPrice.toFixed(8)}. Refresh and try again.` }) };
        }
      }

      const slip           = Math.min(Math.abs(slippage || 0.01), 0.05);
      const effectivePrice = parsedPrice * (1 + slip);

      // ── Prefer solAmount (desired SOL spend) over token-count amount ──
      // When the client sends solAmount, the server uses its own SOL price to
      // calculate the token count and deducts exactly solAmount from the balance.
      // This prevents SOL-price divergence between client and server.
      let totalCostSol, parsedAmount;
      const desiredSol = parseFloat(clientSolAmount || 0);
      if (desiredSol > 0) {
        totalCostSol  = desiredSol;
        const totalCostUsdCalc = desiredSol * solPriceForTrade;
        parsedAmount  = totalCostUsdCalc / effectivePrice;
      } else {
        parsedAmount  = parseFloat(amount || 0);
        if (!isFinite(parsedAmount) || parsedAmount <= 0) return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid amount" }) };
        const totalCostUsdCalc = effectivePrice * parsedAmount;
        totalCostSol  = totalCostUsdCalc / solPriceForTrade;
      }
      const totalCostUsd = effectivePrice * parsedAmount;

      if (totalCostSol > profile.balance) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Insufficient SOL balance" }) };
      }

      profile.balance -= totalCostSol;

      if (!profile.holdings[mint]) {
        profile.holdings[mint] = {
          mint, symbol, name, logo,
          amount: 0, avgPrice: 0,
          totalCostUsd: 0, totalCostSol: 0,
          totalCost: 0,    // backward-compat alias → same as totalCostUsd
          avgCostSol: 0,
          riskScore: riskScore || null,
        };
      }
      const h = profile.holdings[mint];
      h.amount        += parsedAmount;
      h.totalCostUsd   = (h.totalCostUsd || h.totalCost || 0) + totalCostUsd;
      h.totalCostSol   = (h.totalCostSol || 0) + totalCostSol;
      h.totalCost      = h.totalCostUsd;       // keep backward compat
      h.avgPrice       = h.totalCostUsd / h.amount;   // USD/token (entry price display)
      h.avgCostSol     = h.totalCostSol / h.amount;  // SOL/token (P&L basis)
      if (riskScore != null) h.riskScore = riskScore;

      const trade = {
        id: Date.now(), type: "buy",
        mint, symbol, name, logo,
        amount: parsedAmount, priceUsd: effectivePrice,
        totalCostUsd, totalCostSol,
        totalCost: totalCostUsd,     // backward compat
        solPriceAtTrade: solPriceForTrade,
        slippage: slip, riskScore: riskScore || null,
        timestamp: new Date().toISOString(),
      };
      profile.trades.unshift(trade);
      if (profile.trades.length > 200) profile.trades = profile.trades.slice(0, 200);

      const newBadgesBuy = awardNewBadges(profile);
      await store.set(wallet, JSON.stringify(profile));
      await registerInLeaderboard(store, wallet);
      return { statusCode: 200, headers, body: JSON.stringify({ profile, trade, newBadges: newBadgesBuy }) };
    }

    // ── SELL ──
    if (action === "sell") {
      const { mint, priceUsd, amount, slippage, riskScore,
              solPrice: clientSolPrice } = body;
      if (!mint || !priceUsd || !amount) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing trade data" }) };
      }

      // ── Input sanity checks ──
      const parsedSellPrice  = parseFloat(priceUsd);
      const parsedSellAmount = parseFloat(amount);
      if (!isFinite(parsedSellPrice)  || parsedSellPrice  <= 0) return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid price" }) };
      if (!isFinite(parsedSellAmount) || parsedSellAmount <= 0) return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid amount" }) };

      // ── Server-side price validation (token + SOL price fetched in parallel) ──
      const [realSellPrice, solPriceForTrade] = await Promise.all([
        fetchRealPrice(mint),
        fetchSolPriceServer(),
      ]);
      if (realSellPrice !== null) {
        // For sells: only reject if the submitted price is HIGHER than the real price
        // (that would inflate the user's SOL received — actual cheating).
        // If submitted price is lower (user selling at a discount during a spike / EMA lag),
        // always allow it — the user simply gets less SOL, which is conservative and fair.
        if (parsedSellPrice > realSellPrice * (1 + PRICE_TOLERANCE)) {
          console.warn(`SELL price rejected (too high): submitted=${parsedSellPrice}, real=${realSellPrice}, dev=${(((parsedSellPrice-realSellPrice)/realSellPrice)*100).toFixed(1)}%`);
          return { statusCode: 400, headers, body: JSON.stringify({ error: `Sell price too high — submitted $${parsedSellPrice.toFixed(8)} vs market $${realSellPrice.toFixed(8)}. Refresh and try again.` }) };
        }
      }
      // solPriceForTrade is always the server-fetched price — never trust clientSolPrice
      // to avoid balance manipulation via fake SOL/USD rate.

      const holding = profile.holdings && profile.holdings[mint];
      if (!holding || holding.amount < parsedSellAmount) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Insufficient token balance" }) };
      }

      const slip             = Math.min(Math.abs(slippage || 0.01), 0.05);
      const effectivePrice   = parsedSellPrice * (1 - slip);
      const totalReceivedUsd = effectivePrice * parsedSellAmount;
      const totalReceivedSol = totalReceivedUsd / solPriceForTrade;   // ← SOL received

      // Cost basis in SOL — use avgCostSol when available (set by new buy logic);
      // fall back to an estimate from USD avgPrice for migrated/legacy holdings.
      const avgCostSolEst = holding.avgCostSol || (holding.avgPrice / solPriceForTrade);
      const costBasisSol  = avgCostSolEst * parsedSellAmount;
      const pnlSol        = totalReceivedSol - costBasisSol;  // P&L in SOL

      profile.balance  += totalReceivedSol;
      profile.totalPnL  = (profile.totalPnL || 0) + pnlSol;
      if (pnlSol >= 0) profile.winCount  = (profile.winCount  || 0) + 1;
      else             profile.lossCount = (profile.lossCount || 0) + 1;

      // Reduce holding cost tracking
      const soldUsdCost      = (holding.avgPrice || 0) * parsedSellAmount;
      holding.amount        -= parsedSellAmount;
      holding.totalCostSol   = Math.max(0, (holding.totalCostSol || 0) - costBasisSol);
      holding.totalCostUsd   = Math.max(0, (holding.totalCostUsd || holding.totalCost || 0) - soldUsdCost);
      holding.totalCost      = holding.totalCostUsd;
      if (holding.amount <= 0.000001) delete profile.holdings[mint];

      const trade = {
        id: Date.now(), type: "sell",
        mint, symbol: holding.symbol, name: holding.name, logo: holding.logo,
        amount: parsedSellAmount, priceUsd: effectivePrice,
        totalReceivedUsd, totalReceivedSol,
        totalReceived: totalReceivedUsd,   // backward compat
        costBasisSol,
        costBasis: soldUsdCost,            // USD cost basis for display
        pnl:    pnlSol,                    // ← now in SOL
        pnlUsd: totalReceivedUsd - soldUsdCost,
        pnlPct: costBasisSol > 0 ? ((pnlSol / costBasisSol) * 100).toFixed(2) : "0",
        solPriceAtTrade: solPriceForTrade,
        slippage: slip,
        riskScore: riskScore || holding.riskScore || null,
        timestamp: new Date().toISOString(),
      };
      profile.trades.unshift(trade);
      if (profile.trades.length > 200) profile.trades = profile.trades.slice(0, 200);

      const newBadgesSell = awardNewBadges(profile);
      await store.set(wallet, JSON.stringify(profile));
      await registerInLeaderboard(store, wallet);
      return { statusCode: 200, headers, body: JSON.stringify({ profile, trade, newBadges: newBadgesSell }) };
    }

    // ── UPDATE NAME ──
    if (action === "update_name") {
      const accountName = body.accountName;
      if (!accountName || accountName.length > 24) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid name (max 24 chars)" }) };
      }
      profile.accountName = accountName.trim();
      await store.set(wallet, JSON.stringify(profile));
      return { statusCode: 200, headers, body: JSON.stringify({ profile }) };
    }

    // ── MIGRATE TO SOL ──
    // Converts a legacy USD-denominated profile to SOL denomination.
    // The client sends the current SOL price so we don't need another fetch.
    if (action === "migrate_to_sol") {
      if (profile.balanceCurrency === "sol") {
        return { statusCode: 200, headers, body: JSON.stringify({ profile, alreadyMigrated: true }) };
      }
      const clientSolPrice = parseFloat(body.solPrice);
      const solPriceMig = clientSolPrice > 0 ? clientSolPrice : await fetchSolPriceServer();

      profile.balance      = parseFloat((profile.balance / solPriceMig).toFixed(6));
      profile.totalPnL     = parseFloat(((profile.totalPnL || 0) / solPriceMig).toFixed(6));
      profile.balanceCurrency = "sol";

      // Add SOL cost tracking to existing holdings
      for (const mint of Object.keys(profile.holdings || {})) {
        const h = profile.holdings[mint];
        if (!h.avgCostSol) {
          h.totalCostUsd = h.totalCost || (h.avgPrice * h.amount);
          h.totalCostSol = h.totalCostUsd / solPriceMig;
          h.totalCost    = h.totalCostUsd;
          h.avgCostSol   = h.amount > 0 ? h.totalCostSol / h.amount : 0;
        }
      }
      await store.set(wallet, JSON.stringify(profile));
      return { statusCode: 200, headers, body: JSON.stringify({ profile, migrated: true, solPriceUsed: solPriceMig }) };
    }

    // ── RESTORE FROM BACKUP ──
    // Called by the client when GET returned isNew:true but localStorage has a
    // saved copy. The server tries to read Blobs one more time; if real data is
    // there it takes priority over the backup. Only if Blobs truly has no data
    // does it save the client's backup, preventing permanent data loss from
    // momentary Blobs null-returns.
    if (action === "restore_backup") {
      const bp = body.backupProfile;
      if (!bp || typeof bp !== "object") {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing or invalid backupProfile" }) };
      }
      if (bp.wallet && bp.wallet !== wallet) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Backup wallet mismatch" }) };
      }

      // Always try Blobs one more time — it may have recovered since GET.
      const latestRaw = await store.get(wallet);
      if (latestRaw) {
        // Real profile found — Blobs was just glitching at GET time. Return real data.
        const real = JSON.parse(latestRaw);
        console.log("restore_backup: real profile found in Blobs, ignoring backup for", wallet);
        return { statusCode: 200, headers, body: JSON.stringify({
          profile: real, restored: false, message: "Real profile found" }) };
      }

      // Blobs has no data — save the client backup.
      // Basic sanity: balance must be ≥ 0 and wallet must match.
      const safeBalance = Math.max(0, parseFloat(bp.balance) || STARTING_BALANCE_SOL);
      bp.balance  = safeBalance;
      bp.wallet   = wallet;
      bp.restoredAt = new Date().toISOString();
      console.log("restore_backup: saving backup for", wallet, "balance=", safeBalance);
      await store.set(wallet, JSON.stringify(bp));
      await registerInLeaderboard(store, wallet);
      return { statusCode: 200, headers, body: JSON.stringify({
        profile: bp, restored: true, message: "Profile restored from local backup" }) };
    }

    // ── RESET ──
    if (action === "reset") {
      profile.balance         = STARTING_BALANCE_SOL;
      profile.balanceCurrency = "sol";
      profile.holdings        = {};
      profile.trades          = [];
      profile.totalPnL        = 0;
      profile.winCount        = 0;
      profile.lossCount       = 0;
      profile.badges              = [];   // ← clear badges so rewards can be earned again
      profile.lastLogin           = null; // ← reset daily login so streak restarts from Day 1
      profile.loginStreak         = 0;
      profile.welcomeGiftClaimed  = false; // ← allow re-claiming welcome gift after reset
      profile.updatedAt       = new Date().toISOString(); // ← leaderboard uses this for "Last Active"
      await store.set(wallet, JSON.stringify(profile));
      await registerInLeaderboard(store, wallet);
      return { statusCode: 200, headers, body: JSON.stringify({ profile }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: "Unknown action: " + action }) };
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
};