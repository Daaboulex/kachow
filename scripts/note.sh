#!/usr/bin/env bash
# note.sh — Append a timestamped note to the active handoff or AI-tasks.
#
# Usage:
#   note.sh "text of note"                 # appends to active .session-handoff.md in cwd
#   note.sh --task <id> "text"             # appends to tasks[n].notes in AI-tasks.json
#   note.sh --handoff <path> "text"        # appends to specific handoff file
#   note.sh --list                         # lists recent notes
#
# POSIX + bash 3.2 safe.
set -eu

ACTION="handoff"
TARGET=""
TEXT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --task)    ACTION="task"; TARGET="$2"; shift 2 ;;
    --handoff) ACTION="handoff"; TARGET="$2"; shift 2 ;;
    --list)    ACTION="list"; shift ;;
    --help|-h)
      sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      TEXT="${TEXT}${TEXT:+ }$1"; shift ;;
  esac
done

TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
CWD="$(pwd)"

case "$ACTION" in
  list)
    # List recent notes from active handoff
    for candidate in "$CWD/.session-handoff.md" "$CWD/.claude/.session-handoff.md" "$CWD/.ai-context/.session-handoff.md" "$HOME/.claude/.session-handoff.md"; do
      if [ -f "$candidate" ]; then
        echo "=== $candidate ==="
        grep -nE '^> \[note [0-9TZ:-]+\]' "$candidate" 2>/dev/null | tail -10 || echo "  (no notes yet)"
        break
      fi
    done
    exit 0
    ;;

  handoff)
    if [ -z "$TEXT" ]; then
      echo "error: no note text provided" >&2
      exit 2
    fi
    HANDOFF=""
    if [ -n "$TARGET" ]; then
      HANDOFF="$TARGET"
    else
      for candidate in "$CWD/.session-handoff.md" "$CWD/.claude/.session-handoff.md" "$CWD/.ai-context/.session-handoff.md" "$HOME/.claude/.session-handoff.md"; do
        if [ -f "$candidate" ]; then HANDOFF="$candidate"; break; fi
      done
    fi
    if [ -z "$HANDOFF" ]; then
      HANDOFF="$CWD/.session-handoff.md"
      echo "# Handoff (created $TS)" > "$HANDOFF"
      echo "" >> "$HANDOFF"
      echo "## Notes" >> "$HANDOFF"
      echo "" >> "$HANDOFF"
    fi
    # Ensure ## Notes section exists
    if ! grep -qE '^## Notes' "$HANDOFF"; then
      printf '\n\n## Notes\n\n' >> "$HANDOFF"
    fi
    # Append blockquote-style note
    printf '\n> [note %s] %s\n' "$TS" "$TEXT" >> "$HANDOFF"
    echo "✓ note appended to $HANDOFF"
    ;;

  task)
    if [ -z "$TEXT" ]; then
      echo "error: no note text provided" >&2
      exit 2
    fi
    # Find AI-tasks.json (walk up)
    FIND_DIR="$CWD"
    TASKS=""
    while [ "$FIND_DIR" != "/" ]; do
      for candidate in "$FIND_DIR/AI-tasks.json" "$FIND_DIR/.claude/AI-tasks.json" "$FIND_DIR/.ai-context/AI-tasks.json"; do
        if [ -f "$candidate" ]; then TASKS="$candidate"; break 2; fi
      done
      FIND_DIR="$(dirname "$FIND_DIR")"
    done
    if [ -z "$TASKS" ]; then
      echo "error: no AI-tasks.json found walking up from $CWD" >&2
      exit 3
    fi
    node - "$TASKS" "$TARGET" "$TEXT" "$TS" <<'NODE_EOF'
const fs = require('fs');
const [file, id, text, ts] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const tasks = data.tasks || [];
const task = tasks.find(t => String(t.id) === id || t.subject === id);
if (!task) {
  process.stderr.write(`no task matched id/subject "${id}"\n`);
  process.exit(4);
}
task.notes = task.notes || [];
task.notes.push({ ts, text });
fs.writeFileSync(file, JSON.stringify(data, null, 2));
process.stdout.write(`✓ note appended to task "${task.subject || task.id}" (${task.notes.length} notes)\n`);
NODE_EOF
    ;;
esac
