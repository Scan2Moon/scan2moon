// bubbleMap.js — Scan2Moon Bubble Map
// Full-screen overlay with canvas-based physics bubble simulation.
// Each bubble = a token; size = market cap (log scale); color = price change.
// Physics: bubbles drift toward their % change x-position and repel each other.

const BUBBLE_API = "/.netlify/functions/bubbleData";

/* ══════════════════════════════════════════════════════════════
   COLOUR & GEOMETRY HELPERS
══════════════════════════════════════════════════════════════ */
function changeColor(pct) {
  if (pct == null) return { base: "#4a4a4a", light: "#666666", glow: "rgba(100,100,100,0.4)" };
  const t = Math.max(-1, Math.min(1, pct / 80)); // saturate at ±80%
  let r, g, b;
  if (t >= 0) {
    r = Math.round(0x0a + (0x00 - 0x0a) * t);
    g = Math.round(0x80 + (0xff - 0x80) * t);
    b = Math.round(0x50 + (0x88 - 0x50) * t);
  } else {
    const u = -t;
    r = Math.round(0x0a + (0xff - 0x0a) * u);
    g = Math.round(0x80 + (0x22 - 0x80) * u);
    b = Math.round(0x50 + (0x00 - 0x50) * u);
  }
  const hex = `#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${b.toString(16).padStart(2,"0")}`;
  const lighten = (c, v) => {
    const rr = Math.min(255, Math.round(parseInt(c.slice(1,3),16) + v));
    const gg = Math.min(255, Math.round(parseInt(c.slice(3,5),16) + v));
    const bb = Math.min(255, Math.round(parseInt(c.slice(5,7),16) + v));
    return `#${rr.toString(16).padStart(2,"0")}${gg.toString(16).padStart(2,"0")}${bb.toString(16).padStart(2,"0")}`;
  };
  return {
    base:  hex,
    light: lighten(hex, 60),
    glow:  `rgba(${r},${g},${b},0.45)`,
  };
}

function mcToRadius(mc, min = 22, max = 78) {
  if (!mc || mc <= 0) return min;
  const logMc = Math.log10(mc);
  const t = Math.max(0, Math.min(1, (logMc - 4) / 6.5)); // $10K→$5B range
  return min + t * (max - min);
}

function changeToTargetX(change, width) {
  if (change == null) return width / 2;
  const sign = change >= 0 ? 1 : -1;
  const abs  = Math.abs(change);
  const logv = abs > 0 ? Math.log10(abs + 1) * 0.65 : 0; // 0 → ~2
  const ratio = sign * Math.min(logv / 2, 1);             // −1 → +1
  return width * (0.5 + ratio * 0.40);
}

function fmtPctBubble(v) {
  if (v == null) return "—";
  const abs = Math.abs(v), sign = v >= 0 ? "+" : "-";
  if (abs >= 1_000_000) return `${sign}${(abs/1_000_000).toFixed(1)}M%`;
  if (abs >= 10_000)    return `${sign}${Math.round(abs/1_000)}K%`;
  if (abs >= 1_000)     return `${sign}${(abs/1_000).toFixed(1)}K%`;
  return `${sign}${abs.toFixed(1)}%`;
}

