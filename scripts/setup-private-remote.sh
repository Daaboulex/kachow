#!/usr/bin/env bash
# One-time setup: add a private git remote for ~/.ai-context/
# Pick ONE of the options below.

set -euo pipefail
cd "$HOME/.ai-context"

echo "Current remotes:"
git remote -v || echo "  (none)"
echo

cat <<'HINTS'
Three common options for a private ~/.ai-context/ remote:

─── Option A: GitHub private repo ────────────────────────────────
  gh repo create ai-context --private --source=. --remote=origin --push
  # requires `gh auth login` first. Adds GitHub as origin. Private by default.

─── Option B: Self-hosted Gitea / Forgejo ────────────────────────
  git remote add origin git@gitea.yourhost:<your-user>/ai-context.git
  git push -u origin main

─── Option C: Syncthing (no git remote, file-level sync) ─────────
  # Add ~/.ai-context/ to Syncthing, share with other devices.
  # Each device: clone empty dir to get first push, then rely on Syncthing.
  # Works offline, no external server. Git history stays local per-machine.

─── Option D: local bare-repo backup (USB drive / NAS / SSD) ─────
  git remote add backup /path/to/external/repos/ai-context.git  # bare repo
  git push -u backup main
  # Useful as an offline second copy alongside any online remote.

─── Option E: Multiple remotes (local backup + online mirror) ───
  git remote add backup /path/to/external/repos/ai-context.git
  git remote add origin git@github.com:<your-user>/ai-context-private.git
  # Push both on each commit via a sync script, or alias git-push to
  # run "git push backup main && git push origin main".

After adding a remote:
  git push -u <remote-name> main
HINTS

echo
echo "Current branch: $(git branch --show-current || echo main)"
echo "To default to a remote, re-run with REMOTE=<name> env set, or run the commands above manually."
