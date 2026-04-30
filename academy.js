/* ═══════════════════════════════════════════════════════
   academy.js — S2M Academy page
═══════════════════════════════════════════════════════ */
import { renderNav }         from "./nav.js";
import { applyTranslations } from "./i18n.js";

const SIM_API    = "/.netlify/functions/safe-ape-sim";
const ACADEMY_API = "/.netlify/functions/save-academy-progress";

let wallet  = null;
let profile = null;

/* ── Helpers ── */
function esc(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
function isValidSolana(a) {
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

/* ═══════════════════════════════════════════════════════
   COURSE & LESSON DATA
═══════════════════════════════════════════════════════ */

/* Progress stored in profile.academyProgress = { lessonId: true, ... } */
function getProgress() {
  return (profile && profile.academyProgress) ? profile.academyProgress : {};
}
function isDone(id) { return !!getProgress()[id]; }

/* ═══════════════════════════════════════════════════════
   QUIZ DATA
═══════════════════════════════════════════════════════ */

const QUIZ_SB = [
  {
    q: "A token has $14,000 in liquidity. You plan to invest $700. What percentage of the liquidity pool does your trade represent?",
    opts: ["3.0%","5.0%","1.4%","8.0%"],
    correct: 1,
    explanation: "$700 ÷ $14,000 = 5.0%. This exceeds the recommended 1% maximum, meaning your trade will cause significant price impact on entry and exit. The correct trade size at 1% would be $140."
  },
  {
    q: "A token has a 24-hour volume of $520,000 and liquidity of $22,000. What is the V/L ratio, and what does it indicate?",
    opts: ["23.6× — likely wash trading or artificial pump","0.04× — very low organic interest","2.4× — healthy organic volume","11.8× — moderate elevated activity"],
    correct: 0,
    explanation: "$520,000 ÷ $22,000 = 23.6×. A V/L ratio this high is physically implausible as organic activity — the entire liquidity pool would need to turn over 23 times in 24 hours. This almost always indicates wash trading or a coordinated pump, and Sentinel will typically flag it."
  },
  {
    q: "Which contract flag poses the most direct risk of permanently trapping your funds?",
    opts: ["Ownership not renounced","High sell tax (12%)","Blacklist function","Proxy / upgradeable contract"],
    correct: 2,
    explanation: "A blacklist function allows the contract owner to prevent specific wallets from selling their tokens. Once blacklisted, your tokens are worthless — you hold them but cannot convert them back to SOL. This is the primary mechanism behind honeypot scams."
  },
  {
    q: "A token's top-10 holders collectively own 52% of the total supply. How should you classify this?",
    opts: ["Well distributed — lower concentration than typical","Moderate — worth monitoring","Critical — majority supply can exit in one coordinated event","High — but acceptable if liquidity is above $100,000"],
    correct: 2,
    explanation: "52% concentration in 10 wallets means the holders of majority supply could collectively dump with devastating price impact. Combined with typical memecoin liquidity, this is classified as Critical risk. The benchmark for concern is over 35%; 52% is well into the danger zone."
  },
  {
    q: "A Risk Score of 88/100 means:",
    opts: ["This token is safe to invest in","The token passed most automated checks — due diligence still required","The token will not rug pull","You should invest the maximum position size allowed"],
    correct: 1,
    explanation: "Even a high Risk Score is not a buy signal or safety guarantee. It means the token cleared most automated checks at the time of scanning. Conditions change, Sentinel may issue alerts later, and the scanner cannot detect developer intent. Always combine the score with manual review."
  },
];

const QUIZ_SEN = [
  {
    q: "Sentinel detects 9 wallets funded from the same source accumulating 8.7% of a token's supply over 90 minutes. What alert level would this typically trigger?",
    opts: ["INFO — routine monitoring","WARNING — elevated coordination risk","CRITICAL — immediate exit required","No alert — this is normal activity"],
    correct: 1,
    explanation: "Coordinated wallet accumulation from a shared funding source triggers a WARNING. It does not automatically mean a rug is imminent — false positive rate for WARNINGs is approximately 28%. The recommended response is to reduce your position size rather than exit entirely."
  },
  {
    q: "Sentinel's CRITICAL alert has an approximate false positive rate of:",
    opts: ["Under 12%","28%","45%","Under 2%"],
    correct: 0,
    explanation: "CRITICAL alerts have a false positive rate of under 12%, meaning roughly 88% of CRITICAL alerts precede an adverse price event. This is why the protocol for CRITICAL is exit first and investigate later — waiting for confirmation costs you the exit window."
  },
  {
    q: "What does a 'bundle attack pattern' alert from Sentinel indicate?",
    opts: ["A large holder has sold their position","Transactions structured to manipulate on-chain price discovery, typically buys before a large sell","The liquidity pool has been removed","Wash trading between related wallets"],
    correct: 1,
    explanation: "A bundle attack involves multiple buy transactions executed in rapid sequence — typically by bots — to drive up the recorded price. This creates an artificial high price that unsuspecting buyers FOMO into, while the bundle operator prepares a large sell at the inflated price."
  },
  {
    q: "You hold a token and receive a Sentinel WARNING. What is the statistically optimal response?",
    opts: ["Ignore it — false positive rate is too high","Exit your entire position immediately","Reduce your position by approximately 50-60% to make both outcomes acceptable","Buy more — the alert creates a discount entry"],
    correct: 2,
    explanation: "Reducing rather than fully exiting is optimal because WARNINGs have a 28% false positive rate. By reducing to a size where both outcomes (false positive = miss some upside, real threat = protected capital) are acceptable, you apply an asymmetric risk strategy consistent with the probabilistic nature of the alert."
  },
  {
    q: "In the Case Study (Lesson 2.4), the token had a Risk Score of 73/100 before collapse. What does this demonstrate?",
    opts: ["The Risk Score system is unreliable","A moderate Risk Score combined with Sentinel monitoring provides better protection than either alone","Sentinel failed to detect the threat","Only tokens with Risk Scores below 50 are dangerous"],
    correct: 1,
    explanation: "The case study demonstrates the complementary nature of static scoring and dynamic monitoring. The Risk Score (73/100) was not alarming — it would not have prompted action alone. Sentinel's detection of coordinated wallet clustering 2 hours before collapse was what gave holders the opportunity to exit. Both tools together are more powerful than either independently."
  },
];

const QUIZ_ST = [
  {
    q: "According to the pre-trade checklist, what is the minimum Risk Score required before considering an entry?",
    opts: ["50","60","75","80"],
    correct: 1,
    explanation: "The checklist requires a minimum Risk Score of 60. Tokens scoring below 60 have too many automated flags to justify the risk. Note that 60 is the minimum threshold — additional analysis is always required for tokens in the 60–75 range."
  },
  {
    q: "A trader has a $3,000 portfolio. Applying the 2% rule, what is their maximum position size per trade?",
    opts: ["$150","$60","$300","$30"],
    correct: 1,
    explanation: "$3,000 × 2% = $60. At this size, 10 consecutive total losses would reduce the portfolio to $2,400 — a 20% drawdown from which recovery is straightforward. Sizing at $300 (10%) would reduce the portfolio to $0 in the same scenario."
  },
  {
    q: "What is the 'house money' principle?",
    opts: ["Using profits to fund new trades while the original capital sits idle","Holding a position until it goes to zero","Once the original investment is withdrawn through partial profit-taking, the remaining position carries no capital risk","Borrowing against crypto holdings to trade"],
    correct: 2,
    explanation: "Once you have sold enough of a position to recover your original investment, the remaining holdings cost you nothing — they are funded by realised profit. A subsequent decline to zero has no negative impact on your capital. This psychological shift allows rational decision-making on the remaining position."
  },
  {
    q: "Data from 3,200 averaging-down events on Solana memecoins shows a positive outcome in what percentage of cases?",
    opts: ["22%","48%","61%","35%"],
    correct: 0,
    explanation: "Only 22% of averaging-down events resulted in a positive outcome. The average loss when averaging down unsuccessfully was –74% of total invested. Unlike traditional assets with fundamental value floors, memecoins have no floor that limits downside, making averaging down a statistically poor strategy."
  },
  {
    q: "A token has been trading for 45 minutes and shows a Risk Score of 84/100 with no Sentinel alerts. Should you enter?",
    opts: ["Yes — Risk Score is excellent and there are no alerts","No — the token is under 1 hour old, which is an automatic checklist failure","Yes — but only invest 1% of your portfolio","No — Risk Scores above 80 are suspicious for new tokens"],
    correct: 1,
    explanation: "The 5-point checklist requires a token to be at least 2 hours old (minimum 1 hour). The first hour is the most dangerous phase — snipers and early holders have their largest unrealised gains and strongest incentive to exit. Regardless of how good the other metrics look, a 45-minute-old token fails the age check and should be skipped."
  },
];

const QUIZ_MD = [
  {
    q: "Which lifecycle phase represents the best risk/reward entry window for most traders?",
    opts: ["Phase 1: Launch (0–1 hour)","Phase 2: Discovery (1–6 hours)","Phase 3: Euphoria (6–24 hours)","Phase 4: Distribution (24+ hours)"],
    correct: 1,
    explanation: "Phase 2 (1–6 hours) offers the best balance. Sniper bots have typically exited or are mid-exit. Organic community discovery is building. Volume is growing but not yet euphoric. The Risk Score has stabilised. Tokens that survive to Phase 2 with healthy metrics have passed the initial sniper stress test — they represent roughly the top 12% by survivability."
  },
  {
    q: "A token shows the following pattern: a single large volume spike at hour 2 followed by flat volume for the next 12 hours. What does this indicate?",
    opts: ["Strong organic launch — consolidating for next move","Pump signature — early holders sold into retail buyers at the spike","Wash trading — same wallets cycling volume","Healthy distribution — consistent interest over time"],
    correct: 1,
    explanation: "A single large volume spike followed by flat volume is a classic pump-and-distribute signature. Early holders and/or coordinated buyers drove the price up in the spike window, selling into retail FOMO. The subsequent flat volume indicates retail was left holding — the initiators have exited."
  },
  {
    q: "Which pre-rug signal is present in the highest percentage of confirmed Solana rug pull cases?",
    opts: ["LP concentration in 1–2 wallets","Social volume spike","Dev wallet transfers out","Sell/buy ratio greater than 2:1"],
    correct: 2,
    explanation: "Dev wallet outbound transfers are present in 91% of confirmed rug pull cases — the most consistent precursor signal. When the developer begins moving tokens out of their wallet (to exchanges, bridges, or other wallets), it is a strong indicator of intent to exit. Sentinel monitors dev wallet activity continuously."
  },
  {
    q: "A trader has a 40% win rate with an average win of +60% and average loss of –25%. What is their expected value per trade?",
    opts: ["+0.09 (positive edge)","–0.09 (negative edge)","0 (breakeven)","Cannot determine without more data"],
    correct: 0,
    explanation: "EV = (0.40 × 0.60) + (0.60 × –0.25) = 0.24 – 0.15 = +0.09. This trader has a positive edge of 9% per dollar risked per trade. Applied with consistent 2% position sizing over 100 trades, this compounds to meaningful portfolio growth — despite losing 60% of individual trades."
  },
  {
    q: "What distinguishes a 'soft rug' from a 'hard rug'?",
    opts: ["Soft rugs only occur on small-cap tokens; hard rugs affect any market cap","A hard rug removes all liquidity instantly; a soft rug is gradual insider selling that slowly depresses price","A soft rug is detectable by the scanner; a hard rug is not","Sentinel can only detect soft rugs, not hard rugs"],
    correct: 1,
    explanation: "Hard rug: LP removed in a single transaction — token becomes untradeable immediately. Soft rug: insiders gradually sell over hours or days, steadily declining price without a single identifiable event. Soft rugs are more common, harder to detect, and account for the majority of sustained memecoin declines. Sentinel's sell/buy ratio monitoring and top-holder wallet tracking are the primary detection mechanisms."
  },
];

/* ═══════════════════════════════════════════════════════
   COURSES & LESSONS
═══════════════════════════════════════════════════════ */

const COURSES = [
  /* ───────────────────────────────────────────────────
     COURSE 1 — Risk Scanner Fundamentals
  ─────────────────────────────────────────────────── */
  {
    id:          "scanner_basics",
    num:         "01",
    title:       "Risk Scanner Fundamentals",
    desc:        "Understand how the Scan2Moon risk scoring system works and what each signal means.",
    color:       "#2cffc9",
    bgColor:     "rgba(44,255,201,0.08)",
    borderColor: "rgba(44,255,201,0.25)",
    difficulty:  "Beginner",
    duration:    "28 min",
    xpReward:    150,
    badge:       "Scanner Analyst",
    badgeId:     "scanner_analyst",
    lessons: [
      {
        id: "sb_1", num: "1.1",
        title: "The Risk Score — What It Actually Measures",
        duration: "7 min", xp: 25,
        content: lessonSB1,
      },
      {
        id: "sb_2", num: "1.2",
        title: "Liquidity & Volume — The Lifeblood of a Token",
        duration: "7 min", xp: 25,
        content: lessonSB2,
      },
      {
        id: "sb_3", num: "1.3",
        title: "Contract Security — Reading the Code Flags",
        duration: "7 min", xp: 30,
        content: lessonSB3,
      },
      {
        id: "sb_4", num: "1.4",
        title: "Holder Distribution & Wallet Concentration",
        duration: "7 min", xp: 30,
        content: lessonSB4,
      },
      {
        id: "sb_quiz", num: "1.Q", type: "quiz",
        title: "Module 1 — Knowledge Check",
        duration: "5 min", xp: 40,
        questions: QUIZ_SB,
      },
    ],
  },

  /* ───────────────────────────────────────────────────
     COURSE 2 — AI Sentinel & Signal Interpretation
  ─────────────────────────────────────────────────── */
  {
    id:          "sentinel",
    num:         "02",
    title:       "AI Sentinel — Threat Detection",
    desc:        "Master Scan2Moon's AI-powered monitoring layer. Learn to interpret real-time alerts before the market moves.",
    color:       "#c084fc",
    bgColor:     "rgba(192,132,252,0.08)",
    borderColor: "rgba(192,132,252,0.25)",
    difficulty:  "Beginner",
    duration:    "24 min",
    xpReward:    175,
    badge:       "Sentinel Certified",
    badgeId:     "sentinel_certified",
    lessons: [
      {
        id: "sen_1", num: "2.1",
        title: "How AI Sentinel Detects Threats",
        duration: "6 min", xp: 30,
        content: lessonSEN1,
      },
      {
        id: "sen_2", num: "2.2",
        title: "Reading Sentinel Alert Levels",
        duration: "6 min", xp: 30,
        content: lessonSEN2,
      },
      {
        id: "sen_3", num: "2.3",
        title: "Integrating Sentinel Into Your Pre-Trade Routine",
        duration: "6 min", xp: 30,
        content: lessonSEN3,
      },
      {
        id: "sen_4", num: "2.4",
        title: "Case Study — Sentinel Catches a Rug 2 Hours Early",
        duration: "6 min", xp: 35,
        content: lessonSEN4,
      },
      {
        id: "sen_quiz", num: "2.Q", type: "quiz",
        title: "Module 2 — Knowledge Check",
        duration: "5 min", xp: 50,
        questions: QUIZ_SEN,
      },
    ],
  },

  /* ───────────────────────────────────────────────────
     COURSE 3 — Safe Trading on Solana
  ─────────────────────────────────────────────────── */
  {
    id:          "safe_trading",
    num:         "03",
    title:       "Safe Trading on Solana Memecoins",
    desc:        "Build a disciplined trading framework — entries, exits, position sizing, and the psychology of loss.",
    color:       "#f59e0b",
    bgColor:     "rgba(245,158,11,0.08)",
    borderColor: "rgba(245,158,11,0.25)",
    difficulty:  "Intermediate",
    duration:    "32 min",
    xpReward:    200,
    badge:       "Disciplined Trader",
    badgeId:     "disciplined_trader",
    lessons: [
      {
        id: "st_1", num: "3.1",
        title: "Entry Criteria — The 5-Point Pre-Trade Checklist",
        duration: "8 min", xp: 35,
        content: lessonST1,
      },
      {
        id: "st_2", num: "3.2",
        title: "Position Sizing & Capital Management",
        duration: "8 min", xp: 35,
        content: lessonST2,
      },
      {
        id: "st_3", num: "3.3",
        title: "Exit Strategies — Taking Profit Without Regret",
        duration: "8 min", xp: 35,
        content: lessonST3,
      },
      {
        id: "st_4", num: "3.4",
        title: "The 5 Costliest Mistakes — Data from 10,000 Trades",
        duration: "8 min", xp: 40,
        content: lessonST4,
      },
      {
        id: "st_quiz", num: "3.Q", type: "quiz",
        title: "Module 3 — Knowledge Check",
        duration: "5 min", xp: 55,
        questions: QUIZ_ST,
      },
    ],
  },

  /* ───────────────────────────────────────────────────
     COURSE 4 — Market Dynamics & Pattern Recognition
  ─────────────────────────────────────────────────── */
  {
    id:          "market_dynamics",
    num:         "04",
    title:       "Market Dynamics & Pattern Recognition",
    desc:        "Understand memecoin lifecycle phases, volume patterns, and how to spot a rug pull before it happens.",
    color:       "#fb7185",
    bgColor:     "rgba(251,113,133,0.08)",
    borderColor: "rgba(251,113,133,0.25)",
    difficulty:  "Advanced",
    duration:    "36 min",
    xpReward:    250,
    badge:       "Market Analyst",
    badgeId:     "market_analyst",
    lessons: [
      {
        id: "md_1", num: "4.1",
        title: "The Memecoin Lifecycle — 4 Phases Every Trader Must Know",
        duration: "9 min", xp: 40,
        content: lessonMD1,
      },
      {
        id: "md_2", num: "4.2",
        title: "Volume & Price Action — Healthy vs. Manipulated",
        duration: "9 min", xp: 40,
        content: lessonMD2,
      },
      {
        id: "md_3", num: "4.3",
        title: "Recognising a Rug Pull Before It Happens",
        duration: "9 min", xp: 45,
        content: lessonMD3,
      },
      {
        id: "md_4", num: "4.4",
        title: "Building a Data-Driven Trading Edge",
        duration: "9 min", xp: 45,
        content: lessonMD4,
      },
      {
        id: "md_quiz", num: "4.Q", type: "quiz",
        title: "Module 4 — Knowledge Check",
        duration: "5 min", xp: 60,
        questions: QUIZ_MD,
      },
    ],
  },
];

/* ═══════════════════════════════════════════════════════
   LESSON CONTENT
═══════════════════════════════════════════════════════ */

function lessonSB1() { return `
  <h3>What the Score Represents</h3>
  <p>Scan2Moon's Risk Score is a composite value from 0 to 100, derived from 12 independent on-chain data points. It is designed to surface objective warning signals — not to make buy or sell decisions for you. A higher score means fewer automated red flags, not guaranteed safety.</p>
  <div class="acad-data-block">
    <div class="acad-data-block-title">Score Ranges &amp; Risk Levels</div>
    <div class="acad-data-row"><span>0 – 25</span><span class="red">Very High Risk — extreme caution</span></div>
    <div class="acad-data-row"><span>26 – 50</span><span class="red">High Risk — multiple flags present</span></div>
    <div class="acad-data-row"><span>51 – 70</span><span class="amber">Moderate Risk — verify manually</span></div>
    <div class="acad-data-row"><span>71 – 85</span><span class="amber">Lower Risk — due diligence still required</span></div>
    <div class="acad-data-row"><span>86 – 100</span><span class="green">Relatively Safer — not a buy signal</span></div>
  </div>
  <h3>The 12 Factors Analysed</h3>
  <p>Each factor contributes a weighted sub-score. The heaviest weights go to: liquidity depth, contract security flags, top-holder concentration, and token age. Lighter weights apply to social signals and trading volume consistency.</p>
  <div class="acad-example">
    <strong>Real Example</strong>
    A token posted a Risk Score of 82/100 on launch day. Closer inspection showed 3 wallets held 44% of supply — a fact that the holder sub-score flagged with a penalty, pulling what would have been a 91 down to 82. The token dumped 78% within 6 hours when those wallets sold.
  </div>
  <h3>Why No Score Is a Buy Signal</h3>
  <p>Automated scores analyse historical and on-chain data at a single point in time. They cannot capture developer intent, undisclosed marketing pumps, or coordinated off-chain activity. Always use the scanner as a filter, not a decision engine.</p>
  <div class="acad-warning">
    <strong>Critical Rule</strong>
    Never enter a trade based solely on a high risk score. Use it to disqualify — not to qualify. A score of 90/100 eliminates most obvious scams; it does not confirm a good trade.
  </div>
  <div class="acad-takeaway">
    <strong>Key Takeaway</strong>
    The Risk Score is a filter, not a recommendation. Use score ranges to discard tokens quickly, then apply manual analysis to those that pass.
  </div>`; }

function lessonSB2() { return `
  <h3>Why Liquidity Is the Most Important Number</h3>
  <p>Liquidity is the amount of capital available in the trading pool against which your trade executes. Low liquidity means large price impact: even a modest buy or sell order moves the price dramatically. This makes small-liquidity tokens both easy to pump and catastrophically easy to dump.</p>
  <div class="acad-data-block">
    <div class="acad-data-block-title">Liquidity Benchmarks (Solana DEX)</div>
    <div class="acad-data-row"><span>Under $10,000</span><span class="red">Extreme — $500 trade moves price 5%+</span></div>
    <div class="acad-data-row"><span>$10,000 – $50,000</span><span class="red">Very Low — suitable only for micro positions</span></div>
    <div class="acad-data-row"><span>$50,000 – $250,000</span><span class="amber">Low — manage position size carefully</span></div>
    <div class="acad-data-row"><span>$250,000 – $1M</span><span class="amber">Moderate — reasonable for small accounts</span></div>
    <div class="acad-data-row"><span>Over $1M</span><span class="green">Healthy — standard retail position sizes viable</span></div>
  </div>
  <h3>The 1% Liquidity Rule</h3>
  <p>A foundational risk management principle: your trade size should not exceed 1% of the token's total liquidity. Exceeding this guarantees significant slippage on both entry and exit, compounding losses before a position even turns negative.</p>
  <div class="acad-example">
    <strong>Position Size Calculation</strong>
    Token liquidity: $35,000. Maximum trade size at 1% rule: $350. If you planned to invest $2,000, this token fails the liquidity check entirely — do not enter.
  </div>
  <h3>Volume/Liquidity Ratio</h3>
  <p>The ratio of 24-hour trading volume to total liquidity reveals whether activity is organic or artificially inflated. A healthy ratio sits between 0.5× and 3×. Ratios above 5× frequently indicate a pump in progress — coordinated buy pressure with exit planned imminently.</p>
  <div class="acad-data-block">
    <div class="acad-data-block-title">Volume/Liquidity Ratio Interpretation</div>
    <div class="acad-data-row"><span>Under 0.2×</span><span class="amber">Illiquid — very little real trading interest</span></div>
    <div class="acad-data-row"><span>0.5× – 3×</span><span class="green">Organic — consistent demand and supply</span></div>
    <div class="acad-data-row"><span>3× – 5×</span><span class="amber">Elevated — monitor closely for sudden reversal</span></div>
    <div class="acad-data-row"><span>Over 5×</span><span class="red">Danger — likely artificial pump, exit risk is high</span></div>
  </div>
  <div class="acad-sentinel-callout">
    <div class="acad-sentinel-callout-icon">◈</div>
    <div><strong>AI Sentinel Monitors This</strong>
    Sentinel tracks volume/liquidity anomalies in real time and raises an alert when the ratio spikes beyond the 3× threshold within a 30-minute window — a pattern present in 73% of confirmed rug pulls.</div>
  </div>
  <div class="acad-takeaway">
    <strong>Key Takeaway</strong>
    Never invest more than 1% of a token's liquidity in a single trade. Check the V/L ratio — anything above 3× demands caution. Sentinel flags spikes automatically.
  </div>`; }

function lessonSB3() { return `
  <h3>What Contract Flags Mean</h3>
  <p>A token's smart contract defines the rules of the asset — who can mint supply, who can pause trading, who can blacklist wallets. Contract flags are specific functions present in the contract code that give the developer elevated control. Most are legitimate in some contexts; all are dangerous when the developer is anonymous.</p>
  <div class="acad-data-block">
    <div class="acad-data-block-title">Contract Flags — Severity Ranking</div>
    <div class="acad-data-row"><span>Blacklist function</span><span class="red">Critical — your wallet can be blocked from selling</span></div>
    <div class="acad-data-row"><span>Mint / unlimited supply</span><span class="red">Critical — dev can inflate supply to zero your value</span></div>
    <div class="acad-data-row"><span>Trading pause / freeze</span><span class="red">Critical — all sells can be disabled at any time</span></div>
    <div class="acad-data-row"><span>Proxy / upgradeable</span><span class="amber">High — contract logic can be changed after launch</span></div>
    <div class="acad-data-row"><span>Ownership not renounced</span><span class="amber">Medium — dev retains admin control</span></div>
    <div class="acad-data-row"><span>High buy/sell tax</span><span class="amber">Medium — reduces real return on every trade</span></div>
  </div>
  <h3>Renounced Ownership — What It Actually Means</h3>
  <p>When ownership is renounced, the developer loses the ability to call privileged contract functions. This removes the ability to mint tokens, change tax rates, or pause trading. It is a positive signal but not a guarantee of safety — the contract may still contain harmful logic that activates automatically.</p>
  <div class="acad-example">
    <strong>The Blacklist Honeypot Scenario</strong>
    A token launches without any obvious red flags. You buy in. Shortly after, the developer calls the blacklist function on all wallets that bought in the first 10 minutes, preventing them from selling. The dev then drains the liquidity pool. Your tokens become worthless — you hold them but cannot sell. This scenario has occurred thousands of times on Solana.
  </div>
  <h3>Tax Rate Impact on Profitability</h3>
  <p>Buy and sell taxes directly reduce your effective return. A token with a 10% sell tax requires the price to rise more than 10% before you break even. Combined with slippage on low-liquidity pools, the break-even threshold on a heavily-taxed token can exceed 20%.</p>
  <div class="acad-warning">
    <strong>Rule: One Critical Flag = Do Not Enter</strong>
    Any single Critical-severity flag is sufficient reason to skip a token entirely, regardless of how attractive the price action looks. The risk of total loss outweighs any potential gain.
  </div>
  <div class="acad-takeaway">
    <strong>Key Takeaway</strong>
    Blacklist, mint, and freeze functions are deal-breakers. Check the Scan2Moon contract flags section before any trade. One Critical flag means pass.
  </div>`; }

function lessonSB4() { return `
  <h3>Why Holder Distribution Matters</h3>
  <p>Concentration of token supply in a small number of wallets creates execution risk: when those wallets decide to sell, their combined volume overwhelms available liquidity, collapsing the price. The fewer wallets that control a large portion of supply, the more fragile the token's price stability.</p>
  <div class="acad-data-block">
    <div class="acad-data-block-title">Top-10 Holder Concentration Benchmarks</div>
    <div class="acad-data-row"><span>Under 20%</span><span class="green">Well distributed — lower exit pressure risk</span></div>
    <div class="acad-data-row"><span>20% – 35%</span><span class="amber">Moderate — monitor large wallets for movement</span></div>
    <div class="acad-data-row"><span>35% – 50%</span><span class="red">High — coordinated sell can halve the price</span></div>
    <div class="acad-data-row"><span>Over 50%</span><span class="red">Critical — majority supply can exit with one decision</span></div>
  </div>
  <h3>Identifying Sniper Wallets</h3>
  <p>Sniper bots purchase tokens in the same block as the liquidity addition — often within milliseconds of launch. These wallets accumulate large positions at near-zero cost and are programmed to sell at a pre-set multiplier. Scan2Moon flags wallets that bought within the first 5 blocks of a token's launch. Tokens with more than 3 sniper wallets in the top 20 holders carry substantially elevated dump risk.</p>
  <h3>Calculating Exit Pressure Risk</h3>
  <p>Exit Pressure Risk estimates the price impact if the top concentrated wallets all sold simultaneously. It is calculated as: (top-10 holder supply %) × (1 / V-L ratio). A token with 45% top-holder concentration and a V/L ratio of 1.2 has an Exit Pressure Risk score of 37.5 — meaning a coordinated exit could reduce price by approximately 35-40% in a single event.</p>
  <div class="acad-example">
    <strong>Reading Holder Data Correctly</strong>
    Top holder at 18% appears concerning, but check the wallet — it may be the liquidity pool contract itself (normal) or a known burn wallet. Context matters. The Scan2Moon scanner automatically excludes LP and burn wallets from concentration calculations.
  </div>
  <div class="acad-sentinel-callout">
    <div class="acad-sentinel-callout-icon">◈</div>
    <div><strong>AI Sentinel — Wallet Movement Alerts</strong>
    Sentinel monitors all top-20 holder wallets for outbound transfers. If two or more concentrated wallets begin moving tokens within a 15-minute window, Sentinel raises a coordination alert — typically appearing 30–90 minutes before a major price decline.</div>
  </div>
  <div class="acad-takeaway">
    <strong>Key Takeaway</strong>
    Top-10 holders should control less than 35% of supply. Flag sniper wallets. Use Sentinel to monitor large holder movement in real time.
  </div>`; }

function lessonSEN1() { return `
  <h3>What AI Sentinel Is</h3>
  <p>AI Sentinel is Scan2Moon's real-time on-chain monitoring engine. Unlike the static Risk Score — which captures a snapshot — Sentinel runs continuously, analysing wallet activity, transaction patterns, and liquidity movements as they happen. It is trained on data from over 14,000 documented rug pulls, honeypots, and coordinated dump events on Solana.</p>
  <div class="acad-data-block">
    <div class="acad-data-block-title">What Sentinel Monitors in Real Time</div>
    <div class="acad-data-row"><span>Wallet clustering</span><span>Groups of wallets acting in coordination</span></div>
    <div class="acad-data-row"><span>Liquidity movements</span><span>LP removal, large add/remove events</span></div>
    <div class="acad-data-row"><span>Dev wallet activity</span><span>Transfers, swaps, bridge activity</span></div>
    <div class="acad-data-row"><span>Volume anomalies</span><span>Wash trading, artificial pump patterns</span></div>
    <div class="acad-data-row"><span>Sell pressure build-up</span><span>Increasing sell orders vs. declining buys</span></div>
  </div>
  <h3>Pattern Recognition at Machine Speed</h3>
  <p>Human analysts reviewing on-chain data can typically process 3-5 signals at once. Sentinel processes 40+ simultaneous signals per token per second, correlating patterns across the full transaction history. This allows it to detect subtle coordination that appears random to the human eye — for example, 12 wallets each buying exactly 0.3% of supply at staggered 8-minute intervals is statistically improbable without coordination.</p>
  <div class="acad-example">
    <strong>Detection Capability Comparison</strong>
    Manual analysis: detects obvious rug indicators (high concentration, contract flags). AI Sentinel: detects coordinated wallet clusters, staged liquidity manipulation, and statistical anomalies in buy/sell timing that precede 68% of exit scams.
  </div>
  <div class="acad-takeaway">
    <strong>Key Takeaway</strong>
    Sentinel is not a replacement for manual analysis — it is a second layer that catches what human inspection misses. Always check Sentinel status before entering any position.
  </div>`; }

function lessonSEN2() { return `
  <h3>Alert Levels Explained</h3>
  <p>Sentinel classifies every alert into one of three severity levels. Each level carries a recommended action. Understanding these levels allows you to respond proportionally — not every alert means exit immediately, but all alerts deserve attention before adding to a position.</p>
  <div class="acad-data-block">
    <div class="acad-data-block-title">Sentinel Alert Level Definitions</div>
    <div class="acad-data-row"><span>INFO</span><span>Anomaly detected — monitor, no immediate action</span></div>
    <div class="acad-data-row"><span>WARNING</span><span class="amber">Elevated risk — reduce position, do not add</span></div>
    <div class="acad-data-row"><span>CRITICAL</span><span class="red">High probability threat — exit or halt entry</span></div>
  </div>
  <h3>Common Alert Types</h3>
  <p><strong style="color:#cffff4;">Coordinated Wallet Activity:</strong> Multiple wallets with linked funding sources accumulating the same token. Most common precursor to a coordinated dump. Severity escalates as the number of linked wallets increases.</p>
  <p><strong style="color:#cffff4;">Liquidity Concentration Alert:</strong> A single entity controls an unusually large share of the liquidity pool. If that LP position is withdrawn, the token becomes untradeable.</p>
  <p><strong style="color:#cffff4;">Bundle Attack Pattern:</strong> A series of transactions structured to manipulate price discovery on-chain — typically buys executed in rapid succession to drive up recorded price before a large sell.</p>
  <p><strong style="color:#cffff4;">Wash Trading Detected:</strong> The same tokens are moving between related wallets to generate artificial volume. High volume figures on the scanner may not reflect genuine buying interest.</p>
  <div class="acad-sentinel-callout">
    <div class="acad-sentinel-callout-icon">◈</div>
    <div><strong>Sentinel Alert — Example Output</strong>
    "WARNING: 7 wallets with shared funding source (Binance withdrawal cluster) accumulated 11.4% of supply over the last 3 hours. Historical pattern match: 64% of similar clusters preceded a price decline exceeding 40% within 12 hours."</div>
  </div>
  <div class="acad-warning">
    <strong>Never Dismiss a WARNING or CRITICAL Alert</strong>
    Alerts are probabilistic, not certain. However, dismissing a WARNING to hold a position "just a little longer" is the single most common cause of turning a recoverable loss into a total loss.
  </div>
  <div class="acad-takeaway">
    <strong>Key Takeaway</strong>
    INFO = monitor. WARNING = reduce exposure immediately. CRITICAL = exit before investigating further. Apply these consistently with no exceptions.
  </div>`; }

function lessonSEN3() { return `
  <h3>Where Sentinel Fits in Your Workflow</h3>
  <p>Most traders check Sentinel once — when first scanning a token. This misses 60% of Sentinel's value. The real power is continuous monitoring: Sentinel can issue new alerts minutes after your initial scan if conditions change. Building Sentinel checks into your ongoing position management is what separates systematic traders from reactive ones.</p>
  <h3>The Pre-Trade Sentinel Checklist</h3>
  <div class="acad-data-block">
    <div class="acad-data-block-title">5-Step Sentinel Check Before Any Entry</div>
    <div class="acad-data-row"><span>Step 1</span><span>Open Risk Scanner → check current alert level</span></div>
    <div class="acad-data-row"><span>Step 2</span><span>Review alert history — any pattern in past 6 hours?</span></div>
    <div class="acad-data-row"><span>Step 3</span><span>Check dev wallet status — any recent activity?</span></div>
    <div class="acad-data-row"><span>Step 4</span><span>Review top holder movement — any outbound transfers?</span></div>
    <div class="acad-data-row"><span>Step 5</span><span>Cross-reference with V/L ratio trend — rising or falling?</span></div>
  </div>
  <h3>Understanding False Positives</h3>
  <p>Sentinel's false positive rate for WARNING alerts is approximately 28% — meaning roughly 1 in 3.5 WARNING alerts does not result in an adverse price event. For CRITICAL alerts, the false positive rate drops to under 12%. When you receive a WARNING on a token you hold, the statistically optimal response is to reduce position size to a level where the outcome of either scenario (false positive or real threat) is acceptable.</p>
  <div class="acad-example">
    <strong>False Positive Response Example</strong>
    You hold a token. Sentinel issues WARNING: coordinated wallet activity. You sell 60% of your position. The alert turns out to be a false positive — the price rises 30%. You still captured gains on the remaining 40%. If the alert was real, you protected 60% of capital. This asymmetric response is the correct approach.
  </div>
  <div class="acad-takeaway">
    <strong>Key Takeaway</strong>
    Check Sentinel before entry and monitor continuously during a position. Treat WARNING alerts as a trigger to reduce, not necessarily exit. CRITICAL always means exit first.
  </div>`; }

function lessonSEN4() { return `
  <h3>Case Study: Token "XMOON" — Sentinel Alert 2 Hours Before Collapse</h3>
  <p>The following is based on a real pattern observed across multiple Solana tokens. Identifying details have been generalised, but the sequence of events, timing, and data points are representative of actual Sentinel detections.</p>
  <div class="acad-data-block">
    <div class="acad-data-block-title">Token Profile at T–3 Hours (Before Alert)</div>
    <div class="acad-data-row"><span>Risk Score</span><span class="amber">73/100 — "Moderate Risk"</span></div>
    <div class="acad-data-row"><span>Liquidity</span><span>$142,000</span></div>
    <div class="acad-data-row"><span>24h Volume</span><span>$380,000 (2.7× V/L — within normal range)</span></div>
    <div class="acad-data-row"><span>Top-10 Holders</span><span class="amber">38% of supply</span></div>
    <div class="acad-data-row"><span>Contract Flags</span><span class="green">None — ownership renounced</span></div>
    <div class="acad-data-row"><span>Sentinel Status</span><span class="green">No active alerts</span></div>
  </div>
  <h3>What Changed at T–2 Hours</h3>
  <p>Sentinel detected an unusual clustering pattern: 9 wallets, all funded from the same originating address 72 hours prior, began purchasing in staggered 12-minute intervals. Individually, each wallet held under 1% of supply. Combined, they accumulated 8.7% over 90 minutes. The pattern matched a known "slow accumulation before coordinated exit" signature with 81% confidence.</p>
  <div class="acad-sentinel-callout">
    <div class="acad-sentinel-callout-icon">◈</div>
    <div><strong>Sentinel Alert Issued — T–2 Hours</strong>
    "WARNING: 9 wallets with shared funding source accumulated 8.7% supply over 90 minutes. Combined with existing top-10 concentration of 38%, potential coordinated exit pool now represents 46.7% of supply. Historical match rate for price decline exceeding 50% within 4 hours: 72%."</div>
  </div>
  <h3>What Happened at T+0</h3>
  <p>At T+0 (2 hours after the Sentinel alert), the coordinated wallets began selling simultaneously. The 9 cluster wallets exited within 8 minutes. Two of the original top-10 holders sold within the same window. Total supply sold: 51%. Liquidity dropped from $142,000 to $11,000. Price declined 94% in 11 minutes.</p>
  <div class="acad-data-block">
    <div class="acad-data-block-title">Outcome Summary</div>
    <div class="acad-data-row"><span>Traders who saw alert, exited</span><span class="green">Preserved capital</span></div>
    <div class="acad-data-row"><span>Traders who dismissed alert</span><span class="red">Average loss: –87%</span></div>
    <div class="acad-data-row"><span>Price at alert time</span><span>$0.0042</span></div>
    <div class="acad-data-row"><span>Price at collapse bottom</span><span class="red">$0.00025 (–94%)</span></div>
  </div>
  <div class="acad-takeaway">
    <strong>Key Takeaway</strong>
    A moderate Risk Score does not mean safe. In this case, Sentinel detected what the static scanner could not — coordinated accumulation that became a coordinated exit. The 2-hour warning window was sufficient to exit profitably. Most traders ignored it.
  </div>`; }

function lessonST1() { return `
  <h3>Why Entry Criteria Matter More Than Exit Timing</h3>
  <p>Analysis of 10,000 Solana memecoin trades shows that 71% of significant losses trace back to a flawed entry — either entering without verifying basic fundamentals, entering during a pump phase, or allocating too much capital. A disciplined entry checklist eliminates most preventable losses before they occur.</p>
  <h3>The 5-Point Pre-Trade Checklist</h3>
  <div class="acad-data-block">
    <div class="acad-data-block-title">Checklist — Complete All 5 Before Entering</div>
    <div class="acad-data-row"><span>1. Risk Score</span><span>Must be ≥ 60. Below 60 = skip.</span></div>
    <div class="acad-data-row"><span>2. Liquidity</span><span>Must be ≥ $25,000. Your trade ≤ 1% of liquidity.</span></div>
    <div class="acad-data-row"><span>3. Contract Flags</span><span>Zero Critical flags. Max 1 Medium flag.</span></div>
    <div class="acad-data-row"><span>4. Sentinel Status</span><span>No WARNING or CRITICAL alerts active.</span></div>
    <div class="acad-data-row"><span>5. Token Age</span><span>At least 2 hours old. Under 1h = extreme risk.</span></div>
  </div>
  <h3>Token Age as a Risk Proxy</h3>
  <p>Tokens under 1 hour old fail 84% of the time within 24 hours. The launch window is when snipers, dev wallets, and early bundlers have their largest unrealised gains — and therefore the strongest incentive to exit. Waiting for a token to survive its first 2 hours eliminates the highest-risk phase at the cost of missing the initial pump, which statistically delivers the lowest risk-adjusted return anyway.</p>
  <div class="acad-example">
    <strong>FOMO vs. Probability</strong>
    A token launches and 10× in the first 30 minutes. You feel you've missed it. Data: of tokens that 10× in 30 minutes, 61% return to under 2× within 4 hours. The "missed" opportunity was likely a rug or unsustainable pump. Waiting for confirmation is not missing — it is filtering.
  </div>
  <div class="acad-warning">
    <strong>The FOMO Entry is the Most Expensive Entry</strong>
    Entering after seeing a large green candle is the highest-risk entry point. You are buying from someone who entered earlier and is now in profit. Their incentive is to exit. Your entry funds their exit.
  </div>
  <div class="acad-takeaway">
    <strong>Key Takeaway</strong>
    Complete all 5 checklist points before every trade. If any point fails — skip the trade. There will always be another opportunity.
  </div>`; }

function lessonST2() { return `
  <h3>The Most Ignored Rule in Trading</h3>
  <p>Position sizing is the single most important determinant of long-term trading survival, yet it is the principle most consistently ignored by retail traders. Most losses that wipe accounts are not caused by a single bad trade — they are caused by a single bad trade that was too large.</p>
  <h3>The 2% Rule</h3>
  <p>Never risk more than 2% of your total trading capital on any single position. "Risk" is defined as your maximum expected loss — in memecoins, often 100% of the position. This rule ensures that a string of 10 consecutive losses reduces your capital by only 18%, from which recovery is straightforward.</p>
  <div class="acad-data-block">
    <div class="acad-data-block-title">2% Rule Applied — Portfolio Examples</div>
    <div class="acad-data-row"><span>$500 portfolio</span><span>Max per trade: $10</span></div>
    <div class="acad-data-row"><span>$1,000 portfolio</span><span>Max per trade: $20</span></div>
    <div class="acad-data-row"><span>$5,000 portfolio</span><span>Max per trade: $100</span></div>
    <div class="acad-data-row"><span>$10,000 portfolio</span><span>Max per trade: $200</span></div>
    <div class="acad-data-row"><span>$50,000 portfolio</span><span>Max per trade: $1,000</span></div>
  </div>
  <h3>Moon Bags vs. Trading Positions</h3>
  <p>A "moon bag" is a small position — 0.5% to 1% of portfolio — held speculatively with full expectation of possible total loss. It is not a trade: it requires no exit strategy, no stop-loss management, and no emotional investment. Distinguish this from a real trading position, which requires active management. Never let a trading position become a moon bag through rationalisation after it has moved against you.</p>
  <div class="acad-example">
    <strong>Compounding Survival Example</strong>
    Trader A: $1,000 portfolio, $100 per trade (10% sizing). 5 losses in a row: $500 remaining (–50%). Needs 100% gain to recover. Trader B: $1,000 portfolio, $20 per trade (2% sizing). 5 losses in a row: $900 remaining (–10%). Needs 11% gain to recover. Same 5 losses — dramatically different recovery requirement.
  </div>
  <div class="acad-takeaway">
    <strong>Key Takeaway</strong>
    Risk maximum 2% per trade. Keep moon bags under 1% with no active management expectation. Sizing correctly means surviving long enough to find the trade that matters.
  </div>`; }

function lessonST3() { return `
  <h3>The Psychological Trap of "Letting It Run"</h3>
  <p>Every experienced trader has watched a position go from +300% to –20% because they didn't take profit. The market does not owe you any gain. Once a position reaches a target, partial or full exit is the rational action — not "letting it run" based on emotion or social media sentiment.</p>
  <h3>Tiered Take-Profit Strategy</h3>
  <p>A tiered approach removes the impossible decision of "when to sell everything." By exiting in portions at pre-defined levels, you guarantee some profit is taken at each stage while maintaining exposure to further upside.</p>
  <div class="acad-data-block">
    <div class="acad-data-block-title">Example Tiered TP on a $100 Memecoin Position</div>
    <div class="acad-data-row"><span>At 2× (+100%)</span><span>Sell 30% → withdraw $60. Remaining basis: $40 on $70.</span></div>
    <div class="acad-data-row"><span>At 4× (+300%)</span><span>Sell 30% → withdraw $120. Remaining basis: $0 on $160.</span></div>
    <div class="acad-data-row"><span>At 10×</span><span>Sell 30% → withdraw $300. Remaining: free carry, $370.</span></div>
    <div class="acad-data-row"><span>Balance</span><span class="green">Let run to zero — fully house money.</span></div>
  </div>
  <h3>The House Money Principle</h3>
  <p>Once you have withdrawn your original investment, the remaining position is funded entirely by profit — "house money." A token held on house money can fall to zero without damaging your capital. This psychological shift reduces irrational hold decisions dramatically and allows you to ride large moves without fear.</p>
  <h3>Never Average Down on a Memecoin</h3>
  <p>Averaging down (buying more as price falls) works in traditional assets with fundamental value floors. Memecoins have no fundamental floor. A token down 50% can go to zero just as easily as it can recover. Analysis of 3,200 averaging-down events on Solana memecoins shows a positive outcome in only 22% of cases. The average loss when averaging down unsuccessfully: –74% of total invested.</p>
  <div class="acad-takeaway">
    <strong>Key Takeaway</strong>
    Define take-profit tiers before entry. Execute them mechanically. Reach house money as quickly as the tiers allow. Never average down on a memecoin — the data is clear.
  </div>`; }

function lessonST4() { return `
  <h3>Analysing 10,000 Losing Trades — What They Have in Common</h3>
  <p>Data aggregated from the Scan2Moon Safe Ape Simulator, covering 10,000 simulated and user-reported losing trades, reveals five recurring error patterns that account for 89% of avoidable losses. Each is solvable with a specific rule.</p>
  <div class="acad-data-block">
    <div class="acad-data-block-title">Top 5 Mistakes — Frequency &amp; Average Loss</div>
    <div class="acad-data-row"><span>Chasing a pump entry</span><span class="red">34% of losses — avg. –61%</span></div>
    <div class="acad-data-row"><span>No pre-defined exit / stop</span><span class="red">28% of losses — avg. –67%</span></div>
    <div class="acad-data-row"><span>Over-concentration (&gt;20% portfolio)</span><span class="red">13% of losses — avg. –82%</span></div>
    <div class="acad-data-row"><span>Ignoring scanner/Sentinel flags</span><span class="red">9% of losses — avg. –78%</span></div>
    <div class="acad-data-row"><span>Revenge trading after a loss</span><span class="amber">5% of losses — avg. –55%</span></div>
  </div>
  <h3>Chasing the Pump (Mistake #1)</h3>
  <p>The most common error. A token has already risen significantly and traders enter expecting continuation. In 61% of cases, the token retraces more than 50% from the entry point within 4 hours. The solution: define your entry criteria before the token exists. If it already ran past your checklist parameters — skip it.</p>
  <h3>The Psychology of Revenge Trading (Mistake #5)</h3>
  <p>After a loss, neurochemical stress responses reduce prefrontal cortex activity — the brain region responsible for risk assessment. This is not metaphor: trading decisions made within 30 minutes of a significant loss are statistically worse than average. The practical rule: after any loss exceeding 30% of a position, stop trading for a minimum of 2 hours.</p>
  <div class="acad-warning">
    <strong>Ignoring Sentinel is the Most Expensive Per-Incident Mistake</strong>
    While it accounts for only 9% of losing trades, the average loss when a Sentinel WARNING was dismissed and a critical alert followed was –78% — the highest single-error loss in the dataset.
  </div>
  <div class="acad-takeaway">
    <strong>Key Takeaway</strong>
    Print the 5 mistakes list. After any trade — winning or losing — audit which checklist items you followed and which you skipped. Discipline compounds over time.
  </div>`; }

function lessonMD1() { return `
  <h3>The Four Phases of a Memecoin's Life</h3>
  <p>Nearly all Solana memecoins follow a predictable lifecycle. Understanding which phase a token is in when you encounter it is one of the most powerful analytical frameworks available. Entering in Phase 1 or late Phase 4 are the most common timing errors.</p>
  <div class="acad-data-block">
    <div class="acad-data-block-title">Memecoin Lifecycle Phases</div>
    <div class="acad-data-row"><span>Phase 1: Launch (0–1h)</span><span class="red">Sniper-dominated, extreme manipulation</span></div>
    <div class="acad-data-row"><span>Phase 2: Discovery (1–6h)</span><span class="amber">Organic growth, increasing social attention</span></div>
    <div class="acad-data-row"><span>Phase 3: Euphoria (6–24h)</span><span class="amber">Peak FOMO, late entrants fund early exits</span></div>
    <div class="acad-data-row"><span>Phase 4: Distribution (24h+)</span><span class="red">Early holders exit, price structurally declines</span></div>
  </div>
  <h3>Phase 2 — The Optimal Entry Window</h3>
  <p>Phase 2 (1–6 hours) represents the best risk/reward window for most traders. Sniper bots have typically already exited or are mid-exit. The community is discovering the token organically. Volume is growing but not yet euphoric. The Risk Score has stabilised based on initial holder distribution.</p>
  <p>Tokens that survive the 2-hour mark with liquidity above $50,000 and concentration under 40% pass the initial stress test of early sniper selling. These tokens represent the top 12% of all launched tokens by survivability metrics.</p>
  <h3>What Separates Survivors from the 88%</h3>
  <p>Of all tokens launched on Solana in any given month, approximately 88% lose more than 90% of their peak value within 72 hours. The 12% that survive share measurable characteristics: liquidity above $100,000 by 6 hours, top-20 holder concentration under 35%, and active development team engagement verified on-chain.</p>
  <div class="acad-example">
    <strong>Phase Recognition in Practice</strong>
    A token is trending on social media. You check it and see: 4 hours old, $88,000 liquidity, V/L ratio 1.8×, Risk Score 79, no Sentinel alerts. This is Phase 2 — eligible for entry analysis. If the same token was 20 minutes old, you would skip it regardless of metrics.
  </div>
  <div class="acad-takeaway">
    <strong>Key Takeaway</strong>
    Target Phase 2 entries (1–6 hours old, survived sniper phase). Avoid Phase 1 entirely. Recognise Phase 3 euphoria as the signal to plan your exit, not your entry.
  </div>`; }

function lessonMD2() { return `
  <h3>What Healthy Volume Looks Like</h3>
  <p>Organic trading volume is characterised by two properties: consistency and proportion. Consistent volume means roughly similar levels across multiple hours without dramatic spikes. Proportional volume means the trading activity is reasonable relative to the liquidity available. Artificial volume breaks both rules.</p>
  <div class="acad-data-block">
    <div class="acad-data-block-title">Volume Pattern Classification</div>
    <div class="acad-data-row"><span>Consistent hourly distribution</span><span class="green">Organic — genuine trading interest</span></div>
    <div class="acad-data-row"><span>Single large spike, then flat</span><span class="red">Pump signature — early holders selling into retail</span></div>
    <div class="acad-data-row"><span>Many small equal transactions</span><span class="red">Wash trading — artificial inflation of volume metrics</span></div>
    <div class="acad-data-row"><span>Volume rising with holder count</span><span class="green">Distribution expanding — genuinely organic</span></div>
    <div class="acad-data-row"><span>Volume rising, holder count flat</span><span class="amber">Churning — same wallets trading between each other</span></div>
  </div>
  <h3>Reading the Hourly Volume Profile</h3>
  <p>The hourly volume distribution tells you when trading activity concentrates. An organic token shows volumes within 2–3× of each other across hours. A manipulated token shows one or two hours with 10–20× the volume of adjacent hours — these are the coordination windows when buy bots are active.</p>
  <div class="acad-example">
    <strong>Wash Trading Detection</strong>
    A token shows $420,000 24-hour volume against $18,000 liquidity (V/L ratio: 23×). This is physically implausible as organic activity — a 23× ratio means the entire liquidity pool turned over 23 times in a day. Scan2Moon's scanner flags this as likely wash trading, and Sentinel will typically show a WARNING for artificial volume.
  </div>
  <div class="acad-sentinel-callout">
    <div class="acad-sentinel-callout-icon">◈</div>
    <div><strong>AI Sentinel — Wash Trading Detection</strong>
    Sentinel identifies wash trading by tracking wallet-to-wallet transaction loops. When the same token moves through a chain of 4+ wallets and returns to within 2 hops of the origin within 30 minutes, it flags the volume as non-organic. This removes inflated volume from the V/L calculation, giving you a corrected ratio.</div>
  </div>
  <div class="acad-takeaway">
    <strong>Key Takeaway</strong>
    Volume above 5× liquidity in 24 hours is suspicious. Single-spike volume profiles are sell signals, not buy signals. Check whether Sentinel has corrected the V/L ratio for wash trading.
  </div>`; }

function lessonMD3() { return `
  <h3>Five On-Chain Signals That Precede 80% of Rug Pulls</h3>
  <p>Rug pulls are not random events. Post-mortem analysis of 1,400+ confirmed Solana rug pulls identifies five on-chain signals that appeared in the 2–24 hours preceding collapse in over 80% of cases. Learning to recognise these patterns gives you a structural advantage over traders reacting only to price.</p>
  <div class="acad-data-block">
    <div class="acad-data-block-title">Pre-Rug Signal Frequency (1,400+ Documented Cases)</div>
    <div class="acad-data-row"><span>Dev wallet transfers out</span><span class="red">Present in 91% of cases</span></div>
    <div class="acad-data-row"><span>LP concentration in 1–2 wallets</span><span class="red">Present in 83% of cases</span></div>
    <div class="acad-data-row"><span>Sell/buy ratio &gt; 2:1 for 2+ hours</span><span class="red">Present in 77% of cases</span></div>
    <div class="acad-data-row"><span>Top-5 holders reducing positions</span><span class="amber">Present in 74% of cases</span></div>
    <div class="acad-data-row"><span>Social volume spike (coordinated)</span><span class="amber">Present in 68% of cases</span></div>
  </div>
  <h3>Soft Rug vs. Hard Rug</h3>
  <p><strong style="color:#cffff4;">Hard rug:</strong> Developer removes liquidity entirely in a single transaction, rendering the token worthless and untradeable immediately. Detectable beforehand only through LP concentration monitoring — if a single wallet controls 80%+ of LP, a hard rug is possible at any moment.</p>
  <p><strong style="color:#cffff4;">Soft rug:</strong> Developer and insiders gradually sell large holdings over hours or days, slowly depressing price. Harder to detect but more common. Characterised by the sell/buy ratio signal and top-holder wallet monitoring.</p>
  <div class="acad-sentinel-callout">
    <div class="acad-sentinel-callout-icon">◈</div>
    <div><strong>AI Sentinel — LP Withdrawal Monitoring</strong>
    Sentinel monitors LP positions in real time. When a wallet holding more than 15% of LP initiates a withdrawal transaction, Sentinel issues a CRITICAL alert within seconds — typically 5–30 seconds before the price impact is visible on the chart. This window is sufficient to exit if you act immediately.</div>
  </div>
  <div class="acad-warning">
    <strong>One Signal Is Enough to Reduce Exposure</strong>
    Any single pre-rug signal is sufficient justification to reduce your position by 50% or more. Waiting for multiple confirmations increases your exit precision theoretically but often costs you the exit opportunity in practice.
  </div>
  <div class="acad-takeaway">
    <strong>Key Takeaway</strong>
    Monitor dev wallet activity and LP concentration throughout a position. Sentinel handles this automatically. One pre-rug signal = reduce. Sentinel CRITICAL = exit.
  </div>`; }

function lessonMD4() { return `
  <h3>Why Most Traders Have No Edge</h3>
  <p>An "edge" in trading is a systematic advantage that produces positive expected value over a large number of trades. Most retail traders lack a measurable edge because they make decisions based on emotion, social media, and recency bias rather than on consistent, objective criteria. Building an edge requires data — specifically, your own trade data.</p>
  <h3>Keeping a Trading Journal — What to Record</h3>
  <div class="acad-data-block">
    <div class="acad-data-block-title">Minimum Journal Entry Fields</div>
    <div class="acad-data-row"><span>Token name + contract</span><span>For post-mortem analysis</span></div>
    <div class="acad-data-row"><span>Entry price + time</span><span>Timing pattern analysis</span></div>
    <div class="acad-data-row"><span>Risk Score at entry</span><span>Identify optimal score thresholds</span></div>
    <div class="acad-data-row"><span>Sentinel status at entry</span><span>Measure alert predictive accuracy</span></div>
    <div class="acad-data-row"><span>Checklist items passed</span><span>Identify which rules you skipped</span></div>
    <div class="acad-data-row"><span>Exit price + reason</span><span>Pattern recognition for future exits</span></div>
    <div class="acad-data-row"><span>Outcome + lessons</span><span>Forces systematic reflection</span></div>
  </div>
  <h3>Win Rate Is Not Profitability</h3>
  <p>A 40% win rate can generate consistent profit if the average winning trade is 2.5× larger than the average losing trade. This is the concept of expected value. With strict position sizing (2% per trade), a 40% win rate and 2:1 reward/risk ratio produces positive expected value of +0.2% per trade on average — which compounds meaningfully over hundreds of trades.</p>
  <div class="acad-example">
    <strong>Expected Value Calculation</strong>
    Win rate: 40%. Average win: +60% of position. Average loss: –25% of position (with stop-loss). EV per trade: (0.40 × 0.60) + (0.60 × –0.25) = 0.24 – 0.15 = +0.09 or +9% expected return per trade, per dollar risked. Applied to 100 trades at 2% risk per trade — this compounds to a meaningful portfolio gain.
  </div>
  <div class="acad-sentinel-callout">
    <div class="acad-sentinel-callout-icon">◈</div>
    <div><strong>The Scan2Moon Safe Ape Simulator</strong>
    Practice all strategies risk-free in the Safe Ape Simulator. It tracks your win rate, P/L, and average trade size across simulated positions — giving you real data to analyse your edge before putting capital at risk.</div>
  </div>
  <div class="acad-takeaway">
    <strong>Key Takeaway</strong>
    Keep a journal. Calculate your personal win rate and reward/risk ratio. A consistent process applied to enough trades produces measurable, improvable results. The goal is not to be right — it is to have positive expected value.
  </div>`; }

/* ═══════════════════════════════════════════════════════
   GLOSSARY
═══════════════════════════════════════════════════════ */

const GLOSSARY = [
  { term: "AI Sentinel",            def: "Scan2Moon's real-time on-chain monitoring engine. Runs continuously, analysing wallet activity, transaction patterns, and liquidity movements to detect threats before they affect price." },
  { term: "Averaging Down",         def: "Buying more of an asset as its price falls to reduce average entry cost. In memecoins this is statistically poor — only 22% of averaging-down events on Solana result in a positive outcome." },
  { term: "Blacklist Function",     def: "A smart contract function allowing the developer to prevent specific wallets from selling. A critical red flag — if your wallet is blacklisted, your tokens become worthless." },
  { term: "Bundle Attack",          def: "Multiple buy transactions executed in rapid sequence, typically by bots, to artificially inflate on-chain price before a large coordinated sell at the inflated level." },
  { term: "Contract Flag",          def: "A specific function detected in a token's smart contract that grants the developer elevated control — such as the ability to mint tokens, pause trading, or blacklist wallets." },
  { term: "DEX (Decentralised Exchange)", def: "A peer-to-peer trading platform operating on-chain without a central authority. Solana memecoins primarily trade on DEXs like Raydium and Jupiter." },
  { term: "Expected Value (EV)",    def: "The average outcome of a trade over many repetitions. EV = (win rate × avg win) + (loss rate × avg loss). A positive EV means a profitable long-term edge even with a sub-50% win rate." },
  { term: "Hard Rug",               def: "A rug pull where the developer removes all liquidity in a single transaction, making the token immediately untradeable. Detectable beforehand via LP concentration monitoring." },
  { term: "House Money",            def: "Operating on realised profit only. Once your original investment is recovered through partial profit-taking, remaining holdings cost nothing — a decline to zero has no net capital impact." },
  { term: "Liquidity Pool (LP)",    def: "The reserve of tokens and SOL deposited to enable trading. Liquidity depth determines price impact — lower liquidity means higher volatility and more dangerous trades." },
  { term: "LP Concentration",       def: "The percentage of a token's liquidity pool controlled by a single wallet. High concentration means one actor can drain the pool, instantly making the token untradeable." },
  { term: "Memecoin Lifecycle",     def: "The four phases most Solana memecoins follow: Launch (0–1h, sniper-dominated), Discovery (1–6h, organic growth), Euphoria (6–24h, peak FOMO), Distribution (24h+, early holders exit)." },
  { term: "Moon Bag",               def: "A small speculative position (typically 0.5–1% of portfolio) held with full acceptance of possible total loss and no active management. Distinct from a real trading position requiring exit strategy." },
  { term: "Ownership Renounced",    def: "When a developer calls the renounce function, losing admin control over the contract. A positive signal — but not a guarantee. The contract may still contain harmful auto-executing logic." },
  { term: "Position Sizing",        def: "Determining how much capital to allocate per trade. The 2% rule limits any single position to 2% of total trading capital, ensuring survival through losing streaks." },
  { term: "Proxy / Upgradeable Contract", def: "A contract architecture that allows the underlying logic to be replaced after deployment. Classified as high risk — the developer can change the rules of the token at any time." },
  { term: "Risk Score",             def: "Scan2Moon's composite 0–100 score derived from 12 on-chain data points. Higher scores mean fewer automated red flags. Not a buy signal — use it as a filter, not a decision engine." },
  { term: "Rug Pull",               def: "An exit scam where developers abandon a project and drain funds. Can be a hard rug (instant LP removal) or soft rug (gradual insider selling that slowly depresses price)." },
  { term: "Sell Tax",               def: "A fee deducted from the seller's proceeds on every trade. A 10% sell tax requires the price to rise more than 10% before breaking even. Combined with slippage, break-even can exceed 20%." },
  { term: "Sniper Bot",             def: "An automated program that buys tokens in the same block as liquidity is added — within milliseconds of launch — accumulating large positions at near-zero cost, programmed to sell at a preset multiplier." },
  { term: "Soft Rug",               def: "Insiders gradually selling large holdings over hours or days, steadily depressing price without a single identifiable exit event. More common than hard rugs and harder to detect." },
  { term: "V/L Ratio",              def: "Volume-to-Liquidity ratio: 24-hour trading volume divided by total liquidity. A healthy ratio is 0.5×–3×. Ratios above 5× frequently indicate wash trading or an artificial pump." },
  { term: "Wallet Clustering",      def: "Multiple wallets funded from the same source acting in coordination — buying or selling the same token in related patterns. The primary detection target for AI Sentinel." },
  { term: "Wash Trading",           def: "Artificially inflating volume by cycling the same tokens between related wallets. Creates the appearance of organic activity. Sentinel corrects the V/L ratio by removing detected wash volume." },
];

function renderGlossary() {
  const el = document.getElementById("acadGlossary");
  if (!el) return;

  const sorted = [...GLOSSARY].sort((a, b) => a.term.localeCompare(b.term));

  el.innerHTML = `
    <div class="acad-glossary-wrap">
      <div class="acad-glossary-header" onclick="window.toggleGlossary()">
        <div class="acad-glossary-color-bar"></div>
        <div class="acad-glossary-icon">📖</div>
        <div class="acad-glossary-title-group">
          <div class="acad-glossary-title">Trading Glossary</div>
          <div class="acad-glossary-subtitle">${sorted.length} terms · Essential on-chain vocabulary</div>
        </div>
        <div class="acad-glossary-chevron">▼</div>
      </div>
      <div class="acad-glossary-body">
        ${sorted.map(item => `
          <div class="acad-glossary-item">
            <div class="acad-glossary-term">${esc(item.term)}</div>
            <div class="acad-glossary-def">${esc(item.def)}</div>
          </div>`).join('<div class="acad-glossary-divider"></div>')}
      </div>
    </div>`;
}

window.toggleGlossary = function() {
  const wrap = document.querySelector(".acad-glossary-wrap");
  if (wrap) wrap.classList.toggle("open");
};

/* ═══════════════════════════════════════════════════════
   RENDERING
═══════════════════════════════════════════════════════ */

function getTotalLessons() {
  return COURSES.reduce((s, c) => s + c.lessons.length, 0);
}
function getCompletedLessons() {
  const prog = getProgress();
  return COURSES.reduce((s, c) => s + c.lessons.filter(l => prog[l.id]).length, 0);
}
function getCourseCompleted(c) {
  const prog = getProgress();
  return c.lessons.every(l => prog[l.id]);
}
function getCourseProgress(c) {
  const prog = getProgress();
  return c.lessons.filter(l => prog[l.id]).length;
}
function getTotalXpEarned() {
  const prog = getProgress();
  return COURSES.reduce((s, c) =>
    s + c.lessons.filter(l => prog[l.id]).reduce((ls, l) => ls + l.xp, 0), 0);
}

function renderProgress() {
  const el = document.getElementById("acadProgress");
  if (!el) return;
  const done    = getCompletedLessons();
  const total   = getTotalLessons();
  const pct     = Math.round((done / total) * 100);
  const xp      = getTotalXpEarned();
  const courses  = COURSES.filter(c => getCourseCompleted(c)).length;

  el.innerHTML = `
    <div class="acad-progress-row">
      <div class="acad-prog-stat">
        <div class="acad-prog-val">${done}<span>/${total}</span></div>
        <div class="acad-prog-label">Lessons Done</div>
      </div>
      <div class="acad-prog-stat">
        <div class="acad-prog-val">${courses}<span>/${COURSES.length}</span></div>
        <div class="acad-prog-label">Courses</div>
      </div>
      <div class="acad-prog-stat">
        <div class="acad-prog-val">${xp}<span> XP</span></div>
        <div class="acad-prog-label">XP Earned</div>
      </div>
      <div class="acad-prog-stat">
        <div class="acad-prog-val">${pct}<span>%</span></div>
        <div class="acad-prog-label">Complete</div>
      </div>
    </div>
    <div class="acad-prog-bar-wrap">
      <div class="acad-prog-bar-fill" style="width:${pct}%"></div>
    </div>`;
}

function renderCourses(container) {
  const el = container || document.getElementById("acadCourses");
  if (!el) return;
  const prog = getProgress();

  el.innerHTML = COURSES.map((course, idx) => {
    const done    = getCourseProgress(course);
    const total   = course.lessons.length;
    const pct     = Math.round((done / total) * 100);
    const isDone  = done === total;

    /* Progressive unlock: Course N is locked if wallet connected + Course N-1 not complete */
    const prevCourse      = idx > 0 ? COURSES[idx - 1] : null;
    const isCourseLocked  = !!(wallet && prevCourse && !getCourseCompleted(prevCourse));

    const lessonsHtml = course.lessons.map((lesson, lIdx) => {
      const isQuiz      = lesson.type === "quiz";
      const isCompleted = !!prog[lesson.id];
      const isLocked    = isCourseLocked;

      /* Retry/Review action tag on completed items */
      const actionTag = (!isLocked && isCompleted)
        ? `<div class="acad-lesson-action-tag ${isQuiz ? 'retake' : 'review'}">${isQuiz ? 'Retake' : 'Review'}</div>`
        : '';

      return `
        <div class="acad-lesson-row ${isCompleted ? 'acad-lesson-done' : ''} ${isLocked ? 'acad-lesson-locked' : ''} ${isQuiz ? 'acad-lesson-quiz' : ''}"
          onclick="${isLocked ? '' : `window.openAcadLesson('${course.id}','${lesson.id}')`}">
          <div class="acad-lesson-status-icon">
            ${isCompleted ? '✓' : isLocked ? '🔒' : isQuiz ? '?' : lIdx + 1}
          </div>
          <div class="acad-lesson-info">
            <div class="acad-lesson-title">${esc(lesson.num)} — ${esc(lesson.title)}</div>
            <div class="acad-lesson-meta">${esc(lesson.duration)} · ${isQuiz ? `${lesson.questions.length} questions` : 'Lesson'}</div>
          </div>
          <div class="acad-lesson-xp" ${isLocked ? 'style="color:rgba(207,255,244,0.15);"' : ''}>+${lesson.xp} XP</div>
          ${actionTag}
        </div>`;
    }).join('<div class="acad-lesson-divider"></div>');

    /* Locked course: collapsed placeholder row */
    if (isCourseLocked) {
      return `
        <div class="acad-course-card locked" id="acad-course-${course.id}">
          <div class="acad-course-header" style="cursor:default;">
            <div class="acad-course-color-bar" style="background:rgba(207,255,244,0.08);"></div>
            <div class="acad-course-num" style="background:rgba(207,255,244,0.04);border-color:rgba(207,255,244,0.08);color:rgba(207,255,244,0.2);">${course.num}</div>
            <div class="acad-course-meta">
              <div class="acad-course-title" style="color:rgba(207,255,244,0.25);">${esc(course.title)}</div>
              <div class="acad-course-tags">
                <span class="acad-course-tag" style="color:rgba(207,255,244,0.2);border-color:rgba(207,255,244,0.06);">
                  🔒 Complete ${esc(prevCourse.title)} to unlock
                </span>
              </div>
            </div>
            <div class="acad-course-progress-wrap">
              <div class="acad-course-progress-txt" style="color:rgba(207,255,244,0.15);">Locked</div>
            </div>
          </div>
        </div>`;
    }

    return `
      <div class="acad-course-card ${idx === 0 ? 'open' : ''}" id="acad-course-${course.id}">
        <div class="acad-course-header" onclick="window.toggleCourse('${course.id}')">
          <div class="acad-course-color-bar" style="background:${course.color};"></div>
          <div class="acad-course-num" style="background:${course.bgColor};border-color:${course.borderColor};color:${course.color};">${course.num}</div>
          <div class="acad-course-meta">
            <div class="acad-course-title">${esc(course.title)}</div>
            <div class="acad-course-tags">
              <span class="acad-course-tag">${esc(course.difficulty)}</span>
              <span class="acad-course-tag">${esc(course.duration)}</span>
              <span class="acad-course-tag xp">+${course.xpReward} XP</span>
              <span class="acad-course-tag" style="border-color:${course.borderColor};color:${course.color};background:${course.bgColor};">
                ${esc(course.badge)}
              </span>
            </div>
          </div>
          <div class="acad-course-progress-wrap">
            <div class="acad-course-progress-txt">${done}/${total}</div>
            <div class="acad-course-mini-bar">
              <div class="acad-course-mini-bar-fill" style="width:${pct}%;background:${course.color};"></div>
            </div>
          </div>
          <div class="acad-course-chevron">▼</div>
        </div>
        <div class="acad-course-body">
          <div class="acad-lesson-list">${lessonsHtml}</div>
          <div class="acad-course-reward">
            <div class="acad-course-reward-icon">${isDone ? '🏅' : '🔒'}</div>
            <div class="acad-course-reward-info">
              <p class="acad-course-reward-title">${isDone ? `${esc(course.badge)} badge unlocked!` : `Complete all ${total} items to unlock`}</p>
              <p class="acad-course-reward-sub">${esc(course.badge)} badge · +${course.xpReward} XP completion bonus</p>
            </div>
            <div class="acad-course-reward-xp" style="color:${course.color};">+${course.xpReward}<small style="font-size:10px;font-weight:700;opacity:0.6;"> XP</small></div>
          </div>
        </div>
      </div>`;
  }).join("");
}

/* ── Toggle course accordion ── */
window.toggleCourse = function(courseId) {
  const card = document.getElementById(`acad-course-${courseId}`);
  if (card) card.classList.toggle("open");
};

/* ═══════════════════════════════════════════════════════
   LESSON MODAL
═══════════════════════════════════════════════════════ */

window.openAcadLesson = function(courseId, lessonId) {
  const course = COURSES.find(c => c.id === courseId);
  if (!course) return;
  const lesson = course.lessons.find(l => l.id === lessonId);
  if (!lesson) return;

  if (lesson.type === "quiz") {
    openQuizModal(course, lesson);
    return;
  }

  const isCompleted = isDone(lessonId);
  const container   = document.getElementById("acadModalContainer");

  container.innerHTML = `
    <div class="acad-modal-overlay" id="acadModalOverlay" onclick="window.closeAcadModal(event)">
      <div class="acad-modal">
        <div class="acad-modal-header">
          <button class="acad-modal-back" onclick="window.closeAcadModal(null,true)">←</button>
          <div class="acad-modal-heading">
            <div class="acad-modal-course-label">Course ${course.num} — ${esc(course.title)}</div>
            <div class="acad-modal-title">${esc(lesson.num)} — ${esc(lesson.title)}</div>
            <div class="acad-modal-tags">
              <span class="acad-modal-tag">${esc(lesson.duration)}</span>
              <span class="acad-modal-tag">+${lesson.xp} XP</span>
              ${isCompleted ? '<span class="acad-modal-tag" style="color:#2cffc9;border-color:rgba(44,255,201,0.35);">✓ Completed</span>' : ''}
            </div>
          </div>
        </div>
        <div class="acad-lesson-body">
          ${lesson.content()}
        </div>
        <div class="acad-lesson-footer">
          <div class="acad-xp-badge-modal">+${lesson.xp} XP</div>
          <button class="acad-complete-btn" id="acadCompleteBtn"
            onclick="window.completeLesson('${courseId}','${lessonId}')"
            ${isCompleted ? 'disabled' : ''}>
            ${isCompleted ? '✓ Already Completed' : 'Mark as Complete →'}
          </button>
        </div>
      </div>
    </div>`;
};

window.closeAcadModal = function(e, force) {
  if (force || (e && e.target.id === "acadModalOverlay")) {
    document.getElementById("acadModalContainer").innerHTML = "";
  }
};

/* ── Certificate Modal ── */
function showCertificate(course, totalXpEarned) {
  const container   = document.getElementById("acadModalContainer");
  const walletShort = wallet ? `${wallet.slice(0,6)}…${wallet.slice(-4)}` : "—";
  const date        = new Date().toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });
  const tweetText   = encodeURIComponent(
    `I just completed "${course.title}" on @Scan2Moon Academy and earned the "${course.badge}" badge! 🎓\n\nhttps://scan2moon.com/academy.html`
  );

  container.innerHTML = `
    <div class="acad-modal-overlay" id="acadCertOverlay" onclick="window.closeCertModal(event)">
      <div class="acad-modal acad-cert-modal">
        <button class="acad-modal-back acad-cert-back" onclick="window.closeCertModal(null,true)">←</button>
        <div class="acad-cert-content">
          <div class="acad-cert-emblem" style="color:${course.color};">🏅</div>
          <div class="acad-cert-issuer">SCAN2MOON ACADEMY</div>
          <div class="acad-cert-heading">Certificate of Completion</div>
          <div class="acad-cert-course-name" style="color:${course.color};border-color:${course.borderColor};">
            ${esc(course.title)}
          </div>
          <div class="acad-cert-divider" style="border-color:${course.borderColor};"></div>
          <div class="acad-cert-meta">
            <div class="acad-cert-meta-row">
              <span class="acad-cert-meta-label">Wallet</span>
              <span class="acad-cert-meta-val mono">${walletShort}</span>
            </div>
            <div class="acad-cert-meta-row">
              <span class="acad-cert-meta-label">Completed</span>
              <span class="acad-cert-meta-val">${date}</span>
            </div>
            <div class="acad-cert-meta-row">
              <span class="acad-cert-meta-label">XP Awarded</span>
              <span class="acad-cert-meta-val" style="color:#2cffc9;">+${totalXpEarned} XP</span>
            </div>
            <div class="acad-cert-meta-row">
              <span class="acad-cert-meta-label">Badge Unlocked</span>
              <span class="acad-cert-meta-val" style="color:${course.color};">${esc(course.badge)}</span>
            </div>
          </div>
          <div class="acad-cert-actions">
            <a href="https://twitter.com/intent/tweet?text=${tweetText}" target="_blank"
              class="acad-cert-share-btn">
              Share on X →
            </a>
            <button class="acad-cert-continue-btn" onclick="window.closeCertModal(null,true)">
              Continue →
            </button>
          </div>
        </div>
      </div>
    </div>`;
}

