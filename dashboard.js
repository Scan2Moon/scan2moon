/* ============================================================
   Scan2Moon – dashboard.js  (V1.0 — structure + fake data)
   Full real-data wiring comes in V1.1 when Safe Ape moves here.
   ============================================================ */

import { renderNav }           from "./nav.js";
import { applyTranslations }   from "./i18n.js";

const SIM_API          = "/.netlify/functions/simulator";
const DEX_API          = "https://api.dexscreener.com/latest/dex/tokens/";
const JUP_API          = "https://api.jup.ag/price/v2";
const SOL_LOGO         = "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png";
const TREASURY_WALLET  = "6zbVz412Yn7kHeuy8pBX8crfAa53jDLTqoNfHJmmTBVs";
const SOL_MINT         = "So11111111111111111111111111111111111111112";

/* ── Purchase helpers ─────────────────────────────────────── */
function getPurchased() {
  try { return JSON.parse(localStorage.getItem("sa_purchased") || "[]"); } catch { return []; }
}
function isPurchased(id) { return getPurchased().some(p => p.id === id); }
function savePurchase(id, type, priceUsd, txSig) {
  const list = getPurchased();
  if (!list.some(p => p.id === id)) {
    list.push({ id, type, priceUsd, txSig, ts: new Date().toISOString() });
    localStorage.setItem("sa_purchased", JSON.stringify(list));
  }
}

async function getSolPriceUsd() {
  /* Try 3 independent APIs — return the first that works */

  /* 1. Binance public API — best CORS support */
  try {
    const r = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT",
      { signal: AbortSignal.timeout(4000) });
    const d = await r.json();
    const p = parseFloat(d?.price);
    if (p > 1) return p;
  } catch { /* fall through */ }

  /* 2. CoinGecko free tier */
  try {
    const r = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
      { signal: AbortSignal.timeout(5000) });
    const d = await r.json();
    const p = parseFloat(d?.solana?.usd);
    if (p > 1) return p;
  } catch { /* fall through */ }

  /* 3. Jupiter v2 (may be blocked on localhost but fine in production) */
  try {
    const r = await fetch(`${JUP_API}?ids=${SOL_MINT}`,
      { signal: AbortSignal.timeout(4000) });
    const d = await r.json();
    const p = parseFloat(d?.data?.[SOL_MINT]?.price);
    if (p > 1) return p;
  } catch { /* fall through */ }

  return 0; /* all failed */
}

/* Capture a single frame from a video URL as a data-URL (for html2canvas) */
async function captureVideoFrame(videoSrc) {
  return new Promise(resolve => {
    const v = document.createElement("video");
    v.src = videoSrc; v.muted = true; v.crossOrigin = "anonymous";
    v.onloadeddata = () => {
      const c = document.createElement("canvas");
      c.width = v.videoWidth || 96; c.height = v.videoHeight || 96;
      c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/png"));
    };
    v.onerror = () => resolve(null);
    v.load();
  });
}

/* ── Security helpers ─────────────────────────────────────── */
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function isValidSolanaAddress(addr) {
  return typeof addr === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
}

/* ── Frame definitions (avatar border effects) ─────────────── */
const FRAME_DEFS = [
  { id: "frame_none",        name: "No Frame",    icon: "⬜", desc: "Clean look, no border effect.",                          price: 0,    freebie: true, cssClass: ""                },
  { id: "frame_moon_pulse",  name: "Moon Pulse",  icon: "🌙", desc: "Pulsing teal scan glow — the signature S2M energy.",     price: 0,    freebie: true, cssClass: "frame-moon-pulse" },
  { id: "frame_solar_flare", name: "Solar Flare", icon: "☀️", desc: "Burning gold glow. Heat of a thousand green candles.",  price: 0.5,  market: true,  cssClass: "frame-solar-flare"},
  { id: "frame_degen_neon",  name: "Degen Neon",  icon: "💜", desc: "Hot pink neon ring. Pure degen energy.",                price: 0.5,  market: true,  cssClass: "frame-degen-neon" },
  { id: "frame_diamond",     name: "Diamond Edge",icon: "💎", desc: "Elite shifting crystalline diamond border.",            price: 1.0,  market: true,  cssClass: "frame-diamond"    },
];

/* ── Profile card design definitions ───────────────────────── */
const CARD_DESIGN_DEFS = [
  { id: "card_classic",    name: "Classic",     icon: "🌿", desc: "Default dark green Scan2Moon card.",           price: 0,    freebie: true },
  { id: "card_neon_degen", name: "Neon Degen",  icon: "💜", desc: "Deep purple with pink & green neon vibes.",    price: 0,    freebie: true },
  { id: "card_galaxy",     name: "Galaxy",      icon: "🌌", desc: "Deep space starfield. Trade among the stars.", price: 0.75, market: true  },
  { id: "card_gold",       name: "Gold Trophy", icon: "🏆", desc: "Championship gold aesthetic. Winners only.",   price: 0.75, market: true  },
];

/* ── Card colour themes ─────────────────────────────────────── */
const CARD_THEMES = {
  card_classic: {
    bg: "linear-gradient(160deg,#040f0d 0%,#0a2018 60%,#040f0d 100%)",
    border: "rgba(44,255,201,0.28)", logo: "#2cffc9", accent: "#ffb432",
    statHi: "#2cffc9", name: "#cffff4", level: "#7fffe1",
    wallet: "rgba(44,255,201,0.4)", footer: "rgba(44,255,201,0.25)",
    hdrBorder: "rgba(44,255,201,0.15)", tag: "TRADER PROFILE",
  },
  card_neon_degen: {
    bg: "linear-gradient(160deg,#0d0820 0%,#1a0830 60%,#0a0518 100%)",
    border: "rgba(200,100,255,0.38)", logo: "#ff6eb4", accent: "#c084fc",
    statHi: "#ff6eb4", name: "#f0d0ff", level: "#c084fc",
    wallet: "rgba(200,100,255,0.4)", footer: "rgba(200,100,255,0.25)",
    hdrBorder: "rgba(200,100,255,0.15)", tag: "DEGEN PROFILE",
  },
};

/* ── Badge categories ─────────────────────────────────────── */
const BADGE_CATEGORIES = [
  { id: "trading", icon: "🦍", label: "Safe Ape Trading", color: "#2cffc9",  bgColor: "rgba(44,255,201,0.12)",  borderColor: "rgba(44,255,201,0.35)"  },
  { id: "academy", icon: "🎓", label: "Academy",          color: "#ffb432",  bgColor: "rgba(255,180,50,0.12)",  borderColor: "rgba(255,180,50,0.35)"  },
  { id: "other",   icon: "🌟", label: "Other",            color: "#c084fc",  bgColor: "rgba(192,132,252,0.12)", borderColor: "rgba(192,132,252,0.35)" },
  { id: "pro",     icon: "💎", label: "PRO",              color: "#60a5fa",  bgColor: "rgba(96,165,250,0.12)",  borderColor: "rgba(96,165,250,0.35)"  },
  { id: "levels",   icon: "⭐", label: "Account Levels",   color: "#ffd700",  bgColor: "rgba(255,215,0,0.12)",   borderColor: "rgba(255,215,0,0.4)"    },
  { id: "cosmetics",icon: "✨", label: "Cosmetics",        color: "#ff6eb4",  bgColor: "rgba(255,110,180,0.12)", borderColor: "rgba(255,110,180,0.4)"  },
];

/* ── Badge definitions ────────────────────────────────────── */
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
  { id: "lesson_1",      cat: "academy", subcat: "rank", img: "/badges/lesson_1.png",      icon: "🎯", name: "First Lesson",      desc: "Complete your very first lesson in the Scan2Moon Academy.",                        reward: 0.1  },
  { id: "risk_master",   cat: "academy", subcat: "rank", img: "/badges/risk_master.png",   icon: "📊", name: "Risk Master",       desc: "Score 100% on the Risk Scanner knowledge quiz. Perfect understanding!",           reward: 0.25 },
  { id: "scanner_pro",   cat: "academy", subcat: "rank", img: "/badges/scanner_pro.png",   icon: "🛡️", name: "Scanner Pro",       desc: "Complete the full Risk Scanner deep-dive course from start to finish.",           reward: 0.5  },
  { id: "chart_reader",  cat: "academy", subcat: "rank", img: "/badges/chart_reader.png",  icon: "📈", name: "Chart Reader",      desc: "Pass the Chart Reading & Candle Analysis challenge with 80%+ accuracy.",          reward: 0.25 },
  { id: "whale_watcher", cat: "academy", subcat: "rank", img: "/badges/whale_watcher.png", icon: "🐋", name: "Whale Watcher",     desc: "Complete the Whale DNA module and learn how to track smart money.",                reward: 0.25 },
  { id: "defi_graduate", cat: "academy", subcat: "rank", img: "/badges/defi_graduate.png", icon: "🏛️", name: "DeFi Graduate",     desc: "Complete every module in the Scan2Moon Academy. Full graduate status!",           reward: 1.0  },

  /* ── Academy Guide Badges ── */
  { id: "guide_risk_scanner", cat: "academy", subcat: "guide", img: "/badges/guide_risk_scanner.png", icon: "📊", name: "From Zero to Moon",         desc: "Complete the 'S2M – From Zero to Moon' guide. You now understand Risk Scores, Signals and Red Flags.",  reward: 0.15 },
  { id: "guide_whale_dna",    cat: "academy", subcat: "guide", img: "/badges/guide_whale_dna.png",    icon: "🐋", name: "Track the Smart Money",      desc: "Complete the Whale DNA guide. You can now follow wallet behavior and spot early smart-money accumulation.", reward: 0.15 },
  { id: "guide_safe_ape",     cat: "academy", subcat: "guide", img: "/badges/guide_safe_ape.png",     icon: "🦍", name: "Paper Trade Before You Risk", desc: "Complete the Safe Ape Simulator guide. Strategy tested, discipline built — zero real SOL at risk.",          reward: 0.15 },

  /* ── Academy Level ── */
  { id: "acad_lvl_1", cat: "academy", subcat: "level", img: "/badges/acad_lvl_1.png", icon: "📖", name: "Academy LVL 1 — Enrolled",   desc: "Earn your first Academy Rank badge. The journey begins!",                  reward: 0.05 },
  { id: "acad_lvl_2", cat: "academy", subcat: "level", img: "/badges/acad_lvl_2.png", icon: "✏️", name: "Academy LVL 2 — Student",    desc: "Earn 2 Academy Rank badges. You are officially a student.",                reward: 0.1  },
  { id: "acad_lvl_3", cat: "academy", subcat: "level", img: "/badges/acad_lvl_3.png", icon: "📚", name: "Academy LVL 3 — Scholar",    desc: "Earn 3 Academy Rank badges. Knowledge is compounding.",                    reward: 0.2  },
  { id: "acad_lvl_4", cat: "academy", subcat: "level", img: "/badges/acad_lvl_4.png", icon: "🎓", name: "Academy LVL 4 — Advanced",   desc: "Earn 4 Academy Rank badges. You're ahead of 90% of traders.",             reward: 0.4  },
  { id: "acad_lvl_5", cat: "academy", subcat: "level", img: "/badges/acad_lvl_5.png", icon: "🏆", name: "Academy LVL 5 — Professor",  desc: "Earn all 5 core Academy Rank badges. You are the one who teaches now.",   reward: 1.0  },

  /* ── Other ── */
  { id: "early_adopter",  cat: "other", img: "/badges/early_adopter.png",  icon: "⚡", name: "Early Adopter",   desc: "Joined Scan2Moon before the V2 public launch. OG status forever.",              reward: 0.5  },
  { id: "community_og",   cat: "other", img: "/badges/community_og.png",   icon: "🐦", name: "Community OG",    desc: "Followed @Scan2Moon on X and joined the community from the start.",             reward: 0.1  },
  { id: "streak_7",       cat: "other", img: "/badges/streak_7.png",       icon: "🔥", name: "7-Day Streak",    desc: "Log in 7 days in a row. Consistency is the edge most traders don't have.",      reward: 0.15 },
  { id: "watchlist_pro",  cat: "other", img: "/badges/watchlist_pro.png",  icon: "⭐", name: "Watchlist Pro",   desc: "Add 10 or more tokens to your personal Scan2Moon Watchlist.",                   reward: 0.1  },
  { id: "sharer",         cat: "other", img: "/badges/sharer.png",         icon: "📢", name: "Alpha Sharer",    desc: "Share a risk scan result on X. Spreading real data, not hype.",                 reward: 0.1  },

  /* ── PRO ── */
  { id: "pro_scanner",   cat: "pro", img: "/badges/pro_scanner.png",   icon: "🛡️", name: "Pro Scanner",     desc: "Run 100 total risk scans. You have seen enough charts to know the difference.", reward: 0.5  },
  { id: "alpha_caller",  cat: "pro", img: "/badges/alpha_caller.png",  icon: "🎯", name: "Alpha Caller",    desc: "Correctly predict 3 tokens that go 10× before they pump. Real alpha.",          reward: 2.0  },
  { id: "whale_analyst", cat: "pro", img: "/badges/whale_analyst.png", icon: "🐋", name: "Whale Analyst",   desc: "Successfully identify 5 whale wallet patterns using Whale DNA scanner.",         reward: 1.0  },
  { id: "top_10",        cat: "pro", img: "/badges/top_10.png",        icon: "🏆", name: "Top 10",          desc: "Reach the top 10 on the Scan2Moon Leaderboard. Elite trader confirmed.",         reward: 5.0  },

  /* ── Cosmetics — Free ── */
  { id: "cosm_classic_ape",   cat: "cosmetics", subcat: "free",         freebie: true,
    img: null, icon: "🦍", name: "Classic Ape",
    desc: "The original Ape Trader look. Free for every Scan2Moon user — always unlocked.", reward: 0 },

  /* ── Cosmetics — Community Badges ── */
  { id: "cosm_love_solana",   cat: "cosmetics", subcat: "community",    market: true, priceUsd: 0.99,
    img: "/badges/Love_Solana.png", icon: "❤️", name: "I Love Solana",
    desc: "Show your love for the fastest chain in the game.", reward: 0 },
  { id: "cosm_love_s2m",      cat: "cosmetics", subcat: "community",    market: true, priceUsd: 0.99,
    img: "/badges/Love_S2M.png",    icon: "🌙", name: "I Love S2M",
    desc: "A true Scan2Moon believer — the OG community badge.", reward: 0 },

  /* ── Cosmetics — Moon Krakens (animated MP4) ── */
  { id: "kraken_skeleton",    cat: "cosmetics", subcat: "moon_krakens", market: true, priceUsd: 4.99,
    type: "video", video: "/badges/Moon_Krakens_Bages/%23006.mp4", icon: "💀", name: "Skeleton",
    desc: "Moon Krakens #006 — Skeleton. Fully animated avatar badge.", reward: 0 },
  { id: "kraken_badboy",      cat: "cosmetics", subcat: "moon_krakens", market: true, priceUsd: 4.99,
    type: "video", video: "/badges/Moon_Krakens_Bages/%23005.mp4", icon: "😈", name: "Bad Boy",
    desc: "Moon Krakens #005 — Bad Boy. Fully animated avatar badge.", reward: 0 },
  { id: "kraken_pirate",      cat: "cosmetics", subcat: "moon_krakens", market: true, priceUsd: 4.99,
    type: "video", video: "/badges/Moon_Krakens_Bages/%23004.mp4", icon: "🏴‍☠️", name: "Pirate",
    desc: "Moon Krakens #004 — Pirate. Fully animated avatar badge.", reward: 0 },

  /* ── Account Levels ── */
  { id: "lvl_1",   cat: "levels", img: "/badges/lvl_1.png",   icon: "🌱", name: "Level 1 — First Step",   desc: "Reach Account Level 1. Every legend starts with a single step.", reward: 0.05 },
  { id: "lvl_5",   cat: "levels", img: "/badges/lvl_5.png",   icon: "🔥", name: "Level 5 — Getting Warm",  desc: "Reach Account Level 5. You're building momentum — keep going!",   reward: 0.1  },
  { id: "lvl_10",  cat: "levels", img: "/badges/lvl_10.png",  icon: "💪", name: "Level 10 — Veteran",      desc: "Reach Account Level 10. A true Scan2Moon veteran. Respect.",       reward: 0.25 },
  { id: "lvl_20",  cat: "levels", img: "/badges/lvl_20.png",  icon: "🧠", name: "Level 20 — Smart Money",  desc: "Reach Account Level 20. You clearly understand how this works.",    reward: 0.5  },
  { id: "lvl_30",  cat: "levels", img: "/badges/lvl_30.png",  icon: "💎", name: "Level 30 — Diamond Mind", desc: "Reach Account Level 30. Elite mentality. Diamond hands, diamond brain.", reward: 1.0  },
  { id: "lvl_50",  cat: "levels", img: "/badges/lvl_50.png",  icon: "🚀", name: "Level 50 — Half Moon",    desc: "Reach Account Level 50. Halfway to the moon and already a legend.",  reward: 2.0  },
  { id: "lvl_100", cat: "levels", img: "/badges/lvl_100.png", icon: "🌙", name: "Level 100 — Sol2Moon",    desc: "Reach Account Level 100. Maximum level. You ARE the moon. Absolute GOAT.", reward: 10.0 },
];

/* ── XP / Level system (fake for now, real data V1.1) ─────── */
/*
  XP formula (planned):
    +10 XP per scan
    +25 XP per trade closed
    +50 XP per badge earned
    +5  XP per day streak
  Level thresholds: 0, 100, 250, 500, 900, 1400, 2050, 2850, 3800, 5000, …
*/
const XP_THRESHOLDS = [0, 100, 250, 500, 900, 1400, 2050, 2850, 3800, 5000, 6500, 8500, 11000];

