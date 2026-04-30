/* ============================================================
   Scan2Moon — birdeye-ws.js  (v3.0 — Secure Server-Proxy)

   PRODUCTION:  All price data flows through the server-side
                /.netlify/functions/priceOnly proxy.
                The Birdeye API key NEVER reaches the browser.

   LOCAL DEV:   Set  window.__BIRDEYE_KEY = "your-key-here"
                in the browser console (or skin-global.js) to
                enable real Birdeye WebSocket for local testing.

   Public API (unchanged — no callers need updating):
     birdeyeWs.subscribe(address, chartType, callback) → unsub fn
     birdeyeWs.connect()      — called automatically on first subscribe
     birdeyeWs.destroy()      — cleanup on page unload
     birdeyeWs.readyState     — "polling"|"open"|"closed"

   All callbacks receive the same normalised object as before:
     { address, price, o, h, l, c, v, unixTime }
   ============================================================ */

const _WS_BASE   = "wss://public-api.birdeye.so/socket/solana";
const _PING_MS   = 20_000;
const _MIN_DELAY = 1_000;
const _MAX_DELAY = 30_000;
const _POLL_MS   = 4_000;  // server proxy polling interval
const _PROXY_URL = "/.netlify/functions/priceOnly"; // key lives on server only

/* ── Debug logging ── */
const _WS_DEBUG = false;

/* ── TF normaliser (frontend "1h" → Birdeye "1H") ── */
function _normTf(tf) {
  if (!tf) return null;
  const map = { "1h":"1H", "4h":"4H", "12h":"12H", "1d":"1D", "max":"1D" };
  return map[tf] || tf;
}

/* ── Normalise any price payload to the standard callback shape ── */
function _normalise(raw) {
  if (!raw) return null;
  const price = parseFloat(raw.c ?? raw.close ?? raw.value ?? 0);
  if (!(price > 0)) return null;
  return {
    address:  raw.address,
    price,
    o:        parseFloat(raw.o  ?? raw.open  ?? price),
    h:        parseFloat(raw.h  ?? raw.high  ?? price),
    l:        parseFloat(raw.l  ?? raw.low   ?? price),
    c:        price,
    v:        parseFloat(raw.v  ?? raw.volume ?? 0),
    unixTime: raw.unixTime ?? Math.floor(Date.now() / 1000),
    type:     raw.type ?? raw.chartType ?? null,
  };
}

class BirdeyeWsManager {

  constructor() {
    /* "address:normTf" → Set<callback>   (chartType subscriptions)
       "address"        → Set<callback>   (price-only subscriptions) */
    this._subs      = new Map();
    this._pollMints = new Set();
    this._pollTimer = null;
    this._destroyed = false;
    this.readyState = "closed";

    /* Dev WebSocket state — only used when window.__BIRDEYE_KEY is set */
    this._ws          = null;
    this._pingTimer   = null;
    this._reconnTimer = null;
    this._reconnDelay = _MIN_DELAY;
    this._connecting  = false;

    this._onOpen    = this._onOpen.bind(this);
    this._onMessage = this._onMessage.bind(this);
    this._onClose   = this._onClose.bind(this);
    this._onError   = this._onError.bind(this);
  }

  /* ══════════════════════════════════════
     CONNECT

     Production: starts server-proxy polling immediately.
                 API key never leaves the server.
     Local dev:  if window.__BIRDEYE_KEY is set, opens the
                 real Birdeye WebSocket with that key.
  ══════════════════════════════════════ */

  async connect() {
    if (this._destroyed) return;

    // Dev path: real WebSocket when dev key is present
    if (window.__BIRDEYE_KEY) {
      if (this._connecting) return;
      if (this._ws && (this._ws.readyState === WebSocket.OPEN ||
                       this._ws.readyState === WebSocket.CONNECTING)) return;
      this._connectDevWs(window.__BIRDEYE_KEY);
      return;
    }

    // Production path: server-proxy polling — key never reaches browser
    this._startPolling();
  }

  /* ── Dev WebSocket (local development only) ────────────────── */

