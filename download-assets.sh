#!/usr/bin/env bash
# download-assets.sh — Download remote assets to serve locally
# Run once from project root: ./download-assets.sh
#
# This replaces raw.githubusercontent.com references with local files
# for better reliability and performance.

set -euo pipefail

echo "📡 Downloading remote assets..."

# Solana logo (used in index.html and dashboard.html)
curl -sL "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png" \
  -o sol-logo.png
echo "✅ sol-logo.png downloaded ($(wc -c < sol-logo.png) bytes)"

echo ""
echo "🔧 Updating HTML references..."

# Replace raw.githubusercontent.com SOL logo URL with local file in all HTML files
for f in *.html; do
  if grep -q "solana-labs/token-list" "$f"; then
    sed -i 's|https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png|/sol-logo.png|g' "$f"
    echo "  ✅ $f — SOL logo URL updated to /sol-logo.png"
  fi
done

echo ""
echo "✅ Done! Commit sol-logo.png and the updated HTML files."
