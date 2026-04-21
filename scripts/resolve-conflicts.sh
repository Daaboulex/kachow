#!/usr/bin/env bash
# Resolve Syncthing conflict files in AI state directories.
# Strategy: for each conflict, keep the newest mtime, move others to archive.
#
# Syncthing creates files like `AI-progress.sync-conflict-20260409-095352-<device>.json`
# when two machines write the same file within scan interval.
# These are SAFE (originals preserved in .stversions/), but accumulate clutter.
#
# Usage: ~/.ai-context/scripts/resolve-syncthing-conflicts.sh [--dry-run]

set -euo pipefail

DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

# Default roots: the three AI-context dirs shipped by this framework.
# Add extra roots via env var: RESOLVE_EXTRA_ROOTS="$HOME/project1:$HOME/project2"
ROOTS=(
  "$HOME/.ai-context"
  "$HOME/.claude"
  "$HOME/.gemini"
)
if [ -n "${RESOLVE_EXTRA_ROOTS:-}" ]; then
  IFS=':' read -r -a EXTRA <<< "$RESOLVE_EXTRA_ROOTS"
  ROOTS+=("${EXTRA[@]}")
fi

total=0
kept=0
archived=0

for root in "${ROOTS[@]}"; do
  [ -d "$root" ] || continue

  # Find conflict files
  while IFS= read -r conflict; do
    [ -f "$conflict" ] || continue
    total=$((total + 1))

    # Derive original filename (strip .sync-conflict-TIMESTAMP-DEVICE suffix)
    # Pattern: foo.sync-conflict-20260409-095352-XJJK2UB.json → foo.json
    orig="${conflict%%.sync-conflict-*}.${conflict##*.}"
    # Edge case: if extension repeated, handle
    if [ ! -f "$orig" ]; then
      # Fallback: use sed
      orig=$(echo "$conflict" | sed -E 's/\.sync-conflict-[0-9]{8}-[0-9]{6}-[A-Z0-9]+//')
    fi
    if [ ! -f "$orig" ]; then
      echo "  ? no canonical for: $conflict (skipping)"
      continue
    fi

    # Compare mtimes: keep newer, archive older.
    # Portable stat: GNU (Linux) uses -c %Y; BSD (macOS) uses -f %m.
    mtime() { stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || echo 0; }
    orig_mt=$(mtime "$orig")
    conf_mt=$(mtime "$conflict")

    arc_dir="$root/.sync-conflicts-archive"

    if [ "$conf_mt" -gt "$orig_mt" ]; then
      # Conflict is newer — promote it, archive the original
      echo "+ $conflict is NEWER than $orig"
      if [ "$DRY" = "0" ]; then
        mkdir -p "$arc_dir"
        mv "$orig" "$arc_dir/$(basename "$orig").older.$orig_mt"
        mv "$conflict" "$orig"
      fi
      kept=$((kept + 1))
    else
      # Original is newer — archive the conflict
      echo "- archiving older: $conflict"
      if [ "$DRY" = "0" ]; then
        mkdir -p "$arc_dir"
        mv "$conflict" "$arc_dir/$(basename "$conflict")"
      fi
      archived=$((archived + 1))
    fi
  done < <(find "$root" -name '*.sync-conflict-*' -type f 2>/dev/null)
done

echo
echo "═══ summary ═══"
echo "  total conflicts found: $total"
echo "  conflict promoted (newer): $kept"
echo "  conflict archived (older): $archived"
[ "$DRY" = "1" ] && echo "  (DRY RUN — no changes made)"
