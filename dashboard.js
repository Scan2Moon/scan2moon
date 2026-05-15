const _DEBUG = false;

/* ============================================================
   Scan2Moon – dashboard.js  (V2.0)
   Real-data dashboard — all stats from simulator profile + live leaderboard rank.
   ============================================================ */

import { renderNav }           from "./nav.js";
import { applyTranslations }   from "./i18n.js";

const SIM_API          = "/.netlify/functions/simulator";
const TOKEN_BATCH_API  = "/.netlify/functions/batchTokenData"; // Birdeye batch token data
const SOL_LOGO         = "S2M-Logo.webp";
const TREASURY_WALLET  = "6zbVz412Yn7kHeuy8pBX8crfAa53jDLTqoNfHJmmTBVs";
const SOL_MINT         = "So11111111111111111111111111111111111111112";

/* ── Purchase helpers ─────────────────────────────────────── */
function getPurchased() {
  try { return JSON.parse(localStorage.getItem("sa_purchased") || "[]"); } catch { return []; }
}
function isPurchased(id) { return getPurchased().some(p => p.id === id); }
function savePurchase(id, type, priceUsd, txSig) {
  const list = getPurchased();
  if (!list.some(p => p.id === id)) {
    list.push({ id, type, priceUsd, txSig, ts: new Date().toISOString() });
    localStorage.setItem("sa_purchased", JSON.stringify(list));
  }
}

async function getSolPriceUsd() {
  /* Route through server-side proxy — avoids CORS issues and geo-blocks.
     Primary: Jupiter · Fallback: CoinGecko · Tertiary: Binance/OKX (all server-side) */
  try {
    const r = await fetch("/.netlify/functions/solPrice", { signal: AbortSignal.timeout(5000) });
    const d = await r.json();
    const p = parseFloat(d?.price);
    if (p > 1) return p;
  } catch { /* fall through */ }

  return 0; /* unavailable */
}

/* Capture a single frame from a video URL as a data-URL (for html2canvas) */
async function captureVideoFrame(videoSrc) {
  return new Promise(resolve => {
    const v = document.createElement("video");
    v.src = videoSrc; v.muted = true; v.crossOrigin = "anonymous";
    v.onloadeddata = () => {
      const c = document.createElement("canvas");
      c.width = v.videoWidth || 96; c.height = v.videoHeight || 96;
      c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/png"));
    };
    v.onerror = () => resolve(null);
    v.load();
  });
}

/* ── Security helpers ─────────────────────────────────────── */
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function isValidSolanaAddress(addr) {
  return typeof addr === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
}

/* ── Frame definitions (avatar border effects) ─────────────── */
const FRAME_DEFS = [
  { id: "frame_none",        name: "No Frame",    icon: "⬜", desc: "Clean look, no border effect.",                          price: 0,    freebie: true, cssClass: ""                },
  { id: "frame_moon_pulse",  name: "Moon Pulse",  icon: "🌙", desc: "Pulsing teal scan glow — the signature S2M energy.",     price: 0,    freebie: true, cssClass: "frame-moon-pulse" },
  { id: "frame_solar_flare", name: "Solar Flare", icon: "☀️", desc: "Burning gold glow. Heat of a thousand green candles.",  price: 0.5,  market: true,  cssClass: "frame-solar-flare"},
  { id: "frame_degen_neon",  name: "Degen Neon",  icon: "💜", desc: "Hot pink neon ring. Pure degen energy.",                price: 0.5,  market: true,  cssClass: "frame-degen-neon" },
  { id: "frame_diamond",     name: "Diamond Edge",icon: "💎", desc: "Elite shifting crystalline diamond border.",            price: 1.0,  market: true,  cssClass: "frame-diamond"    },
];

/* ── Profile card design definitions ───────────────────────── */
const CARD_DESIGN_DEFS = [
  { id: "card_classic",    name: "Classic",     icon: "🌿", desc: "Default dark green Scan2Moon card.",           price: 0,    freebie: true },
  { id: "card_neon_degen", name: "Neon Degen",  icon: "💜", desc: "Deep purple with pink & green neon vibes.",    price: 0,    freebie: true },
  { id: "card_galaxy",     name: "Galaxy",      icon: "🌌", desc: "Deep space starfield. Trade among the stars.", price: 0.75, market: true  },
  { id: "card_gold",       name: "Gold Trophy", icon: "🏆", desc: "Championship gold aesthetic. Winners only.",   price: 0.75, market: true  },
];

/* ── Card colour themes ─────────────────────────────────────── */
const CARD_THEMES = {
  card_classic: {
    bg: "linear-gradient(160deg,#040f0d 0%,#0a2018 60%,#040f0d 100%)",
    border: "rgba(44,255,201,0.28)", logo: "#2cffc9", accent: "#ffb432",
    statHi: "#2cffc9", name: "#cffff4", level: "#7fffe1",
    wallet: "rgba(44,255,201,0.4)", footer: "rgba(44,255,201,0.25)",
    hdrBorder: "rgba(44,255,201,0.15)", tag: "TRADER PROFILE",
  },
  card_neon_degen: {
    bg: "linear-gradient(160deg,#0d0820 0%,#1a0830 60%,#0a0518 100%)",
    border: "rgba(200,100,255,0.38)", logo: "#ff6eb4", accent: "#c084fc",
    statHi: "#ff6eb4", name: "#f0d0ff", level: "#c084fc",
    wallet: "rgba(200,100,255,0.4)", footer: "rgba(200,100,255,0.25)",
    hdrBorder: "rgba(200,100,255,0.15)", tag: "DEGEN PROFILE",
  },
};

/* ── Dashboard Skin Definitions ──────────────────────────── */
const DASHBOARD_SKINS = [
  {
    id: "s2m_original",
    name: "S2M Original",
    icon: "🌿",
    tag: "DEFAULT",
    tagColor: "#2cffc9",
    freebie: true,
    desc: "The signature Scan2Moon look. Dark forest green, teal accents. Classic.",
    previewBg: "#030e09",
    previewPanelBg: "rgba(5,15,11,0.95)",
    previewBorder: "rgba(44,255,201,0.14)",
    previewAccent: "#2cffc9",
    previewAccent2: "#c084fc",
    previewText: "rgba(207,255,244,0.5)",
  },
  {
    id: "neon_degen",
    name: "Neon Degen",
    icon: "🔮",
    tag: "FREE",
    tagColor: "#ff3aaa",
    freebie: true,
    desc: "Cyberpunk violet + hot pink neon. Electric. Unhinged. Pure degen energy.",
    previewBg: "#070010",
    previewPanelBg: "rgba(14,3,28,0.96)",
    previewBorder: "rgba(192,64,255,0.18)",
    previewAccent: "#c840ff",
    previewAccent2: "#ff3aaa",
    previewText: "rgba(200,130,255,0.5)",
  },
];

/* ── Skin helpers ─────────────────────────────────────────── */
function getActiveSkin() {
  try { return localStorage.getItem("s2m_dash_skin") || "s2m_original"; } catch { return "s2m_original"; }
}
/* ── Neon Degen side art (fixed panels in body gutters) ───── */
function injectNeonDegenSideArt() {
  if (document.getElementById('nd-left-art')) return;

  const leftDiv = document.createElement('div');
  leftDiv.id = 'nd-left-art';
  leftDiv.className = 'nd-side-art nd-side-left';
  leftDiv.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 900" preserveAspectRatio="xMidYMid slice" style="width:100%;height:100%">
    <defs>
      <filter id="ndGlL" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="2.5" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <filter id="ndGlL2" x="-80%" y="-80%" width="260%" height="260%">
        <feGaussianBlur stdDeviation="5" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <linearGradient id="ndChartFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#c840ff" stop-opacity="0.5"/>
        <stop offset="100%" stop-color="#c840ff" stop-opacity="0"/>
      </linearGradient>
    </defs>

    <!-- Grid verticals -->
    <line x1="50" y1="105" x2="50" y2="810" stroke="rgba(200,64,255,0.10)" stroke-dasharray="4,7" stroke-width="0.5"/>
    <line x1="100" y1="105" x2="100" y2="810" stroke="rgba(200,64,255,0.10)" stroke-dasharray="4,7" stroke-width="0.5"/>
    <line x1="150" y1="105" x2="150" y2="810" stroke="rgba(200,64,255,0.10)" stroke-dasharray="4,7" stroke-width="0.5"/>

    <!-- Grid horizontals -->
    <line x1="5" y1="270" x2="193" y2="270" stroke="rgba(200,64,255,0.07)" stroke-dasharray="2,9" stroke-width="0.5"/>
    <line x1="5" y1="350" x2="193" y2="350" stroke="rgba(200,64,255,0.07)" stroke-dasharray="2,9" stroke-width="0.5"/>
    <line x1="5" y1="430" x2="193" y2="430" stroke="rgba(200,64,255,0.07)" stroke-dasharray="2,9" stroke-width="0.5"/>
    <line x1="5" y1="510" x2="193" y2="510" stroke="rgba(200,64,255,0.07)" stroke-dasharray="2,9" stroke-width="0.5"/>
    <line x1="5" y1="590" x2="193" y2="590" stroke="rgba(200,64,255,0.07)" stroke-dasharray="2,9" stroke-width="0.5"/>
    <line x1="5" y1="670" x2="193" y2="670" stroke="rgba(200,64,255,0.07)" stroke-dasharray="2,9" stroke-width="0.5"/>

    <!-- Price axis labels -->
    <text x="193" y="274" font-size="7" fill="rgba(200,130,255,0.38)" text-anchor="end" font-family="monospace">0.148</text>
    <text x="193" y="354" font-size="7" fill="rgba(200,130,255,0.38)" text-anchor="end" font-family="monospace">0.141</text>
    <text x="193" y="434" font-size="7" fill="rgba(200,130,255,0.38)" text-anchor="end" font-family="monospace">0.134</text>
    <text x="193" y="514" font-size="7" fill="rgba(200,130,255,0.38)" text-anchor="end" font-family="monospace">0.127</text>
    <text x="193" y="594" font-size="7" fill="rgba(200,130,255,0.38)" text-anchor="end" font-family="monospace">0.120</text>
    <text x="193" y="674" font-size="7" fill="rgba(200,130,255,0.38)" text-anchor="end" font-family="monospace">0.113</text>

    <!-- BULLISH candles (green) -->
    <line x1="20" y1="625" x2="20" y2="695" stroke="rgba(57,255,20,0.45)" stroke-width="1" filter="url(#ndGlL)"/>
    <rect x="15" y="638" width="10" height="44" fill="rgba(57,255,20,0.50)" filter="url(#ndGlL)" rx="1"/>
    <line x1="52" y1="562" x2="52" y2="628" stroke="rgba(57,255,20,0.45)" stroke-width="1" filter="url(#ndGlL)"/>
    <rect x="47" y="575" width="10" height="44" fill="rgba(57,255,20,0.50)" filter="url(#ndGlL)" rx="1"/>
    <line x1="68" y1="525" x2="68" y2="587" stroke="rgba(57,255,20,0.45)" stroke-width="1" filter="url(#ndGlL)"/>
    <rect x="63" y="538" width="10" height="38" fill="rgba(57,255,20,0.50)" filter="url(#ndGlL)" rx="1"/>
    <line x1="100" y1="478" x2="100" y2="540" stroke="rgba(57,255,20,0.45)" stroke-width="1" filter="url(#ndGlL)"/>
    <rect x="95" y="490" width="10" height="40" fill="rgba(57,255,20,0.50)" filter="url(#ndGlL)" rx="1"/>
    <line x1="116" y1="438" x2="116" y2="500" stroke="rgba(57,255,20,0.45)" stroke-width="1" filter="url(#ndGlL)"/>
    <rect x="111" y="450" width="10" height="40" fill="rgba(57,255,20,0.50)" filter="url(#ndGlL)" rx="1"/>
    <line x1="148" y1="392" x2="148" y2="452" stroke="rgba(57,255,20,0.45)" stroke-width="1" filter="url(#ndGlL)"/>
    <rect x="143" y="404" width="10" height="40" fill="rgba(57,255,20,0.50)" filter="url(#ndGlL)" rx="1"/>
    <line x1="164" y1="350" x2="164" y2="410" stroke="rgba(57,255,20,0.45)" stroke-width="1" filter="url(#ndGlL)"/>
    <rect x="159" y="362" width="10" height="38" fill="rgba(57,255,20,0.50)" filter="url(#ndGlL)" rx="1"/>
    <line x1="180" y1="308" x2="180" y2="368" stroke="rgba(57,255,20,0.45)" stroke-width="1" filter="url(#ndGlL)"/>
    <rect x="175" y="320" width="10" height="38" fill="rgba(57,255,20,0.50)" filter="url(#ndGlL)" rx="1"/>

    <!-- BEARISH candles (pink) -->
    <line x1="36" y1="628" x2="36" y2="680" stroke="rgba(255,58,170,0.45)" stroke-width="1" filter="url(#ndGlL)"/>
    <rect x="31" y="642" width="10" height="22" fill="rgba(255,58,170,0.55)" filter="url(#ndGlL)" rx="1"/>
    <line x1="84" y1="522" x2="84" y2="576" stroke="rgba(255,58,170,0.45)" stroke-width="1" filter="url(#ndGlL)"/>
    <rect x="79" y="536" width="10" height="20" fill="rgba(255,58,170,0.55)" filter="url(#ndGlL)" rx="1"/>
    <line x1="132" y1="440" x2="132" y2="492" stroke="rgba(255,58,170,0.45)" stroke-width="1" filter="url(#ndGlL)"/>
    <rect x="127" y="452" width="10" height="16" fill="rgba(255,58,170,0.55)" filter="url(#ndGlL)" rx="1"/>

    <!-- Price line -->
    <path d="M 20,638 L 36,664 L 52,575 L 68,538 L 84,556 L 100,490 L 116,450 L 132,468 L 148,404 L 164,362 L 180,320"
          stroke="#c840ff" stroke-width="1.5" fill="none" filter="url(#ndGlL2)" opacity="0.85"/>
    <!-- Area fill under price line -->
    <path d="M 20,638 L 36,664 L 52,575 L 68,538 L 84,556 L 100,490 L 116,450 L 132,468 L 148,404 L 164,362 L 180,320 L 180,760 L 20,760 Z"
          fill="url(#ndChartFill)" opacity="0.12"/>

    <!-- Volume divider -->
    <line x1="5" y1="820" x2="193" y2="820" stroke="rgba(200,64,255,0.14)" stroke-width="0.5"/>

    <!-- Volume bars -->
    <rect x="15" y="790" width="10" height="30" fill="rgba(57,255,20,0.28)" rx="1"/>
    <rect x="31" y="802" width="10" height="18" fill="rgba(255,58,170,0.28)" rx="1"/>
    <rect x="47" y="788" width="10" height="32" fill="rgba(57,255,20,0.28)" rx="1"/>
    <rect x="63" y="795" width="10" height="25" fill="rgba(57,255,20,0.28)" rx="1"/>
    <rect x="79" y="800" width="10" height="20" fill="rgba(255,58,170,0.28)" rx="1"/>
    <rect x="95" y="792" width="10" height="28" fill="rgba(57,255,20,0.28)" rx="1"/>
    <rect x="111" y="796" width="10" height="24" fill="rgba(57,255,20,0.28)" rx="1"/>
    <rect x="127" y="806" width="10" height="14" fill="rgba(255,58,170,0.28)" rx="1"/>
    <rect x="143" y="785" width="10" height="35" fill="rgba(57,255,20,0.28)" rx="1"/>
    <rect x="159" y="780" width="10" height="40" fill="rgba(57,255,20,0.28)" rx="1"/>
    <rect x="175" y="774" width="10" height="46" fill="rgba(57,255,20,0.30)" rx="1"/>

    <!-- Header -->
    <text x="100" y="48" font-size="11" fill="rgba(200,130,255,0.65)" text-anchor="middle" font-family="monospace" font-weight="bold" letter-spacing="2" filter="url(#ndGlL)">SOL/USDC</text>
    <text x="100" y="66" font-size="8" fill="rgba(57,255,20,0.55)" text-anchor="middle" font-family="monospace">&#9650; +18.4% 24h</text>

    <!-- Circuit traces top -->
    <line x1="18" y1="86" x2="78" y2="86" stroke="rgba(200,64,255,0.22)" stroke-width="0.8"/>
    <line x1="78" y1="86" x2="78" y2="100" stroke="rgba(200,64,255,0.22)" stroke-width="0.8"/>
    <circle cx="18" cy="86" r="2" fill="rgba(200,64,255,0.55)" filter="url(#ndGlL)"/>
    <circle cx="78" cy="86" r="2" fill="rgba(200,64,255,0.45)"/>
    <rect x="74" y="97" width="8" height="8" fill="none" stroke="rgba(200,64,255,0.28)" stroke-width="0.8"/>
    <line x1="118" y1="82" x2="182" y2="82" stroke="rgba(255,58,170,0.18)" stroke-width="0.8"/>
    <line x1="118" y1="82" x2="118" y2="100" stroke="rgba(255,58,170,0.18)" stroke-width="0.8"/>
    <circle cx="182" cy="82" r="2" fill="rgba(255,58,170,0.40)"/>

    <!-- Circuit traces bottom -->
    <line x1="18" y1="870" x2="80" y2="870" stroke="rgba(200,64,255,0.18)" stroke-width="0.8"/>
    <line x1="80" y1="870" x2="80" y2="858" stroke="rgba(200,64,255,0.18)" stroke-width="0.8"/>
    <line x1="120" y1="876" x2="182" y2="876" stroke="rgba(255,58,170,0.14)" stroke-width="0.8"/>
    <circle cx="18" cy="870" r="1.5" fill="rgba(200,64,255,0.40)"/>
    <circle cx="182" cy="876" r="1.5" fill="rgba(255,58,170,0.35)"/>

    <!-- PRICE vertical label -->
    <text transform="translate(10,520) rotate(-90)" font-size="7" fill="rgba(200,64,255,0.28)" text-anchor="middle" font-family="monospace" letter-spacing="3">PRICE</text>
  </svg>`;
  document.body.appendChild(leftDiv);

  const rightDiv = document.createElement('div');
  rightDiv.id = 'nd-right-art';
  rightDiv.className = 'nd-side-art nd-side-right';
  rightDiv.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 900" preserveAspectRatio="xMidYMid slice" style="width:100%;height:100%">
    <defs>
      <filter id="ndGlR" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="3" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <filter id="ndGlR2" x="-100%" y="-100%" width="300%" height="300%">
        <feGaussianBlur stdDeviation="9" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <radialGradient id="ndMoonG" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="rgba(230,195,255,0.85)"/>
        <stop offset="55%" stop-color="rgba(180,80,255,0.55)"/>
        <stop offset="100%" stop-color="rgba(100,0,220,0.08)"/>
      </radialGradient>
    </defs>

    <!-- Stars -->
    <circle cx="28" cy="55" r="1" fill="rgba(255,255,255,0.60)"/>
    <circle cx="72" cy="32" r="1.5" fill="rgba(210,150,255,0.70)"/>
    <circle cx="145" cy="48" r="1" fill="rgba(255,255,255,0.50)"/>
    <circle cx="175" cy="78" r="1.5" fill="rgba(230,190,255,0.60)"/>
    <circle cx="50" cy="118" r="1" fill="rgba(255,255,255,0.40)"/>
    <circle cx="188" cy="155" r="1" fill="rgba(210,150,255,0.50)"/>
    <circle cx="18" cy="205" r="1" fill="rgba(255,255,255,0.40)"/>
    <circle cx="165" cy="228" r="1.2" fill="rgba(230,190,255,0.55)"/>
    <circle cx="88" cy="175" r="0.8" fill="rgba(255,255,255,0.50)"/>
    <circle cx="125" cy="285" r="1" fill="rgba(210,150,255,0.45)"/>
    <circle cx="38" cy="345" r="1" fill="rgba(255,255,255,0.35)"/>
    <circle cx="182" cy="388" r="1.2" fill="rgba(230,190,255,0.50)"/>
    <circle cx="12" cy="462" r="1" fill="rgba(255,255,255,0.38)"/>
    <circle cx="192" cy="508" r="0.8" fill="rgba(210,150,255,0.40)"/>
    <circle cx="60" cy="555" r="1" fill="rgba(255,255,255,0.30)"/>
    <circle cx="170" cy="600" r="1" fill="rgba(210,150,255,0.35)"/>

    <!-- Moon glow halo -->
    <circle cx="100" cy="105" r="72" fill="rgba(150,0,255,0.06)" filter="url(#ndGlR2)"/>
    <!-- Moon body -->
    <circle cx="100" cy="105" r="55" fill="url(#ndMoonG)" filter="url(#ndGlR)"/>
    <circle cx="100" cy="105" r="55" fill="none" stroke="rgba(200,64,255,0.55)" stroke-width="1.2" filter="url(#ndGlR)"/>
    <!-- Craters -->
    <circle cx="82" cy="92" r="8" fill="rgba(80,0,180,0.30)" stroke="rgba(180,100,255,0.22)" stroke-width="0.7"/>
    <circle cx="116" cy="108" r="5" fill="rgba(80,0,180,0.22)" stroke="rgba(180,100,255,0.18)" stroke-width="0.7"/>
    <circle cx="96" cy="120" r="4" fill="rgba(80,0,180,0.20)" stroke="rgba(180,100,255,0.15)" stroke-width="0.7"/>
    <circle cx="108" cy="85" r="3" fill="rgba(80,0,180,0.18)"/>

    <!-- Rocket body (pointing upper-left toward moon) -->
    <g transform="translate(148,450) rotate(-42)" filter="url(#ndGlR)">
      <ellipse cx="0" cy="0" rx="9" ry="26" fill="rgba(192,64,255,0.72)" stroke="rgba(220,160,255,0.80)" stroke-width="1"/>
      <path d="M -9,0 L 0,-36 L 9,0 Z" fill="rgba(255,58,170,0.72)" stroke="rgba(255,130,210,0.65)" stroke-width="0.8"/>
      <path d="M -9,16 L -22,34 L -9,26 Z" fill="rgba(160,30,240,0.65)"/>
      <path d="M 9,16 L 22,34 L 9,26 Z" fill="rgba(160,30,240,0.65)"/>
      <circle cx="0" cy="-3" r="5" fill="rgba(220,180,255,0.45)" stroke="rgba(230,200,255,0.72)" stroke-width="1"/>
    </g>
    <!-- Rocket exhaust trail -->
    <path d="M 158,490 Q 170,535 163,578 Q 175,620 167,660 Q 180,700 170,740"
          stroke="rgba(255,80,220,0.38)" stroke-width="3" fill="none" stroke-dasharray="3,5" filter="url(#ndGlR)"/>
    <path d="M 153,498 Q 165,544 158,588 Q 170,630 162,668"
          stroke="rgba(200,64,255,0.18)" stroke-width="7" fill="none"/>
    <!-- Trail sparkles -->
    <circle cx="164" cy="565" r="2.5" fill="rgba(255,58,170,0.72)" filter="url(#ndGlR)"/>
    <circle cx="169" cy="618" r="1.8" fill="rgba(200,64,255,0.65)" filter="url(#ndGlR)"/>
    <circle cx="162" cy="655" r="2" fill="rgba(255,58,170,0.55)" filter="url(#ndGlR)"/>
    <circle cx="170" cy="700" r="1.5" fill="rgba(200,64,255,0.45)" filter="url(#ndGlR)"/>

    <!-- TO THE MOON vertical text -->
    <text transform="translate(190,455) rotate(90)" font-size="8" fill="rgba(200,64,255,0.38)" font-family="monospace" letter-spacing="5" text-anchor="middle">TO THE MOON</text>

    <!-- Scanner / signal indicators -->
    <line x1="8" y1="298" x2="70" y2="298" stroke="rgba(200,64,255,0.28)" stroke-width="0.8"/>
    <circle cx="8" cy="298" r="2.5" fill="rgba(57,255,20,0.65)" filter="url(#ndGlR)"/>
    <text x="14" y="295" font-size="6" fill="rgba(200,130,255,0.40)" font-family="monospace">BUY</text>
    <line x1="8" y1="318" x2="52" y2="318" stroke="rgba(255,58,170,0.22)" stroke-width="0.8"/>
    <circle cx="8" cy="318" r="2" fill="rgba(255,58,170,0.55)"/>
    <text x="14" y="315" font-size="6" fill="rgba(255,130,190,0.38)" font-family="monospace">SELL</text>
    <line x1="8" y1="338" x2="80" y2="338" stroke="rgba(200,64,255,0.22)" stroke-width="0.8"/>
    <circle cx="8" cy="338" r="2.5" fill="rgba(57,255,20,0.55)" filter="url(#ndGlR)"/>
    <text x="14" y="335" font-size="6" fill="rgba(200,130,255,0.38)" font-family="monospace">BUY</text>
    <line x1="8" y1="358" x2="62" y2="358" stroke="rgba(200,64,255,0.18)" stroke-width="0.8"/>
    <circle cx="8" cy="358" r="2" fill="rgba(200,64,255,0.50)"/>
    <text x="14" y="355" font-size="6" fill="rgba(200,130,255,0.35)" font-family="monospace">HOLD</text>

    <!-- Solana bars logo -->
    <g transform="translate(76,748)" filter="url(#ndGlR)" opacity="0.72">
      <line x1="-32" y1="10"  x2="32" y2="-6"  stroke="rgba(200,64,255,0.80)" stroke-width="3" stroke-linecap="round"/>
      <line x1="-32" y1="-4"  x2="32" y2="-20" stroke="rgba(200,64,255,0.80)" stroke-width="3" stroke-linecap="round"/>
      <line x1="-32" y1="24"  x2="32" y2="8"   stroke="rgba(200,64,255,0.80)" stroke-width="3" stroke-linecap="round"/>
    </g>

    <!-- Degen rock hand outline -->
    <g transform="translate(118,800)" filter="url(#ndGlR)" opacity="0.52">
      <rect x="-18" y="-18" width="36" height="38" rx="6" fill="none" stroke="rgba(255,58,170,0.62)" stroke-width="1.5"/>
      <rect x="-6"  y="-48" width="13" height="32" rx="4" fill="none" stroke="rgba(255,58,170,0.62)" stroke-width="1.5"/>
      <rect x="10"  y="-43" width="10" height="28" rx="4" fill="none" stroke="rgba(200,64,255,0.62)" stroke-width="1.5"/>
      <rect x="-29" y="-8"  width="13" height="20" rx="4" fill="none" stroke="rgba(200,64,255,0.62)" stroke-width="1.5"/>
    </g>

    <!-- DEGEN text label -->
    <text x="100" y="862" font-size="14" fill="rgba(200,64,255,0.48)" text-anchor="middle" font-family="monospace" font-weight="bold" letter-spacing="4" filter="url(#ndGlR)">DEGEN</text>

    <!-- Circuit traces top-right -->
    <line x1="128" y1="14" x2="188" y2="14" stroke="rgba(200,64,255,0.20)" stroke-width="0.8"/>
    <line x1="188" y1="14" x2="188" y2="52" stroke="rgba(200,64,255,0.20)" stroke-width="0.8"/>
    <circle cx="128" cy="14" r="2" fill="rgba(200,64,255,0.45)" filter="url(#ndGlR)"/>
    <line x1="8" y1="22" x2="58" y2="22" stroke="rgba(255,58,170,0.15)" stroke-width="0.8"/>
    <circle cx="58" cy="22" r="1.5" fill="rgba(255,58,170,0.38)"/>
    <rect x="184" y="50" width="7" height="7" fill="none" stroke="rgba(200,64,255,0.28)" stroke-width="0.8"/>

    <!-- Circuit traces bottom -->
    <line x1="18" y1="878" x2="82" y2="878" stroke="rgba(200,64,255,0.18)" stroke-width="0.8"/>
    <line x1="82" y1="878" x2="82" y2="868" stroke="rgba(200,64,255,0.18)" stroke-width="0.8"/>
    <line x1="118" y1="874" x2="182" y2="874" stroke="rgba(255,58,170,0.14)" stroke-width="0.8"/>
    <circle cx="18" cy="878" r="1.8" fill="rgba(200,64,255,0.42)"/>
    <circle cx="182" cy="874" r="1.5" fill="rgba(255,58,170,0.35)"/>
  </svg>`;
  document.body.appendChild(rightDiv);

  /* Fade-in panels */
  requestAnimationFrame(() => {
    leftDiv.style.opacity = '1';
    rightDiv.style.opacity = '1';
  });
}

