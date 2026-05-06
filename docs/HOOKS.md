# Hooks catalog

60+ shipped hooks + 28 library helpers. Every one is pure Node with no external deps; runs identically on Linux, macOS, and Windows (where the host AI CLI supports hooks). Hooks marked ⁱ are documented for reference but excluded from the public mirror.

Registered under `hooks.<event>[].hooks[]` in the tool's settings JSON. See `settings.template.json` for the wiring.

## SessionStart

Fires once at the beginning of every session.

| Hook | What it does |
|---|---|
| `auto-pull-global` | Pulls the latest `~/.claude/` and `~/.gemini/` from their private remotes before work starts. Stash → pull with rebase → restore. On conflict: commits locally and prints next steps. |
| `plugin-update-checker` | Checks installed Claude Code plugins for updates (async, non-blocking). |
| `session-start-combined` | 11 subsystems merged into one Node process (reflect-enabled check, consolidate-memory counter, stale task cleanup, symlink integrity check, etc.). Saves ~200 ms of spawn time. |
| `skill-upstream-checker` | Checks upstream skill repos for updates on a 7-day cooldown. Network failures silently skip — never blocks session start. |
| `session-presence-start` | Registers this session in the presence files so other sessions can see who's active. |
| `validate-instructions-sync` | Validates `CLAUDE.md ↔ GEMINI.md` drift. Fires at `SessionStart`. |
| ~~validate-symlinks~~ | **Merged** into `session-start-combined` section 10. No standalone file. |
| `session-context-loader` | Loads rules summary, memories, tasks, git status, handoffs, and self-improvement queue at session start. Primary context injector (~1100 tokens). |
| `injection-size-monitor` | Monitors total injection bytes at session start. Warns on stderr if total exceeds budget. |
| `handoff-triage-gate` | Checks for stale deferred items at session start. Surfaces unresolved handoffs from previous sessions. |
| `tool-parity-check` | Detects hook registration drift between Claude, Gemini, Codex, Crush, and OpenCode on a 24h cooldown. Reports only actionable gaps (excludes structural event differences). |
| `detect-sync-conflicts` ⁱ | Scans for Syncthing conflict files in AI context directories. Silent when clean. |
| `gsd-check-update` ⁱ | Checks GSD plugin version on a cooldown. Silent when current. |

## PostToolUse

Fires after each tool call (matcher-scoped — not every hook runs on every tool).

| Hook | Matcher | What it does |
|---|---|---|
| `session-presence-track` | `Write\|Edit\|MultiEdit\|Bash\|Read\|Grep\|Glob\|TodoWrite` | Async heartbeat every N tool calls so session is known to be alive. |
| `todowrite-mirror` | `TodoWrite` | Caches the current todo list per-session so the Stop hook can promote in-progress items. |
| `context-pressure-enforce` | `Write\|Edit\|MultiEdit\|Bash` | Enforces the context pressure thresholds documented in `AGENTS.md` — EARLY warning at 80% used, SOFT nudge at 85%, HARD enforce at 92%. |
| `post-write-sync` | `Write\|Edit` | Combined sync hook — `CLAUDE.md → GEMINI.md` translation, `commands/skills/rules` mirroring, `AI-tasks / AI-progress` bidirectional sync. Runs 4 ops in one process. |
| `skill-invocation-logger` | `Skill` | Logs skill invocations to a session-local temp file. Feeds `track-skill-usage` at Stop. |
| `hook-doc-drift-detector` | `Write\|Edit` on `*.claude/hooks/*.js` | When a hook is edited, scans project `CLAUDE.md` files for stale references to that hook. |
| `dead-hook-detector` | `Write\|Edit` | When a hook file is modified, checks it's registered in `settings.json` — flags orphans. |
| `memory-retrieval-logger` | `Read` | Logs memory-file reads to a per-machine retrieval log (informs the memory decay schedule). |
| `research-lint` | `Write\|Edit` | Lints research writes under `~/Documents/research/` for source-citation drift. Requires `~/Documents/research` directory to be present (Node-native, no platform gate). |
| `bandaid-loop-detector` | `Write\|Edit` | Detects 3+ edits to the same file within one session. Prompts root-cause reflection instead of continuing patch-on-patch. |
| `skill-completion-correlator` | `Bash` (async) | D3 instrumentation — correlates skill invocations with their completion events for analytics. |
| `skill-drift-guard` | (all) | Re-injects behavioral rules every 60th tool call to prevent model drift in long sessions. |
| `rule-enforcement-check` | (all, async) | Checks that Agent dispatch includes model:param as required by AGENTS.md. |
| `handoff-auto-save` | `Bash` (async) | Auto-saves handoff state when meaningful writes are detected mid-session. |
| `claude-gemini-json-sync` ⁱ | `Write\|Edit` | After editing `.gemini/` or `.claude/` JSON files (AI-tasks, AI-progress), auto-copies to the other agent's equivalent directory. Gemini-only. |
| `post-commit-sync-reminder` ⁱ | `Bash` | After a git commit in a dual-remote project, reminds to sync. Detects dual-remote projects by trait, not name. |
| `repomap-refresh` ⁱ | `Write\|Edit` (async) | Refreshes DL2 repo map on C/H file writes in Development-DL2/. |

