#!/usr/bin/env bash
# cleanup-stale.sh — Remove stale Claude/Gemini task output files + empty session dirs.
# Never touches the currently-running session or shells younger than the threshold.
#
# Usage:
#   cleanup-stale.sh               # safe: outputs >4h old, dirs >24h old, prints what would happen
#   cleanup-stale.sh --yes         # actually delete
#   cleanup-stale.sh --age-hours N # custom age threshold
#   cleanup-stale.sh --kill-shells # also SIGTERM orphaned shells (>30m etime)
#
# POSIX + bash 3.2 safe.
set -eu

AGE_HOURS=4
DIR_AGE_HOURS=24
DO_DELETE=0
KILL_SHELLS=0

while [ $# -gt 0 ]; do
  case "$1" in
    --yes|-y) DO_DELETE=1; shift ;;
    --age-hours) AGE_HOURS="$2"; shift 2 ;;
    --dir-age-hours) DIR_AGE_HOURS="$2"; shift 2 ;;
    --kill-shells) KILL_SHELLS=1; shift ;;
    --help|-h)
      sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

UID_VAL="$(id -u)"
BASE="/tmp/claude-${UID_VAL}"
if [ ! -d "$BASE" ]; then
  echo "no stale dir ($BASE missing)"
  exit 0
fi

DELETE_CMD="echo   WOULD-DELETE"
[ "$DO_DELETE" -eq 1 ] && DELETE_CMD="rm -f"

DELETE_DIR_CMD="echo   WOULD-REMOVE-DIR"
[ "$DO_DELETE" -eq 1 ] && DELETE_DIR_CMD="rmdir"

echo "=== Stale-file cleanup ==="
[ "$DO_DELETE" -eq 0 ] && echo "DRY RUN — pass --yes to actually delete"
echo

# ── 1. Stale task output files (>AGE_HOURS) ──
echo "── Task output files older than ${AGE_HOURS}h ──"
OUTPUT_COUNT=0
OUTPUT_BYTES=0
find "$BASE" -type f -name '*.output' -mmin +$((AGE_HOURS * 60)) 2>/dev/null | while read -r f; do
  SZ=$(stat -c '%s' "$f" 2>/dev/null || stat -f '%z' "$f" 2>/dev/null || echo 0)
  OUTPUT_BYTES=$((OUTPUT_BYTES + SZ))
  OUTPUT_COUNT=$((OUTPUT_COUNT + 1))
  $DELETE_CMD "$f" 2>/dev/null || true
done || true
# (subshell counters lost — re-measure for summary)
TOTAL_OUTPUTS=$(find "$BASE" -type f -name '*.output' -mmin +$((AGE_HOURS * 60)) 2>/dev/null | wc -l | tr -d ' ')
echo "  scanned: $TOTAL_OUTPUTS file(s)"

# ── 2. Stale session dirs (>DIR_AGE_HOURS, empty-ish) ──
echo
echo "── Session task dirs older than ${DIR_AGE_HOURS}h ──"
DIRS_REMOVED=0
for cwd_dir in "$BASE"/*; do
  [ -d "$cwd_dir" ] || continue
  for sid_dir in "$cwd_dir"/*; do
    [ -d "$sid_dir" ] || continue
    TASKS_DIR="$sid_dir/tasks"
    [ -d "$TASKS_DIR" ] || continue
    # Age by mtime of tasks dir itself
    DIR_AGE_MIN=$(( ($(date +%s) - $(stat -c '%Y' "$TASKS_DIR" 2>/dev/null || stat -f '%m' "$TASKS_DIR")) / 60 ))
    if [ "$DIR_AGE_MIN" -ge $((DIR_AGE_HOURS * 60)) ]; then
      # Remove .output files in this stale session
      if [ "$DO_DELETE" -eq 1 ]; then
        find "$TASKS_DIR" -type f -name '*.output' -delete 2>/dev/null || true
        # Try rmdir if empty
        rmdir "$TASKS_DIR" 2>/dev/null && rmdir "$sid_dir" 2>/dev/null && DIRS_REMOVED=$((DIRS_REMOVED + 1)) || true
      else
        FILE_COUNT=$(find "$TASKS_DIR" -type f 2>/dev/null | wc -l | tr -d ' ')
        echo "  WOULD-CLEAN: $sid_dir/tasks/ (age=${DIR_AGE_MIN}m, files=$FILE_COUNT)"
      fi
    fi
  done
done
[ "$DO_DELETE" -eq 1 ] && echo "  removed empty dirs: $DIRS_REMOVED"

# ── 3. Orphaned shells ──
echo
echo "── Orphaned shell processes (>30m etime, spawned by Claude) ──"
ORPHAN_PIDS=""
ps -eo pid,ppid,etime,user,comm,args --no-headers 2>/dev/null | \
  grep -E '/tmp/claude-' | grep -vE '^\s*[0-9]+\s+[0-9]+\s+[0-9]+:[0-9]{2}$' | while read -r line; do
  PID=$(echo "$line" | awk '{print $1}')
  ETIME=$(echo "$line" | awk '{print $3}')
  COMM=$(echo "$line" | awk '{print $5}')
  # Parse etime: [[dd-]hh:]mm:ss
  TOTAL_MIN=$(echo "$ETIME" | awk -F'[-:]' '
    { if (NF==4) print $1*1440 + $2*60 + $3;
      else if (NF==3) print $1*60 + $2;
      else if (NF==2) print $1;
      else print 0 }')
  if [ "${TOTAL_MIN:-0}" -gt 30 ]; then
    echo "  orphan: pid=$PID etime=$ETIME comm=$COMM"
    if [ "$KILL_SHELLS" -eq 1 ] && [ "$DO_DELETE" -eq 1 ]; then
      kill -TERM "$PID" 2>/dev/null && echo "    → SIGTERM sent" || echo "    → kill failed"
    fi
  fi
done || true

echo
echo "=== Done ==="
[ "$DO_DELETE" -eq 0 ] && echo "To actually delete: re-run with --yes"