function removeNeonDegenSideArt() {
  ['nd-left-art','nd-right-art'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });
}

function applySkin(id) {
  const dashEl = document.getElementById("dashApp");
  if (!dashEl) return;
  const skin = DASHBOARD_SKINS.find(s => s.id === id) || DASHBOARD_SKINS[0];
  dashEl.dataset.skin = skin.id;
  /* Apply to both html and body so CSS [data-skin] selectors fire immediately */
  document.documentElement.dataset.skin = skin.id;
  document.body.dataset.skin = skin.id;
  /* Side art for neon skin */
  if (skin.id === 'neon_degen') injectNeonDegenSideArt();
  else removeNeonDegenSideArt();
  /* Update skin badge in hero if present */
  const badge = document.getElementById("dashSkinBadge");
  if (badge) {
    badge.textContent = `${skin.icon} ${skin.name}`;
    badge.className = `dash-skin-badge skin-${skin.id}`;
  }
}
window.equipSkin = function(id) {
  try { localStorage.setItem("s2m_dash_skin", id); } catch {}
  applySkin(id);
  /* Refresh equip buttons in Moon Market if open */
  document.querySelectorAll(".mm-skin-card").forEach(card => {
    const equipped = card.dataset.skinId === id;
    card.classList.toggle("mm-skin-active", equipped && id === "s2m_original");
    card.classList.toggle("mm-skin-active-neon", equipped && id === "neon_degen");
    const btn = card.querySelector(".mm-skin-equip-btn");
    if (btn) {
      btn.textContent = equipped ? "◆ EQUIPPED" : "Equip";
      if (equipped && id === "s2m_original") { btn.style.cssText = "color:#2cffc9;border-color:rgba(44,255,201,0.35);background:rgba(44,255,201,0.08);"; }
      else if (equipped && id === "neon_degen") { btn.style.cssText = "color:#c840ff;border-color:rgba(200,64,255,0.35);background:rgba(200,64,255,0.1);"; }
      else { btn.style.cssText = "color:rgba(255,255,255,0.45);border-color:rgba(255,255,255,0.1);background:transparent;"; }
    }
    const eqBadge = card.querySelector(".mm-skin-equipped-badge");
    if (eqBadge) eqBadge.style.display = equipped ? "block" : "none";
  });
  showToast(`${DASHBOARD_SKINS.find(s=>s.id===id)?.icon || "◆"} Skin equipped!`);
};

function skinItemHtml(skin) {
  const active = getActiveSkin() === skin.id;
  const isNeon = skin.id === "neon_degen";
  const activeCls = active ? (isNeon ? "mm-skin-active-neon" : "mm-skin-active") : "";
  const btnStyle = active
    ? (isNeon ? "color:#c840ff;border-color:rgba(200,64,255,0.35);background:rgba(200,64,255,0.1);"
              : "color:#2cffc9;border-color:rgba(44,255,201,0.35);background:rgba(44,255,201,0.08);")
    : "color:rgba(255,255,255,0.45);border-color:rgba(255,255,255,0.1);background:transparent;";
  return `
  <div class="mm-skin-card ${activeCls}" data-skin-id="${skin.id}">
    ${active ? `<div class="mm-skin-equipped-badge" style="background:${skin.tagColor === '#2cffc9' ? 'rgba(44,255,201,0.15)' : 'rgba(200,64,255,0.18)'};color:${skin.previewAccent};">◆ EQUIPPED</div>` : ''}
    <div class="mm-skin-preview" style="background:${skin.previewBg};">
      <div class="mm-skin-preview-panel" style="background:${skin.previewPanelBg};border-color:${skin.previewBorder};color:${skin.previewText};">
        <div class="mm-skin-preview-dot" style="background:${skin.previewAccent};box-shadow:0 0 5px ${skin.previewAccent};"></div>
        PANEL TITLE
      </div>
      <div class="mm-skin-preview-panel" style="background:${skin.previewPanelBg};border-color:${skin.previewBorder};color:${skin.previewText};">
        <div class="mm-skin-preview-dot" style="background:${skin.previewAccent2};box-shadow:0 0 5px ${skin.previewAccent2};"></div>
        STATS
        <div class="mm-skin-preview-line" style="background:${skin.previewAccent};margin-left:auto;"></div>
      </div>
      <div class="mm-skin-preview-panel" style="background:${skin.previewPanelBg};border-color:${skin.previewBorder};color:${skin.previewText};">
        <div class="mm-skin-preview-dot" style="background:${skin.previewAccent2};box-shadow:0 0 5px ${skin.previewAccent2};"></div>
        TRADE HISTORY
        <div class="mm-skin-preview-line" style="background:${skin.previewAccent2};width:35%;margin-left:auto;"></div>
      </div>
    </div>
    <div class="mm-skin-info">
      <div class="mm-skin-info-name">
        ${skin.icon} ${skin.name}
        <span class="mm-skin-free-tag" style="background:${skin.previewAccent}18;color:${skin.previewAccent};border:1px solid ${skin.previewAccent}40;">${skin.tag}</span>
      </div>
      <div class="mm-skin-info-desc">${skin.desc}</div>
      <button class="mm-skin-equip-btn" style="${btnStyle}" onclick="window.equipSkin('${skin.id}')">${active ? "◆ EQUIPPED" : "Equip"}</button>
    </div>
  </div>`;
}

/* ── Badge categories ─────────────────────────────────────── */
const BADGE_CATEGORIES = [
  { id: "trading", icon: "▲", label: "Simulator Trading", color: "#2cffc9",  bgColor: "rgba(44,255,201,0.12)",  borderColor: "rgba(44,255,201,0.35)"  },
  { id: "academy", icon: "·", label: "Academy",          color: "#ffb432",  bgColor: "rgba(255,180,50,0.12)",  borderColor: "rgba(255,180,50,0.35)", locked: true },
  { id: "other",   icon: "◆", label: "Other",            color: "#c084fc",  bgColor: "rgba(192,132,252,0.12)", borderColor: "rgba(192,132,252,0.35)" },
  { id: "pro",     icon: "◆", label: "PRO",              color: "#60a5fa",  bgColor: "rgba(96,165,250,0.12)",  borderColor: "rgba(96,165,250,0.35)"  },
  { id: "levels",   icon: "◆", label: "Account Levels",   color: "#ffd700",  bgColor: "rgba(255,215,0,0.12)",   borderColor: "rgba(255,215,0,0.4)"    },
  { id: "cosmetics",icon: "◆", label: "Cosmetics",        color: "#ff6eb4",  bgColor: "rgba(255,110,180,0.12)", borderColor: "rgba(255,110,180,0.4)"  },
];

/* ── Badge definitions ────────────────────────────────────── */
const BADGE_DEFS = [
  /* ── Safe Ape Trading ── */
  { id: "first_profit",         cat: "trading", img: "/badges/First_Profit.png",    icon: "🏆", name: "First Profit",          desc: "Close your very first profitable trade in the Safe Ape Simulator.",          reward: 0.1   },
  { id: "win_streak_5",         cat: "trading", img: "/badges/win_streak_5.png",    icon: "🔥", name: "Win Streak ×5",         desc: "Win 5 consecutive trades in a row without a loss in between.",               reward: 0.1   },
  { id: "safe_trader",          cat: "trading", img: "/badges/Safe_Trader.png",     icon: "🛡️", name: "Safe Trader",           desc: "Buy 10 different tokens that each had an entry risk score of 65 or higher.", reward: 0.1   },
  { id: "diamond_hands",        cat: "trading", img: "/badges/Diamond_Hands.png",   icon: "💎", name: "Diamond Hands",         desc: "Hold a token position open for 7 days or more before selling.",              reward: 0.1   },
  { id: "degen_survivor",       cat: "trading", img: "/badges/Degen_Survivor.png",  icon: "🦍", name: "Degen Survivor",        desc: "Make a 10× profit on a token that had a risk score below 45 at entry.",      reward: 0.1   },
  { id: "portfolio_100",        cat: "trading", img: "/badges/portfolio_100.png",   icon: "📈", name: "100% Growth",           desc: "Double your starting balance of 10 S2M — reach 20 S2M or more.",            reward: 0.1   },
  { id: "wins_25",              cat: "trading", img: "/badges/Wins_25.png",         icon: "◆", name: "25 Safe Wins",          desc: "Close a total of 25 profitable trades in the simulator.",                    reward: 0.1   },
  { id: "wins_50",              cat: "trading", img: "/badges/Wins_50.png",         icon: "🌟", name: "50 Safe Wins",          desc: "Close a total of 50 profitable trades. You're on a roll!",                  reward: 0.5   },
  { id: "wins_100",             cat: "trading", img: "/badges/Wins_100.png",        icon: "💫", name: "100 Safe Wins",         desc: "Close 100 profitable trades. The market has nothing on you.",               reward: 1.0   },
  { id: "wins_500",             cat: "trading", img: "/badges/Wins_500.png",        icon: "🚀", name: "500 Safe Wins",         desc: "500 wins — you are an elite Scan2Moon trader.",                             reward: 2.0   },
  { id: "wins_1000",            cat: "trading", img: "/badges/Wins_1000.png",       icon: "🐐", name: "1000 Safe Wins — GOAT", desc: "1000 profitable trades. You are the absolute Greatest Of All Time.",        reward: 5.0   },
  { id: "sol2moon_millionaire", cat: "trading", img: "/badges/Sol2Moon.png",        icon: "🌙", name: "Sol2Moon Millionaire",  desc: "Grow your simulator balance to 10,000 S2M. Legendary status.",              reward: 500.0 },

  /* ── Academy Rank ── */
  { id: "lesson_1",      cat: "academy", subcat: "rank", img: null, icon: "🎯", name: "First Lesson",      desc: "Complete your very first lesson in the Scan2Moon Academy.",                        reward: 0.1  },
  { id: "risk_master",   cat: "academy", subcat: "rank", img: null, icon: "📊", name: "Risk Master",       desc: "Score 100% on the Risk Scanner knowledge quiz. Perfect understanding!",           reward: 0.25 },
  { id: "scanner_pro",   cat: "academy", subcat: "rank", img: null, icon: "🛡️", name: "Scanner Pro",       desc: "Complete the full Risk Scanner deep-dive course from start to finish.",           reward: 0.5  },
  { id: "chart_reader",  cat: "academy", subcat: "rank", img: null, icon: "📈", name: "Chart Reader",      desc: "Pass the Chart Reading & Candle Analysis challenge with 80%+ accuracy.",          reward: 0.25 },
  { id: "whale_watcher", cat: "academy", subcat: "rank", img: null, icon: "🐋", name: "Whale Watcher",     desc: "Complete the Whale DNA module and learn how to track smart money.",                reward: 0.25 },
  { id: "defi_graduate", cat: "academy", subcat: "rank", img: null, icon: "🏛️", name: "DeFi Graduate",     desc: "Complete every module in the Scan2Moon Academy. Full graduate status!",           reward: 1.0  },

  /* ── Academy Guide Badges ── */
  { id: "guide_risk_scanner", cat: "academy", subcat: "guide", img: null, icon: "📊", name: "From Zero to Moon",         desc: "Complete the 'S2M – From Zero to Moon' guide. You now understand Risk Scores, Signals and Red Flags.",  reward: 0.15 },
  { id: "guide_whale_dna",    cat: "academy", subcat: "guide", img: null, icon: "🐋", name: "Track the Smart Money",      desc: "Complete the Whale DNA guide. You can now follow wallet behavior and spot early smart-money accumulation.", reward: 0.15 },
  { id: "guide_safe_ape",     cat: "academy", subcat: "guide", img: null, icon: "🦍", name: "Paper Trade Before You Risk", desc: "Complete the Safe Ape Simulator guide. Strategy tested, discipline built — zero real funds at risk.",         reward: 0.15 },

  /* ── Academy Level ── */
  { id: "acad_lvl_1", cat: "academy", subcat: "level", img: null, icon: "📖", name: "Academy LVL 1 — Enrolled",   desc: "Earn your first Academy Rank badge. The journey begins!",                  reward: 0.05 },
  { id: "acad_lvl_2", cat: "academy", subcat: "level", img: null, icon: "✏️", name: "Academy LVL 2 — Student",    desc: "Earn 2 Academy Rank badges. You are officially a student.",                reward: 0.1  },
  { id: "acad_lvl_3", cat: "academy", subcat: "level", img: null, icon: "📚", name: "Academy LVL 3 — Scholar",    desc: "Earn 3 Academy Rank badges. Knowledge is compounding.",                    reward: 0.2  },
  { id: "acad_lvl_4", cat: "academy", subcat: "level", img: null, icon: "🎓", name: "Academy LVL 4 — Advanced",   desc: "Earn 4 Academy Rank badges. You're ahead of 90% of traders.",             reward: 0.4  },
  { id: "acad_lvl_5", cat: "academy", subcat: "level", img: null, icon: "🏆", name: "Academy LVL 5 — Professor",  desc: "Earn all 5 core Academy Rank badges. You are the one who teaches now.",   reward: 1.0  },

  /* ── Other ── */
  { id: "early_adopter",  cat: "other", img: null, icon: "⚡", name: "Early Adopter",   desc: "Joined Scan2Moon before the V2 public launch. OG status forever.",              reward: 0.5  },
  { id: "community_og",   cat: "other", img: null, icon: "·", name: "Community OG",    desc: "Followed @Scan2Moon on X and joined the community from the start.",             reward: 0.1  },
  { id: "streak_7",       cat: "other", img: "/badges/Other_Bages/7_Days.png", icon: "🔥", name: "7-Day Streak",    desc: "Log in 7 days in a row. Consistency is the edge most traders don't have.",      reward: 0.15, xp: 250 },
  { id: "watchlist_pro",  cat: "other", img: null, icon: "◆", name: "Watchlist Pro",   desc: "Add 10 or more tokens to your personal Scan2Moon Watchlist.",                   reward: 0.1  },
  { id: "sharer",         cat: "other", img: null, icon: "📢", name: "Alpha Sharer",    desc: "Share a risk scan result on X. Spreading real data, not hype.",                 reward: 0.1  },

  /* ── PRO ── */
  { id: "pro_scanner",   cat: "pro", img: "/badges/Pro_badges/100_Risk_Scan.png", icon: "🛡️", name: "Pro Scanner",     desc: "Run 100 total risk scans. You have seen enough charts to know the difference.", reward: 0.5,  xp: 1000 },
  { id: "alpha_caller",  cat: "pro", img: "/badges/Pro_badges/Alpha_Caller.png",    icon: "🎯", name: "Alpha Caller",    desc: "Correctly predict 3 tokens that go 10× before they pump. Real alpha.",          reward: 2.0,  xp: 5000 },
  { id: "whale_analyst", cat: "pro", img: "/badges/Pro_badges/Whale_Analyst.png",   icon: "🐋", name: "Whale Analyst",   desc: "Successfully identify 5 whale wallet patterns using Whale DNA scanner.",         reward: 1.0,  xp: 2000 },
  { id: "top_10",        cat: "pro", img: "/badges/Pro_badges/Top_10.png",           icon: "🏆", name: "Top 10",          desc: "Reach the top 10 on the Scan2Moon Leaderboard. Elite trader confirmed.",         reward: 5.0,  xp: 10000 },

  /* ── Cosmetics — Free ── */
  { id: "cosm_classic_ape",   cat: "cosmetics", subcat: "free",         freebie: true,
    img: null, icon: "🦍", name: "Classic Ape",
    desc: "The original Ape Trader look. Free for every Scan2Moon user — always unlocked.", reward: 0 },

  /* ── Cosmetics — Community Badges ── */
  { id: "cosm_love_solana",   cat: "cosmetics", subcat: "community",    market: true, priceUsd: 0.99,
    img: "/badges/Love_Solana.png", icon: "❤️", name: "I Love Solana",
    desc: "Show your love for the fastest chain in the game.", reward: 0 },
  { id: "cosm_love_s2m",      cat: "cosmetics", subcat: "community",    market: true, priceUsd: 0.99,
    img: "/badges/Love_S2M.png",    icon: "🌙", name: "I Love S2M",
    desc: "A true Scan2Moon believer — the OG community badge.", reward: 0 },

  /* ── Cosmetics — Moon Krakens (animated MP4) ── */
  { id: "kraken_skeleton",    cat: "cosmetics", subcat: "moon_krakens", market: true, priceUsd: 4.99,
    type: "video", video: "/badges/Moon_Krakens_Bages/006.mp4", icon: "💀", name: "Skeleton",
    desc: "Moon Krakens #006 — Skeleton. Fully animated avatar badge.", reward: 0 },
  { id: "kraken_badboy",      cat: "cosmetics", subcat: "moon_krakens", market: true, priceUsd: 4.99,
    type: "video", video: "/badges/Moon_Krakens_Bages/005.mp4", icon: "😈", name: "Bad Boy",
    desc: "Moon Krakens #005 — Bad Boy. Fully animated avatar badge.", reward: 0 },
  { id: "kraken_pirate",      cat: "cosmetics", subcat: "moon_krakens", market: true, priceUsd: 4.99,
    type: "video", video: "/badges/Moon_Krakens_Bages/004.mp4", icon: "🏴‍☠️", name: "Pirate",
    desc: "Moon Krakens #004 — Pirate. Fully animated avatar badge.", reward: 0 },

  /* ── Account Levels (img: null until badge images are uploaded to /badges/) ── */
  { id: "lvl_1",   cat: "levels", img: "/badges/level_badges/LVL_1.png",   icon: "🌱", name: "Level 1 — First Step",   desc: "Reach Account Level 1. Every legend starts with a single step.", reward: 0.05 },
  { id: "lvl_5",   cat: "levels", img: "/badges/level_badges/LVL_5.png",   icon: "🔥", name: "Level 5 — Getting Warm",  desc: "Reach Account Level 5. You're building momentum — keep going!",   reward: 0.1  },
  { id: "lvl_10",  cat: "levels", img: "/badges/level_badges/LVL_10.png",  icon: "💪", name: "Level 10 — Veteran",      desc: "Reach Account Level 10. A true Scan2Moon veteran. Respect.",       reward: 0.25 },
  { id: "lvl_20",  cat: "levels", img: "/badges/level_badges/LVL_20.png",  icon: "🧠", name: "Level 20 — Smart Money",  desc: "Reach Account Level 20. You clearly understand how this works.",    reward: 0.5  },
  { id: "lvl_30",  cat: "levels", img: "/badges/level_badges/LVL_30.png",  icon: "💎", name: "Level 30 — Diamond Mind", desc: "Reach Account Level 30. Elite mentality. Diamond hands, diamond brain.", reward: 1.0  },
  { id: "lvl_50",  cat: "levels", img: "/badges/level_badges/LVL_50.png",  icon: "🚀", name: "Level 50 — Half Moon",    desc: "Reach Account Level 50. Halfway to the moon and already a legend.",  reward: 2.0  },
  { id: "lvl_100", cat: "levels", img: "/badges/level_badges/LVL_100.png", icon: "🌙", name: "Level 100 — Sol2Moon",    desc: "Reach Account Level 100. Maximum level. You ARE the moon. Absolute GOAT.", reward: 10.0 },
];

/* ── XP / Level system ───────────────────────────────────────
   XP formula (live):
     +25 XP per trade closed
     +10 XP per day streak
     +badgeXp  — bonus XP awarded by server when badge is earned
       (trading badges: 100–10,000 XP | level badges: 25–50,000 XP)
     +socialXp from completed social tasks
     +academyXp from completed academy lessons
     +missionXp from completed dashboard missions
   Level curve: xp(n) = round(100 * (n-1)^2.3)  — hard exponential grind
   LVL2=100  LVL5=2,425  LVL10=18,800  LVL20=87,300  LVL50=771,600  LVL100=3,887,300
*/
// Pre-generate 100 thresholds: XP_THRESHOLDS[i] = XP needed for level i+1
const XP_THRESHOLDS = Array.from({ length: 100 }, (_, i) =>
  i === 0 ? 0 : Math.round(100 * Math.pow(i, 2.3))
);

function calcLevel(xp) {
  if (!xp || xp <= 0) return 1;
  // Inverse formula: n = floor((xp/100)^(1/2.3)) + 1  — fast O(1) path
  const approx = Math.max(1, Math.min(100, Math.floor(Math.pow(xp / 100, 1 / 2.3)) + 1));
  // Walk forward/backward to handle rounding edge cases
  let lvl = approx;
  while (lvl < 100 && xp >= XP_THRESHOLDS[lvl]) lvl++;
  while (lvl > 1  && xp <  XP_THRESHOLDS[lvl - 1]) lvl--;
  return lvl;
}

function xpForLevel(lvl)     { return XP_THRESHOLDS[Math.max(0, lvl - 1)] || 0; }
function xpForNextLevel(lvl) { return XP_THRESHOLDS[Math.min(99, lvl)]    || XP_THRESHOLDS[99]; }

/* ── Rank badge ───────────────────────────────────────────── */
function rankLabel(pnl) {
  if (pnl > 50)      return "ELITE PERFORMER";
  if (pnl > 10)      return "TOP TRADER";
  if (pnl > 1)       return "SMART MONEY";
  if (pnl > 0)       return "PROFITABLE";
  if (pnl > -2)      return "IN TRAINING";
  return "REBUILDING";
}

/* ── Badge progress (for "Next to Unlock" strip) ─────────── */
function badgeProgress(id) {
  const wins   = profile.winCount    || 0;
  const bal    = profile.balance     || 10;
  const streak = profile.loginStreak || 0;
  switch (id) {
    case "wins_25":              return { cur: wins,                  max: 25,    label: `${wins} wins`          };
    case "wins_50":              return { cur: wins,                  max: 50,    label: `${wins} wins`          };
    case "wins_100":             return { cur: wins,                  max: 100,   label: `${wins} wins`          };
    case "wins_500":             return { cur: wins,                  max: 500,   label: `${wins} wins`          };
    case "wins_1000":            return { cur: wins,                  max: 1000,  label: `${wins} wins`          };
    case "portfolio_100":        return { cur: Math.max(0, bal - 10), max: 10,    label: `${formatSol(bal)} bal` };
    case "sol2moon_millionaire": return { cur: bal,                   max: 10000, label: `${formatSol(bal)} bal` };
    case "streak_7":             return { cur: streak,                max: 7,     label: `${streak}d streak`     };
    /* Academy Level badges — progress = how many rank badges earned */
    case "acad_lvl_1": case "acad_lvl_2": case "acad_lvl_3":
    case "acad_lvl_4": case "acad_lvl_5": {
      const RANK_IDS  = ["lesson_1","risk_master","scanner_pro","chart_reader","whale_watcher"];
      const earned    = (profile.badges || []).filter(id => RANK_IDS.includes(id)).length;
      const target    = { acad_lvl_1:1, acad_lvl_2:2, acad_lvl_3:3, acad_lvl_4:4, acad_lvl_5:5 }[id];
      return { cur: earned, max: target, label: `${earned} / ${target} rank badges` };
    }
    /* Level badges — compute current account level inline */
    case "lvl_1": case "lvl_5": case "lvl_10":
    case "lvl_20": case "lvl_30": case "lvl_50": case "lvl_100": {
      const wins   = profile.winCount   || 0;
      const losses = profile.lossCount  || 0;
      const badges = (profile.badges    || []).length;
      const xp     = (wins + losses) * 25 + streak * 10
                   + (profile.badgeXp   || 0)
                   + (profile.socialXp  || 0)
                   + (profile.academyXp || 0);
      const lvl    = calcLevel(xp);
      const target = { lvl_1:1, lvl_5:5, lvl_10:10, lvl_20:20, lvl_30:30, lvl_50:50, lvl_100:100 }[id];
      return { cur: lvl, max: target, label: `LVL ${lvl}` };
    }
    default:                     return null;
  }
}

/* ── State ────────────────────────────────────────────────── */
let wallet         = null;
let walletProvider = null; // active wallet object (Phantom or Solflare)
let profile        = null;
let dashPrices     = {};      /* mint → USD price (live)   */
let dashPriceTimer = null;    /* setInterval handle        */
let _dashSolUsd    = 0;       /* SOL/USD (refreshed with prices) */

/* ── Live price fetching ─────────────────────────────────── */
const VALID_MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

async function fetchDashPrices() {
  /* Always refresh SOL price so P/L calc stays accurate */
  try {
    const sp = await getSolPriceUsd();
    if (sp > 0) _dashSolUsd = sp;
  } catch { /* keep last value */ }
  const holdings = profile?.holdings || {};
  const mints    = Object.keys(holdings).filter(k =>
    (holdings[k]?.amount || 0) > 0.000001 && VALID_MINT.test(k)
  );
  if (!mints.length) return;

  // Birdeye batch (25 per call — batchTokenData limit)
  for (let i = 0; i < mints.length; i += 25) {
    const slice = mints.slice(i, i + 25);
    try {
      const res  = await fetch(
        `${TOKEN_BATCH_API}?mints=${encodeURIComponent(slice.join(","))}`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!res.ok) continue;
      const data = await res.json();
      for (const t of data.tokens || []) {
        if (!t?.mint) continue;
        const p = parseFloat(t.priceUsd ?? 0);
        if (p > 0) dashPrices[t.mint] = p;
      }
    } catch (e) { _DEBUG && console.warn("Dashboard Birdeye price error:", e); }
  }

  refreshHoldingsPnL(); /* update DOM in-place */
}