function calcLevel(xp) {
  let lvl = 1;
  for (let i = 1; i < XP_THRESHOLDS.length; i++) {
    if (xp >= XP_THRESHOLDS[i]) lvl = i + 1;
    else break;
  }
  return lvl;
}

function xpForLevel(lvl) { return XP_THRESHOLDS[lvl - 1] || 0; }
function xpForNextLevel(lvl) { return XP_THRESHOLDS[lvl] || XP_THRESHOLDS[XP_THRESHOLDS.length - 1]; }

/* ── Rank badge ───────────────────────────────────────────── */
function rankLabel(pnl) {
  if (pnl > 50)      return "🌕 Sol2Moon Legend";
  if (pnl > 10)      return "💎 Diamond Trader";
  if (pnl > 1)       return "🧠 Smart Money";
  if (pnl > 0)       return "📈 Profitable Ape";
  if (pnl > -2)      return "🎓 Learning Ape";
  return "💀 Rugged Survivor";
}

/* ── Badge progress (for "Next to Unlock" strip) ─────────── */
function badgeProgress(id) {
  const wins   = profile.winCount    || 0;
  const bal    = profile.balance     || 10;
  const streak = profile.loginStreak || 0;
  switch (id) {
    case "wins_25":              return { cur: wins,                  max: 25,    label: `${wins} wins`          };
    case "wins_50":              return { cur: wins,                  max: 50,    label: `${wins} wins`          };
    case "wins_100":             return { cur: wins,                  max: 100,   label: `${wins} wins`          };
    case "wins_500":             return { cur: wins,                  max: 500,   label: `${wins} wins`          };
    case "wins_1000":            return { cur: wins,                  max: 1000,  label: `${wins} wins`          };
    case "portfolio_100":        return { cur: Math.max(0, bal - 10), max: 10,    label: `${formatSol(bal)} bal` };
    case "sol2moon_millionaire": return { cur: bal,                   max: 10000, label: `${formatSol(bal)} bal` };
    case "streak_7":             return { cur: streak,                max: 7,     label: `${streak}d streak`     };
    /* Academy Level badges — progress = how many rank badges earned */
    case "acad_lvl_1": case "acad_lvl_2": case "acad_lvl_3":
    case "acad_lvl_4": case "acad_lvl_5": {
      const RANK_IDS  = ["lesson_1","risk_master","scanner_pro","chart_reader","whale_watcher"];
      const earned    = (profile.badges || []).filter(id => RANK_IDS.includes(id)).length;
      const target    = { acad_lvl_1:1, acad_lvl_2:2, acad_lvl_3:3, acad_lvl_4:4, acad_lvl_5:5 }[id];
      return { cur: earned, max: target, label: `${earned} / ${target} rank badges` };
    }
    /* Level badges — compute current account level inline */
    case "lvl_1": case "lvl_5": case "lvl_10":
    case "lvl_20": case "lvl_30": case "lvl_50": case "lvl_100": {
      const wins   = profile.winCount   || 0;
      const losses = profile.lossCount  || 0;
      const badges = (profile.badges    || []).length;
      const xp     = (wins + losses) * 25 + badges * 50 + streak * 5
                   + (profile.socialXp  || 0)
                   + (profile.academyXp || 0);
      const lvl    = calcLevel(xp);
      const target = { lvl_1:1, lvl_5:5, lvl_10:10, lvl_20:20, lvl_30:30, lvl_50:50, lvl_100:100 }[id];
      return { cur: lvl, max: target, label: `LVL ${lvl}` };
    }
    default:                     return null;
  }
}

/* ── State ────────────────────────────────────────────────── */
let wallet      = null;
let profile     = null;
let dashPrices  = {};      /* mint → USD price (live)   */
let dashPriceTimer = null; /* setInterval handle        */

/* ── Live price fetching ─────────────────────────────────── */
const VALID_MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

async function fetchDashPrices() {
  const holdings = profile?.holdings || {};
  const mints    = Object.keys(holdings).filter(k =>
    (holdings[k]?.amount || 0) > 0.000001 && VALID_MINT.test(k)
  );
  if (!mints.length) return;

  for (let i = 0; i < mints.length; i += 100) {
    const slice = mints.slice(i, i + 100);
    let   fetched = false;

    /* Primary: Jupiter Price API v2 */
    try {
      const res  = await fetch(`${JUP_API}?ids=${slice.join(",")}`);
      if (res.ok) {
        const data = await res.json();
        for (const [mint, info] of Object.entries(data.data || {})) {
          const p = parseFloat(info?.price || "0");
          if (p > 0) { dashPrices[mint] = p; fetched = true; }
        }
      }
    } catch (e) { console.warn("Dashboard Jupiter price error:", e); }

    /* Fallback: DexScreener */
    if (!fetched) {
      try {
        const res  = await fetch(`${DEX_API}${slice.join(",")}`);
        const data = await res.json();
        for (const pair of data.pairs || []) {
          if (pair.chainId !== "solana") continue;
          const price = parseFloat(pair.priceUsd || "0");
          if (price <= 0) continue;
          const base  = pair.baseToken?.address;
          const quote = pair.quoteToken?.address;
          if (base  && slice.includes(base)  && !dashPrices[base])  dashPrices[base]  = price;
          if (quote && slice.includes(quote) && !dashPrices[quote] && pair.priceNative > 0)
            dashPrices[quote] = 1 / parseFloat(pair.priceNative);
        }
      } catch (e) { console.warn("Dashboard DexScreener fallback error:", e); }
    }
  }

  refreshHoldingsPnL(); /* update DOM in-place */
}

/* ── Refresh P/L cells without full re-render ────────────── */
function refreshHoldingsPnL() {
  const holdings = profile?.holdings || {};
  for (const [mint, h] of Object.entries(holdings)) {
    if ((h.amount || 0) < 0.000001) continue;

    const price    = dashPrices[mint];
    const costSol  = h.totalCostSol || 0;
    /* price-ratio formula — immune to SOL/USD drift */
    const curVal   = (price && h.avgPrice > 0 && costSol > 0)
      ? costSol * (price / h.avgPrice) : null;
    const pnlSol   = curVal !== null ? curVal - costSol : null;
    const pnlPct   = pnlSol !== null && costSol > 0 ? (pnlSol / costSol) * 100 : null;

    const pnlEl  = document.getElementById(`dash-pnl-${mint}`);
    const dotEl  = document.getElementById(`dash-dot-${mint}`);
    const valEl  = document.getElementById(`dash-val-${mint}`);

    if (valEl && curVal !== null)  valEl.textContent  = formatSol(curVal);

    if (pnlEl && pnlSol !== null) {
      const sign = pnlSol >= 0 ? "+" : "";
      const col  = pnlSol >= 0 ? "#2cffc9" : "#ff4d6d";
      pnlEl.style.color   = col;
      pnlEl.textContent   = `${sign}${formatSol(pnlSol)}  (${sign}${pnlPct.toFixed(1)}%)`;
    }
    if (dotEl) dotEl.textContent = "⬤ LIVE · just now";
  }
  refreshHoldingsSummary(); /* update portfolio totals */
}

/* ═══════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", () => {
  renderNav();
  applyTranslations();

  const saved = localStorage.getItem("sa_wallet");
  if (saved && isValidSolanaAddress(saved)) {
    wallet = saved;
    loadDashboard();
  }

  document.getElementById("dashConnectBtn").addEventListener("click", connectWallet);

  // Share button
  document.getElementById("dashShareBtn")?.addEventListener("click", () => {
    const url = `${window.location.origin}/dashboard.html`;
    navigator.clipboard.writeText(url).then(() => showToast("🔗 Dashboard link copied!"));
  });
});

/* ═══════════════════════════════════════════════════════
   WALLET CONNECT
═══════════════════════════════════════════════════════ */
async function connectWallet() {
  const btn = document.getElementById("dashConnectBtn");
  document.getElementById("dashConnectText").textContent = "⏳ Connecting…";
  btn.disabled = true;
  try {
    const phantom = window.solana;
    if (!phantom?.isPhantom) {
      alert("Phantom wallet not found!\n\nPlease install Phantom from phantom.app and refresh.");
      return;
    }
    const resp = await phantom.connect();
    wallet = resp.publicKey.toString();
    localStorage.setItem("sa_wallet", wallet);
    await loadDashboard();
  } catch (e) {
    alert("Wallet connection cancelled or failed.");
  } finally {
    document.getElementById("dashConnectText").textContent = "🔗 Connect Phantom Wallet";
    btn.disabled = false;
  }
}

/* ═══════════════════════════════════════════════════════
   DEMO / FAKE PROFILE  (used when API is unavailable)
═══════════════════════════════════════════════════════ */
const DEMO_PROFILE = {
  accountName:  "Demo Ape",
  balance:      14.75,
  totalPnL:     4.75,
  winCount:     18,
  lossCount:    7,
  loginStreak:  5,
  badges:       ["first_profit", "win_streak_5", "safe_trader"],
  holdings: {
    /* Real Solana mints so Jupiter price API can respond in demo mode */
    "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm": {
      name:"dogwifhat",  symbol:"WIF",  amount:15000, totalCostSol:2.10, avgPrice:0.00014, logo:"" },
    "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU": {
      name:"Samoyedcoin",symbol:"SAMO", amount:8500,  totalCostSol:1.50, avgPrice:0.000176, logo:"" },
  },
  trades: [
    { type:"sell", symbol:"BONK",   name:"Bonk",                 pnl:  1.24, pnlPct: "38.5", totalReceivedSol:4.45, timestamp: Date.now() -   3_600_000 },
    { type:"buy",  symbol:"WIF",    name:"dogwifhat",                                         totalCostSol:2.10,     timestamp: Date.now() -   7_200_000 },
    { type:"sell", symbol:"POPCAT", name:"Popcat",                pnl: -0.31, pnlPct: "-9.2", totalReceivedSol:3.04, timestamp: Date.now() -  86_400_000 },
    { type:"sell", symbol:"MEW",    name:"cat in a dogs world",   pnl:  2.10, pnlPct: "67.2", totalReceivedSol:5.25, timestamp: Date.now() - 172_800_000 },
    { type:"buy",  symbol:"SAMO",   name:"Samoyedcoin",                                       totalCostSol:1.50,     timestamp: Date.now() - 259_200_000 },
    { type:"sell", symbol:"JUP",    name:"Jupiter",               pnl:  0.88, pnlPct: "23.1", totalReceivedSol:4.69, timestamp: Date.now() - 345_600_000 },
    { type:"sell", symbol:"PYTH",   name:"Pyth Network",          pnl: -0.55, pnlPct:"-18.0", totalReceivedSol:2.51, timestamp: Date.now() - 432_000_000 },
    { type:"sell", symbol:"RAY",    name:"Raydium",               pnl:  0.42, pnlPct: "15.3", totalReceivedSol:3.17, timestamp: Date.now() - 518_400_000 },
    { type:"sell", symbol:"ORCA",   name:"Orca",                  pnl:  1.67, pnlPct: "44.6", totalReceivedSol:5.41, timestamp: Date.now() - 604_800_000 },
    { type:"buy",  symbol:"FOXY",   name:"Famous Fox",                                        totalCostSol:0.80,     timestamp: Date.now() - 691_200_000 },
    { type:"sell", symbol:"MNGO",   name:"Mango",                 pnl: -0.22, pnlPct: "-8.1", totalReceivedSol:2.49, timestamp: Date.now() - 777_600_000 },
    { type:"sell", symbol:"ATLAS",  name:"Star Atlas",            pnl:  3.40, pnlPct: "82.1", totalReceivedSol:7.54, timestamp: Date.now() - 864_000_000 },
  ],
};

/* ═══════════════════════════════════════════════════════
   LOAD DASHBOARD  (with 503 retry + demo fallback)
═══════════════════════════════════════════════════════ */
async function loadDashboard() {
  showToast("⏳ Loading dashboard…");

  /* ── Retry up to 4× on 503 ── */
  let data;
  const MAX_RETRIES = 4;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(`${SIM_API}?wallet=${wallet}`);

      if (resp.status === 503) {
        if (attempt < MAX_RETRIES) {
          const delay = Math.min((attempt + 1) * 2000, 8000);
          showToast(`⏳ Storage reconnecting… (${attempt + 1}/${MAX_RETRIES})`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        /* All retries exhausted — fall back to demo data */
        console.warn("Dashboard: API unavailable after retries, using demo data.");
        profile = { ...DEMO_PROFILE, accountName: "Demo Mode" };
        showDashboard(true);
        return;
      }

      data = await resp.json();
      if (data.error) throw new Error(data.error);
      break; // success
    } catch (e) {
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      /* Network failure — show demo data */
      console.warn("Dashboard: Network error, using demo data:", e);
      profile = { ...DEMO_PROFILE, accountName: "Demo Mode" };
      showDashboard(true);
      return;
    }
  }

  profile = data.profile;
  showDashboard(false);
}

function showDashboard(isDemo = false) {
  document.getElementById("dashGate").style.display = "none";
  document.getElementById("dashApp").style.display  = "block";

  /* ── Wire hero buttons robustly (replaces inline onclick) ── */
  const accsBtnEl = document.getElementById("dashAccsBtn");
  if (accsBtnEl) {
    accsBtnEl.onclick = null;
    accsBtnEl.addEventListener("click", () => window.openAccountSettings());
  }
  const shareBtnEl = document.getElementById("dashProfileShareBtn");
  if (shareBtnEl) {
    shareBtnEl.onclick = null;
    shareBtnEl.addEventListener("click", () => window.shareProfileCard());
  }
  const cardBtnEl = document.getElementById("dashCardBtn");
  if (cardBtnEl) {
    cardBtnEl.onclick = null;
    cardBtnEl.addEventListener("click", () => window.openAccountCard());
  }

  if (isDemo) {
    const existing = document.getElementById("demoBanner");
    if (!existing) {
      const banner = document.createElement("div");
      banner.id = "demoBanner";
      banner.style.cssText = "background:rgba(255,180,50,0.1);border:1px solid rgba(255,180,50,0.3);border-radius:10px;padding:8px 16px;font-size:12px;font-weight:600;color:#ffb432;text-align:center;margin-bottom:14px;";
      banner.textContent = "⚠️ Storage temporarily unavailable — showing demo preview. Your real data will load once the connection restores.";
      document.getElementById("dashApp").prepend(banner);
    }
  }

  renderHero();
  renderStatsRow();
  renderHighlightStats();
  renderMissionTeaser();
  renderNextBadges();
  renderBadges();
  renderApeStats();
  renderActivityFeed();
  renderPnlChart();
  renderTradeHistory();
  renderHoldings();
  renderScannerStats();
  renderAcademyPlaceholder();
  renderLeaderboard();

  /* ── Last scanned tokens ── */
  renderLastScans();

  /* ── Daily reward check ── */
  if (!isDemo) checkDashDailyReward();

  /* ── Start live price polling for holdings ── */
  if (dashPriceTimer) clearInterval(dashPriceTimer);
  dashPrices = {};
  fetchDashPrices(); /* immediate first fetch */
  dashPriceTimer = setInterval(fetchDashPrices, 30_000); /* refresh every 30 s */
}

/* ═══════════════════════════════════════════════════════
   LAST SCANNED TOKENS — reads same localStorage as home.js
═══════════════════════════════════════════════════════ */
const DASH_SCANS_KEY  = "s2m_last_scans";
const DASH_SCANS_MAX  = 8;

function _scanTimeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function _scanScoreColor(score) {
  if (score >= 65) return "#2cffc9";
  if (score >= 45) return "#ffd166";
  return "#ff4d6d";
}

function _scanRiskLabel(score) {
  if (score >= 65) return "LOW RISK";
  if (score >= 45) return "MODERATE";
  return "HIGH RISK";
}

function renderLastScans() {
  const panel = document.getElementById("dashLastScansPanel");
  const grid  = document.getElementById("dashScansGrid");
  const btn   = document.getElementById("dashClearScansBtn");
  if (!panel || !grid) return;

  let scans = [];
  try { scans = JSON.parse(localStorage.getItem(DASH_SCANS_KEY) || "[]"); } catch {}
  scans = scans.slice(0, DASH_SCANS_MAX);

  if (!scans.length) { panel.style.display = "none"; return; }
  panel.style.display = "block";

  grid.innerHTML = scans.map(s => {
    const logo      = s.logo
      ? `/.netlify/functions/logoProxy?url=${encodeURIComponent(s.logo)}`
      : "https://placehold.co/40x40";
    const score     = s.totalScore ?? "—";
    const scoreCol  = typeof score === "number" ? _scanScoreColor(score) : "#7fffe1";
    const riskLabel = typeof score === "number" ? _scanRiskLabel(score) : "";
    const ago       = _scanTimeAgo(s.scannedAt);
    const name      = esc(s.name || "Unknown");
    const sym       = esc(s.symbol || "");
    const mc        = esc(s.marketCap  || "—");
    const liq       = esc(s.liquidity  || "—");
    const mint      = esc(s.mint);

    return `
      <div class="dash-scan-card" onclick="window._dashGoToScan('${mint}')" title="Re-scan ${name}">
        <div class="dash-scan-card-top">
          <img class="dash-scan-logo" src="${logo}" onerror="this.src='https://placehold.co/40x40'" referrerpolicy="no-referrer" />
          <div class="dash-scan-info">
            <div class="dash-scan-name">${name}</div>
            <div class="dash-scan-sym">${sym}</div>
          </div>
          <div class="dash-scan-ago">${ago}</div>
        </div>
        <div class="dash-scan-score-row">
          <span class="dash-scan-score" style="color:${scoreCol};text-shadow:0 0 10px ${scoreCol}66">${score}<span class="dash-scan-score-max">/100</span></span>
          <span class="dash-scan-risk" style="color:${scoreCol};border-color:${scoreCol}44;background:${scoreCol}12">${riskLabel}</span>
        </div>
        <div class="dash-scan-metrics">
          <div class="dash-scan-metric"><div class="dash-scan-metric-lbl">Mkt Cap</div><div class="dash-scan-metric-val">${mc}</div></div>
          <div class="dash-scan-metric"><div class="dash-scan-metric-lbl">Liquidity</div><div class="dash-scan-metric-val">${liq}</div></div>
        </div>
        <div class="dash-scan-card-actions">
          <button class="dash-scan-rescan-btn" onclick="event.stopPropagation();window._dashGoToScan('${mint}')">🔍 Re-scan</button>
          <button class="dash-scan-ape-btn" onclick="event.stopPropagation();window._dashGoToApe('${mint}')">🦍 Ape</button>
        </div>
      </div>`;
  }).join("");

  /* Wire up clear button */
  if (btn) {
    btn.onclick = () => {
      if (!confirm("Clear all scan history?")) return;
      localStorage.removeItem(DASH_SCANS_KEY);
      panel.style.display = "none";
    };
  }
}

