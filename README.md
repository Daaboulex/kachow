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
[![CI](https://github.com/Daaboulex/kachow/actions/workflows/ci.yml/badge.svg)](https://github.com/Daaboulex/kachow/actions/workflows/ci.yml)

## What is kachow?

**One rules file. Every AI coding tool on your machine follows it.**

If you use more than one AI assistant — Claude Code, Gemini CLI, Codex, OpenCode, Aider, Cursor — you probably maintain separate `CLAUDE.md` / `GEMINI.md` / `AGENTS.md` files. They drift. You fix one, forget the other, and the AIs disagree about your rules.

kachow solves this with symlinks: there's **one** canonical `~/.ai-context/AGENTS.md`, and every tool's rule file is a symlink to it. Edit once, every tool picks up the change on next session.

On top of that, kachow ships:

- **Safety hooks** — block subagents from running destructive git commands; auto-stash before `rm -rf`; validate `settings.json` before write; nudge when AI ignores "don't create `foo-v2.ts`" rules.
- **Auto-context loader** — every session starts with your memory summary, handoff progress from the last session, pending tasks, and self-improvement queue already injected. No "check the handoff file" manual step.
- **MCP server** — read/write access to your memory, tech-debt log, open tasks, skills, and rules from any MCP-capable client (Claude Code, Gemini, Cursor, Cline, Continue, Zed, Copilot workspace).
- **Cross-platform install** — every user-facing script ships as both `.sh` and `.ps1`. Windows works without WSL.

## What does it actually look like?

### Before kachow
```
Edit ~/.claude/CLAUDE.md      ← Claude sees new rule
Edit ~/.gemini/GEMINI.md      ← Gemini sees new rule — if you remembered
Edit ~/.codex/AGENTS.md       ← Codex sees new rule — if you remembered
Edit ~/.cursor/AGENTS.md      ← Cursor sees new rule — if you remembered
# Drift guaranteed within a week.
```

### After kachow
```
Edit ~/.ai-context/AGENTS.md  ← Every tool sees new rule on next session.
                                CLAUDE.md / GEMINI.md / AGENTS.md are all
                                symlinks. No manual sync, ever.
```

Once you've been using kachow for a while, session-start injects accumulated context automatically — for example:
```
⚡ HANDOFF 3/5 (60%) — pending: finish CI fix · re-run smoke tests
⚙ System: 2 SUGGEST pending self-improvement — run /review-improvements
⚠ stale processes: 2 orphan shells (oldest 1h) — run ~/.claude/scripts/cleanup-stale.sh
memory: 14 entries (project:5, feedback:6, user:3), top-5 loaded
```
(On first install the banner is empty — it fills in as handoffs, tasks, and memory accumulate.)

## Install

**Requires:** Node ≥20, git, and the AI tool you want to use.

### 30-second install (macOS / Linux)

```bash
git clone https://github.com/Daaboulex/kachow ~/.ai-context
cd ~/.ai-context
./scripts/customize.sh      # interactive: pick which AIs + add-ons you have
./scripts/bootstrap.sh      # installs symlinks, registers MCP, runs health-check
```

### 30-second install (Windows, PowerShell 7+)

Enable **Developer Mode** first (Settings → Privacy & security → For developers) so `New-Item -ItemType SymbolicLink` works without admin. If you skip this, the installer uses copy-mode (works but requires re-running after rule edits).

```powershell
git clone https://github.com/Daaboulex/kachow "$HOME\.ai-context"
cd "$HOME\.ai-context"
.\scripts\customize.ps1
.\scripts\bootstrap.ps1
```

### Verify it worked

```bash
bash ~/.ai-context/scripts/health-check.sh          # Linux/macOS
# or:
pwsh ~/.ai-context/scripts/health-check.ps1         # Windows
```

You should see green checks for: canonical AGENTS.md present, symlinks pointing to it, MCP server responds, settings.json files parse.

## Per-AI quick guide

kachow is designed to plug into whichever AI tools you already have. Nothing is forced — missing tools are silently skipped during install.

### Claude Code

**What you get:**
- `~/.claude/CLAUDE.md` → symlinked to `~/.ai-context/AGENTS.md`
- Hooks installed in `~/.claude/hooks/` (session auto-load, safety guards, memory rotation, auto-commit+push)
- MCP server registered in `~/.claude.json`
- Slash commands in `~/.claude/commands/` (`/memory`, `/handoff`, `/wrap-up`, `/reflect`, `/distill`, etc.)

**First session after install:** Claude Code will tell you about pending handoffs, open tasks, and recent memory entries automatically. No prompt needed.

**Disable anything:** Remove the hook from `~/.claude/settings.json → hooks.<event>`. The hook file stays on disk; nothing fires.

### Gemini CLI

**What you get:**
- `~/.gemini/GEMINI.md` → symlinked to `~/.ai-context/AGENTS.md`
- Same hook surface as Claude, adapted to Gemini's event names (`BeforeTool`, `AfterTool`, `SessionEnd`)
- MCP server registered in `~/.gemini/settings.json → mcpServers`
- Skills adapted to Gemini's skill format (descriptions rewritten for Gemini's semantic retrieval)

**Gotcha:** Gemini CLI activates skills by description matching, not slash commands. Skills authored for Claude get description rewrites during install via `scripts/validate-skills.js`.

### Codex CLI

**What you get:**
- `~/.codex/AGENTS.md` → symlinked to `~/.ai-context/AGENTS.md`
- MCP server registered in `~/.codex/config.toml`

**No hooks.** Codex has no hook interface yet — kachow only provides the rules + MCP.

### OpenCode

**What you get:**
- `~/.config/opencode/AGENTS.md` → symlinked to `~/.ai-context/AGENTS.md`
- MCP server registered in `~/.config/opencode/config.json`

### Aider

**What you get:**
- `~/.config/aider/AGENTS.md` → symlinked to `~/.ai-context/AGENTS.md`

**Usage:** `aider --read ~/.config/aider/AGENTS.md` (or add `read:` entry in `.aider.conf.yml`).

### Cursor

**What you get:**
- MCP server registered in `~/.cursor/mcp.json`
- If you use `.cursor/rules/*.mdc` per-project, point them to `~/.ai-context/AGENTS.md`

### Cline / Continue.dev / Zed / Windsurf / Copilot Workspace

**What you get:**
- MCP server registered via each tool's MCP config file
- Rules: these tools natively read `AGENTS.md` at the project root — link to `~/.ai-context/AGENTS.md` or copy the content

## Install custom location

```bash
export AI_CONTEXT="$HOME/Documents/ai-rules"
git clone https://github.com/Daaboulex/kachow "$AI_CONTEXT"
"$AI_CONTEXT/scripts/bootstrap.sh"
```

Every script honours `$AI_CONTEXT` before falling back to `$HOME/.ai-context`. Useful if you sync the dir via Syncthing from `~/Documents`, or if `$XDG_CONFIG_HOME` lives elsewhere.

## What survives updates

```bash
bash ~/.ai-context/scripts/self-update.sh
```

The script:

1. `git fetch` and shows you what's incoming.
2. Preserves the `USER SECTION` block in `AGENTS.md` so your personal rules survive.
3. Rebases if clean, merges otherwise.
4. Re-runs `bootstrap.sh` so new hooks / adapters are picked up.

Your **personal rules**, **memories**, **tech-debt log**, and **any hooks you added that aren't in the shipped list** all survive updates.

## Opt-out

Everything is files. Nothing is hidden.

- **Remove a hook:** strip the entry from `~/.claude/settings.json → hooks.<event>`, or `rm ~/.claude/hooks/<name>.js`.
- **Remove MCP:** delete the `mcpServers.personal-context` entry from your tool's config file.
- **Remove the whole framework:** `rm -rf ~/.ai-context` and the symlinks it made. Your personal configs become regular files again.

Re-running `bootstrap.sh` is always idempotent.

## Where things live

Three top-level directories:

- **`~/.ai-context/`** — canonical source (rules, memory, skills, MCP, scripts). Edit here.
- **`~/.claude/`** — Claude-specific (hooks master, commands, settings). Mostly populated by bootstrap.
- **`~/.gemini/`** — Gemini-specific (settings, hooks mirrored from Claude). Mostly populated by bootstrap.

Codex, OpenCode, and Aider all read `~/.ai-context/AGENTS.md` through a global symlink — no per-tool duplication. Cursor reads `AGENTS.md` at the project root (it has no user-global AGENTS.md concept); bootstrap installs the MCP server for Cursor via `~/.cursor/mcp.json` and you point project-level `.cursor/rules/*.mdc` at the canonical `AGENTS.md` as needed.

Full breakdown in [docs/LOCATIONS.md](./docs/LOCATIONS.md).

## Docs

| Doc | Read if you... |
|---|---|
| [TUTORIAL.md](./docs/TUTORIAL.md) | Want an end-to-end walkthrough — fresh install on Linux/macOS/Windows, symlinks explained, every AI wired in, plus maintenance and opt-out |
| [INSTALL-PER-AI.md](./docs/INSTALL-PER-AI.md) | Are installing for a specific AI and want step-by-step instructions |
| [ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Want to see the actual per-event hook flow (real diagrams, not hand-waving) |
| [HOOKS.md](./docs/HOOKS.md) | Want the full catalog of every hook + what it does |
| [SKILLS.md](./docs/SKILLS.md) | Want to write a skill or understand per-AI skill format differences |
| [LOCATIONS.md](./docs/LOCATIONS.md) | Want the full directory + sync matrix |
| [MAINTENANCE.md](./docs/MAINTENANCE.md) | Are maintaining your own fork |
| [ADDING-A-HOOK.md](./docs/ADDING-A-HOOK.md) | Are writing a new hook |
| [CROSS-PLATFORM.md](./docs/CROSS-PLATFORM.md) | Want the bash ↔ pwsh parity conventions |
| [DROP-IN.md](./docs/DROP-IN.md) | Already have an AI-tooling setup and want to know how kachow coexists |
| [TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md) | Something broke |

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
| `/sync-all` | After editing any single context artifact you shouldn't have to remember which 3 sync scripts to run. | One command sweeps hooks, skills, rules, memories, commands, settings between Claude and Gemini canonical locations. |
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

### v0.3.0 — portability + self-maintenance
- [ ] Per-tool skill adapters (auto-rewrite skill descriptions for Gemini's semantic retrieval + Cursor `.mdc` generation)
- [ ] Node-native publish pipeline so Windows maintainers don't need bash
- [ ] Prune oversize slash commands (`consolidate-memory`, `wrap-up`, `platform-audit`, `reflect`) via `/distill`
- [ ] Expand skill tracker beyond `Skill` tool invocations — join `slash_invoke` + `skill_invoke` events for true usage coverage
- [ ] Auto-consolidate 4 Stop-chain consolidation hooks (`reflect-stop`, `meta-system-stop`, `dream-auto`, `stop-sleep-consolidator`) into one dispatcher
- [ ] Sharable `ai-snapshot-stop` hook without personal filesystem paths
- [ ] CI: bootstrap-smoke that exercises the real Claude Code binary on a throwaway `$HOME`

### v1.0.0 — stable promise
- [ ] Frozen hook interface: stdin JSON shape, stdout envelope, event names
- [ ] Frozen `settings.template.json` shape
- [ ] Documented MCP tool contract (names, args, return shapes, error model)
- [ ] Tested upgrade path from every v0.x

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Short rule: PRs that make the framework more portable merge; PRs that hard-code personal project structure don't.

## Security

Reporting model in [SECURITY.md](./SECURITY.md). Four layers of scrub-gate defense keep personal tokens out of the public tree — see [ARCHITECTURE.md § Scrub pipeline](./docs/ARCHITECTURE.md#scrub-pipeline-personal-info-containment).

## License

MIT. See [LICENSE](./LICENSE).

---

<sub>This repo contains zero personal config. Every commit passes through a pre-push scrub gate assembled at runtime from string parts, a CI scrub-gate on every push, and an auto-sanitizer in all generated Markdown. Read [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the full pipeline.</sub>