/* ── Refresh P/L cells without full re-render ────────────── */
function refreshHoldingsPnL() {
  const holdings = profile?.holdings || {};
  for (const [mint, h] of Object.entries(holdings)) {
    if ((h.amount || 0) < 0.000001) continue;

    const price    = dashPrices[mint];
    const costSol  = h.totalCostSol || 0;
    /* Use amount×price÷solPrice (same as watchlist) for accuracy across SOL/USD moves.
       Fall back to price-ratio only when token amount is unavailable. */
    const curVal   = !price ? null
      : (_dashSolUsd > 0 && h.amount > 0)
        ? (h.amount * price / _dashSolUsd)
        : (h.avgPrice > 0 && costSol > 0 ? costSol * (price / h.avgPrice) : null);
    const pnlSol   = curVal !== null ? curVal - costSol : null;
    const pnlPct   = pnlSol !== null && costSol > 0 ? (pnlSol / costSol) * 100 : null;

    const pnlEl  = document.getElementById(`dash-pnl-${mint}`);
    const dotEl  = document.getElementById(`dash-dot-${mint}`);
    const valEl  = document.getElementById(`dash-val-${mint}`);

    if (valEl && curVal !== null)  valEl.textContent  = formatSol(curVal);

    if (pnlEl && pnlSol !== null) {
      const sign = pnlSol >= 0 ? "+" : "";
      const col  = pnlSol >= 0 ? "#2cffc9" : "#ff4d6d";
      pnlEl.style.color   = col;
      pnlEl.textContent   = `${sign}${formatSol(pnlSol)}  (${sign}${pnlPct.toFixed(1)}%)`;
    }
    if (dotEl) dotEl.textContent = "⬤ LIVE · just now";
  }
  refreshHoldingsSummary(); /* update portfolio totals */
  renderApeStats();         /* re-render P/L stats now that prices are in */
}

/* ═══════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", () => {
  renderNav();
  applyTranslations();

  const saved = localStorage.getItem("sa_wallet");
  if (saved && isValidSolanaAddress(saved)) {
    wallet = saved;
    walletProvider = _getWalletProvider(localStorage.getItem("sa_wallet_provider") || "phantom");
    loadDashboard();
  }

  document.getElementById("dashConnectBtn").addEventListener("click", connectWallet);

  // Share button
  document.getElementById("dashShareBtn")?.addEventListener("click", () => {
    const url = `${window.location.origin}/dashboard.html`;
    navigator.clipboard.writeText(url).then(() => showToast("Dashboard link copied!"));
  });
});

/* ═══════════════════════════════════════════════════════
   WALLET CONNECT  (Phantom + Solflare)
═══════════════════════════════════════════════════════ */

function _getWalletProvider(name) {
  if (name === "solflare") return window.solflare?.isSolflare ? window.solflare : null;
  /* phantom — prefer window.phantom.solana, fall back to window.solana */
  return window.phantom?.solana ?? (window.solana?.isPhantom ? window.solana : null);
}

function _walletPickerModal() {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:center;justify-content:center";
    overlay.innerHTML = `
      <div style="background:#1a1a2e;border:1px solid rgba(255,255,255,.15);border-radius:16px;padding:32px 28px;max-width:320px;width:90%;text-align:center">
        <div style="font-size:1.1rem;font-weight:700;margin-bottom:8px;color:#fff">Choose Wallet</div>
        <div style="color:#aaa;font-size:.85rem;margin-bottom:24px">Select your Solana wallet to connect</div>
        <button id="_wp_phantom" style="width:100%;padding:12px;border-radius:10px;border:1px solid rgba(120,80,255,.5);background:rgba(120,80,255,.15);color:#fff;font-size:.95rem;cursor:pointer;margin-bottom:10px;display:flex;align-items:center;gap:10px;justify-content:center">
          <img src="https://phantom.app/img/phantom-logo.svg" style="width:20px;height:20px;border-radius:4px" onerror="this.style.display='none'"> Phantom
        </button>
        <button id="_wp_solflare" style="width:100%;padding:12px;border-radius:10px;border:1px solid rgba(255,140,0,.4);background:rgba(255,140,0,.1);color:#fff;font-size:.95rem;cursor:pointer;display:flex;align-items:center;gap:10px;justify-content:center">
          <img src="https://solflare.com/favicon.ico" style="width:20px;height:20px;border-radius:4px" onerror="this.style.display='none'"> Solflare
        </button>
        <button id="_wp_cancel" style="margin-top:14px;background:none;border:none;color:#888;font-size:.8rem;cursor:pointer">Cancel</button>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector("#_wp_phantom").onclick  = () => { overlay.remove(); resolve("phantom"); };
    overlay.querySelector("#_wp_solflare").onclick = () => { overlay.remove(); resolve("solflare"); };
    overlay.querySelector("#_wp_cancel").onclick   = () => { overlay.remove(); resolve(null); };
    overlay.addEventListener("click", e => { if (e.target === overlay) { overlay.remove(); resolve(null); } });
  });
}

async function connectWallet() {
  const btn = document.getElementById("dashConnectBtn");
  document.getElementById("dashConnectText").textContent = "Connecting…";
  btn.disabled = true;
  try {
    const hasPhantom  = !!_getWalletProvider("phantom");
    const hasSolflare = !!(window.solflare?.isSolflare);

    if (!hasPhantom && !hasSolflare) {
      alert("No Solana wallet found!\n\nInstall Phantom (phantom.app) or Solflare (solflare.com), then refresh.");
      return;
    }

    let chosen;
    if (hasPhantom && hasSolflare) {
      chosen = await _walletPickerModal();
      if (!chosen) return;
    } else {
      chosen = hasPhantom ? "phantom" : "solflare";
    }

    const provider = _getWalletProvider(chosen);
    const resp = await provider.connect();
    wallet = resp.publicKey.toString();
    walletProvider = provider;
    localStorage.setItem("sa_wallet", wallet);
    localStorage.setItem("sa_wallet_provider", chosen);
    await loadDashboard();
  } catch (e) {
    alert("Wallet connection cancelled or failed.");
  } finally {
    document.getElementById("dashConnectText").textContent = "Connect Wallet";
    btn.disabled = false;
  }
}

/* ═══════════════════════════════════════════════════════
   DEMO / FAKE PROFILE  (used when API is unavailable)
═══════════════════════════════════════════════════════ */
const DEMO_PROFILE = {
  accountName:  "Trader",
  balance:      14.75,
  totalPnL:     4.75,
  winCount:     18,
  lossCount:    7,
  loginStreak:  5,
  badges:       ["first_profit", "win_streak_5", "safe_trader"],
  holdings: {
    /* Real Solana mints so Jupiter price API can respond in demo mode */
    "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm": {
      name:"dogwifhat",  symbol:"WIF",  amount:15000, totalCostSol:2.10, avgPrice:0.00014, logo:"" },
    "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU": {
      name:"Samoyedcoin",symbol:"SAMO", amount:8500,  totalCostSol:1.50, avgPrice:0.000176, logo:"" },
  },
  trades: [
    { type:"sell", symbol:"BONK",   name:"Bonk",                 pnl:  1.24, pnlPct: "38.5", totalReceivedSol:4.45, timestamp: Date.now() -   3_600_000 },
    { type:"buy",  symbol:"WIF",    name:"dogwifhat",                                         totalCostSol:2.10,     timestamp: Date.now() -   7_200_000 },
    { type:"sell", symbol:"POPCAT", name:"Popcat",                pnl: -0.31, pnlPct: "-9.2", totalReceivedSol:3.04, timestamp: Date.now() -  86_400_000 },
    { type:"sell", symbol:"MEW",    name:"cat in a dogs world",   pnl:  2.10, pnlPct: "67.2", totalReceivedSol:5.25, timestamp: Date.now() - 172_800_000 },
    { type:"buy",  symbol:"SAMO",   name:"Samoyedcoin",                                       totalCostSol:1.50,     timestamp: Date.now() - 259_200_000 },
    { type:"sell", symbol:"JUP",    name:"Jupiter",               pnl:  0.88, pnlPct: "23.1", totalReceivedSol:4.69, timestamp: Date.now() - 345_600_000 },
    { type:"sell", symbol:"PYTH",   name:"Pyth Network",          pnl: -0.55, pnlPct:"-18.0", totalReceivedSol:2.51, timestamp: Date.now() - 432_000_000 },
    { type:"sell", symbol:"RAY",    name:"Raydium",               pnl:  0.42, pnlPct: "15.3", totalReceivedSol:3.17, timestamp: Date.now() - 518_400_000 },
    { type:"sell", symbol:"ORCA",   name:"Orca",                  pnl:  1.67, pnlPct: "44.6", totalReceivedSol:5.41, timestamp: Date.now() - 604_800_000 },
    { type:"buy",  symbol:"FOXY",   name:"Famous Fox",                                        totalCostSol:0.80,     timestamp: Date.now() - 691_200_000 },
    { type:"sell", symbol:"MNGO",   name:"Mango",                 pnl: -0.22, pnlPct: "-8.1", totalReceivedSol:2.49, timestamp: Date.now() - 777_600_000 },
    { type:"sell", symbol:"ATLAS",  name:"Star Atlas",            pnl:  3.40, pnlPct: "82.1", totalReceivedSol:7.54, timestamp: Date.now() - 864_000_000 },
  ],
};

/* ═══════════════════════════════════════════════════════
   LOAD DASHBOARD  (with 503 retry + demo fallback)
═══════════════════════════════════════════════════════ */
async function loadDashboard() {
  showToast("Loading dashboard…");

  /* ── Retry up to 4× on 503 ── */
  let data;
  const MAX_RETRIES = 4;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(`${SIM_API}?wallet=${wallet}`);

      if (resp.status === 503) {
        if (attempt < MAX_RETRIES) {
          const delay = Math.min((attempt + 1) * 2000, 8000);
          showToast(`Storage reconnecting… (${attempt + 1}/${MAX_RETRIES})`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        /* All retries exhausted — fall back to demo data */
        _DEBUG && console.warn("Dashboard: API unavailable after retries, using demo data.");
        profile = { ...DEMO_PROFILE, accountName: "Demo Mode" };
        showDashboard(true);
        return;
      }

      data = await resp.json();
      if (data.error) throw new Error(data.error);
      break; // success
    } catch (e) {
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      /* Network failure — show demo data */
      _DEBUG && console.warn("Dashboard: Network error, using demo data:", e);
      profile = { ...DEMO_PROFILE, accountName: "Demo Mode" };
      showDashboard(true);
      return;
    }
  }

  profile = data.profile;
  if (profile._recovering) {
    showDashboard(false);
    showToast("⚠️ Storage reconnecting — your real profile will load on next refresh");
    return;
  }
  showDashboard(false);
}

function showDashboard(isDemo = false) {
  document.getElementById("dashGate").style.display = "none";
  document.getElementById("dashApp").style.display  = "block";
  applySkin(getActiveSkin());

  /* ── Wire hero buttons robustly (replaces inline onclick) ── */
  const accsBtnEl = document.getElementById("dashAccsBtn");
  if (accsBtnEl) {
    accsBtnEl.onclick = null;
    accsBtnEl.addEventListener("click", () => window.openAccountSettings());
  }
  const shareBtnEl = document.getElementById("dashProfileShareBtn");
  if (shareBtnEl) {
    shareBtnEl.onclick = null;
    shareBtnEl.addEventListener("click", () => window.shareProfileCard());
  }
  const cardBtnEl = document.getElementById("dashCardBtn");
  if (cardBtnEl) {
    cardBtnEl.onclick = null;
    cardBtnEl.addEventListener("click", () => window.openAccountCard());
  }
  const walletBtnEl = document.getElementById("dashWalletBtn");
  if (walletBtnEl) {
    walletBtnEl.onclick = null;
    walletBtnEl.addEventListener("click", () => window.openMyWallet());
  }

  if (isDemo) {
    const existing = document.getElementById("demoBanner");
    if (!existing) {
      const banner = document.createElement("div");
      banner.id = "demoBanner";
      banner.style.cssText = "background:rgba(255,180,50,0.1);border:1px solid rgba(255,180,50,0.3);border-radius:10px;padding:8px 16px;font-size:12px;font-weight:600;color:#ffb432;text-align:center;margin-bottom:14px;";
      banner.textContent = "▲ Storage temporarily unavailable — showing demo preview. Your real data will load once the connection restores.";
      document.getElementById("dashApp").prepend(banner);
    }
  }

  renderHero();
  renderStatsRow();
  renderHighlightStats();
  renderMissionTeaser();
  renderNextBadges();
  renderBadges();
  renderApeStats();
  renderActivityFeed();
  renderPnlChart();
  renderTradeHistory();
  renderHoldings();
  renderScannerStats();
  renderAcademyPlaceholder();
  renderLeaderboard();

  /* ── Last scanned tokens ── */
  renderLastScans();

  /* ── Daily reward check ── */
  if (!isDemo) checkDashDailyReward();

  /* ── Async-fetch real leaderboard rank + preview (non-blocking) ── */
  if (!isDemo && wallet) {
    fetchLbRank(wallet).catch(() => {});
  } else if (isDemo) {
    /* Demo mode: show leaderboard section without fake data */
    const lbEl = document.getElementById("dashLeaderboard");
    if (lbEl) {
      lbEl.innerHTML = `
        <div style="text-align:center;padding:20px;opacity:0.5;font-size:12px;">
          Connect your wallet to see real rankings
        </div>
        <div class="dash-lb-footer"><a href="leaderboard.html" style="color:#ffb432;font-weight:700;">View Full Leaderboard →</a></div>`;
    }
  }

  /* ── Start live price polling for holdings ── */
  if (dashPriceTimer) clearInterval(dashPriceTimer);
  dashPrices = {};
  fetchDashPrices(); /* immediate first fetch */
  dashPriceTimer = setInterval(fetchDashPrices, 30_000); /* refresh every 30 s */
}

/* ═══════════════════════════════════════════════════════
   FETCH REAL LEADERBOARD DATA  (fire-and-forget)
   Updates #dashRank and the leaderboard preview panel
   once the response arrives from the simulator API.
═══════════════════════════════════════════════════════ */
async function fetchLbRank(walletAddr) {
  try {
    const walletParam = walletAddr ? `&wallet_caller=${walletAddr}` : "";
    const res  = await fetch(`${SIM_API}?action=leaderboard&period=alltime${walletParam}`,
      { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return;
    const data    = await res.json();
    const entries = data.entries || [];
    const total   = data.total  || entries.length;

    /* ── Update rank stat card ── */
    const me = walletAddr ? entries.find(e => e.wallet === walletAddr) : null;
    const rankEl = document.getElementById("dashRank");
    if (rankEl) {
      rankEl.textContent = me ? `#${me.rank} / ${total}` : (total > 0 ? "Unranked" : "—");
    }

    /* ── Populate leaderboard preview with real data ── */
    _renderLbPreview(entries, total);

  } catch { /* non-critical — dashRank stays "—" and preview shows loading state */ }
}

/* ═══════════════════════════════════════════════════════
   LAST SCANNED TOKENS — reads same localStorage as home.js
═══════════════════════════════════════════════════════ */
const DASH_SCANS_KEY  = "s2m_last_scans";
const DASH_SCANS_MAX  = 8;

function _scanTimeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function _scanScoreColor(score) {
  if (score >= 65) return "#2cffc9";
  if (score >= 45) return "#ffd166";
  return "#ff4d6d";
}

function _scanRiskLabel(score) {
  // Aligned with computeRiskScore() thresholds in scanSignals.js and utils.js riskLabel()
  if (score >= 80) return "🌕 MOON COIN";
  if (score >= 65) return "LOW RUG RISK";
  if (score >= 45) return "MODERATE RISK";
  if (score >= 25) return "HIGH RUG RISK";
  return "EXTREME RISK 🚨";
}

function renderLastScans() {
  const panel = document.getElementById("dashLastScansPanel");
  const grid  = document.getElementById("dashScansGrid");
  const btn   = document.getElementById("dashClearScansBtn");
  if (!panel || !grid) return;

  let scans = [];
  try { scans = JSON.parse(localStorage.getItem(DASH_SCANS_KEY) || "[]"); } catch {}
  scans = scans.slice(0, DASH_SCANS_MAX);

  if (!scans.length) { panel.style.display = "none"; return; }
  panel.style.display = "block";

  grid.innerHTML = scans.map(s => {
    const logo      = s.logo
      ? `/.netlify/functions/logoProxy?url=${encodeURIComponent(s.logo)}`
      : "/sol2moon-token.png";
    const score     = s.totalScore ?? "—";
    const scoreCol  = typeof score === "number" ? _scanScoreColor(score) : "#7fffe1";
    const riskLabel = typeof score === "number" ? _scanRiskLabel(score) : "";
    const ago       = _scanTimeAgo(s.scannedAt);
    const name      = esc(s.name || "Unknown");
    const sym       = esc(s.symbol || "");
    const mc        = esc(s.marketCap  || "—");
    const liq       = esc(s.liquidity  || "—");
    const mint      = esc(s.mint);

    return `
      <div class="dash-scan-card" onclick="window._dashGoToScan('${mint}')" title="Re-scan ${name}">
        <div class="dash-scan-card-top">
          <img class="dash-scan-logo" src="${logo}" onerror="this.src='/sol2moon-token.png'" referrerpolicy="no-referrer" />
          <div class="dash-scan-info">
            <div class="dash-scan-name">${name}</div>
            <div class="dash-scan-sym">${sym}</div>
          </div>
          <div class="dash-scan-ago">${ago}</div>
        </div>
        <div class="dash-scan-score-row">
          <span class="dash-scan-score" style="color:${scoreCol};text-shadow:0 0 10px ${scoreCol}66">${score}<span class="dash-scan-score-max">/100</span></span>
          <span class="dash-scan-risk" style="color:${scoreCol};border-color:${scoreCol}44;background:${scoreCol}12">${riskLabel}</span>
        </div>
        <div class="dash-scan-metrics">
          <div class="dash-scan-metric"><div class="dash-scan-metric-lbl">Mkt Cap</div><div class="dash-scan-metric-val">${mc}</div></div>
          <div class="dash-scan-metric"><div class="dash-scan-metric-lbl">Liquidity</div><div class="dash-scan-metric-val">${liq}</div></div>
        </div>
        <div class="dash-scan-card-actions">
          <button class="dash-scan-rescan-btn" onclick="event.stopPropagation();window._dashGoToScan('${mint}')">Re-scan</button>
          <button class="dash-scan-ape-btn" onclick="event.stopPropagation();window._dashGoToApe('${mint}')">Trade</button>
        </div>
      </div>`;
  }).join("");

  /* Wire up clear button */
  if (btn) {
    btn.onclick = () => {
      if (!confirm("Clear all scan history?")) return;
      localStorage.removeItem(DASH_SCANS_KEY);
      panel.style.display = "none";
    };
  }
}

window._dashGoToScan = function(mint) {
  localStorage.setItem("s2m_prefill_mint", mint);
  window.location.href = "risk-scanner.html";
};

window._dashGoToApe = function(mint) {
  localStorage.setItem("s2m_sa_mint", mint);
  window.location.href = "safe-ape.html";
};

/* ═══════════════════════════════════════════════════════
   DAILY REWARD — on Dashboard
═══════════════════════════════════════════════════════ */
function checkDashDailyReward() {
  if (!profile || !wallet) return;
  if (profile._recovering) return; /* storage reconnecting — don't attempt POST */
  const today = new Date().toISOString().slice(0, 10);
  const lastLogin = (profile.lastLogin || '').slice(0, 10); /* normalise full ISO or date-only */

  /* If server shows no login or an older date (e.g. after account reset),
     clear any stale localStorage guard so the banner appears correctly. */
  if (lastLogin < today) {
    try { localStorage.removeItem('s2m_daily_claimed'); } catch {}
  }

  let localClaimed = false;
  try { localClaimed = localStorage.getItem('s2m_daily_claimed') === today; } catch {}
  if (lastLogin === today || localClaimed) return; /* already claimed today */

  const banner = document.getElementById("dashDailyBanner");
  const btn    = document.getElementById("dashDailyClaimBtn");
  if (!banner || !btn) return;

  const DAILY_REWARDS_SOL = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
  const streak  = Math.max(1, Math.min(7, (profile.loginStreak || 0) + 1));
  const reward  = DAILY_REWARDS_SOL[streak] ?? 0.1;
  btn.textContent = `Claim +${reward.toFixed(2)} S2M & +10 XP`;
  banner.style.display = "flex";

  /* Use a named reference so the listener can be safely re-added if the
     previous attempt failed (no { once:true } — claimDashDaily guards itself). */
  btn.onclick = claimDashDaily;
}

async function claimDashDaily() {
  const banner  = document.getElementById("dashDailyBanner");
  const btn     = document.getElementById("dashDailyClaimBtn");
  if (btn && btn.disabled) return; /* prevent double-click while in-progress */
  const origText = btn ? btn.textContent : "Claim";
  if (btn) { btn.disabled = true; btn.textContent = "Claiming…"; }
  try {
    const resp = await fetch(SIM_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet, action: "daily_login" }),
    });
    if (resp.status === 503) { alert("Server busy, try again in a moment."); return; }
    const data = await resp.json();
    if (data.error) {
      alert("Error: " + data.error);
      try { localStorage.setItem('s2m_daily_claimed', new Date().toISOString().slice(0,10)); } catch {}
      if (banner) banner.style.display = "none"; /* hide even on already-claimed error */
      return;
    }
    profile = data.profile;
    try { localStorage.setItem('s2m_daily_claimed', new Date().toISOString().slice(0,10)); } catch {}
    if (banner) banner.style.display = "none";
    /* Re-render XP/level after claim */
    renderStatsRow();
    /* Toast-style flash */
    const flash = document.createElement("div");
    flash.style.cssText = `position:fixed;bottom:70px;left:50%;transform:translateX(-50%);
      background:linear-gradient(135deg,rgba(255,180,50,.2),rgba(6,32,26,.97));
      border:1px solid rgba(255,180,50,.55);border-radius:12px;
      padding:12px 24px;font-size:15px;font-weight:800;color:#ffb432;
      box-shadow:0 0 30px rgba(255,180,50,.35);z-index:9999;
      animation:none;pointer-events:none;`;
    flash.textContent = `+ ${data.message}  · +10 XP`;
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 3000);
  } catch (e) {
    _DEBUG && console.warn("Daily claim error:", e);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = origText; }
  }
}

