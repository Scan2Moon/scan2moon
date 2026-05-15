/* ================================================================
   Scan2Moon — /.well-known/x402.json
   Standard x402 discovery document. AI agents fetch this to learn
   what endpoints exist, what they cost, and how to pay.

   Spec: https://x402.org/spec
   ================================================================ */

const { PRICES, BASE_RECIPIENT, SOL_RECIPIENT } = require("./x402");

const BASE_USDC     = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const SOL_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SITE_URL      = process.env.URL || "https://scan2moon.com";

const HEADERS = {
  "Content-Type":                "application/json",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control":               "public, max-age=3600",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: HEADERS, body: "" };

  const endpoints = Object.keys(PRICES).map(key => {
    const p        = PRICES[key];
    const resource = `${SITE_URL}/.netlify/functions/${key}`;
    return {
      resource,
      description: `${p.label} — Scan2Moon Solana Intelligence API`,
      /* Standard x402 Base/EVM payment */
      accepts: [
        {
          scheme:            "exact",
          network:           "base",
          maxAmountRequired: String(p.units),
          resource,
          description:       p.label,
          mimeType:          "application/json",
          payTo:             BASE_RECIPIENT,
          maxTimeoutSeconds: 300,
          asset:             BASE_USDC,
          extra:             { name: "USD Coin", version: "2" },
        },
      ],
      /* Non-standard Solana extension — agents that support it can use it */
      "x-solana": {
        network:       "mainnet-beta",
        asset:         "USDC-SPL",
        mint:          SOL_USDC_MINT,
        amountUnits:   p.units,
        amountUsd:     p.usd,
        recipient:     SOL_RECIPIENT,
        paymentHeader: "X-Solana-Payment",
        instructions:  [
          `Send exactly $${p.usd} USDC-SPL to ${SOL_RECIPIENT} on Solana mainnet`,
          "Retry your request with header: X-Solana-Payment: <tx_signature>",
          "Payment must be confirmed and < 5 minutes old",
        ],
      },
    };
  });

  const body = {
    x402Version: 1,
    provider: {
      name:          "Scan2Moon",
      url:           SITE_URL,
      description:   "Solana on-chain intelligence: token risk, whale wallets, new pairs, smart money",
      documentation: `${SITE_URL}/api-portal.html`,
      openapi:       `${SITE_URL}/openapi.json`,
      mcp:           "npx scan2moon-mcp",
      contact:       { x: "@Scan2Moon", email: "scan2moon@gmail.com" },
    },
    apiKey: {
      header:      "X-Api-Key",
      description: "Plan-based daily quota. Free tier: 1,000 req/day.",
      portal:      `${SITE_URL}/api-portal.html`,
    },
    endpoints,
  };

  return {
    statusCode: 200,
    headers:    HEADERS,
    body:       JSON.stringify(body, null, 2),
  };
};