## PreToolUse

Fires before tool execution. Returning a non-zero exit can block the tool call.

| Hook | Matcher | What it does |
|---|---|---|
| `verifiedby-gate` | `TodoWrite` | Blocks TodoWrite attempts that mark a task done with an empty `verifiedBy` field. |
| `validate-settings-on-write` | `Write` on settings.json | Validates the edit BEFORE it's written. Prevents broken hooks from silently killing settings. |
| `prefer-editing-nudge` | `Write` | Warns when a Write creates `foo-v2.ts` next to an existing `foo.ts`. |
| `block-subagent-writes` | `Bash` (subagent ctx) | Hard-blocks subagents from running state-changing git commands (`commit / push / reset --hard / rebase / merge / cherry-pick / ...`). |
| `autosave-before-destructive` | `Bash` | Auto-git-stash before `rm -rf`, `git reset --hard`, and similar. |
| `pre-write-combined-guard` | `Write\|Edit\|Bash` | Combined write guard — blocks lock file modifications, validates paths, enforces project identity constraints. |
| `peer-conflict-check` | `Write\|Edit` (async) | Anti-skew — checks if another session modified the same file. Warns before overwrite. |
| `scrub-sentinel` | `Write\|Edit\|Bash` | Public repo protection — blocks writes that would leak forbidden tokens into scrubbed repos. |
| `block-subagent-non-bash-writes` | `Write\|Edit` (subagent ctx) | Hard-blocks subagent non-Bash writes to prevent uncontrolled file creation. |
| `prompt-clarity-check` | (UserPromptSubmit) | Detects ambiguous prompts and suggests clarification. Note: fires on UserPromptSubmit event in Claude, not PreToolUse. |

## Stop

Fires once at session end. Data-safety hooks (commit local before network) come first.

