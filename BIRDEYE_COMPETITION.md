# Scan2Moon × Birdeye Data Build in Public Competition
## Submission Guide + X Strategy

---

## What We Built

Scan2Moon is a Solana token intelligence platform that helps traders spot safe early entries, avoid rugs, and simulate trades before risking real money. **Every piece of market data now flows through Birdeye's API** — no DexScreener, no GeckoTerminal, no Jupiter price feeds in the browser.

---

## Birdeye API Endpoints Used (Technical Depth)

| Endpoint | Used In | Purpose |
|---|---|---|
| `/defi/token_overview` | `scanToken.js`, `tokenData.js`, `batchTokenData.js` | Full token risk scan — price, volume, liquidity, market cap, tx counts, price changes |
| `/defi/price` | `priceOnly.js`, `solPrice.js`, `scanToken.js`, `simulator.js` | Real-time price polling for chart tickers and SOL/USD conversion |
| `/defi/ohlcv` | `geckoProxy.js` | Candlestick chart data for Safe Ape paper trading simulator |
| `/defi/token_new_listing` | `entryRadar.js` | Entry Radar — scans for newly listed tokens with real DEX liquidity |
| `/defi/token_creation_info` | `scanToken.js` | Token creator wallet + initial supply analysis |
| `/defi/v2/markets` | `scanToken.js` | LP lock detection and DEX pool data |

**Minimum API calls per user session: well over 50.**  
A single Risk Scanner scan triggers 5+ Birdeye calls. The Entry Radar refreshes 40 tokens every 60 seconds. The Safe Ape chart polls `/defi/price` every 5 seconds while trading.

---

## Architecture: Fully Server-Side Birdeye Integration

The Birdeye API key **never reaches the browser**. All calls go through Netlify serverless functions:

```
Browser → /.netlify/functions/scanToken      → Birdeye /defi/token_overview
Browser → /.netlify/functions/tokenData      → Birdeye /defi/price + token_overview
Browser → /.netlify/functions/batchTokenData → Birdeye token_overview (25 tokens parallel)
Browser → /.netlify/functions/entryRadar     → Birdeye /defi/token_new_listing
Browser → /.netlify/functions/geckoProxy     → Birdeye /defi/ohlcv
Browser → /.netlify/functions/priceOnly      → Birdeye /defi/price (5s TTL)
Browser → /.netlify/functions/solPrice       → Birdeye /defi/price (SOL/USD, 10s TTL)
```

**Caching layer** (Upstash Redis + Neon PostgreSQL) prevents API hammering while keeping data fresh:
- Entry Radar: 60s Redis TTL (matches radar refresh interval)
- Token overview: 30s Redis TTL + 5min Neon L2 cache
- Live price: 5s Redis TTL (fast enough for chart tickers)
- SOL/USD: 10s Redis TTL

---

## Feature Map: Birdeye Powers Everything

### 🛡️ Risk Scanner
- Full token safety scan using Birdeye `token_overview` + `token_creation_info` + `v2/markets`
- 12-signal risk engine: LP strength, sell pressure, pump danger, dev behavior, MC/liq ratio
- Creator wallet exposure, LP lock detection, pump.fun graduation check

### 📡 Entry Radar  
- Scans Birdeye `token_new_listing` for tokens created in last 6 hours
- Filters: $5K+ real DEX liquidity, no bonding-curve pre-graduation tokens
- Each token processed through full 12-signal risk engine
- Entry window detection (Early / Mid / Late), Move Potential (5–20×)
- Refreshes every 60 seconds with Redis cache

### 🦍 Safe Ape (Paper Trading Simulator)
- Birdeye `ohlcv` powers the real-time candle chart
- `priceOnly` endpoint polls every 5s for live price
- Server-side trade validation uses Birdeye price (not client-supplied)
- SOL price for P/L calculation comes from Birdeye

### 📊 Portfolio Scanner
- Batch token enrichment via `batchTokenData` (Birdeye token_overview, 25 tokens parallel)
- Price, volume, market cap, liquidity, price changes all from Birdeye

### 🐋 Whale DNA
- Token enrichment same as Portfolio Scanner (Birdeye batch)
- Age calculation from Birdeye `createdAt`

### 📈 Dashboard (Paper Trading P/L)
- Live price refresh for all held positions via Birdeye batch endpoint

---

## What Makes This Different

Most Birdeye integrations just slap a price feed on a page. Scan2Moon uses Birdeye as the **intelligence layer** of a complete trading toolkit:

1. **Safety-first scoring**: 12 quantitative signals derived entirely from Birdeye data
2. **New token discovery**: Birdeye `token_new_listing` feeds a real-time radar that auto-scores and filters tokens
3. **Trade simulation**: Full paper trading with real Birdeye prices, P/L tracking, leaderboard
4. **Zero client-side API exposure**: All Birdeye calls are proxied through serverless with Redis caching

---

## X (Twitter) Build-in-Public Posts

Post these weekly across the 4-sprint competition. Always include **#BirdeyeAPI** in every post.

