// netlify/functions/leaderboard.js
// Safe Ape Leaderboard — reads from simulator store via wallet index
// CommonJS format

// Shared in-memory fallback for local dev.
// By requiring the same module, both simulator and leaderboard share data locally.
const localStore = require("./_localStore");

async function getStore() {
  try {
    const { getStore } = require("@netlify/blobs");
    const store = getStore("simulator");
    return {
      async get(key) { return await store.get(key); },
      async set(key, val) { await store.set(key, val); }
    };
  } catch(e) {
    console.warn("@netlify/blobs not available, using in-memory store (local dev)");
    return {
      async get(key) { return localStore[key] || null; },
      async set(key, val) { localStore[key] = val; }
    };
  }
}

/* ── Badge definitions ── */
const BADGE_DEFS = [
  { id: "first_profit",    icon: "🏆", name: "First Profit",          desc: "Made your first profitable trade" },
  { id: "win_streak_5",   icon: "🔥", name: "Win Streak x5",         desc: "Won 5 trades in a row" },
  { id: "safe_trader",    icon: "🛡️", name: "Safe Trader",            desc: "Buy 10 tokens with entry risk score ≥ 65" },
  { id: "diamond_hands",  icon: "💎", name: "Diamond Hands",          desc: "Held a token for 7+ days" },
  { id: "degen_survivor", icon: "🦍", name: "Degen Survivor",         desc: "Profit 10× on tokens with risk score < 45 (1 sell per buy)" },
  { id: "portfolio_100",  icon: "📈", name: "100% Growth",            desc: "Doubled your $10K balance" },
  { id: "wins_25",        icon: "⭐", name: "25 Safe Wins",           desc: "25 profitable trades" },
  { id: "wins_50",        icon: "🌟", name: "50 Safe Wins",           desc: "50 profitable trades" },
  { id: "wins_100",       icon: "💫", name: "100 Safe Wins",          desc: "100 profitable trades" },
  { id: "wins_500",       icon: "🚀", name: "500 Safe Wins",          desc: "500 profitable trades" },
  { id: "wins_1000",      icon: "🐐", name: "1000 Safe Wins — GOAT",  desc: "The absolute GOAT." },
];

/* ── Wallet index ── */
async function getIndex(store) {
  try {
    const raw = await store.get("__lb_index__");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch(e) {
    console.warn("getIndex error:", e.message);
    return [];
  }
}

async function addToIndex(store, wallet) {
  try {
    const index = await getIndex(store);
    if (!index.includes(wallet)) {
      index.push(wallet);
      await store.set("__lb_index__", JSON.stringify(index));
    }
  } catch(e) {
    console.warn("addToIndex error:", e.message);
  }
}

/* ── Badge computation ── */
function computeBadges(profile) {
  const badges   = [];
  const trades   = profile.trades || [];
  const sells    = trades.filter(t => t.type === "sell");
  const winCount = profile.winCount || 0;

  if (sells.some(t => (t.pnl || 0) > 0))                                              badges.push("first_profit");
  if (checkStreak(sells, 5))                                                            badges.push("win_streak_5");
  if (trades.length >= 3 && getAvgRiskScore(trades) >= 65)                             badges.push("safe_trader");
  if (checkDiamondHands(trades))                                                        badges.push("diamond_hands");
  if (sells.some(t => (t.pnl||0) > 0 && t.riskScore != null && t.riskScore < 45))    badges.push("degen_survivor");
  if ((profile.balance || 0) >= 20000)                                                 badges.push("portfolio_100");
  if (winCount >= 25)   badges.push("wins_25");
  if (winCount >= 50)   badges.push("wins_50");
  if (winCount >= 100)  badges.push("wins_100");
  if (winCount >= 500)  badges.push("wins_500");
  if (winCount >= 1000) badges.push("wins_1000");

  return badges;
}

function checkStreak(sells, n) {
  let streak = 0;
  for (const t of sells) {
    if ((t.pnl || 0) > 0) { streak++; if (streak >= n) return true; }
    else streak = 0;
  }
  return false;
}

function getAvgRiskScore(trades) {
  const withScore = trades.filter(t => t.riskScore != null && !isNaN(Number(t.riskScore)));
  if (!withScore.length) return 50;
  return withScore.reduce((s, t) => s + Number(t.riskScore), 0) / withScore.length;
}

function checkDiamondHands(trades) {
  const buys  = trades.filter(t => t.type === "buy");
  const sells = trades.filter(t => t.type === "sell");
  for (const b of buys) {
    const sell = sells.find(s => s.mint === b.mint && new Date(s.timestamp) > new Date(b.timestamp));
    if (sell) {
      const days = (new Date(sell.timestamp) - new Date(b.timestamp)) / 86400000;
      if (days >= 7) return true;
    }
  }
  return false;
}

/* ── Risk-adjusted return ── */
function computeRiskAdjReturn(profile) {
  const start   = 10000;
  const balance = profile.balance || start;
  const pnlPct  = ((balance - start) / start) * 100;
  const trades  = profile.trades || [];
  const avgRisk = getAvgRiskScore(trades); // defaults to 50 if no scored trades
  return parseFloat((pnlPct * (avgRisk / 100)).toFixed(2));
}

/* ── Period P/L ── */
function getStartDate(period) {
  const now = new Date();
  if (period === "daily")   return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "weekly")  { const d = new Date(now); d.setDate(d.getDate() - d.getDay()); d.setHours(0,0,0,0); return d; }
  if (period === "monthly") return new Date(now.getFullYear(), now.getMonth(), 1);
  return new Date(0);
}

