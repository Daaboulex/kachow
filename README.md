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
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](https://nodejs.org)
[![CI](https://github.com/Daaboulex/kachow/actions/workflows/ci.yml/badge.svg)](https://github.com/Daaboulex/kachow/actions/workflows/ci.yml)

> AI coding agents forget everything between sessions, run destructive commands without checking, and every tool needs separate configuration.
>
> **kachow** is a cross-tool AI agent infrastructure framework. It unifies Claude Code, Gemini CLI, Codex CLI, and Pi under one configuration with 15 focused behavioral hooks for session continuity, safety guards, and observability.
>
> Three pillars: **Unify** (write rules once, symlinks distribute) · **Protect** (safety hooks block destructive commands) · **Remember** (memory management and handoff automation across sessions).

One `AGENTS.md`. Every AI tool on your machine reads it. Write your rules **once** — Claude Code, Gemini CLI, Codex CLI, Pi all follow. Ship hooks that automate memory, context pressure, safety nets, verification.

## Contents

- [Why](#why)
- [Install](#install)
- [What you get](#what-you-get)
- [How it works](#how-it-works)
- [Where things live](#where-things-live)
- [Hooks catalog](./docs/HOOKS.md)
- [Skills + per-AI compatibility](./docs/SKILLS.md)
- [Architecture](./docs/ARCHITECTURE.md)
- [Troubleshooting](./docs/TROUBLESHOOTING.md)
- [Contributing](./CONTRIBUTING.md)

## Why

Every AI tool ships its own rule file — `CLAUDE.md`, `GEMINI.md`, `AGENTS.md`. Keeping them in sync by hand is tedious and drift-prone. You write the same "don't force-push, run tests before claiming done" line four times, then get out of sync after a week.

kachow fixes that at the filesystem level:

- **One canonical `AGENTS.md`** lives at `~/.ai-context/AGENTS.md`. Every AI tool's config file is a symlink to it. Edit once, every tool picks up the change on next session.
- **15 hooks** automate the tedious bits — saving handoffs before exit, blocking destructive bash before it runs, keeping memory indexed, flagging drift between platforms.
- **MANIFEST-driven generation** — one YAML manifest produces config for all 4 CLIs automatically.

## Install

```bash
git clone https://github.com/Daaboulex/kachow ~/.ai-context
cd ~/.ai-context
node scripts/bootstrap.mjs
```

## What you get

| Surface | Lives at | Details |
|---|---|---|
| Canonical rules (`AGENTS.md`) | `~/.ai-context/AGENTS.md` | Symlinked to all 4 CLIs |
| 15 hooks + 28 lib helpers | `~/.ai-context/modules/hooks/src/` | Pure Node, no external deps |
| Config generator | `scripts/generate-settings.mjs` | Reads MANIFEST → outputs Claude JSON, Gemini JSON, Codex TOML, Pi TypeScript |
| Slash commands (15) | `~/.ai-context/core/commands/` | Markdown with frontmatter |
| Skills (15 command skills) | `~/.ai-context/core/skills/` | Tool-neutral SKILL.md format |
| Memory v2 schema | `~/.ai-context/core/memory/` | Frontmatter + markdown, typed (user/feedback/project/reference) |
| Verification suite | `scripts/verify.mjs` | Structure, symlinks, hooks, kachow sync |
| Health check | `scripts/health-check.mjs` | Quick runtime health validation |

## How it works

```
┌─────────────────────────────────────────────────────────────────┐
│                     ~/.ai-context/  (canonical source)          │
│                                                                 │
│  AGENTS.md   core/   modules/   generated/   scripts/           │
└──────────────┬────────────┬─────────────┬─────────────┬─────────┘
               │            │             │             │
         symlinks     generate-settings   symlinks    Pi bridge
               │            │             │             │
               ▼            ▼             ▼             ▼
┌──────────────┐  ┌──────────────┐  ┌──────────┐  ┌────────────┐
│ ~/.claude/   │  │ ~/.gemini/   │  │ ~/.codex/ │  │ ~/.pi/     │
│ CLAUDE.md    │  │ GEMINI.md    │  │ AGENTS.md │  │ AGENTS.md  │
│ hooks/ ──────┼──┤ hooks/ ──────┼──┤ hooks/    │  │ kachow-    │
│ settings.json│  │ settings.json│  │ config.   │  │ bridge.ts  │
│ memory/      │  │ memory/      │  │ toml      │  │ settings.  │
│ commands/    │  │ commands/    │  │ memories/ │  │ json       │
└──────────────┘  └──────────────┘  └──────────┘  └────────────┘
```

Edit `~/.ai-context/AGENTS.md`. Every tool picks up the change on next session start because their rule file is a symlink. Run `node scripts/generate-settings.mjs --apply` after editing hooks or exclusions.

## The 15 Hooks

| Hook | Event | What it does |
|---|---|---|
| `auto-pull-global` | SessionStart | Git pull ~/.ai-context before work starts |
| `session-context-loader` | SessionStart | Loads memory, handoffs, context at session start |
| `block-subagent-writes` | PreToolUse | Blocks subagent shell writes outside cwd |
| `block-subagent-non-bash-writes` | PreToolUse | Blocks subagent Edit/Write/MCP mutations |
| `autosave-before-destructive` | PreToolUse | Auto-stash before rm -rf, git reset, etc. |
| `pre-write-combined-guard` | PreToolUse | Path/content policy enforcement |
| `scrub-sentinel` | PreToolUse | Strips sentinel/secret patterns from writes |
| `agent-dependency-guard` | PreToolUse | Validates agent dispatch dependencies |
| `context-pressure-enforce` | PostToolUse | Monitors context fill %, suggests handoff |
| `memory-index-updater` | PostToolUse | Rebuilds memory index after writes |
| `caveman-precompact` | PreCompact | Saves mode marker before compaction |
| `caveman-post-compact-reinject` | UserPromptSubmit | Re-injects mode after compaction |
| `auto-push-global` | Stop | Git commit+push ~/.ai-context at session end |
| `meta-system-stop` | Stop | Self-improvement scanner |
| `handoff-session-end` | Stop | Saves session state for handoff |

All hooks are pure Node.js with zero external dependencies. They run identically on Linux, macOS, and Windows.

## Per-CLI Config

The generator reads `MANIFEST.yaml` and outputs tool-specific configs:

| Tool | Format | Features |
|---|---|---|
| Claude Code | JSON | `args[]` exec form, `continueOnBlock`, `skillOverrides` |
| Gemini CLI | JSON | Millisecond timeouts, `skills.disabled`, `general.vimMode` |
| Codex CLI | TOML | `[features] codex_hooks = true`, `[[skills.config]]` exclusions |
| Pi | TypeScript extension | Auto-generated `kachow-bridge.ts` from MANIFEST |

## Opt-out

Everything is files. Nothing is hidden.

- Don't want hooks? Remove the `hooks` symlink and strip the hooks block from settings.
- Don't like the rules? Edit `~/.ai-context/AGENTS.md` freely.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT. See [LICENSE](./LICENSE).
