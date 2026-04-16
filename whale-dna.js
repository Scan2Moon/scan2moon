/* ============================================================
   Scan2Moon – whale-dna.js  (V2.0)
   Whale DNA: Wallet behavior profiling + Copy-Trade Risk Score
   ============================================================ */

import { renderNav } from "./nav.js";
import { applyTranslations } from "./i18n.js";
import { callRpc }   from "./rpc.js";
import "./community.js";

const DEX_API = "https://api.dexscreener.com/latest/dex/tokens/";

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener("DOMContentLoaded", () => {
  renderNav();
  applyTranslations();
  document.getElementById("dnaScanBtn").addEventListener("click", startScan);
  document.getElementById("walletInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") startScan();
  });

  // Auto-prefill + auto-scan when arriving from Entry Radar whale buy click
  try {
    const prefill = localStorage.getItem("s2m_prefill_whale");
    if (prefill) {
      const input = document.getElementById("walletInput");
      if (input) {
        input.value = prefill;
        localStorage.removeItem("s2m_prefill_whale");
        // Only auto-scan if it's a real valid Solana wallet address
        // Estimated wallets from radar are derived from mint strings — not real wallets
        if (isValidSolanaWallet(prefill)) {
          setTimeout(() => startScan(), 400);
        }
        // If not valid, input is still prefilled so user sees what was clicked
        // but won't get a confusing error — they can paste a real wallet instead
      }
    }
  } catch { }
});

/* ============================================================
   VALIDATION
   ============================================================ */
function isValidSolanaWallet(addr) {
  if (!addr || addr.length < 32 || addr.length > 44) return false;
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
}

/* ============================================================
   MAIN SCAN ENTRY POINT
   ============================================================ */
async function startScan() {
  const wallet = document.getElementById("walletInput").value.trim();

  if (!wallet) { alert("Please paste a Solana wallet address."); return; }
  if (!isValidSolanaWallet(wallet)) {
    alert("Invalid Solana wallet address. Please check for typos.");
    return;
  }

  const btn = document.getElementById("dnaScanBtn");
  btn.disabled = true;
  document.getElementById("dnaBtnText").textContent = "⏳ Analyzing…";

  document.getElementById("dnaProfilePanel").style.display  = "block";
  document.getElementById("dnaStatsRow").style.display      = "grid";
  document.getElementById("dnaHoldingsPanel").style.display = "block";

  showLoading("Fetching wallet token accounts…", 5);

  try {
    // STEP 1: Get ALL token accounts
    const allAccounts = await fetchAllTokenAccounts(wallet);

    const meaningful = allAccounts.filter(t => t.uiAmount >= 1);

    if (!meaningful.length) {
      showEmpty("No significant token holdings found.", "This wallet has no SPL tokens with balance ≥ 1.");
      return;
    }

    updateProgress(18, `Found ${meaningful.length} holdings. Enriching with market data…`);

    const dustBal = allAccounts.filter(t => t.uiAmount < 1).slice(0, 80);

    // STEP 2: Enrich active tokens
    const enriched = await enrichTokens(meaningful, 18, 70);
    const withData = enriched.filter(t => t.priceUsd !== null && t.priceUsd > 0);
    const noData   = enriched.filter(t => t.priceUsd === null || t.priceUsd === 0);

    updateProgress(72, "Detecting rugged & dead tokens…");

    // STEP 3: Enrich dust/zero-balance tokens for rug detection
    const enrichedDust = dustBal.length > 0
      ? await enrichTokens(dustBal, 72, 85)
      : [];

    updateProgress(88, "Calculating DNA profile…");

    // STEP 4: Per-token stats
    const processed = withData.map(calcTokenStats);

    updateProgress(94, "Profiling trader archetype…");

    // STEP 5: Build full DNA
    const dna = buildDnaProfile(processed, allAccounts.length, wallet, enrichedDust, noData);

    updateProgress(100, "DNA decoded!");

    renderDnaProfile(dna, wallet);
    renderPerformanceStats(dna);
    renderCopyScore(dna);
    renderHoldings(processed);

  } catch (err) {
    console.error("Whale DNA scan failed:", err);
    showError("Scan failed: " + (err.message || "Unknown error. Check console."));
  } finally {
    btn.disabled = false;
    document.getElementById("dnaBtnText").textContent = "🧬 Analyze Wallet";
  }
}

/* ============================================================
   FETCH ALL TOKEN ACCOUNTS
   ============================================================ */
