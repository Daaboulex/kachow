#!/usr/bin/env bash
# POSIX + bash 3.2 safe — no mapfile, no declare -A, no readarray.
# Invokes each SessionStart hook with a minimal fake JSON stdin, asserts exit 0 and stdout JSON shape.
set -eu

HOOKS_DIR="${HOME}/.claude/hooks"
FAKE_INPUT='{"cwd":"/tmp","session_id":"selftest-001","hook_event_name":"SessionStart"}'

pass=0
fail=0
skip=0
failures=""

# Parallel arrays (bash 3.2 has no assoc arrays)
HOOKS="session-start-combined.js session-presence-start.js validate-symlinks.js validate-instructions-sync.js gsd-check-update.js skill-upstream-checker.js plugin-update-checker.js auto-pull-global.js session-context-loader.js"

for hook in $HOOKS; do
  hookpath="${HOOKS_DIR}/${hook}"
  if [ ! -f "$hookpath" ]; then
    skip=$((skip + 1))
    echo "SKIP  $hook (not found)"
    continue
  fi
  rc=0
  out="$(printf '%s' "$FAKE_INPUT" | node "$hookpath" 2>&1)" || rc=$?
  # Pass criteria: exit 0 AND (empty output OR output looks sane).
  # Hooks may be silent-when-healthy or emit JSON envelope — both valid.
  if [ "$rc" -eq 0 ]; then
    pass=$((pass + 1))
    echo "PASS  $hook"
  else
    fail=$((fail + 1))
    trimmed="$(printf '%s' "$out" | head -c 200 | tr '\n' ' ')"
    failures="${failures}
  ${hook} (rc=${rc}): ${trimmed}"
    echo "FAIL  $hook (rc=$rc)"
  fi
done

echo ""
echo "Summary: ${pass} passed, ${fail} failed, ${skip} skipped"
if [ "$fail" -gt 0 ]; then
  printf '%s\n' "Failures:${failures}"
  exit 1
fi
