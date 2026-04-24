#!/usr/bin/env bash
# setup-branch-protection.sh
# Idempotent: applies branch protection to the kachow main branch.
# Run once after repo creation; safe to re-run.
#
# Usage: ./scripts/setup-branch-protection.sh OWNER/REPO
#   Example: ./scripts/setup-branch-protection.sh myname/kachow

set -euo pipefail

REPO="${1:-}"

if [ -z "$REPO" ]; then
  echo "Usage: $0 OWNER/REPO" >&2
  echo "Example: $0 myname/kachow" >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI required" >&2
  exit 1
fi

echo "Applying branch protection to ${REPO}/main..."

# gh CLI typing: -f sends strings, -F sends typed (bool/int/null) values.
# GitHub's branch-protection API rejects string "true" for boolean fields.
gh api -X PUT "repos/${REPO}/branches/main/protection" \
  --input - <<JSON
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "test (ubuntu-latest)",
      "test (macos-latest)",
      "test (windows-latest)"
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0,
    "dismiss_stale_reviews": false,
    "require_code_owner_reviews": false
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_linear_history": true,
  "required_conversation_resolution": true
}
JSON

echo "Branch protection applied. Verify at https://github.com/${REPO}/settings/branches"
