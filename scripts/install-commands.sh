#!/usr/bin/env bash
# Install kachow slash commands into ~/.claude/commands/ and ~/.gemini/commands/.
# Idempotent: overwrites existing files by same name.
set -euo pipefail

AI_CONTEXT="${AI_CONTEXT:-$HOME/.ai-context}"

if [ ! -d "$AI_CONTEXT/commands" ]; then
  echo "  ~ no $AI_CONTEXT/commands dir — nothing to install"
  exit 0
fi

MANIFEST="$AI_CONTEXT/.install-manifest"

install_commands_to() {
  local tool_dir="$1"
  local tool_name="$2"
  [ -d "$tool_dir" ] || { echo "  ~ $tool_name dir not present, skipping"; return 0; }

  mkdir -p "$tool_dir/commands"
  echo "  + $tool_name: installing commands → $tool_dir/commands/"

  local count=0
  for f in "$AI_CONTEXT/commands"/*.md; do
    [ -f "$f" ] || continue
    cp "$f" "$tool_dir/commands/"
    echo "$tool_dir/commands/$(basename "$f")" >> "$MANIFEST"
    count=$((count + 1))
  done
  echo "    ✓ $count command(s) installed"
}

install_commands_to "$HOME/.claude" "Claude Code"
install_commands_to "$HOME/.gemini" "Gemini CLI"