/* ═══════════════════════════════════════════════════════
   WALLET IDENTICON — deterministic SVG avatar from address
═══════════════════════════════════════════════════════ */
function walletIdenticon(addr, size = 96) {
  if (!addr) return null;

  // FNV-1a hash of the wallet address string
  let h = 2166136261;
  for (let i = 0; i < addr.length; i++) {
    h ^= addr.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }

  // Derive vivid hue from hash — avoid brown/muddy range
  const hue  = h % 360;
  const sat  = 62 + (h >> 8)  % 22;   // 62–83%
  const lit  = 56 + (h >> 16) % 14;   // 56–69%
  const fg   = `hsl(${hue},${sat}%,${lit}%)`;
  const fg2  = `hsl(${(hue + 40) % 360},${sat}%,${lit - 10}%)`;  // accent
  const bg   = `hsl(${(hue + 195) % 360},22%,9%)`;               // dark complement

  // 6×6 symmetric grid (left 3 cols generated, mirrored to right)
  const ROWS = 6, HALF = 3;
  const rects = [];
  let rng = h;
  for (let r = 0; r < ROWS; r++) {
    for (let half = 0; half < HALF; half++) {
      rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
      if (rng & 1) {
        const cell = size / ROWS;
        const x1 = half * cell;
        const x2 = (ROWS - 1 - half) * cell;
        const y  = r * cell;
        const fill = (rng >> 4) & 1 ? fg : fg2;
        rects.push(`<rect x="${x1}" y="${y}" width="${cell}" height="${cell}" fill="${fill}"/>`);
        if (x2 !== x1) {
          rects.push(`<rect x="${x2}" y="${y}" width="${cell}" height="${cell}" fill="${fill}"/>`);
        }
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <defs>
      <filter id="av-glow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="2.5" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <clipPath id="av-clip"><rect width="${size}" height="${size}" rx="14"/></clipPath>
    </defs>
    <rect width="${size}" height="${size}" fill="${bg}" rx="14"/>
    <g clip-path="url(#av-clip)" filter="url(#av-glow)">${rects.join("")}</g>
    <rect width="${size}" height="${size}" rx="14" fill="none"
      stroke="${fg}" stroke-width="1.5" stroke-opacity="0.35"/>
  </svg>`;
}

/* ═══════════════════════════════════════════════════════
   HERO PANEL
═══════════════════════════════════════════════════════ */
function renderHero() {
  const short      = wallet.slice(0, 6) + "…" + wallet.slice(-6);
  const pnl        = profile.totalPnL || 0;
  const savedName  = localStorage.getItem("sa_display_name");
  const savedAvId  = localStorage.getItem("sa_avatar_id");

  document.getElementById("dashName").textContent        = esc(savedName || profile.accountName || "Trader");
  document.getElementById("dashWalletShort").textContent = short;
  document.getElementById("dashRankBadge").textContent   = rankLabel(pnl);

  /* Skin badge — inject after rank badge if not already there */
  const skinBadgeEl = document.getElementById("dashSkinBadge");
  if (!skinBadgeEl) {
    const rankBadgeEl = document.getElementById("dashRankBadge");
    if (rankBadgeEl?.parentElement) {
      const btn = document.createElement("button");
      btn.id = "dashSkinBadge";
      const activeSkin = DASHBOARD_SKINS.find(s => s.id === getActiveSkin()) || DASHBOARD_SKINS[0];
      btn.textContent = `${activeSkin.icon} ${activeSkin.name}`;
      btn.className   = `dash-skin-badge skin-${activeSkin.id}`;
      btn.title       = "Change Dashboard Skin";
      btn.onclick     = () => window.openMoonMarket("skins");
      rankBadgeEl.parentElement.insertBefore(btn, rankBadgeEl.nextSibling);
    }
  }

  /* Avatar — video badge / image badge / emoji fallback */
  const avEl = document.getElementById("dashAvatar");
  if (savedAvId) {
    const b = BADGE_DEFS.find(x => x.id === savedAvId);
    if (b?.type === "video" && b.video) {
      avEl.innerHTML = `<video src="${b.video || ''}" class="dash-avatar-video"
        autoplay loop muted playsinline
        onerror="this.parentElement.textContent='${b.icon || "◆"}'"></video>`;
    } else if (b?.img) {
      avEl.innerHTML = `<img src="${b.img || ''}" class="dash-avatar-img"
        onerror="this.parentElement.textContent='${b.icon || "◆"}'" alt="${esc(b.name)}">`;
    } else if (b?.icon) {
      avEl.textContent = b.icon;
    } else {
      const svg = walletIdenticon(wallet, 96);
      if (svg) avEl.innerHTML = svg; else avEl.textContent = "◆";
    }
  } else {
    const svg = walletIdenticon(wallet, 96);
    if (svg) avEl.innerHTML = svg; else avEl.textContent = "◆";
  }

  /* Frame effect on avatar wrapper */
  const frameEl = document.getElementById("dashAvatarFrame");
  if (frameEl) {
    const savedFrameId = localStorage.getItem("sa_frame_id") || "frame_none";
    const frameDef = FRAME_DEFS.find(f => f.id === savedFrameId) || FRAME_DEFS[0];
    frameEl.className = ("dash-avatar-frame " + (frameDef.cssClass || "")).trim();
  }
}

/* Sync the hero avatar in the dashboard after a change */
function updateDashAvatar() {
  const savedAvId = localStorage.getItem("sa_avatar_id");
  const avEl = document.getElementById("dashAvatar");
  if (!avEl) return;
  if (savedAvId) {
    const b = BADGE_DEFS.find(x => x.id === savedAvId);
    if (b?.type === "video" && b.video) {
      avEl.innerHTML = `<video src="${b.video || ''}" class="dash-avatar-video"
        autoplay loop muted playsinline
        onerror="this.parentElement.textContent='${b.icon || "◆"}'"></video>`;
    } else if (b?.img) {
      avEl.innerHTML = `<img src="${b.img || ''}" class="dash-avatar-img"
        onerror="this.parentElement.textContent='${b.icon || "◆"}'" alt="${esc(b.name)}">`;
    } else if (b?.icon) { avEl.textContent = b.icon; }
    else { avEl.textContent = "◆"; }
  } else { avEl.textContent = "◆"; }
}

/* Sync the hero avatar frame after a change */
function updateDashFrame() {
  const frameEl = document.getElementById("dashAvatarFrame");
  if (!frameEl) return;
  const savedFrameId = localStorage.getItem("sa_frame_id") || "frame_none";
  const frameDef = FRAME_DEFS.find(f => f.id === savedFrameId) || FRAME_DEFS[0];
  frameEl.className = ("dash-avatar-frame " + (frameDef.cssClass || "")).trim();
}

/* ═══════════════════════════════════════════════════════
   STATS ROW
═══════════════════════════════════════════════════════ */
/* Academy level thresholds: 7 levels based on academy XP */
const ACAD_XP_THRESHOLDS = [0, 100, 250, 450, 700, 1000, 1400, 2000];
function calcAcadLevel(xp) {
  let lvl = 1;
  for (let i = 1; i < ACAD_XP_THRESHOLDS.length; i++) {
    if (xp >= ACAD_XP_THRESHOLDS[i]) lvl = i + 1; else break;
  }
  return lvl;
}

/* Only rank badges count towards Academy XP (not level badges) */
const ACADEMY_BADGE_IDS = new Set(["lesson_1","risk_master","scanner_pro","chart_reader","whale_watcher","defi_graduate"]);

function renderStatsRow() {
  const trades  = (profile.trades || []).length;
  const badges  = (profile.badges || []).length;
  const streak  = profile.loginStreak || 0;
  const wins    = profile.winCount   || 0;
  const losses  = profile.lossCount  || 0;
  const earned  = profile.badges || [];

  /* ── Account XP & Level (trades + badgeXp + streak + social + academy + missions) ── */
  const missionXp = _getMissionData().filter(m => m.current >= m.target).reduce((s, m) => s + m.xp, 0);
  const xp      = ((wins + losses) * 25) + (streak * 10)
                + (profile.badgeXp   || 0)
                + (profile.socialXp  || 0)
                + (profile.academyXp || 0)
                + missionXp;
  const lvl     = calcLevel(xp);
  const xpCur   = xp - xpForLevel(lvl);
  const xpRange = xpForNextLevel(lvl) - xpForLevel(lvl);
  const xpPct   = xpRange > 0 ? Math.min(100, Math.round((xpCur / xpRange) * 100)) : 100;

  document.getElementById("dashLvl").textContent    = lvl;
  document.getElementById("dashXpText").textContent = `${xp.toLocaleString()} / ${xpForNextLevel(lvl).toLocaleString()} XP`;
  document.getElementById("dashXpFill").style.width = xpPct + "%";

  /* ── Academy XP & Level (from completed lessons/quizzes on Academy page) ── */
  const acadXp    = profile.academyXp || 0;
  const acadLvl   = calcAcadLevel(acadXp);
  const acadNext  = ACAD_XP_THRESHOLDS[Math.min(acadLvl, ACAD_XP_THRESHOLDS.length - 1)];
  const acadCur   = acadXp - ACAD_XP_THRESHOLDS[acadLvl - 1];
  const acadRange = acadNext - ACAD_XP_THRESHOLDS[acadLvl - 1];
  const acadPct   = acadRange > 0 ? Math.min(100, Math.round((acadCur / acadRange) * 100)) : 100;

  document.getElementById("dashAcadLvl").textContent    = acadLvl;
  document.getElementById("dashAcadXpText").textContent = `${acadXp} / ${acadNext} XP`;
  document.getElementById("dashAcadXpFill").style.width = acadPct + "%";

  /* ── Completed trades (wins + losses) ── */
  document.getElementById("dashScans").textContent = wins + losses;

  /* ── Rank: show "—" now, async-fetch real rank after dashboard renders ── */
  document.getElementById("dashRank").textContent = "—";

  /* ── Streak ── */
  document.getElementById("dashStreak").textContent = `${streak}d`;
}

/* ═══════════════════════════════════════════════════════
   BADGES — CATEGORISED ACCORDION
═══════════════════════════════════════════════════════ */
function renderBadges() {
  const earned   = new Set(profile.badges || []);
  /* Freebie badges are auto-earned for every connected wallet */
  BADGE_DEFS.filter(b => b.freebie).forEach(b => earned.add(b.id));

  /* ── Client-side level badges: unlock instantly based on current XP ──
     The server awards them on the next trade/login, but we show them
     as earned here immediately so the player sees their progress.       */
  {
    const wins   = profile.winCount  || 0;
    const losses = profile.lossCount || 0;
    const streak = profile.loginStreak || 0;
    const _xpLvl = wins * 25 + streak * 10
                 + (profile.badgeXp   || 0)
                 + (profile.socialXp  || 0)
                 + (profile.academyXp || 0);
    const _lvl = calcLevel(_xpLvl);
    const LVL_BADGE_REQS = { lvl_1:1, lvl_5:5, lvl_10:10, lvl_20:20, lvl_30:30, lvl_50:50, lvl_100:100 };
    for (const [bid, req] of Object.entries(LVL_BADGE_REQS)) {
      if (_lvl >= req) earned.add(bid);
    }
  }
  const count    = earned.size;
  const total    = BADGE_DEFS.length;
  const pct      = total > 0 ? Math.round((count / total) * 100) : 0;
  const solTotal = [...earned].reduce((s, id) => {
    const b = BADGE_DEFS.find(x => x.id === id);
    // Use ?? (not ||) so reward:0 on free badges is respected and doesn't fall back to 0.1
    return s + (b?.reward ?? 0);
  }, 0);

  /* Overall header */
  document.getElementById("dashBadgesCount").textContent     = `${count} / ${total} earned`;
  document.getElementById("dashBadgesPct").textContent       = `${pct}% complete`;
  document.getElementById("dashBadgesBarFill").style.width   = pct + "%";
  document.getElementById("dashBadgesSolEarned").textContent = `+${formatSol(solTotal)} earned`;

  /* Build accordion categories */
  const container = document.getElementById("dashBadgesGrid");
  container.className = "dash-badge-categories";
  container.innerHTML = BADGE_CATEGORIES.map((cat, catIdx) => {
    const catBadges  = BADGE_DEFS.filter(b => b.cat === cat.id);
    const catEarned  = catBadges.filter(b => earned.has(b.id)).length;
    const catSol     = catBadges.filter(b => earned.has(b.id)).reduce((s, b) => s + b.reward, 0);
    const isOpen     = false; // all categories closed on page load

    /* Academy + Cosmetics get labelled sub-sections; all others render flat */
    let cardsHtml;
    if (cat.id === "academy") {
      const rankBadges  = catBadges.filter(b => b.subcat === "rank");
      const levelBadges = catBadges.filter(b => b.subcat === "level");
      const guideBadges = catBadges.filter(b => b.subcat === "guide");
      cardsHtml = `
        <div class="dash-badge-subheader">🏛️ ACADEMY RANK BADGES</div>
        <div class="dash-badges-grid">${rankBadges.map(b => badgeCardHtml(b, earned)).join("")}</div>
        <div class="dash-badge-subheader" style="margin-top:14px;">ACADEMY LEVEL BADGES</div>
        <div class="dash-badges-grid">${levelBadges.map(b => badgeCardHtml(b, earned)).join("")}</div>
        <div class="dash-badge-subheader" style="margin-top:14px;">📖 COMPLETED GUIDES</div>
        <div class="dash-badges-grid">${guideBadges.map(b => badgeCardHtml(b, earned)).join("")}</div>`;

    } else if (cat.id === "cosmetics") {
      const freeBadges      = catBadges.filter(b => b.subcat === "free");
      const communityBadges = catBadges.filter(b => b.subcat === "community");
      const krakenBadges    = catBadges.filter(b => b.subcat === "moon_krakens");
      cardsHtml = `
        <div class="dash-badge-subheader">FREE ACHIEVEMENTS</div>
        <div class="dash-badges-grid">${freeBadges.map(b => badgeCardHtml(b, earned)).join("")}</div>
        <div class="dash-badge-subheader" style="margin-top:14px;color:#ff6eb4;">◆ COMMUNITY BADGES</div>
        <div class="dash-badges-grid">${communityBadges.map(b => badgeCardHtml(b, earned)).join("")}</div>
        <div class="dash-badge-subheader" style="margin-top:14px;color:#c084fc;">
          ◆ MOON KRAKENS
          <span class="dash-badge-animated-chip">ANIMATED</span>
        </div>
        <div class="dash-badges-grid">${krakenBadges.map(b => badgeCardHtml(b, earned)).join("")}</div>`;

    } else {
      cardsHtml = `<div class="dash-badges-grid">${catBadges.map(b => badgeCardHtml(b, earned)).join("")}</div>`;
    }

    /* ── Locked category (Coming Soon) ── */
    if (cat.locked) {
      return `
        <div class="dash-cat-wrap ${isOpen ? 'open' : ''}" id="dash-cat-${cat.id}">
          <div class="dash-cat-header dash-cat-header-locked" onclick="window.toggleBadgeCat('${cat.id}')">
            <div class="dash-cat-color-bar" style="background:${cat.color};opacity:0.4;"></div>
            <span class="dash-cat-icon" style="opacity:0.5;">${cat.icon}</span>
            <span class="dash-cat-title" style="opacity:0.5;">${cat.label}</span>
            <span class="dash-cat-coming-soon">▼ COMING SOON</span>
            <span class="dash-cat-chevron">▼</span>
          </div>
          <div class="dash-cat-body">
            <div class="dash-cat-locked-body">
              <div class="dash-cat-locked-lock">▼</div>
              <div class="dash-cat-locked-title">Academy Badges — Coming Soon</div>
              <div class="dash-cat-locked-desc">
                Complete in-app learning guides &amp; challenges to unlock
                exclusive Academy badges and earn SOL rewards.
                <br><br>
                <span style="color:#ffb432;font-weight:700;">Stay tuned — launching soon</span>
              </div>
            </div>
          </div>
        </div>`;
    }

    return `
      <div class="dash-cat-wrap ${isOpen ? 'open' : ''}" id="dash-cat-${cat.id}">
        <div class="dash-cat-header" onclick="window.toggleBadgeCat('${cat.id}')">
          <div class="dash-cat-color-bar" style="background:${cat.color};"></div>
          <span class="dash-cat-icon">${cat.icon}</span>
          <span class="dash-cat-title">${cat.label}</span>
          <span class="dash-cat-pill"
            style="background:${cat.bgColor};border:1px solid ${cat.borderColor};color:${cat.color};">
            ${catEarned} / ${catBadges.length}
          </span>
          ${catSol > 0 ? `<span class="dash-cat-sol">
            <img src="${SOL_LOGO}" style="width:13px;height:13px;border-radius:50%;">
            +${formatSol(catSol)}
          </span>` : ''}
          <span class="dash-cat-chevron">▼</span>
        </div>
        <div class="dash-cat-body">
          ${cardsHtml}
        </div>
      </div>`;
  }).join("");
}

/* ── Single badge card HTML ──────────────────────────────── */
function badgeCardHtml(b, earned) {
  const isEarned  = b.freebie || isPurchased(b.id) || earned.has(b.id);
  const rewardStr = b.reward >= 1 ? b.reward.toFixed(1) : b.reward.toFixed(2);

  /* Status chip */
  let statusHtml;
  if (b.freebie) {
    statusHtml = `<div class="dash-badge-status status-earned">◆ FREE</div>`;
  } else if (b.market && isEarned) {
    statusHtml = `<div class="dash-badge-status status-earned">◆ OWNED</div>`;
  } else if (b.market && !isEarned) {
    statusHtml = `<div class="dash-badge-status status-market">◆ $${b.priceUsd}</div>`;
  } else {
    statusHtml = `<div class="dash-badge-status ${isEarned ? 'status-earned' : 'status-locked'}">
        ${isEarned ? '◆ EARNED' : '▼ LOCKED'}
       </div>`;
  }

  /* Media content — video always plays; locked gets a dim overlay */
  let imgHtml;
  if (b.type === "video" && b.video) {
    imgHtml = `
      <div class="dash-badge-video-wrap${isEarned ? '' : ' dash-badge-video-dimmed'}">
        <video class="dash-badge-video" src="${b.video || ''}" autoplay loop muted playsinline></video>
        ${!isEarned ? '<div class="dash-badge-video-lock-overlay"><span>▼</span></div>' : ''}
      </div>`;
  } else if (b.img) {
    imgHtml = `<img class="dash-badge-img" src="${b.img || ''}" alt="${esc(b.name)}"
         onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
       <span class="dash-badge-emoji" style="display:none">${b.icon}</span>`;
  } else {
    imgHtml = `<span class="dash-badge-emoji">${b.icon}</span>`;
  }

  /* XP reward chip — shown in top-left corner for every earnable badge.
     Uses explicit b.xp if set, otherwise auto-derives from SOL reward. */
  const xpAmt = b.xp || (b.market ? 0 : Math.round(b.reward * 1000));
  function fmtXp(n) { return n >= 1000 ? (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + "K" : String(n); }
  const xpHtml = (!b.freebie && xpAmt > 0)
    ? `<div class="dash-badge-xp">+${fmtXp(xpAmt)} XP</div>`
    : "";

  return `
    <div class="dash-badge-card ${isEarned ? 'earned' : 'locked'}${b.type === 'video' ? ' badge-video-card' : ''}"
         onclick="window.openBadgeModal('${b.id}')" title="${esc(b.name)}">
      <div class="dash-badge-reward">${b.market && !isEarned ? `$${b.priceUsd}` : `+${rewardStr} S2M`}</div>
      ${xpHtml}
      <div class="dash-badge-img-wrap">
        ${imgHtml}
      </div>
      <div class="dash-badge-name">${esc(b.name)}</div>
      ${statusHtml}
    </div>`;
}

/* ── Toggle accordion category ───────────────────────────── */
window.toggleBadgeCat = function(catId) {
  const wrap = document.getElementById(`dash-cat-${catId}`);
  if (wrap) wrap.classList.toggle("open");
};

/* ═══════════════════════════════════════════════════════
   NEXT BADGES TO UNLOCK
═══════════════════════════════════════════════════════ */
function renderNextBadges() {
  const el     = document.getElementById("dashNextBadges");
  if (!el) return;
  const earned = new Set(profile.badges || []);
  /* Freebie badges are always earned — skip them in "next to unlock" */
  BADGE_DEFS.filter(b => b.freebie).forEach(b => earned.add(b.id));
  const locked = BADGE_DEFS.filter(b => !earned.has(b.id) && !b.market);

  if (!locked.length) {
    el.innerHTML = `<div style="text-align:center;padding:18px;color:#2cffc9;font-weight:700;font-size:14px;">◆ All badges earned! You're a legend.</div>`;
    return;
  }

  /* Score each locked badge by trackable progress % */
  const scored = locked.map(b => {
    const prog = badgeProgress(b.id);
    const pct  = prog ? Math.min(100, Math.round((prog.cur / prog.max) * 100)) : 0;
    return { b, prog, pct };
  }).sort((a, z) => z.pct - a.pct).slice(0, 3);

  el.innerHTML = `<div class="dash-next-row">${scored.map(({ b, prog, pct }) => {
    const cat       = BADGE_CATEGORIES.find(c => c.id === b.cat);
    const rewardStr = b.reward >= 1 ? b.reward.toFixed(1) : b.reward.toFixed(2);
    const progLabel = prog ? `${prog.label} · ${pct}%` : "Complete requirements";
    return `
      <div class="dash-next-card" onclick="window.openBadgeModal('${b.id}')">
        <div class="dash-next-img-wrap">
          <img class="dash-next-img" src="${b.img || ''}" alt="${esc(b.name)}"
            onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
          <span class="dash-next-emoji" style="display:none">${b.icon}</span>
          <div class="dash-next-lock">▼</div>
        </div>
        <div class="dash-next-name">${esc(b.name)}</div>
        <div class="dash-next-cat" style="color:${cat.color};">${cat.icon} ${cat.label}</div>
        <div class="dash-next-reward">
          <img src="${SOL_LOGO}" style="width:11px;height:11px;border-radius:50%;vertical-align:middle;">
          +${rewardStr} S2M
        </div>
        <div class="dash-next-bar-wrap">
          <div class="dash-next-bar-fill" style="width:${pct}%;background:${cat.color};"></div>
        </div>
        <div class="dash-next-prog-label">${progLabel}</div>
      </div>`;
  }).join("")}</div>`;
}

/* ═══════════════════════════════════════════════════════
   BADGE MODAL
═══════════════════════════════════════════════════════ */
window.openBadgeModal = function(id) {
  if (!profile) return;
  const b        = BADGE_DEFS.find(x => x.id === id);
  if (!b) return;
  const cat      = BADGE_CATEGORIES.find(c => c.id === b.cat);
  const earned   = new Set(profile.badges || []);
  BADGE_DEFS.filter(x => x.freebie).forEach(x => earned.add(x.id));
  getPurchased().forEach(p => earned.add(p.id));
  const isEarned = earned.has(id);
  const rewardStr = b.reward >= 1 ? b.reward.toFixed(1) : b.reward.toFixed(2);

  document.getElementById("badgeModalOverlay")?.remove();

  /* Media in popup — video loops, image shows, emoji fallback */
  let mediaHtml;
  if (b.type === "video" && b.video) {
    /* Always show the video — locked ones get a dim overlay */
    mediaHtml = `
      <div style="position:relative;display:inline-block;border-radius:16px;overflow:hidden;">
        <video class="badge-modal-video" src="${b.video || ''}"
          autoplay loop muted playsinline
          style="${!isEarned ? 'filter:brightness(0.45) saturate(0.5);' : ''}"></video>
        ${!isEarned ? `<div style="position:absolute;inset:0;display:flex;flex-direction:column;
            align-items:center;justify-content:center;gap:6px;">
            <span style="font-size:24px;font-weight:700;">▼</span>
            <span style="font-size:10px;color:rgba(255,255,255,0.7);font-weight:700;">
              Buy to unlock · $${b.priceUsd}</span>
          </div>` : ''}
      </div>`;
  } else if (b.img) {
    mediaHtml = `<img class="badge-modal-img" src="${b.img || ''}" alt="${esc(b.name)}"
          onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
        <div class="badge-modal-emoji" style="display:none">${b.icon}</div>`;
  } else {
    mediaHtml = `<div class="badge-modal-emoji">${b.icon}</div>`;
  }

  /* Status chip */
  let statusChipHtml;
  if (b.freebie) {
    statusChipHtml = `<span class="badge-modal-status-chip earned">◆ FREE — YOURS FOREVER</span>`;
  } else if (b.market && isEarned) {
    statusChipHtml = `<span class="badge-modal-status-chip earned">◆ OWNED</span>`;
  } else if (b.market && !isEarned) {
    statusChipHtml = `<span class="badge-modal-status-chip locked">◆ $${b.priceUsd} — Available in Moon Market</span>`;
  } else {
    statusChipHtml = `<span class="badge-modal-status-chip ${isEarned ? 'earned' : 'locked'}">
      ${isEarned ? '◆ EARNED' : '▼ NOT YET EARNED'}
    </span>`;
  }

  const overlay = document.createElement("div");
  overlay.className = "badge-modal-overlay";
  overlay.id = "badgeModalOverlay";
  overlay.innerHTML = `
    <div class="badge-modal-card" id="badgeModalCard">
      <button class="badge-modal-close" onclick="document.getElementById('badgeModalOverlay').remove()">✕</button>

      <div class="badge-modal-cat-chip"
        style="background:${cat.bgColor};border:1px solid ${cat.borderColor};color:${cat.color};">
        ${cat.icon} ${cat.label}${b.type === "video" ? ' · <span style="color:#c084fc;">▶ ANIMATED</span>' : ''}
      </div>

      <div class="badge-modal-img-wrap ${isEarned ? 'earned' : ''}${b.type === 'video' ? ' badge-modal-video-wrap' : ''}">
        ${mediaHtml}
      </div>

      <div class="badge-modal-name">${esc(b.name)}</div>
      <div class="badge-modal-desc">${esc(b.desc)}</div>

      ${b.reward > 0 ? `
      <div class="badge-modal-reward">
        <img src="${SOL_LOGO}" style="width:18px;height:18px;border-radius:50%;">
        +${rewardStr} S2M reward
      </div>` : ''}

      <div class="badge-modal-status-row">${statusChipHtml}</div>

      <div class="badge-modal-actions">
        ${isEarned ? `
        <button class="badge-modal-btn save" id="badgeSaveBtn"
          onclick="window.saveBadgeImage('${id}')">
          Save Image
        </button>` : (b.market ? `
        <button class="badge-modal-btn save"
          onclick="document.getElementById('badgeModalOverlay').remove();window.openMoonMarket('cosmetics')">
          Buy in Moon Market
        </button>` : '')}
        <button class="badge-modal-btn share-x" id="badgeShareXBtn"
          onclick="window.shareBadgeOnX('${id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          Share on X
        </button>
      </div>
    </div>`;

  /* Close on backdrop click */
  overlay.addEventListener("click", e => {
    if (e.target === overlay) overlay.remove();
  });

  document.body.appendChild(overlay);
};

/* ── Build hidden share card & capture ───────────────────── */
async function buildShareCard(id) {
  const b        = BADGE_DEFS.find(x => x.id === id);
  const cat      = BADGE_CATEGORIES.find(c => c.id === b.cat);
  const isEarned = new Set(profile.badges || []).has(id);
  const rewardStr = b.reward >= 1 ? b.reward.toFixed(1) : b.reward.toFixed(2);
  const short    = wallet ? wallet.slice(0,6) + "…" + wallet.slice(-4) : "";

  /* Remove any old card */
  document.getElementById("badgeShareCard")?.remove();

  const card = document.createElement("div");
  card.id = "badgeShareCard";
  card.innerHTML = `
    <div class="bsc-logo">◆ SCAN2MOON</div>
    <img class="bsc-img" src="${b.img || ''}" alt="${b.name}"
      onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
    <div class="bsc-emoji" style="display:none">${b.icon}</div>
    <div class="bsc-name">${b.name}</div>
    <div class="bsc-desc">${b.desc}</div>
    <div class="bsc-reward">+${rewardStr} S2M reward</div>
    <div class="bsc-status ${isEarned ? 'earned' : 'locked'}">
      ${isEarned ? '◆ EARNED' : '▼ NOT YET EARNED'}
    </div>
    <div style="font-size:11px;color:rgba(44,255,201,0.35);margin-top:6px;">${cat.icon} ${cat.label}</div>
    ${short ? `<div style="font-size:10px;color:rgba(207,255,244,0.25);margin-top:4px;font-family:monospace;">${short}</div>` : ""}
    <div class="bsc-footer">scan2moon.com</div>`;

  document.body.appendChild(card);

  /* Wait one frame for images */
  await new Promise(r => setTimeout(r, 120));

  const canvas = await html2canvas(card, {
    backgroundColor: "#061311",
    scale: 2,
    useCORS: true,
    allowTaint: true,
    logging: false,
  });

  card.remove();
  return { canvas, name: b.name };
}

window.saveBadgeImage = async function(id) {
  const btn = document.getElementById("badgeSaveBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
  try {
    const { canvas, name } = await buildShareCard(id);
    const link = document.createElement("a");
    link.download = `${name.replace(/\s+/g,"-")}-Scan2Moon.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  } catch(e) {
    _DEBUG && console.error("Save badge image error:", e);
    showToast("Could not save image — try again.");
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = "Save Image"; }
  }
};

window.shareBadgeOnX = async function(id) {
  const b   = BADGE_DEFS.find(x => x.id === id);
  const btn = document.getElementById("badgeShareXBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Preparing…"; }
  try {
    const { canvas, name } = await buildShareCard(id);
    /* Auto-download image */
    const link = document.createElement("a");
    link.download = `${name.replace(/\s+/g,"-")}-Scan2Moon.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    /* Open Twitter intent */
    const isEarned = new Set(profile.badges || []).has(id);
    const tweet = isEarned
      ? `Just earned the "${b.name}" achievement on @Scan2Moon!\n\n${b.desc}\n\nReal data. Real discipline.\nhttps://scan2moon.com`
      : `Working towards the "${b.name}" achievement on @Scan2Moon!\n\n${b.desc}\n\nhttps://scan2moon.com`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}`, "_blank");
  } catch(e) {
    _DEBUG && console.error("Share badge error:", e);
    showToast("Could not share — try again.");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg> Share on X`;
    }
  }
};

/* ═══════════════════════════════════════════════════════
   ACADEMY RANK CARD  (for highlight row)
═══════════════════════════════════════════════════════ */
const ACADEMY_RANK_LADDER = [
  { id: "defi_graduate",  icon: "▲", rank: "DeFi Graduate",  color: "#ffd700", graduated: true  },
  { id: "whale_watcher",  icon: "◆", rank: "Whale Tracker",  color: "#60a5fa"                   },
  { id: "chart_reader",   icon: "▲", rank: "Chart Analyst",  color: "#2cffc9"                   },
  { id: "scanner_pro",    icon: "·", rank: "Scanner Pro",    color: "#2cffc9"                   },
  { id: "risk_master",    icon: "◆", rank: "Risk Analyst",   color: "#c084fc"                   },
  { id: "lesson_1",       icon: "·", rank: "Freshman",       color: "#ffb432"                   },
];

function buildAcademyRankCard() {
  const earned   = new Set(profile.badges || []);
  const current  = ACADEMY_RANK_LADDER.find(r => earned.has(r.id));

  /* ── Not enrolled ── */
  if (!current) {
    return { customHtml: `
      <div class="dash-hl-top-label">ACADEMY RANK</div>
      <div class="dash-hl-icon">·</div>
      <div class="dash-hl-val" style="color:rgba(207,255,244,0.25);font-size:20px;">—</div>
      <div class="dash-hl-sub">not enrolled</div>
      <a href="learn2moon.html" class="dash-hl-enroll-btn">Enroll</a>` };
  }

  /* ── Graduated ── */
  if (current.graduated) {
    return { customHtml: `
      <div class="dash-hl-top-label">ACADEMY RANK</div>
      <div class="dash-hl-icon">▲</div>
      <div class="dash-hl-val" style="color:#ffd700;font-size:13px;">GRADUATE</div>
      <div class="dash-hl-sub" style="color:#ffd700;font-size:10px;">🏛️ DeFi Graduate</div>
      <div style="font-size:9px;color:rgba(255,215,0,0.5);margin-top:3px;">Academy Completed</div>`, cls: "academy-grad" };
  }

  /* ── In progress ── */
  return { customHtml: `
    <div class="dash-hl-top-label">ACADEMY RANK</div>
    <div class="dash-hl-icon">${current.icon}</div>
    <div class="dash-hl-val" style="color:${current.color};font-size:13px;">${esc(current.rank).toUpperCase()}</div>
    <div class="dash-hl-sub">Keep learning!</div>` };
}

/* ═══════════════════════════════════════════════════════
   HIGHLIGHT STATS ROW  (Best Trade, Worst Trade, Tasks…)
═══════════════════════════════════════════════════════ */
function renderHighlightStats() {
  const trades   = profile.trades || [];
  const sells    = trades.filter(tr => tr.type === "sell");
  const winSells = sells.filter(tr => (tr.pnl || 0) > 0);
  const losSells = sells.filter(tr => (tr.pnl || 0) < 0);

  const best  = winSells.length  ? winSells.reduce((a, b)  => (b.pnl > a.pnl  ? b : a), winSells[0])  : null;
  const worst = losSells.length  ? losSells.reduce((a, b)  => (b.pnl < a.pnl  ? b : a), losSells[0])  : null;

  const cards = [
    {
      icon: "◆", label: "BEST TRADE",
      val: best  ? `+${formatSol(best.pnl)}`  : "—",
      sub: best  ? esc(best.symbol  || best.name  || "") : "No wins yet",
      color: "#2cffc9",
    },
    {
      icon: "▼", label: "WORST TRADE",
      val: worst ? formatSol(worst.pnl) : "—",
      sub: worst ? esc(worst.symbol || worst.name || "") : "No losses yet",
      color: worst ? "#ff4d6d" : "#2cffc9",
    },
    {
      icon: "◆", label: "TASKS DONE",
      val: String((profile.socialTasksClaimed || []).length),
      sub: (profile.socialTasksClaimed || []).length > 0 ? "social tasks" : "complete tasks for XP",
      color: "#2cffc9",
    },
    {
      icon: "▲", label: "STREAK XP",
      val: `${(profile.loginStreak || 0) * 10}`,
      sub: `${profile.loginStreak || 0} day streak × 10 XP`,
      color: (profile.loginStreak || 0) >= 7 ? "#ffb432" : "#cffff4",
    },
    buildAcademyRankCard(),
  ];

  document.getElementById("dashHighlightRow").innerHTML = cards.map(c =>
    c.customHtml
      ? `<div class="dash-hl-card ${c.cls || ''}">${c.customHtml}</div>`
      : `<div class="dash-hl-card ${c.soon ? 'soon' : ''}">
           <div class="dash-hl-top-label">${c.label}</div>
           <div class="dash-hl-icon">${c.icon}</div>
           <div class="dash-hl-val" style="color:${c.color}">${c.val}</div>
           <div class="dash-hl-sub">${c.sub}</div>
           ${c.soon ? '<div class="dash-hl-soon-chip">COMING SOON</div>' : ''}
         </div>`
  ).join("");
}

/* ═══════════════════════════════════════════════════════
   APE SIMULATOR QUICK STATS  (6 cards: 2×3 grid)
═══════════════════════════════════════════════════════ */
function renderApeStats() {
  const wins    = profile.winCount   || 0;
  const losses  = profile.lossCount  || 0;
  const total   = wins + losses;
  const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : "0";
  const pnl     = profile.totalPnL   || 0;
  const pnlSign = pnl >= 0 ? "+" : "";
  const pnlCls  = pnl >= 0 ? "#2cffc9" : "#ff4d6d";
  const bal     = profile.balance    || 10;

  /* ── LIVE P/L from open holdings ── */
  const holdings    = profile.holdings || {};
  let   investedSol = 0;
  let   livePnlSol  = 0;
  let   hasLiveData = false;

  for (const [mint, h] of Object.entries(holdings)) {
    if ((h.amount || 0) < 0.000001) continue;
    const costSol = h.totalCostSol || 0;
    if (costSol <= 0) continue;
    investedSol += costSol;
    const livePrice = dashPrices[mint];
    if (livePrice) {
      const curVal = (_dashSolUsd > 0 && h.amount > 0)
        ? (h.amount * livePrice / _dashSolUsd)
        : (h.avgPrice > 0 ? costSol * (livePrice / h.avgPrice) : null);
      if (curVal !== null) {
        livePnlSol += curVal - costSol;
        hasLiveData = true;
      }
    }
  }

  const livePnlSign = livePnlSol >= 0 ? "+" : "";
  const livePnlCls  = livePnlSol >= 0 ? "#2cffc9" : "#ff4d6d";
  const livePnlDisp = hasLiveData ? `${livePnlSign}${formatSol(livePnlSol)}` : "—";
  const investDisp  = investedSol > 0 ? formatSol(investedSol) : "—";

  const cards = [
    { label: "BALANCE",      val: formatSol(bal),                    color: "#ffb432" },
    { label: "ALL-TIME P/L", val: `${pnlSign}${formatSol(pnl)}`,     color: pnlCls   },
    { label: "LIVE P/L",     val: livePnlDisp,                       color: hasLiveData ? livePnlCls : "rgba(207,255,244,0.4)" },
    { label: "INVESTED",     val: investDisp,                        color: investedSol > 0 ? "#ffb432" : "rgba(207,255,244,0.4)" },
    { label: "WIN RATE",     val: `${winRate}%`,                     color: parseFloat(winRate) >= 50 ? "#2cffc9" : "#ff4d6d" },
    { label: "TRADES",       val: total,                             color: "#cffff4" },
  ];

  document.getElementById("dashApeStats").innerHTML = cards.map(c => `
    <div class="dash-qs-card">
      <div class="dash-qs-label">${c.label}</div>
      <div class="dash-qs-val" style="color:${c.color}">${c.val}</div>
    </div>`).join("");

  /* ── Dual donut: WIN RATE + LIVE P/L ── */
  const winPct    = total > 0 ? Math.round((wins / total) * 100) : 0;
  /* Live P/L % ring: clamp 0–100 where 0=breakeven, 100=doubled or better */
  const livePnlPct = hasLiveData && investedSol > 0
    ? Math.min(100, Math.max(0, Math.round(50 + (livePnlSol / investedSol) * 50)))
    : 50; /* 50 = neutral when no live data */

  const donutEl = document.getElementById("dashDonutWrap");
  if (donutEl) {
    donutEl.innerHTML = `
      <div style="display:flex;gap:18px;align-items:center;justify-content:center;flex-wrap:wrap;">
        <!-- Win Rate ring -->
        <div style="display:flex;flex-direction:column;align-items:center;gap:6px;">
          <div class="dash-donut-ring" style="--win-pct:${winPct}">
            <div class="dash-donut-inner">
              <div class="dash-donut-val">${winRate}%</div>
              <div class="dash-donut-lbl">WIN RATE</div>
            </div>
          </div>
          <div class="dash-donut-legend">
            <span class="dash-donut-dot" style="background:#2cffc9;"></span> WIN ${wins}
            <span class="dash-donut-dot" style="background:rgba(255,77,109,0.7);margin-left:10px;"></span> LOSE ${losses}
          </div>
        </div>
        <!-- Live P/L ring -->
        <div style="display:flex;flex-direction:column;align-items:center;gap:6px;">
          <div class="dash-donut-ring" style="--win-pct:${livePnlPct};--ring-color:${livePnlCls}">
            <div class="dash-donut-inner" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;">
              <div style="font-size:11px;font-weight:900;line-height:1;color:${hasLiveData ? livePnlCls : 'rgba(207,255,244,0.4)'};white-space:nowrap;">${livePnlDisp}</div>
              <div style="font-size:7px;font-weight:700;letter-spacing:0.8px;color:rgba(207,255,244,0.4);text-transform:uppercase;white-space:nowrap;">LIVE P/L</div>
            </div>
          </div>
          <div class="dash-donut-legend">
            <span class="dash-donut-dot" style="background:#ffb432;"></span> IN: ${investDisp}
          </div>
        </div>
      </div>`;
  }
}

/* ═══════════════════════════════════════════════════════
   RECENT ACTIVITY FEED  (newest → oldest, 5 items/page, max 5 pages)
═══════════════════════════════════════════════════════ */
const ACTIVITY_PER_PAGE  = 10;
const ACTIVITY_MAX_PAGES = 5;
let _activityFeed = [];
let _activityPage = 0;

function renderActivityFeed() {
  const trades       = profile.trades     || [];
  const earnedBadges = profile.badges     || [];
  const streak       = profile.loginStreak || 0;
  const now          = Date.now();

  /* ── XP calc helpers — must match renderStatsRow() formula exactly ── */
  const wins_af    = profile.winCount  || 0;
  const losses_af  = profile.lossCount || 0;
  const missionXp_af = _getMissionData().filter(m => m.current >= m.target).reduce((s, m) => s + m.xp, 0);
  const totalXp = ((wins_af + losses_af) * 25)
    + (streak * 10)
    + (profile.badgeXp   || 0)
    + (profile.socialXp  || 0)
    + (profile.academyXp || 0)
    + missionXp_af;
  const currentLevel = calcLevel(totalXp);
  const acadXp       = profile.academyXp || 0;
  const acadLevel    = calcAcadLevel(acadXp);

  const feed = [];

  /* ── Daily login reward — pinned as most-recent ── */
  if (streak > 0) {
    const DAILY_REWARDS_SOL = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
    const lastReward = DAILY_REWARDS_SOL[Math.min(streak, 7)];
    feed.push({
      icon: "·",
      text: `Daily login claimed — <strong>+${lastReward.toFixed(2)} S2M</strong> · <span style="color:#c084fc">+10 XP</span> · ${streak}-day streak`,
      time: "today",
      ts: now,
    });
  }

  /* ── General level milestone ── */
  if (currentLevel >= 1) {
    feed.push({
      icon: "◆",
      text: `Level <strong style="color:#ffb432">${currentLevel}</strong> reached — <span style="color:#c084fc">${totalXp.toLocaleString()} XP total</span>`,
      time: "current",
      ts: now - 1000,
    });
  }

  /* ── Academy Level milestone ── */
  if (acadLevel >= 2) {
    const ACAD_LEVEL_NAMES = ["", "Enrolled", "Student", "Scholar", "Advanced", "Professor", "Master", "Legend"];
    const lvlName = ACAD_LEVEL_NAMES[Math.min(acadLevel, ACAD_LEVEL_NAMES.length - 1)] || "";
    feed.push({
      icon: "🎓",
      text: `Academy Level <strong style="color:#ffb432">${acadLevel}${lvlName ? ` — ${lvlName}` : ""}</strong> unlocked! <span style="color:#c084fc">${acadXp.toLocaleString()} Academy XP</span>`,
      time: "achieved",
      ts: now - 2000,
    });
  }

  /* ── Guide completions — timestamped from academyProgress ── */
  const GUIDE_LESSON_MAP = {
    "risk_scanner_guide_v1": { name: "S2M — From Zero to Moon", icon: "📊", sol: 1 },
    "whale_dna_guide_v1":    { name: "Whale DNA",                icon: "🐋", sol: 1 },
    "safe_ape_guide_v1":     { name: "Safe Ape Simulator",       icon: "🦍", sol: 1 },
  };
  const prog = profile.academyProgress || {};
  for (const [lessonId, info] of Object.entries(GUIDE_LESSON_MAP)) {
    if (prog[lessonId]) {
      const ts = prog[lessonId].completedAt ? Date.parse(prog[lessonId].completedAt) : (now - 60000);
      feed.push({
        icon: info.icon,
        text: `Guide completed: <strong>${info.name}</strong> · <span style="color:#2cffc9">+${info.sol} S2M</span> · <span style="color:#c084fc">+XP earned</span>`,
        time: "completed",
        ts,
      });
    }
  }

  /* ── Badges earned — show all non-freebie badges (last in array = newest) ── */
  const freebieIds  = new Set(BADGE_DEFS.filter(x => x.freebie).map(x => x.id));
  const earnedNonFree = earnedBadges.filter(id => !freebieIds.has(id));
  const badgeList   = [...earnedNonFree].reverse().slice(0, 10);
  for (let i = 0; i < badgeList.length; i++) {
    const b = BADGE_DEFS.find(x => x.id === badgeList[i]);
    if (!b) continue;
    const xpAmt   = b.xp || (b.market ? 0 : Math.round(b.reward * 1000));
    const xpBonus = xpAmt > 0 ? ` · <span style="color:#c084fc">+${xpAmt >= 1000 ? (xpAmt/1000).toFixed(xpAmt%1000===0?0:1)+"K":xpAmt} XP</span>` : "";
    const solStr  = !b.market && b.reward > 0 ? ` · +${b.reward >= 1 ? b.reward.toFixed(1) : b.reward.toFixed(2)} S2M` : "";
    feed.push({
      icon: "◆",
      text: `Badge unlocked: <strong>${esc(b.name)}</strong>${solStr}${xpBonus}`,
      time: "earned",
      ts: now - 3000 - (i * 500),   // synthetic spacing — most-recent badge first
    });
  }

  /* ── Social XP ── */
  if ((profile.socialXp || 0) > 0) {
    feed.push({
      icon: "·",
      text: `Social tasks completed — <span style="color:#c084fc">+${profile.socialXp} XP</span>`,
      time: "earned",
      ts: now - 4000,
    });
  }

  /* ── Trades — timestamped, skip guide_reward entries ── */
  const realTrades = trades.filter(tr => tr.type !== "guide_reward");
  for (const tr of realTrades.slice(0, 25)) {
    const isBuy  = tr.type === "buy";
    const pnlSol = !isBuy && tr.pnl !== undefined ? parseFloat(tr.pnl) : null;
    const pnlStr = pnlSol !== null
      ? ` <span style="font-weight:800;color:${pnlSol >= 0 ? '#2cffc9' : '#ff4d6d'}">${pnlSol >= 0 ? '+' : ''}${formatSol(pnlSol)}</span>`
      : "";
    const xpStr  = !isBuy ? ` <span style="color:#c084fc">+25 XP</span>` : "";
    feed.push({
      icon: isBuy ? "+" : "-",
      text: `${isBuy ? "Bought" : "Sold"} <strong>${esc(tr.symbol || tr.name)}</strong>${pnlStr}${xpStr}`,
      time: timeAgo(tr.timestamp),
      ts: tr.timestamp ? Date.parse(tr.timestamp) : (now - 100000),
    });
  }

  /* ── Sort newest-first, cap at 5 pages × 5 items = 25 — oldest dropped ── */
  feed.sort((a, b) => b.ts - a.ts);
  _activityFeed = feed.slice(0, ACTIVITY_PER_PAGE * ACTIVITY_MAX_PAGES);
  _activityPage = 0;
  _renderActivityPage(0);
}

function _renderActivityPage(page) {
  _activityPage = page;
  const total      = _activityFeed.length;
  const totalPages = Math.min(ACTIVITY_MAX_PAGES, Math.ceil(total / ACTIVITY_PER_PAGE));
  const start      = page * ACTIVITY_PER_PAGE;
  const pageItems  = _activityFeed.slice(start, start + ACTIVITY_PER_PAGE);

  const feedEl  = document.getElementById("dashActivityFeed");
  const pagerEl = document.getElementById("dashActivityPager");
  if (!feedEl) return;

  feedEl.innerHTML = pageItems.length
    ? pageItems.map(item => `
        <div class="dash-activity-item">
          <span class="dash-activity-icon">${item.icon}</span>
          <span class="dash-activity-text">${item.text}</span>
          <span class="dash-activity-time">${item.time}</span>
        </div>`).join("")
    : `<div style="text-align:center;padding:20px;opacity:0.4;font-size:13px;">No activity yet — start trading!</div>`;

  /* ── Paginator ── */
  if (!pagerEl) return;
  if (totalPages <= 1) { pagerEl.innerHTML = ""; return; }

  const dots = Array.from({ length: totalPages }, (_, i) => `
    <button class="dash-pager-dot${i === page ? " active" : ""}"
            onclick="window._renderActivityPage(${i})" title="Page ${i + 1}"></button>`).join("");

  pagerEl.innerHTML = `
    <div class="dash-activity-pager">
      <button class="dash-pager-btn" onclick="window._renderActivityPage(${page - 1})"
              ${page === 0 ? "disabled" : ""}>&#8249;</button>
      <div class="dash-pager-dots">${dots}</div>
      <button class="dash-pager-btn" onclick="window._renderActivityPage(${page + 1})"
              ${page >= totalPages - 1 ? "disabled" : ""}>&#8250;</button>
    </div>`;
}
/* expose for inline onclick handlers */
window._renderActivityPage = _renderActivityPage;

/* ═══════════════════════════════════════════════════════
   TRADE HISTORY  (panel preview — last 10)
═══════════════════════════════════════════════════════ */
function renderTradeHistory() {
  const el     = document.getElementById("dashTradeHistory");
  const trades = (profile.trades || []).slice(0, 10);

  if (!trades.length) {
    el.innerHTML = `<div class="dash-trade-empty">No trades yet — head to the Simulator!</div>`;
    return;
  }

  el.innerHTML = `
    <div class="dash-trade-table">
      <div class="dash-trade-header">
        <div>TYPE</div><div>TOKEN</div><div>AMOUNT</div><div>P/L</div><div>DATE</div>
      </div>
      ${trades.map(tr => buildTradeRow(tr)).join("")}
    </div>`;
}

/* ── Shared row builder (panel + modal) ──────────────── */
function buildTradeRow(tr) {
  const isBuy   = tr.type === "buy";
  const pnlSol  = !isBuy && tr.pnl !== undefined ? parseFloat(tr.pnl) : null;
  const pnlHtml = pnlSol !== null
    ? `<span style="color:${pnlSol>=0?'#2cffc9':'#ff4d6d'};font-weight:800;">${pnlSol>=0?'+':''}${formatSol(pnlSol)}</span>`
    : `<span style="opacity:0.3">—</span>`;
  const amtSol  = isBuy ? (tr.totalCostSol || null) : (tr.totalReceivedSol || null);
  const amtHtml = amtSol !== null ? formatSol(amtSol) : "—";
  const date    = new Date(tr.timestamp).toLocaleDateString(undefined, { month:"short", day:"numeric" });

  return `
    <div class="dash-trade-row">
      <div><span class="dash-trade-badge ${isBuy?'buy':'sell'}">${isBuy?'BUY':'SELL'}</span></div>
      <div>
        <div class="dash-trade-token">${esc(tr.symbol || tr.name)}</div>
        <div class="dash-trade-sym">${esc(tr.name || "")}</div>
      </div>
      <div class="dash-trade-amt">${amtHtml}</div>
      <div class="dash-trade-pnl">${pnlHtml}</div>
      <div style="font-size:10px;opacity:0.35;white-space:nowrap;">${date}</div>
    </div>`;
}

/* ═══════════════════════════════════════════════════════
   P/L BAR CHART  (last 10 sells)
═══════════════════════════════════════════════════════ */
function renderPnlChart() {
  const el    = document.getElementById("dashPnlChart");
  if (!el) return;

  const sells = (profile.trades || [])
    .filter(t => t.type === "sell" && t.pnl !== undefined)
    .slice(0, 10)
    .reverse(); /* oldest → newest, left → right */

  if (sells.length < 2) { el.style.display = "none"; return; }
  el.style.display = "block";

  const vals   = sells.map(t => parseFloat(t.pnl));
  const maxAbs = Math.max(...vals.map(Math.abs), 0.001);

  el.innerHTML = `
    <div class="pnl-chart-title">P/L PER SELL · LAST ${sells.length} TRADES</div>
    <div class="pnl-chart-bars">
      ${sells.map(t => {
        const v    = parseFloat(t.pnl);
        const pct  = Math.max(4, Math.round((Math.abs(v) / maxAbs) * 100));
        const pos  = v >= 0;
        const sym  = (t.symbol || t.name || "").slice(0, 5);
        return `
          <div class="pnl-bar-col">
            <div class="pnl-bar-wrap">
              <div class="pnl-bar ${pos ? 'pos' : 'neg'}" style="height:${pct}%"
                title="${pos ? '+' : ''}${formatSol(v)} — ${esc(t.symbol || t.name || '')}"></div>
            </div>
            <div class="pnl-bar-label">${esc(sym)}</div>
          </div>`;
      }).join("")}
    </div>`;
}

/* ═══════════════════════════════════════════════════════
   FULL TRADE HISTORY MODAL  (all 30, paginated)
═══════════════════════════════════════════════════════ */
const TH_PER_PAGE = 10;
let _thPage = 0;

window.openTradeHistoryModal = function() {
  _thPage = 0;
  document.getElementById("tradeHistModalOverlay")?.remove();

  const overlay = document.createElement("div");
  overlay.className = "th-modal-overlay";
  overlay.id        = "tradeHistModalOverlay";
  overlay.innerHTML = `
    <div class="th-modal-card" id="tradeHistModalCard">
      <div class="th-modal-header">
        <div class="th-modal-title">📋 FULL TRADE HISTORY</div>
        <button class="th-modal-close" onclick="document.getElementById('tradeHistModalOverlay').remove()">✕</button>
      </div>
      <div class="th-modal-body" id="thModalBody"></div>
      <div class="th-modal-pagination" id="thModalPager"></div>
    </div>`;

  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  _renderThPage(0);
};

function _renderThPage(page) {
  const allTrades = profile.trades || [];
  const total     = allTrades.length;
  const pages     = Math.max(1, Math.ceil(total / TH_PER_PAGE));
  _thPage = Math.max(0, Math.min(page, pages - 1));

  const slice = allTrades.slice(_thPage * TH_PER_PAGE, (_thPage + 1) * TH_PER_PAGE);

  const body  = document.getElementById("thModalBody");
  const pager = document.getElementById("thModalPager");
  if (!body || !pager) return;

  /* ── Table ── */
  body.innerHTML = !total
    ? `<div class="dash-trade-empty">No trades yet — start trading in the Simulator!</div>`
    : `<div class="th-modal-count">${total} trade${total!==1?'s':''} saved (max 30)</div>
       <div class="dash-trade-table">
         <div class="dash-trade-header">
           <div>TYPE</div><div>TOKEN</div><div>AMOUNT</div><div>P/L</div><div>DATE</div>
         </div>
         ${slice.map(tr => buildTradeRow(tr)).join("")}
       </div>`;

  /* ── Pagination ── */
  if (pages <= 1) { pager.innerHTML = ""; return; }

  const btns = [];
  btns.push(`<button class="th-pg-btn" ${_thPage===0?"disabled":""} onclick="window._thGoPage(${_thPage-1})">‹</button>`);
  for (let i = 0; i < pages; i++) {
    btns.push(`<button class="th-pg-btn ${i===_thPage?'active':''}" onclick="window._thGoPage(${i})">${i+1}</button>`);
  }
  btns.push(`<button class="th-pg-btn" ${_thPage===pages-1?"disabled":""} onclick="window._thGoPage(${_thPage+1})">›</button>`);

  pager.innerHTML = btns.join("");
}

window._thGoPage = function(page) { _renderThPage(page); };

/* ═══════════════════════════════════════════════════════
   CURRENT HOLDINGS  (with live P/L)
═══════════════════════════════════════════════════════ */
function renderHoldings() {
  const el       = document.getElementById("dashHoldings");
  const holdings = profile.holdings || {};
  const keys     = Object.keys(holdings).filter(k => (holdings[k]?.amount || 0) > 0.000001);

  if (!keys.length) {
    el.innerHTML = `<div class="dash-holdings-empty">No open positions — start trading in the Simulator!</div>`;
    return;
  }

  /* ── Summary totals (computed once at render; refreshed live by refreshHoldingsSummary) ── */
  let totalCost = 0, totalCurVal = 0, pricesLoaded = 0;
  keys.forEach(mint => {
    const h = holdings[mint];
    const costSol = h.totalCostSol || 0;
    totalCost += costSol;
    const price = dashPrices[mint];
    if (price) {
      const cv = (_dashSolUsd > 0 && h.amount > 0)
        ? (h.amount * price / _dashSolUsd)
        : (h.avgPrice > 0 && costSol > 0 ? costSol * (price / h.avgPrice) : null);
      if (cv !== null) { totalCurVal += cv; pricesLoaded++; }
    }
  });
  const allLoaded    = pricesLoaded === keys.length;
  const totalPnl     = allLoaded ? totalCurVal - totalCost : null;
  const totalPnlPct  = (totalPnl !== null && totalCost > 0) ? (totalPnl / totalCost) * 100 : null;
  const pnlColor     = totalPnl === null ? "rgba(207,255,244,0.35)" : totalPnl >= 0 ? "#2cffc9" : "#ff4d6d";
  const pnlSign      = totalPnl !== null && totalPnl >= 0 ? "+" : "";
  const pnlSolTxt    = totalPnl !== null ? `${pnlSign}${formatSol(totalPnl)}` : "Loading…";
  const pnlPctTxt    = totalPnlPct !== null ? `${pnlSign}${totalPnlPct.toFixed(2)}%` : "";

  el.innerHTML = `
    <div class="dh-summary">
      <div class="dh-summary-col">
        <div class="dh-summary-label">TOTAL P/L</div>
        <div class="dh-summary-pnl-sol" id="dhTotalPnlSol" style="color:${pnlColor}">${pnlSolTxt}</div>
        <div class="dh-summary-pnl-pct" id="dhTotalPnlPct" style="color:${pnlColor}">${pnlPctTxt}</div>
      </div>
      <div class="dh-summary-divider"></div>
      <div class="dh-summary-col">
        <div class="dh-summary-label">INVESTED</div>
        <div class="dh-summary-invested" id="dhTotalInvested">${formatSol(totalCost)}</div>
        <div class="dh-summary-invested-lbl">${keys.length} position${keys.length !== 1 ? "s" : ""}</div>
      </div>
    </div>

    <div class="dash-holdings-list">${keys.map(mint => {
    const h        = holdings[mint];
    const logo     = h.logo ? `/.netlify/functions/logoProxy?url=${encodeURIComponent(h.logo)}` : "/sol2moon-token.png";
    const costSol  = h.totalCostSol || 0;
    const safeMnt  = String(mint).replace(/[^1-9A-HJ-NP-Za-km-z]/g, "");

    /* Use cached price — amount×price÷solPrice for accuracy (matches watchlist) */
    const price    = dashPrices[mint];
    const curVal   = !price ? null
      : (_dashSolUsd > 0 && h.amount > 0)
        ? (h.amount * price / _dashSolUsd)
        : (h.avgPrice > 0 && costSol > 0 ? costSol * (price / h.avgPrice) : null);
    const pnlSol   = curVal !== null ? curVal - costSol : null;
    const pnlPct   = pnlSol !== null && costSol > 0 ? (pnlSol / costSol) * 100 : null;
    const sign     = pnlSol !== null ? (pnlSol >= 0 ? "+" : "") : "";
    const pnlCol   = pnlSol !== null ? (pnlSol >= 0 ? "#2cffc9" : "#ff4d6d") : "rgba(207,255,244,0.3)";
    const pnlText  = pnlSol !== null
      ? `${sign}${formatSol(pnlSol)}  (${sign}${pnlPct.toFixed(1)}%)`
      : "⬤ Loading…";

    return `
      <div class="dash-holding-row">
        <img class="dash-holding-logo" src="${logo}"
          onerror="this.src='/sol2moon-token.png'" />
        <div class="dash-holding-info">
          <div class="dash-holding-name">${esc(h.name || h.symbol)}</div>
          <div class="dash-holding-sym">${esc(h.symbol)}</div>
        </div>
        <div class="dash-holding-vals">
          <div class="dash-holding-cost" id="dash-val-${safeMnt}">${curVal !== null ? formatSol(curVal) : formatSol(costSol)}</div>
          <div class="dash-holding-cost-lbl">cost ${formatSol(costSol)}</div>
          <div class="dash-holding-pnl" id="dash-pnl-${safeMnt}" style="color:${pnlCol};">${pnlText}</div>
          <div class="dash-holding-dot" id="dash-dot-${safeMnt}">⬤ LIVE · 30s</div>
        </div>
        <a class="dash-holding-btn" href="safe-ape.html"
          onclick="localStorage.setItem('sa_prefill_mint','${safeMnt}')">
          Trade →
        </a>
      </div>`;
  }).join("")}</div>`;   /* closes .dash-holdings-list */
}

/* Recalculate & refresh only the summary totals (called after each price tick) */
function refreshHoldingsSummary() {
  const solEl   = document.getElementById("dhTotalPnlSol");
  const pctEl   = document.getElementById("dhTotalPnlPct");
  if (!solEl || !pctEl) return; /* holdings not rendered yet */

  const holdings = profile?.holdings || {};
  const keys     = Object.keys(holdings).filter(k => (holdings[k]?.amount || 0) > 0.000001);
  let totalCost = 0, totalCurVal = 0, pricesLoaded = 0;

  keys.forEach(mint => {
    const h = holdings[mint];
    const costSol = h.totalCostSol || 0;
    totalCost += costSol;
    const price = dashPrices[mint];
    if (price) {
      const cv = (_dashSolUsd > 0 && h.amount > 0)
        ? (h.amount * price / _dashSolUsd)
        : (h.avgPrice > 0 && costSol > 0 ? costSol * (price / h.avgPrice) : null);
      if (cv !== null) { totalCurVal += cv; pricesLoaded++; }
    }
  });

  if (pricesLoaded === 0) return; /* still loading, leave previous values */

  const totalPnl    = totalCurVal - totalCost;
  const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
  const color       = totalPnl >= 0 ? "#2cffc9" : "#ff4d6d";
  const sign        = totalPnl >= 0 ? "+" : "";

  solEl.textContent  = `${sign}${formatSol(totalPnl)}`;
  solEl.style.color  = color;
  pctEl.textContent  = `${sign}${totalPnlPct.toFixed(2)}%`;
  pctEl.style.color  = color;
}

/* ═══════════════════════════════════════════════════════
   ACCOUNT SETTINGS MODAL
═══════════════════════════════════════════════════════ */
window.openAccountSettings = function() {
  try {
  if (!profile) {
    showToast("Dashboard is still loading — please wait a moment.");
    return;
  }
  document.getElementById("accountSettingsOverlay")?.remove();

  const earned    = new Set(profile.badges || []);
  /* Freebie + purchased badges are always available */
  BADGE_DEFS.filter(b => b.freebie).forEach(b => earned.add(b.id));
  getPurchased().forEach(p => earned.add(p.id));
  const savedName = localStorage.getItem("sa_display_name") || profile.accountName || "";
  const savedAvId = localStorage.getItem("sa_avatar_id") || "";

  /* All owned badges across every category shown in avatar picker */
  const avatarOptions = BADGE_DEFS.filter(b => b.freebie || earned.has(b.id));

  /* If nothing saved yet, pre-select Classic Ape */
  const effectiveAvId = savedAvId || "cosm_classic_ape";

  const avatarHtml = avatarOptions.map(b => `
    <div class="accs-av-option ${b.id === effectiveAvId ? 'selected' : ''}"
         id="av-opt-${b.id}"
         onclick="window.selectAvatar('${b.id}')"
         title="${esc(b.name || b.icon || '◆')}">
      ${b.type === "video" && b.video
        ? `<video src="${b.video || ''}" class="accs-av-video" autoplay loop muted playsinline></video>`
        : b.img
          ? `<img src="${b.img || ''}" class="accs-av-img"
               onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
             <span class="accs-av-emoji" style="display:none">${b.icon}</span>`
          : `<span class="accs-av-emoji">${b.icon}</span>`}
    </div>`).join("");

  const overlay = document.createElement("div");
  overlay.className = "accs-overlay";
  overlay.id        = "accountSettingsOverlay";
  overlay.innerHTML = `
    <div class="accs-card" id="accountSettingsCard">

      <div class="accs-header">
        <div class="accs-title">⚙️ ACCOUNT SETTINGS</div>
        <button class="accs-close" onclick="document.getElementById('accountSettingsOverlay').remove()">✕</button>
      </div>

      <!-- Display Name -->
      <div class="accs-section">
        <div class="accs-section-label">DISPLAY NAME</div>
        <div class="accs-name-row">
          <input class="accs-name-input" id="accsNameInput" type="text"
            maxlength="24" placeholder="Your name…" value="${esc(savedName)}" />
          <button class="accs-save-btn" onclick="window.saveDisplayName()">Save</button>
        </div>
        <div class="accs-name-hint">Max 24 characters</div>
      </div>

      <!-- Avatar Picker -->
      <div class="accs-section">
        <div class="accs-section-label">PROFILE AVATAR</div>
        <div class="accs-section-sub">Choose from your earned badges</div>
        <div class="accs-av-grid" id="accsAvatarGrid">
          ${avatarHtml}
        </div>
        ${earned.size === 0 ? `<div class="accs-av-hint">Earn badges to unlock more avatar options!</div>` : ""}
      </div>

      <!-- Moon Market -->
      <div class="accs-section accs-market-row">
        <div class="accs-market-info">
          <div class="accs-section-label" style="color:#ff6eb4;">◆ MOON MARKET</div>
          <div class="accs-section-sub">Frames · Profile Cards · Cosmetic Badges</div>
        </div>
        <button class="accs-market-open-btn" onclick="window.openMoonMarket()">Open →</button>
      </div>

      <!-- Reset Account -->
      <div class="accs-section accs-reset-section">
        <button class="accs-reset-btn" onclick="window.resetDashAccount()">
          🗑️ Reset Account
        </button>
        <div class="accs-name-hint" style="text-align:center;margin-top:6px;color:rgba(255,77,109,0.7);">Clears all trades, badges &amp; XP — balance resets to 10 S2M</div>
      </div>

      <!-- Disconnect -->
      <div class="accs-section accs-disconnect-section">
        <button class="accs-disconnect-btn" onclick="window.disconnectDashWallet()">
          🔌 Disconnect Wallet
        </button>
        <div class="accs-name-hint" style="text-align:center;margin-top:6px;">Clears your session — your data stays safe on-chain</div>
      </div>

    </div>`;

  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  } catch (err) {
    _DEBUG && console.error("[AccountSettings] Error:", err);
    showToast("Could not open settings — check the console for details.");
  }
};

/* ═══════════════════════════════════════════════════════
   MOON MARKET MODAL
═══════════════════════════════════════════════════════ */
window.openMoonMarket = function(startTab = "frames") {
  document.getElementById("moonMarketOverlay")?.remove();

  const savedFrameId = localStorage.getItem("sa_frame_id")   || "frame_none";
  const savedCardId  = localStorage.getItem("sa_card_design") || "card_classic";
  const owned = new Set([
    ...BADGE_DEFS.filter(b => b.freebie).map(b => b.id),
    ...(profile?.badges || []),
    ...getPurchased().map(p => p.id),
  ]);

  /* ── Frame items ── */
  function frameItemHtml(f) {
    const isOwned    = f.freebie || isPurchased(f.id);
    const isEquipped = f.id === savedFrameId;
    const previewCls = `mm-frame-preview${f.cssClass ? " " + f.cssClass : ""}`;
    return `
      <div class="mm-item${isEquipped ? " mm-item-active" : ""}">
        <div class="${previewCls}"><div class="mm-frame-avatar">◆</div></div>
        <div class="mm-item-name">${esc(f.name)}</div>
        <div class="mm-item-desc">${esc(f.desc)}</div>
        <div class="mm-item-price${f.freebie ? " mm-price-free" : ""}">${f.freebie ? "FREE" : `$${f.price}`}</div>
        ${isOwned
          ? `<button class="mm-equip-btn${isEquipped ? " mm-equipped" : ""}"
               data-frame="${f.id}" onclick="window.equipFrame('${f.id}')">
               ${isEquipped ? "◆ EQUIPPED" : "Equip"}</button>`
          : `<button class="mm-buy-btn" data-buy="${f.id}"
               onclick="window.buyMarketItem('frame','${f.id}',${f.price})">
               Buy $${f.price}</button>`}
      </div>`;
  }

  /* ── Card design items ── */
  function cardItemHtml(c) {
    const isOwned    = c.freebie || isPurchased(c.id);
    const isEquipped = c.id === savedCardId;
    const th = CARD_THEMES[c.id] || CARD_THEMES.card_classic;
    return `
      <div class="mm-item${isEquipped ? " mm-item-active" : ""}">
        <div class="mm-card-preview" style="background:${th.bg};border-color:${th.border};">
          <div class="mm-card-prev-logo" style="color:${th.logo};">◆ S2M</div>
          <div class="mm-card-prev-tag"  style="color:${th.logo};opacity:.6;">${esc(c.icon)} ${esc(c.name)}</div>
          <div class="mm-card-prev-stats" style="color:${th.logo};">
            <span>P/L</span><span>WIN%</span><span>LVL</span></div>
        </div>
        <div class="mm-item-name">${esc(c.name)}</div>
        <div class="mm-item-desc">${esc(c.desc)}</div>
        <div class="mm-item-price${c.freebie ? " mm-price-free" : ""}">${c.freebie ? "FREE" : `$${c.price}`}</div>
        ${isOwned
          ? `<button class="mm-equip-btn${isEquipped ? " mm-equipped" : ""}"
               data-card="${c.id}" onclick="window.equipCardDesign('${c.id}')">
               ${isEquipped ? "◆ EQUIPPED" : "Equip"}</button>`
          : `<button class="mm-buy-btn" data-buy="${c.id}"
               onclick="window.buyMarketItem('card','${c.id}',${c.price})">
               Buy $${c.price}</button>`}
      </div>`;
  }

  /* ── Cosmetic badge item ── */
  function cosmeticItemHtml(b) {
    const isOwned = b.freebie || owned.has(b.id);
    const previewHtml = b.type === "video" && b.video
      ? `<video src="${b.video || ''}" class="mm-badge-video" autoplay loop muted playsinline></video>`
      : b.img
        ? `<img src="${b.img || ''}" style="width:72px;height:72px;object-fit:cover;border-radius:12px;"
             onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
           <span style="display:none;font-size:44px;">${b.icon}</span>`
        : `<span style="font-size:52px;line-height:1;">${b.icon}</span>`;
    return `
      <div class="mm-item">
        <div class="mm-badge-preview">${previewHtml}</div>
        <div class="mm-item-name">${esc(b.name)}</div>
        <div class="mm-item-desc">${esc(b.desc)}</div>
        <div class="mm-item-price${b.freebie ? " mm-price-free" : ""}">${b.freebie ? "FREE" : `$${b.priceUsd}`}</div>
        ${isOwned
          ? `<button class="mm-equip-btn" onclick="window.selectAvatar('${b.id}');showToast('Avatar set to ${esc(b.name)}!')">
               Use as Avatar</button>`
          : `<button class="mm-buy-btn" data-buy="${b.id}"
               onclick="window.buyMarketItem('badge','${b.id}',${b.priceUsd})">
               Buy $${b.priceUsd}</button>`}
      </div>`;
  }

  /* ── Cosmetics panel with sub-sections ── */
  const freeBadges    = BADGE_DEFS.filter(b => b.cat === "cosmetics" && b.subcat === "free");
  const communityBadges = BADGE_DEFS.filter(b => b.cat === "cosmetics" && b.subcat === "community");
  const krakenBadges  = BADGE_DEFS.filter(b => b.cat === "cosmetics" && b.subcat === "moon_krakens");

  const cosmeticsHtml = `
    <div class="mm-subheader">FREE ACHIEVEMENTS</div>
    <div class="mm-sub-grid">${freeBadges.map(cosmeticItemHtml).join("")}</div>
    <div class="mm-subheader" style="color:#ff6eb4;">◆ COMMUNITY BADGES</div>
    <div class="mm-sub-grid">${communityBadges.map(cosmeticItemHtml).join("")}</div>
    <div class="mm-subheader" style="color:#c084fc;">◆ MOON KRAKENS <span class="mm-animated-chip">ANIMATED</span></div>
    <div class="mm-sub-grid">${krakenBadges.map(cosmeticItemHtml).join("")}</div>`;

  const overlay = document.createElement("div");
  overlay.className = "mm-overlay";
  overlay.id = "moonMarketOverlay";
  overlay.innerHTML = `
    <div class="mm-modal">
      <div class="mm-header">
        <div class="mm-title">◆ MOON MARKET</div>
        <button class="mm-close" onclick="document.getElementById('moonMarketOverlay').remove()">✕</button>
      </div>
      <div class="mm-subtitle">Cosmetics only — we never sell trading advantages, only style. One-time purchase, yours forever.</div>
      <div class="mm-tabs">
        <button class="mm-tab${startTab==="skins"?" active":""}"     onclick="window.mmSwitchTab('skins')">🎨 Skins</button>
        <button class="mm-tab${startTab==="frames"?" active":""}"    onclick="window.mmSwitchTab('frames')">◆ Frames</button>
        <button class="mm-tab${startTab==="cards"?" active":""}"     onclick="window.mmSwitchTab('cards')">◆ Cards</button>
        <button class="mm-tab${startTab==="cosmetics"?" active":""}" onclick="window.mmSwitchTab('cosmetics')">◆ Cosmetics</button>
      </div>
      <div id="mm-panel-skins"     style="display:${startTab==="skins"?"block":"none"}" class="mm-panel-cosm">
        <div style="font-size:10px;color:rgba(207,255,244,0.35);margin-bottom:14px;line-height:1.5;">
          Dress your Dashboard. The skin you equip is yours forever — and visible to others when they view your profile from the Leaderboard.
        </div>
        <div class="mm-skins-grid">${DASHBOARD_SKINS.map(skinItemHtml).join("")}</div>
      </div>
      <div id="mm-panel-frames"    style="display:${startTab==="frames"?"grid":"none"}"    class="mm-panel">
        ${FRAME_DEFS.map(frameItemHtml).join("")}
      </div>
      <div id="mm-panel-cards"     style="display:${startTab==="cards"?"grid":"none"}"     class="mm-panel">
        ${CARD_DESIGN_DEFS.map(cardItemHtml).join("")}
      </div>
      <div id="mm-panel-cosmetics" style="display:${startTab==="cosmetics"?"block":"none"}" class="mm-panel-cosm">
        ${cosmeticsHtml}
      </div>
      <div class="mm-footer-note">
        Payments go directly to fund Scan2Moon development. Thank you for the support!<br>
        Purchases are stored to your wallet session. Keep your wallet connected to access them.
      </div>
    </div>`;

  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
};

window.mmSwitchTab = function(tab) {
  const tabs = ["skins","frames","cards","cosmetics"];
  tabs.forEach(t => {
    const el = document.getElementById(`mm-panel-${t}`);
    if (!el) return;
    const isBlock = t === "skins" || t === "cosmetics";
    el.style.display = t === tab ? (isBlock ? "block" : "grid") : "none";
  });
  document.querySelectorAll(".mm-tab").forEach((btn, i) => {
    btn.classList.toggle("active", tabs[i] === tab);
  });
};

window.equipFrame = function(frameId) {
  localStorage.setItem("sa_frame_id", frameId);
  /* Update hero */
  const frameEl = document.getElementById("dashAvatarFrame");
  if (frameEl) {
    const f = FRAME_DEFS.find(x => x.id === frameId);
    frameEl.className = ("dash-avatar-frame " + (f?.cssClass || "")).trim();
  }
  /* Update buttons inside the market */
  document.querySelectorAll("[data-frame]").forEach(btn => {
    const fid = btn.dataset.frame;
    btn.classList.toggle("mm-equipped", fid === frameId);
    btn.textContent = fid === frameId ? "◆ EQUIPPED" : "Equip";
  });
  /* Update active highlight */
  document.querySelectorAll(".mm-item").forEach(el => {
    const btn = el.querySelector("[data-frame]");
    if (btn) el.classList.toggle("mm-item-active", btn.dataset.frame === frameId);
  });
  showToast("Frame equipped!");
};

window.equipCardDesign = function(designId) {
  localStorage.setItem("sa_card_design", designId);
  /* Update buttons */
  document.querySelectorAll("[data-card]").forEach(btn => {
    const did = btn.dataset.card;
    btn.classList.toggle("mm-equipped", did === designId);
    btn.textContent = did === designId ? "◆ EQUIPPED" : "Equip";
  });
  document.querySelectorAll(".mm-item").forEach(el => {
    const btn = el.querySelector("[data-card]");
    if (btn) el.classList.toggle("mm-item-active", btn.dataset.card === designId);
  });
  showToast("Card design equipped!");
};

/* ═══════════════════════════════════════════════════════
   MOON MARKET — SOL PAYMENT FLOW
═══════════════════════════════════════════════════════ */
window.buyMarketItem = async function(itemType, itemId, priceUsd) {
  if (!wallet) { showToast("Connect your wallet first!"); return; }

  const btn = document.querySelector(`[data-buy="${itemId}"]`);
  const origText = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = "Loading…"; }

  try {
    /* 1. Fetch live SOL price — fall back to a safe estimate if all APIs fail */
    showToast("Getting current SOL price…");
    let solPrice = await getSolPriceUsd();
    let priceIsEstimate = false;

    if (!solPrice || solPrice < 1) {
      /* SOL price unavailable — retry once with a short delay before giving up */
      await new Promise(r => setTimeout(r, 1000));
      solPrice = await getSolPriceUsd();
    }
    if (!solPrice || solPrice < 1) {
      priceIsEstimate = true;
      showToast("SOL price unavailable — please retry in a moment.");
      if (btn) { btn.disabled = false; btn.textContent = origText; }
      return; /* abort — never send a transaction with an unknown SOL price */
    }

    const solAmount = priceUsd / solPrice;
    const lamports  = Math.ceil(solAmount * 1_000_000_000);
    if (!priceIsEstimate) showToast(`Approve: ${solAmount.toFixed(4)} SOL ($${priceUsd})`);

    /* 2. Get latest blockhash via server-side proxy (no public RPC in browser) */
    if (btn) btn.textContent = "Connecting to Solana…";
    const bhRes = await fetch("/.netlify/functions/blockhash", {
      signal: AbortSignal.timeout(8000),
    });
    const bhData = bhRes.ok ? await bhRes.json() : null;
    const blockhash = bhData?.blockhash ?? null;
    if (!blockhash) throw new Error(
      "Could not reach Solana network. Please check your connection and retry."
    );

    /* 3. Build + sign transaction (no Connection needed — just web3 primitives) */
    const fromPubkey = new solanaWeb3.PublicKey(wallet);
    const toPubkey   = new solanaWeb3.PublicKey(TREASURY_WALLET);
    const transaction = new solanaWeb3.Transaction({
      recentBlockhash: blockhash,
      feePayer: fromPubkey,
    }).add(solanaWeb3.SystemProgram.transfer({ fromPubkey, toPubkey, lamports }));

    const provider = walletProvider
      || _getWalletProvider(localStorage.getItem("sa_wallet_provider") || "phantom");
    if (!provider) throw new Error("Wallet not connected. Please reconnect your wallet.");

    const walletName = localStorage.getItem("sa_wallet_provider") === "solflare" ? "Solflare" : "Phantom";
    if (btn) btn.textContent = `Confirm in ${walletName}…`;
    const result = await provider.signAndSendTransaction(transaction);
    const sig    = result?.signature || result;

    /* 4. Unlock immediately — Phantom already submitted the TX */
    savePurchase(itemId, itemType, priceUsd, sig);
    showToast(`Payment sent! Unlocking now…`);
    if (btn) { btn.disabled = false; btn.textContent = origText; }

    /* 5. Re-open market on the right tab */
    const tabMap = { frame: "frames", card: "cards", badge: "cosmetics" };
    window.openMoonMarket(tabMap[itemType] || "cosmetics");

    /* 6. Confirm silently in background (non-blocking) */
    _confirmTxBackground(sig, "https://api.mainnet-beta.solana.com");

  } catch (err) {
    _DEBUG && console.error("[BuyMarketItem]", err);
    const msg = err.message?.toLowerCase().includes("rejected") || err.message?.toLowerCase().includes("cancelled")
      ? "Payment cancelled."
      : err.message?.slice(0, 80) || "Payment failed — please try again.";
    showToast(msg);
    if (btn) { btn.disabled = false; btn.textContent = origText; }
  }
};

