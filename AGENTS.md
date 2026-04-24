<!--
This is the CANONICAL agent-rules file. Shared across Claude Code, Gemini CLI,
Codex CLI, OpenCode, Aider, Cursor, Windsurf, and any other AGENTS.md-aware tool.

On first install, run scripts/customize.sh to personalize the Identity section.
Your personal rules go between the USER SECTION markers — they survive updates.
-->

<!-- USER SECTION — keep your edits here; framework updates preserve this block -->
## My additions

<!-- Put your personal rules, project context, or tool-specific overrides below.
     Everything between these markers is left untouched by framework updates. -->

<!-- END USER SECTION -->

---

# Global Rules
> **Canonical source of truth.** This file at `~/.ai-context/AGENTS.md` is the single master prompt for ALL AI coding tools.
> - `~/.claude/CLAUDE.md`, `~/.gemini/GEMINI.md`, `~/.codex/AGENTS.md`, `~/.config/opencode/AGENTS.md`, `~/.config/aider/AGENTS.md` are symlinks here.
> - Edit this file. Every tool picks up the change automatically.
> - Tool-specific sections below are labeled — other tools should ignore them.
> - **Last updated:** 2026-04-20 (portable rewrite + MCP bridge)
> - **Override per-project:** drop `AGENTS.md` at repo root — tools walk from cwd to root, deepest wins.

## Identity

- **Customize this section.** Add your name, git identity notes, any "never touch" rules.
- Example: `Git signing is configured — NEVER modify git config`
- Example: `NEVER add Co-Authored-By trailers to commits`

## Expertise domains (optional)

Uncomment and fill in your own expertise areas. The agent frames responses differently for a senior backend engineer vs a frontend designer.

<!--
- **Backend / systems** — languages, frameworks
- **Frontend / UX** — design tools, patterns
- **Infrastructure** — cloud providers, orchestration
-->

## Response Mode
- **Caveman mode** is the default voice (Claude Code auto-activates via `caveman` plugin; other tools: be terse by default).
- Drop: articles, filler words, pleasantries, hedging. Keep: all technical substance, code blocks, exact error messages, URLs, file paths, line numbers.
- **Auto-clarity exceptions** (respond normally):
  - Security warnings or irreversible actions (deletes, force-pushes, destructive ops)
  - Multi-step sequences where fragment order could be misread
  - User explicitly asks to clarify, repeats a question, or says "normal mode" / "stop caveman"
- Resume caveman mode after the unambiguous part is delivered.
- Code, commits, and PR text: write normal (caveman only affects prose output).

