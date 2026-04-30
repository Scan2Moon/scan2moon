/* guide-risk-scanner-app.js
   Scroll progress + quiz + XP/SOL rewards + save image
   Rewards: 100 XP + 1 SOL on first pass. +100 XP bonus if perfect on first submit.
   Rewards only awarded ONCE per account lifecycle — reset clears academyProgress. */

/* ════════════════════════════════════════════════════
   SCROLL PROGRESS BAR
   ════════════════════════════════════════════════════ */
const CHAPTERS      = 5;
const progressFill  = document.getElementById("guideProgressFill");
const progressLabel = document.getElementById("guideProgressLabel");

function getChapterWord() {
  return (localStorage.getItem("s2m_lang") || "en") === "nl" ? "Hoofdstuk" : "Chapter";
}

window.__s2mUpdateProgressLabel = function () {
  const chapters = document.querySelectorAll(".guide-chapter");
  let current = 1;
  chapters.forEach(ch => {
    if (ch.getBoundingClientRect().top < window.innerHeight * 0.55)
      current = parseInt(ch.dataset.chapter);
  });
  progressLabel.textContent = getChapterWord() + " " + current + " / " + CHAPTERS;
};

function updateProgress() {
  const chapters = document.querySelectorAll(".guide-chapter");
  let current = 1;
  chapters.forEach(ch => {
    if (ch.getBoundingClientRect().top < window.innerHeight * 0.55)
      current = parseInt(ch.dataset.chapter);
  });
  const pct = Math.round((current / CHAPTERS) * 100);
  if (progressFill) progressFill.style.width = pct + "%";
  if (progressLabel) progressLabel.textContent = getChapterWord() + " " + current + " / " + CHAPTERS;
}

function revealOnScroll() {
  document.querySelectorAll(".guide-chapter").forEach(el => {
    if (el.getBoundingClientRect().top < window.innerHeight * 0.88)
      el.classList.add("visible");
  });
}

document.addEventListener("scroll",     () => { updateProgress(); revealOnScroll(); }, { passive: true });
document.addEventListener("DOMContentLoaded", () => { updateProgress(); revealOnScroll(); });

/* ════════════════════════════════════════════════════
   LIVE EXAMPLE
   ════════════════════════════════════════════════════ */
function launchLiveExample() {
  try { localStorage.setItem("s2m_prefill_mint", "BBKPiLM9KjdJW7oQSKt99RVWcZdhF6sEHRKnwqeBGHST"); } catch {}
  window.location.href = "risk-scanner.html";
}
window.launchLiveExample = launchLiveExample;

/* ════════════════════════════════════════════════════
   TRANSLATION HELPER
   ════════════════════════════════════════════════════ */
function getT(key) {
  return typeof window.__s2m_t === "function" ? window.__s2m_t(key) : key;
}

/* ════════════════════════════════════════════════════
   QUIZ STATE
   ════════════════════════════════════════════════════ */
const CORRECT = { 1: "B", 2: "B", 3: "B", 4: "B", 5: "B" };

const EXPL_KEYS = {
  1: { A: "gr_q1_ea", B: "gr_q1_eb", C: "gr_q1_ec" },
  2: { A: "gr_q2_ea", B: "gr_q2_eb", C: "gr_q2_ec" },
  3: { A: "gr_q3_ea", B: "gr_q3_eb", C: "gr_q3_ec" },
  4: { A: "gr_q4_ea", B: "gr_q4_eb", C: "gr_q4_ec" },
  5: { A: "gr_q5_ea", B: "gr_q5_eb", C: "gr_q5_ec" }
};

const userAnswers        = {};
const shownExplanations  = {};
let   quizSubmitted      = false;
let   hasRetried         = false;   // true after first retry — kills perfect-score bonus

/* ════════════════════════════════════════════════════
   REWARD CONSTANTS
   ════════════════════════════════════════════════════ */
const BASE_XP       = 100;
const BONUS_XP      = 100;   // first-try perfect score
const SOL_REWARD    = 1;
const LESSON_ID     = "risk_scanner_guide_v1";
const BONUS_LESSON  = "risk_scanner_guide_v1_perfect";
const BADGE_ID      = "scanner_pro";

