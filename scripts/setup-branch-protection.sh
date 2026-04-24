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

gh api -X PUT "repos/${REPO}/branches/main/protection" \
  -f required_status_checks.strict=true \
  -f required_status_checks.contexts[]='test (ubuntu-latest)' \
  -f required_status_checks.contexts[]='test (macos-latest)' \
  -f required_status_checks.contexts[]='test (windows-latest)' \
  -f enforce_admins=false \
  -f required_pull_request_reviews.required_approving_review_count=0 \
  -F restrictions=null \
  -f allow_force_pushes=false \
  -f allow_deletions=false \
  -f required_linear_history=true \
  -f required_conversation_resolution=true

echo "Branch protection applied. Verify at https://github.com/${REPO}/settings/branches"
