# Hook Coverage — Structural Asymmetry Across AI Tools

Documents which hook events exist in which tools, why gaps are structural (not bugs),
and what coverage the 72 hooks in MANIFEST.yaml actually achieve.

Generated from: `scripts/MANIFEST.yaml` + architecture docs.
Last updated: 2026-05-05 (Crush added as 4th tool).

---

## Tool Versions Tested

| Tool | Version |
|---|---|
| Claude Code | 2.1.128 |
| Gemini CLI | 0.40.1 |
| Codex CLI | 0.128.0 |
| Crush | 0.65.3 |
| OpenCode | 1.14.x |

---

## Event Coverage Matrix

Claude canonical names used throughout. Gemini/Codex/Crush names shown in parentheses where different.

| Event (Claude name) | Claude | Gemini | Codex | Crush | Notes |
|---|---|---|---|---|---|
| `SessionStart` | ✓ | ✓ (`SessionStart`) | ✓ (matcher: `startup\|resume`) | ✗ | Universal except Crush |
| `PreToolUse` | ✓ | ✓ (`BeforeTool`) | ✓ (`PreToolUse`) | ✓ | Universal |
| `PostToolUse` | ✓ | ✓ (`AfterTool`) | ✓ (`PostToolUse`) | ✗ | All except Crush |
| `Stop` | ✓ | ✓ (`SessionEnd`) | ✓ (`Stop`) | ✗ | All except Crush |
| `UserPromptSubmit` | ✓ | ✗ | ✓ | ✗ | Gemini/Crush no; Codex only |
| `SubagentStart` | ✓ | ✓ (`BeforeAgent`) | ✗ | ✗ | Codex/Crush have no subagent model |
| `SubagentStop` | ✓ | ✓ (`AfterAgent`) | ✗ | ✗ | Same reason |
| `PreCompact` | ✓ | ✓ (`PreCompress`) | ✗ | ✗ | Codex/Crush have no compaction system |
| `PostCompact` | ✓ | ✗ | ✗ | ✗ | Claude-only |
| `CwdChanged` | ✓ | ✗ | ✗ | ✗ | Claude-only |
| `FileChanged` | ✓ | ✗ | ✗ | ✗ | Claude-only |
| `Notification` | ✓ | ✓ (`Notification`) | ✗ | ✗ | Codex/Crush no notification system |
| `BeforeToolSelection` | ✗ | ○ (available, unused) | ✗ | ✗ | Gemini-only |
| `BeforeModel` | ✗ | ○ (available, unused) | ✗ | ✗ | Gemini-only |
| `AfterModel` | ✗ | ○ (available, unused) | ✗ | ✗ | Gemini-only |

**Legend:** ✓ supported and used  ✗ not available  ○ available but no hooks registered

---

## Hook Coverage Summary

Counts derived from `scripts/MANIFEST.yaml` (72 hooks, order 1–72).

| Coverage | Count | Notes |
|---|---|---|
| Total hooks in manifest | 72 | All hooks across all tools |
| Registered in all 3 tools | 40 | `tools: [claude, codex, gemini]` |
| Claude + Gemini only | 18 | No Codex/Crush equivalent event or not ported |
| Claude + Codex only | 6 | All on `UserPromptSubmit` (Gemini/Crush dropped event) |
| Gemini only | 5 | Gemini-side sync hooks (`sync-claude-md`, `sync-claude-skills`, `sync-claude-agents`, `claude-gemini-json-sync`, `sync-memory-dirs`) |
| Claude only | 3 | `memory-post-compact.js`, `cwd-changed-watcher.js`, `file-changed-notify.js` — events don't exist elsewhere |
| Crush only | 1 | `block-subagent-writes.js` on `PreToolUse` (5 critical PreToolUse hooks active) |

**Effective coverage by tool:**

| Tool | Hooks active | % of 72 |
|---|---|---|
| Claude | 40 + 18 + 6 + 3 = 67 | 93% |
| Gemini | 40 + 18 + 5 = 63 | 88% |
| Codex | 40 + 6 = 46 | 64% |
| Crush | 5 (PreToolUse only) | 7% |
| OpenCode | 0 | 0% (no hooks) |

---

## Structural Limitations — Why Each Gap Exists

### `PostCompact` — Claude only

Claude Code compacts context in-session when the context window pressure triggers it.
`PostCompact` fires after compaction completes; used by `memory-post-compact.js` to re-inject
critical context the compaction may have dropped.

Gemini and Codex have no in-session compaction system. No equivalent event exists or is planned.
Workaround: none. Memory re-injection on PostCompact is Claude-exclusive.

### `CwdChanged` — Claude only

Claude Code tracks the working directory for each tool call and emits `CwdChanged` when `cd`
changes it. `cwd-changed-watcher.js` uses this to reload project-scoped AGENTS.md on directory
switch.

Gemini and Codex do not expose directory-change tracking in their hook APIs. A tool call to `cd`
is opaque to their hook system.

### `FileChanged` — Claude only

