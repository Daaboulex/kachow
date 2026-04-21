# kachow

```
   _  __           _
  | |/ /__ _   ___| |__   _____      __
  | ' // _` | / __| '_ \ / _ \ \ /\ / /
  | . \ (_| || (__| | | | (_) \ V  V /
  |_|\_\__,_| \___|_| |_|\___/ \_/\_/
                          K A - C H O W !
```

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Platforms](https://img.shields.io/badge/platform-linux%20%7C%20macos%20%7C%20windows-lightgrey.svg)](#install)
[![Scripts](https://img.shields.io/badge/scripts-bash%20%2B%20powershell%20parity-green.svg)](#cross-platform)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](https://nodejs.org)
[![CI](https://github.com/Daaboulex/kachow/actions/workflows/ci.yml/badge.svg)](https://github.com/Daaboulex/kachow/actions/workflows/ci.yml)

> One `AGENTS.md`. Every AI tool on your machine reads it.
> 36 hooks. 14-tool MCP server. Full bash + PowerShell parity. *Ka-chow.*

Write your rules **once**. Claude Code, Gemini CLI, Codex CLI, OpenCode, Aider, Cursor, Windsurf — they all follow. Ship hooks that automate memory, context pressure, safety nets, verification. Expose memory, debt, tasks, and skills via MCP to any client that supports it.

## Contents

- [Why](#why)
- [Install](#install)
  - [macOS / Linux](#macos--linux)
  - [Windows (PowerShell 7+)](#windows-powershell-7)
  - [Custom location](#custom-location)
- [What you get](#what-you-get)
- [How it works](#how-it-works)
- [Where things live](#where-things-live)
- [Staying up to date](#staying-up-to-date)
- [Hooks catalog](./docs/HOOKS.md)
- [Skills + per-AI compatibility](./docs/SKILLS.md)
- [Maintaining your fork](./docs/MAINTENANCE.md)
- [Architecture](./docs/ARCHITECTURE.md)
- [Troubleshooting](./docs/TROUBLESHOOTING.md)
- [Roadmap](#roadmap)
- [Contributing](./CONTRIBUTING.md)
- [Security](./SECURITY.md)
- [License](./LICENSE)

## Why

Every AI tool ships its own rule file — `CLAUDE.md`, `GEMINI.md`, `AGENTS.md`, `rules.md`. Keeping them in sync by hand is tedious and drift-prone. You write the same "don't force-push, no Co-Authored-By, run tests before claiming done" line five times, then get out of sync after a week.

kachow fixes that at the filesystem level:

- **One canonical `AGENTS.md`** lives at `~/.ai-context/AGENTS.md`. Every AI tool's config file is a symlink to it. Edit once, every tool picks up the change on next session.
- **Hooks** automate the tedious bits — saving handoffs before compaction, blocking destructive bash before it runs, keeping memory rotating, flagging drift between platforms.
- **MCP server** (`personal-context`) gives any MCP-capable client structured read/write access to your memory, tech-debt log, open tasks, skills, and rules.
- **Cross-platform by design** — every user-facing script ships as both `.sh` and `.ps1`. Consumers on Windows don't need bash.

## Install

Time: ~2 minutes.

### macOS / Linux

```bash
git clone https://github.com/Daaboulex/kachow ~/.ai-context
cd ~/.ai-context
./scripts/customize.sh      # interactive: name/email, tools, add-ons
./scripts/bootstrap.sh      # installs adapters + MCP + runs health-check
```

### Windows (PowerShell 7+)

```powershell
git clone https://github.com/Daaboulex/kachow "$HOME\.ai-context"
cd "$HOME\.ai-context"
.\scripts\customize.ps1
.\scripts\bootstrap.ps1
```

Enable **Developer Mode** first (`Settings → Privacy & security → For developers`) so `New-Item -ItemType SymbolicLink` works without admin. If you skip Developer Mode, the installer falls back to file-copy mode and prints a warning — it still works, you just have to re-run the script after canonical edits.

### Custom location

`~/.ai-context` is the default. To put the canonical source elsewhere, set `AI_CONTEXT` **before** cloning:

```bash
export AI_CONTEXT="$HOME/Documents/ai-rules"
git clone https://github.com/Daaboulex/kachow "$AI_CONTEXT"
"$AI_CONTEXT/scripts/bootstrap.sh"
```

Every script reads `AI_CONTEXT` with a fallback to `$HOME/.ai-context`. Useful if you sync the directory via Syncthing from a non-home location, or if your org policy puts dotfiles under `$XDG_CONFIG_HOME`.

## What you get

| Surface | Lives at | Installed by | Cross-platform |
|---|---|---|---|
| Canonical rules (`AGENTS.md`) | `~/.ai-context/AGENTS.md` | `install-adapters.sh` / `.ps1` | yes — symlinks (or copy fallback on Windows without Dev Mode) |
| 36 hooks | `~/.claude/hooks/` | copied on first bootstrap | yes — all pure Node, no shell deps |
| 14 library helpers | `~/.claude/hooks/lib/` | same | yes |
| MCP server (`personal-context`) | `~/.ai-context/mcp/personal-context/server.js` | `install-mcp.sh` / `.ps1` | yes — zero-dep Node |
| Slash commands (17) | `~/.claude/commands/` | bootstrap | yes — Markdown with frontmatter |
| Skills (shipped: `debt-tracker`) | `~/.ai-context/skills/debt-tracker/` | symlinked by bootstrap | yes — but per-AI format differs, see [SKILLS.md](./docs/SKILLS.md) |
| Memory v2 schema + TTL rotation | `~/.ai-context/memory/` (personal) + `memory-rotate.js` hook | example at `memory/example.md` | yes |
| `/preview <image>` | `~/.claude/commands/preview.md` + chafa | `customize.sh` asks | yes — requires `chafa` on PATH |
| Health check | `scripts/health-check.{sh,ps1}` | bootstrap | yes |

## How it works

```
┌─────────────────────────────────────────────────────────────────┐
│                     ~/.ai-context/  (canonical source)          │
│                                                                 │
│  AGENTS.md   memory/   skills/   mcp/   scripts/   VERSION      │
└──────────────┬────────────┬─────────────┬─────────────┬─────────┘
               │            │             │             │
         symlinks      symlinks       registered     bootstrap
               │            │             │             │
               ▼            ▼             ▼             ▼
┌──────────────┐  ┌──────────────┐  ┌──────────┐  ┌────────────┐
│ ~/.claude/   │  │ ~/.gemini/   │  │ ~/.codex │  │ ~/.config/ │
│ CLAUDE.md─→──┼──┤ GEMINI.md─→──┤  │ config   │  │ opencode/  │
│ hooks/       │  │ hooks/ ← sync│  │ .toml    │  │ aider/     │
│ commands/    │  │ commands/    │  │          │  │            │
│ settings.json│  │ settings.json│  │          │  │            │
└──────────────┘  └──────────────┘  └──────────┘  └────────────┘
```

Edit `~/.ai-context/AGENTS.md`. Every tool picks up the change on next session start because their rule file is a symlink.

## Where things live

Three canonical directories per user. They have different sync characteristics on purpose. Full table + trigger matrix in [MAINTENANCE.md](./docs/MAINTENANCE.md).

- `~/.ai-context/` — shared canonical (rules, memory, skills, MCP, scripts)
- `~/.claude/` — Claude-specific (hooks master, commands, settings)
- `~/.gemini/` — Gemini-specific (settings, hooks mirrored from Claude)

The other tools (Codex, OpenCode, Aider, Cursor) all read `AGENTS.md` through a symlink — no per-tool duplication of rules.

## Staying up to date

You forked kachow. You want to keep up with upstream improvements.

```bash
bash scripts/self-update.sh       # or .ps1 on Windows
```

The script:

1. `git fetch origin && git log --oneline origin/main..main` — shows what's incoming
2. Preserves the `USER SECTION` block in your `AGENTS.md` so your personal rules survive
3. Merges (or rebases if clean)
4. Re-runs `bootstrap.sh` so new hooks / adapters are picked up
5. Prints the `CHANGELOG` diff so you know what changed

Want to see what's new before pulling? `scripts/self-update.sh --dry-run`.

Your private memory, personal hook additions in `~/.claude/hooks/` that aren't in the shipped whitelist, and the content between the USER SECTION markers all survive updates.

## Cross-platform

- **Linux** (NixOS, Ubuntu, Fedora, Arch) — tested via CI (ubuntu-latest).
- **macOS** — tested via CI (macos-latest); `brew install chafa` for `/preview`.
- **Windows** — tested via CI (windows-latest); PowerShell 7+ with Developer Mode for symlinks (or copy-mode fallback); `scoop install chafa` for `/preview`.

Using the framework as a **consumer** requires zero bash on Windows. Publishing your own fork as a release (running `scripts/publish.sh`) currently needs bash + rsync, so Windows maintainers use Git-Bash (bundled with [Git for Windows](https://git-scm.com/download/win)) or WSL. A Node-native publish pipeline is planned for v0.2.0 — see the roadmap.

## Opt-out

Everything is files. Nothing is hidden.

- Don't want hooks? `rm -rf ~/.claude/hooks ~/.gemini/hooks` and strip the `hooks` block from your settings.
- Don't want MCP? Remove the `mcpServers.personal-context` entry from your tool's config.
- Don't like the rules? Edit `~/.ai-context/AGENTS.md` freely — the USER SECTION is yours.

Everything is idempotent. Re-running `bootstrap.sh` re-applies the current state.

## Roadmap

- [ ] **v0.2.0** — Node-native publish pipeline (`scripts/publish.ps1`), hooks consolidation into `~/.ai-context/hooks/` with cross-tool symlinks, per-AI skill adapters
- [ ] **v0.3.0** — Scheduled CI job to detect Claude Code / Gemini CLI version drift and file a release-prep issue
- [ ] **v1.0.0** — API stability promise for hook interface + settings template shape

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Short rule: if it makes the framework more portable, PRs welcome. If it hard-codes personal project structure, it won't merge.

## Security

Reporting model + scope in [SECURITY.md](./SECURITY.md). Scrub pipeline has three layers of defense (pre-commit → scrub-for-publish → CI fail-gate) before anything touches the public tree.

## License

MIT. See [LICENSE](./LICENSE).

---

<sub>This repo ships zero personal config. Every token passes through a whitelist-based scrub gate plus a deep-verifier before landing in your clone. Read [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the full pipeline.</sub>
