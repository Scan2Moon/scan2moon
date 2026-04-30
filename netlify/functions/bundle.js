/* ================================================================
   Scan2Moon - Bundle Attack Detector  (Netlify Function)
   Birdeye API + Helius Enhanced Transactions.

   Strategy:
   1. Birdeye /defi/txs/token (sort asc) - first 50 swap transactions
      -> identify wallets that bought in the first EARLY_WINDOW_SECS
   2. Birdeye /defi/token_security - top10HolderPercent + authorities
   3. Birdeye /defi/v3/token/holder - top-6 holder list for display
   4. Helius Enhanced Transactions (type=TRANSFER) - trace the SOL
      funding source for up to 5 early buyer wallets. If 2+ wallets
      share the same funder -> commonFunderDetected = true.
      This is the signal nobody else provides.

   Bundle Score: 0-100, higher = safer.
   ================================================================ */

const { redisGet, redisSet, CORS, CORS_429, isRateLimitedRedis } = require("./db");
const { resolveAccess, respond402, CORS_API } = require("./x402");

const EARLY_WINDOW_SECS  = 300;   // 5 minutes after first trade = "launch window"
const REDIS_TTL          = 120;   // cache 2 minutes
const MAX_FUNDER_WALLETS = 5;     // max Helius calls for funder tracing
const MINT_RE            = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/* -- Helius: resolve funding source for one early buyer wallet ----------
   Fetches the wallet's recent TRANSFER history and returns the address
   that sent it SOL just before the token launched (launchTs in seconds).
   Returns null on error - non-fatal.
   ----------------------------------------------------------------------- */
