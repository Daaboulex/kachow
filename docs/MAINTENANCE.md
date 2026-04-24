# Maintaining your fork

This doc answers two questions every new maintainer asks after the first `bootstrap.sh`:

1. **Where does each piece live, and why?**
2. **When I work on machine X, what happens where?**

## The three canonical dirs

Configuration is deliberately split across three per-user directories. They have different git-remote and sync characteristics on purpose.

| Dir | Owns | Git remote | Cross-machine sync |
|---|---|---|---|
| `~/.ai-context/` | `AGENTS.md`, `memory/`, `skills/`, `mcp/`, `scripts/`, `VERSION` | **Your choice.** Syncthing, private git, or nothing. | User decides — `scripts/setup-private-remote.sh` lists the common options. |
| `~/.claude/` | Claude Code: `hooks/`, `commands/`, `settings.json`, `.notifications.jsonl` | Typically a private GitHub repo (`<you>/claude-global`). | Automatic via the `auto-push-global.js` Stop hook. |
| `~/.gemini/` | Gemini CLI: `hooks/`, `commands/`, `settings.json` | Typically a private GitHub repo (`<you>/gemini-global`). | Same — `auto-push-global.js` covers both. |

Two practical consequences:

- **Hooks master lives in `~/.claude/hooks/`**, not in `~/.ai-context/`. A small subset is mirrored to `~/.gemini/hooks/` by the same hook that pushes the repos.
- **`~/.ai-context/` has no auto-push by default.** It's intentionally quiet because many users sync it via Syncthing or leave it local-only. Enable auto-commit by setting `AI_CONTEXT_AUTOCOMMIT=1`; enable auto-push (requires a remote) with `AI_CONTEXT_AUTOPUSH=1`.

## Trigger matrix — what runs when

Every Stop hook runs in a known order (see `settings.template.json → hooks.Stop`). The relevant ones for maintenance:

| Hook | Scope | What it does | Cooldown |
|---|---|---|---|
| `auto-push-global` | `~/.claude/` + `~/.gemini/` (+ `~/.ai-context/` opt-in) | Commits locally always; pushes every 5 min or when commits pile up. | 5 min (push only) |

Upstream framework maintainers typically also run a private mirror hook that scrubs `~/.ai-context/` + `~/.claude/` + `~/.gemini/` into a separate release tree, deep-verifies the output, and pushes to the public repo on a cooldown. That hook is **not shipped in the public framework** — every maintainer's publishing tree is personal. The public framework ships `scripts/scrub-check.sh` as the fast pre-push gate; publish manually with `bump-version` + `scrub-check` + `git push` as covered below.

## Machine scenarios

### Primary (where you maintain the framework)

Day-to-day edits of `AGENTS.md`, hooks, or skills. Most of it is automatic:

1. You edit a file.
2. Session ends (Stop hook chain fires).
3. `auto-push-global` commits `~/.claude/` + `~/.gemini/` and pushes them to your private repos.
4. When you want to publish a framework release, run the scrub + bump + push steps manually (see *Publishing releases* below).

### Secondary machine (another personal install)

Your second machine pulls two things on startup:

- **Claude/Gemini state**: `auto-pull-global.js` (SessionStart hook) fetches `~/.claude/` and `~/.gemini/` from your private repos. Identical hook set everywhere.
- **`~/.ai-context/`**: either Syncthing keeps it current, or you `git pull` your private remote manually. No hook does this by default.

### Windows work machine (consumer-only)

If the Windows box is just using the framework and not maintaining it:

1. `git clone https://github.com/<you>/<public-framework> %USERPROFILE%\.ai-context`
2. `pwsh scripts\customize.ps1` — fills in name/email, picks which tools to wire.
3. `pwsh scripts\bootstrap.ps1` — installs adapters, MCP, normalizes `$HOME` in settings.
4. Done. Personal memory stays on this machine only; the framework auto-updates by re-running bootstrap after `git pull`.

If Developer Mode is off, symlinks fall back to plain file copies — you just have to re-run `bootstrap.ps1` after canonical edits. Instructions for enabling Developer Mode are printed by the script.

### Publishing releases

The shipped release helpers are:

- `scripts/bump-version.sh` / `scripts/bump-version.ps1` — semver bump from Conventional Commits; writes `VERSION` + updates `CHANGELOG.md`.
- `scripts/scrub-check.sh` — fast pre-push scrub verifier; install as `.git/hooks/pre-push` for automatic enforcement.

Typical release flow (cross-platform):

```bash
bash scripts/bump-version.sh          # or .ps1 on Windows
bash scripts/scrub-check.sh           # fails loud on hard findings
git add VERSION CHANGELOG.md
git commit -m "release: $(cat VERSION)"
git tag "v$(cat VERSION)"
git push --follow-tags origin main
```

A Node-native single-command publish pipeline is on the roadmap.

## Offline and conflict handling

- Offline commit: `auto-push-global` always commits locally first. The next online session pushes queued commits.
- Cross-machine conflict: if two machines push to the same private repo, git's fetch-rebase-push cycle in `auto-push-global` rebases on top of remote. If rebase fails, the hook skips the push and surfaces a warning so you resolve manually.
- Public-repo conflict: only happens if two maintainers push in the same cooldown window. Resolve with the usual `git pull --rebase && git push`.

## Rollback

Everything is in git. If a release introduces a bad hook:

```bash
cd <your-public-mirror-working-copy>
git log --oneline       # find the bad commit
git revert <sha>        # make a clean revert commit
git push origin main
```

Users running `auto-pull-global` pick up the revert on the next session start. Because the scrub pipeline is deterministic, re-running `bump-version` + `scrub-check` from a known-good source state produces the same output as a fresh clone.

## Branch protection

Branch protection on `main` is configured by `scripts/setup-branch-protection.sh`.
Idempotent — safe to re-run.

```bash
./scripts/setup-branch-protection.sh OWNER/REPO
```

Required status checks: CI on ubuntu+macos+windows. Force-pushes blocked. Linear
history required. Conversation resolution required.

Run once after creating your fork's public repo.

## Quick health check

```bash
bash scripts/health-check.sh    # Linux / macOS / Git-Bash
pwsh scripts/health-check.ps1   # Windows PowerShell
```

Both verify: canonical source present, symlinks resolve, MCP server answers, settings templates valid.