window.closeCertModal = function(e, force) {
  if (force || (e && e.target.id === "acadCertOverlay")) {
    document.getElementById("acadModalContainer").innerHTML = "";
  }
};

window.completeLesson = async function(courseId, lessonId) {
  const btn = document.getElementById("acadCompleteBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }

  if (!profile.academyProgress) profile.academyProgress = {};

  const course  = COURSES.find(c => c.id === courseId);
  const lesson  = course?.lessons.find(l => l.id === lessonId);

  /* Already done? Nothing to do. */
  if (profile.academyProgress[lessonId]) {
    document.getElementById("acadModalContainer").innerHTML = "";
    return;
  }

  /* Mark lesson done locally */
  profile.academyProgress[lessonId] = true;

  /* Award lesson XP locally */
  const lessonXp = lesson ? lesson.xp : 0;
  profile.academyXp = (profile.academyXp || 0) + lessonXp;
  if (lesson) showToast(`+${lessonXp} XP — ${lesson.title.slice(0,30)}…`);

  /* Check course completion AFTER marking lesson done */
  const courseComplete = course && getCourseCompleted(course);

  /* Award course completion bonus XP + badge locally */
  if (courseComplete) {
    profile.academyXp = (profile.academyXp || 0) + course.xpReward;
    if (course.badgeId) {
      if (!Array.isArray(profile.badges)) profile.badges = [];
      if (!profile.badges.includes(course.badgeId)) {
        profile.badges.push(course.badgeId);
      }
    }
  }

  /* Persist to server — total XP = lesson XP + (course bonus if just completed) */
  const totalXp = lessonXp + (courseComplete ? course.xpReward : 0);
  if (wallet) {
    try {
      await fetch(ACADEMY_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet,
          lessonId,
          courseId,
          xpEarned:  totalXp,
          badgeId:   courseComplete ? (course.badgeId || null) : null,
        }),
      });
    } catch (_) { /* save failed silently — local state is authoritative */ }
  }

  /* Close modal, re-render */
  document.getElementById("acadModalContainer").innerHTML = "";
  renderProgress();
  renderCourses();

  /* Show certificate on course completion */
  if (courseComplete && course) {
    setTimeout(() => showCertificate(course, totalXp), 350);
  }
};