/* Poll for TX confirmation in background — no blocking, no UI freeze */
async function _confirmTxBackground(sig, rpcUrl) {
  if (!sig || !rpcUrl) return;
  const body = JSON.stringify({
    jsonrpc: "2.0", id: 1,
    method: "getSignatureStatuses",
    params: [[sig], { searchTransactionHistory: true }],
  });
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 2500));
    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) continue;
      const d = await res.json();
      const status = d?.result?.value?.[0];
      if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
        _DEBUG && console.log(`[S2M] TX confirmed on-chain ✅ ${sig}`);
        showToast("Payment confirmed on-chain!");
        return;
      }
      if (status?.err) {
        _DEBUG && console.warn(`[S2M] TX failed on-chain ⚠️`, status.err);
        showToast("Transaction may have failed — check your wallet history.");
        return;
      }
    } catch { /* keep polling */ }
  }
  _DEBUG && console.warn(`[S2M] TX confirmation timed out: ${sig}`);
}

window.saveDisplayName = async function() {
  const val = document.getElementById("accsNameInput")?.value.trim();
  if (!val) return;
  localStorage.setItem("sa_display_name", val);
  document.getElementById("dashName").textContent = esc(val);

  /* Sync to server so Leaderboard + Safe Ape show the correct name */
  const w = localStorage.getItem("sa_wallet");
  if (w) {
    try {
      await fetch(SIM_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: w, action: "update_name", accountName: val }),
      });
    } catch { /* non-critical — name still saved locally */ }
  }
  showToast("Name updated!");
};

