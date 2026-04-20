<div align="center">

<img src="headerweb.png" alt="Scan2Moon Banner" width="100%" />

# 🚀 Scan2Moon — Solana Token Intelligence Platform

**The most comprehensive on-chain risk scanner and trading toolkit built on Birdeye Data.**

[![Live Site](https://img.shields.io/badge/🌐_Live_Site-scan2moon.com-2cffc9?style=for-the-badge)](https://scan2moon.com)
[![Twitter](https://img.shields.io/badge/Follow-%40Scan2Moon-1DA1F2?style=for-the-badge&logo=twitter)](https://x.com/Scan2Moon)
[![Powered by Birdeye](https://img.shields.io/badge/Powered_by-Birdeye_Data-9945FF?style=for-the-badge)](https://bds.birdeye.so)
[![Built on Solana](https://img.shields.io/badge/Built_on-Solana-14F195?style=for-the-badge&logo=solana)](https://solana.com)

---

> *Scan smarter. Trade safer. Never get rugged again.*

**341+ risk scans run • 2,000+ Birdeye API calls • Live at scan2moon.com**

</div>

---

## What is Scan2Moon?

Scan2Moon is a full-stack Solana token intelligence platform that turns raw on-chain data into actionable trading decisions. It's not just a price checker — it's a complete ecosystem: risk scanner, paper trading simulator, whale tracker, token radar, gamified academy, and personal dashboard, all powered by Birdeye's real-time data infrastructure.

Built for the trader who knows that execution without data is blind.

---

## 🔑 Birdeye API Integration

Scan2Moon makes deep, multi-endpoint use of Birdeye Data across the entire platform:

| Endpoint | Used In | Purpose |
|---|---|---|
| `/defi/token_overview` | Risk Scanner | Token metadata, holder count, supply info |
| `/defi/price` | Safe Ape Simulator | 3-second live price ticker for candle chart |
| `/defi/ohlcv` | Live Chart | Historical + live OHLCV candle data |
| `/defi/v2/markets` | Risk Scanner | Pool creation time, DEX liquidity depth |
| `/defi/token_creation_info` | Risk Scanner | Token age, creator wallet analysis |
| `/defi/tokenlist` | Top Gainers | Live top-gainer feed sorted by volume |

**Every token scan triggers 4–6 parallel Birdeye API calls**, combined with Helius RPC data to produce a composite 0–100 Risk Score. With 341 scans run on the live site, Scan2Moon has logged **2,000+ Birdeye API calls** in production.

---

## 🛠️ Features

### 🔍 Risk Scanner
The core of the platform. Paste any Solana token mint address and get a full intelligence report in seconds.

- **Composite Risk Score (0–100)** built from 15+ on-chain signals
- **Liquidity depth analysis** — pool size, concentration, LP lock status
- **Holder distribution** — top 10 concentration, whale flags
- **Token age & creator wallet** — flagging brand-new mints and repeat deployers
- **MC/FDV ratio** — detecting unlock risk and inflation pressure
- **Volume/liquidity health ratio** — identifying wash trading patterns
- **Price action signals** — 30m/1h/24h momentum checks
- Powered by Birdeye `/defi/token_overview`, `/defi/v2/markets`, `/defi/token_creation_info`

### 🚀 Top Gainers Feed (Home Page)
A live Birdeye-powered token leaderboard with timeframe switching.

- Real-time top tokens by 24H volume from Birdeye `/defi/tokenlist`
- Server-side re-sorted by 30M / 1H / 12H / 24H price change
- Risk Score computed for every token without extra RPC calls (`quickRisk()`)
- 10 tokens per page with pagination, auto-refreshes every 90 seconds
- Redis-cached (90s TTL) to stay within API rate limits

### 🦍 Safe Ape Simulator
A paper trading simulator with real Birdeye price data — practice without losing real SOL.

- **Two-speed price architecture**: 3-second fast ticker via Birdeye `/defi/price` (5s Redis TTL) for smooth candle animation + 30-second slow refresh via DexScreener for metadata
- EMA spike filter rejects prices deviating >35% from moving average
- Professional candlestick chart with drawing tools (trend lines, horizontal levels, Fibonacci)
- Real wallet connection (Phantom) — simulate buys/sells with your actual SOL balance display
- **XP system** — earn XP on every sell, scaled by profit percentage
- **Jupiter swap integration** — one-click "Swap on Jupiter" with referral link directly from the sim
- Full trade history with P/L tracking, W/L ratio, win streaks

### 🐋 Whale DNA Scanner
Track the on-chain footprint of any Solana wallet.

- Full portfolio snapshot, recent trades, PnL history
- Whale alert system — detect when large wallets accumulate

### 📡 Entry Radar
New token discovery powered by on-chain data.

- Filter fresh launches by age, liquidity, holder count
- Risk-score every new token automatically

### 📊 Portfolio Scanner
Connect your wallet and get a full snapshot.

- Live token prices via Birdeye
- Unrealised P/L, cost basis tracking
- Holdings breakdown with risk signals

### 🎓 Learn2Moon Academy
A gamified learning system teaching traders how to read on-chain data.

- 10 structured lessons with quizzes
- Certificate NFT on completion
- Academy XP level separate from account level

### 🏆 Dashboard & Gamification
- **Account Level + Academy Level** — dual XP system
- **18 collectible badges** across categories: Scanner, Ape, Social, Academy, Level milestones
- **Daily reward** — +5 XP + SOL bonus on login
- **Leaderboard** — compete with other Scan2Moon users
- **Shareable profile card** — screenshot your stats for X
- **Missions system** — guided tasks to earn XP and badges

---

## 🏗️ Architecture

```
scan2moon/
├── index.html              # Home — Top Gainers feed
├── risk-scanner.html       # Token risk scanner
├── safe-ape.html           # Paper trading simulator
├── whale-dna.html          # Wallet tracker
├── entry-radar.html        # New token discovery
├── portfolio.html          # Portfolio scanner
├── dashboard.html          # User dashboard + gamification
├── academy.html            # Learn2Moon Academy
├── leaderboard.html        # Global leaderboard
├── tasks.html              # Missions + social tasks
│
└── netlify/functions/
    ├── scanToken.js         # Core risk scan — 4-6 Birdeye calls per scan
    ├── topGainers.js        # Top gainers — Birdeye tokenlist + server re-sort
    ├── priceOnly.js         # 3s price ticker — Birdeye /defi/price, 5s Redis TTL
    ├── ohlcvData.js         # OHLCV candles — Birdeye /defi/ohlcv
    ├── simulator.js         # Safe Ape backend — trades, XP, profiles
    ├── warmCache.js         # Background cache warmer for hot tokens
    ├── leaderboard.js       # Global leaderboard via Neon Postgres
    ├── chartProxy.js        # DexScreener proxy for 30s metadata refresh
    ├── tokenData.js         # Token enrichment layer
    ├── helius.js            # Helius RPC — LP lock, on-chain metadata
    └── db.js                # Shared Neon Postgres + Upstash Redis helpers
```

### Data Layer

| Layer | Technology | Purpose |
|---|---|---|
| Primary market data | **Birdeye Data API** | Prices, OHLCV, token metadata, holder data |
| On-chain RPC | **Helius** | LP lock detection, raw account data |
| Supplemental | **DexScreener** | Pair metadata, 30s slow refresh |
| Cache | **Upstash Redis** | Sub-ms L1 cache, 5–90s TTLs |
| Database | **Neon Postgres** | User profiles, leaderboard, trade history |
| Hosting | **Netlify** | Serverless functions + static hosting |
| Wallet | **Phantom / @solana/web3.js** | Wallet connection, SOL balance |

---

## ⚡ The Risk Score Engine

The centerpiece of Scan2Moon. Every token gets a **composite 0–100 Risk Score** built from 15+ signals, all sourced from Birdeye + Helius data:

```
Score = base(50)
  + liquidityBonus    (up to +30)   ← Birdeye token_overview
  - mcLiqRatioPenalty (up to -30)   ← rug proxy: MC/liquidity
  - dumpPenalty       (up to -30)   ← 24h price crash floor
  - liquidityFloor    (hard cap)    ← prevents fake-safe scores
  + volHealthBonus    (up to +5)    ← vol/liq ratio signal
  + holderBonus       (up to +8)    ← Birdeye holder count
  + lpLockBonus       (up to +15)   ← Helius LP lock detection
  - concentrationPenalty            ← top-10 holder %
  - agePenalty                      ← token < 24h old
```

**Result**: LOW (≥65) · MED (45–64) · HIGH (<45)

A lightweight version (`quickRisk()`) runs server-side on every Top Gainers token using only Birdeye tokenlist fields — no extra RPC calls needed.

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- Netlify CLI (`npm install -g netlify-cli`)

### Environment Variables

Create a `.env` file in the project root:

```env
BIRDEYE_API_KEY=your_birdeye_api_key
HELIUS_KEY=your_helius_rpc_key
UPSTASH_REDIS_REST_URL=your_upstash_url
UPSTASH_REDIS_REST_TOKEN=your_upstash_token
NEON_DATABASE_URL=your_neon_postgres_url
```

### Run Locally

```bash
# Install dependencies
npm install

# Start local dev server with Netlify functions
netlify dev
```

Open `http://localhost:8888`

---

## 📈 Birdeye Competition Submission

This project was built for the **Birdeye Data Build in Public Competition** — 4-week sprint series with $7,000 in prizes.

**Why Scan2Moon fits the competition brief:**

- ✅ Uses 6 distinct Birdeye endpoints in production
- ✅ 2,000+ real Birdeye API calls on live site
- ✅ Custom risk scoring engine built entirely on Birdeye data
- ✅ Real users, live at scan2moon.com
- ✅ Open source on GitHub
- ✅ Solana-native, wallet-connected

**Tags:** `#BirdeyeAPI` `@birdeye_data`

---

## 🤝 Contributing

Pull requests welcome. For major changes, open an issue first.

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