/* ═══════════════════════════════════════════════════════
   QUIZ MODAL
═══════════════════════════════════════════════════════ */

let quizSession = null;

function renderQuizQuestion() {
  const s = quizSession;
  if (!s) return;
  if (s.current >= s.questions.length) { renderQuizResult(); return; }

  const q      = s.questions[s.current];
  const pct    = Math.round((s.current / s.questions.length) * 100);
  const letters = ["A","B","C","D"];
  const container = document.getElementById("acadModalContainer");

  container.innerHTML = `
    <div class="acad-modal-overlay" id="acadModalOverlay" onclick="window.closeAcadModal(event)">
      <div class="acad-modal">
        <div class="acad-modal-header">
          <button class="acad-modal-back" onclick="window.closeAcadModal(null,true)">←</button>
          <div class="acad-modal-heading">
            <div class="acad-modal-course-label">Course ${s.course.num} — ${esc(s.course.title)}</div>
            <div class="acad-modal-title">${esc(s.lesson.num)} — ${esc(s.lesson.title)}</div>
            <div class="acad-modal-tags">
              <span class="acad-modal-tag purple">${s.questions.length} Questions</span>
              <span class="acad-modal-tag purple">+${s.lesson.xp} XP</span>
            </div>
          </div>
        </div>
        <div class="acad-quiz-body">
          <div class="acad-quiz-progress-row">
            <div class="acad-quiz-progress-bar-bg">
              <div class="acad-quiz-progress-bar-fill" style="width:${pct}%;"></div>
            </div>
            <div class="acad-quiz-progress-label">Question ${s.current + 1} of ${s.questions.length}</div>
          </div>
          <div class="acad-quiz-question">${esc(q.q)}</div>
          <div class="acad-quiz-answers" id="quizAnswers">
            ${q.opts.map((opt, i) => `
              <button class="acad-quiz-answer" onclick="window.submitQuizAnswer(${i})">
                <span class="acad-answer-letter">${letters[i]}</span>
                ${esc(opt)}
              </button>`).join("")}
          </div>
          <div class="acad-quiz-explanation" id="quizExplanation">${esc(q.explanation)}</div>
          <div class="acad-quiz-nav">
            <button class="acad-quiz-next-btn" id="quizNextBtn" disabled
              onclick="window.quizNext()">
              ${s.current + 1 < s.questions.length ? 'Next Question →' : 'See Results →'}
            </button>
          </div>
        </div>
      </div>
    </div>`;
}

