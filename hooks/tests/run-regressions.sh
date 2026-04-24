#!/usr/bin/env bash
# run-regressions.sh — Exercises known-bug-class fixtures.
# Every fixture here represents a bug that was shipped + fixed.
# If a regression fixture fails, a class of bug has returned.
#
# POSIX + bash 3.2 safe.
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOKS_DIR="$(dirname "$SCRIPT_DIR")"
CLAUDE_HOOKS="${CLAUDE_HOOKS:-$HOOKS_DIR}"

PASS=0
FAIL=0
FAILURES=""

record_pass() { PASS=$((PASS + 1)); echo "  ✓ $1"; }
record_fail() {
  FAIL=$((FAIL + 1))
  FAILURES="${FAILURES}
  ✗ $1: $2"
  echo "  ✗ $1: $2"
}

# ═══════════════════════════════════════════════════════════
# 1. managed-only-key-blocks — strictKnownMarketplaces BLOCKED at write-time
# ═══════════════════════════════════════════════════════════
echo "─── managed-only-key-blocks ───"
HOOK="$CLAUDE_HOOKS/validate-settings-on-write.js"
if [ -f "$HOOK" ]; then
  INPUT='{"tool_name":"Write","tool_input":{"file_path":"/home/x/.claude/settings.json","content":"{\"strictKnownMarketplaces\":true}"}}'
  OUT=$(printf '%s' "$INPUT" | node "$HOOK" 2>&1)
  if echo "$OUT" | grep -q '"decision":"block"' && echo "$OUT" | grep -qi 'managed'; then
    record_pass "managed-only key BLOCKED with clear reason"
  else
    record_fail "managed-only-key-blocks" "expected block+managed, got: $(echo "$OUT" | head -c 120)"
  fi
else
  record_fail "managed-only-key-blocks" "hook missing: $HOOK"
fi

# ═══════════════════════════════════════════════════════════
# 2. cleanup-period-zero — cleanupPeriodDays=0 BLOCKED
# ═══════════════════════════════════════════════════════════
echo "─── cleanup-period-zero ───"
if [ -f "$HOOK" ]; then
  INPUT='{"tool_name":"Write","tool_input":{"file_path":"/home/x/.claude/settings.json","content":"{\"cleanupPeriodDays\":0}"}}'
  OUT=$(printf '%s' "$INPUT" | node "$HOOK" 2>&1)
  if echo "$OUT" | grep -q '"decision":"block"' && echo "$OUT" | grep -qi 'cleanupPeriodDays is 0'; then
    record_pass "cleanupPeriodDays=0 BLOCKED"
  else
    record_fail "cleanup-period-zero" "expected block, got: $(echo "$OUT" | head -c 120)"
  fi
fi

# ═══════════════════════════════════════════════════════════
# 3. valid-settings-passes — clean payload passes through
# ═══════════════════════════════════════════════════════════
echo "─── valid-settings-passes ───"
if [ -f "$HOOK" ]; then
  INPUT='{"tool_name":"Write","tool_input":{"file_path":"/home/x/.claude/settings.json","content":"{\"cleanupPeriodDays\":90}"}}'
  OUT=$(printf '%s' "$INPUT" | node "$HOOK" 2>&1)
  if echo "$OUT" | grep -q '"continue":true' && ! echo "$OUT" | grep -q '"decision":"block"'; then
    record_pass "valid settings pass through"
  else
    record_fail "valid-settings-passes" "unexpected: $(echo "$OUT" | head -c 120)"
  fi
fi

# ═══════════════════════════════════════════════════════════
# 4. handoff-partial — 2/5 checkbox returns pct=40
# ═══════════════════════════════════════════════════════════
echo "─── handoff-partial-progress ───"
LIB="$CLAUDE_HOOKS/lib/handoff-progress.js"
if [ -f "$LIB" ]; then
  TMPFILE=$(mktemp)
  printf -- '- [x] a\n- [x] b\n- [ ] c\n- [ ] d\n- [ ] e\n' > "$TMPFILE"
  OUT=$(node "$LIB" "$TMPFILE" 2>&1)
  rm -f "$TMPFILE"
  if echo "$OUT" | grep -q '"pct": 40'; then
    record_pass "partial handoff computes 40%"
  else
    record_fail "handoff-partial-progress" "expected pct:40, got: $(echo "$OUT" | head -c 120)"
  fi
else
  record_fail "handoff-partial-progress" "lib missing: $LIB"
fi

# ═══════════════════════════════════════════════════════════
# 5. scrub-gate-catches-leak — stage file with personal token
# ═══════════════════════════════════════════════════════════
echo "─── scrub-gate-catches-leak ───"
SCRUB="$(dirname "$CLAUDE_HOOKS")/scripts/scrub-check.sh"
if [ ! -f "$SCRUB" ]; then
  SCRUB="$CLAUDE_HOOKS/../scripts/scrub-check.sh"
