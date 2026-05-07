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
> Symlinked from: `~/.claude/CLAUDE.md`, `~/.gemini/GEMINI.md`, `~/.codex/AGENTS.md`, `~/.config/opencode/AGENTS.md`, `~/.config/aider/AGENTS.md`.
> Override per-project: drop `AGENTS.md` at repo root — deepest wins.
> **Last updated:** 2026-05-06 (v0.9.4 — standardization pass)

## Identity

- **Customize this section.** Add your name, git identity notes, any "never touch" rules.
- Example: `Git signing is configured — NEVER modify git config`
- Example: `NEVER add Co-Authored-By trailers to commits`

## Hard Rules

### Verification First
- MUST run checks/tests after making changes before claiming done
- NEVER mark a task as done, passes, or complete without running a real verification command
- NEVER commit code without verifying it at least evaluates
- If verification requires HUMAN testing (hardware, UI, network): STOP, tell the user what to test, add debug instrumentation FIRST, explain expected output
- No placebo testing — "I read the code and it looks correct" is not verification

### Memory Protection
- NEVER delete memory files (`.claude/memory/`, `.gemini/memory/`, `.ai-context/memory/`). Memories are permanent.
- Memories can be UPDATED or MERGED but never deleted. Obsolete → ARCHIVE to `memory/archive/`.
- Applies to ALL agents, ALL skills, ALL hooks. No exceptions.

### Git Discipline
- MUST NOT modify `flake.lock`, `package-lock.json`, or lock files without explicit permission
- MUST NOT force push to main/master
- MUST create feature branches for multi-commit work
- NEVER auto-commit without the user seeing the diff and approving
- NEVER commit changes that haven't been verified (at minimum: eval passes)
- Prefer editing existing files over creating new ones. Keep changes minimal — no drive-by refactors.
- **GPG sign exception:** `auto-push-global.js` Stop hook uses `--no-gpg-sign` for mechanical `chore: auto-sync from session end` commits in `~/.ai-context` only.

### Safety-Critical Code
- Code paths involving [safety-module]/, [safety-module], [safety-domain], [safety-component]: respond in **normal prose, not caveman**. Fragment misread risk too high.
- Domain rules for embedded C, industrial control, ESP32, React Native: see `~/.ai-context/AGENTS-domain-specific.md` (cwd-gated: only read when task involves the domain).

### Subagent Containment
- Subagents blocked from: git state-changing, gh state-changing, MCP mutations, writes outside cwd/`/tmp/`.
- Enforced by `block-subagent-writes.js` + `block-subagent-non-bash-writes.js` PreToolUse hooks.

### Local-Private Monorepo
- `<project>` is **local-private** — never push to public remotes.

## Response Mode
- **Caveman mode** is the default voice (Claude Code auto-activates via `caveman` plugin; other tools: be terse by default).
- Drop: articles, filler words, pleasantries, hedging. Keep: all technical substance, code blocks, exact error messages, URLs, file paths, line numbers.
- **Auto-clarity exceptions** (respond normally): security warnings, irreversible actions, multi-step sequences where fragment order matters, user asks to clarify or says "normal mode" / "stop caveman".
- Resume caveman mode after the unambiguous part is delivered.
- Code, commits, PR text: write normal (caveman only affects prose output).

## Reasoning Anchors (R-RES)

### R-RES-1: Reasoning template
For non-trivial work (3+ tool calls or 2+ file edits), output before first tool call:
```
Intent: [what + why, 1 sentence]
Approach: [steps, 1-3 lines]
Verification: [what command/test confirms success]
```
Caveman-mode compatible — fragments OK, drop articles. Skip for pure-read or simple-question tasks.

### R-RES-2: Plan anchor
For 3+ tool calls or 2+ file edits, output a **numbered plan** BEFORE first edit. Primary defense against zero-reasoning turns. Plans don't need approval but must exist.

## Code Quality + Context Management
- Follow existing patterns — match style, don't impose it. No unnecessary comments on unchanged code.
- No premature abstractions — three similar lines > one clever helper. Use RFC 2119 keywords when precision matters.
- Use `/clear` between unrelated tasks. Use subagents for investigation to preserve main context.
- **Context thresholds (1M):** degradation ~85-90%. At 85% run `/handoff`. At 92% stop. Do NOT nag below 80%. Do NOT fabricate context percentages.
- `/handoff` is a checkpoint, NOT a stop signal. Large files (>2000 lines): check `wc -l` first, read in chunks.
- Specs/plans MUST go in `.superpowers/` (never `docs/`). Location priority: `.ai-context/.superpowers/` > `.claude/.superpowers/` > `.gemini/.superpowers/`. Structure: `{specs,plans}/YYYY-MM-DD-<topic>.md`.
- Specs, plans, and task descriptions MUST NOT include clock-time or effort estimates (`30min`, `4h`, `~21 hours`, `2 days`, etc.). AI time predictions are always wrong. Use `Complexity: S/M/L/XL` and `Risk: LOW/MEDIUM/HIGH` if sizing needed; otherwise omit sizing entirely.

