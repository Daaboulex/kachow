#!/usr/bin/env bash
# preview-image.sh — render image in terminal via chafa.
# Usage: preview-image.sh <path> [width] [height]
# Default size: $COLUMNS × 24. Respects $CLAUDE_PREVIEW_* overrides.

set -eu

if [ $# -lt 1 ]; then
  echo "usage: $0 <image-path> [width] [height]" >&2
  exit 2
fi

IMG=$1
W=${2:-${CLAUDE_PREVIEW_WIDTH:-${COLUMNS:-80}}}
H=${3:-${CLAUDE_PREVIEW_HEIGHT:-24}}

if ! command -v chafa >/dev/null 2>&1; then
  cat >&2 <<EOF
chafa not installed. Install options:
  NixOS:        nix profile install nixpkgs#chafa
  Debian/Ubuntu: sudo apt install chafa
  Fedora:        sudo dnf install chafa
  Arch:          sudo pacman -S chafa
  macOS:         brew install chafa
  Windows:       scoop install chafa  (or use WSL)
  docs:          https://hpjansson.org/chafa/
EOF
  exit 1
fi

if [ ! -f "$IMG" ]; then
  echo "preview-image: file not found: $IMG" >&2
  exit 1
fi

# Let chafa auto-detect best output format (sixel/kitty/iterm2/symbols).
# --symbols=all + --colors=full is readable in any reasonable terminal.
exec chafa --size="${W}x${H}" --symbols=all --colors=full "$IMG"
