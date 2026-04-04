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
          throw e;
        }
      },
      async set(key, val) {
        try {
          await store.set(key, val);
          console.log("Blobs SET", key.slice(0,8), "→ OK");
        } catch(e) {
          console.error("Blobs SET failed:", key.slice(0,8), e.message);
          throw e;
        }
      },
      // listKeys(prefix): returns all keys that start with prefix, or null on failure.
      // Uses eventual consistency — fine for leaderboard enumeration.
      async listKeys(prefix) {
        try {
          const allKeys = [];
          let cursor;
          do {
            const opts = prefix ? { prefix } : {};
            if (cursor) opts.cursor = cursor;
            const result = await store.list(opts);
            const page   = result.blobs || [];
            allKeys.push(...page.map(b => b.key));
            cursor = result.cursor;
          } while (cursor);
          console.log("Blobs LIST prefix='" + (prefix||"") + "' →", allKeys.length, "keys");
          return allKeys;
        } catch(e) {
          console.warn("Blobs listKeys failed:", e.message);
          return null; // null = unavailable; [] = genuinely empty
        }
      }
    };
  } catch(e) {
    if (isProduction) {
      console.error("FATAL: @netlify/blobs unavailable in production:", e.message);
      throw new Error("Storage unavailable — please retry.");
    }
    console.warn("@netlify/blobs not available, using /tmp file store (local dev only):", e.message);
    return {
      async get(key) { return _readDb()[key] || null; },
      async set(key, val) { const db = _readDb(); db[key] = val; _writeDb(db); },
      async listKeys(prefix) {
        const db = _readDb();
        return Object.keys(db).filter(k => !prefix || k.startsWith(prefix));
      }
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

// ── Badge definitions (for leaderboard endpoint served from this function) ──
const BADGE_DEFS = [
  { id: "first_profit",         img: "/badges/First_Profit.png",   icon: "🏆", name: "First Profit",          desc: "Made your first profitable trade" },
  { id: "win_streak_5",         img: "/badges/win_streak_5.png",   icon: "🔥", name: "Win Streak x5",         desc: "Won 5 trades in a row" },
  { id: "safe_trader",          img: "/badges/Safe_Trader.png",    icon: "🛡️", name: "Safe Trader",            desc: "Buy 10 tokens with entry risk score ≥ 65" },
  { id: "diamond_hands",        img: "/badges/Diamond_Hands.png",  icon: "💎", name: "Diamond Hands",          desc: "Held a token for 7+ days" },
  { id: "degen_survivor",       img: "/badges/Degen_Survivor.png", icon: "🦍", name: "Degen Survivor",         desc: "Profit 10× on tokens with risk score < 45 (1 sell per buy)" },
  { id: "portfolio_100",        img: "/badges/portfolio_100.png",  icon: "📈", name: "100% Growth",            desc: "Doubled your 10 SOL starting balance" },
  { id: "wins_25",              img: "/badges/Wins_25.png",        icon: "⭐", name: "25 Safe Wins",           desc: "25 profitable trades" },
  { id: "wins_50",              img: "/badges/Wins_50.png",        icon: "🌟", name: "50 Safe Wins",           desc: "50 profitable trades" },
  { id: "wins_100",             img: "/badges/Wins_100.png",       icon: "💫", name: "100 Safe Wins",          desc: "100 profitable trades" },
  { id: "wins_500",             img: "/badges/Wins_500.png",       icon: "🚀", name: "500 Safe Wins",          desc: "500 profitable trades" },
  { id: "wins_1000",            img: "/badges/Wins_1000.png",      icon: "🐐", name: "1000 Safe Wins — GOAT",  desc: "The absolute GOAT." },
  { id: "sol2moon_millionaire", img: "/badges/Sol2Moon.png",       icon: "🌙", name: "Sol2Moon Millionaire",    desc: "Reach 10,000 SOL" },
];

// ── Leaderboard scoring helpers ──
function _lbAvgRiskScore(trades) {
  const withScore = trades.filter(t => t.riskScore != null && !isNaN(Number(t.riskScore)));
  if (!withScore.length) return 50;
  return withScore.reduce((s, t) => s + Number(t.riskScore), 0) / withScore.length;
}
function _lbComputeRiskAdjReturn(profile) {
  const start   = 10;
  const balance = profile.balance || start;
  const pnlPct  = ((balance - start) / start) * 100;
  return parseFloat((pnlPct * (_lbAvgRiskScore(profile.trades || []) / 100)).toFixed(2));
}
function _lbGetStartDate(period) {
  const now = new Date();
  if (period === "daily")   return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "weekly")  { const d = new Date(now); d.setDate(d.getDate() - d.getDay()); d.setHours(0,0,0,0); return d; }
  if (period === "monthly") return new Date(now.getFullYear(), now.getMonth(), 1);
  return new Date(0);
}
function _lbGetPeriodPnL(profile, period) {
  if (period === "alltime") return profile.totalPnL || 0;
  const cutoff = _lbGetStartDate(period);
  return (profile.trades || [])
    .filter(t => t.type === "sell" && !isNaN(t.pnl) && new Date(t.timestamp) >= cutoff)
    .reduce((s, t) => s + parseFloat(t.pnl || 0), 0);
}
function _lbTimeAgo(isoStr) {
  if (!isoStr) return "Never";
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs/24)}d ago`;
}
function _lbCalcSol2MoonReward(rank, adjReturn) {
  if (rank === 1) return 5000;
  if (rank === 2) return 3000;
  if (rank === 3) return 2000;
  if (rank <= 5)  return 1000;
  if (rank <= 10) return 500;
  if (rank <= 25) return 250;
  if (adjReturn > 0) return 100;
  return 0;
}

// ── Leaderboard registration — per-wallet keys ──
//
// OLD approach: one __lb_index__ JSON array.  Problem: read-then-write meant a
// cold-start null read would wipe the whole array when we wrote back just one wallet.
//
// NEW approach: each wallet gets its own key  "__reg_<wallet>" = ISO timestamp.
// Registration is a PURE WRITE — no read needed, no overwrite risk, impossible
// to accidentally wipe everyone else's registration.
// The leaderboard GET enumerates registrations via store.listKeys("__reg_").
// Profile-existence guard uses store.get("__reg_<wallet>") — a single fast read.
//
const REG_PREFIX      = "__reg_";
const REG_SENTINEL_KEY = "__reg_sentinel__"; // written whenever any wallet registers;
                                              // lets us detect list() returning [] on cold start
                                              // (store.list() is eventually-consistent — it can
                                              //  temporarily return [] even when keys exist)

// Returns all registered wallet addresses, or null if listing is unavailable/unreliable.
async function getRegisteredWallets(store) {
  const keys = await store.listKeys(REG_PREFIX);
  if (keys === null) return null; // list() threw → 503

  if (keys.length === 0) {
    // list() returned empty — could be a cold-start eventual-consistency false-negative
    // OR genuinely no registrations. Check the sentinel (strong-consistency GET).
    try {
      const sentinel = await store.get(REG_SENTINEL_KEY, { consistency: "strong" });
      if (sentinel) {
        // Sentinel exists → registrations definitely exist → list() is lying due to cold-start
        console.warn("LB: list() returned [] but sentinel exists — cold-start false-negative, returning null for 503");
        return null; // signals caller to return 503 so client retries
      }
    } catch {
      // Can't verify sentinel → be safe, 503
      return null;
    }
    // No sentinel → genuinely no registrations yet (fresh deployment)
    console.log("LB: no sentinel and empty list — fresh deployment, empty leaderboard");
    return [];
  }

  return keys.map(k => k.slice(REG_PREFIX.length)).filter(w => w.length >= 32);
}

// Returns true if this wallet has ever been registered (pure GET — no list needed).
async function isWalletRegistered(store, wallet) {
  try {
    const v = await store.get(REG_PREFIX + wallet, { consistency: "strong" });
    return !!v;
  } catch { return false; }
}

// Register a wallet — pure write, never reads the existing list, never wipes anyone.
async function registerInLeaderboard(store, wallet) {
  try {
    await store.set(REG_PREFIX + wallet, new Date().toISOString());
    // Also write the sentinel — this is what protects list() cold-start false-negatives
    try { await store.set(REG_SENTINEL_KEY, "1"); } catch {}
    console.log("registerInLeaderboard: registered", wallet.slice(0, 8));
  } catch(e) {
    console.warn("Could not register in leaderboard:", e.message);
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

  // ── GET: load user profile OR serve leaderboard data ──
  if (event.httpMethod === "GET") {
    const wallet = event.queryStringParameters && event.queryStringParameters.wallet;
    const action = event.queryStringParameters && event.queryStringParameters.action;

    // ── action=leaderboard: serve leaderboard from THIS function's store context ──
    // This ensures zero cross-function Blobs isolation issues — the same Lambda
    // that writes profiles and the __lb_index__ is also the one reading them here.
    if (action === "leaderboard") {
      const period       = (event.queryStringParameters && event.queryStringParameters.period) || "alltime";
      const callerWallet = (event.queryStringParameters && event.queryStringParameters.wallet_caller) || null;

      try {
        // getRegisteredWallets: list() is eventually-consistent, so retry up to 3×
        // with delays so cold-start false-negatives resolve before we give up.
        let regWallets = null;
        for (let attempt = 0; attempt <= 2; attempt++) {
          if (attempt > 0) await new Promise(r => setTimeout(r, attempt * 600));
          regWallets = await getRegisteredWallets(store);
          if (regWallets !== null) break;
          console.warn(`LB: getRegisteredWallets returned null, attempt ${attempt + 1}/3`);
        }
        console.log(`LB: registered wallets = ${regWallets === null ? "unavailable" : regWallets.length}`);

        if (regWallets === null) {
          // list() still failing after retries — return 503 so the client retries
          return { statusCode: 503, headers, body: JSON.stringify({ error: "Leaderboard temporarily unavailable, please retry" }) };
        }

        // Always include the caller's wallet directly — covers the brief window
        // between registration write and store.list() eventual-consistency catch-up.
        const merged = new Set(regWallets);
        if (callerWallet) merged.add(callerWallet);
        const wallets = Array.from(merged);

        const entries = [];
        for (const w of wallets) {
          if (w === "__lb_index__") continue;
          try {
            const raw = await store.get(w);
            if (!raw) continue;
            const profile = JSON.parse(raw);
            // Skip future-dated profiles (anti-cheat)
            if (profile.createdAt && new Date(profile.createdAt) > new Date(Date.now() + 60000)) continue;

            const adjReturn  = _lbComputeRiskAdjReturn(profile);
            // Compute P/L for ALL four periods so each MVP slot uses the right window
            const dailyPnL   = parseFloat(_lbGetPeriodPnL(profile, "daily").toFixed(2));
            const weeklyPnL  = parseFloat(_lbGetPeriodPnL(profile, "weekly").toFixed(2));
            const monthlyPnL = parseFloat(_lbGetPeriodPnL(profile, "monthly").toFixed(2));
            const periodPnL  = parseFloat(_lbGetPeriodPnL(profile, period).toFixed(2));
            const badges     = profile.badges || [];
            const trades     = profile.trades || [];
            const sells      = trades.filter(t => t.type === "sell");
            const avgRisk    = parseFloat(_lbAvgRiskScore(trades).toFixed(1));
            const lastTrade  = trades.length > 0 ? trades[0].timestamp : (profile.updatedAt || profile.createdAt);

            entries.push({
              wallet:       profile.wallet || w,
              accountName:  profile.accountName || "Ape",
              adjReturn,
              periodPnL,
              dailyPnL,
              weeklyPnL,
              monthlyPnL,
              totalPnL:     parseFloat((profile.totalPnL || 0).toFixed(2)),
              balance:      parseFloat((profile.balance || 10).toFixed(4)),
              winCount:     profile.winCount  || 0,
              lossCount:    profile.lossCount || 0,
              tradeCount:   sells.length,
              avgRiskScore: avgRisk,
              badges,
              lastActive:   _lbTimeAgo(lastTrade),
              lastTradeTs:  lastTrade,
              loginStreak:  profile.loginStreak || 0,
            });
          } catch(e) {
            console.warn(`LB: failed to process wallet ${w}:`, e.message);
          }
        }

        // Sort by period-appropriate metric
        if (period === "alltime") {
          entries.sort((a, b) => b.adjReturn - a.adjReturn);
        } else {
          const pnlKey = period === "daily" ? "dailyPnL" : period === "weekly" ? "weeklyPnL" : "monthlyPnL";
          entries.sort((a, b) => (b[pnlKey] || 0) - (a[pnlKey] || 0));
        }
        entries.forEach((e, i) => {
          e.rank = i + 1;
          e.sol2moonReward = _lbCalcSol2MoonReward(i + 1, e.adjReturn);
        });

        // Build MVP per period using each period's own P/L — not the shared periodPnL
        // which only reflects the currently selected tab period.
        const mvp = {
          daily:   [...entries].filter(e => e.dailyPnL   > 0).sort((a, b) => b.dailyPnL   - a.dailyPnL)[0]   || null,
          weekly:  [...entries].filter(e => e.weeklyPnL  > 0).sort((a, b) => b.weeklyPnL  - a.weeklyPnL)[0]  || null,
          monthly: [...entries].filter(e => e.monthlyPnL > 0).sort((a, b) => b.monthlyPnL - a.monthlyPnL)[0] || null,
          alltime: [...entries].filter(e => (e.totalPnL  || 0) > 0).sort((a, b) => b.totalPnL - a.totalPnL)[0] || null,
        };

        return { statusCode: 200, headers, body: JSON.stringify({
          entries:   entries.slice(0, 100),
          total:     entries.length,
          period,
          mvp,
          badgeDefs: BADGE_DEFS,
          timestamp: new Date().toISOString(),
        })};
      } catch(e) {
        console.error("LB GET (from simulator) error:", e);
        return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
      }
    }

    if (!wallet) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing wallet" }) };
    }

    try {
      // Retry up to 3 times (500 ms apart) before concluding the profile is genuinely new.
      // Netlify Blobs can occasionally return null on the first read after a cold start
      // or under brief propagation lag — retrying here prevents false "new user" responses
      // that can later cause data loss when POST actions save a fresh profile on top of the real one.
      let raw = await store.get(wallet);
      if (!raw) {
        await new Promise(r => setTimeout(r, 500));
        raw = await store.get(wallet);
      }
      if (!raw) {
        await new Promise(r => setTimeout(r, 700));
        raw = await store.get(wallet);
      }

      if (!raw) {
        // Still null after 3 attempts.
        // Check whether this wallet is registered (single fast key read).
        // If it is registered, it HAS a real profile — Blobs is cold-starting.
        // Return 503 so the client retries instead of getting a fake isNew.
        const registered = await isWalletRegistered(store, wallet);
        if (registered) {
          console.warn("GET: wallet registered but profile null — returning 503");
          return { statusCode: 503, headers, body: JSON.stringify({ error: "Profile temporarily unavailable, please retry" }) };
        }
        // Not registered → genuinely new user

        // Genuinely new wallet — no profile found and not in leaderboard.
        // DO NOT save here: the profile is created on the first real action.
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

    // Load profile — with retries to guard against momentary Blobs null-returns.
    // CRITICAL SAFETY: if all retries fail but the wallet is in the leaderboard
    // index (meaning it has an existing profile), we return 503 rather than
    // creating and saving a fresh 10-SOL profile that would wipe real data.
    let profile;
    try {
      let raw = await store.get(wallet);
      if (!raw) {
        await new Promise(r => setTimeout(r, 400));
        raw = await store.get(wallet);
      }
      if (!raw) {
        await new Promise(r => setTimeout(r, 600));
        raw = await store.get(wallet);
      }
      if (!raw) {
        // All 3 reads returned null. Before creating a fresh profile, check
        // whether this wallet already exists in the leaderboard. If it does,
        // Blobs is having a bad moment — return 503 so the client retries
        // rather than wiping a real profile.
        if (action !== "reset") {
          // Check if wallet is registered (its own key — single fast read, no fragile list).
          // If registered, it has a real profile that Blobs is temporarily hiding → 503.
          // If not registered, it's a genuine new user → safe to create fresh profile.
          const registered = await isWalletRegistered(store, wallet);
          if (registered) {
            console.warn("POST action", action, ": wallet registered but profile null — returning 503");
            return { statusCode: 503, headers, body: JSON.stringify({ error: "Profile temporarily unavailable, please retry" }) };
          }
        }
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

    // ── REGISTER (leaderboard registration without requiring a trade) ──
    // Called by leaderboard-app.js on page load / connect / Submit Score button.
    // IMPORTANT: only adds to __lb_index__ if the wallet actually has a saved profile.
    // Adding profileless wallets to the index breaks the 503 guard — the GET handler
    // would see the wallet in the index, assume a real profile exists, and block forever.
    if (action === "register") {
      const existingRaw = await store.get(wallet);
      if (existingRaw) {
        // Profile exists — register in index and return score preview
        await registerInLeaderboard(store, wallet);
        const existingProfile = JSON.parse(existingRaw);
        const adjReturn = _lbComputeRiskAdjReturn(existingProfile);
        const badges    = existingProfile.badges || [];
        return { statusCode: 200, headers, body: JSON.stringify({
          success: true, registered: true, adjReturn, badges,
          message: "Registered in leaderboard"
        })};
      }
      // No profile yet — do NOT add to index. The wallet will be added automatically
      // when its first real action (buy/sell/daily_login) is saved.
      return { statusCode: 200, headers, body: JSON.stringify({
        success: true, registered: false,
        message: "No profile yet — will register on first simulator action"
      })};
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: "Unknown action: " + action }) };
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
};