window.selectAvatar = function(badgeId) {
  /* Update selection ring in picker */
  document.querySelectorAll(".accs-av-option").forEach(el => el.classList.remove("selected"));
  document.getElementById(`av-opt-${badgeId}`)?.classList.add("selected");

  const avEl = document.getElementById("dashAvatar");

  if (badgeId) {
    localStorage.setItem("sa_avatar_id", badgeId);
    const b = BADGE_DEFS.find(x => x.id === badgeId);
    if (b?.type === "video" && b.video) {
      if (avEl) avEl.innerHTML = `<video src="${b.video || ''}" class="dash-avatar-video"
        autoplay loop muted playsinline></video>`;
    } else if (b?.img) {
      if (avEl) avEl.innerHTML = `<img src="${b.img || ''}" class="dash-avatar-img"
        onerror="this.parentElement.textContent='${b.icon || "◆"}'" alt="${esc(b.name)}">`;
    } else if (b?.icon) {
      if (avEl) avEl.textContent = b.icon;
    }
  } else {
    localStorage.removeItem("sa_avatar_id");
    if (avEl) avEl.textContent = "◆";
  }
  showToast("Avatar updated!");
};

window.disconnectDashWallet = function() {
  if (!confirm("Disconnect wallet? Your simulator data stays safe — this just ends your session.")) return;
  localStorage.removeItem("sa_wallet");
  localStorage.removeItem("sa_wallet_provider");
  localStorage.removeItem("sa_display_name");
  localStorage.removeItem("sa_avatar_id");
  walletProvider = null;
  if (dashPriceTimer) clearInterval(dashPriceTimer);
  document.getElementById("accountSettingsOverlay")?.remove();
  location.reload();
};

