const _DEBUG = false;

/* ═══════════════════════════════════════════════════════
   tasks.js — Missions & Tasks page
═══════════════════════════════════════════════════════ */
import { renderNav }         from "./nav.js";
import { applyTranslations } from "./i18n.js";

const SIM_API          = "/.netlify/functions/safe-ape-sim";
const VERIFY_SOCIAL_API = "/.netlify/functions/verify-social-task";

let wallet  = null;
let profile = null;

/* ── Helpers ── */
function esc(str) {
  return String(str ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
function isValidSolanaAddress(a) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
}
function showToast(msg) {
  let t = document.getElementById("s2mToast");
  if (!t) {
    t = document.createElement("div");
    t.id = "s2mToast";
    t.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#081a14;border:1px solid rgba(44,255,201,0.3);color:#2cffc9;padding:10px 20px;border-radius:20px;font-size:13px;font-weight:700;z-index:99999;pointer-events:none;transition:opacity 0.3s;white-space:nowrap;";
    document.body.appendChild(t);
  }
  t.textContent = msg; t.style.opacity = "1";
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.opacity = "0"; }, 3500);
}
/* ── Level formula — must match dashboard.js exactly ──
   xp(n) = round(100 * (n-1)^2.3), 100 levels
   LVL2=100  LVL5=2,425  LVL10=18,800  LVL50=771,600  LVL100=3,887,300 */
const XP_THRESHOLDS_T = Array.from({ length: 100 }, (_, i) =>
  i === 0 ? 0 : Math.round(100 * Math.pow(i, 2.3))
);
function calcLevel(xp) {
  if (!xp || xp <= 0) return 1;
  const approx = Math.max(1, Math.min(100, Math.floor(Math.pow(xp / 100, 1 / 2.3)) + 1));
  let lvl = approx;
  while (lvl < 100 && xp >= XP_THRESHOLDS_T[lvl]) lvl++;
  while (lvl > 1  && xp <  XP_THRESHOLDS_T[lvl - 1]) lvl--;
  return lvl;
}

/* ═══════════════════════════════════════════════════════
   ACCORDION TOGGLE
═══════════════════════════════════════════════════════ */
window.toggleTasksAcc = function(id) {
  const wrap = document.getElementById(`tasks-acc-${id}`);
  if (wrap) wrap.classList.toggle("open");
};

/* ═══════════════════════════════════════════════════════
   SOCIAL TASKS
═══════════════════════════════════════════════════════ */

const SOCIAL_TASK_DEFS = [
  {
    id:      "follow_x",
    icon:    "𝕏",
    title:   "Follow @Scan2Moon on X (Twitter)",
    desc:    "Follow our official X account and stay updated with the latest Scan2Moon news, alpha, and announcements.",
    url:     "https://x.com/Scan2Moon",
    urlLabel:"Open X / Twitter",
    placeholder: "Your X handle (e.g. @YourName)",
    xp:      50,
    sol:     0.5,
    timerSec: 20,
  },
  {
    id:      "follow_mental_degen",
    icon:    "𝕏",
    title:   "Follow @MentalDegen on X",
    desc:    "Follow Scan2Moon's founder for insider alpha, trading insights, and behind-the-scenes project updates.",
    url:     "https://x.com/MentalDegen",
    urlLabel:"Open X / Twitter",
    placeholder: "Your X handle (e.g. @YourName)",
    xp:      25,
    sol:     0.2,
    timerSec: 20,
  },
  {
    id:      "follow_ikaaaa93",
    icon:    "𝕏",
    title:   "Follow @ikaaaa93 on X",
    desc:    "Follow Scan2Moon's CEO & Community Manager for community news, giveaways, and important updates.",
    url:     "https://x.com/ikaaaa93",
    urlLabel:"Open X / Twitter",
    placeholder: "Your X handle (e.g. @YourName)",
    xp:      25,
    sol:     0.2,
    timerSec: 20,
  },
  {
    id:      "join_tg",
    icon:    "✈️",
    title:   "Join Scan2Moon Telegram",
    desc:    "Join our Telegram community to connect with other traders, get real-time signals and support.",
    url:     "https://t.me/scan2moon",
    urlLabel:"Open Telegram",
    placeholder: "Your Telegram username (e.g. @YourName)",
    xp:      50,
    sol:     0.5,
    timerSec: 20,
  },
];