window._dashGoToScan = function(mint) {
  localStorage.setItem("s2m_prefill_mint", mint);
  window.location.href = "risk-scanner.html";
};

window._dashGoToApe = function(mint) {
  localStorage.setItem("s2m_sa_mint", mint);
  window.location.href = "safe-ape.html";
};

/* ═══════════════════════════════════════════════════════
   DAILY REWARD — on Dashboard
═══════════════════════════════════════════════════════ */
function checkDashDailyReward() {
  if (!profile || !wallet) return;
  const today = new Date().toISOString().slice(0, 10);
  if (profile.lastLogin === today) return; /* already claimed today */
  const banner = document.getElementById("dashDailyBanner");
  const btn    = document.getElementById("dashDailyClaimBtn");
  if (!banner || !btn) return;

  const DAILY_REWARDS_SOL = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
  const streak  = Math.max(1, Math.min(7, (profile.loginStreak || 0) + 1));
  const reward  = DAILY_REWARDS_SOL[streak] ?? 0.1;
  btn.textContent = `Claim +${reward.toFixed(2)} SOL & +5 XP`;
  banner.style.display = "flex";

  btn.addEventListener("click", claimDashDaily, { once: true });
}

async function claimDashDaily() {
  const banner = document.getElementById("dashDailyBanner");
  const btn    = document.getElementById("dashDailyClaimBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Claiming…"; }
  try {
    const resp = await fetch(SIM_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet, action: "daily_login" }),
    });
    if (resp.status === 503) { alert("Server busy, try again in a moment."); return; }
    const data = await resp.json();
    if (data.error) { alert("Error: " + data.error); return; }
    profile = data.profile;
    if (banner) banner.style.display = "none";
    /* Re-render XP/level after claim */
    renderStatsRow();
    /* Toast-style flash */
    const flash = document.createElement("div");
    flash.style.cssText = `position:fixed;bottom:70px;left:50%;transform:translateX(-50%);
      background:linear-gradient(135deg,rgba(255,180,50,.2),rgba(6,32,26,.97));
      border:1px solid rgba(255,180,50,.55);border-radius:12px;
      padding:12px 24px;font-size:15px;font-weight:800;color:#ffb432;
      box-shadow:0 0 30px rgba(255,180,50,.35);z-index:9999;
      animation:none;pointer-events:none;`;
    flash.textContent = `🎁 ${data.message}  ⚡ +5 XP`;
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 3000);
  } catch (e) {
    console.warn("Daily claim error:", e);
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ═══════════════════════════════════════════════════════
   HERO PANEL
═══════════════════════════════════════════════════════ */
function renderHero() {
  const short      = wallet.slice(0, 6) + "…" + wallet.slice(-6);
  const pnl        = profile.totalPnL || 0;
  const savedName  = localStorage.getItem("sa_display_name");
  const savedAvId  = localStorage.getItem("sa_avatar_id");

  document.getElementById("dashName").textContent        = esc(savedName || profile.accountName || "Ape Trader");
  document.getElementById("dashWalletShort").textContent = short;
  document.getElementById("dashRankBadge").textContent   = rankLabel(pnl);

  /* Avatar — video badge / image badge / emoji fallback */
  const avEl = document.getElementById("dashAvatar");
  if (savedAvId) {
    const b = BADGE_DEFS.find(x => x.id === savedAvId);
    if (b?.type === "video" && b.video) {
      avEl.innerHTML = `<video src="${b.video}" class="dash-avatar-video"
        autoplay loop muted playsinline
        onerror="this.parentElement.textContent='${b.icon || "🦍"}'"></video>`;
    } else if (b?.img) {
      avEl.innerHTML = `<img src="${b.img}" class="dash-avatar-img"
        onerror="this.parentElement.textContent='${b.icon || "🦍"}'" alt="${esc(b.name)}">`;
    } else if (b?.icon) {
      avEl.textContent = b.icon;
    } else { avEl.textContent = "🦍"; }
  } else { avEl.textContent = "🦍"; }

  /* Frame effect on avatar wrapper */
  const frameEl = document.getElementById("dashAvatarFrame");
  if (frameEl) {
    const savedFrameId = localStorage.getItem("sa_frame_id") || "frame_none";
    const frameDef = FRAME_DEFS.find(f => f.id === savedFrameId) || FRAME_DEFS[0];
    frameEl.className = ("dash-avatar-frame " + (frameDef.cssClass || "")).trim();
  }
}

/* Sync the hero avatar in the dashboard after a change */
function updateDashAvatar() {
  const savedAvId = localStorage.getItem("sa_avatar_id");
  const avEl = document.getElementById("dashAvatar");
  if (!avEl) return;
  if (savedAvId) {
    const b = BADGE_DEFS.find(x => x.id === savedAvId);
    if (b?.type === "video" && b.video) {
      avEl.innerHTML = `<video src="${b.video}" class="dash-avatar-video"
        autoplay loop muted playsinline
        onerror="this.parentElement.textContent='${b.icon || "🦍"}'"></video>`;
    } else if (b?.img) {
      avEl.innerHTML = `<img src="${b.img}" class="dash-avatar-img"
        onerror="this.parentElement.textContent='${b.icon || "🦍"}'" alt="${esc(b.name)}">`;
    } else if (b?.icon) { avEl.textContent = b.icon; }
    else { avEl.textContent = "🦍"; }
  } else { avEl.textContent = "🦍"; }
}

/* Sync the hero avatar frame after a change */
function updateDashFrame() {
  const frameEl = document.getElementById("dashAvatarFrame");
  if (!frameEl) return;
  const savedFrameId = localStorage.getItem("sa_frame_id") || "frame_none";
  const frameDef = FRAME_DEFS.find(f => f.id === savedFrameId) || FRAME_DEFS[0];
  frameEl.className = ("dash-avatar-frame " + (frameDef.cssClass || "")).trim();
}

/* ═══════════════════════════════════════════════════════
   STATS ROW
═══════════════════════════════════════════════════════ */
/* Academy level thresholds: 7 levels based on academy XP */
const ACAD_XP_THRESHOLDS = [0, 100, 250, 450, 700, 1000, 1400, 2000];
function calcAcadLevel(xp) {
  let lvl = 1;
  for (let i = 1; i < ACAD_XP_THRESHOLDS.length; i++) {
    if (xp >= ACAD_XP_THRESHOLDS[i]) lvl = i + 1; else break;
  }
  return lvl;
}

/* Only rank badges count towards Academy XP (not level badges) */
const ACADEMY_BADGE_IDS = new Set(["lesson_1","risk_master","scanner_pro","chart_reader","whale_watcher","defi_graduate"]);

function renderStatsRow() {
  const trades  = (profile.trades || []).length;
  const badges  = (profile.badges || []).length;
  const streak  = profile.loginStreak || 0;
  const wins    = profile.winCount   || 0;
  const losses  = profile.lossCount  || 0;
  const earned  = profile.badges || [];

  /* ── Account XP & Level (trades + badges + streak + social tasks + academy) ── */
  const xp      = ((wins + losses) * 25) + (badges * 50) + (streak * 5)
                + (profile.socialXp  || 0)
                + (profile.academyXp || 0);
  const lvl     = calcLevel(xp);
  const xpCur   = xp - xpForLevel(lvl);
  const xpRange = xpForNextLevel(lvl) - xpForLevel(lvl);
  const xpPct   = xpRange > 0 ? Math.min(100, Math.round((xpCur / xpRange) * 100)) : 100;

  document.getElementById("dashLvl").textContent    = lvl;
  document.getElementById("dashXpText").textContent = `${xp.toLocaleString()} / ${xpForNextLevel(lvl).toLocaleString()} XP`;
  document.getElementById("dashXpFill").style.width = xpPct + "%";

  /* ── Academy XP & Level (from completed lessons/quizzes on Academy page) ── */
  const acadXp    = profile.academyXp || 0;
  const acadLvl   = calcAcadLevel(acadXp);
  const acadNext  = ACAD_XP_THRESHOLDS[Math.min(acadLvl, ACAD_XP_THRESHOLDS.length - 1)];
  const acadCur   = acadXp - ACAD_XP_THRESHOLDS[acadLvl - 1];
  const acadRange = acadNext - ACAD_XP_THRESHOLDS[acadLvl - 1];
  const acadPct   = acadRange > 0 ? Math.min(100, Math.round((acadCur / acadRange) * 100)) : 100;

  document.getElementById("dashAcadLvl").textContent    = acadLvl;
  document.getElementById("dashAcadXpText").textContent = `${acadXp} / ${acadNext} XP`;
  document.getElementById("dashAcadXpFill").style.width = acadPct + "%";

  /* ── Scans placeholder ── */
  document.getElementById("dashScans").textContent = trades + 12;

  /* ── Rank placeholder ── */
  document.getElementById("dashRank").textContent = `${Math.max(1, 2400 - wins * 3)} / 17k`;

  /* ── Streak ── */
  document.getElementById("dashStreak").textContent = `${streak}d`;
}

/* ═══════════════════════════════════════════════════════
   BADGES — CATEGORISED ACCORDION
═══════════════════════════════════════════════════════ */
function renderBadges() {
  const earned   = new Set(profile.badges || []);
  /* Freebie badges are auto-earned for every connected wallet */
  BADGE_DEFS.filter(b => b.freebie).forEach(b => earned.add(b.id));
  const count    = earned.size;
  const total    = BADGE_DEFS.length;
  const pct      = total > 0 ? Math.round((count / total) * 100) : 0;
  const solTotal = [...earned].reduce((s, id) => {
    const b = BADGE_DEFS.find(x => x.id === id);
    return s + (b?.reward || 0.1);
  }, 0);

  /* Overall header */
  document.getElementById("dashBadgesCount").textContent     = `${count} / ${total} earned`;
  document.getElementById("dashBadgesPct").textContent       = `${pct}% complete`;
  document.getElementById("dashBadgesBarFill").style.width   = pct + "%";
  document.getElementById("dashBadgesSolEarned").textContent = `+${formatSol(solTotal)} earned`;

  /* Build accordion categories */
  const container = document.getElementById("dashBadgesGrid");
  container.className = "dash-badge-categories";
  container.innerHTML = BADGE_CATEGORIES.map((cat, catIdx) => {
    const catBadges  = BADGE_DEFS.filter(b => b.cat === cat.id);
    const catEarned  = catBadges.filter(b => earned.has(b.id)).length;
    const catSol     = catBadges.filter(b => earned.has(b.id)).reduce((s, b) => s + b.reward, 0);
    const isOpen     = catIdx === 0; // first category open by default

    /* Academy + Cosmetics get labelled sub-sections; all others render flat */
    let cardsHtml;
    if (cat.id === "academy") {
      const rankBadges  = catBadges.filter(b => b.subcat === "rank");
      const levelBadges = catBadges.filter(b => b.subcat === "level");
      const guideBadges = catBadges.filter(b => b.subcat === "guide");
      cardsHtml = `
        <div class="dash-badge-subheader">🏛️ ACADEMY RANK BADGES</div>
        <div class="dash-badges-grid">${rankBadges.map(b => badgeCardHtml(b, earned)).join("")}</div>
        <div class="dash-badge-subheader" style="margin-top:14px;">⭐ ACADEMY LEVEL BADGES</div>
        <div class="dash-badges-grid">${levelBadges.map(b => badgeCardHtml(b, earned)).join("")}</div>
        <div class="dash-badge-subheader" style="margin-top:14px;">📖 COMPLETED GUIDES</div>
        <div class="dash-badges-grid">${guideBadges.map(b => badgeCardHtml(b, earned)).join("")}</div>`;

    } else if (cat.id === "cosmetics") {
      const freeBadges      = catBadges.filter(b => b.subcat === "free");
      const communityBadges = catBadges.filter(b => b.subcat === "community");
      const krakenBadges    = catBadges.filter(b => b.subcat === "moon_krakens");
      cardsHtml = `
        <div class="dash-badge-subheader">🦍 FREE BADGES</div>
        <div class="dash-badges-grid">${freeBadges.map(b => badgeCardHtml(b, earned)).join("")}</div>
        <div class="dash-badge-subheader" style="margin-top:14px;color:#ff6eb4;">❤️ COMMUNITY BADGES</div>
        <div class="dash-badges-grid">${communityBadges.map(b => badgeCardHtml(b, earned)).join("")}</div>
        <div class="dash-badge-subheader" style="margin-top:14px;color:#c084fc;">
          🦑 MOON KRAKENS
          <span class="dash-badge-animated-chip">ANIMATED</span>
        </div>
        <div class="dash-badges-grid">${krakenBadges.map(b => badgeCardHtml(b, earned)).join("")}</div>`;

    } else {
      cardsHtml = `<div class="dash-badges-grid">${catBadges.map(b => badgeCardHtml(b, earned)).join("")}</div>`;
    }

    return `
      <div class="dash-cat-wrap ${isOpen ? 'open' : ''}" id="dash-cat-${cat.id}">
        <div class="dash-cat-header" onclick="window.toggleBadgeCat('${cat.id}')">
          <div class="dash-cat-color-bar" style="background:${cat.color};"></div>
          <span class="dash-cat-icon">${cat.icon}</span>
          <span class="dash-cat-title">${cat.label}</span>
          <span class="dash-cat-pill"
            style="background:${cat.bgColor};border:1px solid ${cat.borderColor};color:${cat.color};">
            ${catEarned} / ${catBadges.length}
          </span>
          ${catSol > 0 ? `<span class="dash-cat-sol">
            <img src="${SOL_LOGO}" style="width:13px;height:13px;border-radius:50%;">
            +${formatSol(catSol)}
          </span>` : ''}
          <span class="dash-cat-chevron">▼</span>
        </div>
        <div class="dash-cat-body">
          ${cardsHtml}
        </div>
      </div>`;
  }).join("");
}

/* ── Single badge card HTML ──────────────────────────────── */
function badgeCardHtml(b, earned) {
  const isEarned  = b.freebie || isPurchased(b.id) || earned.has(b.id);
  const rewardStr = b.reward >= 1 ? b.reward.toFixed(1) : b.reward.toFixed(2);

  /* Status chip */
  let statusHtml;
  if (b.freebie) {
    statusHtml = `<div class="dash-badge-status status-earned">🆓 FREE</div>`;
  } else if (b.market && isEarned) {
    statusHtml = `<div class="dash-badge-status status-earned">✅ OWNED</div>`;
  } else if (b.market && !isEarned) {
    statusHtml = `<div class="dash-badge-status status-market">💳 $${b.priceUsd}</div>`;
  } else {
    statusHtml = `<div class="dash-badge-status ${isEarned ? 'status-earned' : 'status-locked'}">
        ${isEarned ? '✅ EARNED' : '🔒 LOCKED'}
       </div>`;
  }

  /* Media content — video always plays; locked gets a dim overlay */
  let imgHtml;
  if (b.type === "video" && b.video) {
    imgHtml = `
      <div class="dash-badge-video-wrap${isEarned ? '' : ' dash-badge-video-dimmed'}">
        <video class="dash-badge-video" src="${b.video}" autoplay loop muted playsinline></video>
        ${!isEarned ? '<div class="dash-badge-video-lock-overlay"><span>🔒</span></div>' : ''}
      </div>`;
  } else if (b.img) {
    imgHtml = `<img class="dash-badge-img" src="${b.img}" alt="${esc(b.name)}"
         onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
       <span class="dash-badge-emoji" style="display:none">${b.icon}</span>`;
  } else {
    imgHtml = `<span class="dash-badge-emoji">${b.icon}</span>`;
  }

  return `
    <div class="dash-badge-card ${isEarned ? 'earned' : 'locked'}${b.type === 'video' ? ' badge-video-card' : ''}"
         onclick="window.openBadgeModal('${b.id}')" title="${esc(b.name)}">
      <div class="dash-badge-reward">${b.market && !isEarned ? `$${b.priceUsd}` : `+${rewardStr} SOL`}</div>
      <div class="dash-badge-img-wrap">
        ${imgHtml}
      </div>
      <div class="dash-badge-name">${esc(b.name)}</div>
      ${statusHtml}
    </div>`;
}

/* ── Toggle accordion category ───────────────────────────── */
window.toggleBadgeCat = function(catId) {
  const wrap = document.getElementById(`dash-cat-${catId}`);
  if (wrap) wrap.classList.toggle("open");
};

/* ═══════════════════════════════════════════════════════
   NEXT BADGES TO UNLOCK
═══════════════════════════════════════════════════════ */
function renderNextBadges() {
  const el     = document.getElementById("dashNextBadges");
  if (!el) return;
  const earned = new Set(profile.badges || []);
  /* Freebie badges are always earned — skip them in "next to unlock" */
  BADGE_DEFS.filter(b => b.freebie).forEach(b => earned.add(b.id));
  const locked = BADGE_DEFS.filter(b => !earned.has(b.id) && !b.market);

  if (!locked.length) {
    el.innerHTML = `<div style="text-align:center;padding:18px;color:#2cffc9;font-weight:700;font-size:14px;">🎉 All badges earned! You're a legend.</div>`;
    return;
  }

  /* Score each locked badge by trackable progress % */
  const scored = locked.map(b => {
    const prog = badgeProgress(b.id);
    const pct  = prog ? Math.min(100, Math.round((prog.cur / prog.max) * 100)) : 0;
    return { b, prog, pct };
  }).sort((a, z) => z.pct - a.pct).slice(0, 3);

  el.innerHTML = `<div class="dash-next-row">${scored.map(({ b, prog, pct }) => {
    const cat       = BADGE_CATEGORIES.find(c => c.id === b.cat);
    const rewardStr = b.reward >= 1 ? b.reward.toFixed(1) : b.reward.toFixed(2);
    const progLabel = prog ? `${prog.label} · ${pct}%` : "Complete requirements";
    return `
      <div class="dash-next-card" onclick="window.openBadgeModal('${b.id}')">
        <div class="dash-next-img-wrap">
          <img class="dash-next-img" src="${b.img}" alt="${esc(b.name)}"
            onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
          <span class="dash-next-emoji" style="display:none">${b.icon}</span>
          <div class="dash-next-lock">🔒</div>
        </div>
        <div class="dash-next-name">${esc(b.name)}</div>
        <div class="dash-next-cat" style="color:${cat.color};">${cat.icon} ${cat.label}</div>
        <div class="dash-next-reward">
          <img src="${SOL_LOGO}" style="width:11px;height:11px;border-radius:50%;vertical-align:middle;">
          +${rewardStr} SOL
        </div>
        <div class="dash-next-bar-wrap">
          <div class="dash-next-bar-fill" style="width:${pct}%;background:${cat.color};"></div>
        </div>
        <div class="dash-next-prog-label">${progLabel}</div>
      </div>`;
  }).join("")}</div>`;
}

/* ═══════════════════════════════════════════════════════
   BADGE MODAL
═══════════════════════════════════════════════════════ */
window.openBadgeModal = function(id) {
  if (!profile) return;
  const b        = BADGE_DEFS.find(x => x.id === id);
  if (!b) return;
  const cat      = BADGE_CATEGORIES.find(c => c.id === b.cat);
  const earned   = new Set(profile.badges || []);
  BADGE_DEFS.filter(x => x.freebie).forEach(x => earned.add(x.id));
  getPurchased().forEach(p => earned.add(p.id));
  const isEarned = earned.has(id);
  const rewardStr = b.reward >= 1 ? b.reward.toFixed(1) : b.reward.toFixed(2);

  document.getElementById("badgeModalOverlay")?.remove();

  /* Media in popup — video loops, image shows, emoji fallback */
  let mediaHtml;
  if (b.type === "video" && b.video) {
    /* Always show the video — locked ones get a dim overlay */
    mediaHtml = `
      <div style="position:relative;display:inline-block;border-radius:16px;overflow:hidden;">
        <video class="badge-modal-video" src="${b.video}"
          autoplay loop muted playsinline
          style="${!isEarned ? 'filter:brightness(0.45) saturate(0.5);' : ''}"></video>
        ${!isEarned ? `<div style="position:absolute;inset:0;display:flex;flex-direction:column;
            align-items:center;justify-content:center;gap:6px;">
            <span style="font-size:32px;">🔒</span>
            <span style="font-size:10px;color:rgba(255,255,255,0.7);font-weight:700;">
              Buy to unlock · $${b.priceUsd}</span>
          </div>` : ''}
      </div>`;
  } else if (b.img) {
    mediaHtml = `<img class="badge-modal-img" src="${b.img}" alt="${esc(b.name)}"
          onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
        <div class="badge-modal-emoji" style="display:none">${b.icon}</div>`;
  } else {
    mediaHtml = `<div class="badge-modal-emoji">${b.icon}</div>`;
  }

  /* Status chip */
  let statusChipHtml;
  if (b.freebie) {
    statusChipHtml = `<span class="badge-modal-status-chip earned">🆓 FREE — YOURS FOREVER</span>`;
  } else if (b.market && isEarned) {
    statusChipHtml = `<span class="badge-modal-status-chip earned">✅ OWNED</span>`;
  } else if (b.market && !isEarned) {
    statusChipHtml = `<span class="badge-modal-status-chip locked">💳 $${b.priceUsd} — Available in Moon Market</span>`;
  } else {
    statusChipHtml = `<span class="badge-modal-status-chip ${isEarned ? 'earned' : 'locked'}">
      ${isEarned ? '✅ EARNED' : '🔒 NOT YET EARNED'}
    </span>`;
  }

  const overlay = document.createElement("div");
  overlay.className = "badge-modal-overlay";
  overlay.id = "badgeModalOverlay";
  overlay.innerHTML = `
    <div class="badge-modal-card" id="badgeModalCard">
      <button class="badge-modal-close" onclick="document.getElementById('badgeModalOverlay').remove()">✕</button>

      <div class="badge-modal-cat-chip"
        style="background:${cat.bgColor};border:1px solid ${cat.borderColor};color:${cat.color};">
        ${cat.icon} ${cat.label}${b.type === "video" ? ' · <span style="color:#c084fc;">🎬 ANIMATED</span>' : ''}
      </div>

      <div class="badge-modal-img-wrap ${isEarned ? 'earned' : ''}${b.type === 'video' ? ' badge-modal-video-wrap' : ''}">
        ${mediaHtml}
      </div>

      <div class="badge-modal-name">${esc(b.name)}</div>
      <div class="badge-modal-desc">${esc(b.desc)}</div>

      ${b.reward > 0 ? `
      <div class="badge-modal-reward">
        <img src="${SOL_LOGO}" style="width:18px;height:18px;border-radius:50%;">
        +${rewardStr} SOL reward
      </div>` : ''}

      <div class="badge-modal-status-row">${statusChipHtml}</div>

      <div class="badge-modal-actions">
        ${isEarned ? `
        <button class="badge-modal-btn save" id="badgeSaveBtn"
          onclick="window.saveBadgeImage('${id}')">
          💾 Save Image
        </button>` : (b.market ? `
        <button class="badge-modal-btn save"
          onclick="document.getElementById('badgeModalOverlay').remove();window.openMoonMarket('cosmetics')">
          🛒 Buy in Moon Market
        </button>` : '')}
        <button class="badge-modal-btn share-x" id="badgeShareXBtn"
          onclick="window.shareBadgeOnX('${id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          Share on X
        </button>
      </div>
    </div>`;

  /* Close on backdrop click */
  overlay.addEventListener("click", e => {
    if (e.target === overlay) overlay.remove();
  });

  document.body.appendChild(overlay);
};

/* ── Build hidden share card & capture ───────────────────── */
async function buildShareCard(id) {
  const b        = BADGE_DEFS.find(x => x.id === id);
  const cat      = BADGE_CATEGORIES.find(c => c.id === b.cat);
  const isEarned = new Set(profile.badges || []).has(id);
  const rewardStr = b.reward >= 1 ? b.reward.toFixed(1) : b.reward.toFixed(2);
  const short    = wallet ? wallet.slice(0,6) + "…" + wallet.slice(-4) : "";

  /* Remove any old card */
  document.getElementById("badgeShareCard")?.remove();

  const card = document.createElement("div");
  card.id = "badgeShareCard";
  card.innerHTML = `
    <div class="bsc-logo">🌙 SCAN2MOON</div>
    <img class="bsc-img" src="${b.img}" alt="${b.name}"
      onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
    <div class="bsc-emoji" style="display:none">${b.icon}</div>
    <div class="bsc-name">${b.name}</div>
    <div class="bsc-desc">${b.desc}</div>
    <div class="bsc-reward">+${rewardStr} SOL reward</div>
    <div class="bsc-status ${isEarned ? 'earned' : 'locked'}">
      ${isEarned ? '✅ EARNED' : '🔒 NOT YET EARNED'}
    </div>
    <div style="font-size:11px;color:rgba(44,255,201,0.35);margin-top:6px;">${cat.icon} ${cat.label}</div>
    ${short ? `<div style="font-size:10px;color:rgba(207,255,244,0.25);margin-top:4px;font-family:monospace;">${short}</div>` : ""}
    <div class="bsc-footer">scan2moon.com</div>`;

  document.body.appendChild(card);

  /* Wait one frame for images */
  await new Promise(r => setTimeout(r, 120));

  const canvas = await html2canvas(card, {
    backgroundColor: "#061311",
    scale: 2,
    useCORS: true,
    allowTaint: true,
    logging: false,
  });

  card.remove();
  return { canvas, name: b.name };
}

window.saveBadgeImage = async function(id) {
  const btn = document.getElementById("badgeSaveBtn");
  if (btn) { btn.disabled = true; btn.textContent = "⏳ Saving…"; }
  try {
    const { canvas, name } = await buildShareCard(id);
    const link = document.createElement("a");
    link.download = `${name.replace(/\s+/g,"-")}-Scan2Moon.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  } catch(e) {
    console.error("Save badge image error:", e);
    showToast("⚠️ Could not save image — try again.");
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = "💾 Save Image"; }
  }
};

window.shareBadgeOnX = async function(id) {
  const b   = BADGE_DEFS.find(x => x.id === id);
  const btn = document.getElementById("badgeShareXBtn");
  if (btn) { btn.disabled = true; btn.textContent = "⏳ Preparing…"; }
  try {
    const { canvas, name } = await buildShareCard(id);
    /* Auto-download image */
    const link = document.createElement("a");
    link.download = `${name.replace(/\s+/g,"-")}-Scan2Moon.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    /* Open Twitter intent */
    const isEarned = new Set(profile.badges || []).has(id);
    const tweet = isEarned
      ? `🏅 Just earned the "${b.name}" badge on Scan2Moon!\n\n${b.desc}\n\nWe don't shill. We show data. 🌙\nhttps://scan2moon.com`
      : `🎯 Working towards the "${b.name}" badge on Scan2Moon!\n\n${b.desc}\n\nhttps://scan2moon.com`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}`, "_blank");
  } catch(e) {
    console.error("Share badge error:", e);
    showToast("⚠️ Could not share — try again.");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg> Share on X`;
    }
  }
};

