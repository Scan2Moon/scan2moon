<div align="center">

<img src="headerweb.png" alt="Scan2Moon Banner" width="100%" />

# 🚀 Scan2Moon — Solana Token Intelligence Platform

**On-chain risk scanner and paper trading simulator powered by Birdeye Data.**

[![Live Site](https://img.shields.io/badge/🌐_Live_Site-scan2moon.com-2cffc9?style=for-the-badge)](https://scan2moon.com)
[![Twitter](https://img.shields.io/badge/Follow-%40Scan2Moon-1DA1F2?style=for-the-badge&logo=twitter)](https://x.com/Scan2Moon)
[![Powered by Birdeye](https://img.shields.io/badge/Powered_by-Birdeye_Data-9945FF?style=for-the-badge)](https://bds.birdeye.so)
[![Built on Solana](https://img.shields.io/badge/Built_on-Solana-14F195?style=for-the-badge&logo=solana)](https://solana.com)

> *Scan smarter. Trade safer. Never get rugged again.*

</div>

---

## What is Scan2Moon?

Scan2Moon is a Solana token intelligence platform built on top of Birdeye's real-time data. Paste any token mint address and get a full risk report in seconds — liquidity depth, holder concentration, LP lock status, creator wallet flags, and a composite 0–100 Risk Score. Then practice trading it risk-free in the built-in paper trading simulator.

---

## 🔑 Birdeye API Integration

| Endpoint | Feature | Purpose |
|---|---|---|
| `/defi/token_overview` | Risk Scanner | Token metadata, holder count, supply |
| `/defi/price` | Safe Ape Simulator | 3-second live price ticker |
| `/defi/ohlcv` | Live Chart | Historical + live candle data |
| `/defi/v2/markets` | Risk Scanner | Pool creation time, liquidity depth |
| `/defi/token_creation_info` | Risk Scanner | Token age, creator wallet |
| `/defi/tokenlist` | Top Gainers | Top tokens by volume with risk scoring |

Every token scan triggers 4–6 parallel Birdeye API calls combined with Helius RPC data.

---

## 🛠️ Core Features

### 🔍 Risk Scanner
Paste any Solana token mint address → full intelligence report in seconds.

- **Composite Risk Score (0–100)** from 15+ on-chain signals
- Liquidity depth, LP lock detection, holder concentration
- Token age, creator wallet flags, MC/FDV unlock risk
- Volume/liquidity health ratio, price action momentum
- Sources: Birdeye `/defi/token_overview` + `/defi/v2/markets` + `/defi/token_creation_info` + Helius RPC

### 🦍 Safe Ape Simulator
Paper trade any Solana token with real Birdeye price data.

- **Two-speed price engine**: 3s fast ticker via Birdeye `/defi/price` (5s Redis TTL) + 30s slow DexScreener refresh
- Professional candlestick chart with drawing tools
- Real Phantom wallet connection — simulates with your actual balance display
- XP rewards on every sell, scaled by profit %
- Jupiter swap button for real trading when you're ready
- Full trade history with P/L tracking in SOL

### 🚀 Top Gainers (Home Page)
Live Birdeye-powered token leaderboard.

- Fetches top 50 tokens by volume from Birdeye `/defi/tokenlist`
- Re-sorted server-side by 30M / 1H / 12H / 24H price change
- Risk Score computed for every token server-side (`quickRisk()`) without extra RPC calls
- Auto-refreshes every 90 seconds, Redis-cached to manage API rate limits

### 📊 Dashboard & Gamification
- Account Level + XP system
- Badges earned through scanning, trading, streaks
- Daily reward claim (+5 XP)
- Leaderboard rankings

---

## 🏗️ Architecture

```
scan2moon/
├── index.html              # Home — Top Gainers feed
├── risk-scanner.html       # Token risk scanner  ← core feature
├── safe-ape.html           # Paper trading simulator
├── whale-dna.html          # Wallet tracker
├── entry-radar.html        # New token discovery
├── dashboard.html          # User dashboard + XP + badges
├── leaderboard.html        # Global leaderboard
│
└── netlify/functions/
    ├── scanToken.js         # Core risk scan — 4-6 Birdeye calls per scan
    ├── topGainers.js        # Top gainers — Birdeye tokenlist + server re-sort
    ├── priceOnly.js         # 3s price ticker — Birdeye /defi/price, 5s Redis TTL
    ├── ohlcvData.js         # OHLCV candles — Birdeye /defi/ohlcv
    ├── simulator.js         # Safe Ape backend — trades, XP, profiles
    ├── warmCache.js         # Background warmer for hot tokens
    ├── leaderboard.js       # Global leaderboard via Neon Postgres
    └── db.js                # Neon Postgres + Upstash Redis helpers
```

### Data Stack

| Layer | Technology |
|---|---|
| Primary market data | **Birdeye Data API** |
| On-chain RPC | **Helius** |
| Supplemental | **DexScreener** |
| Cache | **Upstash Redis** (5–90s TTLs) |
| Database | **Neon Postgres** |
| Hosting | **Netlify** (serverless functions) |
| Wallet | **Phantom / @solana/web3.js** |

---

## ⚡ Risk Score Engine

Every token gets a 0–100 composite score from Birdeye + Helius data:

```
Score = base(50)
  + liquidityBonus    (+30 max)   ← Birdeye token_overview
  - mcLiqRatioPenalty (-30 max)   ← rug proxy: MC ÷ liquidity
  - dumpPenalty                   ← 24h price crash floor
  - liquidityFloor                ← hard cap on low-liq tokens
  + volHealthBonus                ← vol/liq ratio
  + holderBonus                   ← Birdeye holder count
  + lpLockBonus                   ← Helius LP lock detection
  - concentrationPenalty          ← top-10 holder %
  - agePenalty                    ← token < 24h old
```

Result: **LOW** (≥65) · **MED** (45–64) · **HIGH** (<45)

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- Netlify CLI: `npm install -g netlify-cli`

### Environment Variables

Create a `.env` in the project root:

```env
BIRDEYE_API_KEY=your_birdeye_api_key
HELIUS_KEY=your_helius_rpc_key
UPSTASH_REDIS_REST_URL=your_upstash_url
UPSTASH_REDIS_REST_TOKEN=your_upstash_token
NEON_DATABASE_URL=your_neon_postgres_url
```

### Run Locally

```bash
npm install
netlify dev
# → http://localhost:8888
```

---

## 📄 License

MIT — built in public, for the community.

---

<div align="center">

**Built with ❤️ on Solana · Powered by Birdeye Data**

[![scan2moon.com](https://img.shields.io/badge/🌐-scan2moon.com-2cffc9?style=flat-square)](https://scan2moon.com)
[![@Scan2Moon](https://img.shields.io/badge/X-@Scan2Moon-1DA1F2?style=flat-square&logo=twitter)](https://x.com/Scan2Moon)

*Scan smarter. Trade safer.*

</div>
