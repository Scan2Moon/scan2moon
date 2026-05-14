#!/usr/bin/env node
/**
 * scripts/copy-static.mjs
 *
 * Post-build step: copies static assets that Vite cannot auto-trace
 * (images referenced as plain strings in JS, badge directories, artwork)
 * from the project root into dist/.
 *
 * Run automatically via:  npm run build
 */

import { cpSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { join, extname, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');

if (!existsSync(dist)) mkdirSync(dist, { recursive: true });

let copied = 0;

/* ── 1. Entire asset directories ─────────────────────────── */
// These contain badge images, card backgrounds, and academy assets
// that are referenced as runtime strings like "/badges/First_Profit.png"
const DIRS = ['badges', 'CardsBG', 'academy_bages'];

// Netlify rejects filenames containing # or ? — skip them.
const netlifyUnsafe = (src) => !src.includes('#') && !src.includes('?');

for (const dir of DIRS) {
  const src = join(root, dir);
  if (existsSync(src)) {
    cpSync(src, join(dist, dir), { recursive: true, filter: netlifyUnsafe });
    console.log(`  ✓  ${dir}/`);
    copied++;
  } else {
    console.warn(`  ⚠  ${dir}/ not found — skipping`);
  }
}

/* ── 2. Root-level images referenced as JS strings ───────── */
// e.g.  const SOL_LOGO = "S2M-Logo.png"
//        : "/sol2moon-token.png"
// Vite cannot trace plain string paths, so these must be copied manually.
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ico']);

for (const f of readdirSync(root)) {
  if (IMAGE_EXTS.has(extname(f).toLowerCase())) {
    cpSync(join(root, f), join(dist, f));
    console.log(`  ✓  ${f}`);
    copied++;
  }
}

/* ── 3. Classic scripts Vite cannot bundle ───────────────── */
// Vite only bundles <script type="module">. These files are loaded
// as regular (classic) scripts in HTML and must be copied as-is.
//   skin-global.js        — blocking <head> skin loader, all pages
//   guide-risk-scanner-app.js — classic script for guide quiz
const CLASSIC_SCRIPTS = ['skin-global.js', 'guide-risk-scanner-app.js', 'skin-init.js'];

for (const f of CLASSIC_SCRIPTS) {
  const src = join(root, f);
  if (existsSync(src)) {
    cpSync(src, join(dist, f));
    console.log(`  ✓  ${f}`);
    copied++;
  }
}

/* ── 4. Extra static files ───────────────────────────────── */
// openapi.json is served from the root for the API portal page
const EXTRAS = ['openapi.json'];

for (const f of EXTRAS) {
  const src = join(root, f);
  if (existsSync(src)) {
    cpSync(src, join(dist, f));
    console.log(`  ✓  ${f}`);
    copied++;
  }
}

console.log(`\nStatic assets copied: ${copied} items → dist/`);