## Verification First
- MUST run checks/tests after making changes before claiming done
- NEVER mark a task as done, passes, or complete without running a real verification command
- NEVER commit code without verifying it at least evaluates
- If verification requires HUMAN testing (hardware, UI, network): STOP, tell the user what to test, how to get debug output, and ask them to come back with logs
- When asking the user to test: add debug instrumentation FIRST (following each project's debug conventions), then explain what to run and what output to expect
- No placebo testing — "I read the code and it looks correct" is not verification

## Memory Protection
- NEVER delete memory files (`.claude/memory/`, `.gemini/memory/`, `.ai-context/memory/`). Memories are permanent.
- Memories can be UPDATED (content changed) or MERGED (two files combined into one) but never deleted outright
- If a memory is truly obsolete, ARCHIVE it (move to `memory/archive/`) — do not delete
- This applies to ALL agents, ALL skills, ALL hooks. No exceptions.

## Git Discipline
- MUST NOT modify `flake.lock`, `package-lock.json`, or lock files without explicit permission
- MUST NOT force push to main/master
- MUST create feature branches for multi-commit work
- NEVER auto-commit without the user seeing the diff and approving
- NEVER commit changes that haven't been verified (at minimum: eval passes)
- Prefer editing existing files over creating new ones
- Keep changes minimal and focused — no drive-by refactors

## Code Quality
- Follow existing patterns in the codebase — match style, don't impose it
- No unnecessary comments, docstrings, or type annotations on unchanged code
- No premature abstractions — three similar lines > one clever helper
- Use RFC 2119 keywords (MUST, SHOULD, MAY) when precision matters

## Context Management
- Use `/clear` between unrelated tasks (if tool supports)
- Use subagents for investigation to preserve main context (Claude/Gemini)
- **Prefer context-reset (fresh session + handoff) over compaction for multi-hour work.** Degradation starts around 70-80% context full. At 70% run `/handoff` or equivalent state-save. At 80% stop and hand off unconditionally.
- When reading large files (>2000 lines), check line count first with `wc -l`, then read in chunks — some tools silently truncate
- **`/handoff` is a checkpoint, NOT a stop signal.** At 50-65% context there is no pressure — keep working.

## Superpowers / AI-Generated Artifacts
- Specs, plans, brainstorm artifacts MUST go in `.superpowers/` inside the AI context directory, NEVER in `docs/`
- `docs/` is for real project documentation only
- **Location priority**: `.ai-context/.superpowers/` > `.claude/.superpowers/` > `.gemini/.superpowers/`
- **Structure**: `{specs,plans}/YYYY-MM-DD-<topic>.md`
- **Cross-session continuity**: At session start, check `.superpowers/specs/` and `.superpowers/plans/` for in-progress work. Spec without plan → offer to continue planning. Plan with incomplete phases → offer to resume.

## AI Tracking — 4 persistence layers (v3, 2026-04-16)

| Layer | Where | Written by | Lifetime |
|---|---|---|---|
| **Memory** (what you KNOW) | `~/.ai-context/memory/` (canonical, global), project `.claude/memory/*.md` OR `.ai-context/memory/*.md` | `/reflect`, `/consolidate-memory`, user | permanent (archive, never delete) |
| **Handoff** (detailed state) | `<project>/<canonical-dir>/.session-handoff.md` + versioned copies | `/handoff`, `/wrap-up` | pointer archived >14d, versioned archived >7d keeping 3 newest |
| **Progress** (per-session summary) | `<project>/<canonical-dir>/AI-progress.json` | `reflect-stop.js` hook (Claude/Gemini auto) | permanent append |
| **Tasks** (open work) | `<project>/<canonical-dir>/AI-tasks.json` (v3) | TodoWrite + `todowrite-persist.js` hook | in_progress+blocked persist; done → completed_log cap 50 |
| **Session presence** (multi-agent coord) | `<project>/<canonical-dir>/active-sessions.jsonl` + `~/.claude/cache/active-sessions-global.jsonl` | `session-presence-*.js` hooks | 500-line active, rotate at 5000 |
| **Self-improvement queue** (system health) | `~/.claude/self-improvements-pending-<host>.jsonl` | `meta-system-stop.js` (dual-gate) | cumulative; `/review-improvements` to triage |

**Location rules:**
- `<canonical-dir>` = ONE of: `.claude/` (simple-style) OR `.ai-context/` (nix-style). Never both, never at project root, never duplicated.
- Global `~/.ai-context/` owns canonical memory; `~/.claude/memory/` + `~/.gemini/memory/` are symlinks to it.
- Per-cwd auto-memory at `~/.claude/projects/<sanitized>/memory/` is fallback when project has no local memory dir.
- Sub-repos (`nix/repos/*-nix`, `<user>/Development-*`) track ONLY when actively developed (<30d) — opt-in, not bulk-init.

**Subagent rules:**
- Subagents CANNOT run `git commit|push|merge|rebase|reset --hard|cherry-pick|revert|tag -fd|branch -D|checkout -b|add -A|restore --staged|clean -f|submodule add|worktree add`. Enforced by `block-subagent-writes.js` PreToolUse hook (Claude/Gemini only).
- Read-only git (status, log, diff, show, ls-files, grep) stays allowed.

**AI-tasks.json v3 schema:**
- `tasks[]` = in_progress + blocked (persisted across sessions)
- `completed_log[]` = done items, rotating cap 50
- TodoWrite `pending` = ephemeral; `done` → moves to `completed_log` at session end
- `source: todowrite|gsd|manual` + `verifiedBy: not-verified|unit-test|integration-test|human-tested`

## Tool & Workflow Philosophy
- Enhance workflow silently — background improvements over new commands. Opt-in if command-syntax changes.
- Default: simpler over more powerful.

---

## Memory file format (for any agent writing memories)

Every file in `memory/` has YAML frontmatter. The current schema (v2) drives `memory-rotate.js` and the `memory-retrieval-logger` observability loop.

```yaml
---
name: Short human-readable title
description: One-line searchable description — specific, not filler. Used in MEMORY.md index.
type: user | feedback | project | reference | procedure
created: 2026-04-21          # YYYY-MM-DD when added
last_verified: 2026-04-21    # bumped when content re-checked against reality
last_accessed: 2026-04-21    # auto-updated by memory-retrieval-logger
ttl_days: permanent          # permanent | 180 | 90 | 30
evidence: [file:/abs/path, url:..., commit:<sha>]
status: active               # active | archived | deprecated
# optional:
superseded_by: new_file.md
---
```

Rules for choosing `type`:
- **user** — who the user is, their role, preferences, expertise (permanent)
- **feedback** — corrections and approvals; must include "Why:" and "How to apply:" lines (90d)
- **project** — current state of ongoing work: decisions, blockers, who/why/when (90d)
- **reference** — pointers to external systems (Linear project, Slack channel, Grafana dashboard) (permanent)
- **procedure** — how-tos and runbooks (180d)

Rotation: `memory-rotate.js` (Stop hook, 7-day cooldown) moves a file to `memory/archive/` when `now - last_verified > ttl_days` and `ttl_days != permanent`. Files are archived, never deleted.

Existing v1-frontmatter files (just `name` / `description` / `type` plus optional `superseded_by` / `valid_until`) still load — `memory-migrate.js --migrate-to-v2` upgrades them in place. Write new memories in v2 directly.

See `skills/debt-tracker/SKILL.md` for the DEBT.md format.

## Portable Context Architecture (2026-04-20)

Canonical source lives at `~/.ai-context/`:
```
~/.ai-context/
├── AGENTS.md       ← this file, symlinked from all tool homes
├── memory/         ← global memories (plain markdown with frontmatter)
├── skills/         ← skill descriptions (tool-neutral markdown)
├── mcp/            ← MCP servers (work in any MCP-capable client)
├── scripts/        ← install-adapters.sh, install-mcp.sh, setup-private-remote.sh
└── README.md       ← architecture doc
```

All supported tools read from this single source:
| Tool | Reads | How |
|---|---|---|
| Claude Code | `~/.claude/CLAUDE.md` | symlink → AGENTS.md + MCP via `~/.claude.json` |
| Gemini CLI | `~/.gemini/GEMINI.md` | symlink → AGENTS.md + MCP via `settings.json → mcpServers` |
| Codex CLI | `~/.codex/AGENTS.md` | symlink → AGENTS.md + MCP via `config.toml` |
| OpenCode | `~/.config/opencode/AGENTS.md` | symlink → AGENTS.md + MCP via `config.json` |
| Aider | `~/.config/aider/AGENTS.md` | symlink → AGENTS.md (pass via `--read` arg) |
| Cursor | `.cursor/rules/*.mdc` or `AGENTS.md` | native AGENTS.md fallback + MCP via `~/.cursor/mcp.json` |
| Windsurf | `~/.codeium/windsurf/memories/global_rules.md` | symlink if installed; native AGENTS.md Cascade support Wave 8+ |
| Copilot (cloud) | `AGENTS.md` + `.github/copilot-instructions.md` | native read |
| Cline / Continue.dev | per-tool rules + MCP | MCP auto-registered |
| Any MCP-capable | MCP tools `search_memory`, `list_skills`, `get_rule`, `read_debt`, `list_tasks`, `read_handoff`, etc. | via `personal-context` server |

**How to apply changes:** edit `~/.ai-context/AGENTS.md` → every tool picks it up on next session. No regeneration step.

**How to install on a new machine:**
```bash
# sync ~/.ai-context/ via your method (git clone / Syncthing / rsync)
~/.ai-context/scripts/install-adapters.sh   # drop symlinks
~/.ai-context/scripts/install-mcp.sh        # register MCP server
```

**MCP tools exposed (14):**
- Read: `search_memory`, `read_memory`, `list_memories`, `list_skills`, `get_skill`, `read_debt`, `get_rule`, `read_handoff`, `list_handoffs`, `list_tasks`, `read_progress`, `search_handoffs`
- Write: `add_memory`, `add_debt`

---

## ═════ CLAUDE CODE / GEMINI CLI SPECIFIC ═════
### (Other tools: skip this section)

### AI Context Maintenance
- Editing CLAUDE.md/GEMINI.md/AGENTS.md — all three are the same file via symlink. Just edit `~/.ai-context/AGENTS.md`.
- Skills/rules are living docs — fix stale content on sight.
- `~/.claude/` + `~/.gemini/` can be their own git repos for cross-machine sync. `auto-push-global.js` auto-commits + pushes at Stop. Cooldown-gated. Also syncs shared hooks Claude→Gemini.
- **Self-improvement loop:** `meta-system-stop.js` detectors append findings to `~/.claude/self-improvements-pending-<host>.jsonl`. Run `/review-improvements` to triage. Rejections teach 90-day class suppression via `memory/reference/self-improvement-feedback.md`.

### Cross-Platform Hook Rules
- Sync hooks (`sync-claude-md`, `sync-claude-skills`) MUST be registered under **PostToolUse** (Claude) / **AfterTool** (Gemini) — read files after write completes
- Guard hooks MUST be registered under **PreToolUse** (Claude) / **BeforeTool** (Gemini) — intercept before write
- Claude timeouts are in **seconds**; Gemini timeouts are in **milliseconds** — never confuse them
- Claude tool names: `Write`, `Edit`, `Bash`, `Read`, `Skill`, `Agent`; Gemini tool names: `write_file`, `replace`, `run_shell_command`, `read_file`, `activate_skill`
- Claude session-end event: `Stop`; Gemini session-end event: `SessionEnd`
- When adding a hook: add to BOTH `~/.claude/settings.json` AND `~/.gemini/settings.json` with correct event names, tool names, timeout units

### Enforcement hooks (Claude/Gemini only — other tools don't have this)
- `autosave-before-destructive.js` — auto-stashes before `rm -rf`, `git reset --hard`, etc.
- `verifiedby-gate.js` — nudges when TodoWrite marks task done with empty `verifiedBy`
- `prefer-editing-nudge.js` — warns when creating `foo-v2.ts` next to `foo.ts`
- `block-subagent-writes.js` — hard-blocks subagent git writes

### NixOS (optional — remove if not on NixOS)
- Build system: `nix flake check`, `nix build`, `nixos-rebuild`
- Format: `treefmt` (alejandra for nix, prettier for others)
- Modules use `mkOption`/`mkDefault`, not raw assignment
- Flake inputs MUST be declared in flake.nix inputs section

---

## ═════ CODEX / OPENCODE / AIDER / CURSOR / ETC. SPECIFIC ═════
### (Claude Code / Gemini CLI: ignore)

- Session hooks don't exist in these tools. Rules above that mention "on SessionStart", "at Stop hook", etc. are Claude/Gemini-specific. For Codex/OpenCode, rules are enforced by the AGENTS.md text itself — no automation, just adherence.
- MCP server `personal-context` is available — use it for: `search_memory`, `read_debt`, `list_tasks`, `read_handoff`. That gives you the same knowledge the Claude+Gemini system has.
- Cursor: prefer `.cursor/rules/*.mdc` for glob-scoped rules; this `AGENTS.md` is global fallback.
- Aider: invoke with `aider --read ~/.config/aider/AGENTS.md` (or add to project `.aider.conf.yml` `read:`).

---

## ═════ UNIVERSAL TOOLING CAVEATS ═════

- File reads over 2000 lines: use explicit `offset` + `limit`; some tools silently truncate.
- `~/.claude/` + `~/.gemini/` + `~/.ai-context/` are themselves git repos (private, per-machine or Syncthing/GitHub). Changes auto-commit at session end.
- Safety-critical code paths (customize for your domain): respond in normal prose, not caveman. Fragment misread risk too high.