async function fetchAllTokenAccounts(wallet) {
  /* Query both token programs in parallel — same fix as portfolio scanner */
  const [respV1, respV2] = await Promise.all([
    callRpc("getTokenAccountsByOwner", [
      wallet,
      { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
      { encoding: "jsonParsed", commitment: "confirmed" }
    ]).catch(() => null),
    callRpc("getTokenAccountsByOwner", [
      wallet,
      { programId: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" },
      { encoding: "jsonParsed", commitment: "confirmed" }
    ]).catch(() => null),
  ]);

  const allAccounts = [
    ...(respV1?.value ?? []),
    ...(respV2?.value ?? []),
  ];

  return allAccounts
    .map(acc => {
      const info = acc.account?.data?.parsed?.info;
      if (!info) return null;
      return {
        mint:      info.mint,
        decimals:  info.tokenAmount?.decimals ?? 0,
        uiAmount:  Number(info.tokenAmount?.uiAmount ?? 0),
        rawAmount: info.tokenAmount?.amount ?? "0",
      };
    })
    .filter(Boolean);
}

/* ============================================================
   ENRICH WITH DEXSCREENER
   ============================================================ */
async function enrichTokens(accounts, progressStart = 20, progressEnd = 75) {
  const BATCH = 25;
  const results = [];

  for (let i = 0; i < accounts.length; i += BATCH) {
    const slice = accounts.slice(i, i + BATCH);
    const mints = slice.map(a => a.mint).join(",");
    const pct   = progressStart + Math.round(((i + BATCH) / accounts.length) * (progressEnd - progressStart));
    updateProgress(Math.min(pct, progressEnd), `Enriching tokens ${i + 1}–${Math.min(i + BATCH, accounts.length)} of ${accounts.length}…`);

    try {
      const res   = await fetch(`${DEX_API}${mints}`);
      const data  = await res.json();
      const pairs = data.pairs || [];

      for (const acc of slice) {
        const pair = pairs
          .filter(p => p.baseToken?.address === acc.mint && p.chainId === "solana")
          .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0] || null;

        results.push({
          ...acc,
          pair,
          name:     pair?.baseToken?.name   ?? "Unknown Token",
          symbol:   pair?.baseToken?.symbol ?? acc.mint.slice(0, 6) + "…",
          logo:     pair?.info?.imageUrl    ?? null,
          priceUsd: pair ? parseFloat(pair.priceUsd || "0") : null,
          mcap:     pair?.fdv ?? pair?.marketCap ?? 0,
          liq:      pair?.liquidity?.usd ?? 0,
          pc1h:     pair?.priceChange?.h1  ?? null,
          pc24h:    pair?.priceChange?.h24 ?? null,
          vol24h:   pair?.volume?.h24 ?? 0,
          buys24h:  pair?.txns?.h24?.buys  ?? 0,
          sells24h: pair?.txns?.h24?.sells ?? 0,
          pairAddr: pair?.pairAddress ?? null,
          age:      pair?.pairCreatedAt ? Math.floor((Date.now() - pair.pairCreatedAt) / 86400000) : null,
        });
      }
    } catch (err) {
      console.warn("DexScreener batch failed:", err);
      for (const acc of slice) {
        results.push({ ...acc, pair: null, name: "Unknown", symbol: "???", logo: null, priceUsd: null });
      }
    }
  }
  return results;
}

/* ============================================================
   PER-TOKEN RISK SCORE
   ============================================================ */
function calcTokenStats(t) {
  const currentValueUsd   = (t.priceUsd ?? 0) * t.uiAmount;
  const pc24h             = t.pc24h ?? 0;
  const valueChange24hUsd = currentValueUsd * (pc24h / 100);

  let score = 65;
  if (t.liq < 5000)          score -= 30;
  else if (t.liq < 20000)    score -= 15;
  else if (t.liq >= 100000)  score += 10;
  if (t.mcap > 0 && t.mcap < 100000) score -= 20;
  if ((t.vol24h ?? 0) === 0) score -= 10;
  score = Math.max(0, Math.min(100, score));

  const riskLabel = score >= 65 ? "LOW RISK" : score >= 40 ? "MODERATE" : "HIGH RISK";
  const riskClass = score >= 65 ? "risk-low"  : score >= 40 ? "risk-mod" : "risk-high";

  return { ...t, currentValueUsd, valueChange24hUsd, score, riskLabel, riskClass };
}

/* ============================================================
   RUG / DEAD TOKEN CLASSIFICATION
   ============================================================ */
function classifyForRugs(enrichedTokens) {
  let rugCount    = 0;
  let deadCount   = 0;
  let zombieCount = 0;

  for (const t of enrichedTokens) {
    if (!t.pair) {
      deadCount++;
    } else {
      const price = parseFloat(t.pair.priceUsd || "0");
      const liq   = t.liq   ?? 0;
      const vol   = t.vol24h ?? 0;
      if (price < 0.000001 && liq < 100) {
        rugCount++;
      } else if (vol === 0 && liq === 0) {
        zombieCount++;
      }
    }
  }
  return { rugCount, deadCount, zombieCount };
}

/* ============================================================
   BUILD DNA PROFILE
   ============================================================ */
function buildDnaProfile(tokens, totalAccounts, wallet, enrichedDust, noDataTokens) {
  const totalValueUsd = tokens.reduce((s, t) => s + t.currentValueUsd, 0);

  const positiveToday = tokens.filter(t => (t.pc24h ?? 0) > 0).length;
  const winRate = tokens.length ? Math.round((positiveToday / tokens.length) * 100) : 0;

  const biggestBag = tokens.length
    ? tokens.reduce((best, t) => t.currentValueUsd > best.currentValueUsd ? t : best, tokens[0])
    : null;
  const worstBag = tokens.filter(t => (t.pc24h ?? 0) < 0).length
    ? tokens.filter(t => (t.pc24h ?? 0) < 0)
             .reduce((w, t) => (t.pc24h ?? 0) < (w.pc24h ?? 0) ? t : w)
    : null;

  const concentrationPct = (totalValueUsd > 0 && biggestBag)
    ? Math.round((biggestBag.currentValueUsd / totalValueUsd) * 100)
    : 0;

  const avgPosition    = tokens.length ? totalValueUsd / tokens.length : 0;
  const highRiskCount  = tokens.filter(t => t.score < 40).length;
  const highRiskRatio  = tokens.length ? highRiskCount / tokens.length : 0;
  const newTokens      = tokens.filter(t => t.age !== null && t.age < 30).length;
  const newTokenRatio  = tokens.length ? newTokens / tokens.length : 0;
  const lowLiqCount    = tokens.filter(t => t.liq < 20000).length;

  const tokensWithLiq  = tokens.filter(t => t.liq > 0);
  const avgLiquidity   = tokensWithLiq.length
    ? tokensWithLiq.reduce((s, t) => s + t.liq, 0) / tokensWithLiq.length
    : 0;

  const dustRugs   = classifyForRugs(enrichedDust);
  const noDataRugs = classifyForRugs(noDataTokens || []);

  const totalRugged = dustRugs.rugCount  + dustRugs.zombieCount
                    + noDataRugs.rugCount + noDataRugs.zombieCount
                    + noDataRugs.deadCount;

  const totalDead    = dustRugs.deadCount;
  const deadBagsHeld = tokens.filter(t =>
    t.currentValueUsd < 0.50 && t.score < 30 && (t.liq ?? 0) < 500
  ).length;

  const archetype = detectArchetype({
    winRate, highRiskRatio, newTokenRatio, totalAccounts,
    totalValueUsd, avgPosition, lowLiqCount, tokens,
  });

  const copyScore = calcCopyScore({
    winRate, highRiskRatio, newTokenRatio, totalAccounts,
    totalValueUsd, avgPosition, archetype, tokens,
    rugCount: totalRugged,
  });

  const tags = buildTags({
    winRate, highRiskRatio, newTokenRatio, totalValueUsd,
    avgPosition, tokens, totalRugged,
  });

  return {
    wallet, totalValueUsd, totalAccounts,
    tokenCount:     tokens.length,
    noDataCount:    (noDataTokens || []).length,
    winRate, biggestBag, worstBag, concentrationPct,
    avgPosition, highRiskRatio, highRiskCount,
    newTokenRatio, newTokens, lowLiqCount, avgLiquidity,
    rugCount: totalRugged, deadCount: totalDead, deadBagsHeld,
    archetype, copyScore, tags,
  };
}

/* ──────────────────────────── */
/*  ARCHETYPE DETECTION         */
/* ──────────────────────────── */
function detectArchetype({ winRate, highRiskRatio, newTokenRatio, totalAccounts, totalValueUsd, avgPosition, lowLiqCount, tokens }) {
  if (totalAccounts > 80 && avgPosition < 5)
    return { id:"bot",         emoji:"🤖", name:"BOT / SNIPER",  color:"#c07aff",
      desc:"Highly automated activity. Dozens of micro-positions. Likely a sniper bot or automated trading script." };
  if (totalValueUsd > 100000)
    return { id:"whale",       emoji:"🐋", name:"WHALE",          color:"#2cffc9",
      desc:"Large-capital wallet. Moves can shift prices. High impact on token momentum when they buy or sell." };
  if (highRiskRatio > 0.6 && newTokenRatio > 0.5)
    return { id:"degen",       emoji:"🎰", name:"DEGEN",           color:"#ff6b6b",
      desc:"High-risk appetite. Loves new and micro-cap tokens. Chases early pumps. High reward, high loss potential." };
  if (newTokenRatio > 0.6 && avgPosition < 100)
    return { id:"sniper",      emoji:"🎯", name:"SNIPER",          color:"#ffd166",
      desc:"Early-entry specialist. Targets newly launched tokens for quick flips. Timing-focused, fast in and out." };
  if (winRate < 30 && tokens.length > 5 && totalValueUsd > 500)
    return { id:"diamond",     emoji:"💎", name:"DIAMOND HANDS",  color:"#82b4ff",
      desc:"Holds through red days without panic selling. Long-term conviction holder. Patience is the strategy." };
  /* SMART MONEY checked before FLIPPER — higher win rate + low risk = more specific match */
  if (winRate > 65 && highRiskRatio < 0.25)
    return { id:"smart",       emoji:"🧠", name:"SMART MONEY",    color:"#2cffc9",
      desc:"Consistent winner. Prefers established tokens with good liquidity. Calculated and disciplined strategy." };
  if (winRate > 55 && tokens.length > 10)
    return { id:"flipper",     emoji:"🔄", name:"FLIPPER",         color:"#2cffc9",
      desc:"Active trader rotating between positions. Good win rate across many tokens. Momentum-driven style." };
  return   { id:"accumulator", emoji:"🟢", name:"ACCUMULATOR",    color:"#7fffe1",
    desc:"Steady portfolio builder. Spreads risk across multiple positions. Not chasing pumps — building slowly." };
}

/* ──────────────────────────── */
/*  COPY-TRADE SCORE            */
/* ──────────────────────────── */
function calcCopyScore({ winRate, highRiskRatio, newTokenRatio, totalAccounts, totalValueUsd, avgPosition, archetype, tokens, rugCount }) {
  let score = 50;
  score += Math.round((winRate / 100) * 25);
  score -= Math.round(highRiskRatio * 25);
  score += Math.round(Math.min(tokens.length / 20, 1) * 10);
  score -= Math.round(newTokenRatio * 15);
  if (totalValueUsd > 50000)      score += 10;
  else if (totalValueUsd > 10000) score += 5;
  else if (totalValueUsd < 100)   score -= 10;
  if (rugCount >= 10) score -= 15;
  else if (rugCount >= 5) score -= 8;
  else if (rugCount >= 2) score -= 3;
  if (archetype.id === "smart")       score += 12;
  if (archetype.id === "whale")       score += 8;
  if (archetype.id === "flipper")     score += 5;
  if (archetype.id === "degen")       score -= 15;
  if (archetype.id === "bot")         score -= 20;
  if (archetype.id === "sniper")      score -= 5;
  if (archetype.id === "diamond")     score += 3;
  if (archetype.id === "accumulator") score += 2;
  return Math.max(0, Math.min(100, Math.round(score)));
}

/* ──────────────────────────── */
/*  BEHAVIOR TAGS               */
/* ──────────────────────────── */
function buildTags({ winRate, highRiskRatio, newTokenRatio, totalValueUsd, avgPosition, tokens, totalRugged }) {
  const tags = [];
  if (winRate >= 65)           tags.push({ text:"✅ High Win Rate",        cls:"dna-tag-green"  });
  if (winRate < 35)            tags.push({ text:"📉 Low Win Rate",         cls:"dna-tag-red"    });
  if (highRiskRatio < 0.2)     tags.push({ text:"🛡️ Risk Conscious",       cls:"dna-tag-green"  });
  if (highRiskRatio > 0.6)     tags.push({ text:"🎰 High Risk Tolerance",  cls:"dna-tag-red"    });
  if (newTokenRatio > 0.5)     tags.push({ text:"🚀 New Token Hunter",     cls:"dna-tag-yellow" });
  if (newTokenRatio < 0.15)    tags.push({ text:"🏛️ Established Tokens",   cls:"dna-tag-blue"   });
  if (totalValueUsd > 50000)   tags.push({ text:"🐋 Large Portfolio",      cls:"dna-tag-blue"   });
  if (totalValueUsd < 500)     tags.push({ text:"🌱 Small Portfolio",      cls:"dna-tag-yellow" });
  if (avgPosition < 10)        tags.push({ text:"⚡ Micro-Position Style", cls:"dna-tag-purple" });
  if (avgPosition > 5000)      tags.push({ text:"💰 Large Position Size",  cls:"dna-tag-green"  });
  if (tokens.length > 30)      tags.push({ text:"📂 Highly Diversified",   cls:"dna-tag-blue"   });
  if (tokens.length <= 5)      tags.push({ text:"🎯 Concentrated Bets",    cls:"dna-tag-yellow" });
  if (totalRugged >= 5)        tags.push({ text:"🪦 Rug Survivor",         cls:"dna-tag-red"    });
  if (totalRugged === 0)       tags.push({ text:"🧹 Clean History",        cls:"dna-tag-green"  });
  return tags;
}

/* ============================================================
   RENDER DNA PROFILE CARD
   ============================================================ */
function renderDnaProfile(dna, wallet) {
  const el    = document.getElementById("dnaProfileBody");
  const short = wallet.slice(0, 6) + "…" + wallet.slice(-6);
  const tagsHtml = dna.tags.map(t => `<span class="dna-tag ${t.cls}">${t.text}</span>`).join("");

  el.innerHTML = `
    <div class="dna-profile-card">

      <div class="dna-archetype-block" style="border-color:${dna.archetype.color}44;box-shadow:0 0 20px ${dna.archetype.color}18;">
        <span class="dna-archetype-emoji">${dna.archetype.emoji}</span>
        <div class="dna-archetype-name" style="color:${dna.archetype.color}">${dna.archetype.name}</div>
        <div class="dna-archetype-desc">${dna.archetype.desc}</div>
      </div>

      <div class="dna-profile-right">

        <div class="dna-wallet-strip">
          <span class="dna-wallet-addr">${short}</span>
          <button class="dna-copy-btn" onclick="navigator.clipboard.writeText('${wallet}').then(()=>{this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',1500)})">Copy</button>
          <a href="https://solscan.io/account/${wallet}" target="_blank" rel="noopener noreferrer"
             style="padding:4px 12px;font-size:11px;font-weight:700;background:rgba(44,255,201,0.08);border:1px solid rgba(44,255,201,0.25);border-radius:6px;color:#2cffc9;text-decoration:none;flex-shrink:0;">
            Solscan ↗
          </a>
        </div>

        <div class="dna-trait-grid">
          <div class="dna-trait-card">
            <div class="dna-trait-label">Total Value</div>
            <div class="dna-trait-value">${formatUsd(dna.totalValueUsd)}</div>
            <div class="dna-trait-sub">portfolio</div>
          </div>
          <div class="dna-trait-card">
            <div class="dna-trait-label">Tokens Held</div>
            <div class="dna-trait-value">${dna.tokenCount}</div>
            <div class="dna-trait-sub">with market data</div>
          </div>
          <div class="dna-trait-card">
            <div class="dna-trait-label">Win Rate 24H</div>
            <div class="dna-trait-value" style="color:${dna.winRate>=55?'#2cffc9':dna.winRate>=40?'#ffd166':'#ff4d4f'}">${dna.winRate}%</div>
            <div class="dna-trait-sub">tokens up today</div>
          </div>
          <div class="dna-trait-card">
            <div class="dna-trait-label">Avg Position</div>
            <div class="dna-trait-value">${formatUsd(dna.avgPosition)}</div>
            <div class="dna-trait-sub">per token</div>
          </div>
          <div class="dna-trait-card">
            <div class="dna-trait-label">High Risk %</div>
            <div class="dna-trait-value" style="color:${dna.highRiskRatio>0.5?'#ff4d4f':dna.highRiskRatio>0.25?'#ffd166':'#2cffc9'}">${Math.round(dna.highRiskRatio*100)}%</div>
            <div class="dna-trait-sub">of portfolio</div>
          </div>
          <div class="dna-trait-card">
            <div class="dna-trait-label">Rugged Tokens</div>
            <div class="dna-trait-value" style="color:${dna.rugCount>5?'#ff4d4f':dna.rugCount>0?'#ffd166':'#2cffc9'}">${dna.rugCount}</div>
            <div class="dna-trait-sub">detected in history</div>
          </div>
        </div>

        <div class="dna-tags-row">${tagsHtml}</div>

      </div>
    </div>
  `;
}

/* ============================================================
   RENDER PERFORMANCE STATS + WALLET BREAKDOWN
   ============================================================ */
function renderPerformanceStats(dna) {
  const el = document.getElementById("dnaStatsBody");

  const bigBagStr = dna.biggestBag
    ? `${dna.biggestBag.symbol} — ${formatUsd(dna.biggestBag.currentValueUsd)} (${dna.concentrationPct}% of portfolio)`
    : "N/A";
  const worstStr  = dna.worstBag
    ? `${dna.worstBag.symbol} (${(dna.worstBag.pc24h ?? 0).toFixed(1)}% today)`
    : "No losers today 🎉";

  const plHint    = dna.winRate >= 55 ? "dna-good" : dna.winRate >= 40 ? "dna-warn" : "dna-bad";
  const avgLiqStr = dna.avgLiquidity >= 1e6
    ? "$" + (dna.avgLiquidity / 1e6).toFixed(1) + "M"
    : dna.avgLiquidity >= 1000
    ? "$" + (dna.avgLiquidity / 1000).toFixed(1) + "K"
    : "$" + Math.round(dna.avgLiquidity);

  const liqClass  = dna.avgLiquidity >= 50000 ? "" : dna.avgLiquidity >= 10000 ? "val-warn" : "val-bad";
  const concClass = dna.concentrationPct > 60 ? "dna-bad"  : dna.concentrationPct > 35 ? "dna-warn" : "dna-good";
  const concNote  = dna.concentrationPct > 60 ? "⚠️ Very concentrated" : dna.concentrationPct > 35 ? "Moderate risk" : "Well distributed";
  const rugIcon   = dna.rugCount >= 10 ? "🪦" : dna.rugCount >= 3 ? "⚠️" : "✅";
  const rugClass  = dna.rugCount >= 10 ? "dna-bad" : dna.rugCount >= 3 ? "dna-warn" : "dna-good";
  const rugLabel  = dna.rugCount === 0
    ? "No rugged tokens detected"
    : `${dna.rugCount} rug${dna.rugCount > 1 ? "s" : ""} detected (incl. held dead tokens)`;

  const deadHeldCls = dna.deadBagsHeld > 0 ? "dna-warn" : "dna-good";
  const deadHeldStr = dna.deadBagsHeld > 0
    ? `${dna.deadBagsHeld} near-zero bags still in wallet`
    : "None — clean active portfolio";

  const noDataNote = dna.noDataCount > 0
    ? `${dna.noDataCount} token${dna.noDataCount > 1 ? "s" : ""} held with no DEX listing`
    : "All held tokens have DEX listings";
  const noDataCls  = dna.noDataCount > 0 ? "dna-warn" : "dna-good";
  const noDataIcon = dna.noDataCount > 0 ? "⚠️" : "✅";

  el.innerHTML = `
    <div class="dna-stats-grid">
      <div class="dna-stat-block">
        <div class="dna-stat-block-label">Portfolio Value</div>
        <div class="dna-stat-block-value">${formatUsd(dna.totalValueUsd)}</div>
        <div class="dna-stat-block-sub">${dna.tokenCount} tokens tracked</div>
      </div>
      <div class="dna-stat-block">
        <div class="dna-stat-block-label">24H Win Rate</div>
        <div class="dna-stat-block-value ${plHint}">${dna.winRate}%</div>
        <div class="dna-stat-block-sub">${Math.round((dna.winRate/100)*dna.tokenCount)} / ${dna.tokenCount} tokens green</div>
      </div>
      <div class="dna-stat-block">
        <div class="dna-stat-block-label">Avg Position Size</div>
        <div class="dna-stat-block-value">${formatUsd(dna.avgPosition)}</div>
        <div class="dna-stat-block-sub">per token</div>
      </div>
      <div class="dna-stat-block">
        <div class="dna-stat-block-label">Avg Liquidity</div>
        <div class="dna-stat-block-value ${liqClass}">${avgLiqStr}</div>
        <div class="dna-stat-block-sub">across holdings</div>
      </div>
    </div>

    <div class="dna-consistency-block">
      <div class="dna-consistency-title">📋 Wallet Breakdown</div>

      <div class="dna-check-row">
        <span class="dna-check-icon">🏆</span>
        <span class="dna-check-label">Biggest Bag</span>
        <span class="dna-check-val dna-good">${bigBagStr}</span>
      </div>
      <div class="dna-check-row">
        <span class="dna-check-icon">🎯</span>
        <span class="dna-check-label">Portfolio Concentration</span>
        <span class="dna-check-val ${concClass}">${dna.concentrationPct}% in top token — ${concNote}</span>
      </div>
      <div class="dna-check-row">
        <span class="dna-check-icon">${dna.worstBag ? '📉' : '✅'}</span>
        <span class="dna-check-label">Worst Performer Today</span>
        <span class="dna-check-val ${dna.worstBag ? 'dna-bad' : 'dna-good'}">${worstStr}</span>
      </div>
      <div class="dna-check-row">
        <span class="dna-check-icon">${rugIcon}</span>
        <span class="dna-check-label">Rug Pull History</span>
        <span class="dna-check-val ${rugClass}">${rugLabel}</span>
      </div>
      <div class="dna-check-row">
        <span class="dna-check-icon">${noDataIcon}</span>
        <span class="dna-check-label">Unlisted / Dead Tokens Held</span>
        <span class="dna-check-val ${noDataCls}">${noDataNote}</span>
      </div>
      <div class="dna-check-row">
        <span class="dna-check-icon">${dna.deadBagsHeld > 0 ? '🧟' : '✅'}</span>
        <span class="dna-check-label">Dead Bags Still Holding</span>
        <span class="dna-check-val ${deadHeldCls}">${deadHeldStr}</span>
      </div>
      <div class="dna-check-row">
        <span class="dna-check-icon">🚀</span>
        <span class="dna-check-label">New Token Preference</span>
        <span class="dna-check-val ${dna.newTokenRatio > 0.5 ? 'dna-warn' : 'dna-good'}">${dna.newTokens} tokens &lt;30d old (${Math.round(dna.newTokenRatio*100)}%)</span>
      </div>
      <div class="dna-check-row">
        <span class="dna-check-icon">💧</span>
        <span class="dna-check-label">Low Liquidity Bets (&lt;$20K)</span>
        <span class="dna-check-val ${dna.lowLiqCount > 0 ? 'dna-warn' : 'dna-good'}">${dna.lowLiqCount} token${dna.lowLiqCount !== 1 ? 's' : ''}</span>
      </div>
      <div class="dna-check-row">
        <span class="dna-check-icon">📂</span>
        <span class="dna-check-label">Total On-Chain Token Accounts</span>
        <span class="dna-check-val">${dna.totalAccounts} accounts found</span>
      </div>
    </div>
  `;
}

/* ============================================================
   RENDER COPY-TRADE RISK SCORE
   ============================================================ */
function renderCopyScore(dna) {
  const el      = document.getElementById("dnaCopyBody");
  const score   = dna.copyScore;
  const isGood  = score >= 65;
  const isMed   = score >= 40 && score < 65;
  const colorCls = isGood ? "score-color-green" : isMed ? "score-color-yellow" : "score-color-red";
  const barColor = isGood ? "#2cffc9" : isMed ? "#ffd166" : "#ff4d4f";
  const verdict  = isGood ? "SAFE TO COPY" : isMed ? "COPY WITH CAUTION" : "AVOID COPYING";

  const winScore     = dna.winRate;
  const riskScore    = Math.round((1 - dna.highRiskRatio) * 100);
  const sizeScore    = Math.min(Math.round(dna.totalValueUsd / 1000), 100);
  const diversScore  = Math.min(Math.round((dna.tokenCount / 20) * 100), 100);
  const newTokScore  = Math.round((1 - dna.newTokenRatio) * 100);
  const rugHistScore = Math.max(0, 100 - (dna.rugCount * 8));

  const row  = (s) => s >= 65 ? "row-good" : s >= 40 ? "row-warn" : "row-bad";
  const barW = (s) => s <= 0 ? 3 : s;

  let verdictText;
  if (isGood) {
    verdictText = `This wallet shows consistent performance with manageable risk. Win rate of ${dna.winRate}% and only ${dna.rugCount} rug${dna.rugCount !== 1 ? "s" : ""} in history. ${dna.archetype.name} profile suggests disciplined trading. Consider mirroring with reduced position sizes.`;
  } else if (isMed) {
    verdictText = `Mixed signals. The ${dna.archetype.name} pattern and ${dna.winRate}% win rate suggest some skill, but ${Math.round(dna.highRiskRatio * 100)}% high-risk tokens and ${dna.rugCount} past rug${dna.rugCount !== 1 ? "s" : ""} add uncertainty. Copy selectively — mirror their largest positions only.`;
  } else {
    verdictText = `High copy-trade risk. ${Math.round(dna.highRiskRatio * 100)}% of holdings are high-risk${dna.rugCount > 0 ? ` and ${dna.rugCount} past rugs detected` : ""}. ${dna.archetype.name} traders are difficult to copy profitably. DYOR before following.`;
  }

  const verdictBoxCls = isGood ? "verdict-safe" : isMed ? "verdict-risky" : "verdict-avoid";
  const shareText     = buildShareText(dna, verdict, score);

  el.innerHTML = `
    <div class="dna-copy-score-block">
      <div class="dna-copy-score-label">COPY-TRADE RISK SCORE</div>
      <div class="dna-copy-score-number ${colorCls}">${score}</div>
      <div class="dna-copy-score-verdict ${colorCls}">${verdict}</div>
      <div class="dna-copy-score-bar-wrap">
        <div class="dna-copy-score-bar-fill" style="width:${score}%;background:${barColor};box-shadow:0 0 10px ${barColor};"></div>
      </div>
      <div style="font-size:10px;opacity:0.35;letter-spacing:0.5px;">Score / 100</div>
    </div>

    <div class="dna-copy-breakdown">
      <div class="dna-copy-row ${row(winScore)}">
        <span class="dna-copy-row-label">🎯 Win Rate (24H)</span>
        <span class="dna-copy-row-score">${winScore}/100</span>
        <div class="dna-copy-row-bar"><div class="dna-copy-row-fill" style="width:${barW(winScore)}%"></div></div>
      </div>
      <div class="dna-copy-row ${row(riskScore)}">
        <span class="dna-copy-row-label">🛡️ Risk Management</span>
        <span class="dna-copy-row-score">${riskScore}/100</span>
        <div class="dna-copy-row-bar"><div class="dna-copy-row-fill" style="width:${barW(riskScore)}%"></div></div>
      </div>
      <div class="dna-copy-row ${row(sizeScore)}">
        <span class="dna-copy-row-label">💰 Portfolio Size (Skin in Game)</span>
        <span class="dna-copy-row-score">${Math.min(sizeScore,100)}/100</span>
        <div class="dna-copy-row-bar"><div class="dna-copy-row-fill" style="width:${barW(Math.min(sizeScore,100))}%"></div></div>
      </div>
      <div class="dna-copy-row ${row(diversScore)}">
        <span class="dna-copy-row-label">📂 Diversification</span>
        <span class="dna-copy-row-score">${diversScore}/100</span>
        <div class="dna-copy-row-bar"><div class="dna-copy-row-fill" style="width:${barW(diversScore)}%"></div></div>
      </div>
      <div class="dna-copy-row ${row(newTokScore)}">
        <span class="dna-copy-row-label">🚀 Token Maturity (vs New Tokens)</span>
        <span class="dna-copy-row-score">${newTokScore}/100</span>
        <div class="dna-copy-row-bar"><div class="dna-copy-row-fill" style="width:${barW(newTokScore)}%"></div></div>
      </div>
      <div class="dna-copy-row ${row(rugHistScore)}">
        <span class="dna-copy-row-label">🪦 Rug Pull History</span>
        <span class="dna-copy-row-score" style="${rugHistScore === 0 ? 'color:#ff4d4f;font-size:11px;letter-spacing:0.5px;' : ''}">${rugHistScore === 0 ? '🚨 DANGER' : rugHistScore + '/100'}</span>
        <div class="dna-copy-row-bar"><div class="dna-copy-row-fill" style="width:${barW(rugHistScore)}%"></div></div>
      </div>
    </div>

    <div class="dna-verdict-box ${verdictBoxCls}">${verdictText}</div>

    <a href="https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}"
       target="_blank" rel="noopener noreferrer" class="dna-share-btn">
      🐦 Share DNA Analysis to X
    </a>
  `;
}

/* ============================================================
   BUILD PROFESSIONAL X SHARE TEXT
   ============================================================ */
function buildShareText(dna, verdict, score) {
  const short      = dna.wallet.slice(0, 4) + "…" + dna.wallet.slice(-4);
  const scoreEmoji = score >= 65 ? "🟢" : score >= 40 ? "🟡" : "🔴";
  const verdictLine = score >= 65
    ? "✅ Worth watching — disciplined trader"
    : score >= 40
    ? "⚠️ Proceed with caution before copying"
    : "🚫 High risk — not recommended to copy";
  const rugLine = dna.rugCount === 0
    ? "🧹 Clean history — 0 rugs detected"
    : `🪦 ${dna.rugCount} rug pull${dna.rugCount > 1 ? "s" : ""} in their history`;

  return [
    `🧬 Whale DNA Report — ${short}`,
    `━━━━━━━━━━━━━━━━━━`,
    `${dna.archetype.emoji} Type: ${dna.archetype.name}`,
    `💼 Portfolio: ${formatUsd(dna.totalValueUsd)}`,
    `🎯 Win Rate: ${dna.winRate}%  |  Tokens: ${dna.tokenCount}`,
    `⚠️ High Risk: ${Math.round(dna.highRiskRatio * 100)}%  |  Avg Position: ${formatUsd(dna.avgPosition)}`,
    rugLine,
    ``,
    `${scoreEmoji} Copy-Trade Score: ${score}/100`,
    verdictLine,
    ``,
    `🔍 Analyzed on scan2moon.com`,
    `#Solana #WhaleDNA #Crypto`,
  ].join("\n");
}

/* ============================================================
   RENDER HOLDINGS TABLE
   ============================================================ */
let allHoldings = [];

function renderHoldings(tokens) {
  allHoldings = tokens;
  document.getElementById("dnaFilterRow").innerHTML = `
    <button class="dna-filter-btn active" data-filter="all"    onclick="dnaApplyFilter('all')">All</button>
    <button class="dna-filter-btn"        data-filter="profit" onclick="dnaApplyFilter('profit')">📈 Green 24H</button>
    <button class="dna-filter-btn"        data-filter="loss"   onclick="dnaApplyFilter('loss')">📉 Red 24H</button>
    <button class="dna-filter-btn"        data-filter="high"   onclick="dnaApplyFilter('high')">⚠️ High Risk</button>
    <button class="dna-filter-btn"        data-filter="low"    onclick="dnaApplyFilter('low')">✅ Low Risk</button>
  `;
  renderHoldingRows(tokens);
}

window.dnaApplyFilter = function(filter) {
  document.querySelectorAll(".dna-filter-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.filter === filter);
  });
  let filtered = [...allHoldings];
  if (filter === "profit") filtered = filtered.filter(t => (t.pc24h ?? 0) > 0);
  if (filter === "loss")   filtered = filtered.filter(t => (t.pc24h ?? 0) < 0);
  if (filter === "high")   filtered = filtered.filter(t => t.score < 40);
  if (filter === "low")    filtered = filtered.filter(t => t.score >= 65);
  renderHoldingRows(filtered);
};

