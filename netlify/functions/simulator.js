// netlify/functions/simulator.js
// Safe Ape Simulator — CommonJS format
// Balance denomination: SOL (not USD).  All trade costs / P&L are in SOL.

const STARTING_BALANCE_SOL = 10; // every new wallet starts with 10 SOL
const https = require("https");

/* ── Server-side price validation ──────────────────────────────────
   Fetches the real current price from Birdeye /defi/price for a given mint.
   Returns the token price in USD, or null if unavailable.
   This prevents clients from submitting manipulated priceUsd values.
   Birdeye is used as primary because the Birdeye API key is available
   server-side, and all other data in Scan2Moon now comes from Birdeye. */
async function fetchRealPrice(mint) {
  try {
    const KEY = process.env.BIRDEYE_API_KEY;
    if (!KEY) return null;

    const { status, body } = await httpsGetSimple(
      `https://public-api.birdeye.so/defi/price?address=${encodeURIComponent(mint)}&check_liquidity=100`,
      5000
    );
    if (status === 200) {
      const price = parseFloat(JSON.parse(body)?.data?.value);
      if (price > 0) return price;
    }
  } catch {}
  return null;
}

/* ── Server-side SOL/USD price ─────────────────────────────────────────
   Always fetched server-side for every buy/sell — runs in parallel with
   the Birdeye token-price call so it adds zero extra latency.
   Using only the server price prevents clients from submitting a
   manipulated solPrice to inflate their SOL balance.
   Source: Birdeye /defi/price exclusively — no fallbacks to CoinGecko / Binance / OKX.
   Uses in-process last-known price cache (warm lambda) + Redis stale key before giving up. */

const SOL_MINT_ADDR = "So11111111111111111111111111111111111111112";

// In-process cache — survives across warm lambda invocations, cleared on cold start
let _simSolPrice   = 0;
let _simSolPriceTs = 0;
const SIM_SOL_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

function httpsGetSimple(url, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      let data = "";
      res.on("data", c => { data += c; });
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error",   () => resolve({ status: 0, body: "" }));
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, body: "" }); });
  });
}

async function fetchSolPriceServer() {
  /* L1: Birdeye /defi/price — sole source per competition rules. */
  try {
    const KEY = process.env.BIRDEYE_API_KEY;
    if (KEY) {
      const { status, body } = await httpsGetSimple(
        `https://public-api.birdeye.so/defi/price?address=${SOL_MINT_ADDR}&check_liquidity=10`, 5000);
      if (status === 200) {
        const p = parseFloat(JSON.parse(body)?.data?.value);
        if (p > 0) {
          _simSolPrice   = p;
          _simSolPriceTs = Date.now();
          return p;
        }
      }
    }
  } catch {}

  /* L2: In-process last known price (warm lambda, < 5 min old) */
  if (_simSolPrice > 0 && Date.now() - _simSolPriceTs < SIM_SOL_MAX_AGE_MS) {
    console.warn("[simulator] Birdeye SOL price unavailable — using in-memory stale price:", _simSolPrice);
    return _simSolPrice;
  }

  /* L3: Redis stale key written by solPrice.js */
  try {
    const { redisGet } = require("./db");
    const stale = await redisGet("sol_price_usd_v4:stale");
    if (stale && parseFloat(stale) > 0) {
      const p = parseFloat(stale);
      console.warn("[simulator] Birdeye SOL price unavailable — using Redis stale price:", p);
      return p;
    }
  } catch {}

  /* L4: No price available — return 0 so caller can reject the trade gracefully */
  console.error("[simulator] SOL price completely unavailable — rejecting trade");
  return 0;
}

/* Price tolerance: submitted price must be within ±25% of real price.
   25% allows for slippage and any slight lag between client and server. */
const PRICE_TOLERANCE = 0.25;

/* ── Profile sanitizer ───────────────────────────────────────────────────────
   Called before EVERY profile save.  Prevents Infinity/NaN (from division-by-zero
   when SOL price is momentarily 0) from being serialised as null by JSON.stringify,
   which would wipe the user's balance permanently.
   Also enforces a hard ceiling so no single bug can create an astronomical balance. */
