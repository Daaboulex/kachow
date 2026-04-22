#!/usr/bin/env bash
# self-update.sh — pull latest kachow from upstream, preserve USER SECTION, re-bootstrap.
#
# Safe for users maintaining a fork of [owner]/kachow (or any fork of this repo):
#   1. Fetch origin + show incoming commits
#   2. Verify working tree clean (aborts if dirty — you review first)
#   3. Preserve AGENTS.md `USER SECTION` block across the merge
#   4. Merge (fast-forward if possible; rebase if --rebase passed)
#   5. Run bootstrap.sh so new hooks/adapters are wired in
#   6. Print CHANGELOG diff
#
# Usage:
#   self-update.sh                    # show incoming + merge + bootstrap
#   self-update.sh --dry-run          # show incoming only, no writes
#   self-update.sh --rebase           # rebase instead of merge (linear history)
#   self-update.sh --no-bootstrap     # merge but skip re-running bootstrap
#
# Exit:
#   0 — up to date (or successfully updated)
#   1 — merge conflict or dirty tree (you resolve manually)

set -euo pipefail

AI_CONTEXT="${AI_CONTEXT:-$HOME/.ai-context}"
DRY=0
REBASE=0
BOOTSTRAP=1

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)      DRY=1; shift ;;
    --rebase)       REBASE=1; shift ;;
    --no-bootstrap) BOOTSTRAP=0; shift ;;
    -h|--help)      sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

cd "$AI_CONTEXT"
[ -d .git ] || { echo "ERROR: $AI_CONTEXT is not a git repo." >&2; exit 1; }

echo "── self-update: $AI_CONTEXT ──"
echo

# ── 1. Fetch + show incoming ────────────────────────────────────────────
git fetch origin --tags 2>&1 | sed 's/^/  /'

branch=$(git branch --show-current)
[ -z "$branch" ] && branch=main

upstream="origin/$branch"
if ! git rev-parse "$upstream" >/dev/null 2>&1; then
  echo "ERROR: no $upstream branch on origin — set remote first." >&2
  exit 1
fi

ahead=$(git rev-list --count "$upstream..$branch")
behind=$(git rev-list --count "$branch..$upstream")

if [ "$behind" -eq 0 ]; then
  echo "✓ already up to date (local=$branch upstream=$upstream)"
  if [ "$ahead" -gt 0 ]; then
    echo "  note: you have $ahead local commits not on upstream"
  fi
  exit 0
fi

echo "incoming: $behind commit(s) on $upstream"
echo "your local: $ahead commit(s) ahead"
echo
echo "── changelog since your HEAD ──"
git log --oneline --no-decorate "$branch..$upstream" | head -20
echo

if [ "$DRY" = "1" ]; then
  echo "(dry-run — nothing written)"
  exit 0
fi

# ── 2. Working tree clean check ─────────────────────────────────────────
if [ -n "$(git status --porcelain)" ]; then
  echo "✗ working tree has uncommitted changes — commit or stash them, then re-run." >&2
  echo "  (refusing to auto-merge into a dirty tree)" >&2
  exit 1
fi

# ── 3. Preserve AGENTS.md USER SECTION ──────────────────────────────────
# Extract the block between USER SECTION markers so a conflicting upstream change
# can't clobber your personal edits. After the merge we re-inject it.
user_section=""
if [ -f AGENTS.md ] && grep -q 'USER SECTION — keep' AGENTS.md; then
  user_section=$(awk '
    /USER SECTION — keep/ { inside=1; next }
    /END USER SECTION/    { inside=0; next }
    inside { print }
  ' AGENTS.md)
  echo "✓ captured USER SECTION ($(printf '%s' "$user_section" | wc -l | tr -d ' ') line(s))"
fi

# ── 4. Merge or rebase ──────────────────────────────────────────────────
if [ "$REBASE" = "1" ]; then
  echo "── rebasing onto $upstream ──"
  if ! git rebase "$upstream"; then
    echo "✗ rebase failed — resolve conflicts, then 'git rebase --continue' or '--abort'" >&2
    exit 1
  fi
else
  echo "── merging $upstream ──"
  if ! git merge --ff --no-edit "$upstream"; then
    echo "✗ merge failed — resolve conflicts manually, then re-run bootstrap" >&2
    exit 1
  fi
fi

# ── 5. Re-inject USER SECTION if the merge changed AGENTS.md ────────────
if [ -n "$user_section" ] && [ -f AGENTS.md ]; then
  tmp=$(mktemp)
  awk -v block="$user_section" '
    /USER SECTION — keep/ {
      print
      print ""
      print block
      inside = 1
      next
    }
    /END USER SECTION/ { inside = 0; print; next }
    !inside { print }
  ' AGENTS.md > "$tmp"
  if ! diff -q "$tmp" AGENTS.md >/dev/null 2>&1; then
    mv "$tmp" AGENTS.md
    git add AGENTS.md
    git -c user.email=self-update@localhost -c user.name=self-update \
      commit --no-gpg-sign -q -m "chore: restore USER SECTION after self-update"
    echo "✓ USER SECTION restored"
  else
    rm -f "$tmp"
    echo "✓ USER SECTION unchanged after merge"
  fi
fi

# ── 6. Re-run bootstrap so new hooks / adapters are installed ──────────
if [ "$BOOTSTRAP" = "1" ]; then
  echo
  echo "── re-running bootstrap.sh ──"
  bash "$AI_CONTEXT/scripts/bootstrap.sh"
fi

# ── 7. Show CHANGELOG diff so you know what changed ─────────────────────
echo
echo "── CHANGELOG entries added ──"
if [ -f CHANGELOG.md ]; then
  git log -p "$branch@{1}..$branch" -- CHANGELOG.md 2>/dev/null \
    | grep '^+' | grep -v '^+++' | head -30 || echo "  (no CHANGELOG changes)"
fi

echo
echo "✓ self-update complete — now at $(git log -1 --format='%h %s')"
