#!/usr/bin/env bash
# Regenerate the app icons in packages/web/public from one square PNG
# (the chosen Muse drawing, e.g. docs/design/icon/quill/quill1.png).
# Vite copies public/ into dist, so the server serves them at /icon.png etc.
# Needs macOS sips.
set -euo pipefail
src="${1:?usage: scripts/make-icons.sh <square.png>}"
out="$(cd "$(dirname "$0")/.." && pwd)/packages/web/public"
mkdir -p "$out"
sips -z 512 512 "$src" --out "$out/icon.png" >/dev/null
sips -z 180 180 "$src" --out "$out/apple-touch-icon.png" >/dev/null
sips -z 32 32 "$src" --out "$out/favicon.png" >/dev/null
echo "wrote icon.png (512), apple-touch-icon.png (180), favicon.png (32) to $out"
