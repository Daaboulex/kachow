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
> - **Last updated:** 2026-05-01 (Codex apply_patch fix v0.128.0+; new hook events CwdChanged/FileChanged/PostCompact/etc; Gemini v0.40 events)
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

## Reasoning Anchors (R-RES)

### Reasoning template (R-RES-1)
For non-trivial work (3+ tool calls or 2+ file edits), output before first tool call:
```
Intent: [what + why, 1 sentence]
Approach: [steps, 1-3 lines]
Verification: [what command/test confirms success]
```
Caveman-mode compatible — fragments OK, drop articles. Skip for pure-read or simple-question tasks.

### Plan anchor (R-RES-2)
For any task involving 3+ tool calls or 2+ file edits, output a **numbered plan** BEFORE first edit. Primary defense against Opus 4.7 zero-reasoning turns.
```
Plan:
1. Read X to understand current shape
2. Edit Y to apply fix
3. Run regression battery
4. Commit + sync
```
Plans don't need approval but they must exist.

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
- **GPG sign exception:** `auto-push-global.js` Stop hook commits use `--no-gpg-sign`. Auto-sync commits are mechanical session-end snapshots, not user-authored work; forcing GPG sign would either prompt for passphrase (breaks non-interactive autopush) or silently fail (breaks data preservation). User-authored commits remain signed via standard git config. This exception applies ONLY to `chore: auto-sync from session end` commits in `~/.claude`, `~/.gemini`, `~/.codex`, `~/.ai-context`.

## Tri-Tool Enforcement Asymmetry (added 2026-04-29 — adversarial audit finding)

**Important: tri-tool parity is a STORY about hook FILES, not about behavioral guarantees.** The 3 tools have structurally different enforcement strength.

| Tool | Permission allowlist | Hook coverage of writes | Enforcement strength |
|---|---|---|---|
| **Claude Code** | ~250 enforced `permissions.allow` entries | All Write/Edit/Bash hooks fire | **Strongest** |
| **Gemini CLI** | NO `permissions` key in settings | All `write_file`/`replace`/`run_shell_command` hooks fire | Medium — no command allowlist |
| **Codex CLI** | `trust_level = "trusted"` (project-scope flag, not allowlist) | apply_patch hook fix claimed in PR #18391 (v0.128.0+) — **UNVERIFIED empirically**. `shell` writes DO fire hooks. | Medium — verify apply_patch fires hooks before relying on it |

