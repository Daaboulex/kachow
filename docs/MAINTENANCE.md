# Maintaining your fork

This doc answers two questions every new maintainer asks after the first `bootstrap.sh`:

1. **Where does each piece live, and why?**
2. **When I work on machine X, what happens where?**

## The one canonical dir

All configuration lives in one place: `~/.ai-context/`. Tool directories (`~/.claude/`, `~/.gemini/`, `~/.codex/`) are **derived state** — they contain symlinks pointing back into `~/.ai-context/` plus tool-managed runtime files (caches, plugins, session data).

| Dir | Role | Git | Cross-machine sync |
|---|---|---|---|
| `~/.ai-context/` | **Canonical source.** `AGENTS.md`, `hooks/`, `commands/`, `configs/`, `memory/`, `skills/`, `mcp/`, `scripts/`, `project-state/` | Private git repo (your choice). `auto-push-global.js` commits + pushes at session end. | Syncthing, private git, or both. |
| `~/.claude/` | Derived. Symlinks to canonical for `settings.json`, `hooks/`, `commands/`, `memory/`, `CLAUDE.md`. Plus Claude-managed runtime: `plugins/`, `cache/`, `file-history/`. | No git repo. | Not synced directly — changes flow through `~/.ai-context/`. |
| `~/.gemini/` | Derived. Same symlink pattern. Plus Gemini-managed runtime: `extensions/`, `cache/`. | No git repo. | Same. |
| `~/.codex/` | Derived. Same pattern. `config.toml` symlinked from `configs/`. | No git repo. | Same. |
| `~/.config/crush/` | Derived. `crush.json` + `hooks/` symlinked. | No git repo. | Same. |
| `~/.config/opencode/` | Derived. `AGENTS.md` + `config.json` symlinked. | No git repo. | Same. |

Key consequences:

- **Edit once, all tools see the change.** Hooks, settings, commands, memories, and instructions are all canonical in `~/.ai-context/`. Symlinks deliver them to each tool.
- **`auto-push-global.js` pushes only `~/.ai-context/`.** Enable with `AI_CONTEXT_AUTOCOMMIT=1` + `AI_CONTEXT_AUTOPUSH=1` in your env config.
- **`install-adapters.mjs` creates all symlinks.** Run it after cloning on a new machine, or after adding a new tool.

## Trigger matrix — what runs when

Every Stop hook runs in a known order (see `settings.template.json → hooks.Stop`). The relevant ones for maintenance:

| Hook | Scope | What it does | Cooldown |
|---|---|---|---|
| `auto-push-global` | `~/.ai-context/` | Commits locally always; pushes every 5 min or when commits pile up. | 5 min (push only) |
| `mirror-kachow` (maintainer-only) | `~/.ai-context/` | Scrubs canonical source into the public framework mirror, deep-verifies, commits locally. Pushes only if `KACHOW_AUTO_PUSH=1`. | 15 min |

`mirror-kachow` fires on **either** of:
- `~/.ai-context/` HEAD changed (e.g. you committed a rule change)
- `~/.ai-context/` working-tree content-hash changed (e.g. you edited `AGENTS.md` but haven't committed yet)

## Machine scenarios

### Primary (where you maintain the framework)

Day-to-day edits of `AGENTS.md`, hooks, or skills. Everything is automatic:

1. You edit a file.
2. Session ends (Stop hook chain fires).
3. `auto-push-global` commits `~/.ai-context/` and pushes to your private repo.
4. `mirror-kachow` sees the change, re-scrubs, updates the local mirror.
5. If you've opted in (`KACHOW_AUTO_PUSH=1`), that mirror is pushed to the public repo.

### Secondary machine (another personal install)

Your second machine pulls one thing on startup:

- **`~/.ai-context/`**: `auto-pull-global.js` (SessionStart hook) fetches from your private remote. Or Syncthing keeps it current between sessions. Tool dirs are derived — `install-adapters.mjs` creates the symlinks.

### Windows work machine (consumer-only)

If the Windows box is just using the framework and not maintaining it:

1. `git clone https://github.com/<you>/<public-framework> %USERPROFILE%\.ai-context`
2. `pwsh scripts\customize.ps1` — fills in name/email, picks which tools to wire.
3. `pwsh scripts\bootstrap.ps1` — installs adapters, MCP, normalizes `$HOME` in settings.
4. Done. Personal memory stays on this machine only; the framework auto-updates by re-running bootstrap after `git pull`.

If Developer Mode is off, symlinks fall back to plain file copies — you just have to re-run `bootstrap.ps1` after canonical edits. Instructions for enabling Developer Mode are printed by the script.

### Publishing releases from Windows

The release pipeline (`scripts/publish.sh`, scrub gate, `bump-version.sh`) is bash-only today. On Windows you need Git-Bash (bundled with [Git for Windows](https://git-scm.com/download/win)) or WSL. Run:

Publishing workflow is manual — see `scrub-for-publish.sh` in the maintainer source.

A Node-native publish pipeline is on the roadmap for a future release.

## Offline and conflict handling

- Offline commit: `auto-push-global` always commits locally first. The next online session pushes queued commits.
- Cross-machine conflict: if two machines push to the same private repo, git's fetch-rebase-push cycle in `auto-push-global` rebases on top of remote. If rebase fails, the hook skips the push and surfaces a warning so you resolve manually.
- Public-repo conflict: only happens if two maintainers push in the same cooldown window. Resolve with the usual `git pull --rebase && git push`.

## Rollback

Everything is in git. If a release introduces a bad hook:

```bash
cd ~/.ai-context/kachow-mirror   # or wherever your mirror lives
git log --oneline       # find the bad commit
git revert <sha>        # make a clean revert commit
git push origin main
```

Users running `auto-pull-global` pick up the revert on the next session start. Because the scrub pipeline is deterministic, re-running `publish.sh --set-version <patch>` from a known-good source state produces the same output as a fresh clone.

## Quick health check

```bash
bash scripts/health-check.sh    # Linux / macOS / Git-Bash
pwsh scripts/health-check.ps1   # Windows PowerShell
```

Both verify: canonical source present, symlinks resolve, MCP server answers, settings templates valid.