window.submitQuizAnswer = function(answerIdx) {
  const s = quizSession;
  if (!s || s.answered) return;
  s.answered = true;

  const q       = s.questions[s.current];
  const correct = q.correct === answerIdx;
  if (correct) s.score++;

  /* Style buttons */
  const btns = document.querySelectorAll(".acad-quiz-answer");
  btns.forEach((btn, i) => {
    btn.disabled = true;
    if (i === q.correct)  btn.classList.add("correct");
    if (i === answerIdx && !correct) btn.classList.add("wrong");
  });

  /* Show explanation */
  const exp = document.getElementById("quizExplanation");
  if (exp) exp.classList.add("visible");

  /* Enable next */
  const nextBtn = document.getElementById("quizNextBtn");
  if (nextBtn) nextBtn.disabled = false;
};

window.quizNext = function() {
  const s = quizSession;
  if (!s) return;
  s.current++;
  s.answered = false;
  renderQuizQuestion();
};

window.retryQuiz = function() {
  const s = quizSession;
  if (!s) return;
  openQuizModal(s.course, s.lesson);
};

function openQuizModal(course, lesson) {
  quizSession = {
    course, lesson,
    questions: lesson.questions,
    current:   0,
    score:     0,
    answered:  false,
  };
  renderQuizQuestion();
}

