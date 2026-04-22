#!/usr/bin/env bash
# uninstall.sh — Remove everything kachow installed, leaving your AI configs intact.
#
# Uses the install manifest to delete only what was created.
# Does NOT touch your personal ~/.claude/memory or ~/.gemini/memory files.
# Does NOT remove the canonical source (~/.ai-context) — you remove that manually if wanted.
#
# Usage:
#   uninstall.sh         # dry-run — shows what would be removed
#   uninstall.sh --yes   # actually remove
set -euo pipefail

AI_CONTEXT="${AI_CONTEXT:-$HOME/.ai-context}"
MANIFEST="$AI_CONTEXT/.install-manifest"
DO_DELETE=0

for arg in "$@"; do
  case "$arg" in
    --yes|-y) DO_DELETE=1 ;;
    --help|-h) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  esac
done

if [ ! -f "$MANIFEST" ]; then
  echo "No install manifest found at $MANIFEST — nothing to uninstall, or install ran before manifest support."
  echo "Fallback: manually remove these common install targets:"
  echo "  ~/.claude/hooks  ~/.gemini/hooks"
  echo "  ~/.claude/commands  ~/.gemini/commands"
  echo "  ~/.claude/CLAUDE.md (if it's a symlink into \$AI_CONTEXT)"
  echo "  ~/.gemini/GEMINI.md (if it's a symlink)"
  echo "  ~/.codex/AGENTS.md ~/.config/opencode/AGENTS.md ~/.config/aider/AGENTS.md"
  exit 0
fi

echo "=== kachow uninstall ==="
[ "$DO_DELETE" -eq 0 ] && echo "DRY RUN — re-run with --yes to actually delete"
echo ""

REMOVED=0
SKIPPED=0
while IFS= read -r line; do
  # Skip comments + empty lines
  case "$line" in
    '#'*|'') continue ;;
  esac
  if [ -L "$line" ] || [ -f "$line" ]; then
    if [ "$DO_DELETE" -eq 1 ]; then
      rm -f "$line"
      REMOVED=$((REMOVED + 1))
      echo "  ✗ $line"
    else
      echo "  WOULD-DELETE $line"
    fi
  else
    SKIPPED=$((SKIPPED + 1))
  fi
done < "$MANIFEST"

# Sweep broken symlinks in common targets (defense against manifest drift)
if [ "$DO_DELETE" -eq 1 ]; then
  for base in "$HOME/.claude" "$HOME/.gemini" "$HOME/.codex" "$HOME/.config/opencode" "$HOME/.config/aider" "$HOME/.cursor" "$HOME/.continue" "$HOME/.codeium"; do
    [ -d "$base" ] || continue
    find "$base" -maxdepth 4 -type l ! -exec test -e {} \; -print 2>/dev/null | while read -r link; do
      rm -f "$link"
      echo "  ✗ (dangling) $link"
    done
  done
fi

echo ""
if [ "$DO_DELETE" -eq 1 ]; then
  rm -f "$MANIFEST"
  echo "Removed $REMOVED file(s). Skipped $SKIPPED already-gone entries."
  echo ""
  echo "The canonical source at $AI_CONTEXT is untouched. Remove it manually if desired:"
  echo "  rm -rf $AI_CONTEXT"
else
  echo "Dry-run complete. Run with --yes to actually delete."
fi
