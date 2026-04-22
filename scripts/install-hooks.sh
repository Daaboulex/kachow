#!/usr/bin/env bash
# Install kachow hooks into ~/.claude/hooks/ + ~/.gemini/hooks/.
# Also copies settings.template.json into ~/.claude/settings.json and
# ~/.gemini/settings.json IF those are missing or empty ({}).
# Idempotent: existing hooks are overwritten; existing non-empty settings
# are preserved with a merge hint.
set -euo pipefail

AI_CONTEXT="${AI_CONTEXT:-$HOME/.ai-context}"

if [ ! -d "$AI_CONTEXT/hooks" ]; then
  echo "ERROR: $AI_CONTEXT/hooks missing" >&2
  exit 1
fi

MANIFEST="$AI_CONTEXT/.install-manifest"
echo "# kachow install manifest — lines are absolute paths of installed files/symlinks" > "$MANIFEST"
echo "# Generated $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$MANIFEST"

install_hooks_to() {
  local tool_dir="$1"
  local tool_name="$2"
  [ -d "$tool_dir" ] || { echo "  ~ $tool_name dir not present, skipping"; return 0; }

  mkdir -p "$tool_dir/hooks"
  echo "  + $tool_name: installing hooks → $tool_dir/hooks/"

  # Copy top-level hooks (*.js) — flat, no subdirs except lib/
  for f in "$AI_CONTEXT/hooks"/*.js; do
    [ -f "$f" ] || continue
    cp "$f" "$tool_dir/hooks/"
    echo "$tool_dir/hooks/$(basename "$f")" >> "$MANIFEST"
  done

  # Copy lib/ recursively
  if [ -d "$AI_CONTEXT/hooks/lib" ]; then
    mkdir -p "$tool_dir/hooks/lib"
    cp -r "$AI_CONTEXT/hooks/lib/." "$tool_dir/hooks/lib/"
    find "$tool_dir/hooks/lib" -type f | while read -r f; do
      echo "$f" >> "$MANIFEST"
    done
  fi

  # Copy tests/ — useful for users to run locally
  if [ -d "$AI_CONTEXT/hooks/tests" ]; then
    mkdir -p "$tool_dir/hooks/tests"
    cp -r "$AI_CONTEXT/hooks/tests/." "$tool_dir/hooks/tests/"
    chmod +x "$tool_dir/hooks/tests/"*.sh 2>/dev/null || true
    find "$tool_dir/hooks/tests" -type f | while read -r f; do
      echo "$f" >> "$MANIFEST"
    done
  fi

  # Settings template — only if settings.json is missing or {}
  local settings="$tool_dir/settings.json"
  local template="$AI_CONTEXT/settings.template.json"
  if [ ! -f "$settings" ] || [ "$(cat "$settings" 2>/dev/null)" = "{}" ] || [ ! -s "$settings" ]; then
    if [ -f "$template" ]; then
      # Substitute $HOME in template so node -e works without shell expansion.
      # Hook commands in template use $HOME placeholder; replace with actual.
      sed "s|\$HOME|$HOME|g" "$template" > "$settings"
      echo "    ✓ settings.json seeded from template"
      echo "$settings" >> "$MANIFEST"
    fi
  else
    echo "    ~ settings.json already exists ($(wc -c < "$settings") bytes) — NOT overwritten"
    echo "      (merge hooks block manually from $template if desired)"
  fi
}

install_hooks_to "$HOME/.claude" "Claude Code"
install_hooks_to "$HOME/.gemini" "Gemini CLI"

echo ""
echo "Hooks installed. Manifest: $MANIFEST"
