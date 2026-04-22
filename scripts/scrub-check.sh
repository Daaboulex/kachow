#!/usr/bin/env bash
# scrub-check.sh — Pre-push gate for kachow public repo.
# Scans for personal tokens (ident, project names, paths, emails) outside
# permitted doc files. Matches the same pattern the CI scrub-gate uses, so
# local == CI behavior.
#
# Usage:
#   scrub-check.sh            # scan + report hits (exits 1 if any)
#   scrub-check.sh --quiet    # no banner; output only hits
#   scrub-check.sh --list     # show what the token list is (no repo scan)
#
# Designed to be callable from a pre-push git hook.
# POSIX + bash 3.2 safe.
set -eu

QUIET=0
LIST_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --quiet|-q) QUIET=1; shift ;;
    --list) LIST_ONLY=1; shift ;;
    --help|-h) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# Assemble token list from parts so this file itself doesn't match.
tokens=()
tokens+=("$(printf 'f%sa%sh%sl%sk%se' '' '' '' '' '')")             # ident-lower
tokens+=("$(printf 'F%sa%sh%sl%sk%se' '' '' '' '' '')")             # ident-cap
tokens+=("$(printf 'D%sa%sa%sb%so%su%sl%se%sx' '' '' '' '' '' '' '')") # ident2
tokens+=("$(printf 'P%so%sr%st%sa%sb%sl%se%s-%sB%su%si%sl%sd%se%sr' '' '' '' '' '' '' '' '' '' '' '' '' '' '' '')") # proj
tokens+=("$(printf '/%sh%so%sm%se%s/%su%ss%se%sr' '' '' '' '' '' '' '' '' '')") # abs-home linux
tokens+=("$(printf '/%sU%ss%se%sr%ss%s/' '' '' '' '' '' '')")       # abs-home macOS prefix
tokens+=("$(printf 'k%si%sp%sp%se%sr%s_%se%sl%si%sx%si%sr%ss' '' '' '' '' '' '' '' '' '' '' '' '' '')") # email-local
tokens+=("$(printf 'm%sa%sc%sb%so%so%sk%s-%sp%sr%so%s-%s9%s-%s2' '' '' '' '' '' '' '' '' '' '' '' '' '' '')") # host1
tokens+=("$(printf 'r%sy%sz%se%sn%s-%s9%s9%s5%s0%sx%s3%sd' '' '' '' '' '' '' '' '' '' '' '' '')") # host2
tokens+=("$(printf 'F%sC%sS%sE%s0%s1' '' '' '' '' '')")             # host3
tokens+=("$(printf 'L%sa%sC%si%se' '' '' '' '')")                   # drive brand
tokens+=("$(printf 'S%st%se%sp%sh%sa%sn' '' '' '' '' '' '')")       # other-name

PATTERN=$(IFS='|'; echo "${tokens[*]}")

if [ "$LIST_ONLY" -eq 1 ]; then
  echo "Token list (assembled from parts):"
  for t in "${tokens[@]}"; do echo "  $t"; done
  exit 0
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

[ "$QUIET" -eq 0 ] && echo "=== scrub-check: $REPO_ROOT ==="

HITS=$(grep -rn -E "$PATTERN" . \
  --include='*.md' --include='*.js' --include='*.json' \
  --include='*.sh' --include='*.ps1' --include='*.yml' --include='*.yaml' \
  2>/dev/null \
  | grep -v '^\./\.git/' \
  | grep -v '/docs/' \
  | grep -v '\.example\b' \
  | grep -v '^\./README\.md' \
  | grep -v '^\./LICENSE' \
  | grep -v '^\./CONTRIBUTING\.md' \
  | grep -v '^\./SECURITY\.md' \
  | grep -v '^\./CHANGELOG\.md' \
  | grep -v '^\./\.github/workflows/ci\.yml' \
  | grep -v '^\./scripts/scrub-check\.sh' \
  || true)

if [ -n "$HITS" ]; then
  echo "⚠ personal tokens detected:"
  echo "$HITS"
  exit 1
fi

[ "$QUIET" -eq 0 ] && echo "✓ scrub-check clean"
exit 0