/* State per task: 'idle' | 'timing' | 'verify' | 'loading' | 'claimed' */
const socialTaskState = {};

function isClaimed(taskId) {
  return profile && Array.isArray(profile.socialTasksClaimed) &&
         profile.socialTasksClaimed.includes(taskId);
}

/* ── Check if all social tasks are done → close + move to bottom ── */
function checkSocialCompletion() {
  const allDone = SOCIAL_TASK_DEFS.every(t => isClaimed(t.id));
  if (!allDone) return;

  /* Close both panels */
  const socialWrap    = document.getElementById("tasks-acc-social");
  const sponsoredWrap = document.getElementById("tasks-acc-sponsored");
  if (socialWrap)    socialWrap.classList.remove("open");
  if (sponsoredWrap) sponsoredWrap.classList.remove("open");

  /* Move social + sponsored container divs to the bottom of tasksApp */
  const app            = document.getElementById("tasksApp");
  const socialPanel    = document.getElementById("tasksSocialPanel");
  const sponsoredPanel = document.getElementById("tasksSponsoredPanel");
  if (app && socialPanel)    app.appendChild(socialPanel);
  if (app && sponsoredPanel) app.appendChild(sponsoredPanel);

  /* Open Missions + Streak so the page isn't all-closed */
  const missionsWrap = document.getElementById("tasks-acc-missions");
  const streakWrap   = document.getElementById("tasks-acc-streak");
  if (missionsWrap) missionsWrap.classList.add("open");
  if (streakWrap)   streakWrap.classList.add("open");
}

function renderSocialTasks() {
  const el = document.getElementById("tasksSocialList");
  if (!el) return;

  el.innerHTML = SOCIAL_TASK_DEFS.map(task => {
    const claimed = isClaimed(task.id);
    return `
      <div class="social-task-card ${claimed ? 'task-claimed' : ''}" id="stc-${task.id}">
        <div class="stc-top">
          <div class="stc-icon">${task.icon}</div>
          <div class="stc-info">
            <div class="stc-title">${esc(task.title)}</div>
            <div class="stc-desc">${esc(task.desc)}</div>
          </div>
          <div class="stc-rewards">
            <div class="stc-reward-xp">+${task.xp} XP</div>
            <div class="stc-reward-sol">+${task.sol} SOL</div>
          </div>
        </div>
        <div class="stc-verify-area" id="stc-va-${task.id}">
          ${claimed ? renderClaimedRow(task) : renderStartBtn(task)}
        </div>
      </div>`;
  }).join("");
}

function renderStartBtn(task) {
  return `<button class="stc-btn stc-btn-start" onclick="window.startSocialTask('${task.id}')">
    ${task.urlLabel} → Start Verification
  </button>`;
}

function renderTimerPhase(task, secsLeft) {
  const pct = Math.round(((task.timerSec - secsLeft) / task.timerSec) * 100);
  return `
    <div class="stc-timer-wrap">
      <div class="stc-timer-bar-bg">
        <div class="stc-timer-bar-fill" id="stc-bar-${task.id}" style="width:${pct}%"></div>
      </div>
      <div class="stc-timer-label" id="stc-lbl-${task.id}">${secsLeft}s</div>
    </div>
    <div style="font-size:11px;color:rgba(207,255,244,0.4);font-weight:600;text-align:center;padding:2px 0;">
      ⏳ Please complete the action in the opened tab…
    </div>`;
}

function renderVerifyPhase(task) {
  return `
    <div class="stc-handle-row">
      <input class="stc-handle-input" id="stc-inp-${task.id}"
             type="text" placeholder="${esc(task.placeholder)}" maxlength="50" autocomplete="off" />
      <button class="stc-btn stc-btn-verify" onclick="window.verifySocialTask('${task.id}')">
        ✅ Verify
      </button>
    </div>
    <div style="font-size:10px;color:rgba(207,255,244,0.35);font-weight:600;text-align:center;padding-top:2px;">
      Enter your handle so we can confirm and send your SOL reward
    </div>`;
}

