/* ================================================================
   Scan2Moon – Bundle Attack Detector  (Netlify Function)
   Detects coordinated launch-block bundling on Solana tokens.

   Logic:
   1. Paginate getSignaturesForAddress(mint) to find creation slot
   2. Collect all transactions in the first EARLY_WINDOW slots
   3. Parse each tx to identify wallets that received tokens early
   4. Check early buyers for a shared SOL funding source
   5. Return bundle score (0-100, higher = safer) + full breakdown
   ================================================================ */

const ALLOWED_ORIGIN   = process.env.ALLOWED_ORIGIN || "*";
const EARLY_WINDOW     = 5;   // slots after mint creation to consider "launch block"
const MAX_SIG_PAGES    = 5;   // max pagination rounds (500 sigs) — covers fresh tokens
const MAX_EARLY_TXS    = 20;  // max early transactions to fully parse
const MAX_FUNDER_CHECK = 6;   // max wallets to check for common funder
const RPC_TIMEOUT_MS   = 9000;

/* ── Rate limiting (in-memory, per IP, 10/min) ── */
const rlMap = new Map();
setInterval(() => {
  const cutoff = Date.now() - 65000;
  for (const [k, v] of rlMap) if (v.ts < cutoff) rlMap.delete(k);
}, 120000);

function isRateLimited(ip) {
  const now = Date.now();
  const e   = rlMap.get(ip);
  if (!e || now - e.ts > 60000) { rlMap.set(ip, { count: 1, ts: now }); return false; }
  e.count++;
  return e.count > 10;
}

/* ── Response helper ── */
function jsonResp(status, body) {
  return {
    statusCode: status,
    headers: {
      "Content-Type":                "application/json",
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods":"POST, OPTIONS",
      "Access-Control-Allow-Headers":"Content-Type",
    },
    body: JSON.stringify(body),
  };
}

/* ── Helius RPC helper ── */
async function rpc(key, method, params, signal) {
  const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${key}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal,
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "RPC error");
  return data.result;
}

