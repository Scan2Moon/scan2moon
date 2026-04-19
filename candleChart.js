/* ============================================================
   Scan2Moon – candleChart.js  (V4.0 — Drawing Tools)

   Built on TradingView Lightweight Charts (same engine as DexScreener).
   V4 adds a professional drawing toolbar:
     • Horizontal lines  — click once to lock a price level
     • Trend lines       — click two points to draw an angle
     • Manual Buy/Sell   — click a candle to stamp an arrow
     • Eraser            — click a line/marker to remove it
     • Clear All         — wipe all drawings in one click

   Public API (unchanged from V3):
     new CandleChart(containerId)
     .startLoading()
     .loadCandles(ohlcvList)   // [[ts_sec, o, h, l, c, v], ...]
     .tick(price, volume)
     .setTimeframe(tf)
     .setToken(name, symbol)
     .seedFromPair(pair)
     .setTradeMarkers(trades, mint)
     .addTradeMarker(type)
     .clearDrawings()
     .destroy()
   ============================================================ */

const TF_MS = {
  "1m":  60_000,
  "5m":  300_000,
  "15m": 900_000,
  "1h":  3_600_000,
  "4h":  14_400_000,
  "12h": 43_200_000,
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

/* SVG icons for toolbar */
const ICONS = {
  cursor:    `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 9-7 1-4 7L5 3z"/></svg>`,
  hline:     `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="2" y1="12" x2="22" y2="12"/><line x1="19" y1="8" x2="19" y2="16"/><line x1="5" y1="8" x2="5" y2="16"/></svg>`,
  trendline: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="4" y1="20" x2="20" y2="4"/><circle cx="4" cy="20" r="2.2" fill="currentColor"/><circle cx="20" cy="4" r="2.2" fill="currentColor"/></svg>`,
  eraser:    `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 20H7L3 16l11-11 6 6-3.5 3.5"/><path d="M6.5 17.5l4-4"/></svg>`,
  trash:     `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`,
};

const TOOL_HINTS = {
  cursor:      "",
  hline:       "Click on chart to place a horizontal price level",
  trendline:   "Click first point — then click second point to complete",
  buy_marker:  "Click on a candle to stamp a BUY entry arrow",
  sell_marker: "Click on a candle to stamp a SELL / EXIT arrow",
  eraser:      "Click a line or marker to remove it",
};

export class CandleChart {

  constructor(containerId) {
    this._containerId  = containerId;
    this._container    = document.getElementById(containerId);
    this.tf            = "5m";
    this.tfMs          = TF_MS["5m"];
    this.isLoading     = false;
    this.liveCandle    = null;
    this._volData      = {};
    this._lastClose    = 0;
    this._priceEma     = 0;

    /* Trade markers (from profile.trades) */
    this._markers      = [];

    /* Manual drawing tools state */
    this._drawings     = [];        // [{type:'hline'|'trendline', ref, price?}]
    this._manualMarkers = [];       // [{rawMs, type:'buy'|'sell'}]
    this._drawingTool  = "cursor";  // current active tool
    this._trendStart   = null;      // first click for trend line

    this.tokenName     = "";
    this.tokenSymbol   = "";

    this._buildChart();
  }

  /* ══════════════════════════════════════
     BUILD — chart + toolbar + overlays
  ══════════════════════════════════════ */

  _buildChart() {
    const el = this._container;
    /* Container becomes a flex column: toolbar on top, chart canvas below */
    el.style.cssText = "display:flex;flex-direction:column;width:100%;height:100%;position:relative;";

    /* ── Drawing toolbar (above the chart canvas) ── */
    this._buildToolbar();

    /* ── Inner canvas div — chart renders here, not on the full container ── */
    this._chartEl = document.createElement("div");
    this._chartEl.style.cssText = "flex:1;min-height:0;width:100%;position:relative;overflow:hidden;";
    el.appendChild(this._chartEl);

    /* ── Lightweight Charts instance (on inner div, not the toolbar container) ── */
    this._chart = LightweightCharts.createChart(this._chartEl, {
      autoSize: true,
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
        type:      "custom",
        minMove:   0.000000001,
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

    /* ── OHLCV legend bar ── */
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
    this._chartEl.appendChild(this._legend);
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
    this._chartEl.appendChild(this._loadingEl);

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

    /* ── Chart click → drawing tools ── */
    this._chart.subscribeClick((param) => {
      this._handleChartClick(param);
    });
  }

  /* ══════════════════════════════════════
     DRAWING TOOLBAR
  ══════════════════════════════════════ */

  _buildToolbar() {
    const tb = document.createElement("div");
    tb.className = "sa-draw-toolbar";
    tb.innerHTML = `
      <div class="sa-draw-group">
        <button class="sa-draw-btn active" data-tool="cursor" title="Select / Crosshair">${ICONS.cursor}</button>
        <button class="sa-draw-btn" data-tool="hline"     title="Horizontal Level">${ICONS.hline}</button>
        <button class="sa-draw-btn" data-tool="trendline" title="Trend Line">${ICONS.trendline}</button>
      </div>
      <div class="sa-draw-sep"></div>
      <div class="sa-draw-group">
        <button class="sa-draw-btn sa-draw-buy"  data-tool="buy_marker"  title="Mark Buy Entry">B▲</button>
        <button class="sa-draw-btn sa-draw-sell" data-tool="sell_marker" title="Mark Sell / Exit">S▼</button>
      </div>
      <div class="sa-draw-sep"></div>
      <div class="sa-draw-group">
        <button class="sa-draw-btn" data-tool="eraser" title="Erase drawing">${ICONS.eraser}</button>
        <button class="sa-draw-btn sa-draw-clear" data-action="clear" title="Clear all drawings">${ICONS.trash}</button>
      </div>
      <div class="sa-draw-hint" id="${this._containerId}-hint"></div>
    `;

    /* Tool button listeners */
    tb.querySelectorAll(".sa-draw-btn[data-tool]").forEach(btn => {
      btn.addEventListener("click", () => this._setTool(btn.dataset.tool));
    });

    /* Clear all */
    tb.querySelector("[data-action='clear']")
      ?.addEventListener("click", () => this.clearDrawings());

    this._toolbar = tb;
    this._container.appendChild(tb);
  }

  _setTool(tool) {
    this._drawingTool = tool;
    this._trendStart  = null;

    /* Highlight active button */
    this._toolbar.querySelectorAll(".sa-draw-btn[data-tool]").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.tool === tool);
    });

    /* Hint text */
    const hintEl = document.getElementById(`${this._containerId}-hint`);
    if (hintEl) hintEl.textContent = TOOL_HINTS[tool] || "";

    /* Reset trend-line hint if we switch away */
    if (tool !== "trendline") this._trendStart = null;
  }

  /* ══════════════════════════════════════
     CLICK HANDLER
  ══════════════════════════════════════ */

  _handleChartClick(param) {
    if (this._drawingTool === "cursor") return;
    if (!param?.point) return;

    const price = this._candleSeries.coordinateToPrice(param.point.y);
    if (!price || price <= 0) return;

    const time  = param.time ?? Math.floor(Date.now() / 1000);

    switch (this._drawingTool) {
      case "hline":
        this._drawHLine(price);
        break;

      case "trendline":
        this._handleTrendClick(time, price);
        break;

      case "buy_marker":
      case "sell_marker": {
        const type = this._drawingTool === "buy_marker" ? "buy" : "sell";
        this._manualMarkers.push({ rawMs: time * 1000, type });
        this._applyMarkers();
        break;
      }

      case "eraser":
        this._eraseNear(price, time);
        break;
    }
  }

  /* ── Horizontal line ── */
  _drawHLine(price) {
    /* Cycle through 4 colours for multiple levels */
    const PALETTE = [
      "rgba(255,180,50,0.8)",   // amber
      "rgba(44,255,201,0.75)",  // mint
      "rgba(192,132,252,0.8)",  // purple
      "rgba(251,113,133,0.8)",  // pink
    ];
    const col = PALETTE[this._drawings.filter(d => d.type === "hline").length % PALETTE.length];

    const priceLine = this._candleSeries.createPriceLine({
      price,
      color:            col,
      lineWidth:        1,
      lineStyle:        LightweightCharts.LineStyle.Dashed,
      axisLabelVisible: true,
      title:            fmtPrice(price),
    });
    this._drawings.push({ type: "hline", ref: priceLine, price });
  }

  /* ── Trend line — two-click ── */
  _handleTrendClick(time, price) {
    const hintEl = document.getElementById(`${this._containerId}-hint`);

    if (!this._trendStart) {
      /* First point — save and wait */
      this._trendStart = { time, price };
      if (hintEl) hintEl.textContent = "✓ First point set — click second point to finish";

      /* Visual indicator dot */
      this._trendDot = this._chart.addLineSeries({
        color:                   "rgba(192,132,252,0.6)",
        lineWidth:               1,
        lastValueVisible:        false,
        priceLineVisible:        false,
        crosshairMarkerVisible:  false,
        crosshairMarkerRadius:   4,
      });
      this._trendDot.setData([{ time, value: price }]);
      return;
    }

    /* Second point — draw line */
    const start = this._trendStart;
    this._trendStart = null;
    if (hintEl) hintEl.textContent = TOOL_HINTS.trendline;

    /* Remove dot */
    if (this._trendDot) {
      try { this._chart.removeSeries(this._trendDot); } catch {}
      this._trendDot = null;
    }

    /* Don't draw a zero-length line */
    if (start.time === time) return;

    const lineSeries = this._chart.addLineSeries({
      color:                  "rgba(192,132,252,0.8)",
      lineWidth:              1,
      lineStyle:              LightweightCharts.LineStyle.Solid,
      lastValueVisible:       false,
      priceLineVisible:       false,
      crosshairMarkerVisible: false,
    });

    const pts = [
      { time: start.time, value: start.price },
      { time,             value: price        },
    ].sort((a, b) => a.time - b.time);

    lineSeries.setData(pts);
    this._drawings.push({ type: "trendline", ref: lineSeries });
  }

  /* ── Eraser ── */
  _eraseNear(price, time) {
    /* 1. Try horizontal lines by price proximity (within 1.5%) */
    let bestIdx  = -1;
    let bestDist = Infinity;

    this._drawings.forEach((d, i) => {
      if (d.type === "hline" && d.price > 0) {
        const dist = Math.abs(d.price - price) / d.price;
        if (dist < 0.015 && dist < bestDist) { bestDist = dist; bestIdx = i; }
      }
    });

    if (bestIdx >= 0) {
      const d = this._drawings[bestIdx];
      try { this._candleSeries.removePriceLine(d.ref); } catch {}
      this._drawings.splice(bestIdx, 1);
      return;
    }

    /* 2. Try trend lines by end-point proximity */
    bestIdx = -1; bestDist = Infinity;
    this._drawings.forEach((d, i) => {
      if (d.type === "trendline") { bestIdx = i; }  // last trendline is most likely target
    });
    if (bestIdx >= 0) {
      const d = this._drawings[bestIdx];
      try { this._chart.removeSeries(d.ref); } catch {}
      this._drawings.splice(bestIdx, 1);
      return;
    }

    /* 3. Try manual markers */
    if (this._manualMarkers.length) {
      let markerIdx = -1; let markerDist = Infinity;
      const tfSec = this.tfMs / 1000;
      this._manualMarkers.forEach((m, i) => {
        const mTime = Math.floor(Math.floor(m.rawMs / this.tfMs) * this.tfMs / 1000);
        const dist  = Math.abs(mTime - time);
        if (dist < tfSec * 2 && dist < markerDist) { markerDist = dist; markerIdx = i; }
      });
      if (markerIdx >= 0) {
        this._manualMarkers.splice(markerIdx, 1);
        this._applyMarkers();
      }
    }
  }

  /* ── Clear all ── */
  clearDrawings() {
    this._drawings.forEach(d => {
      try {
        if (d.type === "hline")     this._candleSeries.removePriceLine(d.ref);
        if (d.type === "trendline") this._chart.removeSeries(d.ref);
      } catch {}
    });
    this._drawings      = [];
    this._manualMarkers = [];
    this._trendStart    = null;
    if (this._trendDot) {
      try { this._chart.removeSeries(this._trendDot); } catch {}
      this._trendDot = null;
    }
    this._applyMarkers();
  }

  /* ══════════════════════════════════════
     PUBLIC API
  ══════════════════════════════════════ */

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
    /* Re-apply drawings on new token load */
  }

  loadCandles(ohlcvList) {
    this.isLoading  = false;
    this.liveCandle = null;
    this._volData   = {};
    this._loadingEl.style.display = "none";

    if (!ohlcvList?.length) return;

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

    /* Remove duplicate timestamps */
    const deduped = [];
    const seen = new Set();
    for (let i = raw.length - 1; i >= 0; i--) {
      if (!seen.has(raw[i].time)) {
        seen.add(raw[i].time);
        deduped.unshift(raw[i]);
      }
    }

    /* Exclude the still-open current-period candle */
    const nowTs      = Math.floor(Math.floor(Date.now() / this.tfMs) * this.tfMs / 1000);
    const historical = deduped.filter(c => c.time < nowTs);

    this._lastClose = historical.length > 0 ? historical[historical.length - 1].close : 0;

    /* Wick normalisation — clip spikes > 8× rolling median range */
    const WINDOW = 20, WICK_LIMIT = 8;
    const normalised = historical.map((c, i) => {
      const start  = Math.max(0, i - WINDOW);
      const ranges = historical.slice(start, i + 1)
        .map(w => w.high - w.low).sort((a, b) => a - b);
      const medRange = ranges[Math.floor(ranges.length * 0.6)] || 0;
      if (medRange <= 0) return c;
      const maxWick = medRange * WICK_LIMIT;
      const bodyTop = Math.max(c.open, c.close);
      const bodyBot = Math.min(c.open, c.close);
      const newHigh = (c.high - bodyTop) > maxWick ? bodyTop + maxWick : c.high;
      const newLow  = (bodyBot - c.low)  > maxWick ? bodyBot - maxWick : c.low;
      return (newHigh !== c.high || newLow !== c.low) ? { ...c, high: newHigh, low: newLow } : c;
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

    if (historical.length > 0) {
      /* Show last ~60 bars by default so recent candles are large and readable.
         User can freely scroll left to see full history.
         1m → 60 bars = 1 hour, 5m → 60 bars = 5 hours, 15m → 60 bars = 15 hours */
      const viewBars = Math.min(60, historical.length);
      this._chart.timeScale().setVisibleLogicalRange({
        from: Math.max(0, historical.length - viewBars),
        to:   historical.length + 2,
      });
    } else {
      this._chart.timeScale().scrollToRealTime();
    }

    this._applyMarkers();

    if (normalised.length > 0) {
      const last = normalised[normalised.length - 1];
      this._renderLegend(last, last.vol);
    }
  }

  tick(price, volume) {
    if (!price || price <= 0) return;
    if (this.isLoading) return;

    if (!this._priceEma || this._priceEma <= 0) this._priceEma = price;
    const deviation = Math.abs(price - this._priceEma) / this._priceEma;
    const isSpike   = deviation > 0.08;

    if (isSpike) {
      this._priceEma = this._priceEma * 0.90 + price * 0.10;
      return;
    }
    this._priceEma = this._priceEma * 0.75 + price * 0.25;

    const ts_sec = Math.floor(Math.floor(Date.now() / this.tfMs) * this.tfMs / 1000);

    if (!this.liveCandle || this.liveCandle.time !== ts_sec) {
      /* Open the new live candle at the last historical close so there's no gap.
         Fall back to current price only if we have no prior close data.        */
      const prev = this.liveCandle
        ? this.liveCandle.close
        : (this._lastClose > 0 ? this._lastClose : price);
      this.liveCandle = { time: ts_sec, open: prev, high: Math.max(prev, price), low: Math.min(prev, price), close: price };
      this._volData[ts_sec] = volume || 0;
      if (this._markers.length || this._manualMarkers.length) this._applyMarkers();
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

    this._renderLegend(this.liveCandle, this._volData[ts_sec]);
  }

  setTimeframe(tf) {
    const effectiveTf = (tf === "max") ? "1d" : tf;
    if (!TF_MS[effectiveTf]) return;
    this.tf         = tf;
    this.tfMs       = TF_MS[effectiveTf];
    this.liveCandle = null;
    this._volData   = {};
    this._lastClose = 0;
    this._priceEma  = 0;
    this._trendStart = null;
  }

  setToken(name, symbol) {
    this.tokenName   = name;
    this.tokenSymbol = symbol;
    /* Clear drawings when switching tokens */
    this.clearDrawings();
  }

  seedFromPair(pair) {
    this.isLoading = false;
    this._loadingEl.style.display = "none";
    const price = parseFloat(pair.priceUsd || "0");
    if (!price) return;

    const pc1h   = pair.priceChange?.h1  ?? 0;
    const pc6h   = pair.priceChange?.h6  ?? 0;
    const pc24h  = pair.priceChange?.h24 ?? 0;
    const vol24h = pair.volume?.h24      ?? 0;

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
      if      (ago > 6 * 3_600_000) base = p24h + (p6h  - p24h) * ((ago - 6*3_600_000) / (18*3_600_000));
      else if (ago > 1 * 3_600_000) base = p6h  + (p1h  - p6h)  * ((ago - 1*3_600_000) / (5*3_600_000));
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
    if (this._toolbar    && this._toolbar.parentElement)    this._toolbar.remove();
    if (this._chartEl    && this._chartEl.parentElement)    this._chartEl.remove();
    if (this._legend     && this._legend.parentElement)     this._legend.remove();
    if (this._loadingEl  && this._loadingEl.parentElement)  this._loadingEl.remove();
    /* Reset container style so next init starts clean */
    if (this._container) this._container.style.cssText = "";
  }

  /* ══════════════════════════════════════
     TRADE MARKERS (profile.trades)
  ══════════════════════════════════════ */

  setTradeMarkers(trades, mint) {
    if (!trades || !mint) return;
    this._markers = trades
      .filter(t => t.mint === mint)
      .map(t => ({
        rawMs: new Date(t.timestamp).getTime(),
        type:  t.type,
      }));
    this._applyMarkers();
  }

  addTradeMarker(type) {
    this._markers.push({ rawMs: Date.now(), type });
    this._applyMarkers();
  }

  _applyMarkers() {
    /* Combine profile trade markers + manually drawn markers */
    const allRaw = [...this._markers, ...this._manualMarkers];
    if (!allRaw.length) {
      try { this._candleSeries.setMarkers([]); } catch {}
      return;
    }

    const snapped = allRaw.map(m => ({
      time:  Math.floor(Math.floor(m.rawMs / this.tfMs) * this.tfMs / 1000),
      type:  m.type,
      rawMs: m.rawMs,
    }));

    /* Dedup: same (time, type) → keep latest */
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

    try { this._candleSeries.setMarkers(lwMarkers); } catch {}
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