function renderClaimedRow(task) {
  return `
    <div class="stc-claimed-row">
      <div class="stc-claimed-check">✅</div>
      <div class="stc-claimed-info">
        <div class="stc-claimed-title">Completed!</div>
        <div class="stc-claimed-sub">+${task.xp} XP awarded · SOL reward pending (sent within 24h)</div>
      </div>
      <div class="stc-claimed-sol">+${task.sol} SOL</div>
    </div>`;
}

function renderLoadingPhase() {
  return `<div class="stc-status pending">⏳ Verifying your task…</div>`;
}

function setVerifyArea(taskId, html) {
  const el = document.getElementById(`stc-va-${taskId}`);
  if (el) el.innerHTML = html;
}

/* ── Start: open external link + run countdown ── */
window.startSocialTask = function(taskId) {
  if (!wallet) { showToast("⚠️ Connect your wallet first"); return; }

  const task = SOCIAL_TASK_DEFS.find(t => t.id === taskId);
  if (!task || isClaimed(taskId)) return;

  /* Open the social platform in new tab */
  window.open(task.url, "_blank", "noopener,noreferrer");

  socialTaskState[taskId] = "timing";
  let secsLeft = task.timerSec;

  setVerifyArea(taskId, renderTimerPhase(task, secsLeft));

  const interval = setInterval(() => {
    secsLeft--;
    const bar = document.getElementById(`stc-bar-${taskId}`);
    const lbl = document.getElementById(`stc-lbl-${taskId}`);
    if (bar) bar.style.width = Math.round(((task.timerSec - secsLeft) / task.timerSec) * 100) + "%";
    if (lbl) lbl.textContent = secsLeft + "s";

    if (secsLeft <= 0) {
      clearInterval(interval);
      socialTaskState[taskId] = "verify";
      setVerifyArea(taskId, renderVerifyPhase(task));
    }
  }, 1000);
};

/* ── Verify: call Netlify function ── */
window.verifySocialTask = async function(taskId) {
  if (!wallet) { showToast("⚠️ Connect wallet first"); return; }

  const task = SOCIAL_TASK_DEFS.find(t => t.id === taskId);
  if (!task) return;

  const inp    = document.getElementById(`stc-inp-${taskId}`);
  const handle = inp ? inp.value.trim() : "";

  if (!handle) {
    /* Shake the input */
    if (inp) {
      inp.style.borderColor = "rgba(255,100,80,0.6)";
      inp.style.animation   = "none";
      setTimeout(() => { inp.style.borderColor = ""; }, 1500);
    }
    showToast("⚠️ Please enter your username first");
    return;
  }

  socialTaskState[taskId] = "loading";
  setVerifyArea(taskId, renderLoadingPhase());

  try {
    const resp = await fetch(VERIFY_SOCIAL_API, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ wallet, taskId, handle }),
    });
    const data = await resp.json();

    if (data.success || data.alreadyClaimed) {
      /* Update local profile so UI reflects claimed state without reload */
      if (!profile.socialTasksClaimed) profile.socialTasksClaimed = [];
      if (!profile.socialTasksClaimed.includes(taskId)) {
        profile.socialTasksClaimed.push(taskId);
        profile.socialXp = (profile.socialXp || 0) + task.xp;
      }

      /* Mark card as claimed */
      const card = document.getElementById(`stc-${taskId}`);
      if (card) card.classList.add("task-claimed");

      setVerifyArea(taskId, renderClaimedRow(task));
      showToast(`🎉 +${task.xp} XP! ${task.sol} SOL coming within 24h`);

      /* Refresh overview + check if all social tasks are now done */
      renderOverview();
      checkSocialCompletion();
    } else {
      const msg = data.error || "Verification failed. Please try again.";
      setVerifyArea(taskId, `
        <div class="stc-status error">❌ ${esc(msg)}</div>
        <button class="stc-btn stc-btn-start" style="margin-top:4px;"
          onclick="window.startSocialTask('${taskId}')">↩ Try Again</button>`);
    }
  } catch (e) {
    _DEBUG && console.error("verifySocialTask error:", e);
    setVerifyArea(taskId, `
      <div class="stc-status error">❌ Network error. Please check connection and retry.</div>
      <button class="stc-btn stc-btn-start" style="margin-top:4px;"
        onclick="window.startSocialTask('${taskId}')">↩ Try Again</button>`);
  }
};