/* ================================================================
   MAIN HANDLER
   ================================================================ */
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return jsonResp(200, {});
  if (event.httpMethod !== "POST")    return jsonResp(405, { error: "Method not allowed" });

  const ip = event.headers["x-nf-client-connection-ip"]
           || event.headers["x-forwarded-for"]
           || "unknown";
  if (isRateLimited(ip)) return jsonResp(429, { error: "Too many requests — please wait a minute." });

  const HELIUS_KEY = process.env.HELIUS_KEY;
  if (!HELIUS_KEY) return jsonResp(500, { error: "Server configuration error." });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return jsonResp(400, { error: "Invalid JSON body." }); }

  const { mint, hasGraduated } = body;
  if (!mint || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
    return jsonResp(400, { error: "Invalid mint address." });
  }

  /* Overall timeout controller — keeps us well inside the 10s Lambda limit */
  const controller = new AbortController();
  const globalTimer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);

  try {
    /* ── Step 1: Paginate signatures to find creation slot ── */
    let allSigs  = [];
    let before   = null;
    let pages    = 0;

    while (pages < MAX_SIG_PAGES) {
      const params = [mint, { limit: 100, ...(before ? { before } : {}) }];
      const batch  = await rpc(HELIUS_KEY, "getSignaturesForAddress", params, controller.signal);
      if (!batch || batch.length === 0) break;
      allSigs = allSigs.concat(batch);
      if (batch.length < 100) break;   // reached the beginning of history
      before = batch[batch.length - 1].signature;
      pages++;
    }

    if (allSigs.length === 0) {
      clearTimeout(globalTimer);
      return jsonResp(200, {
        bundleScore: 75, verdict: "NO_DATA",
        label: "No Transaction Data", earlyPct: 0,
        uniqueWallets: 0, estimatedControllers: 0,
        commonFunderDetected: false, commonFunderCount: 0,
        creationSlot: 0, earlyWindow: EARLY_WINDOW, topBuyers: [],
        note: "Token has no on-chain transaction history yet.",
      });
    }

    /* ── Pump.fun detection ──────────────────────────────────────
       Pump.fun tokens route buys through their bonding curve program,
       not the mint account directly. getSignaturesForAddress(mint)
       only returns mint creation and setup transactions — never the
       actual bonding-curve buys. This means earlyBuyers is always
       empty for non-graduated pump tokens → we skip the analysis and
       return a PUMP_FUN verdict so the pumpFunRisk signal in
       scanSignals.js handles risk scoring instead.

       For graduated tokens (hasGraduated = true) we run the full
       analysis. The result will show post-graduation RPC activity;
       pumpFunOrigin = true in the response signals the UI to display
       an explanatory note about the pump.fun launch origin.
       ──────────────────────────────────────────────────────────── */
    const isPumpFunMint  = mint.endsWith("pump");
    const likelyPumpFun  = isPumpFunMint && !hasGraduated;

    if (likelyPumpFun) {
      clearTimeout(globalTimer);
      return jsonResp(200, {
        bundleScore: 75, verdict: "PUMP_FUN",
        label: "Pump.fun Token — See Launch Risk Signal",
        earlyPct: 0, uniqueWallets: 0, estimatedControllers: 0,
        commonFunderDetected: false, commonFunderCount: 0,
        creationSlot: allSigs[allSigs.length - 1]?.slot ?? 0,
        earlyWindow: EARLY_WINDOW, topBuyers: [],
        note: "Pump.fun tokens route buys through the bonding curve program — individual launch buyers are analyzed via the Pump.fun Launch Risk signal instead.",
      });
    }

    /* Creation slot = slot of the oldest known signature */
    const creationSig  = allSigs[allSigs.length - 1];
    const creationSlot = creationSig.slot;

    /* ── Step 2: Filter to launch-window signatures ── */
    const earlySigs = allSigs
      .filter(s => s.slot <= creationSlot + EARLY_WINDOW)
      .slice(0, MAX_EARLY_TXS);

    /* ── Step 3: Fetch full transaction details in parallel ── */
    const txDetails = await Promise.all(
      earlySigs.map(sig =>
        rpc(HELIUS_KEY, "getTransaction", [
          sig.signature,
          { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
        ], controller.signal).catch(() => null)
      )
    );

    /* ── Step 4: Parse early token buyers ── */
    /* earlyBuyers: Map<walletAddress, { slot, gained }> */
    const earlyBuyers = new Map();

    for (let i = 0; i < txDetails.length; i++) {
      const tx  = txDetails[i];
      const sig = earlySigs[i];
      if (!tx || tx.meta?.err) continue;

      const preTokenBals  = tx.meta?.preTokenBalances  || [];
      const postTokenBals = tx.meta?.postTokenBalances || [];
      const accountKeys   = tx.transaction?.message?.accountKeys || [];

      for (const post of postTokenBals) {
        if (post.mint !== mint) continue;

        const pre    = preTokenBals.find(p => p.accountIndex === post.accountIndex);
        const preBal = pre ? Number(pre.uiTokenAmount?.uiAmount  || 0) : 0;
        const postBal= Number(post.uiTokenAmount?.uiAmount || 0);

        if (postBal <= preBal || postBal <= 0) continue;

        /* owner of the token account = the real buyer */
        const ownerKey = post.owner
          || accountKeys[post.accountIndex]?.pubkey
          || (typeof accountKeys[post.accountIndex] === "string"
              ? accountKeys[post.accountIndex] : null);

        if (!ownerKey || ownerKey === mint || ownerKey.length < 32) continue;

        const gained = postBal - preBal;
        const existing = earlyBuyers.get(ownerKey);
        earlyBuyers.set(ownerKey, {
          slot:   sig.slot,
          gained: (existing?.gained || 0) + gained,
        });
      }
    }

    /* ── Step 5: Total supply → early purchase % ── */
    let totalSupply = 0;
    try {
      const supplyRes = await rpc(
        HELIUS_KEY, "getTokenSupply",
        [mint, { commitment: "confirmed" }],
        controller.signal
      );
      totalSupply = Number(supplyRes?.value?.uiAmountString || 0);
    } catch { /* non-fatal */ }

    const earlyBuyerList = Array.from(earlyBuyers.entries())
      .map(([wallet, d]) => ({ wallet, slot: d.slot, gained: d.gained }))
      .sort((a, b) => b.gained - a.gained);

    const totalEarlyBought = earlyBuyerList.reduce((s, b) => s + b.gained, 0);
    const earlyPct = totalSupply > 0
      ? Math.min(100, (totalEarlyBought / totalSupply) * 100)
      : 0;

    /* ── Step 6: Common funder detection ── */
    /* For the top MAX_FUNDER_CHECK early buyers, find who funded their wallet
       by looking at the SOL sender in their very first transaction. */
    const topToCheck = earlyBuyerList.slice(0, MAX_FUNDER_CHECK);
    const funderCount = new Map();   // funder wallet → number of early buyers funded

    await Promise.all(topToCheck.map(async (buyer) => {
      try {
        /* Get the most recent sigs for this buyer wallet, then walk to oldest */
        const buyerSigs = await rpc(
          HELIUS_KEY, "getSignaturesForAddress",
          [buyer.wallet, { limit: 50 }],
          controller.signal
        );
        if (!buyerSigs || buyerSigs.length === 0) return;

        /* Oldest of those 50 → most likely to be the wallet's first SOL receive */
        const oldestSig = buyerSigs[buyerSigs.length - 1];
        const oldestTx  = await rpc(
          HELIUS_KEY, "getTransaction",
          [oldestSig.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }],
          controller.signal
        );
        if (!oldestTx) return;

        const accountKeys   = oldestTx.transaction?.message?.accountKeys || [];
        const preBals       = oldestTx.meta?.preBalances  || [];
        const postBals      = oldestTx.meta?.postBalances || [];

        /* SOL sender = account whose balance dropped (excluding fee payer itself) */
        for (let idx = 0; idx < accountKeys.length; idx++) {
          const addr = typeof accountKeys[idx] === "string"
            ? accountKeys[idx]
            : accountKeys[idx]?.pubkey;
          if (!addr || addr === buyer.wallet) continue;
          const pre  = preBals[idx]  || 0;
          const post = postBals[idx] || 0;
          if (pre > post + 10000) {   // sent SOL (5000 lamport fee buffer)
            funderCount.set(addr, (funderCount.get(addr) || 0) + 1);
          }
        }
      } catch { /* non-fatal — don't block the result */ }
    }));

    /* Find the most common funder */
    let maxCount    = 0;
    let commonFunder = null;
    for (const [addr, cnt] of funderCount) {
      if (cnt > maxCount) { maxCount = cnt; commonFunder = addr; }
    }
    const commonFunderDetected = maxCount >= 3;

    /* ── Step 7: Bundle Score (0-100, higher = safer) ── */
    let bundleScore = 100;

    if      (earlyPct > 60) bundleScore = 10;
    else if (earlyPct > 40) bundleScore = 25;
    else if (earlyPct > 20) bundleScore = 42;
    else if (earlyPct > 10) bundleScore = 62;
    else if (earlyPct >  5) bundleScore = 80;
    // earlyPct <= 5 → bundleScore stays at 100

    if (commonFunderDetected) bundleScore = Math.max(5, bundleScore - 20);

    /* Clamp */
    bundleScore = Math.max(5, Math.min(100, bundleScore));

    /* ── Step 8: Verdict ── */
    let verdict, label;
    if      (bundleScore >= 80) { verdict = "CLEAN";      label = "No Bundle Detected";        }
    else if (bundleScore >= 55) { verdict = "SUSPICIOUS";  label = "Possible Bundle Activity";  }
    else if (bundleScore >= 30) { verdict = "BUNDLED";     label = "Bundle Attack Detected";    }
    else                        { verdict = "EXTREME";     label = "Heavy Bundle Attack 🚨";    }

    clearTimeout(globalTimer);

    return jsonResp(200, {
      bundleScore,
      verdict,
      label,
      earlyPct:             Math.round(earlyPct * 10) / 10,
      uniqueWallets:        earlyBuyerList.length,
      estimatedControllers: commonFunderDetected
        ? Math.max(1, Math.ceil(earlyBuyerList.length / Math.max(1, maxCount)))
        : earlyBuyerList.length,
      commonFunderDetected,
      commonFunderCount:    maxCount,
      creationSlot,
      earlyWindow:          EARLY_WINDOW,
      pumpFunOrigin:        isPumpFunMint && hasGraduated,
      topBuyers: earlyBuyerList.slice(0, 6).map(b => ({
        wallet:     b.wallet.slice(0, 6) + "…" + b.wallet.slice(-6),
        fullWallet: b.wallet,
        slot:       b.slot,
        slotOffset: b.slot - creationSlot,
      })),
    });

  } catch (e) {
    clearTimeout(globalTimer);
    if (e.name === "AbortError") {
      return jsonResp(504, { error: "Bundle analysis timed out — token may have too many early transactions." });
    }
    console.error("Bundle detection error:", e);
    return jsonResp(500, { error: "Internal server error — please retry." });
  }
};
