#!/usr/bin/env bash
# sync-plugin-skills.sh — Sync Claude plugin skills to cross-tool .agents/ directory.
# Run after: installing/updating a Claude plugin, or periodically.
# Ensures Gemini, Codex, and Pi can discover plugin-provided skills.
#
# Architecture:
#   Plugin cache (~/.claude/plugins/cache/) → .ai-context/.agents/skills/ (source)
#   ~/.agents/skills/ → symlinks to .ai-context/.agents/skills/ (cross-tool discovery)
#
# Usage: bash ~/.ai-context/scripts/sync-plugin-skills.sh [--dry-run]

set -euo pipefail

HOME_DIR="${HOME:-$HOME}"
PLUGIN_CACHE="$HOME_DIR/.claude/plugins/cache"
AGENTS_SRC="$HOME_DIR/.ai-context/.agents/skills"
AGENTS_DISCOVERY="$HOME_DIR/.agents/skills"
DRY_RUN="${1:-}"

added=0
linked=0
skipped=0

# Scan all SKILL.md files in plugin cache
while IFS= read -r skill_md; do
  skill_dir=$(dirname "$skill_md")
  skill_name=$(basename "$skill_dir")

  # Skip if already in .agents source
  dest="$AGENTS_SRC/$skill_name"
  if [ -d "$dest" ]; then
    skipped=$((skipped + 1))
    continue
  fi

  if [ "$DRY_RUN" = "--dry-run" ]; then
    echo "  would copy: $skill_name"
    added=$((added + 1))
    continue
  fi

  cp -r "$skill_dir" "$dest"
  added=$((added + 1))

done < <(find "$PLUGIN_CACHE" -name "SKILL.md" 2>/dev/null)

# Ensure ~/.agents/skills/ symlinks exist for everything in source
if [ -d "$AGENTS_SRC" ]; then
  for src_skill in "$AGENTS_SRC"/*/; do
    name=$(basename "$src_skill")
    link="$AGENTS_DISCOVERY/$name"
    if [ ! -L "$link" ] && [ ! -d "$link" ]; then
      if [ "$DRY_RUN" = "--dry-run" ]; then
        echo "  would symlink: $name"
      else
        ln -s "$src_skill" "$link"
      fi
      linked=$((linked + 1))
    fi
  done
fi

# Remove excluded skills from discovery (based on skill-exclusions.yaml)
EXCLUSIONS_FILE="$HOME_DIR/.ai-context/modules/skill-exclusions.yaml"
excluded=0
if [ -f "$EXCLUSIONS_FILE" ]; then
  while IFS= read -r line; do
    line=$(echo "$line" | sed 's/#.*//' | xargs)
    [ -z "$line" ] && continue
    link="$AGENTS_DISCOVERY/$line"
    if [ -L "$link" ]; then
      if [ "$DRY_RUN" = "--dry-run" ]; then
        echo "  would exclude: $line"
      else
        rm "$link"
      fi
      excluded=$((excluded + 1))
    fi
  done < "$EXCLUSIONS_FILE"
fi

echo "Sync complete: $added added, $linked linked, $excluded excluded, $skipped already present."
