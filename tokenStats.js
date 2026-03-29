// UPDATED FILE: tokenStats.js
const DEXSCREENER_API = "https://api.dexscreener.com/latest/dex/tokens/";
const DEXSCREENER_PAIR_API = "https://api.dexscreener.com/latest/dex/pairs/solana/";

function formatNumber(num) {
  if (num === undefined || num === null) return "N/A";
  return Number(num).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatDate(timestamp) {
  if (!timestamp) return "N/A";
  const date = new Date(timestamp);
  return date.toLocaleString();
}

function formatPrice(price) {
  if (price === undefined || price === null) return "N/A";
  return `$${Number(price).toFixed(6)}`;
}

function formatSolPrice(price) {
  if (price === undefined || price === null) return "N/A";
  return `${Number(price).toFixed(6)} SOL`;
}

/* 🔥 NEW: Proper change formatter for change cards */
function formatChangeCard(change) {
  if (change === undefined || change === null || isNaN(change)) {
    return `<span class="change-neutral">N/A</span>`;
  }

  const value = Number(change).toFixed(2);
  const sign = change > 0 ? "+" : "";

  if (change > 0) {
    return `<span class="change-green">${sign}${value}%</span>`;
  } else if (change < 0) {
    return `<span class="change-red">${value}%</span>`;
  } else {
    return `<span class="change-neutral">${value}%</span>`;
  }
}

export async function renderTokenStats(mint) {
  const container = document.getElementById("tokenStats");
  if (!container) return;

  container.innerHTML = "Loading token stats...";

  try {
    const res = await fetch(`${DEXSCREENER_API}${mint}`);
    if (!res.ok) {
      container.innerHTML = "Market data unavailable. Try again shortly.";
      return;
    }
    const data = await res.json();

    if (!data.pairs || data.pairs.length === 0) {
      container.innerHTML = "No market data found.";
      return;
    }

    const pair =
      data.pairs.find(p => p.chainId === "solana") || data.pairs[0];

    const priceUsd = pair.priceUsd;
    const priceSol = pair.priceNative;
    const volume24h = pair.volume?.h24;

    let pairCreated = null;

    if (pair.pairAddress && pair.chainId === "solana") {
      try {
        const pairRes = await fetch(
          `${DEXSCREENER_PAIR_API}${pair.pairAddress}`
        );
        if (!pairRes.ok) throw new Error(`Pair fetch ${pairRes.status}`);
        const pairData = await pairRes.json();

        if (pairData.pairs && pairData.pairs.length > 0) {
          const rawTimestamp = pairData.pairs[0].pairCreatedAt;
          if (rawTimestamp) {
            pairCreated =
              rawTimestamp < 1000000000000
                ? rawTimestamp * 1000
                : rawTimestamp;
          }
        }
      } catch (e) {
        console.warn("Pair created fetch failed:", e);
      }
    }

    /* ================= PRICE CHANGES ================= */

    const pc5m  = pair.priceChange?.m5 ?? null;
    const pc1h  = pair.priceChange?.h1 ?? null;
    const pc6h  = pair.priceChange?.h6 ?? null;
    const pc24h = pair.priceChange?.h24 ?? null;

    let pc12h = null;
    if (pc24h !== null && pc6h !== null) {
      pc12h = pc24h - pc6h;
    }

    /* ================= BUY / SELL ================= */

    const buys24h = pair.txns?.h24?.buys || 0;
    const sells24h = pair.txns?.h24?.sells || 0;
    const totalTxns24h = buys24h + sells24h;

    const buyPercent =
      totalTxns24h > 0 ? (buys24h / totalTxns24h) * 100 : 0;
    const sellPercent = 100 - buyPercent;

    const netPressure = buys24h - sells24h;

    window.scanNetBuyPressure = {
      buys: buys24h,
      sells: sells24h,
      net: netPressure,
      buyPercent,
      sellPercent
    };

    // ✅ FIX: Expose vol24h and buys24h so saveScanToHistory can calc avgTxSize
    window.scanVol24h = volume24h || 0;
    window.scanBuys24h = buys24h;

    container.innerHTML = `
      <div class="token-stats-grid">

        <div class="stat-item">
          <span>Price in USD</span>
          <strong>${formatPrice(priceUsd)}</strong>
        </div>

        <div class="stat-item">
          <span>Price in SOL</span>
          <strong>${formatSolPrice(priceSol)}</strong>
        </div>

        <div class="stat-item">
          <span>Volume 24h</span>
          <strong>$${formatNumber(volume24h)}</strong>
        </div>

        <div class="stat-item">
          <span>Pair Created</span>
          <strong>${formatDate(pairCreated)}</strong>
        </div>

        <!-- 🔥 PRICE MOMENTUM GRID RESTORED -->
        <div class="stat-item full-width">
          <span>Price Momentum</span>

          <div class="price-changes-grid">
            <div class="change-card">
              <div class="change-time">5M</div>
              <div class="change-value">${formatChangeCard(pc5m)}</div>
            </div>

            <div class="change-card">
              <div class="change-time">1H</div>
              <div class="change-value">${formatChangeCard(pc1h)}</div>
            </div>

            <div class="change-card">
              <div class="change-time">6H</div>
              <div class="change-value">${formatChangeCard(pc6h)}</div>
            </div>

            <div class="change-card">
              <div class="change-time">12H</div>
              <div class="change-value">${formatChangeCard(pc12h)}</div>
            </div>

            <div class="change-card">
              <div class="change-time">24H</div>
              <div class="change-value">${formatChangeCard(pc24h)}</div>
            </div>
          </div>
        </div>

        <!-- BUYER / SELLER POWER -->
        <div class="stat-item full-width">
          <span>24h Buyer/Seller Power</span>

          <div class="buyer-seller-bar">
            <div class="buyers" style="width: ${buyPercent}%;"></div>
            <div class="sellers" style="width: ${sellPercent}%;"></div>
          </div>

          <div class="bar-labels">
            <span>Buyers: ${buys24h} (${buyPercent.toFixed(1)}%)</span>
            <span>Sellers: ${sells24h} (${sellPercent.toFixed(1)}%)</span>
          </div>
        </div>

      </div>
    `;

  } catch (e) {
    console.error("Failed to load token stats:", e);
    container.innerHTML = "Failed to load token stats.";
  }
}