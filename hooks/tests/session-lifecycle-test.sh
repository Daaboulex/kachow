#!/usr/bin/env bash
# Simulates full Claude Code session lifecycle: SessionStart chain + Stop chain.
# Bash 3.2 safe (macOS /bin/bash). No associative arrays, no mapfile, no readarray.
# Verifies hooks survive fake-input without real stdin/tool-call context.
set -eu

TMPBASE="${TMPDIR:-/tmp}"
WORK="$(mktemp -d "${TMPBASE}/claude-lifecycle-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# Build minimal canonical dir so presence hooks find something
mkdir -p "$WORK/.claude" "$WORK/.ai-context/memory"
printf '# Memory Index — test\n\n## Project\n' > "$WORK/.ai-context/memory/MEMORY.md"

SESSION="lifecycle-$$"
BASE="{\"cwd\":\"${WORK}\",\"session_id\":\"${SESSION}\"}"

emit() {
  EVENT="$1"
  HOOK="$2"
  INPUT="$(printf '%s' "$BASE" | sed 's/}$/,"hook_event_name":"'"$EVENT"'"}/')"
  rc=0
  out="$(printf '%s' "$INPUT" | node "$HOME/.claude/hooks/$HOOK" 2>&1)" || rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "OK    $EVENT → $HOOK"
  else
    echo "FAIL  $EVENT → $HOOK (rc=$rc): $(printf '%s' "$out" | head -c 150)"
    exit 1
  fi
}

echo "--- SessionStart chain ---"
emit SessionStart session-start-combined.js
emit SessionStart session-presence-start.js
emit SessionStart session-context-loader.js
emit SessionStart validate-instructions-sync.js

echo ""
echo "--- PostToolUse chain ---"
TOOL_INPUT="{\"cwd\":\"${WORK}\",\"session_id\":\"${SESSION}\",\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"${WORK}/.claude/test.md\"}}"
rc=0; out="$(printf '%s' "$TOOL_INPUT" | node "$HOME/.claude/hooks/session-presence-track.js" 2>&1)" || rc=$?
[ "$rc" -eq 0 ] && echo "OK    PostToolUse → session-presence-track.js" || { echo "FAIL  session-presence-track.js (rc=$rc)"; exit 1; }

echo ""
echo "--- Stop chain ---"
emit Stop session-presence-end.js
emit Stop reflect-stop.js
emit Stop todowrite-persist.js
emit Stop memory-rotate.js

echo ""
echo "--- PreCompact chain ---"
emit PreCompact reflect-precompact.js

echo ""
echo "All lifecycle hooks survived fake input. Workspace at ${WORK} will be removed."