/* ── Render the social tasks accordion panel ── */
function renderSocialTasksPanel() {
  const el = document.getElementById("tasksSocialPanel");
  if (!el) return;

  const claimedCount = SOCIAL_TASK_DEFS.filter(t => isClaimed(t.id)).length;
  const totalSol     = SOCIAL_TASK_DEFS.reduce((s, t) => s + t.sol, 0);
  const totalXp      = SOCIAL_TASK_DEFS.reduce((s, t) => s + t.xp, 0);

  el.innerHTML = `
    <div class="tasks-acc-wrap" id="tasks-acc-social">
      <div class="tasks-acc-header" onclick="window.toggleTasksAcc('social')">
        <div class="tasks-acc-color-bar" style="background:#2cffc9;"></div>
        <div class="tasks-acc-icon">🌐</div>
        <div class="tasks-acc-title-group">
          <div class="tasks-acc-title">S2M Social Tasks</div>
          <div class="tasks-acc-subtitle">Follow · Join · Earn SOL + XP</div>
        </div>
        <div class="tasks-acc-pill">${claimedCount} / ${SOCIAL_TASK_DEFS.length} done</div>
        <div class="tasks-acc-pill gold">+${totalSol} SOL available</div>
        <div class="tasks-acc-chip new">NEW</div>
        <div class="tasks-acc-chevron">▼</div>
      </div>
      <div class="tasks-acc-body">
        ${!wallet
          ? `<div class="tasks-acc-gate"><strong>Wallet not connected</strong>Connect your Phantom wallet to start earning.</div>`
          : `<div class="social-tasks-list" id="tasksSocialList"></div>`
        }
      </div>
    </div>`;

  if (wallet) {
    renderSocialTasks();
    checkSocialCompletion();
  }
}

/* ═══════════════════════════════════════════════════════
   SPONSORED TASKS
═══════════════════════════════════════════════════════ */

/* Sponsor task definitions — add more here as partnerships grow */
const SPONSORED_TASK_DEFS = [
  /* EXAMPLE LIVE SPONSOR SLOT — replace with real partners */
  /*
  {
    id:        "sponsor_example",
    logo:      "🦍",
    name:      "ExampleProtocol",
    task:      "Follow @ExampleProtocol and join their Discord",
    url:       "https://discord.gg/example",
    xp:        30,
    sol:       0.2,
    sponsorReward: "0.1 SOL from Sponsor",
    live:      true,
  },
  */
];

