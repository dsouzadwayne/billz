#!/bin/bash

set -e

# Sync shared assets from chrome/billz to firefox/billz (preserving firefox/billz/manifest.json)
sync_to_firefox() {
  echo "Syncing latest assets to firefox/billz..."
  cp -r chrome/billz/background.js firefox/billz/
  cp -r chrome/billz/dashboard.html chrome/billz/dashboard.js chrome/billz/dashboard.css firefox/billz/
  cp -r chrome/billz/popup.html chrome/billz/popup.js chrome/billz/popup.css firefox/billz/
  cp -r chrome/billz/core firefox/billz/
  cp -r chrome/billz/platforms firefox/billz/
  cp -r chrome/billz/icons firefox/billz/
  cp -r chrome/billz/sample_orders.json firefox/billz/
  echo "Sync complete."
}

# Build package for a specific browser target
build_target() {
  local target="$1"
  local new_version="$2"
  local manifest="$target/billz/manifest.json"

  if [ ! -f "$manifest" ]; then
    echo "Error: Manifest not found at $manifest"
    return 1
  fi

  local current_version
  current_version=$(grep -oP '"version":\s*"\K[^"]+' "$manifest")
  
  if [ -n "$new_version" ] && [ "$new_version" != "$current_version" ]; then
    sed -i "s/\"version\": \"$current_version\"/\"version\": \"$new_version\"/" "$manifest"
    echo "[$target] Version updated from $current_version -> $new_version"
  else
    echo "[$target] Building version: $current_version"
  fi

  # Delete existing zip
  rm -f "$target/billz.zip" 2>/dev/null

  # Create new zip with manifest.json at root of archive
  (cd "$target/billz" && zip -r -q ../billz.zip . -x "*.DS_Store" "*Thumbs.db" "*__pycache__*" "*.git*")
  
  local zip_size
  zip_size=$(ls -lh "$target/billz.zip" | awk '{print $5}')
  echo "[$target] Created $target/billz.zip ($zip_size)"
}

# Choose browser
echo "=========================================="
echo "         billz Extension Release          "
echo "=========================================="
echo "Select browser to package:"
echo "  1) chrome"
echo "  2) firefox"
echo "  3) both"
read -p "Enter choice (1, 2, or 3): " BROWSER_CHOICE

# Get current version from chrome manifest
CURRENT_VERSION=$(grep -oP '"version":\s*"\K[^"]+' "chrome/billz/manifest.json")
echo "Current version: $CURRENT_VERSION"

# Ask user for new version
read -p "Enter new version (press Enter to keep $CURRENT_VERSION): " NEW_VERSION
if [ -z "$NEW_VERSION" ]; then
  NEW_VERSION="$CURRENT_VERSION"
fi

# Always sync shared files before building
sync_to_firefox

case "$BROWSER_CHOICE" in
  1)
    build_target "chrome" "$NEW_VERSION"
    echo "Ready to upload to Chrome Web Store: chrome/billz.zip"
    ;;
  2)
    build_target "firefox" "$NEW_VERSION"
    echo "Ready to upload to Firefox Add-ons (AMO): firefox/billz.zip"
    ;;
  3)
    build_target "chrome" "$NEW_VERSION"
    build_target "firefox" "$NEW_VERSION"
    echo "Ready to upload:"
    echo "  - Chrome Web Store: chrome/billz.zip"
    echo "  - Firefox Add-ons:  firefox/billz.zip"
    ;;
  *)
    echo "Invalid choice. Aborting."
    exit 1
    ;;
esac

# Git commit and push (if git repository is present)
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo ""
  read -p "Enter commit message (press Enter to skip git push): " COMMIT_MSG
  if [ -n "$COMMIT_MSG" ]; then
    git add .
    git commit -m "$COMMIT_MSG"
    git push
    echo "Git changes committed and pushed!"
  fi
fi

echo ""
echo "Done! 🎉"
