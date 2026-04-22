#!/usr/bin/env bash
# Install / verify AGENTS.md symlinks for all supported AI tools.
# Idempotent — safe to re-run.
# Source of truth: ~/.ai-context/AGENTS.md

set -euo pipefail

AI_CONTEXT="${AI_CONTEXT:-$HOME/.ai-context}"
CANONICAL="$AI_CONTEXT/AGENTS.md"

if [ ! -f "$CANONICAL" ]; then
  echo "ERROR: canonical source missing at $CANONICAL" >&2
  exit 1
fi

# Targets: tool → symlink path.
# Parallel arrays instead of associative arrays (declare -A requires bash 4+;
# macOS ships bash 3.2 by default).
TARGET_LABELS=(claude gemini codex opencode aider)
TARGET_PATHS=(
  "$HOME/.claude/CLAUDE.md"
  "$HOME/.gemini/GEMINI.md"
  "$HOME/.codex/AGENTS.md"
  "$HOME/.config/opencode/AGENTS.md"
  "$HOME/.config/aider/AGENTS.md"
)

OPTIONAL_LABELS=(windsurf-global)
OPTIONAL_PATHS=("$HOME/.codeium/windsurf/memories/global_rules.md")

link() {
  local label="$1" path="$2"
  local dir
  dir=$(dirname "$path")
  mkdir -p "$dir"
  # HARD GUARD: never create a symlink to a non-existent target.
  if [ ! -e "$CANONICAL" ]; then
    echo "✗ $label: REFUSING — target does not exist: $CANONICAL" >&2
    return 1
  fi
  if [ -L "$path" ]; then
    local current
    current=$(readlink "$path")
    if [ "$current" = "$CANONICAL" ]; then
      echo "✓ $label: already linked → $CANONICAL"
      return
    fi
    echo "↻ $label: replacing stale symlink ($current → $CANONICAL)"
    rm "$path"
  elif [ -f "$path" ]; then
    local bak="$path.pre-ai-context-bak-$(date +%s)"
    echo "↻ $label: backing up existing file to $(basename "$bak")"
    mv "$path" "$bak"
  fi
  ln -s "$CANONICAL" "$path"
  # Post-link verification.
  if [ ! -e "$path" ]; then
    echo "✗ $label: SYMLINK CREATED BUT BROKEN — target resolved to nothing: $path" >&2
    return 1
  fi
  echo "+ $label: linked → $CANONICAL"
}

echo "== Core AI tools =="
for i in "${!TARGET_LABELS[@]}"; do
  link "${TARGET_LABELS[$i]}" "${TARGET_PATHS[$i]}"
done

echo
echo "== Optional tools (linked if dir exists) =="
for i in "${!OPTIONAL_LABELS[@]}"; do
  label="${OPTIONAL_LABELS[$i]}"
  path="${OPTIONAL_PATHS[$i]}"
  if [ -d "$(dirname "$path")" ]; then
    link "$label" "$path"
  else
    echo "- $label: skipped (dir not present: $(dirname "$path"))"
  fi
done

echo
echo "Done. Edit $CANONICAL and every tool picks up the change."