  _connectDevWs(key) {
    this._connecting = true;
    this.readyState  = "connecting";
    try {
      this._ws = new WebSocket(`${_WS_BASE}?x-api-key=${key}`);
    } catch (err) {
      console.warn("[BirdeyeWS] Dev WS failed — falling back to polling:", err.message);
      this._connecting = false;
      this._startPolling();
      return;
    }
    this._ws.addEventListener("open",    this._onOpen);
    this._ws.addEventListener("message", this._onMessage);
    this._ws.addEventListener("close",   this._onClose);
    this._ws.addEventListener("error",   this._onError);
  }

  _onOpen() {
    this._connecting  = false;
    this._reconnDelay = _MIN_DELAY;
    this.readyState   = "open";
    this._stopPolling();
    console.log("[BirdeyeWS] Dev WebSocket connected ✓");
    this._startPing();
    this._resubscribeAll();
  }

  _onMessage(e) {
    if (_WS_DEBUG) console.log("[BirdeyeWS] RAW ←", e.data.slice(0, 400));
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === "PONG") return;
    if (msg.type !== "PRICE_DATA") return;

    const raw     = msg.data ?? msg;
    const address = raw?.address ?? msg?.address ?? null;
    if (!address) return;
    if (!raw.address) raw.address = address;

    const norm = _normalise(raw);
    if (!norm) return;

    if (_WS_DEBUG) console.log("[BirdeyeWS] PRICE_DATA →", address.slice(0,8), "price:", norm.price);

