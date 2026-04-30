#!/usr/bin/env bash
# generate-sri.sh — Compute SRI integrity hashes for all CDN scripts
# and apply them directly to all HTML files.
#
# Run once from the project root:
#   chmod +x generate-sri.sh
#   ./generate-sri.sh
#
# Requires: curl, openssl, python3 (all standard on macOS/Linux)

set -euo pipefail

compute_sri() {
  local url="$1"
  local tmpfile
  tmpfile=$(mktemp)
  curl -sL --max-time 30 "$url" -o "$tmpfile"
  local hash
  hash=$(openssl dgst -sha384 -binary "$tmpfile" | openssl base64 -A)
  rm "$tmpfile"
  echo "sha384-$hash"
}

echo "📡 Downloading CDN assets and computing SRI hashes..."

HTML2CANVAS_URL="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"
CHARTJS_URL="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"
LW_CHARTS_URL="https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js"
SOLANA_URL="https://unpkg.com/@solana/web3.js@1.98.0/lib/index.iife.min.js"

HTML2CANVAS_SRI=$(compute_sri "$HTML2CANVAS_URL")
echo "✅ html2canvas@1.4.1:          $HTML2CANVAS_SRI"

CHARTJS_SRI=$(compute_sri "$CHARTJS_URL")
echo "✅ chart.js@4.4.0:             $CHARTJS_SRI"

LW_CHARTS_SRI=$(compute_sri "$LW_CHARTS_URL")
echo "✅ lightweight-charts@4.1.3:   $LW_CHARTS_SRI"

SOLANA_SRI=$(compute_sri "$SOLANA_URL")
echo "✅ @solana/web3.js@1.98.0:     $SOLANA_SRI"

echo ""
echo "🔧 Applying integrity attributes to all HTML files..."

python3 - <<PYEOF
import re, os, glob

hashes = {
    "html2canvas@1.4.1/dist/html2canvas.min.js":      ("$HTML2CANVAS_SRI", "html2canvas@1.4.1"),
    "chart.js@4.4.0/dist/chart.umd.min.js":            ("$CHARTJS_SRI",    "chart.js@4.4.0"),
    "lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js": ("$LW_CHARTS_SRI", "lightweight-charts@4.1.3"),
    "@solana/web3.js@1.98.0/lib/index.iife.min.js":    ("$SOLANA_SRI",     "solana/web3.js@1.98.0"),
}

for html_path in glob.glob("*.html"):
    content = open(html_path).read()
    changed = False
    for url_fragment, (sri, label) in hashes.items():
        # Match script tags that contain the url_fragment but lack integrity=
        pattern = r'(<script\s[^>]*' + re.escape(url_fragment.split("/")[-1]) + r'[^>]*)(?!\s+integrity=)([^>]*>)'
        def add_sri(m):
            tag = m.group(0)
            if 'integrity=' in tag:
                return tag
            # Insert integrity + crossorigin before the closing >
            return tag[:-1] + f' integrity="{sri}" crossorigin="anonymous">'
        new_content = re.sub(pattern, add_sri, content)
        if new_content != content:
            content = new_content
            changed = True
            print(f"  ✅ {html_path} — {label} SRI applied")
    if changed:
        open(html_path, 'w').write(content)

print("\n✅ Done! All SRI hashes applied.")
PYEOF