/* ═══════════════════════════════════════════════════════
   ACADEMY RANK CARD  (for highlight row)
═══════════════════════════════════════════════════════ */
const ACADEMY_RANK_LADDER = [
  { id: "defi_graduate",  icon: "🎓", rank: "DeFi Graduate",  color: "#ffd700", graduated: true  },
  { id: "whale_watcher",  icon: "🐋", rank: "Whale Tracker",  color: "#60a5fa"                   },
  { id: "chart_reader",   icon: "📈", rank: "Chart Analyst",  color: "#2cffc9"                   },
  { id: "scanner_pro",    icon: "🛡️", rank: "Scanner Pro",    color: "#2cffc9"                   },
  { id: "risk_master",    icon: "📊", rank: "Risk Analyst",   color: "#c084fc"                   },
  { id: "lesson_1",       icon: "🎯", rank: "Freshman",       color: "#ffb432"                   },
];

function buildAcademyRankCard() {
  const earned   = new Set(profile.badges || []);
  const current  = ACADEMY_RANK_LADDER.find(r => earned.has(r.id));

  /* ── Not enrolled ── */
  if (!current) {
    return { customHtml: `
      <div class="dash-hl-top-label">ACADEMY RANK</div>
      <div class="dash-hl-icon" style="font-size:28px;line-height:1.1">😴<br><span style="font-size:14px">📚</span></div>
      <div class="dash-hl-val" style="color:rgba(207,255,244,0.4);font-size:13px;">NOT YET</div>
      <div class="dash-hl-sub" style="font-size:9px;line-height:1.3;">Textbooks? Never heard of them...</div>
      <a href="learn2moon.html" class="dash-hl-enroll-btn">👉 Enroll</a>` };
  }

  /* ── Graduated ── */
  if (current.graduated) {
    return { customHtml: `
      <div class="dash-hl-top-label">ACADEMY RANK</div>
      <div class="dash-hl-icon">🎓</div>
      <div class="dash-hl-val" style="color:#ffd700;font-size:13px;">GRADUATE</div>
      <div class="dash-hl-sub" style="color:#ffd700;font-size:10px;">🏛️ DeFi Graduate</div>
      <div style="font-size:9px;color:rgba(255,215,0,0.5);margin-top:3px;">Academy Completed ✨</div>`, cls: "academy-grad" };
  }

  /* ── In progress ── */
  return { customHtml: `
    <div class="dash-hl-top-label">ACADEMY RANK</div>
    <div class="dash-hl-icon">${current.icon}</div>
    <div class="dash-hl-val" style="color:${current.color};font-size:13px;">${esc(current.rank).toUpperCase()}</div>
    <div class="dash-hl-sub">Keep learning!</div>` };
}

/* ═══════════════════════════════════════════════════════
   HIGHLIGHT STATS ROW  (Best Trade, Worst Trade, Tasks…)
═══════════════════════════════════════════════════════ */
function renderHighlightStats() {
  const trades   = profile.trades || [];
  const sells    = trades.filter(tr => tr.type === "sell");
  const winSells = sells.filter(tr => (tr.pnl || 0) > 0);
  const losSells = sells.filter(tr => (tr.pnl || 0) < 0);

  const best  = winSells.length  ? winSells.reduce((a, b)  => (b.pnl > a.pnl  ? b : a), winSells[0])  : null;
  const worst = losSells.length  ? losSells.reduce((a, b)  => (b.pnl < a.pnl  ? b : a), losSells[0])  : null;

  const cards = [
    {
      icon: "🏆", label: "BEST TRADE",
      val: best  ? `+${formatSol(best.pnl)}`  : "—",
      sub: best  ? esc(best.symbol  || best.name  || "") : "No wins yet",
      color: "#2cffc9",
    },
    {
      icon: "💀", label: "WORST TRADE",
      val: worst ? formatSol(worst.pnl) : "—",
      sub: worst ? esc(worst.symbol || worst.name || "") : "No losses 🎉",
      color: worst ? "#ff4d6d" : "#2cffc9",
    },
    {
      icon: "✅", label: "TASKS DONE",
      val: "0",
      sub: "coming soon",
      color: "rgba(207,255,244,0.35)",
      soon: true,
    },
    {
      icon: "🎯", label: "DAILY STREAK XP",
      val: "—",
      sub: "coming soon",
      color: "rgba(207,255,244,0.25)",
      soon: true,
    },
    buildAcademyRankCard(),
  ];

  document.getElementById("dashHighlightRow").innerHTML = cards.map(c =>
    c.customHtml
      ? `<div class="dash-hl-card ${c.cls || ''}">${c.customHtml}</div>`
      : `<div class="dash-hl-card ${c.soon ? 'soon' : ''}">
           <div class="dash-hl-top-label">${c.label}</div>
           <div class="dash-hl-icon">${c.icon}</div>
           <div class="dash-hl-val" style="color:${c.color}">${c.val}</div>
           <div class="dash-hl-sub">${c.sub}</div>
           ${c.soon ? '<div class="dash-hl-soon-chip">COMING SOON</div>' : ''}
         </div>`
  ).join("");
}

/* ═══════════════════════════════════════════════════════
   APE SIMULATOR QUICK STATS  (6 cards: 2×3 grid)
═══════════════════════════════════════════════════════ */
function renderApeStats() {
  const wins    = profile.winCount   || 0;
  const losses  = profile.lossCount  || 0;
  const total   = wins + losses;
  const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : "0";
  const pnl     = profile.totalPnL   || 0;
  const pnlSign = pnl >= 0 ? "+" : "";
  const pnlCls  = pnl >= 0 ? "#2cffc9" : "#ff4d6d";
  const bal     = profile.balance    || 10;

  const cards = [
    { label: "BALANCE",      val: formatSol(bal),                    color: "#ffb432" },
    { label: "ALL-TIME P/L", val: `${pnlSign}${formatSol(pnl)}`,     color: pnlCls   },
    { label: "WIN  ✅",      val: wins,                              color: "#2cffc9" },
    { label: "LOSE  ❌",     val: losses,                            color: losses > 0 ? "#ff4d6d" : "rgba(207,255,244,0.4)" },
    { label: "WIN RATE",     val: `${winRate}%`,                     color: parseFloat(winRate) >= 50 ? "#2cffc9" : "#ff4d6d" },
    { label: "TRADES",       val: total,                             color: "#cffff4" },
  ];

  document.getElementById("dashApeStats").innerHTML = cards.map(c => `
    <div class="dash-qs-card">
      <div class="dash-qs-label">${c.label}</div>
      <div class="dash-qs-val" style="color:${c.color}">${c.val}</div>
    </div>`).join("");

  /* ── Donut ring ── */
  const winPct = total > 0 ? Math.round((wins / total) * 100) : 0;
  const donutEl = document.getElementById("dashDonutWrap");
  if (donutEl) {
    donutEl.innerHTML = `
      <div class="dash-donut-ring" style="--win-pct:${winPct}">
        <div class="dash-donut-inner">
          <div class="dash-donut-val">${winRate}%</div>
          <div class="dash-donut-lbl">WIN RATE</div>
        </div>
      </div>
      <div class="dash-donut-legend">
        <span class="dash-donut-dot" style="background:#2cffc9;"></span> WIN ${wins}
        <span class="dash-donut-dot" style="background:rgba(255,77,109,0.7);margin-left:12px;"></span> LOSE ${losses}
      </div>`;
  }
}