function fmtBigBubble(n) {
  if (!n || n === 0) return "—";
  if (n >= 1e9) return `$${(n/1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n/1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n/1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

/* ══════════════════════════════════════════════════════════════
   PHYSICS SIMULATION
══════════════════════════════════════════════════════════════ */
class BubbleSim {
  constructor(bubbles, width, height) {
    this.W = width;
    this.H = height;
    // Place bubbles randomly, weighted toward their target X
    this.items = bubbles.map(b => {
      const tx = changeToTargetX(b.change, width);
      return {
        ...b,
        x:  tx + (Math.random() - 0.5) * width  * 0.4,
        y:  height / 2 + (Math.random() - 0.5) * height * 0.6,
        vx: 0,
        vy: 0,
        tx, // target x
        ty: height / 2,
      };
    });
    this.frame = 0;
  }

  step() {
    const { W, H, items } = this;
    const ATTRACT  = 0.018;  // pull toward target x
    const ATTRACT_Y= 0.006;  // pull toward vertical center
    const DAMPING  = 0.86;
    const REPEL    = 3.5;
    const PADDING  = 4;

    // Apply forces
    for (const b of items) {
      b.vx += (b.tx - b.x) * ATTRACT;
      b.vy += (b.ty - b.y) * ATTRACT_Y;
    }

    // Pairwise repulsion (O(n²) — fine for 100 bubbles)
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i], bb = items[j];
        const dx = bb.x - a.x, dy = bb.y - a.y;
        const d2 = dx * dx + dy * dy;
        const minD = a.r + bb.r + PADDING;
        if (d2 < minD * minD && d2 > 0.01) {
          const d = Math.sqrt(d2);
          const f = REPEL * (minD - d) / minD;
          const nx = dx / d, ny = dy / d;
          a.vx  -= nx * f; a.vy  -= ny * f;
          bb.vx += nx * f; bb.vy += ny * f;
        }
      }
    }

    // Integrate + bounds
    for (const b of items) {
      b.vx *= DAMPING;
      b.vy *= DAMPING;
      b.x  += b.vx;
      b.y  += b.vy;
      const margin = b.r + 2;
      b.x = Math.max(margin, Math.min(W - margin, b.x));
      b.y = Math.max(margin, Math.min(H - margin, b.y));
    }

    this.frame++;
  }

  hitTest(mx, my) {
    for (const b of this.items) {
      const dx = b.x - mx, dy = b.y - my;
      if (dx * dx + dy * dy <= b.r * b.r) return b;
    }
    return null;
  }
}

/* ══════════════════════════════════════════════════════════════
   CANVAS RENDERER
══════════════════════════════════════════════════════════════ */
function drawFrame(ctx, sim, hovered, W, H) {
  // Background — radial glow
  ctx.clearRect(0, 0, W, H);
  const bg = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, Math.max(W, H) * 0.7);
  bg.addColorStop(0,   "rgba(10,42,28,1)");
  bg.addColorStop(0.6, "rgba(4,13,8,1)");
  bg.addColorStop(1,   "rgba(2,8,4,1)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Zero-line (center)
  ctx.save();
  ctx.setLineDash([4, 8]);
  ctx.strokeStyle = "rgba(44,255,201,0.08)";
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(W / 2, 20);
  ctx.lineTo(W / 2, H - 20);
  ctx.stroke();
  ctx.restore();

  // "LOSERS ←" and "→ GAINERS" axis labels
  ctx.save();
  ctx.font      = "bold 11px 'Inter', monospace";
  ctx.textBaseline = "top";
  ctx.fillStyle = "rgba(255,60,60,0.35)";
  ctx.textAlign = "left";
  ctx.fillText("↙ LOSERS", 16, 14);
  ctx.fillStyle = "rgba(44,255,120,0.35)";
  ctx.textAlign = "right";
  ctx.fillText("GAINERS ↗", W - 16, 14);
  ctx.restore();

  // Draw bubbles — normal first, hovered on top
  const toRender = [...sim.items].sort((a, b) => (a === hovered ? 1 : b === hovered ? -1 : 0));
  for (const b of toRender) {
    const isHov = b === hovered;
    const colors = b._colors;
    const r = isHov ? b.r * 1.08 : b.r;

    ctx.save();

    // Glow
    if (isHov || b.r > 35) {
      ctx.shadowColor = colors.glow;
      ctx.shadowBlur  = isHov ? 28 : 14;
    }

    // Radial gradient fill
    const cx = b.x - r * 0.28, cy = b.y - r * 0.28;
    const grad = ctx.createRadialGradient(cx, cy, r * 0.05, b.x, b.y, r);
    grad.addColorStop(0,    colors.light);
    grad.addColorStop(0.55, colors.base);
    grad.addColorStop(1,    colors.base + "bb");
    ctx.beginPath();
    ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Border ring
    ctx.shadowBlur = 0;
    ctx.strokeStyle = isHov ? "rgba(255,255,255,0.55)" : colors.base + "66";
    ctx.lineWidth   = isHov ? 2 : 1;
    ctx.stroke();

    // Inner highlight arc
    const hiGrad = ctx.createLinearGradient(b.x - r, b.y - r, b.x + r * 0.3, b.y + r * 0.3);
    hiGrad.addColorStop(0, "rgba(255,255,255,0.18)");
    hiGrad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.beginPath();
    ctx.arc(b.x, b.y, r - 1, 0, Math.PI * 2);
    ctx.fillStyle = hiGrad;
    ctx.fill();

    // Symbol text
    const symFontSize = Math.max(9, Math.min(r * 0.38, 18));
    ctx.shadowColor = "rgba(0,0,0,0.7)";
    ctx.shadowBlur  = 4;
    ctx.font = `bold ${symFontSize}px 'Inter', sans-serif`;
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle    = "#ffffff";

    const sym = (b.symbol || "?").slice(0, 6);
    const chgStr = fmtPctBubble(b.change);
    const hasChg = r >= 28;

    ctx.fillText(sym, b.x, hasChg ? b.y - symFontSize * 0.55 : b.y);

    if (hasChg) {
      const chgFontSize = Math.max(7, symFontSize * 0.72);
      ctx.shadowBlur = 3;
      ctx.font = `${chgFontSize}px 'Inter', sans-serif`;
      ctx.fillStyle = b.change >= 0 ? "#aaffcc" : "#ffaaaa";
      ctx.fillText(chgStr, b.x, b.y + chgFontSize * 0.9);
    }

    ctx.restore();
  }
}

/* ══════════════════════════════════════════════════════════════
   TOOLTIP
══════════════════════════════════════════════════════════════ */
function positionTooltip(tooltip, bub, W, H, canvasRect) {
  tooltip.style.display = "block";
  const tw = tooltip.offsetWidth  || 200;
  const th = tooltip.offsetHeight || 120;
  let lx = bub.x + bub.r + 12;
  let ly = bub.y - th / 2;
  if (lx + tw > W - 10) lx = bub.x - bub.r - tw - 12;
  if (ly < 10)           ly = 10;
  if (ly + th > H - 10)  ly = H - th - 10;
  tooltip.style.left = lx + "px";
  tooltip.style.top  = ly + "px";
}

function updateTooltip(tooltip, bub) {
  const chg = bub.change;
  const cls = chg >= 0 ? "bm-tt-pos" : "bm-tt-neg";
  tooltip.innerHTML = `
    <div class="bm-tt-header">
      <img class="bm-tt-logo" src="/.netlify/functions/logoProxy?url=${encodeURIComponent(bub.logo||"")}"
        onerror="this.src='https://placehold.co/28x28/0a2a1e/2cffc9?text=?'" referrerpolicy="no-referrer" />
      <div>
        <div class="bm-tt-name">${bub.name || "Unknown"}</div>
        <div class="bm-tt-sym">${bub.symbol || "?"}</div>
      </div>
    </div>
    <div class="bm-tt-row"><span class="bm-tt-label">Change</span><span class="bm-tt-val ${cls}">${fmtPctBubble(chg)}</span></div>
    <div class="bm-tt-row"><span class="bm-tt-label">Price</span><span class="bm-tt-val">$${bub.price < 0.00001 ? bub.price.toExponential(2) : bub.price < 0.01 ? bub.price.toFixed(6) : bub.price < 1 ? bub.price.toFixed(4) : bub.price.toFixed(2)}</span></div>
    <div class="bm-tt-row"><span class="bm-tt-label">Market Cap</span><span class="bm-tt-val">${fmtBigBubble(bub.mc)}</span></div>
    <div class="bm-tt-row"><span class="bm-tt-label">Liquidity</span><span class="bm-tt-val">${fmtBigBubble(bub.liq)}</span></div>
    <div class="bm-tt-row"><span class="bm-tt-label">Vol 24H</span><span class="bm-tt-val">${fmtBigBubble(bub.vol24h)}</span></div>
    <div class="bm-tt-hint">Click to open chart</div>
  `;
}

/* ══════════════════════════════════════════════════════════════
   CSS INJECTION
══════════════════════════════════════════════════════════════ */
function injectStyles() {
  if (document.getElementById("bm-styles")) return;
  const s = document.createElement("style");
  s.id = "bm-styles";
  s.textContent = `
/* ── Bubble Map Modal ── */
#bmOverlay {
  position: fixed; inset: 0; z-index: 8888;
  background: #040d08;
  display: flex; flex-direction: column;
  animation: bmFadeIn 0.22s ease;
}
@keyframes bmFadeIn { from { opacity:0; transform:scale(0.98) } to { opacity:1; transform:none } }

