/* ================================================================
   devWalletHelper.js — shared dev-wallet data-fetching logic

   Extracted from devWallet.js so it can be called directly by
   lpPredictor.js without making an HTTP round-trip (which would
   require auth and always returned available:false after the
   origin-bypass was removed from x402.js).

   Exports:
     fetchDevWalletData(wallet, heliusKey, birdeyeKey, redisGet, redisSet)
       -> DevWalletResult

   DevWalletResult:
     { wallet, totalDeployed, rugCount, activeCount, rugRate, historyPenalty, tokens }
   ================================================================ */

const MAX_TOKENS = 12;
const REDIS_TTL  = 900;   // 15 min — wallet-level cache
const TOKEN_TTL  = 1800;  // 30 min — per-token status cache
const WALLET_RE  = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SOL_MINT   = "So11111111111111111111111111111111111111112";

const SKIP_SET = new Set([
  SOL_MINT,
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "11111111111111111111111111111111",
  "Renounced",
  "N/A",
]);

/* ── Helius: get all TOKEN_MINT transactions by a wallet ── */
async function getDeployedMints(wallet, heliusKey) {
  const url =
    `https://api.helius.xyz/v0/addresses/${encodeURIComponent(wallet)}/transactions` +
    `?api-key=${heliusKey}&type=TOKEN_MINT&limit=50`;

  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) {
    if (res.status === 404) return [];
    const txt = await res.text().catch(() => "");
    throw new Error(`Helius ${res.status}: ${txt.slice(0, 120)}`);
  }

  const txs = await res.json().catch(() => []);
  if (!Array.isArray(txs)) return [];

  const seen  = new Set();
  const mints = [];

  for (const tx of txs) {
    const transfers = Array.isArray(tx.tokenTransfers) ? tx.tokenTransfers : [];
    for (const tt of transfers) {
      const { mint } = tt;
      if (mint && mint !== SOL_MINT && WALLET_RE.test(mint) && !seen.has(mint)) {
        seen.add(mint);
        mints.push({ mint, timestamp: tx.timestamp ?? 0 });
        break;
      }
    }
    if (mints.length >= MAX_TOKENS) break;
  }

  return mints;
}

/* ── Birdeye: classify a single token ── */
async function classifyToken(mint, timestamp, birdeyeKey, redisGet, redisSet) {
  const tokKey = `dw:tok:${mint}`;
  try {
    const hit = await redisGet(tokKey);
    if (hit) return hit;
  } catch {}

  const headers = { "X-API-KEY": birdeyeKey, "x-chain": "solana" };
  const res = await fetch(
    `https://public-api.birdeye.so/defi/token_overview?address=${encodeURIComponent(mint)}`,
    { headers, signal: AbortSignal.timeout(8000) }
  ).catch(() => null);

  const fallback = {
    mint, status: "UNKNOWN", name: "Unknown", symbol: "?",
    liquidity: 0, priceChange24h: 0, mc: 0, deployedAt: timestamp,
  };

  if (!res?.ok) return fallback;
  const json = await res.json().catch(() => null);
  const d = json?.data;
  if (!d) return fallback;

  const liquidity      = parseFloat(d.liquidity             ?? 0);
  const priceChange24h = parseFloat(d.priceChange24hPercent ?? 0);
  const mc             = parseFloat(d.mc                    ?? 0);
  const name           = d.name   ?? "Unknown";
  const symbol         = d.symbol ?? "?";
  const ageHours       = timestamp ? (Date.now() / 1000 - timestamp) / 3600 : null;

  // Classification ordered worst → best.
  // Uses age to avoid false-positive RUG on brand-new micro-caps.
  let status;
  if (liquidity < 500 && mc < 5000 && (ageHours === null || ageHours > 48)) {
    status = "RUG";
  } else if (priceChange24h < -80 && liquidity < 5000) {
    status = "DUMPED";
  } else if (priceChange24h < -70 && liquidity < 10000 && (ageHours === null || ageHours > 24)) {
    status = "DUMPED";
  } else if (liquidity < 2000 && (ageHours === null || ageHours > 72)) {
    status = "DEAD";
  } else if (liquidity < 500) {
    // New token with low liquidity — suspicious but not confirmed RUG yet
    status = "SUSPECT";
  } else {
    status = "ACTIVE";
  }

  const result = { mint, status, name, symbol, liquidity, priceChange24h, mc, deployedAt: timestamp };
  try { await redisSet(tokKey, result, TOKEN_TTL); } catch {}
  return result;
}

/* ── Main export ── */
async function fetchDevWalletData(wallet, heliusKey, birdeyeKey, redisGetFn, redisSetFn) {
  if (!wallet || !WALLET_RE.test(wallet) || SKIP_SET.has(wallet)) {
    return { wallet, totalDeployed: 0, rugCount: 0, rugRate: 0, activeCount: 0, historyPenalty: 0, tokens: [] };
  }

  // Wallet-level cache
  const cacheKey = `devwallet:v2:${wallet}`;
  try {
    const hit = await redisGetFn(cacheKey);
    if (hit) return hit;
  } catch {}

  // Step 1: discover deployed mints via Helius
  const mintInfos = await getDeployedMints(wallet, heliusKey);

  if (mintInfos.length === 0) {
    const result = { wallet, totalDeployed: 0, rugCount: 0, rugRate: 0, activeCount: 0, historyPenalty: 0, tokens: [] };
    try { await redisSetFn(cacheKey, result, REDIS_TTL); } catch {}
    return result;
  }

  // Step 2: classify each token via Birdeye (parallel)
  const tokens = await Promise.all(
    mintInfos.map(({ mint, timestamp }) => classifyToken(mint, timestamp, birdeyeKey, redisGetFn, redisSetFn))
  );

  // Step 3: aggregate stats
  const rugCount    = tokens.filter(t => t.status === "RUG" || t.status === "DUMPED").length;
  const activeCount = tokens.filter(t => t.status === "ACTIVE").length;
  const rugRate     = parseFloat((rugCount / tokens.length * 100).toFixed(1));

  let historyPenalty = 0;
  if      (rugRate >= 80) historyPenalty = 40;
  else if (rugRate >= 50) historyPenalty = 25;
  else if (rugRate >= 30) historyPenalty = 15;
  else if (rugRate >= 10) historyPenalty = 5;

  const result = {
    wallet,
    totalDeployed:  tokens.length,
    rugCount,
    activeCount,
    rugRate,
    historyPenalty,
    tokens: tokens.sort((a, b) => (b.deployedAt ?? 0) - (a.deployedAt ?? 0)),
  };

  try { await redisSetFn(cacheKey, result, REDIS_TTL); } catch {}
  return result;
}

module.exports = { fetchDevWalletData, WALLET_RE, SKIP_SET };