const MAX_BALANCE_SOL = 50_000;   // hard ceiling — generous for legitimate play
function _sanitizeProfile(p) {
  // Numeric fields: replace Infinity/NaN with 0
  if (!isFinite(p.balance)  || p.balance  < 0) p.balance  = 0;
  if (!isFinite(p.totalPnL))                   p.totalPnL = 0;
  // Hard ceiling
  if (p.balance > MAX_BALANCE_SOL) {
    console.warn("[simulator] balance clamped from", p.balance, "→", MAX_BALANCE_SOL);
    p.balance = MAX_BALANCE_SOL;
  }
  // Counts must be non-negative integers
  p.winCount  = Math.max(0, Math.floor(p.winCount  || 0));
  p.lossCount = Math.max(0, Math.floor(p.lossCount || 0));
  // XP fields
  if (!isFinite(p.badgeXp))   p.badgeXp   = 0;
  if (!isFinite(p.socialXp))  p.socialXp  = 0;
  if (!isFinite(p.academyXp)) p.academyXp = 0;
  if (!isFinite(p.tradeXp))   p.tradeXp   = 0;
}

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
  // NETLIFY_BLOBS_CONTEXT is set by both `netlify dev` (local) and actual Netlify deploys.
  // NETLIFY_DEV=true is ONLY set by `netlify dev`, never in production.
  // So: treat as production only when we have the blob context AND are NOT in local dev mode.
  const isProduction = !!process.env.NETLIFY_BLOBS_CONTEXT && !process.env.NETLIFY_DEV;

  // ── LOCAL DEV ISOLATION ──────────────────────────────────────────────────
  // When running `netlify dev` locally, skip real Blobs AND real Redis entirely.
  // Without this, the function finds the wallet in the production Redis leaderboard
  // set (SISMEMBER returns true) but can't load the Blobs profile → 503 safety guard.
  // Local dev uses an isolated /tmp file store so it never conflicts with prod data.
  if (process.env.NETLIFY_DEV) {
    console.log("[simulator] Local dev mode — using isolated /tmp file store");
    return {
      async get(key) { return _readDb()[key] || null; },
      async set(key, val) { const db = _readDb(); db[key] = val; _writeDb(db); },
      async listKeys(prefix) {
        const db = _readDb();
        return Object.keys(db).filter(k => !prefix || k.startsWith(prefix));
      },
    };
  }

  try {
    const { getStore } = require("@netlify/blobs");
    // NETLIFY_BLOBS_CONTEXT is auto-injected in normal Netlify deployments.
    // If it's missing (e.g. new Projects format), fall back to explicit config
    // using NETLIFY_SITE_ID (always available) + S2M_BLOBS_TOKEN (PAT).
    const _siteId = process.env.SITE_ID || process.env.NETLIFY_SITE_ID;
    const _token  = process.env.S2M_BLOBS_TOKEN;
    console.log("Blobs init: context=", !!process.env.NETLIFY_BLOBS_CONTEXT, "siteID=", _siteId || "MISSING", "token=", _token ? "SET" : "MISSING");
    const storeArg = process.env.NETLIFY_BLOBS_CONTEXT
      ? "simulator"
      : { name: "simulator", siteID: _siteId, token: _token };
    if (!process.env.NETLIFY_BLOBS_CONTEXT && !_token) {
      throw new Error("Blobs: NETLIFY_BLOBS_CONTEXT and S2M_BLOBS_TOKEN both missing");
    }
    const store = getStore(storeArg);
    return {
      // consistency:"strong" ensures we always read the latest write,
      // even if the previous Lambda invocation just wrote it milliseconds ago.
      // IMPORTANT: returns null on ANY error (token expiry, network, etc).
      // Callers should NOT rely on throws — the GET handler's retry + Redis
      // fallback logic depends on receiving null, not an exception.
      async get(key) {
        try {
          const v = await store.get(key, { consistency: "strong" });
          console.log("Blobs GET", key.slice(0,8), "→", v ? "found" : "null");
          return v;
        } catch(e) {
          console.error("Blobs GET failed (returning null):", key.slice(0,8), e.message);
          return null; // ← null triggers retry logic + Redis fallback, not a 500
        }
      },
      // getRaw: like get() but THROWS on error instead of returning null.
      // Use this when you need to distinguish "key not found" (returns null)
      // from "Blobs unavailable" (throws) — e.g. orphan detection.
      async getRaw(key) {
        return store.get(key, { consistency: "strong" });
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
  // Trading milestone overrides
  wins_50:              0.5,
  wins_100:             1.0,
  wins_500:             2.0,
  wins_1000:            5.0,
  sol2moon_millionaire: 500.0,
  // Account level badges — must match dashboard.js BADGE_DEFS reward values
  lvl_1:                0.05,
  lvl_5:                0.1,
  lvl_10:               0.25,
  lvl_20:               0.5,
  lvl_30:               1.0,
  lvl_50:               2.0,
  lvl_100:              10.0,
};

// ── XP awarded when a badge is newly earned ──────────────────────────────────
// These values accumulate in profile.badgeXp (never counted in computeBadges()
// level check — prevents circular dependency).
const BADGE_XP_REWARDS = {
  // Safe Ape Trading badges
  first_profit:           100,
  win_streak_5:           200,
  safe_trader:            350,
  diamond_hands:          250,
  degen_survivor:         500,
  portfolio_100:          600,
  wins_25:                300,
  wins_50:                600,
  wins_100:             1_200,
  wins_500:             4_000,
  wins_1000:           10_000,
  sol2moon_millionaire:  5_000,
  // Account Level milestone badges
  lvl_1:      25,
  lvl_5:     150,
  lvl_10:    500,
  lvl_20:  1_500,
  lvl_30:  3_500,
  lvl_50: 10_000,
  lvl_100: 50_000,
  // Social / Other
  streak_7:  200,
};

// ── Level formula (must match client-side calcLevel in dashboard.js) ──────────
// xp(n) = round(100 * (n-1)^2.3)  →  n = floor((xp/100)^(1/2.3)) + 1
function _calcLevel(xp) {
  if (!xp || xp <= 0) return 1;
  return Math.max(1, Math.min(100, Math.floor(Math.pow(xp / 100, 1 / 2.3)) + 1));
}

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
  /* portfolio_100: 2× starting (20 SOL = 100% growth) | sol2moon_millionaire: 10,000 SOL
     Use isFinite guard — Infinity/NaN would incorrectly satisfy these thresholds. */
  const _safeBalance = isFinite(profile.balance) ? Math.max(0, profile.balance) : 0;
  if (_safeBalance >= 20)     badges.push("portfolio_100");
  if (winCount >= 25)         badges.push("wins_25");
  if (winCount >= 50)         badges.push("wins_50");
  if (winCount >= 100)        badges.push("wins_100");
  if (winCount >= 500)        badges.push("wins_500");
  if (winCount >= 1000)       badges.push("wins_1000");
  if (_safeBalance >= 10000)  badges.push("sol2moon_millionaire");

  /* ── Account Level badges — use _calcLevel() (matches dashboard.js) ──
     Note: profile.badgeXp is intentionally excluded here to avoid
     circular dependency (level badge → badgeXp → higher level → more level badges).
     On the *next* action, the newly stored badgeXp will be included in _xpBase.  */
  // XP only for PROFITABLE sells (pnl > 0) — losses do not award XP
  const _xpBase = (sells.filter(t => (t.pnl || 0) > 0).length * 25) + ((profile.loginStreak || 0) * 10)
                + (profile.socialXp  || 0) + (profile.academyXp || 0);
  const _lvl    = _calcLevel(_xpBase);
  if (_lvl >= 1)   badges.push("lvl_1");
  if (_lvl >= 5)   badges.push("lvl_5");
  if (_lvl >= 10)  badges.push("lvl_10");
  if (_lvl >= 20)  badges.push("lvl_20");
  if (_lvl >= 30)  badges.push("lvl_30");
  if (_lvl >= 50)  badges.push("lvl_50");
  if (_lvl >= 100) badges.push("lvl_100");

  return badges;
}
function awardNewBadges(profile) {
  const prev    = profile.badges || [];
  const current = computeBadges(profile);
  const newly   = current.filter(b => !prev.includes(b));
  if (newly.length > 0) {
    // SOL reward
    const rewardTotal = newly.reduce((s, b) => s + (BADGE_REWARD_OVERRIDES[b] || BADGE_REWARD_AMOUNT), 0);
    profile.balance += rewardTotal;
    // XP reward — stored in profile.badgeXp (not used inside computeBadges to avoid circularity)
    const xpGained = newly.reduce((s, b) => s + (BADGE_XP_REWARDS[b] || 0), 0);
    if (xpGained > 0) profile.badgeXp = (profile.badgeXp || 0) + xpGained;
  }
  profile.badges = current;
  return newly;
}

// ── Badge definitions (for leaderboard endpoint served from this function) ──
// Must stay in sync with dashboard.js BADGE_DEFS so avatar lookups work.
const BADGE_DEFS = [
  /* ── Safe Ape Trading ── */
  { id: "first_profit",         cat: "trading", img: "/badges/First_Profit.png",    icon: "🏆", name: "First Profit",          desc: "Close your very first profitable trade in the Safe Ape Simulator.",          reward: 0.1   },
  { id: "win_streak_5",         cat: "trading", img: "/badges/win_streak_5.png",    icon: "🔥", name: "Win Streak ×5",         desc: "Win 5 consecutive trades in a row without a loss in between.",               reward: 0.1   },
  { id: "safe_trader",          cat: "trading", img: "/badges/Safe_Trader.png",     icon: "🛡️", name: "Safe Trader",           desc: "Buy 10 different tokens that each had an entry risk score of 65 or higher.", reward: 0.1   },
  { id: "diamond_hands",        cat: "trading", img: "/badges/Diamond_Hands.png",   icon: "💎", name: "Diamond Hands",         desc: "Hold a token position open for 7 days or more before selling.",              reward: 0.1   },
  { id: "degen_survivor",       cat: "trading", img: "/badges/Degen_Survivor.png",  icon: "🦍", name: "Degen Survivor",        desc: "Make a 10× profit on a token that had a risk score below 45 at entry.",      reward: 0.1   },
  { id: "portfolio_100",        cat: "trading", img: "/badges/portfolio_100.png",   icon: "📈", name: "100% Growth",           desc: "Double your starting balance of 10 SOL — reach 20 SOL or more.",            reward: 0.1   },
  { id: "wins_25",              cat: "trading", img: "/badges/Wins_25.png",         icon: "⭐", name: "25 Safe Wins",          desc: "Close a total of 25 profitable trades in the simulator.",                    reward: 0.1   },
  { id: "wins_50",              cat: "trading", img: "/badges/Wins_50.png",         icon: "🌟", name: "50 Safe Wins",          desc: "Close a total of 50 profitable trades. You're on a roll!",                  reward: 0.5   },
  { id: "wins_100",             cat: "trading", img: "/badges/Wins_100.png",        icon: "💫", name: "100 Safe Wins",         desc: "Close 100 profitable trades. The market has nothing on you.",               reward: 1.0   },
  { id: "wins_500",             cat: "trading", img: "/badges/Wins_500.png",        icon: "🚀", name: "500 Safe Wins",         desc: "500 wins — you are an elite Scan2Moon trader.",                             reward: 2.0   },
  { id: "wins_1000",            cat: "trading", img: "/badges/Wins_1000.png",       icon: "🐐", name: "1000 Safe Wins — GOAT", desc: "1000 profitable trades. You are the absolute Greatest Of All Time.",        reward: 5.0   },
  { id: "sol2moon_millionaire", cat: "trading", img: "/badges/Sol2Moon.png",        icon: "🌙", name: "Sol2Moon Millionaire",  desc: "Grow your simulator balance to 10,000 SOL. Legendary status.",              reward: 500.0 },

  /* ── Academy Rank ── */
  { id: "lesson_1",      cat: "academy", subcat: "rank", img: null, icon: "🎯", name: "First Lesson",      desc: "Complete your very first lesson in the Scan2Moon Academy.",                        reward: 0.1  },
  { id: "risk_master",   cat: "academy", subcat: "rank", img: null, icon: "📊", name: "Risk Master",       desc: "Score 100% on the Risk Scanner knowledge quiz. Perfect understanding!",           reward: 0.25 },
  { id: "scanner_pro",   cat: "academy", subcat: "rank", img: null, icon: "🛡️", name: "Scanner Pro",       desc: "Complete the full Risk Scanner deep-dive course from start to finish.",           reward: 0.5  },
  { id: "chart_reader",  cat: "academy", subcat: "rank", img: null, icon: "📈", name: "Chart Reader",      desc: "Pass the Chart Reading & Candle Analysis challenge with 80%+ accuracy.",          reward: 0.25 },
  { id: "whale_watcher", cat: "academy", subcat: "rank", img: null, icon: "🐋", name: "Whale Watcher",     desc: "Complete the Whale DNA module and learn how to track smart money.",                reward: 0.25 },
  { id: "defi_graduate", cat: "academy", subcat: "rank", img: null, icon: "🏛️", name: "DeFi Graduate",     desc: "Complete every module in the Scan2Moon Academy. Full graduate status!",           reward: 1.0  },

  /* ── Academy Guide Badges ── */
  { id: "guide_risk_scanner", cat: "academy", subcat: "guide", img: null, icon: "📊", name: "From Zero to Moon",          desc: "Complete the 'S2M – From Zero to Moon' guide.",  reward: 0.15 },
  { id: "guide_whale_dna",    cat: "academy", subcat: "guide", img: null, icon: "🐋", name: "Track the Smart Money",       desc: "Complete the Whale DNA guide.",                  reward: 0.15 },
  { id: "guide_safe_ape",     cat: "academy", subcat: "guide", img: null, icon: "🦍", name: "Paper Trade Before You Risk", desc: "Complete the Safe Ape Simulator guide.",         reward: 0.15 },

  /* ── Academy Level ── */
  { id: "acad_lvl_1", cat: "academy", subcat: "level", img: null, icon: "📖", name: "Academy LVL 1 — Enrolled",   desc: "Earn your first Academy Rank badge. The journey begins!",                  reward: 0.05 },
  { id: "acad_lvl_2", cat: "academy", subcat: "level", img: null, icon: "✏️", name: "Academy LVL 2 — Student",    desc: "Earn 2 Academy Rank badges. You are officially a student.",                reward: 0.1  },
  { id: "acad_lvl_3", cat: "academy", subcat: "level", img: null, icon: "📚", name: "Academy LVL 3 — Scholar",    desc: "Earn 3 Academy Rank badges. Knowledge is compounding.",                    reward: 0.2  },
  { id: "acad_lvl_4", cat: "academy", subcat: "level", img: null, icon: "🎓", name: "Academy LVL 4 — Advanced",   desc: "Earn 4 Academy Rank badges. You're ahead of 90% of traders.",             reward: 0.4  },
  { id: "acad_lvl_5", cat: "academy", subcat: "level", img: null, icon: "🏆", name: "Academy LVL 5 — Professor",  desc: "Earn all 5 core Academy Rank badges. You are the one who teaches now.",   reward: 1.0  },

  /* ── Other ── */
  { id: "early_adopter",  cat: "other", img: null, icon: "⚡", name: "Early Adopter",   desc: "Joined Scan2Moon before the V2 public launch. OG status forever.",              reward: 0.5  },
  { id: "community_og",   cat: "other", img: null, icon: "🐦", name: "Community OG",    desc: "Followed @Scan2Moon on X and joined the community from the start.",             reward: 0.1  },
  { id: "streak_7",       cat: "other", img: null, icon: "🔥", name: "7-Day Streak",    desc: "Log in 7 days in a row. Consistency is the edge most traders don't have.",      reward: 0.15 },
  { id: "watchlist_pro",  cat: "other", img: null, icon: "⭐", name: "Watchlist Pro",   desc: "Add 10 or more tokens to your personal Scan2Moon Watchlist.",                   reward: 0.1  },
  { id: "sharer",         cat: "other", img: null, icon: "📢", name: "Alpha Sharer",    desc: "Share a risk scan result on X. Spreading real data, not hype.",                 reward: 0.1  },

  /* ── PRO ── */
  { id: "pro_scanner",   cat: "pro", img: null, icon: "🛡️", name: "Pro Scanner",     desc: "Run 100 total risk scans. You have seen enough charts to know the difference.", reward: 0.5  },
  { id: "alpha_caller",  cat: "pro", img: null, icon: "🎯", name: "Alpha Caller",    desc: "Correctly predict 3 tokens that go 10× before they pump. Real alpha.",          reward: 2.0  },
  { id: "whale_analyst", cat: "pro", img: null, icon: "🐋", name: "Whale Analyst",   desc: "Successfully identify 5 whale wallet patterns using Whale DNA scanner.",         reward: 1.0  },
  { id: "top_10",        cat: "pro", img: null, icon: "🏆", name: "Top 10",          desc: "Reach the top 10 on the Scan2Moon Leaderboard. Elite trader confirmed.",         reward: 5.0  },

  /* ── Cosmetics — Free ── */
  { id: "cosm_classic_ape",   cat: "cosmetics", subcat: "free", freebie: true,
    img: null, icon: "🦍", name: "Classic Ape",
    desc: "The original Ape Trader look. Free for every Scan2Moon user — always unlocked.", reward: 0 },

  /* ── Cosmetics — Community Badges ── */
  { id: "cosm_love_solana",   cat: "cosmetics", subcat: "community", market: true, priceUsd: 0.99,
    img: "/badges/Love_Solana.png", icon: "❤️", name: "I Love Solana",
    desc: "Show your love for the fastest chain in the game.", reward: 0 },
  { id: "cosm_love_s2m",      cat: "cosmetics", subcat: "community", market: true, priceUsd: 0.99,
    img: "/badges/Love_S2M.png",    icon: "🌙", name: "I Love S2M",
    desc: "A true Scan2Moon believer — the OG community badge.", reward: 0 },

  /* ── Cosmetics — Moon Krakens (animated MP4) ── */
  { id: "kraken_skeleton",    cat: "cosmetics", subcat: "moon_krakens", market: true, priceUsd: 4.99,
    type: "video", video: "/badges/Moon_Krakens_Bages/006.mp4", icon: "💀", name: "Skeleton",
    desc: "Moon Krakens #006 — Skeleton. Fully animated avatar badge.", reward: 0 },
  { id: "kraken_badboy",      cat: "cosmetics", subcat: "moon_krakens", market: true, priceUsd: 4.99,
    type: "video", video: "/badges/Moon_Krakens_Bages/005.mp4", icon: "😈", name: "Bad Boy",
    desc: "Moon Krakens #005 — Bad Boy. Fully animated avatar badge.", reward: 0 },
  { id: "kraken_pirate",      cat: "cosmetics", subcat: "moon_krakens", market: true, priceUsd: 4.99,
    type: "video", video: "/badges/Moon_Krakens_Bages/004.mp4", icon: "🏴‍☠️", name: "Pirate",
    desc: "Moon Krakens #004 — Pirate. Fully animated avatar badge.", reward: 0 },

  /* ── Account Levels ── */
  { id: "lvl_1",   cat: "levels", img: null, icon: "🌱", name: "Level 1 — First Step",    desc: "Reach Account Level 1. Every legend starts with a single step.", reward: 0.05 },
  { id: "lvl_5",   cat: "levels", img: null, icon: "🔥", name: "Level 5 — Getting Warm",  desc: "Reach Account Level 5. You're building momentum — keep going!",   reward: 0.1  },
  { id: "lvl_10",  cat: "levels", img: null, icon: "💪", name: "Level 10 — Veteran",      desc: "Reach Account Level 10. A true Scan2Moon veteran. Respect.",       reward: 0.25 },
  { id: "lvl_20",  cat: "levels", img: null, icon: "🧠", name: "Level 20 — Smart Money",  desc: "Reach Account Level 20. You clearly understand how this works.",    reward: 0.5  },
  { id: "lvl_30",  cat: "levels", img: null, icon: "💎", name: "Level 30 — Diamond Mind", desc: "Reach Account Level 30. Elite mentality. Diamond hands, diamond brain.", reward: 1.0  },
  { id: "lvl_50",  cat: "levels", img: null, icon: "🚀", name: "Level 50 — Half Moon",    desc: "Reach Account Level 50. Halfway to the moon and already a legend.",  reward: 2.0  },
  { id: "lvl_100", cat: "levels", img: null, icon: "🌙", name: "Level 100 — Sol2Moon",    desc: "Reach Account Level 100. Maximum level. You ARE the moon. Absolute GOAT.", reward: 10.0 },
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

// ── Leaderboard storage ───────────────────────────────────────────────────
//
// PRIMARY: Upstash Redis (if UPSTASH_REDIS_REST_URL + TOKEN are set)
//   • Uses a Redis SET (SADD/SMEMBERS) — atomic, no race conditions,
//     no cold-start issues, no eventual-consistency problems, no token expiry.
//   • SADD is idempotent — calling it twice for the same wallet is safe.
//
// FALLBACK: Netlify Blobs __lb_index__ (single strong-consistency GET key)
//   • Works but can return null when Netlify's Blobs context token expires
//     (~1-2h on warm Lambda containers) — that's the root cause of data loss.
//   • Protected by sentinel + migration from per-wallet __reg_ keys.
//
const LB_INDEX_KEY     = "__lb_index__";      // Blobs: JSON array of wallets
const LB_REDIS_SET_KEY = "s2m:lb:wallets";    // Redis: SET of wallet addresses
const REG_PREFIX       = "__reg_";             // Blobs: per-wallet timestamp keys (backup)
const REG_SENTINEL_KEY = "__reg_sentinel__";   // Blobs: sentinel

// ── Upstash Redis helpers ─────────────────────────────────────────────────
function _redisAvailable() {
  // In local dev, never use the production Redis instance — it would find the wallet
  // in the production leaderboard set and trigger the 503 safety guard.
  if (process.env.NETLIFY_DEV) return false;
  return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}
async function _redisCmd(...args) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const res = await fetch(url, {
    method:  "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body:    JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`Redis HTTP ${res.status}`);
  const data = await res.json();
  return data.result;
}

// ── Redis profile cache helpers ───────────────────────────────────────────
// Profiles live in Netlify Blobs. Redis acts as a backup cache so that when
// Blobs token expires (~1-2h), we can still serve the last known profile.
async function redisCacheProfile(wallet, profile) {
  if (!_redisAvailable()) return;
  try {
    await _redisCmd("SET", `s2m:profile:${wallet}`, JSON.stringify(profile), "EX", 604800);
  } catch(e) {
    console.warn("Redis profile cache write failed:", e.message);
  }
}
async function redisGetCachedProfile(wallet) {
  if (!_redisAvailable()) return null;
  try {
    const raw = await _redisCmd("GET", `s2m:profile:${wallet}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch(e) {
    console.warn("Redis profile cache read failed:", e.message);
    return null;
  }
}

// ── READ the leaderboard wallet list ──────────────────────────────────────
async function getLbIndex(store) {
  // ── Redis path (preferred) ──
  if (_redisAvailable()) {
    try {
      const members = await _redisCmd("SMEMBERS", LB_REDIS_SET_KEY);
      const wallets = Array.isArray(members) ? members : [];
      console.log("LB: Redis SMEMBERS →", wallets.length, "wallets");
      return wallets;
    } catch(e) {
      console.error("LB: Redis SMEMBERS failed, falling back to Blobs:", e.message);
    }
  }

  // ── Blobs path (fallback) ──
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) await new Promise(r => setTimeout(r, 600));
      const raw = await store.get(LB_INDEX_KEY, { consistency: "strong" });
      if (raw) {
        const parsed = JSON.parse(raw);
        console.log("LB: Blobs index OK —", parsed.length, "wallets");
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch(e) {
      console.warn("getLbIndex Blobs attempt", attempt, ":", e.message);
    }
  }

  // Blobs index missing — try migration from per-wallet keys
  console.warn("LB: __lb_index__ missing — migration attempt");
  try {
    const listed = await store.listKeys(REG_PREFIX);
    if (listed && listed.length > 0) {
      const wallets = listed.map(k => k.slice(REG_PREFIX.length)).filter(w => w.length >= 32);
      if (wallets.length > 0) {
        console.log("LB: migrating", wallets.length, "wallets");
        try { await store.set(LB_INDEX_KEY, JSON.stringify(wallets)); } catch {}
        return wallets;
      }
    }
  } catch(e) { console.warn("LB: migration list() failed:", e.message); }

  // Check sentinel — if present, data exists but Blobs is struggling → 503
  try {
    const sentinel = await store.get(REG_SENTINEL_KEY, { consistency: "strong" });
    if (sentinel) { console.warn("LB: sentinel exists but Blobs failing → 503"); return null; }
  } catch {}

  console.log("LB: no sentinel — fresh deployment");
  return [];
}

// ── WRITE a wallet into the index ─────────────────────────────────────────
async function addToLbIndex(store, wallet) {
  // ── Redis path (preferred) — SADD is atomic, no wipe risk ──
  if (_redisAvailable()) {
    try {
      await _redisCmd("SADD", LB_REDIS_SET_KEY, wallet);
      console.log("LB: Redis SADD OK for", wallet.slice(0, 8));
      return;
    } catch(e) {
      console.error("LB: Redis SADD failed, falling back to Blobs:", e.message);
    }
  }

  // ── Blobs path (fallback) — safe read-modify-write with null protection ──
  let raw = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      raw = await store.get(LB_INDEX_KEY, { consistency: "strong" });
      if (raw !== null) break;
    } catch(e) { console.warn("addToLbIndex read err:", attempt, e.message); }
    if (attempt < 4) await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
  }

  if (raw === null) {
    try {
      const sentinel = await store.get(REG_SENTINEL_KEY, { consistency: "strong" });
      if (sentinel) {
        console.warn("addToLbIndex: null+sentinel → skipping (Blobs outage, data protected)");
        return;
      }
    } catch {}
    console.log("addToLbIndex: null+no sentinel → creating fresh Blobs index");
  }

  const index = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(index)) return;
  if (!index.includes(wallet)) {
    index.push(wallet);
    await store.set(LB_INDEX_KEY, JSON.stringify(index));
    try { await store.set(REG_SENTINEL_KEY, "1"); } catch {}
    console.log("addToLbIndex: Blobs wrote", index.length, "wallets");
  }
}

// ── CHECK if a wallet is registered ───────────────────────────────────────
async function isWalletRegistered(store, wallet) {
  // Redis: check set membership
  if (_redisAvailable()) {
    try {
      const v = await _redisCmd("SISMEMBER", LB_REDIS_SET_KEY, wallet);
      if (v === 1) return true;
    } catch(e) { console.warn("isWalletRegistered Redis err:", e.message); }
  }
  // Blobs: check per-wallet key
  try {
    const v = await store.get(REG_PREFIX + wallet, { consistency: "strong" });
    if (v) return true;
    // Also check index
    const raw = await store.get(LB_INDEX_KEY, { consistency: "strong" });
    if (raw) { const idx = JSON.parse(raw); return Array.isArray(idx) && idx.includes(wallet); }
  } catch {}
  return false;
}

// ── REGISTER a wallet ──────────────────────────────────────────────────────
async function registerInLeaderboard(store, wallet) {
  try {
    if (_redisAvailable()) {
      // Redis: single atomic SADD — this is all we need
      await _redisCmd("SADD", LB_REDIS_SET_KEY, wallet);
      console.log("registerInLeaderboard (Redis): done for", wallet.slice(0, 8));
      // Also write Blobs per-wallet key + sentinel as backup for when Redis is unavailable
      try {
        await store.set(REG_PREFIX + wallet, new Date().toISOString());
        await store.set(REG_SENTINEL_KEY, "1");
      } catch {}
      return;
    }
    // Blobs-only path
    await store.set(REG_PREFIX + wallet, new Date().toISOString());
    try { await store.set(REG_SENTINEL_KEY, "1"); } catch {}
    await addToLbIndex(store, wallet);
    console.log("registerInLeaderboard (Blobs): done for", wallet.slice(0, 8));
  } catch(e) {
    console.warn("Could not register in leaderboard:", e.message);
  }
}

// ── Rate limiter (Redis-backed, per IP per minute) ────────────────────────
// Allows up to RATE_LIMIT_MAX POST actions per IP per 60-second window.
// GET requests (profile loads, leaderboard) are not rate-limited.
const RATE_LIMIT_MAX = 30; // max POST actions per minute per IP
async function checkRateLimit(ip) {
  if (!_redisAvailable() || !ip) return false; // can't limit → allow
  try {
    const key = `s2m:rl:sim:${ip}:${Math.floor(Date.now() / 60000)}`;
    const count = await _redisCmd("INCR", key);
    if (count === 1) await _redisCmd("EXPIRE", key, 90); // TTL a bit over 1 min
    return count > RATE_LIMIT_MAX;
  } catch { return false; } // Redis error → allow through
}

// ── Per-wallet trade rate limiter (anti-bot) ──────────────────────────────
// Limits buy/sell executions to 20 per 5-minute window per wallet.
// Generous enough for any real user; blocks rapid-fire bot trading.
const WALLET_TRADE_LIMIT_MAX = 20;
const WALLET_TRADE_WINDOW_SECS = 300;
async function checkWalletTradeLimit(wallet) {
  if (!_redisAvailable() || !wallet) return false;
  try {
    const window5m = Math.floor(Date.now() / (WALLET_TRADE_WINDOW_SECS * 1000));
    const key = `s2m:rl:wt:${wallet}:${window5m}`;
    const count = await _redisCmd("INCR", key);
    if (count === 1) await _redisCmd("EXPIRE", key, WALLET_TRADE_WINDOW_SECS + 30);
    return count > WALLET_TRADE_LIMIT_MAX;
  } catch { return false; }
}

exports.handler = async function(event, context) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "https://scan2moon.com",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  // Rate limit POST actions (not GETs — profile reads should not be blocked)
  if (event.httpMethod === "POST") {
    const clientIp = (event.headers && (
      event.headers["x-nf-client-connection-ip"] ||
      event.headers["x-forwarded-for"] ||
      event.headers["client-ip"] || ""
    )).split(",")[0].trim();
    const limited = await checkRateLimit(clientIp);
    if (limited) {
      return { statusCode: 429, headers, body: JSON.stringify({ error: "Too many requests — please slow down." }) };
    }
  }

  let store;
  try {
    store = await getStore();
  } catch(storeErr) {
    console.error("getStore() failed:", storeErr.message);
    return { statusCode: 503, headers, body: JSON.stringify({ error: "Storage temporarily unavailable — please retry." }) };
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
        // getLbIndex: reads __lb_index__ with strong-consistency GET — far more
        // reliable than store.list() which is eventually-consistent and can return
        // [] at any time. Falls back to list() migration if the index is missing.
        const regWallets = await getLbIndex(store);
        console.log(`LB: index wallets = ${regWallets === null ? "unavailable" : regWallets.length}`);

        if (regWallets === null) {
          return { statusCode: 503, headers, body: JSON.stringify({ error: "Leaderboard temporarily unavailable, please retry" }) };
        }

        // Always include the caller's wallet — ensures they see themselves even
        // before their index write has propagated (registration is async).
        const merged = new Set(regWallets);
        if (callerWallet) merged.add(callerWallet);
        const wallets = Array.from(merged);

        const entries = [];
        for (const w of wallets) {
          if (w === "__lb_index__") continue;
          try {
            // Read profile: Blobs first, Redis cache as fallback.
            // This ensures the leaderboard still shows users even when
            // the Blobs token is temporarily expired.
            let raw = await store.get(w);
            if (!raw && w === callerWallet) {
              await new Promise(r => setTimeout(r, 500));
              raw = await store.get(w);
            }
            if (!raw) {
              // Blobs unavailable — try Redis profile cache
              const rCached = await redisGetCachedProfile(w);
              if (rCached && !rCached._recovering) {
                // Serve from Redis cache
                const profile = rCached;
                const adjReturn  = _lbComputeRiskAdjReturn(profile);
                const dailyPnL   = parseFloat(_lbGetPeriodPnL(profile, "daily").toFixed(2));
                const weeklyPnL  = parseFloat(_lbGetPeriodPnL(profile, "weekly").toFixed(2));
                const monthlyPnL = parseFloat(_lbGetPeriodPnL(profile, "monthly").toFixed(2));
                const periodPnL  = parseFloat(_lbGetPeriodPnL(profile, period).toFixed(2));
                const badges     = profile.badges || [];
                const trades     = profile.trades || [];
                const sells      = trades.filter(t => t.type === "sell");
                const avgRisk    = parseFloat(_lbAvgRiskScore(trades).toFixed(1));
                const lastTrade  = trades.length > 0 ? trades[0].timestamp : (profile.updatedAt || profile.createdAt);
                const _xp1  = (sells.length * 25) + ((profile.loginStreak || 0) * 10)
                            + (profile.badgeXp || 0) + (profile.socialXp || 0) + (profile.academyXp || 0);
                const _lvl1 = _calcLevel(_xp1);
                entries.push({
                  wallet: profile.wallet || w, accountName: profile.accountName || "Ape",
                  adjReturn, periodPnL, dailyPnL, weeklyPnL, monthlyPnL,
                  totalPnL: parseFloat((profile.totalPnL || 0).toFixed(2)),
                  balance: parseFloat((profile.balance || 10).toFixed(4)),
                  winCount: profile.winCount || 0, lossCount: profile.lossCount || 0,
                  tradeCount: sells.length, avgRiskScore: avgRisk, badges,
                  lastActive: _lbTimeAgo(lastTrade), lastTradeTs: lastTrade,
                  loginStreak: profile.loginStreak || 0,
                  xp: _xp1, level: _lvl1,
                });
              }
              continue; // skip the Blobs parse below
            }
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

            const _xp  = (sells.length * 25) + ((profile.loginStreak || 0) * 10)
                       + (profile.badgeXp || 0) + (profile.socialXp || 0) + (profile.academyXp || 0);
            const _lvl = _calcLevel(_xp);
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
              xp: _xp, level: _lvl,
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
        return { statusCode: 500, headers, body: JSON.stringify({ error: "Internal server error — please retry." }) };
      }
    }

    if (!wallet) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing wallet" }) };
    }

    try {
      // ══════════════════════════════════════════════════════════════════
      // PROFILE READ ORDER:
      //   1. Blobs (source of truth — always try first)
      //   2. Redis  (fallback — only when Blobs token is expired)
      //
      // CRITICAL: Redis is checked SECOND so that a stale/recovery profile
      // cached in Redis never takes precedence over real Blobs data.
      // Recovery profiles are NEVER written to Redis — they are transient.
      // ══════════════════════════════════════════════════════════════════

      // ── Step 1: Try Blobs (retry 4× for cold-start propagation lag) ──
      let raw = await store.get(wallet);
      if (!raw) { await new Promise(r => setTimeout(r, 400)); raw = await store.get(wallet); }
      if (!raw) { await new Promise(r => setTimeout(r, 600)); raw = await store.get(wallet); }
      if (!raw) { await new Promise(r => setTimeout(r, 900)); raw = await store.get(wallet); }

      if (raw) {
        // Blobs returned real data — parse it and refresh Redis cache with the
        // authoritative copy (overwrites any stale/recovery data in Redis).
        const profile = JSON.parse(raw);
        // Only cache genuinely real profiles (not recovery placeholders)
        if (!profile._recovering) redisCacheProfile(wallet, profile);
        await registerInLeaderboard(store, wallet);
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, profile, isNew: false }) };
      }

      // ── Step 2: Blobs returned null — check Redis as fallback ──
      const redisCached = await redisGetCachedProfile(wallet);
      if (redisCached && !redisCached._recovering) {
        // Redis has a real (non-recovery) profile — Blobs token is probably expired.
        console.log("GET: Blobs null, serving real profile from Redis fallback");
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, profile: redisCached, isNew: false }) };
      }

      // ── Step 3: Both null — distinguish existing vs new wallet ──
      const registered = await isWalletRegistered(store, wallet);
      if (registered) {
        // Wallet is in the leaderboard but profile Blob is null after 4 retries.
        // Distinguish three cases using getRaw (throws on Blobs error, null on "not found"):
        //   A) Blobs outage  → getRaw throws         → retry getRaw once, then 503
        //   B) Orphaned Redis → getRaw returns null   → SREM + serve fresh profile
        //   C) Lost profile  → regKey non-null, no profile → extra retries, then reset
        let regKey = null;
        let getRawThrew = false;
        try {
          regKey = await store.getRaw(REG_PREFIX + wallet);
        } catch {
          // getRaw threw — retry once before concluding Blobs is unavailable
          await new Promise(r => setTimeout(r, 900));
          try {
            regKey = await store.getRaw(REG_PREFIX + wallet);
          } catch {
            getRawThrew = true;
          }
        }

        if (!getRawThrew) {
          if (regKey === null) {
            // Case B: Blobs is responding but the __reg_ key doesn't exist — orphaned Redis entry.
            // Remove from Redis so future requests don't loop, then serve fresh profile.
            console.warn("GET: orphaned Redis entry for", wallet.slice(0, 8), "— SREM + serving fresh profile");
            try { await _redisCmd("SREM", LB_REDIS_SET_KEY, wallet); } catch {}
          } else {
            // Case C: __reg_ key exists but profile blob is missing after 4 retries.
            // Give Blobs two more chances with longer delays before treating as lost.
            await new Promise(r => setTimeout(r, 1200));
            raw = await store.get(wallet);
            if (!raw) { await new Promise(r => setTimeout(r, 2000)); raw = await store.get(wallet); }
            if (raw) {
              // Found it — was a propagation lag. Serve it normally.
              const profile = JSON.parse(raw);
              if (!profile._recovering) redisCacheProfile(wallet, profile);
              return { statusCode: 200, headers, body: JSON.stringify({ ok: true, profile, isNew: false }) };
            }
            // Still gone after 6 total retries — profile is permanently lost.
            // Clean up both the leaderboard entry and the dangling __reg_ key so
            // this wallet never lands here again, then issue a fresh profile.
            console.warn("GET: reg key exists but profile permanently gone for", wallet.slice(0, 8), "— resetting");
            try { await _redisCmd("SREM", LB_REDIS_SET_KEY, wallet); } catch {}
            try { await store.set(REG_PREFIX + wallet, ""); } catch {}
          }
          // Both Case B and Case C end here — create and save a fresh profile.
          const freshProfile = {
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
          // Save the fresh profile to Blobs so future GETs skip this whole path.
          try { await store.set(wallet, JSON.stringify(freshProfile)); } catch {}
          return { statusCode: 200, headers, body: JSON.stringify({ ok: true, profile: freshProfile, isNew: true }) };
        }

        // Case A: getRaw threw twice → Blobs is genuinely unavailable.
        // Return a temporary recovery profile so the user isn't kicked to Demo Mode.
        // _recovering:true is checked by Redis cache logic (won't be cached) and by
        // POST handler (which still returns 503 to protect real writes).
        console.warn("GET: registered wallet, Blobs unavailable (getRaw threw) — serving recovery profile");
        return { statusCode: 200, headers, body: JSON.stringify({
          ok: true,
          profile: {
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
            _recovering: true,
          },
          isNew: false,
        }) };
      }

      // ── Step 4: Genuinely new wallet — return default profile ──
      // DO NOT save here: profile is created on the first real action (login/buy/etc).
      const newProfile = {
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
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, profile: newProfile, isNew: true }) };
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
            // Check Redis for a real (non-recovery) profile before giving up.
            const rCached = await redisGetCachedProfile(wallet);
            if (rCached && !rCached._recovering) {
              console.log("POST: restoring profile from Redis (non-recovery) cache");
              raw = JSON.stringify(rCached);
              // raw is now set — fall through to profile = JSON.parse(raw) below
            } else {
              // Both stores unavailable — return 503 to protect real data.
              // NEVER create a fresh profile here: it would permanently wipe
              // the real profile in Blobs when the token next refreshes.
              console.warn("POST action", action, ": registered wallet, Blobs+Redis unavailable — returning 503");
              return { statusCode: 503, headers, body: JSON.stringify({ error: "Profile temporarily unavailable — reconnecting…" }) };
            }
          }
        }
        // raw may have been populated from Redis above — only create fresh if still null
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
      profile.tradeXp      = (profile.tradeXp || 0) + 5;  // +5 XP for daily login

      const dayLabel = `Day ${streak}`;
      const newBadgesLogin = awardNewBadges(profile);
      _sanitizeProfile(profile);
      try { await store.set(wallet, JSON.stringify(profile)); } catch(blobsErr) { console.error("Blobs write failed:", blobsErr.message); } redisCacheProfile(wallet, profile);
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
      _sanitizeProfile(profile);
      try { await store.set(wallet, JSON.stringify(profile)); } catch(blobsErr) { console.error("Blobs write failed:", blobsErr.message); } redisCacheProfile(wallet, profile);
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
      const walletLimited = await checkWalletTradeLimit(wallet);
      if (walletLimited) {
        return { statusCode: 429, headers, body: JSON.stringify({ error: "Too many trades — please wait a few minutes." }) };
      }
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
      if (solPriceForTrade <= 0) {
        return { statusCode: 503, headers, body: JSON.stringify({ error: "SOL price temporarily unavailable — please retry in a moment." }) };
      }
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
      if (profile.trades.length > 50) profile.trades = profile.trades.slice(0, 50); // max 5 pages × 10 items

      const newBadgesBuy = awardNewBadges(profile);
      _sanitizeProfile(profile);
      try { await store.set(wallet, JSON.stringify(profile)); } catch(blobsErr) { console.error("Blobs write failed:", blobsErr.message); } redisCacheProfile(wallet, profile);
      await registerInLeaderboard(store, wallet);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, profile, trade, newBadges: newBadgesBuy }) };
    }

    // ── SELL ──
    if (action === "sell") {
      const walletLimitedSell = await checkWalletTradeLimit(wallet);
      if (walletLimitedSell) {
        return { statusCode: 429, headers, body: JSON.stringify({ error: "Too many trades — please wait a few minutes." }) };
      }
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
      // ── CRITICAL: guard against SOL price = 0 ──────────────────────────────
      // Without this check, totalReceivedSol = value/0 = Infinity, which
      // JSON.stringify serialises as null → wipes the user's balance.
      // The BUY handler already had this guard; SELL was missing it.
      if (solPriceForTrade <= 0) {
        return { statusCode: 503, headers, body: JSON.stringify({ error: "SOL price temporarily unavailable — please retry in a moment." }) };
      }

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

      // ── Unindexed-token price cap ───────────────────────────────────────────
      // If Birdeye couldn't fetch a real price (realSellPrice === null), the token
      // may be delisted or very new.  Cap the sell value at 1000× the buy price to
      // prevent submitting an arbitrarily high price for an untracked token.
      if (realSellPrice === null && holding.avgPrice > 0) {
        const MAX_UNVALIDATED_MULTIPLE = 1000;
        if (parsedSellPrice > holding.avgPrice * MAX_UNVALIDATED_MULTIPLE) {
          console.warn(`SELL price cap (unindexed token ${mint}): submitted=$${parsedSellPrice} avgBuy=$${holding.avgPrice}`);
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Sell price rejected — token is not indexed and submitted price is unrealistic. Refresh and try again." }) };
        }
      }

      const slip             = Math.min(Math.abs(slippage || 0.01), 0.05);
      const effectivePrice   = parsedSellPrice * (1 - slip);
      const totalReceivedUsd = effectivePrice * parsedSellAmount;
      const totalReceivedSol = totalReceivedUsd / solPriceForTrade;   // ← SOL received

      // Extra safety: totalReceivedSol must be finite and positive
      if (!isFinite(totalReceivedSol) || totalReceivedSol < 0) {
        console.error(`SELL: totalReceivedSol=${totalReceivedSol} (solPrice=${solPriceForTrade}) — rejecting`);
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Price calculation error — please retry." }) };
      }

      // Cost basis in SOL — prefer proportional totalCostSol (exact SOL spent).
      // Fall back to avgCostSol per token, then USD estimate for legacy holdings.
      const sellFraction  = parsedSellAmount / (holding.amount || parsedSellAmount);
      const costBasisSol  = holding.totalCostSol > 0
        ? holding.totalCostSol * sellFraction
        : (holding.avgCostSol || (holding.avgPrice / solPriceForTrade)) * parsedSellAmount;
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

      const tradePnlPct = costBasisSol > 0 ? parseFloat(((pnlSol / costBasisSol) * 100).toFixed(4)) : 0;
      // XP reward: floor((1 + pnlPct/100) * 10), min 1, max 100
      // 0% profit → 10 XP, 100% profit → 20 XP, 400% → 50 XP, 900% → 100 XP
      const tradeXp = Math.max(1, Math.min(100, Math.floor((1 + tradePnlPct / 100) * 10)));
      profile.tradeXp = (profile.tradeXp || 0) + tradeXp;

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
        pnlPct: tradePnlPct,
        xpEarned: tradeXp,
        solPriceAtTrade: solPriceForTrade,
        slippage: slip,
        riskScore: riskScore || holding.riskScore || null,
        timestamp: new Date().toISOString(),
      };
      profile.trades.unshift(trade);
      if (profile.trades.length > 50) profile.trades = profile.trades.slice(0, 50); // max 5 pages × 10 items

      const newBadgesSell = awardNewBadges(profile);
      _sanitizeProfile(profile);   // ← guard against any Infinity that slipped through
      try { await store.set(wallet, JSON.stringify(profile)); } catch(blobsErr) { console.error("Blobs write failed:", blobsErr.message); } redisCacheProfile(wallet, profile);
      await registerInLeaderboard(store, wallet);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, profile, trade, newBadges: newBadgesSell }) };
    }

    // ── UPDATE NAME ──
    if (action === "update_name") {
      const accountName = body.accountName;
      if (!accountName || accountName.length > 24) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid name (max 24 chars)" }) };
      }
      profile.accountName = accountName.trim();
      try { await store.set(wallet, JSON.stringify(profile)); } catch(blobsErr) { console.error("Blobs write failed:", blobsErr.message); } redisCacheProfile(wallet, profile);
      return { statusCode: 200, headers, body: JSON.stringify({ profile }) };
    }

    // ── MIGRATE TO SOL ──
    // Converts a legacy USD-denominated profile to SOL denomination.
    // The client sends the current SOL price so we don't need another fetch.
    if (action === "migrate_to_sol") {
      if (profile.balanceCurrency === "sol") {
        return { statusCode: 200, headers, body: JSON.stringify({ profile, alreadyMigrated: true }) };
      }
      // Always fetch SOL price server-side — never trust client-submitted price
      // (a client could send solPrice:0.001 to inflate balance 150×).
      const solPriceMig = await fetchSolPriceServer();

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
      try { await store.set(wallet, JSON.stringify(profile)); } catch(blobsErr) { console.error("Blobs write failed:", blobsErr.message); } redisCacheProfile(wallet, profile);
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
      // Security: cap balance + recompute winCount from actual trade data so a
      // tampered localStorage backup can't give a user an unlimited balance or
      // trigger high-win badges fraudulently.
      const MAX_RESTORE_BALANCE = 1000; // 100× starting — covers any legitimate user
      bp.balance = Math.min(MAX_RESTORE_BALANCE, Math.max(0, parseFloat(bp.balance) || STARTING_BALANCE_SOL));
      // Recompute winCount/lossCount from the trade array (capped at 30 entries, so
      // allow a small discrepancy for long-time traders whose oldest trades were trimmed).
      const _bpSells  = (bp.trades || []).filter(t => t.type === "sell");
      const _bpWins   = _bpSells.filter(t => (t.pnl || 0) > 0).length;
      const _bpLosses = _bpSells.filter(t => (t.pnl || 0) <  0).length;
      bp.winCount  = Math.min(bp.winCount  || 0, _bpWins  + 5);
      bp.lossCount = Math.min(bp.lossCount || 0, _bpLosses + 5);
      // Strip badge list — recomputed fresh on next action to prevent tampered
      // backups from claiming badge SOL rewards that were never legitimately earned.
      bp.badges  = [];
      bp.badgeXp = Math.min(bp.badgeXp || 0, 5000);
      bp.wallet     = wallet;
      bp.restoredAt = new Date().toISOString();
      _sanitizeProfile(bp);
      console.log("restore_backup: saving backup for", wallet, "balance=", bp.balance, "wins=", bp.winCount);
      try { await store.set(wallet, JSON.stringify(bp)); } catch(blobsErr) { console.error("Blobs write failed:", blobsErr.message); } redisCacheProfile(wallet, bp);
      await registerInLeaderboard(store, wallet);
      return { statusCode: 200, headers, body: JSON.stringify({
        profile: bp, restored: true, message: "Profile restored from local backup" }) };
    }

    // ── RESET ──
    if (action === "reset") {
      profile.balance              = STARTING_BALANCE_SOL;
      profile.balanceCurrency      = "sol";
      profile.holdings             = {};
      profile.trades               = [];
      profile.totalPnL             = 0;
      profile.winCount             = 0;
      profile.lossCount            = 0;
      profile.badges               = [];   // ← clear badges so rewards can be earned again
      profile.badgeXp              = 0;    // ← clear badge XP
      profile.socialXp             = 0;    // ← clear social task XP
      profile.academyXp            = 0;    // ← clear academy XP
      profile.academyProgress      = {};   // ← clear guide completions so XP/SOL rewards can be earned again
      profile.socialTasksClaimed   = [];   // ← allow re-completing social tasks
      // Mark old pending SOL payouts as cancelled to prevent double-payment after re-claim
      if (Array.isArray(profile.pendingSolPayouts)) {
        profile.pendingSolPayouts = profile.pendingSolPayouts.map(p => ({ ...p, cancelled: true, cancelledAt: new Date().toISOString() }));
      }
      profile.lastLogin            = null; // ← reset daily login so streak restarts from Day 1
      profile.loginStreak          = 0;
      profile.welcomeGiftClaimed   = false; // ← allow re-claiming welcome gift after reset
      profile.updatedAt            = new Date().toISOString(); // ← leaderboard uses this for "Last Active"
      _sanitizeProfile(profile);
      try { await store.set(wallet, JSON.stringify(profile)); } catch(blobsErr) { console.error("Blobs write failed:", blobsErr.message); } redisCacheProfile(wallet, profile);
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
