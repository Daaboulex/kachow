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
| `mirror-kachow` (maintainer-only) | `~/.ai-context/` + `~/.claude/` + `~/.gemini/` | Scrubs all three into the public framework mirror, deep-verifies, commits locally. Pushes only if `KACHOW_AUTO_PUSH=1`. | 15 min |

`mirror-kachow` fires on **any** of:
- `~/.ai-context/` HEAD changed (e.g. you committed a rule change)
- `~/.claude/` HEAD changed (e.g. `auto-push-global` just committed a hook edit)
- `~/.gemini/` HEAD changed (e.g. Gemini-side hook edit)
- `~/.ai-context/` working-tree content-hash changed (e.g. you edited `AGENTS.md` but haven't committed yet)

This catches the common "I edited a hook but nothing in `~/.ai-context/` changed" case where the older trigger model would silently no-op.

## Machine scenarios

### Primary (where you maintain the framework)

Day-to-day edits of `AGENTS.md`, hooks, or skills. Everything is automatic:

1. You edit a file.
2. Session ends (Stop hook chain fires).
3. `auto-push-global` commits `~/.claude/` + `~/.gemini/` and pushes them to your private repos.
4. `mirror-kachow` sees the change, re-scrubs, updates `~/.kachow-mirror/` locally.
5. If you've opted in (`KACHOW_AUTO_PUSH=1`), that mirror is pushed to the public repo.

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

### Publishing releases from Windows

The release pipeline (`scripts/publish.sh`, scrub gate, `bump-version.sh`) is bash-only today. On Windows you need Git-Bash (bundled with [Git for Windows](https://git-scm.com/download/win)) or WSL. Run:

```bash
bash scripts/publish.sh --set-version 0.2.0
```

A Node-native publish pipeline is on the v0.2.0 roadmap.

## Offline and conflict handling

- Offline commit: `auto-push-global` always commits locally first. The next online session pushes queued commits.
- Cross-machine conflict: if two machines push to the same private repo, git's fetch-rebase-push cycle in `auto-push-global` rebases on top of remote. If rebase fails, the hook skips the push and surfaces a warning so you resolve manually.
- Public-repo conflict: only happens if two maintainers push in the same cooldown window. Resolve with the usual `git pull --rebase && git push`.

## Rollback

Everything is in git. If a release introduces a bad hook:

```bash
cd ~/.kachow-mirror     # or wherever your mirror lives
git log --oneline       # find the bad commit
git revert <sha>        # make a clean revert commit
git push origin main
```

Users running `auto-pull-global` pick up the revert on the next session start. Because the scrub pipeline is deterministic, re-running `publish.sh --set-version <patch>` from a known-good source state produces the same output as a fresh clone.

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
