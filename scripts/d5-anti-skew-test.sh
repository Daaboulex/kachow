#!/usr/bin/env bash
# d5-anti-skew-test.sh — Discovery D5
# Verifies anti-skew rules from MASTER § 6.
# Read-only test; produces report on stdout. Exit 0 if all PASS, 1 otherwise.

set -u
HOST=$(hostname)
TS=$(date -Iseconds)
RESULTS=()

echo "# D5 Anti-Skew Test Report"
echo "Host: $HOST | Date: $TS"
echo ""

# Sub-test 2: Rule 1 + 5 — capture session-context-loader output, grep for leak strings.
echo "## Sub-test 2 — Rule 1 (side-channel) + Rule 5 (facts only)"
SLM_OUT=$(mktemp)
echo '{"session_id":"d5-test","cwd":"/tmp"}' | node ~/.claude/hooks/session-context-loader.js > "$SLM_OUT" 2>&1 || true
LEAK1=$(grep -iE "peer agent|session.*active|lock.*held|conflict.*possible" "$SLM_OUT" || true)
LEAK2=$(grep -iE "you should|recommend|suggest|consider|wait|hold off" "$SLM_OUT" || true)
if [[ -n "$LEAK1" || -n "$LEAK2" ]]; then
  echo "  FAIL — leak detected:"
  [[ -n "$LEAK1" ]] && echo "    Rule 1: $LEAK1"
  [[ -n "$LEAK2" ]] && echo "    Rule 5: $LEAK2"
  RESULTS+=("FAIL:rule1+5")
else
  echo "  PASS"
  RESULTS+=("PASS:rule1+5")
fi
rm -f "$SLM_OUT"

# Sub-tests 3+4 require 2 live sessions — MANUAL procedure
echo ""
echo "## Sub-test 3 — Rule 2 (boundary-gated PreToolUse) — MANUAL"
echo "  PROCEDURE: open 2 terminals, both edit /tmp/test-overlap.txt"
echo "  Verify: lock surfaces in permission UI, NOT in model context"
RESULTS+=("MANUAL:rule2")

echo ""
echo "## Sub-test 4 — Rule 3 (path-scoped) — MANUAL"
echo "  PROCEDURE: session A edits /tmp/test-A.txt, session B edits /tmp/test-B.txt"
echo "  Verify: no spurious cross-path lock surface"
RESULTS+=("MANUAL:rule3")

# Sub-test 5: Rule 4 (TTL + heartbeat) — inspect session-presence-track.js
echo ""
echo "## Sub-test 5 — Rule 4 (TTL + heartbeat)"
TTL_GREP=$(grep -nE "5.?min|300.?000|expire|stale|TTL|ttl|STALE" ~/.claude/hooks/session-presence-track.js 2>/dev/null || true)
if [[ -n "$TTL_GREP" ]]; then
  echo "  PASS-MAYBE — TTL-related code present:"
  echo "$TTL_GREP" | sed 's/^/    /'
  RESULTS+=("PASS-MAYBE:rule4")
else
  echo "  FAIL — no TTL logic found in session-presence-track.js"
  RESULTS+=("FAIL:rule4")
fi

echo ""
echo "## Summary"
printf '%s\n' "${RESULTS[@]}"

if printf '%s\n' "${RESULTS[@]}" | grep -q '^FAIL:'; then
  exit 1
else
  exit 0
fi