function renderHoldingRows(tokens) {
  const body = document.getElementById("dnaHoldingsBody");

  if (!tokens.length) {
    body.innerHTML = `<div class="dna-empty"><div class="dna-empty-icon">🔍</div><div class="dna-empty-title">No tokens match this filter</div></div>`;
    return;
  }

  const rows = tokens.map((t, i) => {
    const logo      = t.logo
      ? `/.netlify/functions/logoProxy?url=${encodeURIComponent(t.logo)}`
      : "https://placehold.co/36x36";
    const valStr    = formatUsd(t.currentValueUsd);
    const tokenStr  = formatAmount(t.uiAmount) + " " + t.symbol;
    const pc24h     = t.pc24h ?? 0;
    const pnl24Cls  = pc24h > 0 ? "dna-profit" : pc24h < 0 ? "dna-loss" : "dna-neutral";
    const pnl24Sign = pc24h >= 0 ? "+" : "";
    const pc1h      = t.pc1h ?? 0;
    const trendCls  = pc1h > 0 ? "trend-up" : pc1h < 0 ? "trend-down" : "trend-flat";
    const trendIcon = pc1h > 0 ? "↑" : pc1h < 0 ? "↓" : "→";
    const scCls     = t.score >= 65 ? "score-g" : t.score >= 40 ? "score-w" : "score-b";

    return `
      <tr style="animation-delay:${i * 0.03}s">
        <td>
          <div class="dna-token-cell">
            <img class="dna-token-logo" src="${logo}" onerror="this.src='https://placehold.co/36x36'" alt="${t.name}" />
            <div>
              <a href="https://solscan.io/token/${t.mint}" target="_blank" rel="noopener noreferrer" class="dna-token-name-link">
                <div class="dna-token-name">${t.name}</div>
              </a>
              <div class="dna-token-symbol">${t.symbol}</div>
            </div>
          </div>
        </td>
        <td>
          <div class="dna-value-usd">${valStr}</div>
          <div class="dna-value-tokens">${tokenStr}</div>
        </td>
        <td>
          <div class="dna-pnl-pct ${pnl24Cls}">${pnl24Sign}${pc24h.toFixed(2)}%</div>
          <div class="dna-pnl-usd ${pnl24Cls}">${pnl24Sign}${formatUsd(Math.abs(t.valueChange24hUsd ?? 0))}</div>
        </td>
        <td>
          <div class="dna-trend-val ${trendCls}">${trendIcon} ${Math.abs(pc1h).toFixed(2)}%</div>
          <div style="font-size:10px;opacity:.45;">1h</div>
        </td>
        <td>
          <div class="dna-score-num ${scCls}">${t.score}<span style="font-size:11px;opacity:.4">/100</span></div>
        </td>
        <td>
          <span class="dna-risk-badge ${t.riskClass}">${t.riskLabel}</span>
        </td>
        <td>
          <a href="https://dexscreener.com/solana/${t.mint}" target="_blank" rel="noopener noreferrer"
             style="font-size:11px;color:#2cffc9;opacity:.7;text-decoration:none;">Chart ↗</a>
        </td>
      </tr>
    `;
  }).join("");

  body.innerHTML = `
    <div class="dna-table-wrap">
      <table class="dna-table">
        <thead>
          <tr>
            <th>Token</th><th>Value</th><th>24H P/L</th>
            <th>1H Trend</th><th>Risk Score</th><th>Risk Level</th><th>Chart</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

/* ============================================================
   UI STATE HELPERS
   ============================================================ */
function showLoading(label, pct) {
  document.getElementById("dnaProfileBody").innerHTML = `
    <div class="dna-loading">
      <div class="dna-spinner"></div>
      <div class="dna-loading-label" id="dnaLoadingLabel">${label}</div>
      <div class="dna-progress-wrap">
        <div class="dna-progress-fill" id="dnaProgressFill" style="width:${pct}%"></div>
      </div>
    </div>`;
  document.getElementById("dnaStatsBody").innerHTML    = `<div class="dna-loading"><div class="dna-loading-label">Waiting…</div></div>`;
  document.getElementById("dnaCopyBody").innerHTML     = `<div class="dna-loading"><div class="dna-loading-label">Waiting…</div></div>`;
  document.getElementById("dnaHoldingsBody").innerHTML = `<div class="dna-loading"><div class="dna-loading-label">Waiting for data…</div></div>`;
  document.getElementById("dnaFilterRow").innerHTML    = "";
}

function updateProgress(pct, label) {
  const fill = document.getElementById("dnaProgressFill");
  const lbl  = document.getElementById("dnaLoadingLabel");
  if (fill) fill.style.width = pct + "%";
  if (lbl)  lbl.textContent  = label;
}

function showEmpty(title, sub) {
  document.getElementById("dnaProfileBody").innerHTML = `
    <div class="dna-empty">
      <div class="dna-empty-icon">🧬</div>
      <div class="dna-empty-title">${title}</div>
      <div>${sub}</div>
    </div>`;
  document.getElementById("dnaStatsBody").innerHTML    = "";
  document.getElementById("dnaCopyBody").innerHTML     = "";
  document.getElementById("dnaHoldingsBody").innerHTML = "";
  document.getElementById("dnaFilterRow").innerHTML    = "";
}

function showError(msg) {
  document.getElementById("dnaProfileBody").innerHTML = `
    <div class="dna-empty">
      <div class="dna-empty-icon">⚠️</div>
      <div class="dna-empty-title">Scan Failed</div>
      <div style="color:#ff6b6b;font-size:13px;">${msg}</div>
    </div>`;
}

/* ============================================================
   FORMAT HELPERS
   ============================================================ */
function formatUsd(v) {
  if (!v || isNaN(v)) return "$0.00";
  const abs = Math.abs(v);
  let str;
  if (abs >= 1e9)       str = "$" + (abs / 1e9).toFixed(2) + "B";
  else if (abs >= 1e6)  str = "$" + (abs / 1e6).toFixed(2) + "M";
  else if (abs >= 1e3)  str = "$" + (abs / 1e3).toFixed(2) + "K";
  else if (abs >= 0.01) str = "$" + abs.toFixed(2);
  else                  str = "$" + abs.toFixed(6);
  return v < 0 ? "-" + str : str;
}

function formatAmount(num) {
  if (!num || isNaN(num)) return "0";
  if (num >= 1e12) return (num / 1e12).toFixed(2) + "T";
  if (num >= 1e9)  return (num / 1e9).toFixed(2)  + "B";
  if (num >= 1e6)  return (num / 1e6).toFixed(2)  + "M";
  if (num >= 1e3)  return (num / 1e3).toFixed(2)  + "K";
  return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/* i18n handles data-i18n elements automatically on langchange — no manual call needed */
window.addEventListener("langchange", () => { /* i18n system handles this */ });