function renderSponsoredTasksPanel() {
  const el = document.getElementById("tasksSponsoredPanel");
  if (!el) return;

  const liveCount = SPONSORED_TASK_DEFS.filter(t => t.live).length;

  const taskCardsHtml = liveCount > 0
    ? SPONSORED_TASK_DEFS.filter(t => t.live).map(t => `
        <div class="sponsored-task-card live">
          <div class="stc-sponsor-logo">${t.logo}</div>
          <div class="stc-sponsor-info">
            <div class="stc-sponsor-name">${esc(t.name)}</div>
            <div class="stc-sponsor-task">${esc(t.task)}</div>
            <div class="stc-sponsor-tags">
              <span class="stc-sponsor-tag xp">+${t.xp} XP</span>
              <span class="stc-sponsor-tag sol">+${t.sol} SOL</span>
              ${t.sponsorReward ? `<span class="stc-sponsor-tag sponsor">+${esc(t.sponsorReward)}</span>` : ''}
            </div>
          </div>
          <button class="stc-sponsor-btn" onclick="window.open('${esc(t.url)}','_blank','noopener')">
            Go →
          </button>
        </div>`).join("")
    : `
        <div class="sponsored-task-card" style="opacity:0.6;pointer-events:none;">
          <div class="stc-sponsor-logo" style="filter:blur(2px)">🌐</div>
          <div class="stc-sponsor-info">
            <div class="stc-sponsor-name" style="filter:blur(4px)">Partner Protocol</div>
            <div class="stc-sponsor-task" style="filter:blur(3px)">Follow on X · Join Discord</div>
            <div class="stc-sponsor-tags">
              <span class="stc-sponsor-tag xp">+30 XP</span>
              <span class="stc-sponsor-tag sol">+0.2 SOL</span>
              <span class="stc-sponsor-tag sponsor">+Sponsor Reward</span>
            </div>
          </div>
          <button class="stc-sponsor-btn" style="pointer-events:none;opacity:0.5">Go →</button>
        </div>`;

  el.innerHTML = `
    <div class="tasks-acc-wrap" id="tasks-acc-sponsored">
      <div class="tasks-acc-header" onclick="window.toggleTasksAcc('sponsored')">
        <div class="tasks-acc-color-bar" style="background:#ffb432;"></div>
        <div class="tasks-acc-icon">🤝</div>
        <div class="tasks-acc-title-group">
          <div class="tasks-acc-title">Sponsored Tasks</div>
          <div class="tasks-acc-subtitle">Partner challenges · Extra SOL + community rewards</div>
        </div>
        ${liveCount > 0
          ? `<div class="tasks-acc-pill gold">${liveCount} Live</div>`
          : `<div class="tasks-acc-chip soon">COMING SOON</div>`}
        <div class="tasks-acc-chevron">▼</div>
      </div>
      <div class="tasks-acc-body">
        <div class="sponsored-tasks-list">
          ${taskCardsHtml}
        </div>
        <div class="sponsored-cta">
          <div class="sponsored-cta-icon">💼</div>
          <div class="sponsored-cta-info">
            <p class="sponsored-cta-title">Want to sponsor a task?</p>
            <p class="sponsored-cta-sub">Reach thousands of Solana traders — list your project and reward our community.</p>
          </div>
          <a href="https://x.com/Scan2Moon" target="_blank" rel="noopener" class="sponsored-cta-link">
            Contact Us →
          </a>
        </div>
      </div>
    </div>`;
}

/* ═══════════════════════════════════════════════════════
   MISSION DEFINITIONS
═══════════════════════════════════════════════════════ */
function getMissions() {
  const trades = profile.trades  || [];
  const badges = profile.badges  || [];
  const streak = profile.loginStreak || 0;
  const wins   = profile.winCount    || 0;
  const losses = profile.lossCount   || 0;
  const total  = wins + losses;
  const socialXp  = profile.socialXp  || 0;
  const academyXp = profile.academyXp || 0;
  // XP formula — must match dashboard.js renderStatsRow() exactly:
  // trades×25 + streak×10 + badgeXp (server-assigned) + socialXp + academyXp
  // Note: missionXp excluded here to avoid circular dependency (missions depend on level)
  const xp = ((wins + losses) * 25)
           + (streak * 10)
           + (profile.badgeXp || 0)
           + socialXp
           + academyXp;
  const lvl    = calcLevel(xp);
  const sells  = trades.filter(t => t.type === "sell").length;

  return [
    {
      icon:"🔗", title:"Welcome to Scan2Moon",
      desc:"Connect your Phantom wallet and open the dashboard",
      target:1, current:1, xp:10,
    },
    {
      icon:"🔍", title:"First Token Scan",
      desc:"Scan any Solana token using the Risk Scanner",
      target:1, current:sells>0||badges.length>0?1:0, xp:15,
    },
    {
      icon:"💰", title:"5 Trades Closed",
      desc:"Complete 5 sell trades in the Ape Simulator",
      target:5, current:Math.min(sells,5), xp:20,
    },
    {
      icon:"🏅", title:"Collect 3 Badges",
      desc:"Unlock 3 achievement badges on your journey",
      target:3, current:Math.min(badges.length,3), xp:30,
    },
    {
      icon:"🔥", title:"7-Day Login Streak",
      desc:"Log in 7 days in a row to prove your dedication",
      target:7, current:Math.min(streak,7), xp:25,
    },
    {
      icon:"📈", title:"Win Rate Above 50%",
      desc:"Close more profitable trades than losing ones",
      target:1, current:total>0&&wins/total>=0.5?1:0, xp:40,
    },
    {
      icon:"🚀", title:"Reach Account Level 5",
      desc:"Earn enough XP across all activities to hit Level 5",
      target:5, current:Math.min(lvl,5), xp:50,
    },
    {
      icon:"🎓", title:"Complete Academy Course",
      desc:"Finish your first S2M Academy lesson",
      target:1, current:0, xp:60, locked:true,
    },
  ];
}