## Agent Dispatch Rules
- ALWAYS specify `model:` when dispatching subagents. Unspecified = inherits parent model (burns opus tokens on trivial tasks).
- Research/WebFetch: `model: "sonnet"`. Review/spot-check: `model: "haiku"`. Implementation: `model: "sonnet"`. Architecture/planning: `model: "opus"`.
- `.superpowers/specs/` are NOT read by sessions — decisions MUST be copied to AGENTS.md, hooks, or memory to persist.
- Memory files: only 8 loaded with full content per session. Use memories for REFERENCE facts; use AGENTS.md or hooks for BEHAVIORAL rules.
- **Enforcement asymmetry (condensed):** Claude Code has strongest enforcement (~250 permissions + all hooks fire). Gemini/Codex/Crush have medium enforcement (hooks fire but no command allowlist). OpenCode has 15+ JS plugin hooks, full skill system, permissions, and sessions — but no PreToolUse/PostToolUse event hooks like the other 4. Codex `apply_patch` fires hooks (fixed v0.128.0+). Switching tools mid-task does NOT preserve permission boundaries. Full table: see `AGENTS-architecture.md`.

## Architecture Pointers
- **One Brain:** `~/.ai-context/` is the ONLY git repo + Syncthing folder. Tool dirs are derived state (symlinks). Full table: `AGENTS-architecture.md`.
- **Hook registration:** edit `scripts/MANIFEST.yaml` → run `scripts/generate-settings.mjs --apply --all`. All 5 tool configs regenerated.
- **Domain rules:** `~/.ai-context/AGENTS-domain-specific.md` (cwd-gated).
- **Architecture, memory format, portable context, tool read paths:** `~/.ai-context/AGENTS-architecture.md`.
- **Other tools (Aider/Cursor/Windsurf/Copilot/Cline):** see `AGENTS-architecture.md` "Other-tools specifics" section.
- **Upstream blockers + structural limits:** `~/.ai-context/KNOWN-LIMITS.md` — check BEFORE investigating "bugs" in 5-tool parity. If it's there, it's known.

---

## Tool-Specific — All 5 Tools

### AI Context Maintenance
- Editing CLAUDE.md/GEMINI.md/AGENTS.md — all are the same file via symlink. Just edit `~/.ai-context/AGENTS.md`.
- Skills/rules are living docs — fix stale content on sight.
- `auto-push-global.js` auto-commits + pushes at Stop. Tool dirs have NO `.git`.
- **Self-improvement loop:** `meta-system-stop.js` → `~/.claude/self-improvements-pending-<host>.jsonl`. Run `/review-improvements` to triage.

### Cross-Platform Hook Rules
- Guard hooks: **PreToolUse** (Claude/Codex/Crush) / **BeforeTool** (Gemini) — intercept before write
- Sync hooks: **PostToolUse** (Claude/Codex) / **AfterTool** (Gemini) — read after write completes
- Timeouts: Claude/Codex in **seconds**; Gemini in **milliseconds**
- Tool names — Claude: `Write`, `Edit`, `Bash`, `Read`, `Skill`, `Agent`; Gemini: `write_file`, `replace`, `run_shell_command`, `read_file`, `activate_skill`; Codex: `apply_patch`, `shell`, `Read`; Crush: Claude-compatible (lowercase normalized by hooks); OpenCode: JS plugin API (no shell hooks)
- Session-end — Claude/Codex: `Stop`; Gemini: `SessionEnd`; Crush: none (PreToolUse only); OpenCode: JS plugin lifecycle
- Claude: 10+ hook events (incl. CwdChanged, FileChanged, PostCompact, etc. — see `AGENTS-architecture.md`)
- Gemini: 11 hook events (incl. BeforeToolSelection — no Claude equivalent)
- Codex: 6 hook events; `apply_patch` fires hooks (fixed v0.128.0+)
- Crush: PreToolUse hooks (Claude-compatible). Config at `~/.config/crush/crush.json`. No PostToolUse/Stop.
- OpenCode: 15+ JS plugin hooks, skill system, permissions, sessions. No PreToolUse/PostToolUse event hooks. MCP bridge provides memory/task access.
- All hooks MUST import `tool-detect.js` for tool-specific logic. The `isGemini ? X : Y` ternary pattern is **banned** — use `tool` from `detectTool()`.

### Enforcement Hooks (all 5 tools where events exist)
- `autosave-before-destructive.js` — auto-stashes before `rm -rf`, `git reset --hard`, etc.
- `verifiedby-gate.js` — nudges when TodoWrite marks task done with empty `verifiedBy`
- `prefer-editing-nudge.js` — warns when creating `foo-v2.ts` next to `foo.ts`
- `bandaid-loop-detector.js` — detects 3+ edits to same file → prompts root-cause reflection
- `block-subagent-writes.js` — hard-blocks subagent git/gh writes
- `block-subagent-non-bash-writes.js` — hard-blocks subagent MCP mutations + writes outside cwd

### Universal Caveats
- File reads over 2000 lines: use explicit `offset` + `limit`; some tools silently truncate.
- `~/.ai-context/` is the only git repo (private, Syncthing + GitHub). Changes auto-commit at session end. Tool dirs are derived state — no `.git`, no Syncthing.
- Enhance workflow silently — background improvements over new commands. Default: simpler over more powerful.