| Hook | What it does |
|---|---|
| `session-presence-end` | Removes this session from presence files. |
| `todowrite-persist` | Promotes in-progress + blocked todos from session cache into the project's `AI-tasks.json`. Done todos go to `completed_log`. |
| `reflect-stop` | Nudges the agent to run `/wrap-up` if meaningful work happened and it hasn't already. |
| `dream-auto` | Runs `/consolidate-memory` with dual-gate trigger (time + session count). Merges duplicates, archives stale. |
| `memory-rotate` | Rotates expired memories to `archive/` on a 7-day cooldown. |
| `auto-push-global` | Commits `~/.claude/`, `~/.gemini/`, `~/.codex/` locally (no cooldown), pushes on a 5-min cooldown. Fetch-rebase-push on conflict. Optionally also covers `~/.ai-context/` (`AI_CONTEXT_AUTOCOMMIT=1` / `AI_CONTEXT_AUTOPUSH=1`). |
| `track-skill-usage` | Writes skill-invocation counts to `~/.claude/skill-usage.json`. |
| `meta-system-stop` | Runs the skill-regression + research-scheduler detectors. |
| `stop-sleep-consolidator` | Sleep-time background consolidator (v3 Phase D). Runs long-tail cleanup if the box is idle. |
| `session-end-logger` | Logs session end event to observability. |
| `handoff-session-end` | Saves session handoff state at session end for cross-session continuity. |
| `skill-auto-updater` | Auto-updates stale skills from upstream repos at session end. |
| `mirror-kachow` ⁱ | Auto-mirrors non-private artifacts from canonical `~/.ai-context/` to the public kachow mirror repo. Runs scrub pipeline before rsync. |
| `ai-snapshot-stop` ⁱ | Snapshots `~/.claude/` and `~/.gemini/` to SSD if present + 7-day cooldown met. Cross-platform mount detection. |

## SubagentStart

| Hook | What it does |
|---|---|
| `subagent-harness-inject` | Injects behavioral rules (no git writes, reasoning anchors, model selection) into subagent context at spawn time. |

## SubagentStop

| Hook | What it does |
|---|---|
| `task-verification-gate` | If the task description suggests code changes, enforces a verification step before the task can be marked done. |
| `subagent-quality-gate` | Quality gate for subagent output — flags low-confidence claims and unverified assertions. |
| `subagent-claim-logger` | Logs subagent claims for post-session meta-verification. Records what agents claimed vs what was verified. |

## PreCompact

| Hook | What it does |
|---|---|
| `reflect-precompact` | Triggers a structured `/handoff` before the context window gets compressed. Replaces the historical "write a session anchor" nudge. |
| `caveman-precompact` ⁱ | Sets a marker so the next UserPromptSubmit re-injects full caveman ruleset after compaction strips SessionStart context. |

## Notification

| Hook | What it does |
|---|---|
| `notify-with-fallback` | Tries `notify-send` (desktop), falls back to JSONL append for SSH / headless sessions. |

## UserPromptSubmit

Claude Code only — fires after each user message, before the model processes it. No Gemini/Codex equivalent.

| Hook | What it does |
|---|---|
| `per-prompt-overhead` | D2 instrumentation — logs per-prompt injection byte overhead for budget tracking. |
| `prompt-hash-logger` | D4 instrumentation — hashes each prompt for deduplication and pattern analysis. |
| `prompt-item-tracker` | Tracks scope items mentioned in user prompts. Detects scope drift when new items appear mid-session. |
| `slash-command-logger` | Logs slash command invocations for skill utilization analytics. |
| `caveman-post-compact-reinject` ⁱ | Re-injects caveman mode rules after context compaction (which strips hook-injected state). |

## CwdChanged / FileChanged

Claude Code only — fires on directory change or file modification events.

| Hook | What it does |
|---|---|
| `cwd-changed-watcher` | Tracks working directory changes for project-context switching. |
| `file-changed-notify` | Notifies when files change outside the AI session (e.g., manual edits, Syncthing sync). |
| `memory-post-compact` | Handles memory state after context compaction. Ensures critical memories survive compression. |

## Sync hooks (Gemini-specific)

These fire under AfterTool in Gemini CLI and handle Gemini→Claude direction sync.

| Hook | What it does |
|---|---|
| `sync-claude-md` | Syncs CLAUDE.md changes from Gemini's write to Claude's copy. |
| `sync-claude-skills` | Syncs skill changes from Gemini to Claude. |
| `sync-claude-agents` | Syncs agent file changes from Gemini to Claude. |
| `sync-memory-dirs` | Bidirectional sync of memory directories between Claude and Gemini at session end. |

