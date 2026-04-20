// Run with: node test-birdeye.js
// Tests the Birdeye tokenlist endpoint used by topGainers.js
require("dotenv").config();

const KEY = process.env.BIRDEYE_API_KEY;
console.log("API Key present:", !!KEY, KEY ? `(${KEY.slice(0,8)}...)` : "MISSING!");

const tests = [
  { label: "1h sort",  sort_by: "price_change_1h_percent"  },
  { label: "24h sort", sort_by: "price_change_24h_percent" },
  { label: "30m sort", sort_by: "price_change_30m_percent" },
];

async function run() {
  for (const t of tests) {
    const params = new URLSearchParams({
      sort_by: t.sort_by, sort_type: "desc",
      offset: "0", limit: "3", min_liquidity: "10000",
    });
    const url = `https://public-api.birdeye.so/defi/tokenlist?${params}`;
    console.log(`\n--- ${t.label} ---`);
    console.log("URL:", url);
    try {
      const res = await fetch(url, {
        headers: { "X-API-KEY": KEY, "x-chain": "solana" },
      });
      const body = await res.text();
      console.log("Status:", res.status);
      console.log("Body:", body.slice(0, 400));
    } catch (e) {
      console.log("Error:", e.message);
    }
  }
}

run();