---

### 🟢 WEEK 1 — Project Launch

**Post 1 (launch announcement):**
```
🚀 Just entered the @birdeye_so Data Build in Public Competition with Scan2Moon!

Scan2Moon is a Solana token intelligence platform — Risk Scanner, Entry Radar, Paper Trading, Whale DNA — ALL powered by @birdeye_so API.

Zero DexScreener. Zero GeckoTerminal. 100% Birdeye.

Try it → scan2moon.com

#BirdeyeAPI #Solana #BuildInPublic
```

**Post 2 (technical depth):**
```
🔧 How @birdeye_so powers Scan2Moon under the hood:

• /defi/token_overview → 12-signal rug risk score
• /defi/token_new_listing → Entry Radar (new token discovery)  
• /defi/ohlcv → real-time candle charts
• /defi/price → live P/L in paper trading
• /defi/v2/markets → LP lock detection

API key never hits the browser — all through serverless proxies with Redis cache ⚡

#BirdeyeAPI #Solana
```

---

### 🟡 WEEK 2 — Entry Radar Feature

**Post 3:**
```
📡 Entry Radar — find early Solana tokens before they 10×

Powered by @birdeye_so /defi/token_new_listing:
✅ Filters for $5K+ real DEX liquidity (no bonding curves)
✅ Auto-scores every new listing with our 12-signal engine
✅ Shows Entry Window: 🟢 EARLY / 🟡 MID / 🔴 LATE
✅ Move Potential: 🚀 5-20× / ⚡ 2-5× / etc.
✅ Refreshes every 60s

Live at scan2moon.com/entry-radar.html

#BirdeyeAPI #Solana #BuildInPublic
```

---

### 🟠 WEEK 3 — Risk Scanner Deep Dive

**Post 4:**
```
🛡️ How Scan2Moon scores tokens 0-100 using only @birdeye_so data:

12 signals, each weighted:
• Token Age Trust (14%)
• Market Integrity — price collapse detection (12%)
• Pump.fun Launch Risk (12%)  
• LP Strength (8%)
• MC/Liquidity Ratio (8%)
• Sell Pressure 1H (8%)
• Dev Behavior (7%)
+ 5 more signals

All signal data = Birdeye token_overview. Zero external dependencies.

#BirdeyeAPI #Solana
```

---

### 🔴 WEEK 4 — Final Sprint + Results

**Post 5 (final):**
```
🏁 Week 4 wrap on @birdeye_so Build in Public Competition

What we shipped with Birdeye API:
📡 Entry Radar — real-time new token scanner
🛡️ Risk Scanner — 12-signal rug detection  
🦍 Safe Ape — paper trading with real Birdeye prices
📊 Portfolio & Whale DNA — batch token enrichment
🔐 All API calls server-side, Redis-cached

Every feature = Birdeye data. Try it at scan2moon.com

#BirdeyeAPI #Solana #BuildInPublic
```

---

## Superteam Earn Submission Checklist

When submitting on [Superteam Earn](https://earn.superteam.fun):

- [ ] **Project Name**: Scan2Moon
- [ ] **One-line description**: Solana token intelligence platform — Risk Scanner, Entry Radar, Paper Trading — fully powered by Birdeye API
- [ ] **Project URL**: https://scan2moon.com
- [ ] **GitHub repo** (if public): link to your repo
- [ ] **Demo video** (recommended): Screen recording walking through Risk Scanner → Entry Radar → Safe Ape trade (show that data is coming from Birdeye)
- [ ] **X posts**: Link to your #BirdeyeAPI posts (judges look at community support)
- [ ] **Technical writeup**: Paste the "Architecture" and "Endpoints Used" sections above

### Demo video script (2-3 minutes):
1. Open scan2moon.com — show the dashboard
2. Paste a token mint into Risk Scanner — show the score loading from Birdeye
3. Go to Entry Radar — show new tokens populating in real-time
4. Click a token — show the score breakdown, Entry Window, Move Potential
5. Click "Trade on Safe Ape" — show the candle chart loading (Birdeye OHLCV)
6. Show the paper trade executing with real Birdeye price validation
7. Mention: "All data — zero DexScreener, zero GeckoTerminal — 100% Birdeye"

---

## Judging Criteria Alignment

| Criteria | How Scan2Moon Scores |
|---|---|
| **Community Support** (25%) | X posts with #BirdeyeAPI, Reddit/Discord engagement, invite traders to try it |
| **Product Utility** (35%) | Complete trading toolkit (risk scan + discovery + simulation) — real user value |
| **Technical Depth** (30%) | 6 endpoints, server-side proxying, Redis caching, 12-signal scoring engine |
| **Presentation** (10%) | Clean UI, demo video, this writeup |

**Tip**: Product Utility is 35% of the score. Make sure people actually USE Scan2Moon. Share in Solana trading groups, crypto Twitter, Telegram channels. Real users = real votes.

---

*Good luck Degen! 🚀 The build is solid — now get it in front of people.*
