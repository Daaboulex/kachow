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

> AI coding agents forget everything between sessions, run destructive commands without checking, and every tool needs separate configuration.
>
> **kachow** is a cross-tool AI agent infrastructure framework. It unifies Claude Code, Gemini CLI, and Codex CLI under one configuration with 60+ behavioral hooks for session continuity, safety guards, and observability.
>
> Three pillars: **Unify** (write rules once, symlinks distribute) · **Protect** (safety hooks block destructive commands) · **Remember** (memory management and handoff automation across sessions).

One `AGENTS.md`. Every AI tool on your machine reads it. Write your rules **once** — Claude Code, Gemini CLI, Codex CLI, OpenCode, Aider, Cursor, Windsurf all follow. Ship hooks that automate memory, context pressure, safety nets, verification. Expose memory, debt, tasks, and skills via MCP to any client that supports it.

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
| 60+ hooks | `~/.claude/hooks/` | symlinked on first bootstrap | yes — all pure Node, no shell deps |
| 28 library helpers | `~/.claude/hooks/lib/` | same | yes |
| MCP server (`personal-context`) | `~/.ai-context/mcp/personal-context/server.js` | `install-mcp.sh` / `.ps1` | yes — zero-dep Node |
| Slash commands (13) | `~/.claude/commands/` | bootstrap | yes — Markdown with frontmatter |
| Skills (shipped: `debt-tracker`) | `~/.ai-context/skills/debt-tracker/` | symlinked by bootstrap | yes — but per-AI format differs, see [SKILLS.md](./docs/SKILLS.md) |
| Memory v2 schema + TTL rotation | `~/.ai-context/memory/` (personal) + `memory-rotate.js` hook | example at `memory/example.md` | yes |
| `/preview <image>` | `~/.claude/commands/preview.md` + chafa | `customize.sh` asks | yes — requires `chafa` on PATH |
| Health check | `scripts/health-check.{sh,ps1}` | bootstrap | yes |

## How it works