window.resetDashAccount = async function() {
  if (!confirm("RESET ACCOUNT?\n\nThis will permanently clear:\n• All trades & holdings\n• All badges & XP\n• Login streak\n• Academy & Guide progress\n• Balance resets to 10 S2M\n\nThis cannot be undone. Continue?")) return;
  try {
    showToast("Resetting account…");
    const resp = await fetch(`${SIM_API}?wallet=${encodeURIComponent(wallet)}&action=reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet, action: "reset" }),
    });
    if (!resp.ok) { showToast("Reset failed — try again"); return; }
    const data = await resp.json();
    if (data.error) { showToast(data.error); return; }
    profile = data.profile;
    /* clear any local state */
    localStorage.removeItem("sa_avatar_id");
    localStorage.removeItem("sa_frame_id");
    localStorage.removeItem("sa_card_design");
    localStorage.removeItem("s2m_daily_claimed");
    /* clear all guide completions — keys follow pattern s2m_completed_* */
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("s2m_completed_")) localStorage.removeItem(key);
    }
    document.getElementById("accountSettingsOverlay")?.remove();
    showToast("Account reset! Starting fresh with 10 S2M.");
    location.reload();
  } catch (e) {
    _DEBUG && console.error("Reset error:", e);
    showToast("Reset failed — check console");
  }
};

/* ═══════════════════════════════════════════════════════
   MISSIONS TEASER  — compact dashboard widget → links to tasks.html
═══════════════════════════════════════════════════════ */
function _getMissionData() {
  const trades = profile.trades  || [];
  const badges = profile.badges  || [];
  const streak = profile.loginStreak || 0;
  const wins   = profile.winCount    || 0;
  const losses = profile.lossCount   || 0;
  const total  = wins + losses;
  const xp     = (total * 25) + (streak * 10)
               + (profile.badgeXp   || 0)
               + (profile.socialXp  || 0)
               + (profile.academyXp || 0);
  const lvl    = calcLevel(xp);
  const sells  = trades.filter(t => t.type === "sell").length;
  return [
    { icon:"◆", title:"Welcome to Scan2Moon",  target:1, current:1,                                         xp:10 },
    { icon:"·", title:"First Token Scan",       target:1, current:sells>0||badges.length>0?1:0,             xp:15 },
    { icon:"·", title:"5 Trades Closed",        target:5, current:Math.min(sells,5),                        xp:20 },
    { icon:"◆", title:"Collect 3 Badges",       target:3, current:Math.min(badges.length,3),                xp:30 },
    { icon:"▲", title:"7-Day Login Streak",     target:7, current:Math.min(streak,7),                       xp:25 },
    { icon:"▲", title:"Win Rate Above 50%",     target:1, current:total>0&&wins/total>=0.5?1:0,             xp:40 },
    { icon:"▲", title:"Reach Account Level 5",  target:5, current:Math.min(lvl,5),                          xp:50 },
    { icon:"▲", title:"Complete Academy Course",target:1, current:0,                                        xp:60, locked:true },
  ];
}

function renderMissionTeaser() {
  const el = document.getElementById("dashMissionTeaser");
  if (!el) return;
  const missions = _getMissionData();
  const done     = missions.filter(m => m.current >= m.target).length;
  const total    = missions.length;
  const pct      = Math.round((done / total) * 100);
  const preview  = missions.slice(0, 4);

  el.innerHTML = `
    <div class="panel mteaser-panel">
      <div class="panel-title">
        <div class="dash-panel-shape dash-panel-shape--purple"></div>
        MISSIONS
        <a href="tasks.html" class="mteaser-view-all" style="display:none;">View All →</a>
      </div>
      <div class="panel-body">
        <div class="mteaser-progress-row">
          <span class="mteaser-count">${done} / ${total} completed</span>
          <div class="mteaser-bar"><div class="mteaser-bar-fill" style="width:${pct}%"></div></div>
          <span class="mteaser-pct">${pct}%</span>
        </div>
        <div class="mteaser-list">
          ${preview.map(m => {
            const isDone = m.current >= m.target;
            const p      = Math.min(Math.round((m.current / m.target) * 100), 100);
            return `
              <div class="mteaser-item ${isDone ? 'mteaser-done' : ''}">
                <span class="mteaser-icon">${isDone ? '◆' : m.icon}</span>
                <span class="mteaser-title">${m.title}</span>
                ${!isDone ? `<div class="mteaser-mini-bar"><div style="width:${p}%"></div></div>` : ''}
                <span class="mteaser-xp">+${m.xp} XP</span>
              </div>`;
          }).join("")}
        </div>
        <a href="tasks.html" class="dash-cta-btn" style="display:none;margin-top:10px;">
          Open Missions & Tasks →
        </a>
      </div>
    </div>`;
}

/* ═══════════════════════════════════════════════════════
   SCANNER STATS
═══════════════════════════════════════════════════════ */
function renderScannerStats() {
  const el = document.getElementById("dashScannerStats");
  if (!el) return;

  const trades  = profile.trades || [];
  const wins    = profile.winCount  || 0;
  const losses  = profile.lossCount || 0;
  const total   = wins + losses;
  const winRate = total > 0 ? ((wins / total) * 100).toFixed(0) : "—";

  /* Compute real avg entry risk score from trades that have a riskScore */
  const tradesWithRisk = trades.filter(t => t.riskScore != null && !isNaN(Number(t.riskScore)));
  const avgRisk = tradesWithRisk.length > 0
    ? Math.round(tradesWithRisk.reduce((s, t) => s + Number(t.riskScore), 0) / tradesWithRisk.length)
    : null;

  /* Count open positions (holdings with amount > 0) */
  const openPos = Object.values(profile.holdings || {}).filter(h => h.amount > 0).length;

  const stats = [
    { icon: "▲", label: "Trades Done",      val: total,                              sub: "completed trades" },
    { icon: "◆", label: "Win Rate",          val: total > 0 ? `${winRate}%` : "—",   sub: `${wins}W / ${losses}L` },
    { icon: "·", label: "Avg Entry Risk",    val: avgRisk != null ? `${avgRisk}/100` : "—", sub: avgRisk != null ? (avgRisk >= 65 ? "good discipline" : avgRisk >= 45 ? "watch risk" : "high risk") : "make trades first" },
    { icon: "◆", label: "Open Positions",    val: openPos,                            sub: "tokens held" },
  ];

  el.innerHTML = `
    <div class="scanner-stats-grid">
      ${stats.map(s => `
        <div class="scanner-stat-item">
          <div class="scanner-stat-icon">${s.icon}</div>
          <div class="scanner-stat-val">${s.val}</div>
          <div class="scanner-stat-label">${s.label}</div>
          <div class="scanner-stat-sub">${s.sub}</div>
        </div>`).join("")}
    </div>
    <div class="scanner-stats-note">
      ◆ Use the Risk Scanner before buying — higher entry risk = lower score
    </div>`;
}

/* ═══════════════════════════════════════════════════════
   ACADEMY PLACEHOLDER  — space reserved for future build
═══════════════════════════════════════════════════════ */
/* ── Lightweight course map (mirrors academy.js COURSES) ── */
const ACADEMY_COURSES = [
  {
    num: "01", title: "Risk Scanner Fundamentals",
    badgeId: "scanner_analyst",    badge: "Scanner Analyst",
    color: "#2cffc9", bgColor: "rgba(44,255,201,0.08)", borderColor: "rgba(44,255,201,0.25)",
    totalLessons: 5,
    lessonIds: ["sb_1","sb_2","sb_3","sb_4","sb_quiz"],
  },
  {
    num: "02", title: "AI Sentinel — Threat Detection",
    badgeId: "sentinel_certified", badge: "Sentinel Certified",
    color: "#c084fc", bgColor: "rgba(192,132,252,0.08)", borderColor: "rgba(192,132,252,0.25)",
    totalLessons: 5,
    lessonIds: ["sen_1","sen_2","sen_3","sen_4","sen_quiz"],
  },
  {
    num: "03", title: "Safe Trading on Solana",
    badgeId: "disciplined_trader", badge: "Disciplined Trader",
    color: "#f59e0b", bgColor: "rgba(245,158,11,0.08)", borderColor: "rgba(245,158,11,0.25)",
    totalLessons: 5,
    lessonIds: ["st_1","st_2","st_3","st_4","st_quiz"],
  },
  {
    num: "04", title: "Market Dynamics & Pattern Recognition",
    badgeId: "market_analyst",     badge: "Market Analyst",
    color: "#fb7185", bgColor: "rgba(251,113,133,0.08)", borderColor: "rgba(251,113,133,0.25)",
    totalLessons: 5,
    lessonIds: ["md_1","md_2","md_3","md_4","md_quiz"],
  },
];

function renderAcademyPlaceholder() {
  const el = document.getElementById("dashAcademyPlaceholder");
  if (!el) return;

  const badges  = profile.badges || [];
  const prog    = profile.academyProgress || {};
  const acadXp  = profile.academyXp || 0;

  /* Academy level thresholds (mirrors dashboard.js calcAcadLevel) */
  const ACAD_THRESHOLDS = [0,100,250,500,900,1400,2000];
  let acadLvl = 0;
  for (let i = 0; i < ACAD_THRESHOLDS.length; i++) {
    if (acadXp >= ACAD_THRESHOLDS[i]) acadLvl = i + 1;
  }
  const acadLvlLabel = ["—","Enrolled","Student","Scholar","Advanced","Professor","Master"][Math.min(acadLvl, 6)];
  const nextThreshold = ACAD_THRESHOLDS[Math.min(acadLvl, ACAD_THRESHOLDS.length - 1)] || ACAD_THRESHOLDS[ACAD_THRESHOLDS.length - 1];
  const prevThreshold = ACAD_THRESHOLDS[Math.max(acadLvl - 1, 0)];
  const xpInLevel  = acadXp - prevThreshold;
  const xpForLevel = nextThreshold - prevThreshold;
  const lvlPct     = xpForLevel > 0 ? Math.min(100, Math.round((xpInLevel / xpForLevel) * 100)) : 100;

  /* Earned certificate count */
  const certCount = ACADEMY_COURSES.filter(c => badges.includes(c.badgeId)).length;

  /* Course lesson progress */
  const courseRows = ACADEMY_COURSES.map(c => {
    const earned      = badges.includes(c.badgeId);
    const lessonsComplete = c.lessonIds.filter(id => prog[id]).length;
    const lessonPct   = Math.round((lessonsComplete / c.totalLessons) * 100);

    if (earned) {
      /* ── Earned certificate card ── */
      return `
        <div class="dash-acad-cert-card earned" style="border-color:${c.borderColor};">
          <div class="dash-acad-cert-color-bar" style="background:${c.color};"></div>
          <div class="dash-acad-cert-num" style="color:${c.color};background:${c.bgColor};border-color:${c.borderColor};">${c.num}</div>
          <div class="dash-acad-cert-info">
            <div class="dash-acad-cert-title">${esc(c.title)}</div>
            <div class="dash-acad-cert-badge-name" style="color:${c.color};">${esc(c.badge)}</div>
          </div>
          <div class="dash-acad-cert-status earned-icon">◆</div>
        </div>`;
    } else {
      /* ── In-progress / locked card ── */
      const isInProgress = lessonsComplete > 0;
      return `
        <div class="dash-acad-cert-card ${isInProgress ? 'progress' : 'locked'}">
          <div class="dash-acad-cert-color-bar" style="background:${isInProgress ? c.color : 'rgba(207,255,244,0.08)'};"></div>
          <div class="dash-acad-cert-num" style="color:rgba(207,255,244,${isInProgress ? '0.4' : '0.15'});background:rgba(207,255,244,0.04);border-color:rgba(207,255,244,0.08);">${c.num}</div>
          <div class="dash-acad-cert-info">
            <div class="dash-acad-cert-title" style="color:rgba(207,255,244,${isInProgress ? '0.55' : '0.25'});">${esc(c.title)}</div>
            ${isInProgress ? `
              <div class="dash-acad-cert-prog-wrap">
                <div class="dash-acad-cert-prog-bar">
                  <div class="dash-acad-cert-prog-fill" style="width:${lessonPct}%;background:${c.color};"></div>
                </div>
                <span class="dash-acad-cert-prog-txt">${lessonsComplete}/${c.totalLessons}</span>
              </div>` : `
              <div class="dash-acad-cert-badge-name" style="color:rgba(207,255,244,0.2);">${esc(c.badge)}</div>`}
          </div>
          <div class="dash-acad-cert-status">${isInProgress ? `<span style="font-size:10px;font-weight:800;color:${c.color};">${lessonPct}%</span>` : '▼'}</div>
        </div>`;
    }
  }).join("");

  el.innerHTML = `
    <div class="dash-acad-live">

      <!-- XP / Level bar -->
      <div class="dash-acad-xp-row">
        <div class="dash-acad-xp-left">
          <span class="dash-acad-lvl-num">${acadLvl}</span>
          <span class="dash-acad-lvl-label">${acadLvlLabel}</span>
        </div>
        <div class="dash-acad-xp-right">
          <div class="dash-acad-xp-bar">
            <div class="dash-acad-xp-fill" style="width:${lvlPct}%;"></div>
          </div>
          <div class="dash-acad-xp-nums">${acadXp.toLocaleString()} XP</div>
        </div>
      </div>

      <!-- Section header -->
      <div class="dash-acad-cert-header">
        <span>CERTIFICATES</span>
        <span class="dash-acad-cert-count">${certCount} / ${ACADEMY_COURSES.length} earned</span>
      </div>

      <!-- Certificate list -->
      <div class="dash-acad-cert-list">
        ${courseRows}
      </div>

      <!-- CTA -->
      <a href="academy.html" class="dash-cta-btn" style="margin-top:4px;display:none;">
        Go to Academy →
      </a>
    </div>`;
}

/* ═══════════════════════════════════════════════════════
   LEADERBOARD PREVIEW  (real data — fetched async)
═══════════════════════════════════════════════════════ */
function renderLeaderboard() {
  const el = document.getElementById("dashLeaderboard");
  if (!el) return;
  /* Show loading state — real data is populated by fetchLbRank() */
  el.innerHTML = `
    <div style="text-align:center;padding:28px;opacity:0.5;font-size:13px;">
      <div style="width:28px;height:28px;border:3px solid rgba(44,255,201,0.2);border-top-color:#2cffc9;border-radius:50%;animation:scanRotate 0.8s linear infinite;margin:0 auto 8px;"></div>
      Loading real rankings…
    </div>
    <div class="dash-lb-footer"><a href="leaderboard.html" style="color:#ffb432;font-weight:700;">View Full Leaderboard →</a></div>`;
}

/* Populate leaderboard preview with real entries */
function _renderLbPreview(entries, totalTraders) {
  const el = document.getElementById("dashLeaderboard");
  if (!el) return;

  const medals = ["🥇","🥈","🥉"];
  const top5   = entries.slice(0, 5);
  const meEntry = wallet ? entries.find(e => e.wallet === wallet) : null;
  const inTop5 = meEntry && meEntry.rank <= 5;

  /* ── Build mini avatar HTML (image / video / emoji) + frame ── */
  const _myAvId     = localStorage.getItem("sa_avatar_id");
  const _myFrameId  = localStorage.getItem("sa_frame_id") || "frame_none";
  const _myAvDef    = _myAvId ? BADGE_DEFS.find(x => x.id === _myAvId) : null;
  const _myFrameDef = FRAME_DEFS.find(f => f.id === _myFrameId) || FRAME_DEFS[0];
  const _myFrameCls = _myFrameDef.cssClass || "";

  /* Build the inner avatar content (same logic as renderHero) */
  function _buildMiniAvatarHtml(isMe) {
    if (!isMe) {
      /* Other traders — plain gorilla emoji in a neutral wrapper */
      return `<div style="width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:17px;background:rgba(44,255,201,0.06);flex-shrink:0;">◆</div>`;
    }
    let innerHtml;
    if (_myAvDef?.type === "video" && _myAvDef.video) {
      innerHtml = `<video src="${_myAvDef.video}" style="width:100%;height:100%;object-fit:cover;border-radius:7px;" autoplay loop muted playsinline
        onerror="this.parentElement.textContent='${_myAvDef.icon || '◆'}'"></video>`;
    } else if (_myAvDef?.img) {
      innerHtml = `<img src="${_myAvDef.img}" style="width:100%;height:100%;object-fit:cover;border-radius:7px;"
        onerror="this.parentElement.textContent='${_myAvDef.icon || '◆'}'" alt="avatar">`;
    } else {
      innerHtml = `<span style="font-size:17px;">${_myAvDef?.icon || "◆"}</span>`;
    }
    return `<div class="dash-avatar-frame ${_myFrameCls}"
      style="width:28px;height:28px;border-radius:9px;display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;font-size:17px;">
      ${innerHtml}
    </div>`;
  }

  const rowHtml = e => {
    const isMe = wallet && e.wallet === wallet;
    const wins    = e.winCount  || 0;
    const losses  = e.lossCount || 0;
    const total2  = wins + losses;
    const wr      = total2 > 0 ? ((wins / total2) * 100).toFixed(1) : "0";
    const pnl     = e.totalPnL  || 0;
    const lvl     = e.level     || 1;
    return `
    <div class="dash-lb-row ${isMe ? 'is-user' : ''}">
      <div class="dash-lb-rank">${e.rank <= 3 ? medals[e.rank - 1] : `#${e.rank}`}</div>
      <div class="dash-lb-name" style="display:flex;align-items:center;gap:6px;overflow:hidden;">
        ${_buildMiniAvatarHtml(isMe)}
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          ${isMe
            ? `<span style="color:#2cffc9;">▶ ${esc(e.accountName || 'You')}</span>`
            : esc(e.accountName || 'Trader')}
        </span>
      </div>
      <div class="dash-lb-lvl">LVL ${lvl}</div>
      <div class="dash-lb-wr" style="color:${parseFloat(wr)>=50?'#2cffc9':'#ff4d6d'}">${wr}%</div>
      <div class="dash-lb-pnl" style="color:${pnl>=0?'#2cffc9':'#ff4d6d'}">${pnl>=0?'+':''}${formatSol(pnl)}</div>
    </div>`;
  };

  const rowsHtml = top5.map(rowHtml).join("") +
    (!inTop5 && meEntry ? `<div class="dash-lb-sep">• • •</div>${rowHtml(meEntry)}` : "");

  el.innerHTML = `
    <div class="dash-lb-table">
      <div class="dash-lb-header"><div>RANK</div><div>TRADER</div><div>LVL</div><div>WIN%</div><div>P/L</div></div>
      ${rowsHtml || '<div style="opacity:0.4;text-align:center;padding:16px;font-size:12px;">No traders yet — be the first!</div>'}
    </div>
    <div class="dash-lb-footer">${totalTraders} traders total — <a href="leaderboard.html" style="color:#ffb432;font-weight:700;">View Full Leaderboard →</a></div>`;
}

/* ═══════════════════════════════════════════════════════
   ACCOUNT CARD MODAL — live preview + equip controls
═══════════════════════════════════════════════════════ */

/* Build the inner HTML of the live card preview (uses CSS classes so frame animates) */
function _buildLiveCardHtml() {
  const wins    = profile.winCount   || 0;
  const losses  = profile.lossCount  || 0;
  const total   = wins + losses;
  const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : "0";
  const pnl     = profile.totalPnL   || 0;
  const xp      = (total * 25) + ((profile.loginStreak || 0) * 10) + (profile.badgeXp || 0) + (profile.socialXp || 0) + (profile.academyXp || 0);
  const lvl     = calcLevel(xp);
  const short   = wallet ? wallet.slice(0, 6) + "…" + wallet.slice(-4) : "";
  const badgeCnt = (profile.badges || []).length;
  const best    = (profile.trades || [])
    .filter(t => t.type === "sell" && (t.pnl || 0) > 0)
    .reduce((a, b) => (b.pnl > (a?.pnl || 0) ? b : a), null);

  const designId = localStorage.getItem("sa_card_design") || "card_classic";
  const th       = CARD_THEMES[designId] || CARD_THEMES.card_classic;
  const frameId  = localStorage.getItem("sa_frame_id") || "frame_none";
  const frameDef = FRAME_DEFS.find(f => f.id === frameId) || FRAME_DEFS[0];

  const savedAvId = localStorage.getItem("sa_avatar_id");
  const avBadge   = savedAvId ? BADGE_DEFS.find(x => x.id === savedAvId) : null;
  let avHtml;
  if (avBadge?.type === "video" && avBadge.video) {
    avHtml = `<video src="${avBadge.video || ''}" autoplay loop muted playsinline
      style="width:68px;height:68px;object-fit:cover;border-radius:10px;display:block;"></video>`;
  } else if (avBadge?.img) {
    avHtml = `<img src="${avBadge.img || ''}"
      style="width:68px;height:68px;object-fit:cover;border-radius:10px;display:block;">`;
  } else {
    avHtml = `<span style="font-size:52px;line-height:1;">${avBadge?.icon || "◆"}</span>`;
  }

  return `
    <div style="background:${th.bg};border:1.5px solid ${th.border};border-radius:20px;
         padding:22px 20px 16px;font-family:'Inter','Segoe UI',sans-serif;color:#cffff4;
         box-shadow:0 0 50px rgba(0,0,0,0.85);">
      <div style="display:flex;justify-content:space-between;align-items:center;
           border-bottom:1px solid ${th.hdrBorder};padding-bottom:10px;margin-bottom:14px;">
        <span style="font-size:13px;font-weight:900;letter-spacing:1.5px;color:${th.logo};">◆ SCAN2MOON</span>
        <span style="font-size:10px;font-weight:700;letter-spacing:1px;color:${th.logo};opacity:.6;">${th.tag}</span>
      </div>
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px;">
        <div class="dash-avatar-frame ${frameDef.cssClass}"
             style="width:68px;height:68px;flex-shrink:0;display:flex;align-items:center;
                    justify-content:center;border-radius:12px;">
          ${avHtml}
        </div>
        <div>
          <div style="font-size:17px;font-weight:900;color:${th.name};">
            ${esc(localStorage.getItem("sa_display_name") || profile.accountName || "Trader")}
          </div>
          <div style="font-size:12px;font-weight:700;color:${th.accent};margin-top:3px;">${rankLabel(pnl)}</div>
          <div style="font-size:11px;color:${th.level};margin-top:2px;">LVL ${lvl}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-bottom:10px;">
        <div style="text-align:center;">
          <div style="font-size:13px;font-weight:900;color:${pnl>=0?th.statHi:'#ff4d6d'}">${pnl>=0?'+':''}${formatSol(pnl)}</div>
          <div style="font-size:8px;opacity:.5;margin-top:2px;letter-spacing:.5px;">P/L</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:13px;font-weight:900;color:${parseFloat(winRate)>=50?th.statHi:'#ff4d6d'}">${winRate}%</div>
          <div style="font-size:8px;opacity:.5;margin-top:2px;letter-spacing:.5px;">WIN RATE</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:13px;font-weight:900;">${total}</div>
          <div style="font-size:8px;opacity:.5;margin-top:2px;letter-spacing:.5px;">TRADES</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:13px;font-weight:900;color:${th.accent}">${badgeCnt}</div>
          <div style="font-size:8px;opacity:.5;margin-top:2px;letter-spacing:.5px;">BADGES</div>
        </div>
      </div>
      ${best ? `<div style="font-size:10px;color:${th.statHi};opacity:.75;margin-bottom:8px;">
        ◆ Best: <strong>+${formatSol(best.pnl)}</strong> on ${esc(best.symbol || best.name || "")}
      </div>` : ""}
      <div style="font-size:9px;font-family:monospace;color:${th.wallet};margin-bottom:8px;">${short}</div>
      <div style="font-size:9px;color:${th.footer};border-top:1px solid ${th.hdrBorder};padding-top:8px;letter-spacing:.3px;">
        scan2moon.com · We don't shill. We show data.
      </div>
    </div>`;
}

function _refreshLiveCard() {
  const el = document.getElementById("acLiveCard");
  if (el) el.innerHTML = _buildLiveCardHtml();
}

/* Thumb item for avatar / frame / card selectors */
function _acThumb(id, isSelected, isLocked, inner, label) {
  const lockedAttr = isLocked ? `data-locked="1"` : "";
  return `<div class="ac-thumb${isSelected?' ac-thumb-sel':''}${isLocked?' ac-thumb-locked':''}"
    data-ac-id="${id}" ${lockedAttr}>${inner}
    ${label ? `<div class="ac-thumb-label">${label}</div>` : ""}
    ${isLocked ? `<div class="ac-lock-chip">▼</div>` : ""}
  </div>`;
}

window.openAccountCard = function() {
  document.getElementById("acctCardOverlay")?.remove();
  const earned = new Set(profile.badges || []);

  /* ── Avatar row ── */
  const savedAvId    = localStorage.getItem("sa_avatar_id") || "cosm_classic_ape";
  const avatarOpts   = BADGE_DEFS.filter(b => b.freebie || earned.has(b.id));
  const avatarHtml   = avatarOpts.map(b => {
    const inner = b.type === "video" && b.video
      ? `<video src="${b.video || ''}" autoplay loop muted playsinline class="ac-thumb-video"></video>`
      : b.img
        ? `<img src="${b.img || ''}" class="ac-thumb-img">`
        : `<span class="ac-thumb-icon">${b.icon}</span>`;
    return _acThumb(b.id, b.id === savedAvId, false, inner, "");
  }).join("");

  /* ── Frame row (all frames; lock unowned) ── */
  const savedFrameId = localStorage.getItem("sa_frame_id") || "frame_none";
  const frameHtml    = FRAME_DEFS.map(f => {
    const owned  = f.freebie || isPurchased(f.id);
    const inner  = `<span class="ac-thumb-icon">${f.icon}</span>`;
    const label  = f.price > 0 && !owned ? `$${f.price}` : f.name.split(" ")[0];
    return _acThumb(f.id, f.id === savedFrameId && owned, !owned, inner, label);
  }).join("");

  /* ── Card design row (all designs; lock unowned) ── */
  const savedDesignId = localStorage.getItem("sa_card_design") || "card_classic";
  const cardDesignHtml = CARD_DESIGN_DEFS.map(c => {
    const owned = c.freebie || isPurchased(c.id);
    const inner = `<span class="ac-thumb-icon">${c.icon}</span>`;
    const label = c.price > 0 && !owned ? `$${c.price}` : c.name.split(" ")[0];
    return _acThumb(c.id, c.id === savedDesignId && owned, !owned, inner, label);
  }).join("");

  /* ── Build modal ── */
  const overlay = document.createElement("div");
  overlay.id = "acctCardOverlay";
  overlay.className = "mm-overlay";
  overlay.innerHTML = `
    <div class="mm-modal ac-modal">
      <button class="mm-close" onclick="document.getElementById('acctCardOverlay').remove()">✕</button>
      <div class="mm-modal-title">🪪 ACCOUNT CARD</div>

      <div id="acLiveCard" class="ac-live-card">${_buildLiveCardHtml()}</div>

      <div class="ac-section-label">◆ AVATAR</div>
      <div class="ac-thumbs-row" id="acAvatarRow">${avatarHtml}</div>

      <div class="ac-section-label">◆ FRAME</div>
      <div class="ac-thumbs-row" id="acFrameRow">${frameHtml}</div>

      <div class="ac-section-label">◆ CARD DESIGN</div>
      <div class="ac-thumbs-row" id="acCardRow">${cardDesignHtml}</div>

      <div class="ac-action-row">
        <button class="dash-profile-share-btn" id="acDownloadBtn"
          onclick="window.acDownloadCard()">Download</button>
        <button class="dash-profile-share-btn"
          onclick="window.acTweetCard()">Share on X</button>
        <button class="dash-accs-btn"
          onclick="document.getElementById('acctCardOverlay').remove();window.openMoonMarket()">
          Moon Market
        </button>
      </div>
    </div>`;

  /* Delegate thumb clicks */
  overlay.addEventListener("click", e => {
    if (e.target === overlay) { overlay.remove(); return; }
    const thumb = e.target.closest(".ac-thumb");
    if (!thumb) return;
    if (thumb.dataset.locked === "1") {
      overlay.remove();
      window.openMoonMarket();
      return;
    }
    const id  = thumb.dataset.acId;
    const row = thumb.closest(".ac-thumbs-row");
    if (!id || !row) return;
    row.querySelectorAll(".ac-thumb").forEach(t => t.classList.remove("ac-thumb-sel"));
    thumb.classList.add("ac-thumb-sel");
    if (row.id === "acAvatarRow")  { localStorage.setItem("sa_avatar_id", id); updateDashAvatar(); }
    if (row.id === "acFrameRow")   { localStorage.setItem("sa_frame_id",  id); updateDashFrame(); }
    if (row.id === "acCardRow")    { localStorage.setItem("sa_card_design", id); }
    _refreshLiveCard();
  });

  document.body.appendChild(overlay);
};

window.acDownloadCard = async function() {
  const btn = document.getElementById("acDownloadBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
  try {
    const canvas = await buildProfileShareCard();
    const link = document.createElement("a");
    link.download = "Scan2Moon-Card.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
    showToast("Card saved!");
  } catch(e) { showToast("Could not save card."); }
  finally { if (btn) { btn.disabled = false; btn.textContent = "Download"; } }
};

window.acTweetCard = function() {
  const pnl     = profile.totalPnL || 0;
  const wins    = profile.winCount  || 0;
  const losses  = profile.lossCount || 0;
  const total   = wins + losses;
  const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : "0";
  const xp      = (total * 25) + ((profile.loginStreak || 0) * 10) + (profile.badgeXp || 0) + (profile.socialXp || 0) + (profile.academyXp || 0);
  const tweet   = `My Scan2Moon Stats:\n\n${rankLabel(pnl)} · LVL ${calcLevel(xp)}\n P/L: ${pnl>=0?'+':''}${formatSol(pnl)}\n Win Rate: ${winRate}%\n Badges: ${(profile.badges||[]).length}\n\nhttps://scan2moon.com`;
  window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}`, "_blank");
};

/* ═══════════════════════════════════════════════════════
   SHAREABLE PROFILE CARD
═══════════════════════════════════════════════════════ */
async function buildProfileShareCard() {
  const wins    = profile.winCount  || 0;
  const losses  = profile.lossCount || 0;
  const total   = wins + losses;
  const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : "0";
  const pnl     = profile.totalPnL  || 0;
  const xp      = (total * 25) + ((profile.loginStreak || 0) * 10) + (profile.badgeXp || 0) + (profile.socialXp || 0) + (profile.academyXp || 0);
  const lvl     = calcLevel(xp);
  const short   = wallet ? wallet.slice(0, 6) + "…" + wallet.slice(-4) : "";
  const badges  = (profile.badges || []).length;
  const best    = (profile.trades || [])
    .filter(t => t.type === "sell" && (t.pnl || 0) > 0)
    .reduce((a, b) => (b.pnl > (a?.pnl || 0) ? b : a), null);

  /* Resolve card theme */
  const designId = localStorage.getItem("sa_card_design") || "card_classic";
  const th = CARD_THEMES[designId] || CARD_THEMES.card_classic;

  /* Resolve avatar for share card (video → capture canvas frame) */
  const savedAvId = localStorage.getItem("sa_avatar_id");
  const avBadge   = savedAvId ? BADGE_DEFS.find(x => x.id === savedAvId) : null;
  let avHtml;
  if (avBadge?.type === "video" && avBadge.video) {
    const frameDataUrl = await captureVideoFrame(avBadge.video);
    avHtml = frameDataUrl
      ? `<img src="${frameDataUrl || ''}" style="width:96px;height:96px;object-fit:cover;border-radius:16px;">`
      : `<span style="font-size:72px;line-height:1;">${avBadge.icon}</span>`;
  } else if (avBadge?.img) {
    avHtml = `<img src="${avBadge.img || ''}" style="width:96px;height:96px;object-fit:cover;border-radius:16px;">`;
  } else {
    avHtml = `<span style="font-size:72px;line-height:1;">${avBadge?.icon || "◆"}</span>`;
  }

  /* Resolve frame styles for the card avatar.
     html2canvas v1.4.1 does NOT render box-shadow with spread radius (0 0 0 Xpx).
     Fix: use a real CSS border for the ring + blur-only box-shadow for the glow. */
  const savedFrameId = localStorage.getItem("sa_frame_id") || "frame_none";
  const frameDef     = FRAME_DEFS.find(f => f.id === savedFrameId) || FRAME_DEFS[0];
  const FRAME_STYLES = {
    "frame_moon_pulse":  { border: "3px solid #2cffc9", shadow: "0 0 18px rgba(44,255,201,0.9), 0 0 36px rgba(44,255,201,0.45)" },
    "frame_solar_flare": { border: "3px solid #ffd700", shadow: "0 0 18px rgba(255,210,50,0.9),  0 0 36px rgba(255,210,50,0.45)"  },
    "frame_degen_neon":  { border: "3px solid #ff6eb4", shadow: "0 0 18px rgba(255,110,180,0.9), 0 0 36px rgba(255,110,180,0.45)" },
    "frame_diamond":     { border: "3px solid #93c5fd", shadow: "0 0 18px rgba(147,197,253,0.9), 0 0 36px rgba(147,197,253,0.45)" },
  };
  const fs = FRAME_STYLES[frameDef.id];
  const frameStyle = fs
    ? `border:${fs.border};box-shadow:${fs.shadow};border-radius:18px;padding:4px;background:rgba(0,0,0,0.15);`
    : "";

  document.getElementById("profileShareCard")?.remove();

  const card = document.createElement("div");
  card.id = "profileShareCard";
  /* Apply theme via inline styles for html2canvas compatibility */
  card.style.cssText = `
    background: ${th.bg};
    border: 1.5px solid ${th.border};
    border-radius: 22px;
    padding: 28px 24px 22px;
    width: 380px;
    box-sizing: content-box;
    font-family: 'Inter', 'Segoe UI', sans-serif;
    color: #cffff4;
    position: fixed;
    top: -9999px; left: -9999px;
    overflow: visible;
    box-shadow: 0 0 60px rgba(0,0,0,0.8);
  `;
  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid ${th.hdrBorder};padding-bottom:12px;margin-bottom:18px;">
      <span style="font-size:14px;font-weight:900;letter-spacing:1.5px;color:${th.logo};">◆ SCAN2MOON</span>
      <span style="font-size:10px;font-weight:700;letter-spacing:1px;color:${th.logo};opacity:.6;">${th.tag}</span>
    </div>
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:18px;">
      <div style="width:96px;height:96px;box-sizing:content-box;display:flex;align-items:center;justify-content:center;flex-shrink:0;${frameStyle}">
        ${avHtml}
      </div>
      <div>
        <div style="font-size:20px;font-weight:900;color:${th.name};letter-spacing:.3px;">${esc(localStorage.getItem("sa_display_name") || profile.accountName || "Trader")}</div>
        <div style="font-size:12px;font-weight:700;color:${th.accent};margin-top:4px;">${rankLabel(pnl)}</div>
        <div style="font-size:11px;color:${th.level};margin-top:2px;">LVL ${lvl}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:14px;">
      <div style="text-align:center;">
        <div style="font-size:15px;font-weight:900;color:${pnl>=0?th.statHi:'#ff4d6d'}">${pnl>=0?'+':''}${formatSol(pnl)}</div>
        <div style="font-size:9px;opacity:.55;margin-top:3px;letter-spacing:.5px;">P/L</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:15px;font-weight:900;color:${parseFloat(winRate)>=50?th.statHi:'#ff4d6d'}">${winRate}%</div>
        <div style="font-size:9px;opacity:.55;margin-top:3px;letter-spacing:.5px;">WIN RATE</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:15px;font-weight:900;">${total}</div>
        <div style="font-size:9px;opacity:.55;margin-top:3px;letter-spacing:.5px;">TRADES</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:15px;font-weight:900;color:${th.accent}">${badges}</div>
        <div style="font-size:9px;opacity:.55;margin-top:3px;letter-spacing:.5px;">BADGES</div>
      </div>
    </div>
    ${best ? `<div style="font-size:11px;color:${th.statHi};opacity:.75;margin-bottom:10px;">◆ Best: <strong>+${formatSol(best.pnl)}</strong> on ${esc(best.symbol || best.name || "")}</div>` : ""}
    <div style="font-size:10px;font-family:monospace;color:${th.wallet};margin-bottom:10px;">${short}</div>
    <div style="font-size:9px;color:${th.footer};border-top:1px solid ${th.hdrBorder};padding-top:10px;letter-spacing:.3px;">
      scan2moon.com · We don't shill. We show data.
    </div>`;

  document.body.appendChild(card);
  await new Promise(r => setTimeout(r, 220)); /* extra time for border+shadow paint */

  /* x/y in html2canvas are RELATIVE to the element — negative values expand the
     capture area outward so the frame glow (box-shadow blur) isn't clipped. */
  const GLOW = 52;
  const canvas = await html2canvas(card, {
    backgroundColor: null,
    scale: 2,
    useCORS: true,
    allowTaint: true,
    logging: false,
    x: -GLOW,
    y: -GLOW,
    width:  card.offsetWidth  + GLOW * 2,
    height: card.offsetHeight + GLOW * 2,
    scrollX: 0,
    scrollY: 0,
  });
  card.remove();
  return canvas;
}

window.shareProfileCard = async function() {
  const btn = document.getElementById("dashProfileShareBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
  try {
    const canvas = await buildProfileShareCard();
    /* Auto-download */
    const link = document.createElement("a");
    link.download = "Scan2Moon-Profile.png";
    link.href     = canvas.toDataURL("image/png");
    link.click();
    /* Open tweet */
    const pnl     = profile.totalPnL || 0;
    const wins    = profile.winCount  || 0;
    const losses  = profile.lossCount || 0;
    const total   = wins + losses;
    const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : "0";
    const xp      = (total * 25) + ((profile.loginStreak || 0) * 10) + (profile.badgeXp || 0) + (profile.socialXp || 0) + (profile.academyXp || 0);
    const lvl     = calcLevel(xp);
    const tweet   = `My Scan2Moon Stats:\n\n${rankLabel(pnl)} · LVL ${lvl}\n P/L: ${pnl>=0?'+':''}${formatSol(pnl)}\n Win Rate: ${winRate}%\n Badges: ${(profile.badges||[]).length}\n\nWe don't shill. We show data.\nhttps://scan2moon.com`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}`, "_blank");
    showToast("Profile card saved — tweet is opening!");
  } catch (e) {
    _DEBUG && console.error("Profile share error:", e);
    showToast("Could not save — try again.");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Share Stats"; }
  }
};

/* ═══════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════ */
function formatSol(n) {
  if (n === null || n === undefined || isNaN(n)) return "0 S2M";
  const abs = Math.abs(n);
  if (abs === 0)   return "0 S2M";
  if (abs < 0.001) return n.toFixed(6) + " S2M";
  if (abs < 0.1)   return n.toFixed(4) + " S2M";
  if (abs < 10)    return n.toFixed(3) + " S2M";
  return n.toFixed(2) + " S2M";
}

function timeAgo(ts) {
  if (!ts) return "";
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)   return "just now";
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function showToast(msg) {
  let toast = document.getElementById("saToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "saToast";
    toast.style.cssText = `position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:rgba(6,32,26,0.97);border:1px solid rgba(44,255,201,0.4);border-radius:10px;padding:12px 24px;font-size:14px;font-weight:600;color:#cffff4;z-index:9999;box-shadow:0 0 30px rgba(44,255,201,0.2);transition:opacity 0.3s;white-space:nowrap;`;
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = "1";
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.opacity = "0"; }, 3500);
}