fi
if [ -x "$SCRUB" ]; then
  # Create isolated git-less test dir with a leak
  TESTDIR=$(mktemp -d)
  mkdir -p "$TESTDIR/scripts"
  cp "$SCRUB" "$TESTDIR/scripts/scrub-check.sh"
  # shellcheck disable=SC2016
  printf 'console.log("hello f%sa%sh%sl%sk%se");\n' '' '' '' '' '' > "$TESTDIR/leak.js"
  cd "$TESTDIR" || exit 1
  if "$TESTDIR/scripts/scrub-check.sh" --quiet 2>&1 | grep -qE 'personal tokens (detected|in file content)'; then
    record_pass "scrub-check catches injected leak"
  else
    record_fail "scrub-gate-catches-leak" "expected detection, got no hit"
  fi
  cd - >/dev/null || true
  rm -rf "$TESTDIR"
else
  echo "  ○ scrub-check.sh not present in this repo — SKIP (expected in kachow)"
fi

# ═══════════════════════════════════════════════════════════
# 6. scrub-gate-clean-pass — scan a clean repo
# ═══════════════════════════════════════════════════════════
echo "─── scrub-gate-clean-pass ───"
if [ -x "$SCRUB" ]; then
  TESTDIR=$(mktemp -d)
  mkdir -p "$TESTDIR/scripts"
  cp "$SCRUB" "$TESTDIR/scripts/scrub-check.sh"
  echo 'console.log("just plain code");' > "$TESTDIR/clean.js"
  cd "$TESTDIR" || exit 1
  if "$TESTDIR/scripts/scrub-check.sh" --quiet 2>&1 >/dev/null; then
    record_pass "scrub-check clean passes"
  else
    record_fail "scrub-gate-clean-pass" "unexpected failure on clean tree"
  fi
  cd - >/dev/null || true
  rm -rf "$TESTDIR"
fi

# ═══════════════════════════════════════════════════════════
# 7. stale-dir-detection — create mock stale dir, expect detection
# ═══════════════════════════════════════════════════════════
echo "─── stale-dir-detection ───"
STALE="$CLAUDE_HOOKS/lib/stale-process-detector.js"
if [ -f "$STALE" ]; then
  UID_VAL="$(id -u)"
  MOCK_BASE="/tmp/claude-${UID_VAL}"
  MOCK_DIR="$MOCK_BASE/regression-test-cwd/regression-test-sid/tasks"
  mkdir -p "$MOCK_DIR"
  echo "old output" > "$MOCK_DIR/hook_999999.output"
  # Backdate by 48h
  touch -d "48 hours ago" "$MOCK_DIR/hook_999999.output" 2>/dev/null || \
    touch -t "$(date -v -48H +%Y%m%d%H%M)" "$MOCK_DIR/hook_999999.output" 2>/dev/null || true
  touch -d "48 hours ago" "$MOCK_DIR" 2>/dev/null || true
  OUT=$(node "$STALE" --json 2>&1)
  # Clean up fixture FIRST so cleanup-stale doesn't see it on next run
  rm -rf "$MOCK_BASE/regression-test-cwd"
  if echo "$OUT" | grep -q 'regression-test-sid'; then
    record_pass "stale-detector finds mock stale dir"
  else
    record_fail "stale-dir-detection" "did not find mock dir (check touch -d support)"
  fi
fi

# ═══════════════════════════════════════════════════════════
# 8. interaction-map-sanitize — /home/USER becomes ~
# ═══════════════════════════════════════════════════════════
echo "─── interaction-map-sanitize ───"
MAP="$CLAUDE_HOOKS/lib/hook-interaction-map.js"
if [ -f "$MAP" ]; then
  OUT=$(node "$MAP" 2>&1 | head -5)
  # Assemble the "leaked path" pattern from parts so this file itself doesn't match.
  LEAK_PAT="$(printf '/%sh%so%sm%se%s/' '' '' '' '' '')[a-z]+/|$(printf '/%sU%ss%se%sr%ss%s/' '' '' '' '' '' '')[a-z]+/"
  if ! echo "$OUT" | grep -qE "$LEAK_PAT"; then
    record_pass "interaction-map output sanitized"
  else
    record_fail "interaction-map-sanitize" "user path leaked: $(echo "$OUT" | head -c 120)"
  fi
fi

# ═══════════════════════════════════════════════════════════
# Report
# ═══════════════════════════════════════════════════════════
echo ""
echo "═══ Regression summary ═══"
echo "$PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  echo ""
  printf 'Failures:%s\n' "$FAILURES"
  exit 1
fi
