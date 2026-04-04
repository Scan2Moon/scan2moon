/* ============================================================
   Scan2Moon – candleChart.js  (V3.0 — TradingView Lightweight Charts)

   Switched from custom Canvas2D to TradingView Lightweight Charts —
   the exact same open-source library used by DexScreener.
   Handles auto-scaling, scroll, zoom and live-candle updates natively.

   Public API is identical to V2.1 so safe-ape.js needs no changes:
     new CandleChart(containerId)
     .startLoading()
     .loadCandles(ohlcvList)   // [[ts_sec, o, h, l, c, v], ...]
     .tick(price, volume)
     .setTimeframe(tf)
     .setToken(name, symbol)
     .seedFromPair(pair)
     .destroy()
   ============================================================ */

const TF_MS = {
  "1m":  60_000,
  "5m":  300_000,
  "15m": 900_000,
  "1h":  3_600_000,
  "4h":  14_400_000,
  "1d":  86_400_000,
};

/* Price formatter — handles micro-cap tokens down to 9 decimals */
function fmtPrice(p) {
  if (!p || isNaN(p) || p <= 0) return "0";
  if (p < 0.000001)  return p.toFixed(9);
  if (p < 0.00001)   return p.toFixed(8);
  if (p < 0.0001)    return p.toFixed(7);
  if (p < 0.001)     return p.toFixed(6);
  if (p < 0.01)      return p.toFixed(5);
  if (p < 1)         return p.toFixed(4);
  if (p < 1000)      return p.toFixed(3);
  return p.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtVol(v) {
  if (!v || v <= 0) return "0";
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + "M";
  if (v >= 1_000)     return (v / 1_000).toFixed(1)     + "K";
  return v.toFixed(0);
}

export class CandleChart {

  constructor(containerId) {
    this._containerId  = containerId;
    this._container    = document.getElementById(containerId);
    this.tf            = "5m";
    this.tfMs          = TF_MS["5m"];
    this.isLoading     = false;
    this.liveCandle    = null;
    this._volData      = {};   // ts_sec → accumulated volume for live candle
    this._lastClose    = 0;    // close of last HISTORICAL candle (kept for reference, not used as live open)
    this._priceEma     = 0;    // exponential moving average — used for spike filter
    this._markers      = [];   // trade markers [{time, type}]
    this.tokenName     = "";
    this.tokenSymbol   = "";

    this._buildChart();
  }

  /* ══════════════════════════════════════
     BUILD — create chart + series + legend
  ══════════════════════════════════════ */

  _buildChart() {
    const el = this._container;
    el.style.position = "relative";   // needed for absolute overlay

    /* ── Lightweight Charts instance ── */
    this._chart = LightweightCharts.createChart(el, {
      autoSize: true,                  // fills container automatically on resize
      layout: {
        background: { type: "solid", color: "#040d0b" },
        textColor:  "rgba(207,255,244,0.45)",
        fontFamily: "'Segoe UI', system-ui, sans-serif",
        fontSize:   11,
      },
      grid: {
        vertLines: { color: "rgba(44,255,201,0.05)" },
        horzLines: { color: "rgba(44,255,201,0.05)" },
      },
      crosshair: {
        mode:     LightweightCharts.CrosshairMode.Normal,
        vertLine: { color: "rgba(207,255,244,0.22)", style: 0, width: 1, labelBackgroundColor: "#0d2820" },
        horzLine: { color: "rgba(207,255,244,0.22)", style: 0, width: 1, labelBackgroundColor: "#0d2820" },
      },
      rightPriceScale: {
        borderColor:  "rgba(44,255,201,0.12)",
        textColor:    "rgba(207,255,244,0.45)",
        scaleMargins: { top: 0.06, bottom: 0.22 },
        /* Logarithmic scale keeps post-pump candles readable — on linear
           scale a 5× pump spike forces the Y-axis to include the spike top,
           squashing all subsequent candles to near-invisible horizontal lines.
           Log scale shows percentage moves proportionally, the same way
           TradingView and DexScreener display micro-cap tokens. */
        mode: LightweightCharts.PriceScaleMode.Logarithmic,
      },
      timeScale: {
        borderColor:    "rgba(44,255,201,0.12)",
        textColor:      "rgba(207,255,244,0.45)",
        timeVisible:    true,
        secondsVisible: false,
        rightOffset:    5,
        fixRightEdge:   false,
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale:  { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });

    /* ── Candlestick series ── */
    this._candleSeries = this._chart.addCandlestickSeries({
      upColor:         "#26c98a",
      downColor:       "#ef5350",
      borderUpColor:   "#26c98a",
      borderDownColor: "#ef5350",
      wickUpColor:     "#26c98a",
      wickDownColor:   "#ef5350",
      priceFormat: {
        type:    "custom",
        minMove: 0.000000001,
        formatter: (p) => fmtPrice(p),
      },
    });

    /* ── Volume histogram (bottom 20%) ── */
    this._volSeries = this._chart.addHistogramSeries({
      color:            "rgba(38,201,138,0.4)",
      priceFormat:      { type: "volume" },
      priceScaleId:     "vol",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    this._chart.priceScale("vol").applyOptions({
      scaleMargins: { top: 0.80, bottom: 0 },
    });

    /* ── OHLCV legend bar (HTML overlay — pointer-events:none) ── */
    this._legend = document.createElement("div");
    this._legend.style.cssText = [
      "position:absolute", "top:0", "left:0", "right:72px",
      "height:26px", "padding:0 10px",
      "background:rgba(4,14,10,0.92)",
      "font:11px 'Segoe UI',system-ui,sans-serif",
      "color:rgba(207,255,244,0.55)",
      "pointer-events:none", "z-index:10",
      "display:flex", "align-items:center", "gap:10px",
      "white-space:nowrap", "overflow:hidden",
    ].join(";");
    el.appendChild(this._legend);
    this._setLegendLoading();

    /* ── Loading overlay ── */
    this._loadingEl = document.createElement("div");
    this._loadingEl.style.cssText = [
      "position:absolute", "inset:0",
      "display:flex", "align-items:center", "justify-content:center",
      "background:rgba(4,13,10,0.88)",
      "font:13px 'Segoe UI',sans-serif",
      "color:rgba(207,255,244,0.45)",
      "z-index:20", "pointer-events:none",
    ].join(";");
    this._loadingEl.textContent = "Loading chart data…";
    this._loadingEl.style.display = "none";
    el.appendChild(this._loadingEl);

    /* ── Crosshair → legend sync ── */
    this._chart.subscribeCrosshairMove((param) => {
      const c = param?.seriesData?.get(this._candleSeries);
      const v = param?.seriesData?.get(this._volSeries);
      if (c) {
        this._renderLegend(c, v?.value ?? 0);
      } else if (this.liveCandle) {
        const ts = this.liveCandle.time;
        this._renderLegend(this.liveCandle, this._volData[ts] ?? 0);
      }
    });
  }

  /* ══════════════════════════════════════
     PUBLIC API
  ══════════════════════════════════════ */

  /** Call before fetching OHLCV — shows "Loading…" and blocks ticks */
  startLoading() {
    this.isLoading  = true;
    this.liveCandle = null;
    this._volData   = {};
    this._lastClose = 0;
    this._priceEma  = 0;
    this._candleSeries.setData([]);
    this._volSeries.setData([]);
    this._loadingEl.style.display = "flex";
    this._setLegendLoading();
  }

  /** Load real OHLCV candles [[ts_sec, o, h, l, c, v], ...] */
  loadCandles(ohlcvList) {
    this.isLoading  = false;
    this.liveCandle = null;
    this._volData   = {};
    this._loadingEl.style.display = "none";

    if (!ohlcvList?.length) return;

    /* Parse and sort */
    const raw = ohlcvList
      .map(([ts, o, h, l, c, v]) => ({
        time:  Number(ts),
        open:  parseFloat(o) || 0,
        high:  parseFloat(h) || 0,
        low:   parseFloat(l) || 0,
        close: parseFloat(c) || 0,
        vol:   parseFloat(v) || 0,
      }))
      .filter(c => c.open > 0 && c.time > 0)
      .sort((a, b) => a.time - b.time);

    /* Remove duplicate timestamps — keep the latest occurrence */
    const deduped = [];
    const seen = new Set();
    for (let i = raw.length - 1; i >= 0; i--) {
      if (!seen.has(raw[i].time)) {
        seen.add(raw[i].time);
        deduped.unshift(raw[i]);
      }
    }

    /* ── CRITICAL: exclude the current (still-open) period's candle ──
       GeckoTerminal/DexScreener include the partial current period in
       their OHLCV response. That candle's Low/Open may reflect a tick
       that doesn't match DexScreener's live price feed, producing a
       giant wick. We strip it out and let tick() build the live candle
       entirely from DexScreener price ticks instead.
       Also prevents LightweightCharts "update timestamp ≤ last bar"
       error which silently stops live candle updates. */
    const nowTs    = Math.floor(Math.floor(Date.now() / this.tfMs) * this.tfMs / 1000);
    const historical = deduped.filter(c => c.time < nowTs);

    /* Remember last historical close — live candle will open here */
    this._lastClose = historical.length > 0
      ? historical[historical.length - 1].close
      : 0;

    /* ── Historical wick normalisation ────────────────────────────────
       GeckoTerminal (and occasionally DexScreener) include candles where
       a single thin-liquidity trade caused a massive wick that immediately
       reversed — these show as giant spikes that don't appear on DexScreener.
       We clip each candle's upper/lower wicks if they exceed 4× the rolling
       median candle range for the surrounding 20 candles.  This is a
       relative filter (adapts to the token's actual volatility) so it won't
       clip real wicks on genuinely volatile tokens. */
    const WINDOW = 20;
    /* 8× median range — raised from 4× so legitimate wicks during
       low-volatility consolidation don't get clipped.  True ghost-spike
       wicks (thin-liquidity data artefacts) are typically 30-100×, so
       8× still removes them while preserving real price action. */
    const WICK_LIMIT = 8;

    const normalised = historical.map((c, i) => {
      /* Build a window of surrounding candles (avoid mutating the source) */
      const start  = Math.max(0, i - WINDOW);
      const ranges = historical.slice(start, i + 1)
        .map(w => w.high - w.low)
        .sort((a, b) => a - b);
      /* Use 60th-percentile range so genuine large-wick candles don't
         inflate the baseline and hide the true outliers */
      const medRange = ranges[Math.floor(ranges.length * 0.6)] || 0;
      if (medRange <= 0) return c;

      const maxWick = medRange * WICK_LIMIT;
      const bodyTop = Math.max(c.open, c.close);
      const bodyBot = Math.min(c.open, c.close);

      const newHigh = (c.high - bodyTop) > maxWick ? bodyTop + maxWick : c.high;
      const newLow  = (bodyBot - c.low)  > maxWick ? bodyBot - maxWick : c.low;

      return (newHigh !== c.high || newLow !== c.low)
        ? { ...c, high: newHigh, low: newLow }
        : c;
    });

    const candleData = normalised.map(({ time, open, high, low, close }) => ({ time, open, high, low, close }));
    const volData    = normalised.map(c => ({
      time:  c.time,
      value: c.vol,
      color: c.close >= c.open ? "rgba(38,201,138,0.40)" : "rgba(239,83,80,0.38)",
    }));

    normalised.forEach(c => { this._volData[c.time] = c.vol; });

    this._candleSeries.setData(candleData);
    this._volSeries.setData(volData);

    /* Scroll to the right edge first, then constrain the visible window
       to the most recent 80 bars.  Without this, LW charts shows ALL
       loaded candles (up to 1 000 for MAX), making each candle only a
       few pixels wide and leaving the Y-axis dominated by a spike from
       hours/days ago.  Users can still scroll/zoom to see older data. */
    this._chart.timeScale().scrollToRealTime();
    if (historical.length > 0) {
      const viewBars = 80;
      this._chart.timeScale().setVisibleLogicalRange({
        from: Math.max(0, historical.length - viewBars),
        to:   historical.length + 5,   // +5 matches rightOffset empty space
      });
    }

    /* Re-apply trade markers after data reload */
    this._applyMarkers();

    /* Show last historical candle in legend */
    if (normalised.length > 0) {
      const last = normalised[normalised.length - 1];
      this._renderLegend(last, last.vol);
    }
  }

  /** Feed a live price tick — builds/updates the current-period candle */
  tick(price, volume) {
    if (!price || price <= 0) return;
    if (this.isLoading) return;

    /* ── Spike filter ──────────────────────────────────────────────────
       DexScreener REST API polling (every 5s) can occasionally return
       a stale or momentary bad price (e.g. 0.00452 when true price is
       0.00637).  We maintain an EMA of recent ticks and ignore ANY
       candle update (open/high/low/close) when the price deviates >8%
       from the EMA.  This prevents the candle BODY from jumping, not
       just the wicks.

       For genuine sustained moves: spikes still slowly shift the EMA
       (0.10 weight) so after ~5–6 consistent ticks at the new price
       the deviation shrinks below 8% and the candle updates normally.

       IMPORTANT: EMA is NOT reset at period boundaries — this ensures
       the filter stays active for the very first tick of each new candle. */
    if (!this._priceEma || this._priceEma <= 0) this._priceEma = price;
    const deviation = Math.abs(price - this._priceEma) / this._priceEma;
    const isSpike   = deviation > 0.08;

    if (isSpike) {
      /* Slowly adapt EMA toward even spiked prices so genuine multi-tick
         moves are eventually accepted; but don't update the candle at all. */
      this._priceEma = this._priceEma * 0.90 + price * 0.10;
      return; // ← discard this tick entirely — no candle update
    }

    /* Non-spike: update EMA normally */
    this._priceEma = this._priceEma * 0.75 + price * 0.25;

    const ts_sec = Math.floor(Math.floor(Date.now() / this.tfMs) * this.tfMs / 1000);

    if (!this.liveCandle || this.liveCandle.time !== ts_sec) {
      /* New period — open from previous live candle's close for continuity,
         or the current price if this is the very first tick after loading. */
      const prev = this.liveCandle ? this.liveCandle.close : price;
      this.liveCandle = { time: ts_sec, open: prev, high: price, low: price, close: price };
      this._volData[ts_sec] = volume || 0;
      /* Re-apply markers now that the live candle bar exists — markers placed
         at the current period during loadCandles() had no bar to attach to yet,
         causing them to snap to the wrong (last historical) candle. */
      if (this._markers.length) this._applyMarkers();
    } else {
      this.liveCandle.high  = Math.max(this.liveCandle.high, price);
      this.liveCandle.low   = Math.min(this.liveCandle.low,  price);
      this.liveCandle.close = price;
      this._volData[ts_sec] = (this._volData[ts_sec] || 0) + (volume || 0);
    }

    this._candleSeries.update(this.liveCandle);
    this._volSeries.update({
      time:  ts_sec,
      value: this._volData[ts_sec],
      color: price >= this.liveCandle.open ? "rgba(38,201,138,0.40)" : "rgba(239,83,80,0.38)",
    });

    /* Keep legend live */
    this._renderLegend(this.liveCandle, this._volData[ts_sec]);
  }

  /** Switch timeframe — clears chart so new OHLCV will be loaded.
   *  "max" is a virtual TF: uses 1d candle buckets for the live ticker. */
  setTimeframe(tf) {
    /* "max" maps to 1d intervals for live-candle period calculation */
    const effectiveTf = (tf === "max") ? "1d" : tf;
    if (!TF_MS[effectiveTf]) return;
    this.tf         = tf;
    this.tfMs       = TF_MS[effectiveTf];
    this.liveCandle = null;
    this._volData   = {};
    this._lastClose = 0;
    this._priceEma  = 0;
    /* Markers persist across TF changes — _applyMarkers() is called
       again inside loadCandles() once the new data arrives. */
  }

  setToken(name, symbol) {
    this.tokenName   = name;
    this.tokenSymbol = symbol;
  }

  /** Fallback: approximate candles from DexScreener percentage changes */
  seedFromPair(pair) {
    this.isLoading = false;
    this._loadingEl.style.display = "none";
    const price = parseFloat(pair.priceUsd || "0");
    if (!price) return;

    const pc1h  = pair.priceChange?.h1  ?? 0;
    const pc6h  = pair.priceChange?.h6  ?? 0;
    const pc24h = pair.priceChange?.h24 ?? 0;
    const vol24h= pair.volume?.h24      ?? 0;

    const now     = Date.now();
    const numC    = this.tf === "1m" ? 60 : this.tf === "5m" ? 60
                  : this.tf === "15m" ? 60 : this.tf === "1h" ? 48
                  : this.tf === "4h"  ? 42 : 30;
    const firstTs = Math.floor(now / this.tfMs) * this.tfMs - (numC - 1) * this.tfMs;
    const p1h     = pc1h  !== 0 ? price / (1 + pc1h  / 100) : price;
    const p6h     = pc6h  !== 0 ? price / (1 + pc6h  / 100) : price;
    const p24h    = pc24h !== 0 ? price / (1 + pc24h / 100) : price;
    const volPer  = vol24h / 24 / (3_600_000 / this.tfMs) || 1;
    const n       = 0.012;

    const candleData = [];
    const volData    = [];

    for (let i = 0; i < numC - 1; i++) {
      const t    = firstTs + i * this.tfMs;
      const ago  = now - t;
      let base;
      if      (ago > 6 * 3_600_000) base = p24h + (p6h - p24h) * ((ago - 6*3_600_000) / (18*3_600_000));
      else if (ago > 1 * 3_600_000) base = p6h  + (p1h - p6h)  * ((ago - 1*3_600_000) / (5*3_600_000));
      else                           base = p1h  + (price - p1h) * (1 - ago / 3_600_000);

      const o  = base * (1 + (Math.random() * n - n / 2));
      const c  = base * (1 + (Math.random() * n - n / 2));
      const hi = Math.max(o, c) * (1 + Math.random() * n * 0.5);
      const lo = Math.min(o, c) * (1 - Math.random() * n * 0.5);
      const v  = volPer * (0.4 + Math.random() * 1.2);
      const ts = Math.floor(t / 1000);

      candleData.push({ time: ts, open: o, high: hi, low: lo, close: c });
      volData.push({ time: ts, value: v, color: c >= o ? "rgba(38,201,138,0.40)" : "rgba(239,83,80,0.38)" });
    }

    this._candleSeries.setData(candleData);
    this._volSeries.setData(volData);
    this._chart.timeScale().scrollToRealTime();
  }

  destroy() {
    if (this._chart)     this._chart.remove();
    if (this._legend     && this._legend.parentElement)    this._legend.remove();
    if (this._loadingEl  && this._loadingEl.parentElement) this._loadingEl.remove();
  }

  /* ══════════════════════════════════════
     TRADE MARKERS  (B / S on the chart)
  ══════════════════════════════════════ */

  /**
   * Load all trade markers for the current token at once.
   * Call this after initChart() when profile data is available.
   * Stores the original epoch-ms timestamp so markers can be correctly
   * re-snapped whenever the timeframe changes.
   * @param {Array}  trades  — profile.trades array
   * @param {string} mint    — current token mint address
   */
  setTradeMarkers(trades, mint) {
    if (!trades || !mint) return;
    this._markers = trades
      .filter(t => t.mint === mint)
      .map(t => ({
        rawMs: new Date(t.timestamp).getTime(), // original epoch ms — never TF-specific
        type:  t.type, // 'buy' | 'sell'
      }));
    this._applyMarkers();
  }

  /**
   * Add a single marker right now (called on live trade).
   * @param {'buy'|'sell'} type
   */
  addTradeMarker(type) {
    this._markers.push({ rawMs: Date.now(), type });
    this._applyMarkers();
  }

  /** Internal — snaps marker times to the CURRENT TF period boundary and
   *  pushes to LightweightCharts.  Called after every data load and after
   *  every trade, so markers always sit on the correct candle regardless
   *  of which timeframe the user has selected. */
  _applyMarkers() {
    if (!this._markers.length) return;

    /* Snap each raw epoch-ms to the start of its candle period in the
       current timeframe, then deduplicate same-candle+same-type entries
       (keep last occurrence so the most recent trade "wins"). */
    const snapped = this._markers.map(m => ({
      time:  Math.floor(Math.floor(m.rawMs / this.tfMs) * this.tfMs / 1000),
      type:  m.type,
      rawMs: m.rawMs,   // keep for dedup: "last wins"
    }));

    /* Deduplicate: for the same (time, type) pair keep only the latest rawMs */
    const dedupMap = new Map();
    for (const m of snapped) {
      const key = `${m.time}:${m.type}`;
      if (!dedupMap.has(key) || m.rawMs > dedupMap.get(key).rawMs) {
        dedupMap.set(key, m);
      }
    }

    const lwMarkers = [...dedupMap.values()]
      .sort((a, b) => a.time - b.time || (a.type === "buy" ? -1 : 1))
      .map(m => ({
        time:     m.time,
        position: m.type === "buy" ? "belowBar" : "aboveBar",
        color:    m.type === "buy" ? "#2cffc9"  : "#ff4d6d",
        shape:    m.type === "buy" ? "arrowUp"  : "arrowDown",
        text:     m.type === "buy" ? "B"        : "S",
        size:     1.2,
      }));
    try {
      this._candleSeries.setMarkers(lwMarkers);
    } catch {}  // silently ignore if chart was just destroyed
  }

  /* ══════════════════════════════════════
     LEGEND HELPERS
  ══════════════════════════════════════ */

  _setLegendLoading() {
    const sym = this.tokenSymbol || "TOKEN";
    const tf  = this.tf.toUpperCase();
    this._legend.innerHTML =
      `<span style="color:rgba(207,255,244,0.65);font-weight:700">${sym} · ${tf}</span>` +
      `<span style="color:rgba(207,255,244,0.3)">Loading…</span>`;
  }

  _renderLegend(c, vol) {
    if (!c) return;
    const isUp = c.close >= c.open;
    const col  = isUp ? "#26c98a" : "#ef5350";
    const chg  = c.open > 0 ? ((c.close - c.open) / c.open * 100) : 0;
    const sign = chg >= 0 ? "+" : "";
    const sym  = this.tokenSymbol || "TOKEN";
    const tf   = this.tf.toUpperCase();

    this._legend.innerHTML =
      `<span style="color:rgba(207,255,244,0.65);font-weight:700;margin-right:4px">${sym} · ${tf}</span>` +
      `<span style="color:rgba(207,255,244,0.4)">O</span> <b style="color:${col}">${fmtPrice(c.open)}</b>` +
      `<span style="color:rgba(207,255,244,0.4)"> H</span> <b style="color:${col}">${fmtPrice(c.high)}</b>` +
      `<span style="color:rgba(207,255,244,0.4)"> L</span> <b style="color:${col}">${fmtPrice(c.low)}</b>` +
      `<span style="color:rgba(207,255,244,0.4)"> C</span> <b style="color:${col}">${fmtPrice(c.close)}</b>` +
      `<span style="color:rgba(207,255,244,0.4)"> V</span> <b style="color:rgba(207,255,244,0.65)">${fmtVol(vol)}</b>` +
      `<b style="color:${col};margin-left:4px">${sign}${chg.toFixed(2)}%</b>`;
  }
}
