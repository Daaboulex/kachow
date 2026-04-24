# Hooks catalog

42 shipped hooks + 20 library helpers. Every one is pure Node (stdlib only); runs identically on Linux, macOS, and Windows (where the host AI CLI supports hooks).

Registered under `hooks.<event>[].hooks[]` in the tool's settings JSON. See `settings.template.json` (Claude) and `settings.gemini.template.json` (Gemini) for the wiring.

## SessionStart

Fires once at the beginning of every session.

| Hook | What it does |
|---|---|
| `auto-pull-global` | Pulls the latest `~/.claude/` and `~/.gemini/` from their private remotes before work starts. Stash → pull with rebase → restore. On conflict: commits locally and prints next steps. |
| `plugin-update-checker` | Checks installed Claude Code plugins for updates (async, non-blocking). |
| `session-start-combined` | Multiple small SessionStart concerns (reflect-enabled check, consolidate-memory counter, stale-skill hints, release-notes fetch, settings-schema lint, hook-timing rollups, etc.) merged into one Node process. Saves spawn overhead. |
| `session-context-loader` | Injects memory-summary banner, handoff progress, open tasks, self-improvement queue, and stale-process warnings as a single session-start message. |
| `skill-upstream-checker` | Checks upstream skill repos for updates on a 7-day cooldown. Network failures silently skip — never blocks session start. |
| `session-presence-start` | Registers this session in the presence files so other sessions can see who's active. |
| `validate-instructions-sync` | Validates `CLAUDE.md ↔ GEMINI.md` drift on instructions-loaded. |

## PostToolUse

Fires after each tool call (matcher-scoped — not every hook runs on every tool).

| Hook | Matcher | What it does |
|---|---|---|
| `session-presence-track` | `Write\|Edit\|MultiEdit\|Bash\|Read\|Grep\|Glob\|TodoWrite` | Async heartbeat every N tool calls so session is known to be alive. |
| `todowrite-mirror` | `TodoWrite` | Caches the current todo list per-session so the Stop hook can promote in-progress items. |
| `context-pressure-enforce` | `Write\|Edit\|MultiEdit\|Bash` | Enforces the context pressure thresholds documented in `AGENTS.md` — nudges at 70 %, unconditional at 80 %. |
| `post-write-sync` | `Write\|Edit` | Combined sync hook — `CLAUDE.md → GEMINI.md` translation, `commands/skills/rules` mirroring, `AI-tasks / AI-progress` bidirectional sync. Runs 4 ops in one process. Ingests `tool_duration_ms` from the tool payload for hook-vs-tool perf separation. |
| `skill-invocation-logger` | `Skill` | Logs skill invocations to a session-local temp file. Feeds `track-skill-usage` at Stop. |
| `skill-drift-guard` | `Bash\|Edit\|Write\|Read\|Grep\|Glob` | Detects when an agent keeps doing something a skill would do better. Nudges toward the skill instead of ad-hoc continuation. |
| `bandaid-loop-detector` | `Write\|Edit\|MultiEdit` | Flags 3+ edits to the same file within a short window — prompts root-cause reflection instead of continued patching. |
| `hook-doc-drift-detector` | `Write\|Edit` on `*.claude/hooks/*.js` | When a hook is edited, scans project `CLAUDE.md` files for stale references to that hook. |
| `dead-hook-detector` | `Write\|Edit` | When a hook file is modified, checks it's registered in `settings.json` — flags orphans. |
| `memory-retrieval-logger` | `Read` | Logs memory-file reads to a per-machine retrieval log (informs the memory decay schedule). |
| `research-lint` | `Write\|Edit` | Lints research writes for source-citation drift. Linux/macOS only. |

## PreToolUse

Fires before tool execution. Returning a non-zero exit can block the tool call.

| Hook | Matcher | What it does |
|---|---|---|
| `verifiedby-gate` | `TodoWrite` | Blocks TodoWrite attempts that mark a task done with an empty `verifiedBy` field. |
| `validate-settings-on-write` | `Write` on settings.json | Validates the edit BEFORE it's written. Prevents broken hooks from silently killing settings. |
| `prefer-editing-nudge` | `Write` | Warns when a Write creates `foo-v2.ts` next to an existing `foo.ts`. |
| `block-subagent-writes` | `Bash` (subagent ctx) | Hard-blocks subagents from running state-changing git commands (`commit / push / reset --hard / rebase / merge / cherry-pick / ...`). |
| `autosave-before-destructive` | `Bash` | Auto-git-stash before `rm -rf`, `git reset --hard`, and similar. |
| `pre-write-combined-guard` | `Bash` + `Write\|Edit\|MultiEdit` | Advisory guard bundle: safety-critical file detector (warns on writes to content matching IEC 61508-style domain patterns), cross-platform script pair-drift check, symlink-target existence check. |
| `scrub-sentinel` | `Write\|Edit\|MultiEdit` | Personal-token leak guard — runs the scrub allowlist check before any write that could land in a public tree. Blocks on hard findings. |

## Stop