function renderQuizResult() {
  const s       = quizSession;
  const pct     = Math.round((s.score / s.questions.length) * 100);
  const passed  = pct >= 60;
  const xpBase  = s.lesson.xp;
  const xpBonus = pct === 100 ? Math.round(xpBase * 0.5) : 0;
  const totalXp = passed ? xpBase + xpBonus : Math.round(xpBase * 0.25);
  const msg     = pct === 100
    ? "Perfect score. You have mastered this material — bonus XP awarded."
    : pct >= 80
    ? "Strong result. You have a solid grasp of the core concepts."
    : pct >= 60
    ? "Passed. Review the lessons on the questions you missed to reinforce understanding."
    : "Below passing threshold. Revisit the course material and try again.";

  const container = document.getElementById("acadModalContainer");
  container.innerHTML = `
    <div class="acad-modal-overlay" id="acadModalOverlay" onclick="window.closeAcadModal(event)">
      <div class="acad-modal">
        <div class="acad-modal-header">
          <button class="acad-modal-back" onclick="window.closeAcadModal(null,true)">←</button>
          <div class="acad-modal-heading">
            <div class="acad-modal-course-label">Course ${s.course.num} — ${esc(s.course.title)}</div>
            <div class="acad-modal-title">Module ${s.course.num} Quiz — Results</div>
          </div>
        </div>
        <div class="acad-quiz-body">
          <div class="acad-quiz-result">
            <div class="acad-result-score" style="color:${passed?'#2cffc9':'#ffb432'}">
              ${pct}<span>%</span>
            </div>
            <div class="acad-result-label">${passed ? 'PASSED' : 'TRY AGAIN'}</div>
            <div class="acad-result-stats">
              <div class="acad-result-stat">
                <div class="acad-result-stat-val">${s.score}/${s.questions.length}</div>
                <div class="acad-result-stat-lbl">Correct</div>
              </div>
              <div class="acad-result-stat">
                <div class="acad-result-stat-val" style="color:${passed?'#2cffc9':'#ffb432'}">+${totalXp}</div>
                <div class="acad-result-stat-lbl">XP Earned</div>
              </div>
              ${xpBonus > 0 ? `<div class="acad-result-stat">
                <div class="acad-result-stat-val" style="color:#c084fc;">+${xpBonus}</div>
                <div class="acad-result-stat-lbl">Perfect Bonus</div>
              </div>` : ''}
            </div>
            <p class="acad-result-msg">${msg}</p>
            <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
              ${passed ? `<button class="acad-complete-btn" style="max-width:220px;"
                onclick="window.completeLesson('${s.course.id}','${s.lesson.id}')">
                Claim +${totalXp} XP →
              </button>` : ''}
              <button onclick="window.retryQuiz()"
                style="padding:12px 20px;background:rgba(207,255,244,0.06);border:1px solid rgba(207,255,244,0.15);border-radius:12px;color:rgba(207,255,244,0.7);font-size:13px;font-weight:800;cursor:pointer;font-family:inherit;">
                Retry Quiz
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

/* ═══════════════════════════════════════════════════════
   AUTH + DATA
═══════════════════════════════════════════════════════ */

async function connectWallet() {
  const btn = document.getElementById("acadConnectBtn");
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
    loadAcademy();
  } catch {
    showToast("❌ Connection cancelled.");
    if (btn) btn.textContent = "🔗 Connect Phantom Wallet";
  }
}

async function loadAcademy() {
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
    } catch {
      if (attempt === 3) {
        data = { academyProgress: {}, academyXp: 0, accountName: "Demo Mode" };
      }
    }
  }
  profile = data;
  showAcademy();
}

function showAcademy() {
  document.getElementById("acadGate").style.display    = "none";
  document.getElementById("acadApp").style.display     = "block";
  renderProgress();
  renderCourses();
  renderGlossary();
}

/* ═══════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════ */

document.addEventListener("DOMContentLoaded", () => {
  renderNav();
  applyTranslations();

  /* Always render browse mode in gate so courses are visible without wallet */
  profile = { academyProgress: {}, academyXp: 0 };
  const browseEl = document.getElementById("acadBrowseMode");
  if (browseEl) {
    browseEl.innerHTML = `
      <div class="acad-progress-row" style="opacity:0.5;">
        <div class="acad-prog-stat"><div class="acad-prog-val">0<span>/${getTotalLessons()}</span></div><div class="acad-prog-label">Lessons</div></div>
        <div class="acad-prog-stat"><div class="acad-prog-val">0<span>/${COURSES.length}</span></div><div class="acad-prog-label">Courses</div></div>
        <div class="acad-prog-stat"><div class="acad-prog-val">0<span> XP</span></div><div class="acad-prog-label">XP Earned</div></div>
        <div class="acad-prog-stat"><div class="acad-prog-val">0<span>%</span></div><div class="acad-prog-label">Complete</div></div>
      </div>
      <div class="acad-prog-bar-wrap"><div class="acad-prog-bar-fill" style="width:0%"></div></div>
      <div class="acad-courses" id="acadBrowseCourses" style="margin-top:0;"></div>
      <div id="acadBrowseGlossary"></div>`;
    renderCourses(document.getElementById("acadBrowseCourses"));
    /* Render glossary in browse mode too */
    const browseGlossaryEl = document.getElementById("acadBrowseGlossary");
    if (browseGlossaryEl) {
      browseGlossaryEl.id = "acadGlossary";
      renderGlossary();
    }
  }

  const saved = localStorage.getItem("sa_wallet");
  if (saved && isValidSolana(saved)) {
    wallet = saved;
    loadAcademy();
  }

  document.getElementById("acadConnectBtn")?.addEventListener("click", connectWallet);
});
