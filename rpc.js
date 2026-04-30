// rpc.js — DECOMMISSIONED
// This file is no longer used. All data comes from Birdeye API via dedicated
// Netlify functions (scanToken, tokenSecurity, walletTokens, holderData, etc.).
// Blockhash for wallet transactions is fetched via /.netlify/functions/blockhash.
// This file is kept as a tombstone to prevent accidental re-imports.

export function callRpc() {
  throw new Error(
    "[rpc.js] callRpc() is decommissioned. Use Birdeye-powered Netlify functions instead."
  );
}