/* ════════════════════════════════════════════════════
   WALLET HELPERS
   ════════════════════════════════════════════════════ */
function getConnectedWallet() {
  // Dashboard / all pages store connected wallet under "sa_wallet"
  try {
    return (
      localStorage.getItem("sa_wallet") ||
      localStorage.getItem("s2m_wallet") ||
      localStorage.getItem("walletPublicKey") ||
      sessionStorage.getItem("s2m_wallet") ||
      null
    );
  } catch { return null; }
}

/* ════════════════════════════════════════════════════
   REWARD API CALLS
   ════════════════════════════════════════════════════ */
async function callSaveProgress(wallet, lessonId, xp, sol, badge) {
  try {
    const body = {
      wallet,
      lessonId,
      courseId:   "risk_scanner_course",
      xpEarned:   xp,
      solReward:  sol || 0,
    };
    if (badge) body.badgeId = badge;

    const res  = await fetch("/.netlify/functions/save-academy-progress", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn("save-academy-progress error:", e);
    return null;
  }
}

async function grantRewards(correct, isFirstTry) {
  const wallet = getConnectedWallet();

  /* ── No wallet connected — show badge only, skip server call ── */
  if (!wallet) {
    showBadgeCard(correct, { xpAwarded: 0, solAwarded: 0, alreadyDone: false, noWallet: true });
    return;
  }

  /* ── Base reward: 100 XP + 1 SOL ── */
  const baseResult = await callSaveProgress(wallet, LESSON_ID, BASE_XP, SOL_REWARD, BADGE_ID);

  /* ── Perfect first-try bonus: +100 XP (own idempotency key) ── */
  let bonusResult = null;
  const allCorrect = correct === 5;
  if (allCorrect && isFirstTry) {
    bonusResult = await callSaveProgress(wallet, BONUS_LESSON, BONUS_XP, 0, null);
  }

  const xpTotal  = (baseResult?.xpAwarded  || 0) + (bonusResult?.xpAwarded  || 0);
  const solTotal = (baseResult?.solAwarded  || 0);
  const already  = baseResult?.alreadyDone || false;

  showBadgeCard(correct, {
    xpAwarded:   xpTotal,
    solAwarded:  solTotal,
    alreadyDone: already,
    bonusEarned: (bonusResult?.xpAwarded || 0) > 0,
    noWallet:    false,
  });
}

/* ════════════════════════════════════════════════════
   BADGE CARD RENDERER
   ════════════════════════════════════════════════════ */
function showBadgeCard(correct, { xpAwarded, solAwarded, alreadyDone, bonusEarned, noWallet }) {
  const badgeWrap = document.getElementById("badgeWrap");
  const badgeCard = document.getElementById("badgeCard");
  if (!badgeWrap || !badgeCard) return;

  /* Score line */
  const scoreEl = document.getElementById("badgeScoreText");
  if (scoreEl) scoreEl.textContent = correct + "/5 Correct";

  /* Build reward chips */
  let rewardHtml = "";
  if (noWallet) {
    rewardHtml = `
      <div class="grs-reward-note">
        Connect your wallet on Dashboard to earn XP &amp; SOL rewards when completing guides.
      </div>`;
  } else if (alreadyDone) {
    rewardHtml = `
      <div class="grs-reward-chips">
        <div class="grs-reward-chip grs-chip-dim">Already Claimed</div>
        <div class="grs-reward-note">You already earned rewards for this guide. Reset your account to start fresh.</div>
      </div>`;
  } else {
    rewardHtml = `
      <div class="grs-reward-chips">
        ${xpAwarded > 0 ? `<div class="grs-reward-chip grs-chip-xp">+${xpAwarded} XP</div>` : ""}
        ${solAwarded > 0 ? `<div class="grs-reward-chip grs-chip-sol">+${solAwarded} SOL</div>` : ""}
        ${bonusEarned ? `<div class="grs-reward-chip grs-chip-bonus">+${BONUS_XP} XP Bonus — Perfect!</div>` : ""}
      </div>
      <div class="grs-reward-note">Rewards added to your account — check Dashboard!</div>`;
  }

  /* Inject reward block inside badge card after the score */
  const existing = badgeCard.querySelector(".grs-reward-block");
  if (existing) existing.remove();
  const block = document.createElement("div");
  block.className = "grs-reward-block";
  block.innerHTML = rewardHtml;
  badgeCard.appendChild(block);

  /* Show */
  badgeWrap.classList.add("show");
  badgeCard.style.animation = "badgeAppear 0.6s cubic-bezier(.175,.885,.32,1.275) forwards";
}

/* ════════════════════════════════════════════════════
   QUIZ LOGIC
   ════════════════════════════════════════════════════ */
window.__s2mRetranslateDynamic = function () {
  Object.keys(shownExplanations).forEach(qNum => {
    const key  = EXPL_KEYS[qNum][shownExplanations[qNum]];
    const expl = document.getElementById("qe" + qNum);
    if (expl && key) expl.textContent = getT(key);
  });

  const prog = document.getElementById("quizProgress");
  if (prog && prog.style.display !== "none") {
    const answered = Object.keys(userAnswers).length;
    if (answered === 0) {
      prog.textContent = getT("gr_quiz_progress_init");
    } else if (answered === 5) {
      prog.textContent = getT("gr_quiz_progress_all");
    } else {
      prog.textContent = answered + " / 5 " + (localStorage.getItem("s2m_lang") === "nl" ? "beantwoord" : "answered");
    }
  }

  if (quizSubmitted) {
    let correct = 0;
    for (let i = 1; i <= 5; i++) {
      if (userAnswers[i] === CORRECT[i]) correct++;
    }
    const passed   = correct >= 4;
    const labelEl  = document.getElementById("quizResultLabel");
    if (labelEl) labelEl.textContent = passed ? getT("gr_result_pass") : getT("gr_result_fail");
  }
};

function answer(qNum, choice) {
  if (quizSubmitted) return;
  const block = document.getElementById("qblock" + qNum);
  if (block.dataset.answered === "1") return;
  block.dataset.answered = "1";

  userAnswers[qNum]       = choice;
  shownExplanations[qNum] = choice;

  block.querySelectorAll(".quiz-option").forEach(btn => btn.disabled = true);

  const isCorrect  = choice === CORRECT[qNum];
  const btn        = block.querySelectorAll(".quiz-option")[["A","B","C"].indexOf(choice)];
  btn.classList.add(isCorrect ? "correct" : "wrong");
  document.getElementById("qi" + qNum + choice).textContent = isCorrect ? "✅" : "❌";

  if (!isCorrect) {
    const correctBtn = block.querySelectorAll(".quiz-option")[["A","B","C"].indexOf(CORRECT[qNum])];
    correctBtn.classList.add("correct");
    document.getElementById("qi" + qNum + CORRECT[qNum]).textContent = "✅";
  }

  const expl = document.getElementById("qe" + qNum);
  expl.textContent = getT(EXPL_KEYS[qNum][choice]);
  expl.className   = "quiz-explanation show " + (isCorrect ? "expl-good" : "expl-bad");

  const answered = Object.keys(userAnswers).length;
  const prog     = document.getElementById("quizProgress");
  const lang     = localStorage.getItem("s2m_lang") || "en";
  prog.textContent = answered + " / 5 " + (lang === "nl" ? "beantwoord" : "answered");

  if (answered === 5) {
    const submitBtn = document.getElementById("submitQuizBtn");
    submitBtn.disabled = false;
    submitBtn.style.opacity = "1";
    submitBtn.style.pointerEvents = "auto";
    prog.textContent = lang === "nl"
      ? "Alles beantwoord — klik op Indienen!"
      : "All answered — click Submit!";
  }
}
window.answer = answer;

function submitQuiz() {
  if (quizSubmitted) return;
  quizSubmitted = true;

  let correct = 0;
  for (let i = 1; i <= 5; i++) {
    if (userAnswers[i] === CORRECT[i]) correct++;
  }

  const passed      = correct >= 4;
  const isFirstTry  = !hasRetried;

  document.getElementById("submitQuizBtn").style.display = "none";
  document.getElementById("quizProgress").style.display  = "none";

  const resultEl = document.getElementById("quizResult");
  resultEl.classList.add("show");
  document.getElementById("quizResultScore").textContent = correct + " / 5";
  document.getElementById("quizResultLabel").textContent = passed
    ? getT("gr_result_pass")
    : getT("gr_result_fail");

  if (passed) {
    /* Mark guide as locally completed so hub (guide.html) can reflect it */
    try { localStorage.setItem("s2m_completed_risk_scanner", "true"); } catch {}
    /* Grant XP + SOL + badge via API (async) */
    grantRewards(correct, isFirstTry);
  } else {
    document.getElementById("quizFailMsg").classList.add("show");
  }

  setTimeout(() => resultEl.scrollIntoView({ behavior: "smooth", block: "center" }), 200);
}
window.submitQuiz = submitQuiz;

function retryQuiz() {
  hasRetried    = true;
  quizSubmitted = false;
  Object.keys(userAnswers).forEach(k => delete userAnswers[k]);
  Object.keys(shownExplanations).forEach(k => delete shownExplanations[k]);

  for (let i = 1; i <= 5; i++) {
    const block = document.getElementById("qblock" + i);
    block.dataset.answered = "";
    block.querySelectorAll(".quiz-option").forEach(btn => {
      btn.disabled = false;
      btn.classList.remove("correct", "wrong");
    });
    ["A","B","C"].forEach(c => {
      const ind = document.getElementById("qi" + i + c);
      if (ind) ind.textContent = "◯";
    });
    const expl = document.getElementById("qe" + i);
    expl.className   = "quiz-explanation";
    expl.textContent = "";
  }

  const submitBtn = document.getElementById("submitQuizBtn");
  submitBtn.disabled          = true;
  submitBtn.style.opacity     = "0.4";
  submitBtn.style.pointerEvents = "none";
  submitBtn.style.display     = "";

  const prog = document.getElementById("quizProgress");
  prog.style.display  = "";
  prog.textContent    = getT("gr_quiz_progress_init");

  document.getElementById("quizResult").classList.remove("show");
  document.getElementById("badgeWrap").classList.remove("show");
  document.getElementById("quizFailMsg").classList.remove("show");

  document.getElementById("quizWrap").scrollIntoView({ behavior: "smooth", block: "start" });
}
window.retryQuiz = retryQuiz;

/* ════════════════════════════════════════════════════
   SHARE + SAVE IMAGE
   ════════════════════════════════════════════════════ */
function shareOnX() {
  const lang = localStorage.getItem("s2m_lang") || "en";
  const text = lang === "nl"
    ? encodeURIComponent("Zojuist mijn 🌕 Gecertificeerde Scan2Moon Gebruiker badge verdiend!\n\nDe Risk Scanner meesterklas voltooid — nu weet ik hoe ik on-chain signalen moet lezen voordat ik instap.\n\nGratis leren op scan2moon.com/guide.html 🔍\n\n@Scan2Moon")
    : encodeURIComponent("Just earned my 🌕 Certified Scan2Moon User badge!\n\nCompleted the Risk Scanner guide — 100 XP + 1 SOL reward earned!\n\nLearn for free at scan2moon.com/guide.html 🔍\n\n@Scan2Moon");
  window.open("https://twitter.com/intent/tweet?text=" + text, "_blank");
}
window.shareOnX = shareOnX;

async function saveAsImage() {
  const card = document.getElementById("badgeCard");
  if (!card || typeof html2canvas === "undefined") return;
  try {
    const canvas = await html2canvas(card, {
      backgroundColor: "#041a14", scale: 3, useCORS: true, logging: false
    });
    const link      = document.createElement("a");
    link.download   = "Scan2Moon-Certified-Badge.png";
    link.href       = canvas.toDataURL("image/png");
    link.click();
  } catch (e) { console.warn("Save image failed:", e); }
}
window.saveAsImage = saveAsImage;

/* ════════════════════════════════════════════════════
   ANIMATIONS
   ════════════════════════════════════════════════════ */
const _style = document.createElement("style");
_style.textContent = `
  @keyframes badgeAppear {
    from { opacity: 0; transform: scale(0.85) translateY(20px); }
    to   { opacity: 1; transform: scale(1) translateY(0); }
  }
`;
document.head.appendChild(_style);
