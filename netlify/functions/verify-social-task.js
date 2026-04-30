// netlify/functions/verify-social-task.js
// Verifies social task completion and records one-claim-per-wallet.
// Uses the same Netlify Blobs store as simulator.js ("simulator" store)
// so the user profile is updated in place.
//
// POST  body: { wallet, taskId, handle? }
// taskId values: "follow_x" | "join_tg" | (future sponsor IDs)
//
// Security model:
//  • Wallet address validated server-side (base58, 32-44 chars)
//  • One claim per wallet per taskId — stored permanently in Blobs
//  • XP awarded immediately to user profile in Blobs
//  • SOL reward set to "pending" (paid manually / batch process)
//  • No private key needed on server — SOL payout is async/manual

const fs   = require("fs");
const path = require("path");
const { isRateLimitedRedis } = require("./db");

/* ── Solana address validation ──────────────────────────────── */
function isValidSolana(addr) {
  return typeof addr === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
}

/* ── Known tasks catalogue ──────────────────────────────────── */
const SOCIAL_TASKS = {
  follow_x: {
    label:     "Follow @Scan2Moon on X",
    xpReward:  50,
    solReward: 0.5,
    type:      "social",
  },
  follow_mental_degen: {
    label:     "Follow @MentalDegen on X",
    xpReward:  25,
    solReward: 0.2,
    type:      "social",
  },
  follow_ikaaaa93: {
    label:     "Follow @ikaaaa93 on X",
    xpReward:  25,
    solReward: 0.2,
    type:      "social",
  },
  join_tg: {
    label:     "Join Scan2Moon Telegram",
    xpReward:  50,
    solReward: 0.5,
    type:      "social",
  },
};

/* ── CORS helper ─────────────────────────────────────────────── */
const CORS = {
  "Access-Control-Allow-Origin":  process.env.ALLOWED_ORIGIN || "https://scan2moon.com",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function respond(code, body) {
  return { statusCode: code, headers: { ...CORS, "Content-Type": "application/json" },
           body: JSON.stringify(body) };
}

/* ── Blobs store (mirrors simulator.js pattern) ─────────────── */
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
  const isProduction = !!process.env.NETLIFY_BLOBS_CONTEXT && !process.env.NETLIFY_DEV;
  try {
    const { getStore } = require("@netlify/blobs");
    const store = getStore("simulator"); // shared store with simulator
    return {
      async get(key) {
        try {
          const v = await store.get(key, { consistency: "strong" });
          return v;
        } catch { return null; }
      },
      async set(key, val) {
        await store.set(key, val);
      },
    };
  } catch {
    // Local dev fallback
    return {
      async get(key) {
        return _readDb()[key] ?? null;
      },
      async set(key, val) {
        const db = _readDb();
        db[key] = val;
        _writeDb(db);
      },
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

  /* IP rate limit: max 10 task-verify calls per IP per minute */
  const ip = (
    event.headers["x-nf-client-connection-ip"] ||
    event.headers["x-forwarded-for"] ||
    "unknown"
  ).split(",")[0].trim();

  if (await isRateLimitedRedis("verifysocial:ip:" + ip, 10, 60)) {
    return respond(429, { error: "Too many requests. Please slow down and try again in a minute." });
  }

  /* Parse body */
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return respond(400, { error: "Invalid JSON body" });
  }

  const { wallet, taskId, handle } = body;

  /* Validate wallet */
  if (!isValidSolana(wallet)) {
    return respond(400, { error: "Invalid wallet address" });
  }

  /* Validate taskId */
  const task = SOCIAL_TASKS[taskId];
  if (!task) {
    return respond(400, { error: `Unknown taskId: ${taskId}` });
  }

  /* Sanitise handle (optional, stored for payout reference) */
  const safeHandle = handle
    ? String(handle).replace(/[^a-zA-Z0-9_@\.]/g, "").slice(0, 50)
    : "";

  /* Load store */
  const store = await getStore();

  /* Load user profile */
  let profileRaw = await store.get(wallet);
  let profile;
  if (!profileRaw) {
    return respond(404, { error: "Profile not found. Connect wallet and load your dashboard first." });
  }
  try {
    profile = typeof profileRaw === "string" ? JSON.parse(profileRaw) : profileRaw;
  } catch {
    return respond(500, { error: "Failed to parse profile." });
  }

  /* Check if already claimed */
  const claimed = Array.isArray(profile.socialTasksClaimed) ? profile.socialTasksClaimed : [];
  if (claimed.includes(taskId)) {
    return respond(200, {
      alreadyClaimed: true,
      message: `You already completed "${task.label}". Reward pending.`,
    });
  }

  /* Record claim ────────────────────────────────────────────── */
  claimed.push(taskId);
  profile.socialTasksClaimed = claimed;

  /* Credit XP — stored alongside trade-based XP */
  profile.socialXp = (profile.socialXp || 0) + task.xpReward;

  /* Record pending SOL payout for manual/batch processing */
  if (!Array.isArray(profile.pendingSolPayouts)) profile.pendingSolPayouts = [];
  profile.pendingSolPayouts.push({
    taskId,
    taskLabel: task.label,
    handle: safeHandle,
    sol: task.solReward,
    claimedAt: new Date().toISOString(),
    paid: false,
  });

  /* Save profile */
  try {
    await store.set(wallet, JSON.stringify(profile));
  } catch (e) {
    console.error("verify-social-task: store.set failed:", e.message);
    return respond(503, { error: "Failed to save profile. Please retry." });
  }

  console.log(`verify-social-task: wallet=${wallet.slice(0,8)} task=${taskId} handle=${safeHandle} xp=+${task.xpReward}`);

  return respond(200, {
    success:    true,
    taskId,
    taskLabel:  task.label,
    xpAwarded:  task.xpReward,
    solPending: task.solReward,
    message:    `✅ Task verified! +${task.xpReward} XP awarded. ${task.solReward} SOL reward is pending manual review and will be processed in batches.`,
  });
};