```
┌─────────────────────────────────────────────────────────────────┐
│                     ~/.ai-context/  (canonical source)          │
│                                                                 │
│  AGENTS.md   memory/   skills/   mcp/   scripts/   VERSION*     │
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

*`VERSION`* is generated at build time by `scripts/publish.sh` — it is not present in source checkouts.

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

Using the framework as a **consumer** requires zero bash on Windows. Publishing your own fork as a release (running `scripts/publish.sh`) currently needs bash + rsync, so Windows maintainers use Git-Bash (bundled with [Git for Windows](https://git-scm.com/download/win)) or WSL. A Node-native publish pipeline is planned for a future release — see the roadmap.

## Opt-out

Everything is files. Nothing is hidden.

- Don't want hooks? `rm -rf ~/.claude/hooks ~/.gemini/hooks` and strip the `hooks` block from your settings.
- Don't want MCP? Remove the `mcpServers.personal-context` entry from your tool's config.
- Don't like the rules? Edit `~/.ai-context/AGENTS.md` freely — the USER SECTION is yours.

Everything is idempotent. Re-running `bootstrap.sh` re-applies the current state.

## Built-in skills & commands

kachow ships a small set of skills and slash commands that survive across Claude Code, Gemini CLI, and other MCP-capable clients. Each is kept because it solves a recurring problem in multi-session AI workflows — not because a skill existed and needed a home.

### Skills (description-activated)

| Skill | Why | How |
|---|---|---|
| **debt-tracker** | Bugs mentioned in a session transcript get lost on `/clear`. DEBT.md keeps known tech debt, blocked work, and deferred bugs visible per repo. | Writes a structured `DEBT.md` at the repo root (or `.claude/DEBT.md`). Auto-invoked when you describe a bug you can't fix now, a hack that needs revisiting, or work blocked on hardware/info. |

### Commands (slash-invoked on Claude; arg-dispatched elsewhere)

**Memory & state**

| Command | Why | How |
|---|---|---|
| `/memory <query>` | You accumulate dozens of memory files across projects; grep alone doesn't rank by project/feedback/reference type. | Pure grep across `.claude/memory/*.md` and `.ai-context/memory/` with frontmatter-aware scoring. Zero deps, works on Windows + Linux + macOS. |
| `/handoff` | Multi-hour work hits the 70% context ceiling and degrades. A fast save-state is non-negotiable. | Emits `.session-handoff.md` with inlined state (no "see file X" references), a quick-reflect pass, and next-session instructions. |
| `/wrap-up` | End-of-session is when learnings get lost. You want one command that runs reflect + verify-sync + ensure nothing is orphaned. | Orchestrates `/reflect` → `/verify-sync` → memory index refresh. Proactively fired by the Stop hook when meaningful work was done. |
| `/reflect [on\|off\|status]` | Auto-reflection is useful but sometimes noisy. Needs per-session toggle + manual run. | Args: `on` / `off` / `status` / empty = run reflection now. Writes to per-cwd auto-memory. |
| `/consolidate-memory [deep\|user\|all]` | Memory files drift as codebase evolves; Tier 1 (raw) needs rolling into Tier 3 (semantic summaries). | Runs the 3-tier maintenance pass: consolidate Tier 1, synthesize Tier 3, verify skills/rules/CLAUDE.md against codebase, check hooks. |
| `/compress-memory` | MEMORY.md over 200 lines starts getting truncated at load; 40+ files adds token cost. | Compresses old/large memory files into summaries, inspired by AgentScope's memory compression. Keeps human-readable backup. |
| `/review-improvements` | Self-improvement detectors find things (R15 false-positives, hook bloat, etc.); without triage they just pile up. | Groups findings by tier (BLOCKER/SUGGEST/OBSERVE), reads the queue at `~/.claude/self-improvements-pending-<host>.jsonl`, prompts accept/reject/defer per item. Rejects teach 90-day class suppression. |

**Docs & content**

| Command | Why | How |
|---|---|---|
| `/distill <path>` | Large spec/plan docs burn context on re-reads. Lossless compression to ~30% without losing any fact, decision, or constraint. | Chunk-parallel summarization with round-trip validation — if round-trip fact-check fails, keeps original. |
| `/shard-doc <path>` | Oversize skill/command files (>500 lines) truncate during load. Splitting on H2 sections with an index restores full access. | Reads file, splits at `## ` headings, writes sibling directory with index + per-section files. `--reassemble` reverses. |
| `/review-adversarial` | Standard reviews rubber-stamp. Enforced-minimum-findings prevents zero-issue flattery. | Minimum N findings (default 5); zero triggers re-analysis. Scope: files / phase / PR diff. |

**System health**

| Command | Why | How |
|---|---|---|
| `/platform-audit` | Monthly: check Claude Code + Gemini CLI releases, hook parity, settings drift, agent frontmatter validity. | Fetches latest releases, compares against pinned `VERSION-DEPS`, runs settings-template diff, validates all agent frontmatter, flags new features worth adopting. |
| `/verify-sync` | Claude → Gemini one-way sync hooks can fail silently; rules/skills/commands diverge over time. | Diffs `.claude/` vs `.gemini/` for commands, skills, rules, hooks — reports drift without auto-fixing. |
| `/preview <path>` | Terminal image preview without reaching for a GUI. | Renders via `chafa` (NixOS / Linux / macOS). Opt-in, manual invocation. |

Full command source lives in [`commands/`](./commands/). Skill source lives in [`skills/`](./skills/).

## Credits & recommended companions

kachow is one layer in a larger stack. Nothing below is bundled — each is its own plugin or project — but every one either influenced kachow's design or handles a concern kachow deliberately leaves alone. Install whichever match your workflow.

### Companion plugins (Claude Code marketplace)

| Project | Author | What it does |
|---|---|---|
| [**superpowers**](https://github.com/obra/superpowers) | Jesse Vincent ([@obra](https://github.com/obra)) | Brainstorming, subagent-driven development with built-in code review, systematic debugging, and red/green TDD skills. |
| [**compound-engineering**](https://github.com/EveryInc/compound-engineering-plugin) | Kieran Klaassen ([@kieranklaassen](https://github.com/kieranklaassen)) / Every | Parallel persona reviewers (correctness, maintainability, testing, security, etc.), structured PR workflows, commit/plan/debug skills. |
| [**impeccable**](https://github.com/pbakaus/impeccable) | Paul Bakaus ([@pbakaus](https://github.com/pbakaus)) | Design fluency for frontend work: a single `/impeccable` skill with 23 subcommands (polish, audit, critique, bolder, adapt, etc.) plus Live Mode browser element picker. |
| [**caveman**](https://github.com/JuliusBrussee/caveman) | Julius Brussée ([@JuliusBrussee](https://github.com/JuliusBrussee)) | Ultra-compressed output mode — cuts roughly 75% of prose tokens while leaving code blocks, error messages, and paths verbatim. |
| [**cli-anything**](https://github.com/HKUDS/CLI-Anything) | HKU Data Science Lab ([@HKUDS](https://github.com/HKUDS)) | Harness methodology for wrapping GUI applications in stateful, agent-friendly CLIs. |
| [**skill-creator**](https://github.com/anthropics/claude-plugins-official) | Anthropic | Authoring tools for new skills plus evals and variance benchmarks to measure skill quality. |
| [**clangd-lsp**](https://github.com/anthropics/claude-plugins-official) | Anthropic | C/C++ language server integration via clangd for Clang-based projects. |

### Foundations kachow builds on

- [**Claude Code**](https://github.com/anthropics/claude-code) — hook API, plugin marketplace, and the `SessionStart` / `PreToolUse` / `PostToolUse` / `Stop` contract kachow's automation layer sits on.
- [**Gemini CLI**](https://github.com/google-gemini/gemini-cli) — parallel hook interface (`BeforeTool` / `AfterTool` / `SessionEnd`) plus `activate_skill`, which made multi-tool parity feasible.
- [**AgentScope**](https://github.com/agentscope-ai/agentscope) — memory-compression patterns that inspired `/compress-memory`.
- [**Model Context Protocol**](https://modelcontextprotocol.io/) — the shared substrate letting one MCP server serve memory / debt / handoff reads to every supported AI tool.

Inspired-by, not forked: kachow's hooks, commands, skills, and memory schema are original code. The projects above set the direction.

## Roadmap

- [x] **v0.2.0** — Documentation rewrite (60+ hooks documented, count corrections, identity refresh), context-pressure threshold fix, scrub leak fixes
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
