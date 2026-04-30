// netlify/functions/save-academy-progress.js
// Saves academy lesson completion, XP, and optional badge to Netlify Blobs.
// Uses the same "simulator" store as safe-ape-sim.js and verify-social-task.js
//
// POST body: { wallet, lessonId, courseId, badgeId? }
// Idempotent: re-completing an already-done lesson does not double-count XP.
//
// Security:
//   - XP and SOL rewards are defined SERVER-SIDE in LESSON_REWARDS.
//     Client-supplied xpEarned / solReward values are ignored entirely.
//   - IP rate-limited: 20 completions per IP per minute.

const fs   = require("fs");
const path = require("path");
const { isRateLimitedRedis } = require("./db");

/* ── Server-side lesson reward table ─────────────────────────────────────────
   Client never controls these amounts. Add new lessons here as you ship them.
   xp  : academy XP awarded (0–2000)
   sol : simulator SOL balance credited (0 = no reward)
   ─────────────────────────────────────────────────────────────────────────── */
const LESSON_REWARDS = {
  // ── Course 1: Basics ──
  "lesson-1-intro":             { xp: 50,  sol: 0   },
  "lesson-2-risk":              { xp: 100, sol: 0.5 },
  "lesson-3-patterns":          { xp: 150, sol: 1.0 },
  "lesson-4-liquidity":         { xp: 100, sol: 0   },
  "lesson-5-tokenomics":        { xp: 150, sol: 1.0 },
  // ── Course 2: Advanced ──
  "lesson-6-smart-money":       { xp: 200, sol: 2.0 },
  "lesson-7-bundle-attacks":    { xp: 200, sol: 2.0 },
  "lesson-8-rugpull-signals":   { xp: 250, sol: 3.0 },
  "lesson-9-entry-radar":       { xp: 250, sol: 3.0 },
  "lesson-10-whale-dna":        { xp: 300, sol: 5.0 },
  // ── Guide completions ──
  "guide-risk-scanner":         { xp: 100, sol: 0.5 },
  "guide-safe-ape":             { xp: 100, sol: 0.5 },
  "guide-entry-radar":          { xp: 100, sol: 0.5 },
  "guide-whale-dna":            { xp: 150, sol: 1.0 },
};

/* ── Solana address validation ──────────────────────────────── */
function isValidSolana(addr) {
  return typeof addr === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
}