/* ═══════════════════════════════════════════════════════
   OVERVIEW BANNER
═══════════════════════════════════════════════════════ */
function renderOverview() {
  const el = document.getElementById("tasksOverview");
  if (!el) return;
  const missions    = getMissions();
  const done        = missions.filter(m => m.current >= m.target).length;
  const total       = missions.length;
  const pct         = Math.round((done / total) * 100);
  const totalXp     = missions.filter(m => m.current >= m.target).reduce((s,m) => s + m.xp, 0);
  const maxXp       = missions.reduce((s,m) => s + m.xp, 0);
  /* Social tasks bonus XP */
  const socialBonus = (profile.socialXp || 0);
  const claimedSoc  = SOCIAL_TASK_DEFS.filter(t => isClaimed(t.id)).length;

  el.innerHTML = `
    <div class="tasks-overview-card">
      <div class="tasks-ov-stat">
        <div class="tasks-ov-val">${done}<span>/${total}</span></div>
        <div class="tasks-ov-label">MISSIONS DONE</div>
      </div>
      <div class="tasks-ov-divider"></div>
      <div class="tasks-ov-stat">
        <div class="tasks-ov-val">${pct}<span>%</span></div>
        <div class="tasks-ov-label">COMPLETE</div>
      </div>
      <div class="tasks-ov-divider"></div>
      <div class="tasks-ov-stat">
        <div class="tasks-ov-val">${totalXp + socialBonus}<span> XP</span></div>
        <div class="tasks-ov-label">XP EARNED</div>
      </div>
      <div class="tasks-ov-divider"></div>
      <div class="tasks-ov-stat">
        <div class="tasks-ov-val">${claimedSoc}<span>/${SOCIAL_TASK_DEFS.length}</span></div>
        <div class="tasks-ov-label">SOCIAL DONE</div>
      </div>
    </div>
    <div class="tasks-ov-bar-wrap">
      <div class="tasks-ov-bar-fill" style="width:${pct}%"></div>
    </div>`;
}

/* ═══════════════════════════════════════════════════════
   MISSIONS LIST
═══════════════════════════════════════════════════════ */
function renderMissions() {
  const el = document.getElementById("tasksMissions");
  if (!el) return;
  const missions = getMissions();

  el.innerHTML = `
    <div class="mission-list">
      ${missions.map(m => {
        const isDone   = m.current >= m.target;
        const isLocked = m.locked && !isDone;
        const pct      = Math.min(Math.round((m.current / m.target) * 100), 100);
        return `
          <div class="mission-item ${isDone?'mission-done':''} ${isLocked?'mission-locked':''}">
            <div class="mission-icon">${isLocked ? '🔒' : m.icon}</div>
            <div class="mission-body">
              <div class="mission-title">
                ${m.title}
                ${isLocked ? '<span class="mission-locked-lbl">Academy</span>' : ''}
              </div>
              <div class="mission-desc-full">${m.desc}</div>
              ${!isDone && !isLocked ? `
                <div class="mission-bar-wrap">
                  <div class="mission-bar-fill" style="width:${pct}%"></div>
                </div>
                <div class="mission-prog-txt">${m.current} / ${m.target}</div>` : ''}
              ${isDone   ? '<div class="mission-done-txt">Completed ✓</div>'         : ''}
              ${isLocked ? '<div class="mission-done-txt">Unlocks with Academy</div>' : ''}
            </div>
            <div class="mission-xp-badge ${isDone?'mission-xp-earned':isLocked?'mission-xp-locked':''}">
              <span>+${m.xp}</span>
              <span class="mission-xp-unit">XP</span>
            </div>
          </div>`;
      }).join("")}
    </div>`;
}