/* ═══════════════════════════════════════════════════════
   RECENT ACTIVITY FEED
═══════════════════════════════════════════════════════ */
function renderActivityFeed() {
  const trades       = (profile.trades || []).slice(0, 5);
  const earnedBadges = profile.badges || [];
  const feed = [];

  for (const tr of trades) {
    const isBuy  = tr.type === "buy";
    const pnlSol = !isBuy && tr.pnl !== undefined ? parseFloat(tr.pnl) : null;
    const pnlStr = pnlSol !== null
      ? ` <span style="font-weight:800;color:${pnlSol >= 0 ? '#2cffc9' : '#ff4d6d'}">${pnlSol >= 0 ? '+' : ''}${formatSol(pnlSol)}</span>`
      : "";
    feed.push({
      icon: isBuy ? "🟢" : "🔴",
      text: `${isBuy ? "Bought" : "Sold"} <strong>${esc(tr.symbol || tr.name)}</strong>${pnlStr}`,
      time: timeAgo(tr.timestamp),
    });
  }

  if (earnedBadges.length) {
    const lastBadgeId = earnedBadges[earnedBadges.length - 1];
    const b = BADGE_DEFS.find(x => x.id === lastBadgeId);
    if (b) feed.unshift({ icon: "🏅", text: `Badge unlocked: <strong>${esc(b.name)}</strong>`, time: "recently" });
  }

  document.getElementById("dashActivityFeed").innerHTML = feed.length
    ? feed.map(item => `
        <div class="dash-activity-item">
          <span class="dash-activity-icon">${item.icon}</span>
          <span class="dash-activity-text">${item.text}</span>
          <span class="dash-activity-time">${item.time}</span>
        </div>`).join("")
    : `<div style="text-align:center;padding:20px;opacity:0.4;font-size:13px;">No activity yet — start trading!</div>`;
}

/* ═══════════════════════════════════════════════════════
   TRADE HISTORY  (panel preview — last 10)
═══════════════════════════════════════════════════════ */
function renderTradeHistory() {
  const el     = document.getElementById("dashTradeHistory");
  const trades = (profile.trades || []).slice(0, 10);

  if (!trades.length) {
    el.innerHTML = `<div class="dash-trade-empty">No trades yet — head to the Simulator!</div>`;
    return;
  }

  el.innerHTML = `
    <div class="dash-trade-table">
      <div class="dash-trade-header">
        <div>TYPE</div><div>TOKEN</div><div>AMOUNT</div><div>P/L</div><div>DATE</div>
      </div>
      ${trades.map(tr => buildTradeRow(tr)).join("")}
    </div>`;
}

/* ── Shared row builder (panel + modal) ──────────────── */
function buildTradeRow(tr) {
  const isBuy   = tr.type === "buy";
  const pnlSol  = !isBuy && tr.pnl !== undefined ? parseFloat(tr.pnl) : null;
  const pnlHtml = pnlSol !== null
    ? `<span style="color:${pnlSol>=0?'#2cffc9':'#ff4d6d'};font-weight:800;">${pnlSol>=0?'+':''}${formatSol(pnlSol)}</span>`
    : `<span style="opacity:0.3">—</span>`;
  const amtSol  = isBuy ? (tr.totalCostSol || null) : (tr.totalReceivedSol || null);
  const amtHtml = amtSol !== null ? formatSol(amtSol) : "—";
  const date    = new Date(tr.timestamp).toLocaleDateString(undefined, { month:"short", day:"numeric" });

  return `
    <div class="dash-trade-row">
      <div><span class="dash-trade-badge ${isBuy?'buy':'sell'}">${isBuy?'BUY':'SELL'}</span></div>
      <div>
        <div class="dash-trade-token">${esc(tr.symbol || tr.name)}</div>
        <div class="dash-trade-sym">${esc(tr.name || "")}</div>
      </div>
      <div class="dash-trade-amt">${amtHtml}</div>
      <div class="dash-trade-pnl">${pnlHtml}</div>
      <div style="font-size:10px;opacity:0.35;white-space:nowrap;">${date}</div>
    </div>`;
}

/* ═══════════════════════════════════════════════════════
   P/L BAR CHART  (last 10 sells)
═══════════════════════════════════════════════════════ */
function renderPnlChart() {
  const el    = document.getElementById("dashPnlChart");
  if (!el) return;

  const sells = (profile.trades || [])
    .filter(t => t.type === "sell" && t.pnl !== undefined)
    .slice(0, 10)
    .reverse(); /* oldest → newest, left → right */

  if (sells.length < 2) { el.style.display = "none"; return; }
  el.style.display = "block";

  const vals   = sells.map(t => parseFloat(t.pnl));
  const maxAbs = Math.max(...vals.map(Math.abs), 0.001);

  el.innerHTML = `
    <div class="pnl-chart-title">P/L PER SELL · LAST ${sells.length} TRADES</div>
    <div class="pnl-chart-bars">
      ${sells.map(t => {
        const v    = parseFloat(t.pnl);
        const pct  = Math.max(4, Math.round((Math.abs(v) / maxAbs) * 100));
        const pos  = v >= 0;
        const sym  = (t.symbol || t.name || "").slice(0, 5);
        return `
          <div class="pnl-bar-col">
            <div class="pnl-bar-wrap">
              <div class="pnl-bar ${pos ? 'pos' : 'neg'}" style="height:${pct}%"
                title="${pos ? '+' : ''}${formatSol(v)} — ${esc(t.symbol || t.name || '')}"></div>
            </div>
            <div class="pnl-bar-label">${esc(sym)}</div>
          </div>`;
      }).join("")}
    </div>`;
}

/* ═══════════════════════════════════════════════════════
   FULL TRADE HISTORY MODAL  (all 30, paginated)
═══════════════════════════════════════════════════════ */
const TH_PER_PAGE = 10;
let _thPage = 0;

window.openTradeHistoryModal = function() {
  _thPage = 0;
  document.getElementById("tradeHistModalOverlay")?.remove();

  const overlay = document.createElement("div");
  overlay.className = "th-modal-overlay";
  overlay.id        = "tradeHistModalOverlay";
  overlay.innerHTML = `
    <div class="th-modal-card" id="tradeHistModalCard">
      <div class="th-modal-header">
        <div class="th-modal-title">📋 FULL TRADE HISTORY</div>
        <button class="th-modal-close" onclick="document.getElementById('tradeHistModalOverlay').remove()">✕</button>
      </div>
      <div class="th-modal-body" id="thModalBody"></div>
      <div class="th-modal-pagination" id="thModalPager"></div>
    </div>`;

  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  _renderThPage(0);
};

function _renderThPage(page) {
  const allTrades = profile.trades || [];
  const total     = allTrades.length;
  const pages     = Math.max(1, Math.ceil(total / TH_PER_PAGE));
  _thPage = Math.max(0, Math.min(page, pages - 1));

  const slice = allTrades.slice(_thPage * TH_PER_PAGE, (_thPage + 1) * TH_PER_PAGE);

  const body  = document.getElementById("thModalBody");
  const pager = document.getElementById("thModalPager");
  if (!body || !pager) return;

  /* ── Table ── */
  body.innerHTML = !total
    ? `<div class="dash-trade-empty">No trades yet — start trading in the Simulator!</div>`
    : `<div class="th-modal-count">${total} trade${total!==1?'s':''} saved (max 30)</div>
       <div class="dash-trade-table">
         <div class="dash-trade-header">
           <div>TYPE</div><div>TOKEN</div><div>AMOUNT</div><div>P/L</div><div>DATE</div>
         </div>
         ${slice.map(tr => buildTradeRow(tr)).join("")}
       </div>`;

  /* ── Pagination ── */
  if (pages <= 1) { pager.innerHTML = ""; return; }

  const btns = [];
  btns.push(`<button class="th-pg-btn" ${_thPage===0?"disabled":""} onclick="window._thGoPage(${_thPage-1})">‹</button>`);
  for (let i = 0; i < pages; i++) {
    btns.push(`<button class="th-pg-btn ${i===_thPage?'active':''}" onclick="window._thGoPage(${i})">${i+1}</button>`);
  }
  btns.push(`<button class="th-pg-btn" ${_thPage===pages-1?"disabled":""} onclick="window._thGoPage(${_thPage+1})">›</button>`);

  pager.innerHTML = btns.join("");
}

window._thGoPage = function(page) { _renderThPage(page); };

/* ═══════════════════════════════════════════════════════
   CURRENT HOLDINGS  (with live P/L)
═══════════════════════════════════════════════════════ */
function renderHoldings() {
  const el       = document.getElementById("dashHoldings");
  const holdings = profile.holdings || {};
  const keys     = Object.keys(holdings).filter(k => (holdings[k]?.amount || 0) > 0.000001);

  if (!keys.length) {
    el.innerHTML = `<div class="dash-holdings-empty">No open positions — start trading in the Simulator!</div>`;
    return;
  }

  /* ── Summary totals (computed once at render; refreshed live by refreshHoldingsSummary) ── */
  let totalCost = 0, totalCurVal = 0, pricesLoaded = 0;
  keys.forEach(mint => {
    const h = holdings[mint];
    const costSol = h.totalCostSol || 0;
    totalCost += costSol;
    const price = dashPrices[mint];
    if (price && h.avgPrice > 0 && costSol > 0) {
      totalCurVal += costSol * (price / h.avgPrice);
      pricesLoaded++;
    }
  });
  const allLoaded    = pricesLoaded === keys.length;
  const totalPnl     = allLoaded ? totalCurVal - totalCost : null;
  const totalPnlPct  = (totalPnl !== null && totalCost > 0) ? (totalPnl / totalCost) * 100 : null;
  const pnlColor     = totalPnl === null ? "rgba(207,255,244,0.35)" : totalPnl >= 0 ? "#2cffc9" : "#ff4d6d";
  const pnlSign      = totalPnl !== null && totalPnl >= 0 ? "+" : "";
  const pnlSolTxt    = totalPnl !== null ? `${pnlSign}${formatSol(totalPnl)}` : "Loading…";
  const pnlPctTxt    = totalPnlPct !== null ? `${pnlSign}${totalPnlPct.toFixed(2)}%` : "";

  el.innerHTML = `
    <div class="dh-summary">
      <div class="dh-summary-col">
        <div class="dh-summary-label">TOTAL P/L</div>
        <div class="dh-summary-pnl-sol" id="dhTotalPnlSol" style="color:${pnlColor}">${pnlSolTxt}</div>
        <div class="dh-summary-pnl-pct" id="dhTotalPnlPct" style="color:${pnlColor}">${pnlPctTxt}</div>
      </div>
      <div class="dh-summary-divider"></div>
      <div class="dh-summary-col">
        <div class="dh-summary-label">INVESTED</div>
        <div class="dh-summary-invested" id="dhTotalInvested">${formatSol(totalCost)}</div>
        <div class="dh-summary-invested-lbl">${keys.length} position${keys.length !== 1 ? "s" : ""}</div>
      </div>
    </div>

    <div class="dash-holdings-list">${keys.map(mint => {
    const h        = holdings[mint];
    const logo     = h.logo ? `/.netlify/functions/logoProxy?url=${encodeURIComponent(h.logo)}` : "https://placehold.co/34x34";
    const costSol  = h.totalCostSol || 0;
    const safeMnt  = String(mint).replace(/[^1-9A-HJ-NP-Za-km-z]/g, "");

    /* Use cached price if already loaded */
    const price    = dashPrices[mint];
    const curVal   = (price && h.avgPrice > 0 && costSol > 0)
      ? costSol * (price / h.avgPrice) : null;
    const pnlSol   = curVal !== null ? curVal - costSol : null;
    const pnlPct   = pnlSol !== null && costSol > 0 ? (pnlSol / costSol) * 100 : null;
    const sign     = pnlSol !== null ? (pnlSol >= 0 ? "+" : "") : "";
    const pnlCol   = pnlSol !== null ? (pnlSol >= 0 ? "#2cffc9" : "#ff4d6d") : "rgba(207,255,244,0.3)";
    const pnlText  = pnlSol !== null
      ? `${sign}${formatSol(pnlSol)}  (${sign}${pnlPct.toFixed(1)}%)`
      : "⬤ Loading…";

    return `
      <div class="dash-holding-row">
        <img class="dash-holding-logo" src="${logo}"
          onerror="this.src='https://placehold.co/34x34'" />
        <div class="dash-holding-info">
          <div class="dash-holding-name">${esc(h.name || h.symbol)}</div>
          <div class="dash-holding-sym">${esc(h.symbol)}</div>
        </div>
        <div class="dash-holding-vals">
          <div class="dash-holding-cost" id="dash-val-${safeMnt}">${curVal !== null ? formatSol(curVal) : formatSol(costSol)}</div>
          <div class="dash-holding-cost-lbl">cost ${formatSol(costSol)}</div>
          <div class="dash-holding-pnl" id="dash-pnl-${safeMnt}" style="color:${pnlCol};">${pnlText}</div>
          <div class="dash-holding-dot" id="dash-dot-${safeMnt}">⬤ LIVE · 30s</div>
        </div>
        <a class="dash-holding-btn" href="safe-ape.html"
          onclick="localStorage.setItem('sa_prefill_mint','${safeMnt}')">
          Trade →
        </a>
      </div>`;
  }).join("")}</div>`;   /* closes .dash-holdings-list */
}

/* Recalculate & refresh only the summary totals (called after each price tick) */
function refreshHoldingsSummary() {
  const solEl   = document.getElementById("dhTotalPnlSol");
  const pctEl   = document.getElementById("dhTotalPnlPct");
  if (!solEl || !pctEl) return; /* holdings not rendered yet */

  const holdings = profile?.holdings || {};
  const keys     = Object.keys(holdings).filter(k => (holdings[k]?.amount || 0) > 0.000001);
  let totalCost = 0, totalCurVal = 0, pricesLoaded = 0;

  keys.forEach(mint => {
    const h = holdings[mint];
    const costSol = h.totalCostSol || 0;
    totalCost += costSol;
    const price = dashPrices[mint];
    if (price && h.avgPrice > 0 && costSol > 0) {
      totalCurVal += costSol * (price / h.avgPrice);
      pricesLoaded++;
    }
  });

  if (pricesLoaded === 0) return; /* still loading, leave previous values */

  const totalPnl    = totalCurVal - totalCost;
  const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
  const color       = totalPnl >= 0 ? "#2cffc9" : "#ff4d6d";
  const sign        = totalPnl >= 0 ? "+" : "";

  solEl.textContent  = `${sign}${formatSol(totalPnl)}`;
  solEl.style.color  = color;
  pctEl.textContent  = `${sign}${totalPnlPct.toFixed(2)}%`;
  pctEl.style.color  = color;
}

/* ═══════════════════════════════════════════════════════
   ACCOUNT SETTINGS MODAL
═══════════════════════════════════════════════════════ */
window.openAccountSettings = function() {
  try {
  if (!profile) {
    showToast("⏳ Dashboard is still loading — please wait a moment.");
    return;
  }
  document.getElementById("accountSettingsOverlay")?.remove();

  const earned    = new Set(profile.badges || []);
  /* Freebie + purchased badges are always available */
  BADGE_DEFS.filter(b => b.freebie).forEach(b => earned.add(b.id));
  getPurchased().forEach(p => earned.add(p.id));
  const savedName = localStorage.getItem("sa_display_name") || profile.accountName || "";
  const savedAvId = localStorage.getItem("sa_avatar_id") || "";

  /* All owned badges across every category shown in avatar picker */
  const avatarOptions = BADGE_DEFS.filter(b => b.freebie || earned.has(b.id));

  /* If nothing saved yet, pre-select Classic Ape */
  const effectiveAvId = savedAvId || "cosm_classic_ape";

  const avatarHtml = avatarOptions.map(b => `
    <div class="accs-av-option ${b.id === effectiveAvId ? 'selected' : ''}"
         id="av-opt-${b.id}"
         onclick="window.selectAvatar('${b.id}')"
         title="${esc(b.name || b.icon || '🦍')}">
      ${b.type === "video" && b.video
        ? `<video src="${b.video}" class="accs-av-video" autoplay loop muted playsinline></video>`
        : b.img
          ? `<img src="${b.img}" class="accs-av-img"
               onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
             <span class="accs-av-emoji" style="display:none">${b.icon}</span>`
          : `<span class="accs-av-emoji">${b.icon}</span>`}
    </div>`).join("");

  const overlay = document.createElement("div");
  overlay.className = "accs-overlay";
  overlay.id        = "accountSettingsOverlay";
  overlay.innerHTML = `
    <div class="accs-card" id="accountSettingsCard">

      <div class="accs-header">
        <div class="accs-title">⚙️ ACCOUNT SETTINGS</div>
        <button class="accs-close" onclick="document.getElementById('accountSettingsOverlay').remove()">✕</button>
      </div>

      <!-- Display Name -->
      <div class="accs-section">
        <div class="accs-section-label">DISPLAY NAME</div>
        <div class="accs-name-row">
          <input class="accs-name-input" id="accsNameInput" type="text"
            maxlength="24" placeholder="Your name…" value="${esc(savedName)}" />
          <button class="accs-save-btn" onclick="window.saveDisplayName()">Save</button>
        </div>
        <div class="accs-name-hint">Max 24 characters</div>
      </div>

      <!-- Avatar Picker -->
      <div class="accs-section">
        <div class="accs-section-label">PROFILE AVATAR</div>
        <div class="accs-section-sub">Choose from your earned badges</div>
        <div class="accs-av-grid" id="accsAvatarGrid">
          ${avatarHtml}
        </div>
        ${earned.size === 0 ? `<div class="accs-av-hint">Earn badges to unlock more avatar options!</div>` : ""}
      </div>

      <!-- Moon Market -->
      <div class="accs-section accs-market-row">
        <div class="accs-market-info">
          <div class="accs-section-label" style="color:#ff6eb4;">🛒 MOON MARKET</div>
          <div class="accs-section-sub">Frames · Profile Cards · Cosmetic Badges</div>
        </div>
        <button class="accs-market-open-btn" onclick="window.openMoonMarket()">Open →</button>
      </div>

      <!-- Disconnect -->
      <div class="accs-section accs-disconnect-section">
        <button class="accs-disconnect-btn" onclick="window.disconnectDashWallet()">
          🔌 Disconnect Wallet
        </button>
        <div class="accs-name-hint" style="text-align:center;margin-top:6px;">Clears your session — your data stays safe on-chain</div>
      </div>

    </div>`;

  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  } catch (err) {
    console.error("[AccountSettings] Error:", err);
    showToast("⚠️ Could not open settings — check the console for details.");
  }
};