function getPeriodPnL(profile, period) {
  if (period === "alltime") return profile.totalPnL || 0;
  const cutoff = getStartDate(period);
  return (profile.trades || [])
    .filter(t => t.type === "sell" && !isNaN(t.pnl) && new Date(t.timestamp) >= cutoff)
    .reduce((s, t) => s + parseFloat(t.pnl || 0), 0);
}

function timeAgo(isoStr) {
  if (!isoStr) return "Never";
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs/24)}d ago`;
}

function calcSol2MoonReward(rank, adjReturn) {
  if (rank === 1) return 5000;
  if (rank === 2) return 3000;
  if (rank === 3) return 2000;
  if (rank <= 5)  return 1000;
  if (rank <= 10) return 500;
  if (rank <= 25) return 250;
  if (adjReturn > 0) return 100;
  return 0;
}

/* ── MAIN HANDLER ── */
exports.handler = async function(event, context) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };

  const store = await getStore();

  /* ── GET: return leaderboard ── */
  if (event.httpMethod === "GET") {
    const period = (event.queryStringParameters && event.queryStringParameters.period) || "alltime";

    try {
      const wallets = await getIndex(store);

      const entries = [];

      for (const w of wallets) {
        // Skip the index key itself if it somehow ends up in the list
        if (w === "__lb_index__") continue;
        try {
          const raw = await store.get(w);
          if (!raw) continue;
          const profile = JSON.parse(raw);

          // Skip future-dated profiles (anti-cheat)
          if (profile.createdAt && new Date(profile.createdAt) > new Date(Date.now() + 60000)) continue;

          const adjReturn  = computeRiskAdjReturn(profile);
          const periodPnL  = getPeriodPnL(profile, period);
          const badges     = computeBadges(profile);
          const trades     = profile.trades || [];
          const sells      = trades.filter(t => t.type === "sell");
          const avgRisk    = parseFloat(getAvgRiskScore(trades).toFixed(1));
          const lastTrade  = trades.length > 0 ? trades[0].timestamp : profile.createdAt;

          entries.push({
            wallet:       profile.wallet || w,
            accountName:  profile.accountName || "Ape",
            adjReturn,
            periodPnL:    parseFloat(periodPnL.toFixed(2)),
            totalPnL:     parseFloat((profile.totalPnL || 0).toFixed(2)),
            balance:      parseFloat((profile.balance || 10000).toFixed(2)),
            winCount:     profile.winCount  || 0,
            lossCount:    profile.lossCount || 0,
            tradeCount:   sells.length,
            avgRiskScore: avgRisk,
            badges,
            lastActive:   timeAgo(lastTrade),
            lastTradeTs:  lastTrade,
            loginStreak:  profile.loginStreak || 0,
          });
        } catch(e) {
          console.warn(`Failed to process wallet ${w}:`, e.message);
        }
      }

      // Sort: highest risk-adjusted return first
      entries.sort((a, b) => b.adjReturn - a.adjReturn);

      // Assign rank + Sol2Moon rewards
      entries.forEach((e, i) => {
        e.rank = i + 1;
        e.sol2moonReward = calcSol2MoonReward(i + 1, e.adjReturn);
      });

      // Simple MVP: top entry by period PnL
      const byPeriodPnl = [...entries].sort((a, b) => b.periodPnL - a.periodPnL);
      const mvp = {
        daily:   byPeriodPnl[0] || null,
        weekly:  byPeriodPnl[0] || null,
        monthly: byPeriodPnl[0] || null,
        alltime: entries[0]     || null,
      };

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          entries:   entries.slice(0, 100),
          total:     entries.length,
          period,
          mvp,
          badgeDefs: BADGE_DEFS,
          timestamp: new Date().toISOString(),
        })
      };
    } catch(e) {
      console.error("Leaderboard GET error:", e);
      return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
    }
  }

  /* ── POST: submit / register wallet ── */
  if (event.httpMethod === "POST") {
    let body;
    try { body = JSON.parse(event.body || "{}"); }
    catch { return { statusCode: 400, headers, body: JSON.stringify({ error: "Bad JSON" }) }; }

    const wallet = body.wallet;
    if (!wallet) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing wallet" }) };

    try {
      const raw = await store.get(wallet);
      if (!raw) {
        // Profile doesn't exist yet — register so it appears once created
        await addToIndex(store, wallet);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: "Registered" }) };
      }

      const profile = JSON.parse(raw);

      // Anti-cheat: reject future-dated profiles
      if (profile.createdAt && new Date(profile.createdAt) > new Date(Date.now() + 60000)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid profile timestamp" }) };
      }

      // Register in index
      await addToIndex(store, wallet);

      // Compute badges and save back to profile
      const badges    = computeBadges(profile);
      const adjReturn = computeRiskAdjReturn(profile);
      profile.badges  = badges;
      await store.set(wallet, JSON.stringify(profile));

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, adjReturn, badges, message: "Score submitted!" })
      };
    } catch(e) {
      console.error("Leaderboard POST error:", e);
      return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
};