## Library helpers (`hooks/lib/`)

Not registered as hooks. Required by the hooks above.

| Module | Used by | Purpose |
|---|---|---|
| `atomic-counter.js` | multiple | Atomic counter increment (lock-file + rename pattern). |
| `constants.js` | multiple | Shared timeout + path constants. |
| `git-global.js` | `auto-*-global.js` | Thin wrapper around git CLI with quiet-by-default behavior. |
| `hook-selftest.js` | CI + manual | Runs every hook through a recorded input/output spec. Fails CI on regression. |
| `hook-topology.js` | CI + `/platform-audit` | Detects event collisions and timeout imbalances between Claude and Gemini settings. |
| `memory-migrate.js` | `/consolidate-memory` + one-time script | Migrates memory files from v1 to v2 frontmatter. |
| `observability-logger.js` | all major hooks | Emits per-event JSONL for later analysis. Off by default; opt in by setting a log path. |
| `platform-map.js` | sync hooks | Maps Claude tool names ↔ Gemini tool names (Write ↔ write_file, etc.) and event names (Stop ↔ SessionEnd). |
| `presence.js` | `session-presence-*.js` | Shared presence state machine + read-lock helpers. |
| `self-improvement/detectors.js` | `meta-system-stop` | Skill-regression + research-scheduler detectors. |
| `self-improvement/queue.js` | `meta-system-stop` | Append-only queue of self-improvement candidates. |
| `statusline-renderer.js` | `enhanced-statusline` | Renders model / git / GSD task / context bar / tokens. |
| `symlink-audit.js` | `session-start-combined` (section 10) | Recursive symlink scanner with classification (OK / BROKEN / LOOP / ARCHIVED). |
| `tier3-consolidation.js` | `/consolidate-memory deep` | Tier-3 semantic summary generation. |
| `deferred-items.js` | handoff system | Manages the deferred work item queue. |
| `emit-simple-timing.js` | all major hooks | Lightweight timing helper — records hook execution duration. |
| `handoff-progress.js` | handoff hooks | Tracks handoff progress state across sessions. |
| `handoff-state.js` | handoff hooks | Manages handoff file state (create, read, archive). |
| `hook-interaction-map.js` | `/platform-audit` | Maps hook-to-hook interactions and dependencies. |
| `hook-timer.js` | all hooks | Timer utility for hook timeout enforcement. |
| `hostname-presence.js` | presence system | Hostname-aware presence tracking for multi-machine setups. |
| `leader-election.js` | concurrent sessions | Elects a leader session when multiple AI sessions are active simultaneously. |
| `project-identity.js` | `session-context-loader` | Detects project identity constraints (forbidden remotes, allowed commands). |
| `project-index.js` | context system | Indexes project metadata for cross-project context. |
| `project-key.js` | memory system | Generates deterministic project keys for memory scoping. |
| `settings-schema.js` | `session-start-combined` | Validates settings.json against known schema — detects managed-only keys and deprecated fields. |
| `stale-process-detector.js` | `session-context-loader` | Detects stale AI processes from previous sessions that didn't clean up. |
| `tool-detect.js` | reflect-stop, sync hooks | Canonical 4-tier tool detection (env override → argv path → tool-specific hints → default). |

---

ⁱ Hooks marked with ⁱ are documented for reference but excluded from the public mirror (maintainer-specific or plugin-dependent). They are available in the canonical `~/.ai-context/hooks/` source.

## Writing your own hook

See [ADDING-A-HOOK.md](./ADDING-A-HOOK.md).

## Disabling a hook

Two options:

1. **Per-event.** Remove the entry from `~/.claude/settings.json → hooks.<event>` and/or `~/.gemini/settings.json`. The hook file stays on disk but stops firing.
2. **Delete the file.** `rm ~/.claude/hooks/<name>.js`. On the next session start, `dead-hook-detector` flags the now-orphan settings entry so you can clean it up.