/* ═══════════════════════════════════════════════════════
   MOON MARKET MODAL
═══════════════════════════════════════════════════════ */
window.openMoonMarket = function(startTab = "frames") {
  document.getElementById("moonMarketOverlay")?.remove();

  const savedFrameId = localStorage.getItem("sa_frame_id")   || "frame_none";
  const savedCardId  = localStorage.getItem("sa_card_design") || "card_classic";
  const owned = new Set([
    ...BADGE_DEFS.filter(b => b.freebie).map(b => b.id),
    ...(profile?.badges || []),
    ...getPurchased().map(p => p.id),
  ]);

  /* ── Frame items ── */
  function frameItemHtml(f) {
    const isOwned    = f.freebie || isPurchased(f.id);
    const isEquipped = f.id === savedFrameId;
    const previewCls = `mm-frame-preview${f.cssClass ? " " + f.cssClass : ""}`;
    return `
      <div class="mm-item${isEquipped ? " mm-item-active" : ""}">
        <div class="${previewCls}"><div class="mm-frame-avatar">🦍</div></div>
        <div class="mm-item-name">${esc(f.name)}</div>
        <div class="mm-item-desc">${esc(f.desc)}</div>
        <div class="mm-item-price${f.freebie ? " mm-price-free" : ""}">${f.freebie ? "FREE" : `$${f.price}`}</div>
        ${isOwned
          ? `<button class="mm-equip-btn${isEquipped ? " mm-equipped" : ""}"
               data-frame="${f.id}" onclick="window.equipFrame('${f.id}')">
               ${isEquipped ? "✅ EQUIPPED" : "Equip"}</button>`
          : `<button class="mm-buy-btn" data-buy="${f.id}"
               onclick="window.buyMarketItem('frame','${f.id}',${f.price})">
               💳 Buy $${f.price}</button>`}
      </div>`;
  }

  /* ── Card design items ── */
  function cardItemHtml(c) {
    const isOwned    = c.freebie || isPurchased(c.id);
    const isEquipped = c.id === savedCardId;
    const th = CARD_THEMES[c.id] || CARD_THEMES.card_classic;
    return `
      <div class="mm-item${isEquipped ? " mm-item-active" : ""}">
        <div class="mm-card-preview" style="background:${th.bg};border-color:${th.border};">
          <div class="mm-card-prev-logo" style="color:${th.logo};">🌙 S2M</div>
          <div class="mm-card-prev-tag"  style="color:${th.logo};opacity:.6;">${esc(c.icon)} ${esc(c.name)}</div>
          <div class="mm-card-prev-stats" style="color:${th.logo};">
            <span>P/L</span><span>WIN%</span><span>LVL</span></div>
        </div>
        <div class="mm-item-name">${esc(c.name)}</div>
        <div class="mm-item-desc">${esc(c.desc)}</div>
        <div class="mm-item-price${c.freebie ? " mm-price-free" : ""}">${c.freebie ? "FREE" : `$${c.price}`}</div>
        ${isOwned
          ? `<button class="mm-equip-btn${isEquipped ? " mm-equipped" : ""}"
               data-card="${c.id}" onclick="window.equipCardDesign('${c.id}')">
               ${isEquipped ? "✅ EQUIPPED" : "Equip"}</button>`
          : `<button class="mm-buy-btn" data-buy="${c.id}"
               onclick="window.buyMarketItem('card','${c.id}',${c.price})">
               💳 Buy $${c.price}</button>`}
      </div>`;
  }

  /* ── Cosmetic badge item ── */
  function cosmeticItemHtml(b) {
    const isOwned = b.freebie || owned.has(b.id);
    const previewHtml = b.type === "video" && b.video
      ? `<video src="${b.video}" class="mm-badge-video" autoplay loop muted playsinline></video>`
      : b.img
        ? `<img src="${b.img}" style="width:72px;height:72px;object-fit:cover;border-radius:12px;"
             onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
           <span style="display:none;font-size:44px;">${b.icon}</span>`
        : `<span style="font-size:52px;line-height:1;">${b.icon}</span>`;
    return `
      <div class="mm-item">
        <div class="mm-badge-preview">${previewHtml}</div>
        <div class="mm-item-name">${esc(b.name)}</div>
        <div class="mm-item-desc">${esc(b.desc)}</div>
        <div class="mm-item-price${b.freebie ? " mm-price-free" : ""}">${b.freebie ? "FREE" : `$${b.priceUsd}`}</div>
        ${isOwned
          ? `<button class="mm-equip-btn" onclick="window.selectAvatar('${b.id}');showToast('✅ Avatar set to ${esc(b.name)}!')">
               Use as Avatar</button>`
          : `<button class="mm-buy-btn" data-buy="${b.id}"
               onclick="window.buyMarketItem('badge','${b.id}',${b.priceUsd})">
               💳 Buy $${b.priceUsd}</button>`}
      </div>`;
  }

  /* ── Cosmetics panel with sub-sections ── */
  const freeBadges    = BADGE_DEFS.filter(b => b.cat === "cosmetics" && b.subcat === "free");
  const communityBadges = BADGE_DEFS.filter(b => b.cat === "cosmetics" && b.subcat === "community");
  const krakenBadges  = BADGE_DEFS.filter(b => b.cat === "cosmetics" && b.subcat === "moon_krakens");

  const cosmeticsHtml = `
    <div class="mm-subheader">🦍 FREE BADGES</div>
    <div class="mm-sub-grid">${freeBadges.map(cosmeticItemHtml).join("")}</div>
    <div class="mm-subheader" style="color:#ff6eb4;">❤️ COMMUNITY BADGES</div>
    <div class="mm-sub-grid">${communityBadges.map(cosmeticItemHtml).join("")}</div>
    <div class="mm-subheader" style="color:#c084fc;">🦑 MOON KRAKENS <span class="mm-animated-chip">ANIMATED</span></div>
    <div class="mm-sub-grid">${krakenBadges.map(cosmeticItemHtml).join("")}</div>`;

  const overlay = document.createElement("div");
  overlay.className = "mm-overlay";
  overlay.id = "moonMarketOverlay";
  overlay.innerHTML = `
    <div class="mm-modal">
      <div class="mm-header">
        <div class="mm-title">🛒 MOON MARKET</div>
        <button class="mm-close" onclick="document.getElementById('moonMarketOverlay').remove()">✕</button>
      </div>
      <div class="mm-subtitle">Cosmetics only — we never sell trading advantages, only style. One-time purchase, yours forever.</div>
      <div class="mm-tabs">
        <button class="mm-tab${startTab==="frames"?" active":""}"    onclick="window.mmSwitchTab('frames')">🖼️ Frames</button>
        <button class="mm-tab${startTab==="cards"?" active":""}"     onclick="window.mmSwitchTab('cards')">🃏 Cards</button>
        <button class="mm-tab${startTab==="cosmetics"?" active":""}" onclick="window.mmSwitchTab('cosmetics')">✨ Cosmetics</button>
      </div>
      <div id="mm-panel-frames"    style="display:${startTab==="frames"?"grid":"none"}"    class="mm-panel">
        ${FRAME_DEFS.map(frameItemHtml).join("")}
      </div>
      <div id="mm-panel-cards"     style="display:${startTab==="cards"?"grid":"none"}"     class="mm-panel">
        ${CARD_DESIGN_DEFS.map(cardItemHtml).join("")}
      </div>
      <div id="mm-panel-cosmetics" style="display:${startTab==="cosmetics"?"block":"none"}" class="mm-panel-cosm">
        ${cosmeticsHtml}
      </div>
      <div class="mm-footer-note">
        💳 Payments go directly to fund Scan2Moon development. Thank you for the support! 🙏<br>
        Purchases are stored to your wallet session. Keep your Phantom connected to access them.
      </div>
    </div>`;

  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
};

window.mmSwitchTab = function(tab) {
  ["frames","cards","cosmetics"].forEach(t => {
    document.getElementById(`mm-panel-${t}`).style.display = t === tab ? "grid" : "none";
  });
  document.querySelectorAll(".mm-tab").forEach((btn, i) => {
    const tabs = ["frames","cards","cosmetics"];
    btn.classList.toggle("active", tabs[i] === tab);
  });
};

window.equipFrame = function(frameId) {
  localStorage.setItem("sa_frame_id", frameId);
  /* Update hero */
  const frameEl = document.getElementById("dashAvatarFrame");
  if (frameEl) {
    const f = FRAME_DEFS.find(x => x.id === frameId);
    frameEl.className = ("dash-avatar-frame " + (f?.cssClass || "")).trim();
  }
  /* Update buttons inside the market */
  document.querySelectorAll("[data-frame]").forEach(btn => {
    const fid = btn.dataset.frame;
    btn.classList.toggle("mm-equipped", fid === frameId);
    btn.textContent = fid === frameId ? "✅ EQUIPPED" : "Equip";
  });
  /* Update active highlight */
  document.querySelectorAll(".mm-item").forEach(el => {
    const btn = el.querySelector("[data-frame]");
    if (btn) el.classList.toggle("mm-item-active", btn.dataset.frame === frameId);
  });
  showToast("✅ Frame equipped!");
};

window.equipCardDesign = function(designId) {
  localStorage.setItem("sa_card_design", designId);
  /* Update buttons */
  document.querySelectorAll("[data-card]").forEach(btn => {
    const did = btn.dataset.card;
    btn.classList.toggle("mm-equipped", did === designId);
    btn.textContent = did === designId ? "✅ EQUIPPED" : "Equip";
  });
  document.querySelectorAll(".mm-item").forEach(el => {
    const btn = el.querySelector("[data-card]");
    if (btn) el.classList.toggle("mm-item-active", btn.dataset.card === designId);
  });
  showToast("✅ Card design equipped!");
};

/* ═══════════════════════════════════════════════════════
   MOON MARKET — SOL PAYMENT FLOW
═══════════════════════════════════════════════════════ */
window.buyMarketItem = async function(itemType, itemId, priceUsd) {
  if (!wallet) { showToast("⚠️ Connect your Phantom wallet first!"); return; }

  const btn = document.querySelector(`[data-buy="${itemId}"]`);
  const origText = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = "⏳ Loading…"; }

  try {
    /* 1. Fetch live SOL price — fall back to a safe estimate if all APIs fail */
    showToast("🔄 Getting current SOL price…");
    let solPrice = await getSolPriceUsd();
    let priceIsEstimate = false;

    if (!solPrice || solPrice < 1) {
      /* All price APIs failed (common on localhost). Use a conservative fallback.
         The user will still see the exact SOL amount in Phantom before approving. */
      solPrice = 150; /* conservative estimate — keeps lamports slightly high */
      priceIsEstimate = true;
      showToast("⚠️ Live price unavailable — using $150 estimate. Check amount in Phantom!");
      await new Promise(r => setTimeout(r, 1800)); /* let user read the warning */
    }

    const solAmount = priceUsd / solPrice;
    const lamports  = Math.ceil(solAmount * 1_000_000_000);
    if (btn) btn.textContent = `⏳ Confirm in Phantom…`;
    if (!priceIsEstimate) showToast(`💳 Approve: ${solAmount.toFixed(4)} SOL ($${priceUsd})`);

    /* 2. Get latest blockhash via raw fetch (avoids web3.js CORS issues).
          Tries multiple public RPC endpoints until one responds. */
    if (btn) btn.textContent = "⏳ Connecting to Solana…";
    const BLOCKHASH_RPCS = [
      "https://solana.drpc.org",
      "https://rpc.ankr.com/solana",
      "https://api.mainnet-beta.solana.com",
    ];
    const BH_BODY = JSON.stringify({
      jsonrpc: "2.0", id: 1,
      method: "getLatestBlockhash",
      params: [{ commitment: "confirmed" }],
    });

    let blockhash = null, usedRpc = null;
    for (const rpcUrl of BLOCKHASH_RPCS) {
      try {
        const res = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: BH_BODY,
          signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) continue;
        const d = await res.json();
        const bh = d?.result?.value?.blockhash;
        if (bh) { blockhash = bh; usedRpc = rpcUrl; break; }
      } catch { /* try next */ }
    }
    if (!blockhash) throw new Error(
      "Could not reach Solana network. If testing locally, payments work on the live site (scan2moon.com)."
    );

    /* 3. Build + sign transaction (no Connection needed — just web3 primitives) */
    const fromPubkey = new solanaWeb3.PublicKey(wallet);
    const toPubkey   = new solanaWeb3.PublicKey(TREASURY_WALLET);
    const transaction = new solanaWeb3.Transaction({
      recentBlockhash: blockhash,
      feePayer: fromPubkey,
    }).add(solanaWeb3.SystemProgram.transfer({ fromPubkey, toPubkey, lamports }));

    const provider = window.phantom?.solana || window.solana;
    if (!provider?.isPhantom) throw new Error("Phantom wallet not detected.");

    if (btn) btn.textContent = "⏳ Confirm in Phantom…";
    const result = await provider.signAndSendTransaction(transaction);
    const sig    = result?.signature || result;

    /* 4. Unlock immediately — Phantom already submitted the TX */
    savePurchase(itemId, itemType, priceUsd, sig);
    showToast(`🎉 Payment sent! Unlocking now…`);
    if (btn) { btn.disabled = false; btn.textContent = origText; }

    /* 5. Re-open market on the right tab */
    const tabMap = { frame: "frames", card: "cards", badge: "cosmetics" };
    window.openMoonMarket(tabMap[itemType] || "cosmetics");

    /* 6. Confirm silently in background (non-blocking) */
    _confirmTxBackground(sig, usedRpc);

  } catch (err) {
    console.error("[BuyMarketItem]", err);
    const msg = err.message?.toLowerCase().includes("rejected") || err.message?.toLowerCase().includes("cancelled")
      ? "❌ Payment cancelled."
      : `⚠️ ${err.message?.slice(0, 80) || "Payment failed — please try again."}`;
    showToast(msg);
    if (btn) { btn.disabled = false; btn.textContent = origText; }
  }
};

/* Poll for TX confirmation in background — no blocking, no UI freeze */
async function _confirmTxBackground(sig, rpcUrl) {
  if (!sig || !rpcUrl) return;
  const body = JSON.stringify({
    jsonrpc: "2.0", id: 1,
    method: "getSignatureStatuses",
    params: [[sig], { searchTransactionHistory: true }],
  });
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 2500));
    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) continue;
      const d = await res.json();
      const status = d?.result?.value?.[0];
      if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
        console.log(`[S2M] TX confirmed on-chain ✅ ${sig}`);
        showToast("✅ Payment confirmed on-chain!");
        return;
      }
      if (status?.err) {
        console.warn(`[S2M] TX failed on-chain ⚠️`, status.err);
        showToast("⚠️ Transaction may have failed — check Phantom history.");
        return;
      }
    } catch { /* keep polling */ }
  }
  console.warn(`[S2M] TX confirmation timed out: ${sig}`);
}

window.saveDisplayName = function() {
  const val = document.getElementById("accsNameInput")?.value.trim();
  if (!val) return;
  localStorage.setItem("sa_display_name", val);
  document.getElementById("dashName").textContent = esc(val);
  showToast("✅ Name updated!");
};

window.selectAvatar = function(badgeId) {
  /* Update selection ring in picker */
  document.querySelectorAll(".accs-av-option").forEach(el => el.classList.remove("selected"));
  document.getElementById(`av-opt-${badgeId}`)?.classList.add("selected");

  const avEl = document.getElementById("dashAvatar");

  if (badgeId) {
    localStorage.setItem("sa_avatar_id", badgeId);
    const b = BADGE_DEFS.find(x => x.id === badgeId);
    if (b?.type === "video" && b.video) {
      if (avEl) avEl.innerHTML = `<video src="${b.video}" class="dash-avatar-video"
        autoplay loop muted playsinline></video>`;
    } else if (b?.img) {
      if (avEl) avEl.innerHTML = `<img src="${b.img}" class="dash-avatar-img"
        onerror="this.parentElement.textContent='${b.icon || "🦍"}'" alt="${esc(b.name)}">`;
    } else if (b?.icon) {
      if (avEl) avEl.textContent = b.icon;
    }
  } else {
    localStorage.removeItem("sa_avatar_id");
    if (avEl) avEl.textContent = "🦍";
  }
  showToast("✅ Avatar updated!");
};

window.disconnectDashWallet = function() {
  if (!confirm("Disconnect wallet? Your simulator data stays safe — this just ends your session.")) return;
  localStorage.removeItem("sa_wallet");
  localStorage.removeItem("sa_display_name");
  localStorage.removeItem("sa_avatar_id");
  if (dashPriceTimer) clearInterval(dashPriceTimer);
  document.getElementById("accountSettingsOverlay")?.remove();
  location.reload();
};