Claude Code can be told to watch specific file paths (returned from a `CwdChanged` handler via
`watchPaths`). When those files change on disk, `FileChanged` fires. `file-changed-notify.js`
watches `.envrc`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`.

Gemini and Codex have no filesystem watcher API. External file changes are invisible.

### `UserPromptSubmit` — Claude + Codex; Gemini dropped

Gemini CLI had this event added but it never fired reliably and was subsequently removed.
Six hooks use `UserPromptSubmit`: `caveman-post-compact-reinject.js`, `per-prompt-overhead.js`,
`prompt-hash-logger.js`, `prompt-item-tracker.js`, `prompt-clarity-check.js`,
`slash-command-logger.js`. All are registered for claude+codex, none for gemini.

Consequence: per-prompt guardrails (caveman reinject, prompt clarity, slash-command logging)
are blind in Gemini sessions.

### `SubagentStart` / `SubagentStop` — Claude + Gemini; not Codex

Claude and Gemini both support spawning subagents (nested AI agent calls). Both expose events
around subagent lifecycle. Gemini maps these to `BeforeAgent`/`AfterAgent` — handled by
`platform-map.js` at registration time.

Codex CLI has no subagent model; it runs single-agent sessions only. `subagent-harness-inject.js`
and `subagent-quality-gate.js` have no registration path for Codex.

Consequence: subagent safety harness (`block-subagent-writes.js` covers this via `PreToolUse`
on Bash, but the richer `subagent-harness-inject.js` context injection is absent in Codex).

### `Notification` — Claude + Gemini; not Codex

Claude and Gemini both have a notification/alert system that generates `Notification` events
(e.g., long-running task complete, rate-limit warn). `notify-with-fallback.js` handles these.

Codex has no notification system in v0.128.0.

### `BeforeToolSelection` — Gemini only (unused)

Fires before the LLM selects which tool to call. Can filter the available toolset per-context.
No Claude or Codex equivalent. Currently no hooks registered for this event — see Future
Opportunities below.

### `BeforeModel` / `AfterModel` — Gemini only (unused)

Intercept points around the model call itself. Could adjust sampling parameters, inject context,
or log token usage per-request. No Claude or Codex equivalent. Currently unused.

### Gemini-only sync hooks (5 hooks)

`sync-claude-md.js`, `sync-claude-skills.js`, `sync-claude-agents.js`,
`claude-gemini-json-sync.js`, `sync-memory-dirs.js` — these exist because Gemini writes to its
own config tree and needs to mirror changes back to canonical `~/.ai-context/` and `~/.claude/`.
Claude and Codex don't need equivalent hooks because they write directly to canonical paths or
their symlinks are one-way.

---

## Command / Skill Coverage

14 user-facing commands (slash commands in Claude, contextual skills in Gemini, `cmd-*` in Codex):

| Command | Claude | Gemini | Codex |
|---|---|---|---|
| `/reflect` | auto-converted | auto-converted | `cmd-reflect.md` — working |
| `/consolidate-memory` | auto-converted | contextual activation | `cmd-consolidate-memory.md` — working |
| `/handoff` | auto-converted | contextual activation | `cmd-handoff.md` — working |
| `/wrap-up` | auto-converted | contextual activation | `cmd-wrap-up.md` — working |
| `/clear` | native | native | native (no hook needed) |
| `/hook-utilization-report` | auto-converted | contextual activation | needs manual adaptation |
| `/review-improvements` | auto-converted | contextual activation | needs manual adaptation |
| `/gsd:*` | plugin (GSD) | plugin (GSD) | `cmd-gsd-*.md` — needs adaptation |
| `/research` | auto-converted | contextual activation | needs manual adaptation |
| `/skill` | Skill tool native | contextual activation | shell-based — needs adaptation |
| `/dream` | auto-converted | contextual activation | `cmd-dream.md` — working |
| `/deep-verify-scrub` | auto-converted | contextual activation | needs manual adaptation |
| `/verify-by-evidence` | auto-converted | contextual activation | needs manual adaptation |
| `/handoff-context` | auto-converted | contextual activation | `cmd-handoff-context.md` — working |

**"auto-converted"**: Claude slash commands are `.md` files in `~/.claude/commands/`; format is
portable and Claude Code renders them natively.

**Codex `cmd-*` notes**: Codex reads `~/.codex/skills/cmd-*.md` as prompt-injected skills.
Hooks-dependent commands (anything that relies on PostToolUse side-effects after the command runs)
need manual adaptation because Codex skill invocation doesn't chain back to hook infrastructure
the same way.

---

## Future Opportunities

### Gemini `BeforeToolSelection`

Could filter available tools per-context: e.g., restrict to read-only tools when working in
safety-critical paths, or suppress MCP tools in subagents. No Claude/Codex equivalent makes this
a Gemini-exclusive enhancement.

Candidate hook: `tool-selection-guard.js` — whitelist/blacklist tool availability based on
`AI_CONTEXT_SAFETY_SCOPE` env or cwd pattern.

### Gemini `BeforeModel` / `AfterModel`

`BeforeModel`: inject per-request context (current task, active handoff summary) without
bloating every system prompt.

`AfterModel`: log token usage per model call for cost attribution. Currently only session-level
totals are available.

### Codex gaining additional events

Codex v0.128.0 supports 5 events. PRs in openai/codex are open for `SubagentStart`/`SubagentStop`
equivalents and a `ContextPressure` event. Monitor releases; `subagent-harness-inject.js` is
already written and would need only a config.toml registration entry to activate.

### Claude `ConfigChange` / `PostToolBatch` (v2.1.105+, not yet adopted)

`ConfigChange` — fires when `settings.json` changes; could trigger `tri-tool-parity-check.js`
inline instead of waiting for next SessionStart.

`PostToolBatch` — fires after parallel tool batch resolves; exit 2 can halt agentic loop.
Useful for safety gates that currently run per-tool (would reduce hook invocations on batches).
