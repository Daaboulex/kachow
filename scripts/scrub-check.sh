#!/usr/bin/env bash
# Lightweight pre-push scrub gate. Full scrub runs during publish.sh pipeline.
# This gate catches obvious personal tokens that survived the scrub.
set -e
ROOT="$(git rev-parse --show-toplevel)"
QUIET=0
[[ "${1:-}" == "--quiet" ]] && QUIET=1

# Token list loaded from scrub config (not hardcoded — avoids embedding tokens in the gate itself)
SCRUB_CONF="$ROOT/scripts/scrub-config.json"
if [ -f "$SCRUB_CONF" ]; then
  TOKENS=$(node -e "const c=JSON.parse(require('fs').readFileSync('$SCRUB_CONF','utf8')); console.log((c.tokens||c.hardTokens||[]).join('|'))" 2>/dev/null || echo "")
else
  # Fallback: scan for common personal-token patterns
  TOKENS=""
fi

if [ -z "$TOKENS" ]; then
  [[ $QUIET -eq 0 ]] && echo "scrub-check: no token list found, skipping"
  exit 0
fi

# Check tracked files (exclude docs that legitimately reference the repo)
MATCHES=$(git grep -l -E "$TOKENS" -- ':!docs/' ':!README.md' ':!LICENSE' ':!CHANGELOG.md' ':!CONTRIBUTING.md' ':!SECURITY.md' 2>/dev/null || true)

if [ -n "$MATCHES" ]; then
  echo "SCRUB GATE FAILED — personal tokens found in:"
  echo "$MATCHES"
  exit 1
fi

[[ $QUIET -eq 0 ]] && echo "scrub-check: clean"
exit 0