/* ═══════════════════════════════════════════════════════
   MISSIONS TEASER  — compact dashboard widget → links to tasks.html
═══════════════════════════════════════════════════════ */
function _getMissionData() {
  const trades = profile.trades  || [];
  const badges = profile.badges  || [];
  const streak = profile.loginStreak || 0;
  const wins   = profile.winCount    || 0;
  const losses = profile.lossCount   || 0;
  const total  = wins + losses;
  const xp     = (total * 25) + (badges.length * 50) + (streak * 5)
               + (profile.socialXp  || 0)
               + (profile.academyXp || 0);
  const lvl    = calcLevel(xp);
  const sells  = trades.filter(t => t.type === "sell").length;
  return [
    { icon:"🔗", title:"Welcome to Scan2Moon",  target:1, current:1,                                         xp:10 },
    { icon:"🔍", title:"First Token Scan",       target:1, current:sells>0||badges.length>0?1:0,             xp:15 },
    { icon:"💰", title:"5 Trades Closed",        target:5, current:Math.min(sells,5),                        xp:20 },
    { icon:"🏅", title:"Collect 3 Badges",       target:3, current:Math.min(badges.length,3),                xp:30 },
    { icon:"🔥", title:"7-Day Login Streak",     target:7, current:Math.min(streak,7),                       xp:25 },
    { icon:"📈", title:"Win Rate Above 50%",     target:1, current:total>0&&wins/total>=0.5?1:0,             xp:40 },
    { icon:"🚀", title:"Reach Account Level 5",  target:5, current:Math.min(lvl,5),                          xp:50 },
    { icon:"🎓", title:"Complete Academy Course",target:1, current:0,                                        xp:60, locked:true },
  ];
}

function renderMissionTeaser() {
  const el = document.getElementById("dashMissionTeaser");
  if (!el) return;
  const missions = _getMissionData();
  const done     = missions.filter(m => m.current >= m.target).length;
  const total    = missions.length;
  const pct      = Math.round((done / total) * 100);
  const preview  = missions.slice(0, 4);

  el.innerHTML = `
    <div class="panel mteaser-panel">
      <div class="panel-title">
        ⚡ MISSIONS
        <a href="tasks.html" class="mteaser-view-all">View All →</a>
      </div>
      <div class="panel-body">
        <div class="mteaser-progress-row">
          <span class="mteaser-count">${done} / ${total} completed</span>
          <div class="mteaser-bar"><div class="mteaser-bar-fill" style="width:${pct}%"></div></div>
          <span class="mteaser-pct">${pct}%</span>
        </div>
        <div class="mteaser-list">
          ${preview.map(m => {
            const isDone = m.current >= m.target;
            const p      = Math.min(Math.round((m.current / m.target) * 100), 100);
            return `
              <div class="mteaser-item ${isDone ? 'mteaser-done' : ''}">
                <span class="mteaser-icon">${isDone ? '✅' : m.icon}</span>
                <span class="mteaser-title">${m.title}</span>
                ${!isDone ? `<div class="mteaser-mini-bar"><div style="width:${p}%"></div></div>` : ''}
                <span class="mteaser-xp">+${m.xp} XP</span>
              </div>`;
          }).join("")}
        </div>
        <a href="tasks.html" class="dash-cta-btn" style="margin-top:10px;">
          ⚡ Open Missions & Tasks →
        </a>
      </div>
    </div>`;
}

/* ═══════════════════════════════════════════════════════
   SCANNER STATS
═══════════════════════════════════════════════════════ */
function renderScannerStats() {
  const el = document.getElementById("dashScannerStats");
  if (!el) return;

  const trades  = profile.trades || [];
  const wins    = profile.winCount  || 0;
  const losses  = profile.lossCount || 0;
  const total   = wins + losses;
  /* Derive a plausible scan count: each trade implies at least one scan */
  const estScans   = Math.max(total * 2, trades.length * 2, 12);
  const estRisky   = Math.round(estScans * 0.38);
  const estSafe    = estScans - estRisky;
  const avgRisk    = 62; /* placeholder — will be real once scanner API feeds this */

  const stats = [
    { icon: "🔍", label: "Total Scans",    val: estScans,              sub: "tokens analysed" },
    { icon: "✅", label: "Safe Tokens",    val: estSafe,               sub: "passed all checks" },
    { icon: "🚨", label: "Risky Tokens",   val: estRisky,              sub: "flagged as danger" },
    { icon: "📊", label: "Avg Risk Score", val: `${avgRisk}/100`,      sub: "lower = safer" },
  ];

  el.innerHTML = `
    <div class="scanner-stats-grid">
      ${stats.map(s => `
        <div class="scanner-stat-item">
          <div class="scanner-stat-icon">${s.icon}</div>
          <div class="scanner-stat-val">${s.val}</div>
          <div class="scanner-stat-label">${s.label}</div>
          <div class="scanner-stat-sub">${s.sub}</div>
        </div>`).join("")}
    </div>
    <div class="scanner-stats-note">
      📡 Live scan history syncs when you use the Risk Scanner
    </div>`;
}

/* ═══════════════════════════════════════════════════════
   ACADEMY PLACEHOLDER  — space reserved for future build
═══════════════════════════════════════════════════════ */
/* ── Lightweight course map (mirrors academy.js COURSES) ── */
const ACADEMY_COURSES = [
  {
    num: "01", title: "Risk Scanner Fundamentals",
    badgeId: "scanner_analyst",    badge: "Scanner Analyst",
    color: "#2cffc9", bgColor: "rgba(44,255,201,0.08)", borderColor: "rgba(44,255,201,0.25)",
    totalLessons: 5,
    lessonIds: ["sb_1","sb_2","sb_3","sb_4","sb_quiz"],
  },
  {
    num: "02", title: "AI Sentinel — Threat Detection",
    badgeId: "sentinel_certified", badge: "Sentinel Certified",
    color: "#c084fc", bgColor: "rgba(192,132,252,0.08)", borderColor: "rgba(192,132,252,0.25)",
    totalLessons: 5,
    lessonIds: ["sen_1","sen_2","sen_3","sen_4","sen_quiz"],
  },
  {
    num: "03", title: "Safe Trading on Solana",
    badgeId: "disciplined_trader", badge: "Disciplined Trader",
    color: "#f59e0b", bgColor: "rgba(245,158,11,0.08)", borderColor: "rgba(245,158,11,0.25)",
    totalLessons: 5,
    lessonIds: ["st_1","st_2","st_3","st_4","st_quiz"],
  },
  {
    num: "04", title: "Market Dynamics & Pattern Recognition",
    badgeId: "market_analyst",     badge: "Market Analyst",
    color: "#fb7185", bgColor: "rgba(251,113,133,0.08)", borderColor: "rgba(251,113,133,0.25)",
    totalLessons: 5,
    lessonIds: ["md_1","md_2","md_3","md_4","md_quiz"],
  },
];

function renderAcademyPlaceholder() {
  const el = document.getElementById("dashAcademyPlaceholder");
  if (!el) return;

  const badges  = profile.badges || [];
  const prog    = profile.academyProgress || {};
  const acadXp  = profile.academyXp || 0;

  /* Academy level thresholds (mirrors dashboard.js calcAcadLevel) */
  const ACAD_THRESHOLDS = [0,100,250,500,900,1400,2000];
  let acadLvl = 0;
  for (let i = 0; i < ACAD_THRESHOLDS.length; i++) {
    if (acadXp >= ACAD_THRESHOLDS[i]) acadLvl = i + 1;
  }
  const acadLvlLabel = ["—","Enrolled","Student","Scholar","Advanced","Professor","Master"][Math.min(acadLvl, 6)];
  const nextThreshold = ACAD_THRESHOLDS[Math.min(acadLvl, ACAD_THRESHOLDS.length - 1)] || ACAD_THRESHOLDS[ACAD_THRESHOLDS.length - 1];
  const prevThreshold = ACAD_THRESHOLDS[Math.max(acadLvl - 1, 0)];
  const xpInLevel  = acadXp - prevThreshold;
  const xpForLevel = nextThreshold - prevThreshold;
  const lvlPct     = xpForLevel > 0 ? Math.min(100, Math.round((xpInLevel / xpForLevel) * 100)) : 100;

  /* Earned certificate count */
  const certCount = ACADEMY_COURSES.filter(c => badges.includes(c.badgeId)).length;

  /* Course lesson progress */
  const courseRows = ACADEMY_COURSES.map(c => {
    const earned      = badges.includes(c.badgeId);
    const lessonsComplete = c.lessonIds.filter(id => prog[id]).length;
    const lessonPct   = Math.round((lessonsComplete / c.totalLessons) * 100);

    if (earned) {
      /* ── Earned certificate card ── */
      return `
        <div class="dash-acad-cert-card earned" style="border-color:${c.borderColor};">
          <div class="dash-acad-cert-color-bar" style="background:${c.color};"></div>
          <div class="dash-acad-cert-num" style="color:${c.color};background:${c.bgColor};border-color:${c.borderColor};">${c.num}</div>
          <div class="dash-acad-cert-info">
            <div class="dash-acad-cert-title">${esc(c.title)}</div>
            <div class="dash-acad-cert-badge-name" style="color:${c.color};">${esc(c.badge)}</div>
          </div>
          <div class="dash-acad-cert-status earned-icon">🏅</div>
        </div>`;
    } else {
      /* ── In-progress / locked card ── */
      const isInProgress = lessonsComplete > 0;
      return `
        <div class="dash-acad-cert-card ${isInProgress ? 'progress' : 'locked'}">
          <div class="dash-acad-cert-color-bar" style="background:${isInProgress ? c.color : 'rgba(207,255,244,0.08)'};"></div>
          <div class="dash-acad-cert-num" style="color:rgba(207,255,244,${isInProgress ? '0.4' : '0.15'});background:rgba(207,255,244,0.04);border-color:rgba(207,255,244,0.08);">${c.num}</div>
          <div class="dash-acad-cert-info">
            <div class="dash-acad-cert-title" style="color:rgba(207,255,244,${isInProgress ? '0.55' : '0.25'});">${esc(c.title)}</div>
            ${isInProgress ? `
              <div class="dash-acad-cert-prog-wrap">
                <div class="dash-acad-cert-prog-bar">
                  <div class="dash-acad-cert-prog-fill" style="width:${lessonPct}%;background:${c.color};"></div>
                </div>
                <span class="dash-acad-cert-prog-txt">${lessonsComplete}/${c.totalLessons}</span>
              </div>` : `
              <div class="dash-acad-cert-badge-name" style="color:rgba(207,255,244,0.2);">${esc(c.badge)}</div>`}
          </div>
          <div class="dash-acad-cert-status">${isInProgress ? `<span style="font-size:10px;font-weight:800;color:${c.color};">${lessonPct}%</span>` : '🔒'}</div>
        </div>`;
    }
  }).join("");

  el.innerHTML = `
    <div class="dash-acad-live">

      <!-- XP / Level bar -->
      <div class="dash-acad-xp-row">
        <div class="dash-acad-xp-left">
          <span class="dash-acad-lvl-num">${acadLvl}</span>
          <span class="dash-acad-lvl-label">${acadLvlLabel}</span>
        </div>
        <div class="dash-acad-xp-right">
          <div class="dash-acad-xp-bar">
            <div class="dash-acad-xp-fill" style="width:${lvlPct}%;"></div>
          </div>
          <div class="dash-acad-xp-nums">${acadXp.toLocaleString()} XP</div>
        </div>
      </div>

      <!-- Section header -->
      <div class="dash-acad-cert-header">
        <span>CERTIFICATES</span>
        <span class="dash-acad-cert-count">${certCount} / ${ACADEMY_COURSES.length} earned</span>
      </div>

      <!-- Certificate list -->
      <div class="dash-acad-cert-list">
        ${courseRows}
      </div>

      <!-- CTA -->
      <a href="academy.html" class="dash-cta-btn" style="margin-top:4px;">
        Go to Academy →
      </a>
    </div>`;
}

/* ═══════════════════════════════════════════════════════
   LEADERBOARD PREVIEW
═══════════════════════════════════════════════════════ */
const FAKE_LEADERBOARD = [
  { rank:1, name:"MoonWalker",   level:12, winRate:78.4, pnl: 847.3 },
  { rank:2, name:"DeFi Phantom", level:11, winRate:71.2, pnl: 612.8 },
  { rank:3, name:"SolNinja",     level:10, winRate:68.9, pnl: 489.5 },
  { rank:4, name:"ApeKing",      level: 9, winRate:65.1, pnl: 334.2 },
  { rank:5, name:"RiskHunter",   level: 8, winRate:61.7, pnl: 218.6 },
];