/* ── CORS helper ─────────────────────────────────────────────── */
const CORS = {
  "Access-Control-Allow-Origin":  process.env.ALLOWED_ORIGIN || "https://scan2moon.com",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function respond(code, body) {
  return {
    statusCode: code,
    headers: { ...CORS, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

/* ── Blobs store (mirrors simulator.js / verify-social-task.js) ── */
const LOCAL_DB_PATH = path.join("/tmp", "sim-local-store.json");

function _readDb() {
  try { return JSON.parse(fs.readFileSync(LOCAL_DB_PATH, "utf8")); }
  catch { return {}; }
}
function _writeDb(data) {
  try { fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify(data), "utf8"); }
  catch (e) { console.warn("_writeDb error:", e.message); }
}

async function getStore() {
  try {
    const { getStore } = require("@netlify/blobs");
    const store = getStore("simulator"); // shared store
    return {
      async get(key) {
        try { return await store.get(key, { consistency: "strong" }); }
        catch { return null; }
      },
      async set(key, val) { await store.set(key, val); },
    };
  } catch {
    // Local dev fallback
    return {
      async get(key) { return _readDb()[key] ?? null; },
      async set(key, val) { const db = _readDb(); db[key] = val; _writeDb(db); },
    };
  }
}

/* ── Main handler ────────────────────────────────────────────── */
exports.handler = async (event) => {
  /* Preflight */
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return respond(405, { error: "Method not allowed" });
  }

  /* IP rate limit: 20 lesson completions per IP per minute */
  const ip = (
    event.headers["x-nf-client-connection-ip"] ||
    event.headers["x-forwarded-for"] ||
    "unknown"
  ).split(",")[0].trim();

  if (await isRateLimitedRedis("academy:ip:" + ip, 20, 60)) {
    return respond(429, { error: "Too many requests. Slow down." });
  }

  /* Parse body */
  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return respond(400, { error: "Invalid JSON body" }); }

  /* NOTE: xpEarned and solReward from the client are intentionally ignored.
     All reward amounts come from the server-side LESSON_REWARDS table. */
  const { wallet, lessonId, courseId, badgeId } = body;

  /* Validate inputs */
  if (!isValidSolana(wallet)) {
    return respond(400, { error: "Invalid wallet address" });
  }
  if (!lessonId || typeof lessonId !== "string" || lessonId.length > 64) {
    return respond(400, { error: "lessonId required (max 64 chars)" });
  }

  /* Look up rewards server-side — unknown lessons get xp:0, sol:0 */
  const reward    = LESSON_REWARDS[lessonId] || { xp: 0, sol: 0 };
  const xpEarned  = reward.xp;
  const solReward = reward.sol;

  /* Load store */
  const store = await getStore();

  /* Load user profile */
  let profileRaw = await store.get(wallet);
  if (!profileRaw) {
    return respond(404, {
      error: "Profile not found. Connect wallet and load your dashboard first.",
    });
  }
  let profile;
  try {
    profile = typeof profileRaw === "string" ? JSON.parse(profileRaw) : profileRaw;
  } catch {
    return respond(500, { error: "Failed to parse profile." });
  }

  /* Initialise academy fields */
  if (!profile.academyProgress) profile.academyProgress = {};

  /* Idempotency — do not double-count XP if lesson already done */
  const alreadyDone = !!profile.academyProgress[lessonId];

  let solAwarded = 0;
  if (!alreadyDone) {
    profile.academyProgress[lessonId] = { completedAt: new Date().toISOString() };
    profile.academyXp = (profile.academyXp || 0) + xpEarned;

    /* Credit SOL reward to simulator balance */
    if (solReward > 0) {
      if (typeof profile.balance !== "number" || !isFinite(profile.balance)) profile.balance = 10;
      profile.balance = Math.min(profile.balance + solReward, 100000); // cap at 100k SOL
      solAwarded = solReward;
      /* Record as a synthetic trade so dashboard P/L reflects it */
      if (!Array.isArray(profile.trades)) profile.trades = [];
      profile.totalPnL = (profile.totalPnL || 0) + solReward;
      profile.trades.unshift({
        type:      "guide_reward",
        lessonId,
        pnl:       solReward,
        timestamp: new Date().toISOString(),
        note:      "Guide completion reward",
      });
      if (profile.trades.length > 50) profile.trades = profile.trades.slice(0, 50);
    }
  }

  /* Award badge if provided and not already in profile */
  let badgeAwarded = false;
  if (badgeId && !alreadyDone) {
    const safeBadge = String(badgeId).replace(/[^a-z0-9_]/g, "").slice(0, 64);
    if (safeBadge) {
      if (!Array.isArray(profile.badges)) profile.badges = [];
      if (!profile.badges.includes(safeBadge)) {
        profile.badges.push(safeBadge);
        badgeAwarded = true;
      }
    }
  }

  /* Save profile */
  try {
    await store.set(wallet, JSON.stringify(profile));
  } catch (e) {
    console.error("save-academy-progress: store.set failed:", e.message);
    return respond(503, { error: "Failed to save progress. Please retry." });
  }

  console.log(
    `save-academy-progress: wallet=${wallet.slice(0,8)} lesson=${lessonId}` +
    ` xp=+${alreadyDone ? 0 : xpEarned} sol=+${alreadyDone ? 0 : solAwarded}` +
    ` badge=${badgeId || "none"} alreadyDone=${alreadyDone}`
  );

  return respond(200, {
    success:     true,
    lessonId,
    courseId:    courseId || null,
    xpAwarded:   alreadyDone ? 0 : xpEarned,
    solAwarded:  alreadyDone ? 0 : solAwarded,
    badgeAwarded,
    alreadyDone,
    academyXp:   profile.academyXp || 0,
    balance:     profile.balance   || 0,
    badges:      profile.badges    || [],
  });
};
