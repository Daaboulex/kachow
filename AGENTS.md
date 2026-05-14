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
> Canonical source of truth. Symlinked as CLAUDE.md, GEMINI.md, AGENTS.md per tool.
> Override per-project: drop `AGENTS.md` at repo root — deepest wins.
> **Last updated:** 2026-05-14 (v2.1.0 — Karpathy-informed rewrite)

## Identity

- **Customize this section.** Add your name, git identity notes, any "never touch" rules.
- Example: `Git signing is configured — NEVER modify git config`
- Example: `NEVER add Co-Authored-By trailers to commits`

## Think Before Acting
**Don't assume. Don't hide confusion. Surface tradeoffs.**
- No silent assumptions — state them explicitly before acting
- No picking one interpretation silently — present alternatives if ambiguous
- No diving into code before understanding the problem — ask first
- Push back if a simpler approach exists

The test: _"Did I confirm my understanding before writing code?"_

## Simplicity First
**Minimum code that solves the problem. Nothing speculative.**
- No features beyond what was asked
- No abstractions for single-use code
- No "flexibility" or "configurability" that wasn't requested
- No error handling for impossible scenarios
- Three similar lines > premature abstraction
- If 200 lines could be 50, rewrite it

The test: _"Would a senior engineer say this is overcomplicated?"_

## Surgical Changes
**Touch only what you must. Clean up only your own mess.**
- No "improving" adjacent code, comments, or formatting
- No refactoring things that aren't broken
- Match existing style even if you'd do it differently
- Remove imports/variables/functions YOUR changes made unused
- Don't remove pre-existing dead code unless asked

The test: _"Every changed line traces directly to the user's request."_

## Verification First
**Define success criteria. Loop until verified.**
- MUST run checks/tests after changes before claiming done
- NEVER commit unverified code
- Transform tasks into verifiable goals:
  - Instead of "add validation" → "write tests for invalid inputs, make them pass"
  - Instead of "fix the bug" → "reproduce, identify root cause, fix, verify fix"
- Hardware/UI testing: STOP, tell user what to test, add debug instrumentation FIRST
- After hook edits: `echo '{}' | node <hook>` AND `node scripts/test-hooks.mjs`
- After settings changes: `node scripts/generate-settings.mjs --apply` + `node scripts/verify.mjs`

These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## Hard Rules

### Memory Protection
- NEVER delete memory files. Archive only. No exceptions.

### Git Discipline
- MUST NOT modify lock files without permission. MUST NOT force push main/master.
- NEVER auto-commit without user approval. Prefer editing existing files.
- GPG sign exception: `auto-push-global.js` uses `--no-gpg-sign` for mechanical auto-sync commits in `~/.ai-context` only.

### Safety-Critical Code
- [safety-module]/, [safety-module], [safety-domain], [safety-component]: respond in **normal prose, not caveman**. See `AGENTS-domain-specific.md`.

### Subagent Containment
- Subagents blocked from: git/gh state-changing, MCP mutations, writes outside cwd/`/tmp/`.
- Enforced by `block-subagent-writes.js` + `block-subagent-non-bash-writes.js`.

## Response Mode
- **Caveman mode** default. Drop: articles, filler, pleasantries, hedging. Keep: all technical substance.
- Auto-clarity exceptions: security warnings, irreversible actions, ambiguous sequences.
- Code, commits, PR text: write normal.

## Directory Layout
- `core/` — memory, skills, commands (global shared resources)
- `modules/tools/<tool>/` — per-tool adapter configs (Claude, Gemini, Codex, Pi)
- `modules/hooks/src/` — 15 registered hooks + `lib/` shared utilities
- `modules/hooks/MANIFEST.yaml` — declarative hook registration (tool-neutral)
- `modules/skill-exclusions.yaml` — centralized exclusion list (all 4 CLIs)
- `generated/configs/` — tool settings (never hand-edit, regenerated from MANIFEST)
- `runtime/` — cache, sessions, self-improvement queue (excluded from sync)
- `.agents/skills/` — plugin-installed skills (cross-tool discovery)
- `scripts/` — generate-settings, verify, test-hooks, verify-symlinks, install-adapters

## Code Quality

### Hooks/scripts (Node.js)
- Every hook MUST pass `node --check <file>` before committing
- Hooks MUST return valid JSON with `"continue"` field
- Use `tool-paths.js` for paths — never hardcode
- Use `hook-logger.js` for errors — never `process.stderr.write`
- Shared logic in `modules/hooks/lib/`, not duplicated

### Configs (YAML/JSON/TOML)
- YAML: no tabs, 2-space indent
- JSON: `JSON.parse()` must pass
- TOML: `tomllib.load()` must pass
- SKILL.md: frontmatter `name:` matches directory basename

### NixOS-specific
- System runs NixOS (CachyOS kernel). Binaries in `/nix/store/`.
- Packages via `nix profile` or `environment.systemPackages`, not apt/brew.
- `.stignore` managed via Home Manager, not hand-edited.

## Reasoning Anchors
- **R-RES-1:** For 3+ tool calls: state Intent/Approach/Verification before first tool call.
- **R-RES-2:** For 3+ tool calls: numbered plan BEFORE first edit.
- **R-RES-3:** Before multi-agent dispatch: list dependencies per agent. Parallel only if independent.
- **R-RES-4:** Pre-dispatch: need agent? files exist? write collision? fork vs subagent? model choice?
- **R-RES-5:** After EVERY subagent return: verify claims against filesystem.
- **R-RES-6:** Codex fabricates file counts/symlinks/test results. NEVER delegate live-state verification to Codex.

## Agent Dispatch
- ALWAYS specify `model:` — sonnet (research/implementation), haiku (mechanical), opus (architecture).
- Context thresholds (1M): at 85% run `/handoff`, at 92% stop. Don't nag below 80%.
- Specs/plans go in `docs/superpowers/specs/`. No clock-time estimates — use S/M/L/XL complexity.

## Tools — 4 Supported
| Tool | Rules file | Config | Hooks | Skills |
|------|-----------|--------|-------|--------|
| Claude Code | CLAUDE.md→AGENTS.md | generated/configs/claude-settings.json | 15 via JSON (args[] exec form) | plugins + .agents/ |
| Gemini CLI | GEMINI.md→AGENTS.md | generated/configs/gemini-settings.json | 15 via JSON (ms timeouts) | .agents/ only |
| Codex | AGENTS.md→AGENTS.md | generated/configs/codex-config.toml | 15 via TOML | .agents/ only |
| Pi | AGENTS.md→AGENTS.md | modules/tools/pi/settings.json | 13 via kachow-bridge.ts | .agents/ (filtered) |

- Registration: `MANIFEST.yaml` → `generate-settings.mjs --apply` → per-tool configs + Pi bridge
- All hooks use `detectTool()` from `lib/tool-detect.js`. The `isGemini ? X : Y` pattern is banned.
- Exclusions: `modules/skill-exclusions.yaml` → generates filters for all 4 CLIs.
- New project: `bash scripts/init-project.sh /path`
- New machine: `node scripts/install-adapters.mjs`

## Success Criteria
These rules are working if:
- Fewer unnecessary changes in diffs
- Clarifying questions come before implementation, not after mistakes
- Every changed line traces to the user's request
- Hooks pass `node scripts/test-hooks.mjs` after every edit
- Configs validate after every `generate-settings.mjs --apply`
