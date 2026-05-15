#!/usr/bin/env node
/**
 * Scan2Moon MCP Server
 * Exposes Solana on-chain intelligence as Claude tools.
 *
 * Setup (Claude Code):
 *   export SCAN2MOON_API_KEY=your_key
 *   claude mcp add scan2moon -- npx scan2moon-mcp
 *
 * Get a free API key (1,000 calls/day):
 *   https://scan2moon.com/api-portal.html
 *
 * Supports x402 auto-pay (no key needed) when SCAN2MOON_PRIVATE_KEY
 * (Base/EVM private key) is set instead. Requires: npm install x402-fetch viem
 */

import { Server }               from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const BASE_URL = "https://scan2moon.com/.netlify/functions";
const API_KEY  = process.env.SCAN2MOON_API_KEY  || "";
const EVM_KEY  = process.env.SCAN2MOON_PRIVATE_KEY || "";

/* ── Auth / x402 ─────────────────────────────────────────── */

let _fetchFn = fetch;

async function initFetch() {
  if (EVM_KEY && !API_KEY) {
    try {
      const { wrapFetchWithPayment } = await import("x402-fetch");
      const { privateKeyToAccount }  = await import("viem/accounts");
      const account = privateKeyToAccount(EVM_KEY.startsWith("0x") ? EVM_KEY : `0x${EVM_KEY}`);
      _fetchFn = wrapFetchWithPayment(fetch, account);
    } catch {
      /* x402-fetch not installed — fall through to unauthenticated */
    }
  }
}

function authHeaders() {
  return API_KEY ? { "X-Api-Key": API_KEY } : {};
}

/* ── Core API caller ─────────────────────────────────────── */

async function callApi(path, params = {}, method = "GET", body = null) {
  const url = new URL(BASE_URL + path);
  if (method === "GET") {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  const opts = {
    method,
    headers: { "Content-Type": "application/json", ...authHeaders() },
    signal: AbortSignal.timeout(15000),
  };
  if (body && method !== "GET") opts.body = JSON.stringify(body);

  const res = await _fetchFn(url.toString(), opts);

  if (res.status === 402) {
    const info = await res.json().catch(() => ({}));
    const prices = (info.accepts || []).map(a =>
      `  • Base USDC: $${(parseInt(a.maxAmountRequired) / 1e6).toFixed(4)}/call via x402`
    ).join("\n");
    return {
      _paymentRequired: true,
      message: "⚠️ Payment required to call this endpoint.",
      options: [
        "1. Set env var SCAN2MOON_API_KEY (free tier: 1,000 calls/day) → https://scan2moon.com/api-portal.html",
        "2. Set SCAN2MOON_PRIVATE_KEY (Base/EVM key) — server auto-pays via x402 (requires: npm install x402-fetch viem)",
        "3. Send USDC-SPL to 2NYUevD2m8eRvHFsT3JvDy8poxiWNVEKXqnDvXWrZpyC and pass X-Solana-Payment header manually",
      ],
      prices,
      paymentInfo: info,
    };
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}${errText ? ": " + errText.slice(0, 200) : ""}`);
  }

  return res.json();
}

/* ── Tool definitions ────────────────────────────────────── */

const TOOLS = [
  {
    name:        "analyze_wallet",
    description: "Get full on-chain deployment history for a Solana wallet. Returns every token the address has ever launched, each classified as ACTIVE / DEAD / DUMPED / RUG, with live liquidity, price, and holder count. Includes aggregate rug rate and a computed history penalty score (0–100). Use this before trading any token to check if the developer has a history of rugging.",
    inputSchema: {
      type: "object",
      properties: {
        wallet: { type: "string", description: "Solana wallet address (base58, 32–44 chars)" },
      },
      required: ["wallet"],
    },
  },
  {
    name:        "get_new_pairs",
    description: "Get recently launched Solana token pairs from Pump.fun and Raydium. Each token includes name, symbol, price, liquidity (USD), market cap, age (minutes), holder count, and risk score (HIGH / MED / LOW). Useful for discovering new tokens before they trend.",
    inputSchema: {
      type: "object",
      properties: {
        window:  { type: "string",  enum: ["1h","6h","24h"], description: "How far back to look (default: 6h)" },
        min_liq: { type: "number",  description: "Minimum liquidity in USD (default: 500)" },
      },
    },
  },
  {
    name:        "get_smart_money",
    description: "Get top Solana traders ranked by on-chain PnL. Returns wallet addresses, win rates, total realized PnL in USD, and trade counts. Useful for identifying profitable wallets to copy-trade or monitor.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Number of wallets to return (max 50, default 20)" },
      },
    },
  },
  {
    name:        "predict_lp_pull",
    description: "Predict the probability that a token's liquidity will be pulled (rug pull). Returns a risk score, key risk factors, and top holder analysis. Run this on any new token before buying.",
    inputSchema: {
      type: "object",
      properties: {
        mint: { type: "string", description: "Token mint address (base58)" },
      },
      required: ["mint"],
    },
  },
  {
    name:        "detect_bundle_attack",
    description: "Detect coordinated bundle attacks on a Solana token launch. Identifies attacker wallets that sniped the launch together, their coordinated buy amounts, and overall attack severity (LOW / MED / HIGH / CRITICAL). Bundle attacks artificially inflate token prices and often precede dumps.",
    inputSchema: {
      type: "object",
      properties: {
        mint: { type: "string", description: "Token mint address (base58)" },
      },
      required: ["mint"],
    },
  },
  {
    name:        "batch_risk_score",
    description: "Get risk scores for up to 15 Solana tokens in a single call. Returns a risk level (HIGH / MED / LOW) and a numeric score (0–100, higher = riskier) for each token. More efficient than calling predict_lp_pull individually when screening multiple tokens.",
    inputSchema: {
      type: "object",
      properties: {
        mints: {
          type:        "array",
          items:       { type: "string" },
          maxItems:    15,
          description: "Array of token mint addresses (base58)",
        },
      },
      required: ["mints"],
    },
  },
];

/* ── MCP server ──────────────────────────────────────────── */

const server = new Server(
  { name: "scan2moon", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result;

    switch (name) {
      case "analyze_wallet":
        result = await callApi("/devWallet", { wallet: args.wallet });
        break;

      case "get_new_pairs":
        result = await callApi("/newPairs", { window: args.window || "6h", min_liq: args.min_liq ?? 500 });
        break;

      case "get_smart_money":
        result = await callApi("/smartMoneyLeaderboard", { limit: args.limit ?? 20 });
        break;

      case "predict_lp_pull":
        result = await callApi("/lpPredictor", {}, "POST", { mint: args.mint });
        break;

      case "detect_bundle_attack":
        result = await callApi("/bundle", {}, "POST", { mint: args.mint });
        break;

      case "batch_risk_score":
        result = await callApi("/batchRisk", { mints: args.mints.join(",") });
        break;

      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }

    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };

  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
  }
});

/* ── Start ───────────────────────────────────────────────── */

await initFetch();
const transport = new StdioServerTransport();
await server.connect(transport);
