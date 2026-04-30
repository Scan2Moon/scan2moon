/* ================================================================
   Scan2Moon -- Prices / Discovery Endpoint
   GET /.netlify/functions/prices

   Machine-readable pricing for all pay-per-call endpoints.
   Designed for AI agents to discover what they need to pay
   before calling any proprietary endpoint.

   No auth required -- always public.
   ================================================================ */

const { PRICES, BASE_RECIPIENT, SOL_RECIPIENT } = require("./x402");

const CORS_PUBLIC = {
  "Content-Type":                 "application/json",
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Api-Key, X-Payment, X-Solana-Payment",
};

const BASE_USDC     = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const SOL_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SITE_URL      = process.env.URL || "https://scan2moon.com";

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS_PUBLIC, body: "" };
  if (event.httpMethod !== "GET")
    return { statusCode: 405, headers: CORS_PUBLIC, body: JSON.stringify({ error: "Method not allowed" }) };

  /* Build endpoint listing from PRICES config */
  var endpoints = Object.keys(PRICES).map(function(key) {
    var p = PRICES[key];
    var url = SITE_URL + "/.netlify/functions/" + key;
    return {
      endpoint:    key,
      url:         url,
      description: p.label,
      priceUsd:    p.usd,
      /* x402 Base payment requirements */
      x402: {
        scheme:            "exact",
        network:           "base",
        maxAmountRequired: String(p.units),
        asset:             BASE_USDC,
        payTo:             BASE_RECIPIENT,
        maxTimeoutSeconds: 300,
        resource:          url,
      },
      /* Solana USDC-SPL payment instructions */
      solana: {
        network:     "mainnet-beta",
        asset:       "USDC-SPL",
        mint:        SOL_USDC_MINT,
        amountUnits: p.units,
        amountUsd:   p.usd,
        recipient:   SOL_RECIPIENT,
        header:      "X-Solana-Payment: <tx_signature>",
      },
    };
  });

  var payload = {
    version: "1.0",
    platform: "Scan2Moon",
    description: "Proprietary Solana on-chain intelligence APIs",
    documentation: SITE_URL + "/api-portal.html",
    authentication: {
      methods: [
        {
          type:        "api_key",
          header:      "X-Api-Key",
          description: "Plan-based daily quota. Get a key at " + SITE_URL + "/api-portal.html",
        },
        {
          type:        "x402",
          header:      "X-Payment",
          network:     "base",
          description: "Per-call USDC payment via x402 protocol (https://x402.org). No sign-up required.",
        },
        {
          type:        "solana_usdc",
          header:      "X-Solana-Payment",
          network:     "solana",
          description: "Per-call USDC-SPL payment. Send USDC to recipient, pass tx signature in header.",
        },
      ],
    },
    endpoints: endpoints,
    contact: {
      x: "@Scan2Moon",
      email: "scan2moon@gmail.com",
    },
  };

  return {
    statusCode: 200,
    headers: CORS_PUBLIC,
    body: JSON.stringify(payload, null, 2),
  };
};