async function getFunder(wallet, launchTs, heliusKey) {
  try {
    const url =
      `https://api.helius.xyz/v0/addresses/${encodeURIComponent(wallet)}/transactions` +
      `?api-key=${heliusKey}&type=TRANSFER&limit=20`;
    const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!res.ok) return null;

    const txs = await res.json().catch(() => []);
    if (!Array.isArray(txs)) return null;

    // Find the most recent incoming SOL transfer BEFORE the launch timestamp
    for (const tx of txs) {
      if ((tx.timestamp ?? 0) >= launchTs) continue; // ignore post-launch
      const natives = Array.isArray(tx.nativeTransfers) ? tx.nativeTransfers : [];
      for (const nt of natives) {
        if (
          nt.toUserAccount   === wallet &&
          nt.fromUserAccount &&
          nt.fromUserAccount !== wallet &&
          (nt.amount ?? 0) > 1000000 // > 0.001 SOL - ignore dust
        ) {
          return nt.fromUserAccount;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/* -- Helius: detect common funders across early buyer wallets ----------
   Takes a list of early buyer wallet addresses + the launch timestamp.
   Resolves each funder in parallel, groups by funder address, returns
   whether 2+ buyers share the same source.
   ----------------------------------------------------------------------- */
async function detectCommonFunder(earlyBuyerWallets, launchTs, heliusKey) {
  if (!heliusKey || earlyBuyerWallets.length < 2) {
    return { commonFunderDetected: false, commonFunderCount: 0, funderAddress: null };
  }

  const sample  = earlyBuyerWallets.slice(0, MAX_FUNDER_WALLETS);
  const funders = await Promise.all(sample.map(w => getFunder(w, launchTs, heliusKey)));

  // Count occurrences per funder address
  const counts = {};
  for (const f of funders) {
    if (f) counts[f] = (counts[f] ?? 0) + 1;
  }

  // Find the most common funder
  let topFunder = null;
  let topCount  = 0;
  for (const [addr, cnt] of Object.entries(counts)) {
    if (cnt > topCount) { topFunder = addr; topCount = cnt; }
  }

  return {
    commonFunderDetected: topCount >= 2,
    commonFunderCount:    topCount,
    funderAddress:        topCount >= 2 ? topFunder : null,
  };
}

/* -- Birdeye fetch with single retry on 429 -- */
async function beFetch(url, KEY, timeoutMs = 9000) {
  const headers = { "X-API-KEY": KEY, "x-chain": "solana" };
  let res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (res.status === 429) {
    await new Promise(r => setTimeout(r, 1200));
    res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  }
  return res;
}

/* -- Core analysis using Birdeye data + Helius funder tracing -- */
async function analyzeBirdeye(mint, BIRDEYE_KEY, HELIUS_KEY) {
  const enc = encodeURIComponent(mint);

  // Phase 1: early trades + security data in parallel
  const [txRes, secRes] = await Promise.all([
    beFetch(
      `https://public-api.birdeye.so/defi/txs/token?address=${enc}&tx_type=swap&offset=0&limit=50&sort_type=asc`,
      BIRDEYE_KEY
    ).catch(() => null),
    beFetch(
      `https://public-api.birdeye.so/defi/token_security?address=${enc}`,
      BIRDEYE_KEY
    ).catch(() => null),
  ]);

  // Parse early trades
  let trades     = [];
  let earlyPct   = 0;
  let earlyCount = 0;
  let firstTs    = 0;
  const earlyBuyerList = [];

  if (txRes?.ok) {
    const txJson = await txRes.json().catch(() => null);
    trades = txJson?.data?.items ?? txJson?.data ?? [];

    if (Array.isArray(trades) && trades.length > 0) {
      trades.sort((a, b) => (a.blockUnixTime ?? 0) - (b.blockUnixTime ?? 0));

      firstTs         = trades[0].blockUnixTime ?? 0;
      const windowEnd = firstTs + EARLY_WINDOW_SECS;

      const earlyBuyers = new Set();
      const allBuyers   = new Set();

      for (const tx of trades) {
        const isBuy = tx.side === "buy"
          || (tx.from?.symbol  === "SOL")
          || (tx.quote?.symbol === "SOL");
        const owner = tx.owner ?? tx.from?.address ?? tx.maker ?? null;
        if (!owner) continue;
        if (isBuy) allBuyers.add(owner);
        if (isBuy && (tx.blockUnixTime ?? 0) <= windowEnd) earlyBuyers.add(owner);
      }

      earlyCount = earlyBuyers.size;
      earlyPct   = allBuyers.size > 0
        ? Math.min(100, (earlyCount / allBuyers.size) * 100)
        : 0;

      earlyBuyerList.push(...earlyBuyers);
    }
  }

  // Parse security data
  let top10Pct   = null;
  let mintAuth   = null;
  let freezeAuth = null;

  if (secRes?.ok) {
    const secJson = await secRes.json().catch(() => null);
    const d       = secJson?.data ?? {};
    top10Pct   = d.top10HolderPercent ?? d.top_10_holder_percent ?? null;
    mintAuth   = d.mintAuthority      ?? d.mint_authority        ?? null;
    freezeAuth = d.freezeAuthority    ?? d.freeze_authority      ?? null;
  }

  // Phase 2: top holder list for display (non-fatal)
  let topBuyers = [];
  try {
    const hRes = await beFetch(
      `https://public-api.birdeye.so/defi/v3/token/holder?address=${enc}&offset=0&limit=6`,
      BIRDEYE_KEY, 7000
    );
    if (hRes?.ok) {
      const hJson = await hRes.json().catch(() => null);
      const items = hJson?.data?.items ?? [];
      topBuyers = items.slice(0, 6).map(h => {
        const addr = h.owner ?? h.address ?? "";
        return {
          wallet:     addr.slice(0, 6) + "..." + addr.slice(-6),
          fullWallet: addr,
          percentage: parseFloat(h.percentage ?? 0),
        };
      });
    }
  } catch { /* display-only, non-fatal */ }

  // Phase 3: Helius common funder detection (non-fatal)
  let funderResult = { commonFunderDetected: false, commonFunderCount: 0, funderAddress: null };
  try {
    if (earlyBuyerList.length >= 2 && firstTs > 0 && HELIUS_KEY) {
      funderResult = await detectCommonFunder(earlyBuyerList, firstTs, HELIUS_KEY);
    }
  } catch { /* non-fatal */ }

  // Bundle Score (0-100, higher = safer)
  let bundleScore = 100;

  if      (earlyPct > 60) bundleScore = 10;
  else if (earlyPct > 40) bundleScore = 25;
  else if (earlyPct > 20) bundleScore = 42;
  else if (earlyPct > 10) bundleScore = 62;
  else if (earlyPct >  5) bundleScore = 80;

  if (top10Pct !== null) {
    const pct = top10Pct * 100;
    if      (pct >= 90) bundleScore = Math.min(bundleScore, 15);
    else if (pct >= 80) bundleScore = Math.min(bundleScore, 25);
    else if (pct >= 70) bundleScore = Math.min(bundleScore, 38);
    else if (pct >= 60) bundleScore = Math.min(bundleScore, 52);
  }

  if (mintAuth && mintAuth !== "Renounced" && mintAuth !== null) {
    bundleScore = Math.min(bundleScore, 45);
  }

  // Confirmed common funder -> hard cap (smoking gun signal)
  if (funderResult.commonFunderDetected) {
    bundleScore = Math.min(bundleScore, 20);
  }

  bundleScore = Math.max(5, Math.min(100, Math.round(bundleScore)));

  // Verdict
  let verdict, label;
  if      (bundleScore >= 80) { verdict = "CLEAN";      label = "No Bundle Detected";       }
  else if (bundleScore >= 55) { verdict = "SUSPICIOUS"; label = "Possible Bundle Activity"; }
  else if (bundleScore >= 30) { verdict = "BUNDLED";    label = "Bundle Attack Detected";   }
  else                        { verdict = "EXTREME";    label = "Heavy Bundle Attack!";     }

  // Override label if common funder confirmed - this is definitive
  if (funderResult.commonFunderDetected) {
    verdict = "EXTREME";
    label   = `Coordinated Bundle - ${funderResult.commonFunderCount} wallets, same funder!`;
  }

  return {
    bundleScore,
    verdict,
    label,
    earlyPct:             parseFloat(earlyPct.toFixed(1)),
    earlyCount,
    uniqueWallets:        earlyCount,
    estimatedControllers: earlyCount,
    commonFunderDetected: funderResult.commonFunderDetected,
    commonFunderCount:    funderResult.commonFunderCount,
    funderAddress:        funderResult.funderAddress
      ? funderResult.funderAddress.slice(0, 6) + "..." + funderResult.funderAddress.slice(-6)
      : null,
    top10Pct:       top10Pct !== null ? parseFloat((top10Pct * 100).toFixed(2)) : null,
    mintAuthority:  mintAuth   === null ? "Renounced" : (mintAuth   ?? "Unknown"),
    freezeAuthority: freezeAuth === null ? "Renounced" : (freezeAuth ?? "Unknown"),
    topBuyers,
    source: "birdeye+helius",
  };
}

/* ================================================================
   HANDLER
   ================================================================ */
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  if (event.httpMethod !== "POST")    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Method not allowed" }) };

  const ip = ((event.headers["x-nf-client-connection-ip"]
            || event.headers["x-forwarded-for"]
            || "unknown").split(",")[0].trim());

  /* Access gate: API key / x402 Base / Solana / paywall */
  const access = await resolveAccess(event, "bundle");
  if (access.access === "paywall") return respond402("bundle");
  if (access.access === "denied")
    return { statusCode: access.status, headers: CORS_API, body: JSON.stringify({ error: access.error }) };

  const BIRDEYE_KEY = process.env.BIRDEYE_API_KEY;
  const HELIUS_KEY  = process.env.HELIUS_KEY;
  if (!BIRDEYE_KEY) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "BIRDEYE_API_KEY not set." }) };

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid JSON body." }) }; }

  const { mint, hasGraduated = false } = body;
  if (!mint || !MINT_RE.test(mint))
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid mint address." }) };

  const isPumpFunMint = mint.endsWith("pump");
  if (isPumpFunMint && !hasGraduated) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({
      bundleScore: 75, verdict: "PUMP_FUN",
      label: "Pump.fun Token - See Launch Risk Signal",
      earlyPct: 0, earlyCount: 0, uniqueWallets: 0, estimatedControllers: 0,
      commonFunderDetected: false, commonFunderCount: 0, funderAddress: null,
      pumpFunOrigin: true, topBuyers: [], source: "birdeye+helius",
      note: "Pump.fun bonding-curve buys not indexed in /defi/txs/token.",
    })};
  }

  const cacheKey = `bundle4:${mint}`;
  try {
    const cached = await redisGet(cacheKey);
    if (cached) return { statusCode: 200, headers: { ...CORS, "X-Cache": "HIT" }, body: JSON.stringify(cached) };
  } catch {}

  try {
    const result = {
      ...await analyzeBirdeye(mint, BIRDEYE_KEY, HELIUS_KEY),
      pumpFunOrigin: isPumpFunMint && hasGraduated,
    };
    try { await redisSet(cacheKey, result, REDIS_TTL); } catch {}
    return { statusCode: 200, headers: { ...CORS, "X-Cache": "MISS" }, body: JSON.stringify(result) };
  } catch (e) {
    console.error("[bundle]", e.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "Bundle analysis failed: " + e.message }) };
  }
};