function renderLeaderboard() {
  const el = document.getElementById("dashLeaderboard");
  if (!el) return;

  const wins    = profile.winCount   || 0;
  const losses  = profile.lossCount  || 0;
  const total   = wins + losses;
  const winRate = total > 0 ? parseFloat(((wins / total) * 100).toFixed(1)) : 0;
  const pnl     = profile.totalPnL   || 0;
  const xp      = (total * 25) + ((profile.badges || []).length * 50) + ((profile.loginStreak || 0) * 5);
  const lvl     = calcLevel(xp);

  /* Insert user at correct position vs fake list */
  const userRank  = FAKE_LEADERBOARD.filter(e => e.pnl > pnl).length + 1;
  const userEntry = { rank: userRank, name: profile.accountName || "You", level: lvl, winRate, pnl, isUser: true };

  /* Build display rows: top 5 fakes + user if outside top 5 */
  const rows     = FAKE_LEADERBOARD.slice(0, 5).map(e => ({ ...e, isUser: false }));
  const inTop5   = userRank <= 5;
  if (inTop5) {
    rows.splice(userRank - 1, 0, userEntry);
    rows.length = Math.min(rows.length, 6);
  }
  const medals = ["🥇","🥈","🥉"];

  const rowHtml = r => `
    <div class="dash-lb-row ${r.isUser ? 'is-user' : ''}">
      <div class="dash-lb-rank">${r.rank <= 3 ? medals[r.rank - 1] : `#${r.rank}`}</div>
      <div class="dash-lb-name">${r.isUser
        ? `<span style="color:#2cffc9;">▶ ${esc(r.name)}</span>`
        : esc(r.name)}</div>
      <div class="dash-lb-lvl">LVL ${r.level}</div>
      <div class="dash-lb-wr" style="color:${r.winRate>=50?'#2cffc9':'#ff4d6d'}">${r.winRate}%</div>
      <div class="dash-lb-pnl" style="color:${r.pnl>=0?'#2cffc9':'#ff4d6d'}">${r.pnl>=0?'+':''}${formatSol(r.pnl)}</div>
    </div>`;

  el.innerHTML = `
    <div class="dash-lb-table">
      <div class="dash-lb-header"><div>RANK</div><div>TRADER</div><div>LVL</div><div>WIN%</div><div>P/L</div></div>
      ${rows.map(rowHtml).join("")}
      ${!inTop5 ? `
        <div class="dash-lb-sep">• • •</div>
        ${rowHtml(userEntry)}` : ""}
    </div>
    <div class="dash-lb-footer">Full leaderboard — <span style="color:rgba(255,180,50,0.75);">coming soon</span></div>`;
}

/* ═══════════════════════════════════════════════════════
   ACCOUNT CARD MODAL — live preview + equip controls
═══════════════════════════════════════════════════════ */

/* Build the inner HTML of the live card preview (uses CSS classes so frame animates) */
function _buildLiveCardHtml() {
  const wins    = profile.winCount   || 0;
  const losses  = profile.lossCount  || 0;
  const total   = wins + losses;
  const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : "0";
  const pnl     = profile.totalPnL   || 0;
  const xp      = (total * 25) + ((profile.badges || []).length * 50) + ((profile.loginStreak || 0) * 5);
  const lvl     = calcLevel(xp);
  const short   = wallet ? wallet.slice(0, 6) + "…" + wallet.slice(-4) : "";
  const badgeCnt = (profile.badges || []).length;
  const best    = (profile.trades || [])
    .filter(t => t.type === "sell" && (t.pnl || 0) > 0)
    .reduce((a, b) => (b.pnl > (a?.pnl || 0) ? b : a), null);

  const designId = localStorage.getItem("sa_card_design") || "card_classic";
  const th       = CARD_THEMES[designId] || CARD_THEMES.card_classic;
  const frameId  = localStorage.getItem("sa_frame_id") || "frame_none";
  const frameDef = FRAME_DEFS.find(f => f.id === frameId) || FRAME_DEFS[0];

  const savedAvId = localStorage.getItem("sa_avatar_id");
  const avBadge   = savedAvId ? BADGE_DEFS.find(x => x.id === savedAvId) : null;
  let avHtml;
  if (avBadge?.type === "video" && avBadge.video) {
    avHtml = `<video src="${avBadge.video}" autoplay loop muted playsinline
      style="width:68px;height:68px;object-fit:cover;border-radius:10px;display:block;"></video>`;
  } else if (avBadge?.img) {
    avHtml = `<img src="${avBadge.img}"
      style="width:68px;height:68px;object-fit:cover;border-radius:10px;display:block;">`;
  } else {
    avHtml = `<span style="font-size:52px;line-height:1;">${avBadge?.icon || "🦍"}</span>`;
  }

  return `
    <div style="background:${th.bg};border:1.5px solid ${th.border};border-radius:20px;
         padding:22px 20px 16px;font-family:'Inter','Segoe UI',sans-serif;color:#cffff4;
         box-shadow:0 0 50px rgba(0,0,0,0.85);">
      <div style="display:flex;justify-content:space-between;align-items:center;
           border-bottom:1px solid ${th.hdrBorder};padding-bottom:10px;margin-bottom:14px;">
        <span style="font-size:13px;font-weight:900;letter-spacing:1.5px;color:${th.logo};">🌙 SCAN2MOON</span>
        <span style="font-size:10px;font-weight:700;letter-spacing:1px;color:${th.logo};opacity:.6;">${th.tag}</span>
      </div>
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px;">
        <div class="dash-avatar-frame ${frameDef.cssClass}"
             style="width:68px;height:68px;flex-shrink:0;display:flex;align-items:center;
                    justify-content:center;border-radius:12px;">
          ${avHtml}
        </div>
        <div>
          <div style="font-size:17px;font-weight:900;color:${th.name};">
            ${esc(localStorage.getItem("sa_display_name") || profile.accountName || "Ape Trader")}
          </div>
          <div style="font-size:12px;font-weight:700;color:${th.accent};margin-top:3px;">${rankLabel(pnl)}</div>
          <div style="font-size:11px;color:${th.level};margin-top:2px;">LVL ${lvl}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-bottom:10px;">
        <div style="text-align:center;">
          <div style="font-size:13px;font-weight:900;color:${pnl>=0?th.statHi:'#ff4d6d'}">${pnl>=0?'+':''}${formatSol(pnl)}</div>
          <div style="font-size:8px;opacity:.5;margin-top:2px;letter-spacing:.5px;">P/L</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:13px;font-weight:900;color:${parseFloat(winRate)>=50?th.statHi:'#ff4d6d'}">${winRate}%</div>
          <div style="font-size:8px;opacity:.5;margin-top:2px;letter-spacing:.5px;">WIN RATE</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:13px;font-weight:900;">${total}</div>
          <div style="font-size:8px;opacity:.5;margin-top:2px;letter-spacing:.5px;">TRADES</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:13px;font-weight:900;color:${th.accent}">${badgeCnt}</div>
          <div style="font-size:8px;opacity:.5;margin-top:2px;letter-spacing:.5px;">BADGES</div>
        </div>
      </div>
      ${best ? `<div style="font-size:10px;color:${th.statHi};opacity:.75;margin-bottom:8px;">
        🏆 Best: <strong>+${formatSol(best.pnl)}</strong> on ${esc(best.symbol || best.name || "")}
      </div>` : ""}
      <div style="font-size:9px;font-family:monospace;color:${th.wallet};margin-bottom:8px;">${short}</div>
      <div style="font-size:9px;color:${th.footer};border-top:1px solid ${th.hdrBorder};padding-top:8px;letter-spacing:.3px;">
        scan2moon.com · We don't shill. We show data. 🌙
      </div>
    </div>`;
}

function _refreshLiveCard() {
  const el = document.getElementById("acLiveCard");
  if (el) el.innerHTML = _buildLiveCardHtml();
}

/* Thumb item for avatar / frame / card selectors */
function _acThumb(id, isSelected, isLocked, inner, label) {
  const lockedAttr = isLocked ? `data-locked="1"` : "";
  return `<div class="ac-thumb${isSelected?' ac-thumb-sel':''}${isLocked?' ac-thumb-locked':''}"
    data-ac-id="${id}" ${lockedAttr}>${inner}
    ${label ? `<div class="ac-thumb-label">${label}</div>` : ""}
    ${isLocked ? `<div class="ac-lock-chip">🔒</div>` : ""}
  </div>`;
}

window.openAccountCard = function() {
  document.getElementById("acctCardOverlay")?.remove();
  const earned = new Set(profile.badges || []);

  /* ── Avatar row ── */
  const savedAvId    = localStorage.getItem("sa_avatar_id") || "cosm_classic_ape";
  const avatarOpts   = BADGE_DEFS.filter(b => b.freebie || earned.has(b.id));
  const avatarHtml   = avatarOpts.map(b => {
    const inner = b.type === "video" && b.video
      ? `<video src="${b.video}" autoplay loop muted playsinline class="ac-thumb-video"></video>`
      : b.img
        ? `<img src="${b.img}" class="ac-thumb-img">`
        : `<span class="ac-thumb-icon">${b.icon}</span>`;
    return _acThumb(b.id, b.id === savedAvId, false, inner, "");
  }).join("");

  /* ── Frame row (all frames; lock unowned) ── */
  const savedFrameId = localStorage.getItem("sa_frame_id") || "frame_none";
  const frameHtml    = FRAME_DEFS.map(f => {
    const owned  = f.freebie || isPurchased(f.id);
    const inner  = `<span class="ac-thumb-icon">${f.icon}</span>`;
    const label  = f.price > 0 && !owned ? `$${f.price}` : f.name.split(" ")[0];
    return _acThumb(f.id, f.id === savedFrameId && owned, !owned, inner, label);
  }).join("");

  /* ── Card design row (all designs; lock unowned) ── */
  const savedDesignId = localStorage.getItem("sa_card_design") || "card_classic";
  const cardDesignHtml = CARD_DESIGN_DEFS.map(c => {
    const owned = c.freebie || isPurchased(c.id);
    const inner = `<span class="ac-thumb-icon">${c.icon}</span>`;
    const label = c.price > 0 && !owned ? `$${c.price}` : c.name.split(" ")[0];
    return _acThumb(c.id, c.id === savedDesignId && owned, !owned, inner, label);
  }).join("");

  /* ── Build modal ── */
  const overlay = document.createElement("div");
  overlay.id = "acctCardOverlay";
  overlay.className = "mm-overlay";
  overlay.innerHTML = `
    <div class="mm-modal ac-modal">
      <button class="mm-close" onclick="document.getElementById('acctCardOverlay').remove()">✕</button>
      <div class="mm-modal-title">🪪 ACCOUNT CARD</div>

      <div id="acLiveCard" class="ac-live-card">${_buildLiveCardHtml()}</div>

      <div class="ac-section-label">👤 AVATAR</div>
      <div class="ac-thumbs-row" id="acAvatarRow">${avatarHtml}</div>

      <div class="ac-section-label">🖼️ FRAME</div>
      <div class="ac-thumbs-row" id="acFrameRow">${frameHtml}</div>

      <div class="ac-section-label">🎨 CARD DESIGN</div>
      <div class="ac-thumbs-row" id="acCardRow">${cardDesignHtml}</div>

      <div class="ac-action-row">
        <button class="dash-profile-share-btn" id="acDownloadBtn"
          onclick="window.acDownloadCard()">📸 Download</button>
        <button class="dash-profile-share-btn"
          onclick="window.acTweetCard()">🐦 Share on X</button>
        <button class="dash-accs-btn"
          onclick="document.getElementById('acctCardOverlay').remove();window.openMoonMarket()">
          🛒 Moon Market
        </button>
      </div>
    </div>`;

  /* Delegate thumb clicks */
  overlay.addEventListener("click", e => {
    if (e.target === overlay) { overlay.remove(); return; }
    const thumb = e.target.closest(".ac-thumb");
    if (!thumb) return;
    if (thumb.dataset.locked === "1") {
      overlay.remove();
      window.openMoonMarket();
      return;
    }
    const id  = thumb.dataset.acId;
    const row = thumb.closest(".ac-thumbs-row");
    if (!id || !row) return;
    row.querySelectorAll(".ac-thumb").forEach(t => t.classList.remove("ac-thumb-sel"));
    thumb.classList.add("ac-thumb-sel");
    if (row.id === "acAvatarRow")  { localStorage.setItem("sa_avatar_id", id); updateDashAvatar(); }
    if (row.id === "acFrameRow")   { localStorage.setItem("sa_frame_id",  id); updateDashFrame(); }
    if (row.id === "acCardRow")    { localStorage.setItem("sa_card_design", id); }
    _refreshLiveCard();
  });

  document.body.appendChild(overlay);
};

window.acDownloadCard = async function() {
  const btn = document.getElementById("acDownloadBtn");
  if (btn) { btn.disabled = true; btn.textContent = "⏳ Saving…"; }
  try {
    const canvas = await buildProfileShareCard();
    const link = document.createElement("a");
    link.download = "Scan2Moon-Card.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
    showToast("✅ Card saved!");
  } catch(e) { showToast("⚠️ Could not save card."); }
  finally { if (btn) { btn.disabled = false; btn.textContent = "📸 Download"; } }
};

window.acTweetCard = function() {
  const pnl     = profile.totalPnL || 0;
  const wins    = profile.winCount  || 0;
  const losses  = profile.lossCount || 0;
  const total   = wins + losses;
  const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : "0";
  const xp      = (total * 25) + ((profile.badges || []).length * 50) + ((profile.loginStreak || 0) * 5);
  const tweet   = `📊 My Scan2Moon Stats:\n\n${rankLabel(pnl)} · LVL ${calcLevel(xp)}\n💰 P/L: ${pnl>=0?'+':''}${formatSol(pnl)}\n🎯 Win Rate: ${winRate}%\n🏅 Badges: ${(profile.badges||[]).length}\n\nhttps://scan2moon.com`;
  window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}`, "_blank");
};

/* ═══════════════════════════════════════════════════════
   SHAREABLE PROFILE CARD
═══════════════════════════════════════════════════════ */
async function buildProfileShareCard() {
  const wins    = profile.winCount  || 0;
  const losses  = profile.lossCount || 0;
  const total   = wins + losses;
  const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : "0";
  const pnl     = profile.totalPnL  || 0;
  const xp      = (total * 25) + ((profile.badges || []).length * 50) + ((profile.loginStreak || 0) * 5);
  const lvl     = calcLevel(xp);
  const short   = wallet ? wallet.slice(0, 6) + "…" + wallet.slice(-4) : "";
  const badges  = (profile.badges || []).length;
  const best    = (profile.trades || [])
    .filter(t => t.type === "sell" && (t.pnl || 0) > 0)
    .reduce((a, b) => (b.pnl > (a?.pnl || 0) ? b : a), null);

  /* Resolve card theme */
  const designId = localStorage.getItem("sa_card_design") || "card_classic";
  const th = CARD_THEMES[designId] || CARD_THEMES.card_classic;

  /* Resolve avatar for share card (video → capture canvas frame) */
  const savedAvId = localStorage.getItem("sa_avatar_id");
  const avBadge   = savedAvId ? BADGE_DEFS.find(x => x.id === savedAvId) : null;
  let avHtml;
  if (avBadge?.type === "video" && avBadge.video) {
    const frameDataUrl = await captureVideoFrame(avBadge.video);
    avHtml = frameDataUrl
      ? `<img src="${frameDataUrl}" style="width:96px;height:96px;object-fit:cover;border-radius:16px;">`
      : `<span style="font-size:72px;line-height:1;">${avBadge.icon}</span>`;
  } else if (avBadge?.img) {
    avHtml = `<img src="${avBadge.img}" style="width:96px;height:96px;object-fit:cover;border-radius:16px;">`;
  } else {
    avHtml = `<span style="font-size:72px;line-height:1;">${avBadge?.icon || "🦍"}</span>`;
  }

  /* Resolve frame styles for the card avatar.
     html2canvas v1.4.1 does NOT render box-shadow with spread radius (0 0 0 Xpx).
     Fix: use a real CSS border for the ring + blur-only box-shadow for the glow. */
  const savedFrameId = localStorage.getItem("sa_frame_id") || "frame_none";
  const frameDef     = FRAME_DEFS.find(f => f.id === savedFrameId) || FRAME_DEFS[0];
  const FRAME_STYLES = {
    "frame_moon_pulse":  { border: "3px solid #2cffc9", shadow: "0 0 18px rgba(44,255,201,0.9), 0 0 36px rgba(44,255,201,0.45)" },
    "frame_solar_flare": { border: "3px solid #ffd700", shadow: "0 0 18px rgba(255,210,50,0.9),  0 0 36px rgba(255,210,50,0.45)"  },
    "frame_degen_neon":  { border: "3px solid #ff6eb4", shadow: "0 0 18px rgba(255,110,180,0.9), 0 0 36px rgba(255,110,180,0.45)" },
    "frame_diamond":     { border: "3px solid #93c5fd", shadow: "0 0 18px rgba(147,197,253,0.9), 0 0 36px rgba(147,197,253,0.45)" },
  };
  const fs = FRAME_STYLES[frameDef.id];
  const frameStyle = fs
    ? `border:${fs.border};box-shadow:${fs.shadow};border-radius:18px;padding:4px;background:rgba(0,0,0,0.15);`
    : "";

  document.getElementById("profileShareCard")?.remove();

  const card = document.createElement("div");
  card.id = "profileShareCard";
  /* Apply theme via inline styles for html2canvas compatibility */
  card.style.cssText = `
    background: ${th.bg};
    border: 1.5px solid ${th.border};
    border-radius: 22px;
    padding: 28px 24px 22px;
    width: 380px;
    box-sizing: content-box;
    font-family: 'Inter', 'Segoe UI', sans-serif;
    color: #cffff4;
    position: fixed;
    top: -9999px; left: -9999px;
    overflow: visible;
    box-shadow: 0 0 60px rgba(0,0,0,0.8);
  `;
  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid ${th.hdrBorder};padding-bottom:12px;margin-bottom:18px;">
      <span style="font-size:14px;font-weight:900;letter-spacing:1.5px;color:${th.logo};">🌙 SCAN2MOON</span>
      <span style="font-size:10px;font-weight:700;letter-spacing:1px;color:${th.logo};opacity:.6;">${th.tag}</span>
    </div>
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:18px;">
      <div style="width:96px;height:96px;box-sizing:content-box;display:flex;align-items:center;justify-content:center;flex-shrink:0;${frameStyle}">
        ${avHtml}
      </div>
      <div>
        <div style="font-size:20px;font-weight:900;color:${th.name};letter-spacing:.3px;">${esc(localStorage.getItem("sa_display_name") || profile.accountName || "Ape Trader")}</div>
        <div style="font-size:12px;font-weight:700;color:${th.accent};margin-top:4px;">${rankLabel(pnl)}</div>
        <div style="font-size:11px;color:${th.level};margin-top:2px;">LVL ${lvl}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:14px;">
      <div style="text-align:center;">
        <div style="font-size:15px;font-weight:900;color:${pnl>=0?th.statHi:'#ff4d6d'}">${pnl>=0?'+':''}${formatSol(pnl)}</div>
        <div style="font-size:9px;opacity:.55;margin-top:3px;letter-spacing:.5px;">P/L</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:15px;font-weight:900;color:${parseFloat(winRate)>=50?th.statHi:'#ff4d6d'}">${winRate}%</div>
        <div style="font-size:9px;opacity:.55;margin-top:3px;letter-spacing:.5px;">WIN RATE</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:15px;font-weight:900;">${total}</div>
        <div style="font-size:9px;opacity:.55;margin-top:3px;letter-spacing:.5px;">TRADES</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:15px;font-weight:900;color:${th.accent}">${badges}</div>
        <div style="font-size:9px;opacity:.55;margin-top:3px;letter-spacing:.5px;">BADGES</div>
      </div>
    </div>
    ${best ? `<div style="font-size:11px;color:${th.statHi};opacity:.75;margin-bottom:10px;">🏆 Best: <strong>+${formatSol(best.pnl)}</strong> on ${esc(best.symbol || best.name || "")}</div>` : ""}
    <div style="font-size:10px;font-family:monospace;color:${th.wallet};margin-bottom:10px;">${short}</div>
    <div style="font-size:9px;color:${th.footer};border-top:1px solid ${th.hdrBorder};padding-top:10px;letter-spacing:.3px;">
      scan2moon.com · We don't shill. We show data. 🌙
    </div>`;

  document.body.appendChild(card);
  await new Promise(r => setTimeout(r, 220)); /* extra time for border+shadow paint */

  /* x/y in html2canvas are RELATIVE to the element — negative values expand the
     capture area outward so the frame glow (box-shadow blur) isn't clipped. */
  const GLOW = 52;
  const canvas = await html2canvas(card, {
    backgroundColor: null,
    scale: 2,
    useCORS: true,
    allowTaint: true,
    logging: false,
    x: -GLOW,
    y: -GLOW,
    width:  card.offsetWidth  + GLOW * 2,
    height: card.offsetHeight + GLOW * 2,
    scrollX: 0,
    scrollY: 0,
  });
  card.remove();
  return canvas;
}

window.shareProfileCard = async function() {
  const btn = document.getElementById("dashProfileShareBtn");
  if (btn) { btn.disabled = true; btn.textContent = "⏳ Saving…"; }
  try {
    const canvas = await buildProfileShareCard();
    /* Auto-download */
    const link = document.createElement("a");
    link.download = "Scan2Moon-Profile.png";
    link.href     = canvas.toDataURL("image/png");
    link.click();
    /* Open tweet */
    const pnl     = profile.totalPnL || 0;
    const wins    = profile.winCount  || 0;
    const losses  = profile.lossCount || 0;
    const total   = wins + losses;
    const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : "0";
    const xp      = (total * 25) + ((profile.badges || []).length * 50) + ((profile.loginStreak || 0) * 5);
    const lvl     = calcLevel(xp);
    const tweet   = `📊 My Scan2Moon Stats:\n\n${rankLabel(pnl)} · LVL ${lvl}\n💰 P/L: ${pnl>=0?'+':''}${formatSol(pnl)}\n🎯 Win Rate: ${winRate}%\n🏅 Badges: ${(profile.badges||[]).length}\n\nWe don't shill. We show data. 🌙\nhttps://scan2moon.com`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}`, "_blank");
    showToast("✅ Profile card saved — tweet is opening!");
  } catch (e) {
    console.error("Profile share error:", e);
    showToast("⚠️ Could not save — try again.");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "📸 Share Stats"; }
  }
};

/* ═══════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════ */
function formatSol(n) {
  if (n === null || n === undefined || isNaN(n)) return "0 SOL";
  const abs = Math.abs(n);
  if (abs === 0)   return "0 SOL";
  if (abs < 0.001) return n.toFixed(6) + " SOL";
  if (abs < 0.1)   return n.toFixed(4) + " SOL";
  if (abs < 10)    return n.toFixed(3) + " SOL";
  return n.toFixed(2) + " SOL";
}

function timeAgo(ts) {
  if (!ts) return "";
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)   return "just now";
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function showToast(msg) {
  let toast = document.getElementById("saToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "saToast";
    toast.style.cssText = `position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:rgba(6,32,26,0.97);border:1px solid rgba(44,255,201,0.4);border-radius:10px;padding:12px 24px;font-size:14px;font-weight:600;color:#cffff4;z-index:9999;box-shadow:0 0 30px rgba(44,255,201,0.2);transition:opacity 0.3s;white-space:nowrap;`;
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = "1";
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.opacity = "0"; }, 3500);
}