/* ═══════════════════════════════════════════════════════
   LOGIN STREAK CALENDAR
═══════════════════════════════════════════════════════ */
function renderStreak() {
  const el = document.getElementById("tasksStreak");
  if (!el) return;
  const streak = profile.loginStreak || 0;
  const DAYS   = 14;

  const tiles = Array.from({ length: DAYS }, (_, i) => {
    const daysAgo = DAYS - 1 - i;
    const active  = daysAgo < streak;
    const today   = daysAgo === 0;
    const label   = today ? "Today" : daysAgo === 1 ? "Yest." : `${daysAgo}d`;
    return `<div class="streak-tile ${active?'streak-active':''} ${today?'streak-today':''}">
      <div class="streak-dot">${active ? '🔥' : '○'}</div>
      <div class="streak-day">${label}</div>
    </div>`;
  }).join("");

  const nextMilestone = streak < 7 ? 7 : streak < 14 ? 14 : streak < 30 ? 30 : streak + 7;
  const toNext        = nextMilestone - streak;

  el.innerHTML = `
    <div class="streak-header">
      <div class="streak-big">${streak} <span>day${streak !== 1 ? 's' : ''}</span></div>
      <div class="streak-sub">
        ${streak >= 7
          ? `🎉 ${streak}-day streak — keep going!`
          : `${toNext} more day${toNext !== 1?'s':''} to reach the 7-day milestone`}
      </div>
    </div>
    <div class="streak-calendar">${tiles}</div>
    <div class="streak-milestones">
      ${[7,14,30].map(n => {
        const reached = streak >= n;
        return `<div class="streak-milestone ${reached?'reached':''}">
          <span>${reached?'✅':'🔒'}</span>
          <div><strong>${n}-Day Streak</strong><span>+${n*5} XP bonus</span></div>
        </div>`;
      }).join("")}
    </div>`;
}

/* ═══════════════════════════════════════════════════════
   WALLET + DATA LOADING
═══════════════════════════════════════════════════════ */
async function connectWallet() {
  const btn = document.getElementById("tasksConnectBtn");
  try {
    const provider = window.phantom?.solana || window.solana;
    if (!provider?.isPhantom) {
      showToast("⚠️ Phantom wallet not found. Install from phantom.app");
      return;
    }
    if (btn) btn.textContent = "⏳ Connecting…";
    const resp = await provider.connect();
    wallet = resp.publicKey.toString();
    localStorage.setItem("sa_wallet", wallet);
    loadTasks();
  } catch (e) {
    showToast("❌ Connection cancelled.");
    if (btn) btn.textContent = "🔗 Connect Phantom Wallet";
  }
}

async function loadTasks() {
  showToast("⏳ Loading your missions…");

  let data;
  for (let attempt = 0; attempt <= 3; attempt++) {
    try {
      const resp = await fetch(`${SIM_API}?wallet=${wallet}`);
      if (resp.status === 503) {
        if (attempt < 3) { await new Promise(r => setTimeout(r, (attempt+1)*2000)); continue; }
        throw new Error("503");
      }
      data = await resp.json();
      if (data.error) throw new Error(data.error);
      break;
    } catch (e) {
      if (attempt === 3) {
        profile = {
          winCount:0, lossCount:0, loginStreak:0, badges:[], trades:[],
          socialTasksClaimed:[], socialXp:0, accountName:"Demo Mode"
        };
        showTasks(true);
        return;
      }
    }
  }

  profile = data;
  showTasks(false);
}

function showTasks(isDemo) {
  document.getElementById("tasksGate").style.display = "none";
  document.getElementById("tasksApp").style.display  = "block";
  if (isDemo) showToast("👀 Demo mode — connect wallet to see your real progress");
  renderSocialTasksPanel();
  renderSponsoredTasksPanel();
  renderOverview();
  renderMissions();
  renderStreak();
}

/* ═══════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", () => {
  renderNav();
  applyTranslations();

  /* Render sponsored panel immediately (no wallet needed for structure) */
  profile = { socialTasksClaimed: [], socialXp: 0 };
  renderSponsoredTasksPanel();

  const saved = localStorage.getItem("sa_wallet");
  if (saved && isValidSolanaAddress(saved)) {
    wallet = saved;
    loadTasks();
  } else {
    /* Render social gate without wallet */
    renderSocialTasksPanel();
  }

  document.getElementById("tasksConnectBtn")?.addEventListener("click", connectWallet);
});
