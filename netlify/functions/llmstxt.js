/* ================================================================
   Scan2Moon — /llms.txt
   LLM-readable description of the Scan2Moon API.
   Follows the llms.txt spec: https://llmstxt.org
   ================================================================ */

const { PRICES, BASE_RECIPIENT, SOL_RECIPIENT } = require("./x402");

const SITE_URL = process.env.URL || "https://scan2moon.com";

const HEADERS = {
  "Content-Type":                "text/plain; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control":               "public, max-age=3600",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: HEADERS, body: "" };

  const endpointLines = Object.entries(PRICES).map(([key, p]) => {
    const url = `${SITE_URL}/.netlify/functions/${key}`;
    return `### ${p.label} — $${p.usd}/call\n- URL: ${url}\n- Price: $${p.usd} USDC per call (${p.units} units, 6-decimal)`;
  }).join("\n\n");

  const body = `# Scan2Moon API — Solana On-Chain Intelligence
> Proprietary real-time Solana analytics: token risk scores, whale wallet history, new token pairs, and smart money tracking. Pay per call with crypto — no account required.

## What this API does

Scan2Moon provides pay-per-call endpoints for Solana on-chain data that is NOT available from public providers like Birdeye, Dexscreener, or Helius. Data is sourced from our proprietary detection pipeline running on-chain via Pump.fun and Raydium.

## How to use this API as an AI agent

### Step 1 — Try the endpoint
Make a GET or POST request. If unauthenticated, you receive HTTP 402 with a machine-readable JSON body describing exactly how to pay.

### Step 2 — Pay (three options)

**Option A: API Key (easiest)**
\`\`\`
X-Api-Key: <your_key>
\`\`\`
Get a free key (1,000 calls/day) at ${SITE_URL}/api-portal.html
Pro plan: 25,000 calls/day — $49/month
Power plan: 100,000 calls/day — $99/month

**Option B: x402 on Base (autonomous agents, no signup)**
\`\`\`
X-Payment: <ERC-3009 transfer authorization>
\`\`\`
- Network: Base (chain ID 8453)
- Asset: USDC (${BASE_RECIPIENT})
- Recipient: 0x57fe97c1be493f100514aaa8ab1adda713ca5ffb
- Protocol: x402 (https://x402.org) — sign an ERC-3009 authorisation offline, pass the encoded header
- Library: npm install x402-fetch  →  wrapFetchWithPayment(fetch, viemAccount)
- Coinbase AgentKit users: x402 is built in, just configure the recipient

**Option C: Solana USDC-SPL (native Solana agents)**
\`\`\`
X-Solana-Payment: <transaction_signature>
\`\`\`
- Send USDC-SPL to: ${SOL_RECIPIENT}
- Network: mainnet-beta
- Mint: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
- Payment must be confirmed on-chain and < 5 minutes old
- Pass the Solana transaction signature in the X-Solana-Payment header

## Endpoints

Base URL: ${SITE_URL}/.netlify/functions

${endpointLines}

### GET /prices — Free (no auth)
Returns full machine-readable pricing for all endpoints. Always call this first to get current prices.

## Response format

All endpoints return JSON. On success: HTTP 200 with data object.
On payment required: HTTP 402 with full x402 payment instructions in body.

## Code examples

### Node.js with x402 auto-pay (Base USDC)
\`\`\`javascript
import { wrapFetchWithPayment } from "x402-fetch";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount(process.env.PRIVATE_KEY);
const fetchWithPayment = wrapFetchWithPayment(fetch, account);

// First request triggers payment automatically
const res = await fetchWithPayment("${SITE_URL}/.netlify/functions/newPairs");
const { tokens } = await res.json();
\`\`\`

### Claude MCP (recommended for Claude agents)
\`\`\`bash
# Install the MCP server
export SCAN2MOON_API_KEY=your_key
claude mcp add scan2moon -- npx scan2moon-mcp

# Claude can now use: analyze_wallet, get_new_pairs, get_smart_money,
# predict_lp_pull, detect_bundle_attack, batch_risk_score
\`\`\`

### curl with API key
\`\`\`bash
curl -H "X-Api-Key: YOUR_KEY" \\
  "${SITE_URL}/.netlify/functions/devWallet?wallet=9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"
\`\`\`

### curl — discover prices first, then pay
\`\`\`bash
# 1. Check pricing
curl "${SITE_URL}/.netlify/functions/prices"

# 2. Call endpoint (returns 402 with payment instructions if no key)
curl "${SITE_URL}/.netlify/functions/newPairs?window=1h"
\`\`\`

## Discovery links

- Pricing (machine-readable): ${SITE_URL}/.netlify/functions/prices
- x402 discovery: ${SITE_URL}/.well-known/x402.json
- OpenAPI 3.1 spec: ${SITE_URL}/openapi.json
- API portal (human): ${SITE_URL}/api-portal.html
- MCP server (Claude): npx scan2moon-mcp

## Contact

X (Twitter): @Scan2Moon
Email: scan2moon@gmail.com
`;

  return {
    statusCode: 200,
    headers:    HEADERS,
    body,
  };
};