**Implications:**
- Switching from Claude to Gemini/Codex mid-task does NOT preserve permission boundaries. A user blocked by Claude's permissions may successfully run the same operation in Gemini or Codex.
- Codex `apply_patch` hook fix (PR #18391) is claimed merged but **not empirically verified**. Until verified: use `shell` for sensitive writes in Codex. Config.toml still warns about this.
- For sensitive writes in Codex, prefer `shell cat > file <<EOF ... EOF` until apply_patch hook firing is confirmed by testing.
- `tri-tool-parity-check` hook reports HOOK FILE drift, not behavioral equivalence. A clean parity report does NOT mean the 3 tools enforce equivalently.

**This is structural, not a bug.** Gemini and Codex don't have Claude's permission vocabulary; perfect parity is impossible until upstream changes.

## 5-Repo Live-Together System

Hooks are canonical at `~/.ai-context/hooks/` — all 3 tools see same files via symlink. Editing one file covers all tools.
Adding a NEW hook requires registering in all 3 settings/configs (Claude JSON, Gemini JSON, Codex TOML).

Full repo table, coupling rules, and release procedures: see `AGENTS-architecture.md`.

## Code Quality
- Follow existing patterns in the codebase — match style, don't impose it
- No unnecessary comments, docstrings, or type annotations on unchanged code
- No premature abstractions — three similar lines > one clever helper
- Use RFC 2119 keywords (MUST, SHOULD, MAY) when precision matters

## Context Management
- Use `/clear` between unrelated tasks (if tool supports)
- Use subagents for investigation to preserve main context (Claude/Gemini)
- **Prefer context-reset (fresh session + handoff) over compaction for multi-hour work.** On 1M context: degradation starts around 85-90%. At 85% run `/handoff`. At 92% stop unconditionally. Do NOT nag about context below 80% — it wastes tokens and annoys the user.
- When reading large files (>2000 lines), check line count first with `wc -l`, then read in chunks — some tools silently truncate
- **`/handoff` is a checkpoint, NOT a stop signal.** Below 80% context there is zero pressure — keep working. Do not mention context percentage unless asked or above 80%.
- **Do NOT fabricate context percentages.** If you don't have the actual value from the status line or context-pressure hook, don't guess. Say "I don't know the exact percentage" rather than inventing a number.

## Superpowers / AI-Generated Artifacts
- Specs, plans, brainstorm artifacts MUST go in `.superpowers/` inside the AI context directory, NEVER in `docs/`
- `docs/` is for real project documentation only
- **Location priority**: `.ai-context/.superpowers/` > `.claude/.superpowers/` > `.gemini/.superpowers/`
- **Structure**: `{specs,plans}/YYYY-MM-DD-<topic>.md`

## AI Tracking — see `~/.ai-context/AGENTS-architecture.md` for full schemas
Subagents blocked from: git state-changing, gh state-changing, MCP mutations, writes outside cwd/`/tmp/`.

## Tool & Workflow Philosophy
- Enhance workflow silently — background improvements over new commands. Opt-in if command-syntax changes.
- Default: simpler over more powerful.

## Agent Dispatch Rules (ENFORCED — learned 2026-04-28)
- When dispatching subagents via Agent tool, ALWAYS specify `model:` parameter. Unspecified = inherits parent model (burns opus tokens on trivial tasks).
- Research/WebFetch agents: `model: "sonnet"`. NEVER haiku for web research — haiku hallucinates ~20% of web claims (verified: 2/10 fabricated).
- Review/spot-check (file reads, grep): `model: "haiku"`.
- Implementation: `model: "sonnet"`. Architecture/planning: `model: "opus"`.
- `.superpowers/specs/` are NOT read by sessions. Decisions in specs MUST be copied to AGENTS.md, hooks, or memory to persist.
- Memory files: only 8 loaded with full content per session (`MEMORY_INJECTION_FULL_COUNT=8`, was 3 before 2026-04-28 bump). Use memories for REFERENCE facts. Use AGENTS.md or hooks for BEHAVIORAL rules.

---

## Architecture Reference
Memory format, portable context, tool→read paths: see `~/.ai-context/AGENTS-architecture.md`.

---

## ═════ CLAUDE CODE / GEMINI CLI SPECIFIC ═════
### (Other tools: skip this section)

### AI Context Maintenance
- Editing CLAUDE.md/GEMINI.md/AGENTS.md — all three are the same file via symlink. Just edit `~/.ai-context/AGENTS.md`.
- Skills/rules are living docs — fix stale content on sight.
- `~/.claude/` + `~/.gemini/` + `~/.codex/` are git repos (<repo>, <repo>, codex-global). `auto-push-global.js` auto-commits + pushes all three at Stop. Cooldown-gated.
- **Self-improvement loop:** `meta-system-stop.js` detectors append findings to `~/.claude/self-improvements-pending-<host>.jsonl`. Run `/review-improvements` to triage. Rejections teach 90-day class suppression via `memory/reference/self-improvement-feedback.md`.

### Cross-Platform Hook Rules
- Sync hooks (`sync-claude-md`, `sync-claude-skills`) MUST be registered under **PostToolUse** (Claude) / **AfterTool** (Gemini) — read files after write completes
- Guard hooks MUST be registered under **PreToolUse** (Claude) / **BeforeTool** (Gemini) — intercept before write
- Claude timeouts are in **seconds**; Gemini timeouts are in **milliseconds**; Codex timeouts are in **seconds** — never confuse them
- Claude tool names: `Write`, `Edit`, `Bash`, `Read`, `Skill`, `Agent`; Gemini tool names: `write_file`, `replace`, `run_shell_command`, `read_file`, `activate_skill`; Codex tool names: `apply_patch`, `shell`, `Read` (NOT same as Claude)
- Claude session-end event: `Stop`; Gemini session-end event: `SessionEnd`; Codex session-end event: `Stop`
- When adding a hook: add to ALL THREE — `~/.claude/settings.json` (JSON), `~/.gemini/settings.json` (JSON), `~/.codex/config.toml` (TOML `[[hooks.Event]]`)
- Codex: only 5 hook events (PostToolUse, PreToolUse, SessionStart, Stop, UserPromptSubmit); `apply_patch` now fires hooks (fixed v0.128.0+, was openai/codex#16732)

New hook events (v2.1.83+) and CLI changelog notes: see `AGENTS-architecture.md`.

### Enforcement hooks (all 3 tools where events exist)
- `autosave-before-destructive.js` — auto-stashes before `rm -rf`, `git reset --hard`, etc.
- `verifiedby-gate.js` — nudges when TodoWrite marks task done with empty `verifiedBy`
- `prefer-editing-nudge.js` — warns when creating `foo-v2.ts` next to `foo.ts`
- `bandaid-loop-detector.js` — detects 3+ edits to same file → prompts root-cause reflection
- `block-subagent-writes.js` — hard-blocks subagent git writes

### Domain-specific tech rules (lazy-load)
When working in these domains, READ `~/.ai-context/AGENTS-domain-specific.md` for full rules:
- **NixOS** — flake check / build / treefmt / mkOption-mkDefault
- **Embedded C / ARM Cortex-M ([mcu-family])** — toolchain, [rtos] priorities, dual-bank, safety scope
- **ESP32 / IDF / PlatformIO** — pio run, [protocol] framing, env filters, MQTT QoS
- **React Native / Expo** — EAS build, MQTT keepalive, field-UI specs
- **Industrial Control** — [fieldbus] RTU/TCP, [fieldbus], [safety-domain], PST, [protocol], IEC 61508/61511

Cwd-gated: only read when current task involves the domain.

---

## Other-tools specifics (lazy-load)

For Codex / OpenCode / Aider / Cursor / Windsurf / Copilot / Cline / Continue.dev: these lack session hooks. Rules in this file are enforced by adherence, not automation. MCP server `personal-context` is the cross-tool bridge. Full per-tool guidance: see `~/.ai-context/AGENTS-architecture.md` ("Other-tools specifics" section).

---

## ═════ UNIVERSAL TOOLING CAVEATS ═════

- File reads over 2000 lines: use explicit `offset` + `limit`; some tools silently truncate.
- `~/.claude/` + `~/.gemini/` + `~/.codex/` + `~/.ai-context/` are themselves git repos (private, per-machine or Syncthing/GitHub). Changes auto-commit at session end.
- Safety-critical code paths (customize for your domain): respond in normal prose, not caveman. Fragment misread risk too high.