    const tf = raw.type || raw.chartType || msg.chartType || null;
    if (tf) {
      this._dispatch(`${address}:${_normTf(tf)}`, norm);
      const lower = tf.toLowerCase();
      if (lower !== _normTf(tf))              this._dispatch(`${address}:${lower}`, norm);
      if (tf !== _normTf(tf) && tf !== lower) this._dispatch(`${address}:${tf}`,   norm);
    }
    this._dispatch(address, norm);
  }

  _onClose(e) {
    this._connecting = false;
    this.readyState  = "closed";
    this._stopPing();
    if (!this._destroyed && this._subs.size > 0) {
      console.log(`[BirdeyeWS] Dev WS closed (${e.code}) — reconnecting in ${this._reconnDelay}ms`);
      this._reconnTimer = setTimeout(() => {
        this._reconnTimer = null;
        this.connect();
      }, this._reconnDelay);
      this._reconnDelay = Math.min(this._reconnDelay * 2 + Math.random() * 500, _MAX_DELAY);
    }
  }

  _onError() {
    this._connecting = false;
    // _onClose fires next and handles reconnect
  }

  /* ══════════════════════════════════════
     SERVER-PROXY POLLING (production)

     Calls /.netlify/functions/priceOnly —
     the Birdeye API key lives on the server
     and is never sent to the browser.
  ══════════════════════════════════════ */

  _startPolling() {
    if (this._pollTimer) return;
    this.readyState = "polling";
    console.log("[BirdeyeWS] Secure server-proxy polling active (every", _POLL_MS, "ms)");
    this._pollTimer = setInterval(() => this._pollAllMints(), _POLL_MS);
    this._pollAllMints(); // immediate first tick
  }

  _stopPolling() {
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
    if (this.readyState === "polling") this.readyState = "closed";
  }

  async _pollOneMint(address) {
    try {
      const res = await fetch(
        `${_PROXY_URL}?mint=${encodeURIComponent(address)}`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (!res.ok) return;
      const json  = await res.json();
      const value = parseFloat(json?.price ?? 0);
      if (!(value > 0)) return;

      const norm = _normalise({ address, value });
      if (!norm) return;

      // Dispatch to price-only subscribers
      this._dispatch(address, norm);
      // Dispatch to chartType subscribers (accept same normalised shape)
      for (const [k, cbs] of this._subs) {
        if (k.startsWith(`${address}:`) && cbs.size) {
          for (const cb of cbs) { try { cb(norm); } catch {} }
        }
      }
    } catch { /* non-critical */ }
  }

  async _pollAllMints() {
    // Dev WS just came up — hand off to it
    if (this._ws?.readyState === WebSocket.OPEN) {
      this._stopPolling();
      return;
    }
    // Stagger mints by 200 ms to avoid request burst
    const mints = [...this._pollMints];
    for (let i = 0; i < mints.length; i++) {
      setTimeout(() => this._pollOneMint(mints[i]), i * 200);
    }
  }

  /* ══════════════════════════════════════
     SUBSCRIBE / UNSUBSCRIBE
  ══════════════════════════════════════ */

  subscribe(address, chartType, callback) {
    if (!address || typeof callback !== "function") return () => {};

    const normTf = chartType ? _normTf(chartType) : null;
    const key    = normTf ? `${address}:${normTf}` : address;

    if (!this._subs.has(key)) this._subs.set(key, new Set());
    this._subs.get(key).add(callback);
    this._pollMints.add(address);

    if (this._ws?.readyState === WebSocket.OPEN) {
      this._sendSub(address, normTf);
    } else {
      this.connect();
    }

    return () => this.unsubscribe(address, chartType, callback);
  }

  unsubscribe(address, chartType, callback) {
    const normTf = chartType ? _normTf(chartType) : null;
    const key    = normTf ? `${address}:${normTf}` : address;

    const cbs = this._subs.get(key);
    if (!cbs) return;
    cbs.delete(callback);
    if (cbs.size === 0) {
      this._subs.delete(key);
      if (this._ws?.readyState === WebSocket.OPEN) this._sendUnsub(address, normTf);
    }

    const hasAny = [...this._subs.keys()].some(k => k === address || k.startsWith(`${address}:`));
    if (!hasAny) this._pollMints.delete(address);

    if (this._subs.size === 0) this._stopPolling();
  }

  /* ══════════════════════════════════════
     DISPATCH
  ══════════════════════════════════════ */

  _dispatch(key, norm) {
    const cbs = this._subs.get(key);
    if (!cbs?.size) return;
    for (const cb of cbs) {
      try { cb(norm); } catch (err) {
        console.warn("[BirdeyeWS] Subscriber threw:", err);
      }
    }
  }

  /* ══════════════════════════════════════
     DEV WS WIRE HELPERS
  ══════════════════════════════════════ */

  _sendSub(address, normTf) {
    const msg = { type: "SUBSCRIBE_PRICE", data: { address } };
    if (normTf) msg.data.chartType = normTf;
    if (_WS_DEBUG) console.log("[BirdeyeWS] SEND →", JSON.stringify(msg));
    this._send(msg);
  }

  _sendUnsub(address, normTf) {
    const msg = { type: "UNSUBSCRIBE_PRICE", data: { address } };
    if (normTf) msg.data.chartType = normTf;
    this._send(msg);
  }

  _send(obj) {
    if (this._ws?.readyState !== WebSocket.OPEN) return;
    try { this._ws.send(JSON.stringify(obj)); } catch {}
  }

  _resubscribeAll() {
    const sent = new Set();
    for (const key of this._subs.keys()) {
      if (sent.has(key)) continue;
      sent.add(key);
      const i = key.indexOf(":");
      if (i === -1) { this._sendSub(key, null); }
      else          { this._sendSub(key.slice(0, i), key.slice(i + 1)); }
    }
  }

  _startPing() {
    this._stopPing();
    this._pingTimer = setInterval(() => {
      if (this._ws?.readyState === WebSocket.OPEN) this._send({ type: "PING" });
    }, _PING_MS);
  }

  _stopPing() {
    if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; }
  }

  /* ══════════════════════════════════════
     CLEANUP
  ══════════════════════════════════════ */

  destroy() {
    this._destroyed = true;
    this._stopPolling();
    this._stopPing();
    if (this._reconnTimer) { clearTimeout(this._reconnTimer); this._reconnTimer = null; }
    if (this._ws) {
      this._ws.removeEventListener("open",    this._onOpen);
      this._ws.removeEventListener("message", this._onMessage);
      this._ws.removeEventListener("close",   this._onClose);
      this._ws.removeEventListener("error",   this._onError);
      try { this._ws.close(1000, "Page unload"); } catch {}
      this._ws = null;
    }
    this._subs.clear();
    this._pollMints.clear();
    this.readyState = "closed";
  }
}

/* ── Singleton ── */
export const birdeyeWs = new BirdeyeWsManager();
window.addEventListener("beforeunload", () => birdeyeWs.destroy());

/* ── Dev helper: inspect in DevTools with __birdeyeWs.readyState ── */
if (typeof window !== "undefined") {
  window.__birdeyeWs = birdeyeWs;
}