/* ── Header ── */
.bm-header {
  display: flex; align-items: center; gap: 14px;
  padding: 12px 18px 10px;
  border-bottom: 1px solid rgba(44,255,201,0.1);
  background: rgba(4,13,8,0.9);
  backdrop-filter: blur(8px);
  flex-shrink: 0;
}
.bm-title {
  font-size: 13px; font-weight: 900; letter-spacing: 1px;
  color: #cffff4; text-transform: uppercase;
  display: flex; align-items: center; gap: 8px;
}
.bm-chain-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: #2cffc9;
  box-shadow: 0 0 8px #2cffc9;
  animation: bmPulse 2s ease-in-out infinite;
}
@keyframes bmPulse { 0%,100%{opacity:1;box-shadow:0 0 6px #2cffc9} 50%{opacity:0.6;box-shadow:0 0 14px #2cffc9} }

/* ── TF Tabs ── */
.bm-tf-tabs {
  display: flex; gap: 4px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 20px; padding: 3px;
}
.bm-tf-btn {
  padding: 5px 14px; border-radius: 16px; border: none; cursor: pointer;
  font-size: 11px; font-weight: 800; letter-spacing: 0.6px;
  color: rgba(207,255,244,0.45); background: transparent;
  transition: all 0.15s;
}
.bm-tf-btn:hover  { color: rgba(207,255,244,0.8); background: rgba(255,255,255,0.06); }
.bm-tf-btn.active { color: #040d08; background: #2cffc9; box-shadow: 0 0 10px rgba(44,255,201,0.4); }
.bm-tf-btn.bm-tf-own::after { content: "★"; font-size: 7px; vertical-align: super; margin-left: 2px; color: #ffd700; }

/* ── Stats bar ── */
.bm-stats {
  display: flex; gap: 18px; align-items: center;
  padding: 0 18px 0 0;
  font-size: 11px; color: rgba(207,255,244,0.45); font-weight: 700;
  margin-left: auto;
}
.bm-stat-pos { color: #44ff88; }
.bm-stat-neg { color: #ff5544; }

/* ── Close button ── */
.bm-close {
  margin-left: auto;
  background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
  color: rgba(207,255,244,0.5); border-radius: 50%;
  width: 30px; height: 30px; cursor: pointer;
  font-size: 13px; display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
}
.bm-close:hover { background: rgba(255,77,109,0.15); border-color: rgba(255,77,109,0.3); color: #ff4d6d; }

/* ── Canvas wrapper ── */
.bm-canvas-wrap {
  position: relative; flex: 1; overflow: hidden; cursor: default;
}
#bmCanvas { display: block; width: 100%; height: 100%; }

/* ── Legend ── */
.bm-legend {
  position: absolute; bottom: 14px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 6px;
  background: rgba(4,13,8,0.75); border: 1px solid rgba(255,255,255,0.06);
  border-radius: 20px; padding: 5px 14px;
  pointer-events: none; white-space: nowrap;
}
.bm-leg-swatch { width: 90px; height: 8px; border-radius: 4px;
  background: linear-gradient(90deg, #ff2200, #555, #00ff88); }
.bm-leg-label { font-size: 10px; font-weight: 700; color: rgba(207,255,244,0.4); }

/* ── Size legend ── */
.bm-size-legend {
  position: absolute; bottom: 14px; right: 18px;
  display: flex; align-items: flex-end; gap: 6px;
  pointer-events: none;
}
.bm-size-circle {
  border-radius: 50%;
  background: rgba(44,255,201,0.12);
  border: 1px solid rgba(44,255,201,0.2);
  display: flex; align-items: flex-end; justify-content: center;
}
.bm-size-label { font-size: 9px; color: rgba(207,255,244,0.3); font-weight: 700; text-align: center; padding-bottom: 3px; }

/* ── Loading / error ── */
.bm-loading, .bm-error {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 14px; color: rgba(207,255,244,0.5);
}
.bm-spinner {
  width: 42px; height: 42px; border-radius: 50%;
  border: 3px solid rgba(44,255,201,0.1);
  border-top-color: #2cffc9;
  animation: bmSpin 0.7s linear infinite;
}
@keyframes bmSpin { to { transform: rotate(360deg) } }
.bm-loading-txt { font-size: 13px; font-weight: 700; letter-spacing: 0.5px; }
.bm-error-txt   { font-size: 13px; font-weight: 700; color: #ff5544; text-align: center; }
.bm-retry-btn   {
  padding: 8px 20px; border-radius: 10px; cursor: pointer;
  background: rgba(44,255,201,0.1); border: 1px solid rgba(44,255,201,0.3);
  color: #2cffc9; font-size: 12px; font-weight: 700;
}
.bm-retry-btn:hover { background: rgba(44,255,201,0.2); }

/* ── Tooltip ── */
#bmTooltip {
  position: absolute; display: none; z-index: 10;
  background: rgba(4,22,14,0.97); border: 1px solid rgba(44,255,201,0.25);
  border-radius: 12px; padding: 10px 13px; min-width: 190px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.7);
  pointer-events: none;
  animation: bmTtIn 0.12s ease;
}
@keyframes bmTtIn { from { opacity:0; transform:scale(0.95) } to { opacity:1; transform:none } }
.bm-tt-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.bm-tt-logo { width: 28px; height: 28px; border-radius: 50%; }
.bm-tt-name { font-size: 12px; font-weight: 800; color: #cffff4; }
.bm-tt-sym  { font-size: 10px; color: rgba(207,255,244,0.45); font-weight: 700; }
.bm-tt-row  { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 3px; }
.bm-tt-label{ font-size: 10px; color: rgba(207,255,244,0.4); }
.bm-tt-val  { font-size: 11px; font-weight: 700; color: #cffff4; }
.bm-tt-pos  { color: #44ff88; }
.bm-tt-neg  { color: #ff5555; }
.bm-tt-hint { font-size: 9px; color: rgba(207,255,244,0.25); text-align: center; margin-top: 6px; letter-spacing: 0.5px; }
  `;
  document.head.appendChild(s);
}

/* ══════════════════════════════════════════════════════════════
   MAIN MODULE
══════════════════════════════════════════════════════════════ */
let _bmOverlay  = null;
let _bmCanvas   = null;
let _bmCtx      = null;
let _bmSim      = null;
let _bmAF       = null;
let _bmTooltip  = null;
let _bmHovered  = null;
let _bmTf       = "24h";
let _bmLoading  = false;

const TF_LABELS = {
  "4h":  { label: "4H",  own: false },
  "8h":  { label: "8H",  own: false },
  "24h": { label: "24H", own: false },
  "7d":  { label: "7D",  own: true  }, // our computed data
  "30d": { label: "30D", own: true  }, // our computed data
};

function _bmStop() {
  if (_bmAF) { cancelAnimationFrame(_bmAF); _bmAF = null; }
}

function _bmStartLoop() {
  _bmStop();
  let lastTime = 0;
  const FPS = 60;
  const FPSMS = 1000 / FPS;

  function tick(now) {
    _bmAF = requestAnimationFrame(tick);
    if (now - lastTime < FPSMS - 1) return;
    lastTime = now;
    if (!_bmSim || !_bmCtx) return;
    _bmSim.step();
    drawFrame(_bmCtx, _bmSim, _bmHovered, _bmCanvas.width, _bmCanvas.height);
  }
  _bmAF = requestAnimationFrame(tick);
}

function _bmResize() {
  if (!_bmCanvas) return;
  const wrap = _bmCanvas.parentElement;
  const W = wrap.clientWidth;
  const H = wrap.clientHeight;
  _bmCanvas.width  = W;
  _bmCanvas.height = H;
  if (_bmSim) {
    _bmSim.W = W;
    _bmSim.H = H;
    for (const b of _bmSim.items) {
      b.tx = changeToTargetX(b.change, W);
      b.ty = H / 2;
      b.x  = Math.max(b.r, Math.min(W - b.r, b.x * W / (_bmCanvas._lastW || W)));
      b.y  = Math.max(b.r, Math.min(H - b.r, b.y * H / (_bmCanvas._lastH || H)));
    }
    _bmCanvas._lastW = W;
    _bmCanvas._lastH = H;
  }
}

async function _bmLoadData(tf) {
  if (_bmLoading) return;
  _bmLoading = true;
  _bmTf = tf;

  // Update active tab style
  if (_bmOverlay) {
    _bmOverlay.querySelectorAll(".bm-tf-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.tf === tf);
    });
    // Show loading state
    const loadEl = _bmOverlay.querySelector(".bm-loading");
    const errEl  = _bmOverlay.querySelector(".bm-error");
    if (loadEl) { loadEl.style.display = "flex"; loadEl.querySelector(".bm-loading-txt").textContent = `Loading ${TF_LABELS[tf].label} data…`; }
    if (errEl)  errEl.style.display = "none";
    if (_bmCanvas) _bmCanvas.style.opacity = "0";
  }

  try {
    const r = await fetch(`${BUBBLE_API}?tf=${tf}`, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`Server error ${r.status}`);
    const data = await r.json();
    if (!data.ok) throw new Error(data.error || "No data");

    const tokens = data.tokens || [];
    if (!tokens.length) throw new Error("No tokens available for this timeframe");

    // Assign colours and radius
    for (const t of tokens) {
      t.r      = mcToRadius(t.mc);
      t._colors = changeColor(t.change);
    }

    const W = _bmCanvas?.width  || 800;
    const H = _bmCanvas?.height || 600;

    _bmSim     = new BubbleSim(tokens, W, H);
    _bmHovered = null;

    // Update stats
    if (_bmOverlay) {
      const { gainers, losers } = data.stats || {};
      const statEl = _bmOverlay.querySelector(".bm-stats");
      if (statEl && gainers != null) {
        statEl.innerHTML = `
          <span>🟢 <span class="bm-stat-pos">${gainers} gainers</span></span>
          <span>🔴 <span class="bm-stat-neg">${losers} losers</span></span>
          <span>${tokens.length} tokens</span>
        `;
      }
      const loadEl = _bmOverlay.querySelector(".bm-loading");
      if (loadEl) loadEl.style.display = "none";
      if (_bmCanvas) _bmCanvas.style.opacity = "1";
    }

    // Warm up simulation (run N steps before first render to reduce initial chaos)
    for (let i = 0; i < 80; i++) _bmSim.step();
    _bmStartLoop();

  } catch (err) {
    if (_bmOverlay) {
      const loadEl = _bmOverlay.querySelector(".bm-loading");
      const errEl  = _bmOverlay.querySelector(".bm-error");
      if (loadEl) loadEl.style.display = "none";
      if (errEl)  {
        errEl.style.display = "flex";
        errEl.querySelector(".bm-error-txt").textContent = `▲ ${err.message}`;
      }
    }
  } finally {
    _bmLoading = false;
  }
}

/* ── Build the modal DOM ──────────────────────────────────────── */
function _bmBuild() {
  if (_bmOverlay) { _bmOverlay.remove(); _bmOverlay = null; }
  injectStyles();

  const overlay = document.createElement("div");
  overlay.id = "bmOverlay";

  overlay.innerHTML = `
    <div class="bm-header">
      <div class="bm-title">
        <div class="bm-chain-dot"></div>
        ◆ BUBBLE MAP — SOLANA
      </div>
      <div class="bm-tf-tabs">
        ${Object.entries(TF_LABELS).map(([tf, { label, own }]) =>
          `<button class="bm-tf-btn${own ? " bm-tf-own" : ""}${tf === _bmTf ? " active" : ""}" data-tf="${tf}">${label}</button>`
        ).join("")}
      </div>
      <div class="bm-stats"></div>
      <button class="bm-close" id="bmCloseBtn" title="Close (Esc)">✕</button>
    </div>

    <div class="bm-canvas-wrap" id="bmCanvasWrap">
      <canvas id="bmCanvas"></canvas>

      <div class="bm-loading" style="display:flex;">
        <div class="bm-spinner"></div>
        <div class="bm-loading-txt">Loading 24H data…</div>
      </div>

      <div class="bm-error" style="display:none;">
        <div class="bm-error-txt">Failed to load</div>
        <button class="bm-retry-btn" id="bmRetryBtn">Retry</button>
      </div>

      <div id="bmTooltip"></div>

      <!-- Color legend -->
      <div class="bm-legend">
        <span class="bm-leg-label">−%</span>
        <div class="bm-leg-swatch"></div>
        <span class="bm-leg-label">+%</span>
      </div>

      <!-- Size legend -->
      <div class="bm-size-legend">
        <div style="display:flex;flex-direction:column;align-items:center;gap:2px">
          <div class="bm-size-circle" style="width:18px;height:18px;"></div>
          <div class="bm-size-label">small<br>MC</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;gap:2px">
          <div class="bm-size-circle" style="width:36px;height:36px;"></div>
          <div class="bm-size-label">mid<br>MC</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;gap:2px">
          <div class="bm-size-circle" style="width:58px;height:58px;"></div>
          <div class="bm-size-label">large<br>MC</div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  _bmOverlay = overlay;

  _bmCanvas  = overlay.querySelector("#bmCanvas");
  _bmCtx     = _bmCanvas.getContext("2d");
  _bmTooltip = overlay.querySelector("#bmTooltip");

  // Initial sizing
  setTimeout(_bmResize, 0);
  window.addEventListener("resize", _bmResize);

  // Close button
  overlay.querySelector("#bmCloseBtn").addEventListener("click", window.closeBubbleMap);
  overlay.querySelector("#bmRetryBtn")?.addEventListener("click", () => _bmLoadData(_bmTf));

  // TF tabs
  overlay.querySelector(".bm-tf-tabs").addEventListener("click", e => {
    const btn = e.target.closest(".bm-tf-btn");
    if (!btn || _bmLoading) return;
    const tf = btn.dataset.tf;
    if (tf !== _bmTf) _bmLoadData(tf);
  });

  // Canvas mouse events
  const wrap = overlay.querySelector("#bmCanvasWrap");
  wrap.addEventListener("mousemove", e => {
    if (!_bmSim) return;
    const rect = _bmCanvas.getBoundingClientRect();
    const scaleX = _bmCanvas.width  / rect.width;
    const scaleY = _bmCanvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top)  * scaleY;
    const hit = _bmSim.hitTest(mx, my);
    _bmHovered = hit;
    wrap.style.cursor = hit ? "pointer" : "default";
    if (hit) {
      updateTooltip(_bmTooltip, hit);
      positionTooltip(_bmTooltip, hit, _bmCanvas.width, _bmCanvas.height, null);
    } else {
      _bmTooltip.style.display = "none";
    }
  });

  wrap.addEventListener("mouseleave", () => {
    _bmHovered = null;
    if (_bmTooltip) _bmTooltip.style.display = "none";
  });

  wrap.addEventListener("click", e => {
    if (!_bmSim) return;
    const rect = _bmCanvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (_bmCanvas.width  / rect.width);
    const my = (e.clientY - rect.top)  * (_bmCanvas.height / rect.height);
    const hit = _bmSim.hitTest(mx, my);
    if (hit?.mint) {
      // Navigate directly — do NOT call closeBubbleMap() here because home.js
      // overrides it on bubbles.html to redirect to index.html, which would win.
      // Page navigation destroys the overlay anyway.
      try { localStorage.setItem("s2m_prefill_mint", hit.mint); } catch {}
      window.location.href = "risk-scanner.html";
    }
  });

  // Touch support
  wrap.addEventListener("touchend", e => {
    if (!_bmSim) return;
    const touch = e.changedTouches[0];
    const rect = _bmCanvas.getBoundingClientRect();
    const mx = (touch.clientX - rect.left) * (_bmCanvas.width  / rect.width);
    const my = (touch.clientY - rect.top)  * (_bmCanvas.height / rect.height);
    const hit = _bmSim.hitTest(mx, my);
    if (hit?.mint) {
      try { localStorage.setItem("s2m_prefill_mint", hit.mint); } catch {}
      window.location.href = "risk-scanner.html";
    }
  }, { passive: true });

  // Keyboard close
  document.addEventListener("keydown", _bmKeyHandler);
}

function _bmKeyHandler(e) {
  if (e.key === "Escape" && _bmOverlay) window.closeBubbleMap();
}

/* ══════════════════════════════════════════════════════════════
   PUBLIC API
══════════════════════════════════════════════════════════════ */
window.openBubbleMap = function(tf = "24h") {
  _bmTf = tf;
  _bmBuild();
  _bmResize();
  _bmLoadData(tf);
};

window.closeBubbleMap = function() {
  _bmStop();
  window.removeEventListener("resize", _bmResize);
  document.removeEventListener("keydown", _bmKeyHandler);
  if (_bmOverlay) { _bmOverlay.remove(); _bmOverlay = null; }
  _bmSim     = null;
  _bmHovered = null;
  _bmCanvas  = null;
  _bmCtx     = null;
  _bmTooltip = null;
};

export { };   // make this an ES module so home.js can import it
