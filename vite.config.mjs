/**
 * vite.config.mjs — Scan2Moon build config
 *
 * Multi-page app (MPA): every .html file in the project root is an entry point.
 * Vite bundles each page's JS modules + CSS into fingerprinted chunks,
 * replacing manual ?v= cache-busting with content-hash filenames.
 *
 * Static assets that are referenced as plain strings in JS
 * (badges/, CardsBG/, root images, etc.) are copied by the
 * post-build script:  scripts/copy-static.mjs
 *
 * Dev:     npm run dev      → http://localhost:3000
 *          /.netlify/functions/* is proxied to scan2moon.com (live production).
 *          Frontend hot-reloads locally; API data comes from real functions.
 * Build:   npm run build    → dist/
 * Preview: npm run preview  → serves dist/ locally
 */

import { defineConfig } from 'vite';
import { readdirSync }   from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Startup confirmation ─────────────────────────────────
// This line prints ONLY when the new config is loaded.
// If you don't see it after restarting, Vite is still using a cached process.
console.log('\x1b[36m[vite.config] ✓ Proxy active: /.netlify/functions → scan2moon.com\x1b[0m');

/* ── Auto-discover all HTML pages in the project root ─────── */
const htmlEntries = Object.fromEntries(
  readdirSync(__dirname)
    .filter(f => f.endsWith('.html'))
    .map(f => [f.slice(0, -5), resolve(__dirname, f)])
);

export default defineConfig(({ command }) => ({

  root:      __dirname,
  // Dev: serve the project root so CSS url("headerweb.png") etc. resolve correctly.
  // Build: false — copy-static.mjs handles all static assets manually.
  publicDir: command === 'serve' ? __dirname : false,

  build: {
    outDir:     'dist',
    emptyOutDir: true,
    assetsDir:  'assets',          // All JS/CSS chunks → dist/assets/
    chunkSizeWarningLimit: 1200,   // style.css is large; silence noise warnings

    rollupOptions: {
      input: htmlEntries,

      output: {
        // Readable chunk names instead of hash-only filenames
        chunkFileNames:  'assets/[name]-[hash].js',
        entryFileNames:  'assets/[name]-[hash].js',
        assetFileNames:  'assets/[name]-[hash][extname]',

        // Manual chunk splitting: shared modules loaded by 3+ pages
        // get their own chunk so they're downloaded once and cached.
        manualChunks(id) {
          if (id.includes('nav.js'))         return 'shared-nav';
          if (id.includes('i18n.js'))        return 'shared-i18n';
          if (id.includes('scanSignals.js')) return 'shared-signals';
          if (id.includes('scanData.js'))    return 'shared-scan';
          if (id.includes('community.js'))   return 'shared-community';
        },
      },

      // Suppress warnings for CDN globals (Chart.js, LightweightCharts,
      // Solana web3.js) that are loaded via <script> tags from CDN and
      // accessed as window globals — not imported as modules.
      onwarn(warning, defaultHandler) {
        if (warning.code === 'MISSING_GLOBAL_NAME')  return;
        if (warning.code === 'CIRCULAR_DEPENDENCY')  return;
        defaultHandler(warning);
      },
    },

    // Target modern browsers (all Solana traders). Keeps output clean —
    // no legacy polyfills, no extra inline script injections.
    target: 'es2020',
  },

  /* ── Dev server ─────────────────────────────────────────── */
  server: {
    port: 3000,
    strictPort: false,
    open: false,   // Netlify Dev opens localhost:8888 — don't let Vite open 3000

    // Proxy all Netlify function calls to the live production site.
    // This means npm run dev gets real data without needing netlify-cli.
    // Frontend code hot-reloads locally; functions run on scan2moon.com.
    proxy: {
      '/.netlify/functions': {
        target:       'https://scan2moon.com',
        changeOrigin: true,
        secure:       false,   // skip SSL verify for proxy (scan2moon has valid cert but avoids edge cases)
        configure(proxy) {
          proxy.on('proxyReq', (_req, req) => {
            console.log('[proxy →]', req.url);
          });
          proxy.on('proxyRes', (proxyRes, req) => {
            if (proxyRes.statusCode !== 200)
              console.warn(`[proxy ←] ${proxyRes.statusCode} ${req.url}`);
          });
          proxy.on('error', (err, req) => {
            console.error('[proxy ✗]', req.url, err.message);
          });
        },
      },
    },
  },

}));