/* ═══════════════════════════════════════════════════════════
   MY WALLET  — Solflare-inspired simulator wallet popup
   ══════════════════════════════════════════════════════════ */

let _mwSolPrice = 0; /* cached SOL/USD price for wallet modal */

window.openMyWallet = async function() {
  document.getElementById("mwOverlay")?.remove();

  /* Build overlay shell immediately with a loader so it feels instant */
  const overlay = document.createElement("div");
  overlay.id = "mwOverlay";
  overlay.className = "mw-overlay";
  overlay.innerHTML = `
    <div class="mw-modal">
      <div style="display:flex;align-items:center;justify-content:center;height:200px;color:rgba(207,255,244,0.3);font-size:14px;">
        <span>Loading wallet…</span>
      </div>
    </div>`;
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);

  /* Fetch SOL price in background */
  try { _mwSolPrice = (await getSolPriceUsd()) || 0; } catch { _mwSolPrice = 0; }

  /* Build real content */
  overlay.querySelector(".mw-modal").innerHTML = _buildWalletHtml();

  /* Wire tabs */
  overlay.querySelectorAll(".mw-tab").forEach(tab => {
    tab.addEventListener("click", () => _switchMwTab(tab.dataset.tab));
  });
};

/* ── Build full wallet HTML ──────────────────────────────── */
function _buildWalletHtml() {
  const bal        = profile.balance    || 0;
  const totalPnl   = profile.totalPnL   || 0;
  const wins       = profile.winCount   || 0;
  const losses     = profile.lossCount  || 0;
  const trades     = profile.trades     || [];
  const holdings   = profile.holdings   || {};
  const earnedSet  = new Set(profile.badges || []);
  /* Freebie badges are auto-earned for everyone (same logic as renderBadges) */
  BADGE_DEFS.filter(b => b.freebie).forEach(b => earnedSet.add(b.id));
  /* Also treat purchased cosmetics as earned */
  BADGE_DEFS.filter(b => b.market && isPurchased(b.id)).forEach(b => earnedSet.add(b.id));
  const short      = wallet ? wallet.slice(0,6) + "…" + wallet.slice(-4) : "—";
  const fullAddr   = wallet || "";

  /* USD values */
  const balUsd     = _mwSolPrice > 0 ? (bal * _mwSolPrice).toLocaleString("en-US", { style:"currency", currency:"USD", maximumFractionDigits:2 }) : null;
  const pnlSign    = totalPnl >= 0 ? "+" : "";
  const pnlClass   = totalPnl >= 0 ? "pos" : "neg";

  /* Portfolio live total */
  let portfolioVal  = bal;
  let investedTotal = 0;
  let liveUnrealized = 0;
  let liveCount = 0;
  const holdingKeys = Object.keys(holdings).filter(k => (holdings[k]?.amount || 0) > 0.000001);
  holdingKeys.forEach(mint => {
    const h = holdings[mint];
    const cost = h.totalCostSol || 0;
    investedTotal += cost;
    const lp = dashPrices[mint];
    if (lp) {
      const curVal = (_mwSolPrice > 0 && h.amount > 0)
        ? (h.amount * lp / _mwSolPrice)
        : (h.avgPrice > 0 && cost > 0 ? cost * (lp / h.avgPrice) : null);
      if (curVal !== null) {
        portfolioVal += curVal;
        liveUnrealized += curVal - cost;
        liveCount++;
      }
    }
  });
  const totalValUsd = _mwSolPrice > 0
    ? (portfolioVal * _mwSolPrice).toLocaleString("en-US",{ style:"currency", currency:"USD", maximumFractionDigits:2 })
    : null;
  const unrealizedSign = liveUnrealized >= 0 ? "+" : "";
  const unrealizedClass = liveUnrealized >= 0 ? "pos" : "neg";

  /* Win rate */
  const total = wins + losses;
  const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) + "%" : "—";

  return `
    <!-- ── Header ── -->
    <div class="mw-header">
      <div class="mw-header-left">
        <div class="mw-header-icon">◆</div>
        <div>
          <div class="mw-header-title">MY WALLET</div>
        </div>
        <span class="mw-sim-badge">SIMULATOR</span>
      </div>
      <button class="mw-close-btn" onclick="document.getElementById('mwOverlay').remove()">✕</button>
    </div>

    <!-- ── Address ── -->
    <div class="mw-address-bar">
      <span class="mw-address-text">${esc(short)}</span>
      <button class="mw-address-copy" title="Copy address" onclick="
        navigator.clipboard.writeText('${esc(fullAddr)}').then(()=>{
          this.textContent='✓'; setTimeout(()=>{ this.textContent='⎘'; },1500);
        }).catch(()=>{ this.textContent='✗'; setTimeout(()=>{ this.textContent='⎘'; },1500); });
      ">⎘</button>
      <span class="mw-live-dot">LIVE</span>
    </div>

    <!-- ── Balance hero ── -->
    <div class="mw-balance-hero">
      <div class="mw-balance-sol">${formatSol(bal).replace(" S2M","")} <span class="mw-balance-sol-unit">S2M</span></div>
      ${balUsd ? `<div class="mw-balance-usd">≈ ${balUsd} USD</div>` : ""}
      <span class="mw-balance-change ${pnlClass}">
        Realized P/L: ${pnlSign}${formatSol(totalPnl)}
        ${_mwSolPrice > 0 ? `(${pnlSign}${(totalPnl * _mwSolPrice).toLocaleString("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2})})` : ""}
      </span>
    </div>

    <!-- ── Portfolio strip ── -->
    <div class="mw-portfolio-strip">
      <div class="mw-portfolio-cell">
        <div class="mw-portfolio-label">Portfolio Value</div>
        <div class="mw-portfolio-val">${formatSol(portfolioVal)}</div>
      </div>
      <div class="mw-portfolio-cell">
        <div class="mw-portfolio-label">Unrealized P/L</div>
        <div class="mw-portfolio-val ${liveCount > 0 ? unrealizedClass : ''}">${liveCount > 0 ? unrealizedSign + formatSol(liveUnrealized) : "—"}</div>
      </div>
      <div class="mw-portfolio-cell">
        <div class="mw-portfolio-label">Win Rate</div>
        <div class="mw-portfolio-val">${winRate}</div>
      </div>
    </div>

    <!-- ── Action buttons ── -->
    <div class="mw-actions">
      <a class="mw-action-btn buy" href="safe-ape.html" style="text-decoration:none;">
        Buy
      </a>
      <a class="mw-action-btn sell" href="safe-ape.html" style="text-decoration:none;">
        Sell
      </a>
      <a class="mw-action-btn sim" href="safe-ape.html" style="text-decoration:none;">
        Open Simulator
      </a>
    </div>

    <!-- ── Tabs ── -->
    <div class="mw-tabs">
      <div class="mw-tab active" data-tab="assets">Assets</div>
      <div class="mw-tab" data-tab="activity">Activity</div>
      <div class="mw-tab" data-tab="nfts">NFT Badges</div>
    </div>

    <!-- ── Scrollable content ── -->
    <div class="mw-content">

      <!-- ASSETS pane -->
      <div class="mw-pane active" id="mwPane-assets">
        ${_buildAssetsPane(bal, balUsd, holdingKeys, holdings)}
      </div>

      <!-- ACTIVITY pane -->
      <div class="mw-pane" id="mwPane-activity">
        ${_buildActivityPane(trades)}
      </div>

      <!-- NFT BADGES pane -->
      <div class="mw-pane" id="mwPane-nfts">
        ${_buildBadgesPane(earnedSet)}
      </div>

    </div>`;
}

/* ── ASSETS pane ─────────────────────────────────────────── */
function _buildAssetsPane(bal, balUsd, holdingKeys, holdings) {
  const wins   = profile.winCount  || 0;
  const losses = profile.lossCount || 0;
  const total  = wins + losses;

  let html = `
    <!-- Stats chips -->
    <div class="mw-stats-bar">
      <div class="mw-stat-chip">
        <div class="mw-stat-chip-label">Trades</div>
        <div class="mw-stat-chip-val">${total}</div>
      </div>
      <div class="mw-stat-chip">
        <div class="mw-stat-chip-label">Wins</div>
        <div class="mw-stat-chip-val" style="color:#2cffc9">${wins}</div>
      </div>
      <div class="mw-stat-chip">
        <div class="mw-stat-chip-label">Losses</div>
        <div class="mw-stat-chip-val" style="color:#ff4d6d">${losses}</div>
      </div>
      <div class="mw-stat-chip">
        <div class="mw-stat-chip-label">Badges</div>
        <div class="mw-stat-chip-val" style="color:#ffb432">${(profile.badges||[]).length}</div>
      </div>
    </div>

    <div class="mw-section-label">Your Tokens</div>

    <!-- SOL row -->
    <div class="mw-sol-row">
      <img class="mw-sol-logo" src="S2M-Logo.webp" alt="S2M" />
      <div class="mw-sol-info">
        <div class="mw-sol-name">Sol2Moon [S2M]</div>
        <div class="mw-sol-network">S2M · Simulator Balance</div>
      </div>
      <div class="mw-sol-vals">
        <div class="mw-sol-amount">${formatSol(bal)}</div>
        ${balUsd ? `<div class="mw-sol-usd">${balUsd}</div>` : ""}
      </div>
    </div>`;

  if (!holdingKeys.length) {
    html += `
      <div class="mw-empty">
        <div class="mw-empty-icon">📭</div>
        No open positions yet.<br>Head to the Simulator to start trading!
      </div>`;
  } else {
    html += `<div class="mw-token-list">`;
    holdingKeys.forEach(mint => {
      const h       = holdings[mint];
      const costSol = h.totalCostSol || 0;
      const logo    = h.logo
        ? `/.netlify/functions/logoProxy?url=${encodeURIComponent(h.logo)}`
        : "/sol2moon-token.png";
      const safeMnt = String(mint).replace(/[^1-9A-HJ-NP-Za-km-z]/g, "");
      const price   = dashPrices[mint];
      const curVal  = !price ? null
        : (_mwSolPrice > 0 && h.amount > 0)
          ? (h.amount * price / _mwSolPrice)
          : (h.avgPrice > 0 && costSol > 0 ? costSol * (price / h.avgPrice) : null);
      const pnlSol  = curVal !== null ? curVal - costSol : null;
      const pnlPct  = pnlSol !== null && costSol > 0 ? (pnlSol / costSol) * 100 : null;
      const sign    = pnlSol !== null ? (pnlSol >= 0 ? "+" : "") : "";
      const pnlCls  = pnlSol === null ? "loading" : pnlSol >= 0 ? "pos" : "neg";
      const pnlTxt  = pnlSol === null
        ? "⬤ Loading…"
        : `${sign}${formatSol(pnlSol)} (${sign}${pnlPct.toFixed(1)}%)`;

      html += `
        <div class="mw-token-row">
          <img class="mw-token-logo" src="${logo}" onerror="this.src='/sol2moon-token.png'" alt="${esc(h.symbol)}" />
          <div class="mw-token-info">
            <div class="mw-token-name">${esc(h.name || h.symbol)}</div>
            <div class="mw-token-sym">${esc(h.symbol || "")}</div>
          </div>
          <div class="mw-token-right">
            <div class="mw-token-vals">
              <div class="mw-token-val" id="mw-val-${safeMnt}">${curVal !== null ? formatSol(curVal) : formatSol(costSol)}</div>
              <div class="mw-token-cost">cost ${formatSol(costSol)}</div>
            </div>
            <div class="mw-token-pnl ${pnlCls}" id="mw-pnl-${safeMnt}">${pnlTxt}</div>
            <div class="mw-token-btns">
              <a class="mw-token-buy-btn" href="safe-ape.html"
                onclick="localStorage.setItem('sa_prefill_mint','${safeMnt}')">Buy</a>
              <a class="mw-token-sell-btn" href="safe-ape.html"
                onclick="localStorage.setItem('sa_prefill_mint','${safeMnt}')">Sell</a>
            </div>
          </div>
        </div>`;
    });
    html += `</div>`; // .mw-token-list
  }

  return html;
}

/* ── ACTIVITY pane ───────────────────────────────────────── */
function _buildActivityPane(trades) {
  if (!trades.length) {
    return `
      <div class="mw-empty">
        <div class="mw-empty-icon">🏜️</div>
        No transactions yet.<br>Your trade history will appear here.
      </div>`;
  }

  const rows = [...trades].reverse().map(tr => {
    const isBuy   = tr.type === "buy";
    const pnlSol  = !isBuy && tr.pnl !== undefined ? parseFloat(tr.pnl) : null;
    const amtSol  = isBuy ? (tr.totalCostSol || null) : (tr.totalReceivedSol || null);
    const pnlCls  = pnlSol === null ? "neutral" : pnlSol >= 0 ? "pos" : "neg";
    const pnlSign = pnlSol !== null && pnlSol >= 0 ? "+" : "";
    const dateStr = tr.timestamp
      ? new Date(tr.timestamp).toLocaleDateString("en-US", { month:"short", day:"numeric", year:"2-digit", hour:"2-digit", minute:"2-digit" })
      : "";
    const amountDisplay = amtSol !== null ? formatSol(amtSol) : "—";
    const pnlDisplay = pnlSol !== null
      ? `${pnlSign}${formatSol(pnlSol)}`
      : isBuy ? `-${amountDisplay}` : amountDisplay;

    return `
      <div class="mw-activity-row">
        <div class="mw-activity-icon ${isBuy ? "buy" : "sell"}">${isBuy ? "+" : "-"}</div>
        <div class="mw-activity-desc">
          <div class="mw-activity-title">${isBuy ? "Bought" : "Sold"} ${esc(tr.symbol || tr.name || "Token")}</div>
          <div class="mw-activity-subtitle">${esc(tr.name || "")} · Safe Ape Simulator</div>
        </div>
        <div class="mw-activity-right">
          <div class="mw-activity-amount ${pnlCls}">${pnlDisplay}</div>
          <div class="mw-activity-date">${dateStr}</div>
        </div>
      </div>`;
  }).join("");

  return `<div class="mw-activity-list">${rows}</div>`;
}

/* ── BADGES / NFT pane ───────────────────────────────────── */
function _buildBadgesPane(earnedSet) {
  /* Show only cosmetics + trading badges as "NFTs" — most visual */
  const CATEGORIES = [
    { id: "all",       label: "All" },
    { id: "cosmetics", label: "Cosmetics" },
    { id: "trading",   label: "Trading" },
    { id: "levels",    label: "Levels" },
    { id: "academy",   label: "Academy" },
  ];

  const earnedDefs  = BADGE_DEFS.filter(b => earnedSet.has(b.id));
  const totalEarned = earnedDefs.length;
  const totalAll    = BADGE_DEFS.length;

  let html = `
    <div style="text-align:center;margin-bottom:14px;">
      <div style="font-size:11px;color:rgba(207,255,244,0.35);">
        ${totalEarned} / ${totalAll} Badges Earned
      </div>
      <div style="height:4px;background:rgba(44,255,201,0.08);border-radius:4px;margin-top:6px;overflow:hidden;">
        <div style="height:100%;width:${((totalEarned/totalAll)*100).toFixed(1)}%;background:linear-gradient(90deg,#2cffc9,#7fffe1);border-radius:4px;"></div>
      </div>
    </div>

    <!-- Filter row -->
    <div class="mw-badge-filter-row">
      ${CATEGORIES.map((c, i) => `
        <button class="mw-badge-filter${i===0?" active":""}" data-filter="${c.id}"
          onclick="
            document.querySelectorAll('.mw-badge-filter').forEach(b=>b.classList.remove('active'));
            this.classList.add('active');
            _filterMwBadges('${c.id}');
          ">${c.label}</button>
      `).join("")}
    </div>

    <!-- Badge grid — show earned first, then locked -->
    <div class="mw-badge-grid" id="mwBadgeGrid">
      ${_renderBadgeCards(earnedSet, "all")}
    </div>`;

  return html;
}

window._filterMwBadges = function(cat) {
  const grid = document.getElementById("mwBadgeGrid");
  if (!grid) return;
  const earnedSet = new Set(profile.badges || []);
  BADGE_DEFS.filter(b => b.freebie).forEach(b => earnedSet.add(b.id));
  BADGE_DEFS.filter(b => b.market && isPurchased(b.id)).forEach(b => earnedSet.add(b.id));
  grid.innerHTML = _renderBadgeCards(earnedSet, cat);
};

function _renderBadgeCards(earnedSet, cat) {
  const filtered = cat === "all"
    ? BADGE_DEFS
    : BADGE_DEFS.filter(b => b.cat === cat);

  /* Sort: earned first */
  const sorted = [...filtered].sort((a, b) => {
    const ae = earnedSet.has(a.id) ? 0 : 1;
    const be = earnedSet.has(b.id) ? 0 : 1;
    return ae - be;
  });

  return sorted.map(b => {
    const earned = earnedSet.has(b.id);
    let mediaHtml;
    if (b.type === "video" && b.video) {
      mediaHtml = `<video class="mw-badge-video" autoplay loop muted playsinline src="${b.video}"></video>`;
    } else if (b.img) {
      mediaHtml = `<img class="mw-badge-img" src="${b.img}" alt="${esc(b.name)}"
        onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
        <span class="mw-badge-icon" style="display:none">${b.icon}</span>`;
    } else {
      mediaHtml = `<span class="mw-badge-icon">${b.icon}</span>`;
    }

    return `
      <div class="mw-badge-card ${earned ? "earned" : "locked"}" title="${esc(b.name)}: ${esc(b.desc)}">
        ${mediaHtml}
        <div class="mw-badge-name ${earned ? "earned" : ""}">${esc(b.name)}</div>
        ${earned ? `<div class="mw-badge-check">✓ EARNED</div>` : ""}
      </div>`;
  }).join("");
}

/* ── Tab switcher ────────────────────────────────────────── */
function _switchMwTab(tab) {
  document.querySelectorAll(".mw-tab").forEach(t => {
    t.classList.toggle("active", t.dataset.tab === tab);
  });
  document.querySelectorAll(".mw-pane").forEach(p => {
    p.classList.toggle("active", p.id === `mwPane-${tab}`);
  });
}
