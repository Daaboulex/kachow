# Hooks catalog

15 hooks + 28 library helpers. Every hook is pure Node with no external deps; runs identically on Linux, macOS, and Windows. Hooks are registered in `MANIFEST.yaml` and configs are generated per-tool by `generate-settings.mjs`.

## Hook events

| Event | When it fires | Claude | Gemini | Codex | Pi |
|---|---|---|---|---|---|
| SessionStart | Session begins | `SessionStart` | `SessionStart` | `SessionStart` | `session_start` |
| PreToolUse | Before each tool call | `PreToolUse` | `BeforeTool` | `PreToolUse` | `tool_call` |
| PostToolUse | After each tool call | `PostToolUse` | `AfterTool` | `PostToolUse` | `turn_end` |
| Stop | Turn/session ends | `Stop` | `SessionEnd` | `Stop` | `session_shutdown` |
| PreCompact | Before context compaction | `PreCompact` | `PreCompress` | — | `session_before_compact` |
| UserPromptSubmit | After user submits prompt | `UserPromptSubmit` | — | `UserPromptSubmit` | — |

## SessionStart

| Hook | What it does |
|---|---|
| `auto-pull-global` | Pulls latest `~/.ai-context/` from remote. Stash, pull, restore. Async, non-blocking. |
| `session-context-loader` | Loads memory, handoffs, git status, self-improvement queue. Primary context injector. |

## PreToolUse — Safety guards

| Hook | Matcher | What it does |
|---|---|---|
| `agent-dependency-guard` | Agent | Validates subagent dispatch has required context. Claude + Gemini only (Codex has no Agent tool). |
| `block-subagent-writes` | Bash/shell | Blocks subagent shell commands writing outside cwd. |
| `block-subagent-non-bash-writes` | Edit/Write/MCP | Blocks subagent file mutations via non-shell tools. |
| `autosave-before-destructive` | Bash/shell | Auto-stashes before `rm -rf`, `git reset --hard`, `git clean`, `git checkout --`. |
| `pre-write-combined-guard` | Bash/Edit/Write | Enforces path/content policy before any write. |
| `scrub-sentinel` | Edit/Write | Strips sentinel/secret patterns from file content before write. |

## PostToolUse — Monitoring

| Hook | Matcher | What it does |
|---|---|---|
| `context-pressure-enforce` | Bash/Edit/Write | Monitors context fill percentage. Warns at threshold, suggests `/handoff`. |
| `memory-index-updater` | Edit/Write | Rebuilds `MEMORY.md` index after file writes. Async, low priority. |

## PreCompact — Compaction preservation

| Hook | What it does |
|---|---|
| `caveman-precompact` | Writes marker file so caveman mode survives compaction. Claude + Gemini. |

## UserPromptSubmit — Post-compaction recovery

| Hook | What it does |
|---|---|
| `caveman-post-compact-reinject` | Re-injects caveman mode ruleset after compaction. One-shot. Claude only. |

## Stop — Session end

| Hook | What it does |
|---|---|
| `auto-push-global` | Commits + pushes `~/.ai-context/` changes. 5-min push cooldown. |
| `meta-system-stop` | Self-improvement detector. Scans for hook errors, skill regressions. Advisory only. |
| `handoff-session-end` | Saves session state for cross-session handoff. Per-session dedup. |

## Library helpers (`hooks/lib/`)

28 shared modules. Key ones:

| Module | Purpose |
|---|---|
| `tool-detect.js` | Runtime detection of which CLI invoked the hook |
| `tool-paths.js` | Canonical path resolution (all hooks use this) |
| `hook-logger.js` | File-based error logging (replaces stderr) |
| `safety-timeout.js` | Process-level safety timeout |
| `platform-map.js` | Event/tool name translation tables |
| `observability-logger.js` | Event logging for self-improvement |
| `self-improvement/detectors.js` | 19 automated issue detectors |
| `self-improvement/queue.js` | Finding queue with dedup and suppression |

## Hook output format

All hooks write JSON to stdout:

```json
{"continue": true}
```

Block: `{"continue": true, "decision": "block", "reason": "..."}`. Inject context: `{"continue": true, "systemMessage": "..."}`. Exit code 2 = hard block.

## Limits

| Property | Claude | Gemini | Codex | Pi |
|---|---|---|---|---|
| Default timeout | 600s | 60,000ms | 600s | None (bridge: 8s) |
| Output cap | 10,000 chars | Undocumented | Undocumented | 50KB |
| Execution | Parallel | Parallel | Concurrent | Sequential |