Fires once at session end. Data-safety hooks (commit local before network) come first.

| Hook | What it does |
|---|---|
| `session-presence-end` | Removes this session from presence files. |
| `todowrite-persist` | Promotes in-progress + blocked todos from session cache into the project's `AI-tasks.json`. Done todos go to `completed_log`. |
| `reflect-stop` | Nudges the agent to run `/wrap-up` if meaningful work happened and it hasn't already. |
| `dream-auto` | Runs `/consolidate-memory` with dual-gate trigger (time + session count). Merges duplicates, archives stale. |
| `memory-rotate` | Rotates expired memories to `archive/` on a 7-day cooldown. |
| `auto-push-global` | Commits `~/.claude/` + `~/.gemini/` locally (no cooldown), pushes on a 5-min cooldown. Fetch-rebase-push on conflict. Optionally also covers `~/.ai-context/` (`AI_CONTEXT_AUTOCOMMIT=1` / `AI_CONTEXT_AUTOPUSH=1`). |
| `track-skill-usage` | Writes skill-invocation counts to `~/.claude/skill-usage.json`. |
| `meta-system-stop` | Runs the skill-regression + research-scheduler detectors. Writes findings to `self-improvements-pending-<host>.jsonl`. |
| `stop-sleep-consolidator` | Sleep-time background consolidator. Runs long-tail cleanup if the box is idle. |

## SubagentStart

| Hook | What it does |
|---|---|
| `subagent-harness-inject` | Injects guardrail rules into a dispatched subagent's system context (no git writes, safety-critical file list, etc.). |

## SubagentStop

| Hook | What it does |
|---|---|
| `subagent-quality-gate` | Quality + scope checks on subagent output before it returns to the parent session. |
| `task-verification-gate` | If the task description suggests code changes, enforces a verification step before the task can be marked done. |

## PreCompact

| Hook | What it does |
|---|---|
| `reflect-precompact` | Triggers a structured `/handoff` before the context window gets compressed. |

## UserPromptSubmit

| Hook | What it does |
|---|---|
| `slash-command-logger` | Scans the submitted prompt for leading `/command` lines and emits `slash_invoke` episodic events (mirrors `skill_invoke` schema). Claude-only — Gemini lacks this event. |

## Notification

| Hook | What it does |
|---|---|
| `notify-with-fallback` | Tries `notify-send` (desktop), falls back to JSONL append for SSH / headless sessions. |

## statusLine

| Hook | What it does |
|---|---|
| `enhanced-statusline` | Renders the Claude Code status line — model / git / GSD task / context bar / tokens. Claude-only feature. |

## Standalone CLIs (shipped, not auto-registered)

| Script | Purpose |
|---|---|
| `validate-symlinks` | Recursive symlink audit across every AI-tool surface. Invoke via `node ~/.claude/hooks/validate-symlinks.js` or from CI. Also callable from `scripts/bootstrap.sh`. |

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
| `symlink-audit.js` | `validate-symlinks` | Recursive symlink scanner with classification (OK / BROKEN / LOOP / ARCHIVED). |
| `tier3-consolidation.js` | `/consolidate-memory deep` | Tier-3 semantic summary generation. |
| `handoff-progress.js` | `session-context-loader` | Parses handoff markdown for `- [ ]` / `- [x]` checkboxes + numbered items under action sections. Surfaces completion % badge at SessionStart. |
| `hook-interaction-map.js` | CLI + manual | Static-analyzes every hook: reads/writes/execs/requires/network/exits. Outputs Markdown map. `sanitizePath()` scrubs user paths from generated docs. |
| `hook-timer.js` | opt-in per hook | hrtime wrapper that logs `{section, duration_ms, ok}` via observability-logger. Surfaces slowest hooks over time. |
| `hostname-presence.js` | `presence.js` | Per-host presence filename sharding + cross-host merged reader — makes `active-sessions-global.jsonl` Syncthing-safe across machines. |
| `release-notes-cache.js` | `session-start-combined` | `gh`-CLI-backed release-notes fetcher. On version bump, auto-writes a dated memory file and flags breaking-hook signals. |
| `settings-schema.js` | `validate-settings-on-write` + `session-start-combined` | Claude Code v2.1.x schema table. Flags `deprecated`, `managedOnly`, `unknown` keys before write-time AND at SessionStart. |
| `stale-process-detector.js` | `session-context-loader` + `scripts/cleanup-stale.sh` | Scans `/tmp/claude-<uid>/` for stale `.output` files + abandoned zsh child processes. Surfaces `⚠ stale processes` badge; cleanup via script. |

## Writing your own hook

See [ADDING-A-HOOK.md](./ADDING-A-HOOK.md).

## Disabling a hook

Two options:

1. **Per-event.** Remove the entry from `~/.claude/settings.json → hooks.<event>` and/or `~/.gemini/settings.json`. The hook file stays on disk but stops firing.
2. **Delete the file.** `rm ~/.claude/hooks/<name>.js`. On the next session start, `dead-hook-detector` flags the now-orphan settings entry so you can clean it up.
