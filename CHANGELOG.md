# Changelog

All notable changes to this framework. See [Semantic Versioning](https://semver.org/).

> *"I eat losers for breakfast."* — Lightning McQueen, while your hooks pass selftest at 0.4s

## [Unreleased]

## [0.9.5] — 2026-05-07

System overhaul — SessionStart performance, telemetry cleanup, state simplification, 5-tool parity, skills/dream fixes.

### Added
- **session-health-fast.js** — Phase 1 health checks (symlinks, settings freshness, MEMORY.md index, git state, rule-enforcement). Runs at order 0 before all other SessionStart hooks
- **memory-index-verify.js** — Stop hook, primary MEMORY.md auto-index mechanism
- **memory-index-updater.js** — PostToolUse hook, supplementary real-time MEMORY.md updates on LLM memory writes
- **hook-edit-monitor.js** — merged hook-doc-drift-detector + dead-hook-detector into single PostToolUse monitor
- **jsonl-rotation.js** — Stop hook, rotates instances/*.jsonl at 1000 lines keeping 500
- **lib/frontmatter-cache.js** — memory frontmatter cache (276 entries, eliminates 514 file reads at startup)
- **lib/session-id.js** — shared SESSION_ID resolution (CLAUDE_CODE_SESSION_ID env → stdin → fallback)
- **instances/subagent-blocks.jsonl** — persistent audit trail for subagent containment blocks
- **Telemetry epoch markers** — version-change events in episodic JSONL for clean post-change baselines
- **Verbose escape hatch** — `AI_CONTEXT_STARTUP_VERBOSE=1` for full startup output
- **triage_count** feature in deferred items (was defined but never implemented)
- **14 cmd- skills** for Crush+OpenCode via extended convert-commands.mjs
- **Quick/deep modes** for /consolidate-memory command

### Changed
- **SessionStart** — 5 network hooks (auto-pull, plugin-checker, skill-upstream, detect-sync-conflicts, tool-parity) converted to `async: true`. p95 ceiling tightened 22s→5s
- **Memory rotation** — fixed `status === 'active'` bug that prevented ALL rotation (zero rotations ever). Memory count was 9→257 in 16 days unbounded
- **Dream system** — counters moved from per-tool dirs to shared `~/.ai-context/`. Lock child-exit cleanup added. Dream-auto message improved for urgency
- **AI-tasks.json** — TTL cleanup: in_progress tasks expire at 2h (with session evidence) / 24h (without). `owner_session` field added
- **Subagent hooks** — module-level `_isSubagentCached` eliminates repeated readdirSync per-call
- **4 UserPromptSubmit hooks** → async (per-prompt-overhead, slash-command-logger, prompt-clarity-check, prompt-item-tracker)
- **Matcher fixes** — scrub-sentinel/research-lint: removed Bash (wasted spawn). skill-completion-correlator: added matcher (was firing on ALL tools)
- **`if` conditionals** — autosave-before-destructive, validate-settings-on-write get Claude-only spawn filters with selftest
- **skill-auto-updater** — now syncs portable skills to all 5 tools (was Claude→Codex only)
- **skill-drift-guard** — tool-agnostic .ai-context/memory path check (was 2-tool biased)
- **Git mutex** — O_EXCL lock in .git/ai-context.lock for auto-push/pull serialization
- **Per-host presence sharding** — project-level active-sessions now hostname-sharded (was single file)
- **Gemini** — `autoMemory: false` to prevent double memory injection
- **KNOWN-LIMITS.md** — Codex hooks confirmed stable v0.128.0, Crush skill dedup fixed v0.66.0, OpenCode repo updated to sst/opencode

### Removed
- **AI-progress.json** — killed (deprecated stub kept one release cycle). Replaced by handoff session state
- **validate-instructions-sync.js** — guaranteed no-op with one-brain symlinks. Replaced by isSymbolicLink() assertions in session-health-fast
- **injection-size-monitor.js** — cascade-broken (read stale data). Injection check moved inline
- **prompt-hash-logger.js** — all entries hashed empty string (wrong field name). No consumer
- **subagent-claim-logger.js** — archived (wrong field extraction, empty data). Replaced by subagent-blocks.jsonl
- **5 canonical skills** (zero invocations across 3572 sessions): code-quality, code-review-and-quality, debugging-and-error-recovery, incremental-implementation, spec-driven-development
- **6 hooks merged** into 3: hook-doc-drift-detector+dead-hook-detector→hook-edit-monitor, validate-settings-on-write→pre-write-combined-guard, sync-claude-md+skills+agents→post-write-sync

### Fixed
- **Memory rotation** — `status === 'active'` skip condition removed from memory-migrate.js (line 118). All files now eligible for TTL-based rotation
- **MCP list_tasks** — field name mismatch (`t.subject` vs `t.title`) fixed in ai-context-bridge server.js
- **Stale task cleanup path** — was searching .claude/AI-tasks.json, now uses findCanonicalDir() for project-state/ paths
- **reflect-proposals location** — was written to .claude/ (tool-specific), now .ai-context/ (canonical). 5 file refs updated
- **computeStaleness bug** — decision items with triage_count≥2 were silently dropped. Now escalate to user-action
- **hook-utilization-report path** — was reading ~/.claude/projects/, now reads ~/.ai-context/project-state/
- **Stale selftest references** — removed validate-symlinks.js and gsd-check-update.js from hook-selftest.sh
- **scrub-for-publish.sh** — removed 6 phantom/deleted entries from PORTABLE_HOOKS whitelist
- **post-write-sync.js** — removed AI-progress.json bidirectional sync code
- **auto-push-global.js** — removed AI-progress.json from TRACKED array
- **Dream lock stale** — child.on('exit') cleanup added to stop-sleep-consolidator

### Security
- **W2-FIX4** — env var subagent gate rejected (SEC-4 violation). Module-level cache used instead
- **R13** — explicit no-async constraint for critical-5 PreToolUse hooks (enforced by validate-manifest.mjs)
- **R14** — selftest required for critical hooks with `if` conditionals

## [0.9.1] — 2026-05-06

One-brain hardening — proactive provisioning, 5-tool scalability, security fixes.

### Added
- **lib/tool-paths.js** — single import for all tool-aware paths (54 tests)
- **system-integrity-check.mjs** — 10-category contract verifier
- **commands/** — 14 user commands centralized as canonical source
- **Proactive project-state provisioning** — new projects auto-provisioned from first session
- **Crush support in generate-settings.mjs** — full generate/apply/check/preview
- **MCP lazy MEMORY_DIRS** — new project-state dirs visible without server restart
- **migrate-project-memories.mjs** — one-time migration script
- **macbook-catchup-v080.sh** — automated cross-machine migration

### Changed
- **session-start-combined.js** — 14 hardcoded .claude paths → configDir via tool-paths.js
- **session-context-loader.js** — dash-prefix memory discovery, peer detection via allHostPresencePaths(), deferred-work reads canonical items.json, FULL_N default 3 → 8
- **auto-push-global.js** — stripped 100 lines dead code, single-repo model
- **12 hooks migrated** to tool-paths.js (block-subagent-*, meta-system-stop, skill-*, detect-sync-conflicts, etc.)
- **post-write-sync.js** — detects .ai-context/commands/ + .gemini/commands/ paths for Codex sync
- **install-adapters.mjs** — commands symlinks, portable skill symlinks, auto Codex conversion
- **convert-commands.mjs** — reads from ai-context/commands/ (canonical source)
- **reflect-stop.js** — uses detectTool() for lastAgent, configDir for state files
- **stop-sleep-consolidator.js** — tool-aware memory dir + platform label
- **mirror-kachow.js** — cache paths moved to ai-context/cache/
- **scrub-sentinel.js** + **pre-write-combined-guard.js** — Crush tool_name case normalization + notebookedit
- **memory-rotate** — skips status:active memories
- **Unified .ai-context symlink** pattern across fahlke-monorepo, nix, documents

### Fixed
- **Subagent marker PID mismatch** — block-subagent-writes + non-bash-writes + quality-gate all used process.pid but each hook is a separate process. Guards were completely non-functional. Fixed: glob sessionId-*.json
- **agentDir undefined** — ensure-portable-memory never worked (47 of 52 project memory dirs were real). Fixed: proactive provisioning
- **Ghost hooks** — sync-memory-dirs.js + claude-gemini-json-sync.js archived but still in MANIFEST/configs. Fixed: removed + regenerated
- **stignore (?d)projects/** too broad — blocked handoffs/projects/. Fixed: anchored to /projects/
- **deriveKey → deriveProjectKey** wrong function name in provisioning
- **atomicMigrate data loss** — silently skipped conflicting files + deleted source on copy error. Fixed: conflict files preserved, abort on error
- **Pre-commit hook** not executable since creation
- **Nix Syncthing config** — removed claude/gemini/codex folders (overrideFolders would have recreated them)
- **GitHub repo description** — updated from "Tri-tool" to "5-tool"
- **CHANGELOG footer links** — added v0.8.0 + v0.7.1 entries

### Removed
- 7 dead scripts, 4 dead lib modules, 2 dead sync hooks (archived)
- 47 empty Claude project dirs, 19 orphan files from tool dirs
- 3 junk project-state entries (created by opening Claude in internal dirs)
- ~/.claude/scripts/ (23 orphaned pre-consolidation scripts)
- ~/Documents/.planning, .audit, .agents, .codex (stale/empty)
- 376MB ~/Documents/.stversions/ (Syncthing recreates as needed)

### Security
- Subagent write guards actually functional (PID fix)
- Crush tool_name normalization in critical hooks
- Symlink traversal guard in createSymlinkSafe
- scrub-sentinel env var hint removed from block messages
- atomicMigrate preserves conflict files instead of silent data loss

## [0.8.0] — 2026-05-06

Infrastructure consolidation — one brain architecture.

### Added
- **project-state/** — centralized project memories (nix 195, fahlke-monorepo 101, documents 85)
- **configs/** — centralized tool settings (claude-settings.json, gemini-settings.json, codex-config.toml)
- **kachow-mirror/** — moved from `~/.kachow-mirror` into ai-context
- CI settings.json stub for hook-test-suite

### Changed
- **install-adapters.mjs** — added claude/gemini/codex settings as EXTRA_SYMLINKS
- **auto-push-global.js** — explicit TRACKED pathspec replaces `git add -A`
- **mirror-kachow.js** — v3 trigger model (ai-context only, removed claude/gemini HEAD)
- **reflect-stop.js** — file mtime heuristic replaces git status (tool dirs no longer git repos)
- **tri-tool-parity-check.js** — removed .git existence check for tool dirs
- **validate-settings-on-write.js** — recognizes ai-context/configs/ paths
- **dead-hook-detector.js** — symlink-aware settings resolution
- **scrub-sentinel.js** — updated PUBLIC_ROOTS to ai-context/kachow-mirror
- **publish.sh** — updated default MIRROR path
- **git-global.js REPOS** — trimmed to ai-context only

### Removed
- `.git` from `~/.claude/`, `~/.gemini/`, `~/.codex/` — tool dirs are derived state
- Syncthing folders for claude/gemini/codex — synced via ai-context only
- `~/.kachow-release` directory
- `~/Documents/.superpowers/` — consolidated into ai-context
- Nix `.ai-context` submodule — replaced with symlink to project-state/nix
- 70 Syncthing `.stversions/` files from git tracking

### Fixed
- `.gitignore` — added `.stversions/`, `.stfolder`, `kachow-mirror/`; replaced `projects/` exclusion
- Stale memory fixes — 6 global memories updated/archived (wrong versions, missing index entries)

## [0.7.1] — 2026-05-06

Cross-platform hardening, badge accuracy, documentation fixes.

### Fixed
- **stop-sleep-consolidator.js** — `isGemini` ReferenceError (undeclared variable, hook silently no-oped since introduction)
- **context-pressure-enforce.js** — hardcoded `/tmp/` replaced with `os.tmpdir()` (Windows fix)
- **memory-rotate.js, meta-system-stop.js, observability-logger.js** — forward-slash-only path sanitization replaced with `[/\\]` regex + drive letter handling (Windows fix)
- **skill-auto-updater.js** — Unix `find` command replaced with `fs.readdirSync` walk; `cp -r` replaced with `fs.cpSync` (Windows fix)
- **stale-process-detector.js** — hardcoded `/tmp/` replaced with `os.tmpdir()`; `ps --no-headers` replaced with platform-guarded fallback (Windows+macOS fix)
- **handoff-auto-save.js, session-context-loader.js, session-start-combined.js** — `2>/dev/null` shell redirects replaced with `stdio` option (Windows fix)
- 7 Codex SKILL.md files — broken YAML frontmatter from auto-conversion (empty folded scalars, unquoted colons)
- **convert-commands.mjs** — root cause fix: multiline folded scalar parser + quoted description output
- Reflect hook consolidation — `reflect-session-end.js` archived, `reflect-stop.js` is sole reflect hook
- HOOKS.md — 5 undocumented hooks added, header count corrected
- README roadmap — v0.3.0–v0.7.0 marked as shipped

### Changed
- Badge: "bash + powershell parity" replaced with "scripts: node .mjs (cross-platform)" — 11/12 shipped .sh/.ps1 were 3-line wrappers around .mjs implementations
- README tagline — updated from 3-tool to 5-tool (added Crush + OpenCode)
- `d5-anti-skew-test.ps1` added for full script parity

### Removed
- `reflect-session-end.js` — archived (superseded by `reflect-stop.js`)
- `deferred-migration.js`, `session-state.js` — archived (zero references, confirmed dead)
- Nested `~/.gemini/.gemini/` phantom directory — stale Syncthing artifact from March 2026

## [0.7.0] — 2026-05-05

Manifest-driven hook registration, 5-tool architecture, Syncthing+git safety.

### Added
- **MANIFEST.yaml** — single source of truth for 72 hook registrations across 5 tools
- **generate-settings.mjs** — manifest → Claude JSON / Gemini JSON / Codex TOML with event/tool/timeout translation
- **validate-manifest.mjs** — schema validation with critical-hook gate
- **bootstrap-manifest.mjs** — reverse-engineer manifest from existing configs
- **convert-commands.mjs** — 13 Claude commands → Codex skills (cmd-* namespace)
- **config-backup.mjs** — backup/restore for tool configs
- **COVERAGE.md** — structural hook asymmetry across 5 tools
- **Crush (charmbracelet) integration** — PreToolUse hooks, MCP, AGENTS.md
- **OpenCode (sst/opencode) integration** — MCP + instructions config
- **ConfigChange event** — real-time drift detection (Claude-only)
- Pre-commit hooks in all global repos for commit-time drift guard
- `TOOL_SUPPORTS_ASYNC` capability matrix (only Claude supports async)
- `PermissionRequest` as 6th Codex event
- `crushToolMap`, `crushEventMap` in platform-map.js

### Changed
- **platform-map.js** — extended: codexToolMap (16), ALL_EVENTS (13), TOOL_EVENTS per-tool matrix, PASSTHROUGH_MATCHERS
- **tri-tool-parity-check.js** — rewritten: manifest-aware via generator --check
- **auto-push-global.js** — ff-only merge (was rebase), credential guard on merge path, ai-context auto-commit ON by default
- **auto-pull-global.js** — ff-only merge, credential guard, no -X theirs
- **install-adapters.mjs** — Crush + OpenCode symlinks (hooks, configs, AGENTS.md)
- `.stignore` — full `.git` exclusion + `*.sync-conflict-*` (was surgical .git/ exclusion)
- AGENTS.md — 5+2 tool system, manifest workflow, Crush/OpenCode rows
- Generator emits async:true only for Claude (Gemini/Codex don't support it)

### Fixed
- dead-hook-detector.js Gemini timeout: 3000ms → 5000ms
- mirror-kachow.js Gemini timeout: 30000ms → 20000ms
- subagent-claim-logger.js Gemini timeout: 5000ms → 3000ms
- Backup corruption on --apply --all (single backup before any writes)
- Timeout display showing raw ms as seconds
- MultiEdit leaking into Gemini matchers
- Invalid --tool typo silently succeeding
- OpenCode MCP type: local → stdio
- research-lint.js + auto-push-global.js: async:true removed (exit(2)/systemMessage discarded when async)

### Security
- Credential guard covers merge path (was commit-only)
- Stash before reset --hard in credential guard (prevents work loss)

## [0.6.0] — 2026-05-05

### Added
- `lib/safety-timeout.js` — 5s global ceiling on hook execution
- `lib/confidence-decay.js` — Ebbinghaus memory decay
- `lib/session-state.js` — shared JSON state between hooks
- `scripts/session-cost-report.mjs` — per-model token spend

### Changed
- 6 heavy hooks gain safety timeout wrapper
- Memory injection sorted by confidence (not just recency)
- PreCompact split: manual vs auto with different export depth

## [0.5.0] — 2026-05-05

### Changed
- Context-pressure thresholds corrected (80%/85%/92%)
- Reflect hooks consolidated
- tri-tool-parity-check accuracy improved
- session-context-loader output compressed
- Gemini v0.42 + Codex v0.128 settings applied

### Fixed
- 4 private-info scrub leaks patched

## [0.4.0] — 2026-05-05

### Changed
- Hook p95 dropped 6000ms → 141ms
- 66 hooks, 28 lib modules, 19 self-improvement detectors
- Passive analytics pipeline

## [0.3.0] — 2026-05-05

### Added
- Codex CLI as 3rd supported tool (6-event model)
- `wire-hook-codex.mjs` — TOML-based Codex hook registration
- `tri-tool-parity-check` — SessionStart drift detection (24h cooldown)
- 16 hooks added (45→61 total)

### Changed
- `auto-push-global` extended to commit/push `~/.codex/`
- Credential regex hardened (filename-only anchored)
- `install-hooks.mjs` replaces `.sh` (Node ESM, idempotent, manifest-driven)

### Fixed
- Presence heartbeat bug: no longer overwrites start records
- session-context-loader memory category regex fixed

### Security
- P0 scrub: hardcoded project directory names replaced with env vars

## [0.2.0] — 2026-05-05

### Changed
- Documentation rewrite: 60+ hooks now documented (was 33), 28 lib helpers documented (was 14)
- README identity refresh: problem-first opening with three pillars (Unify/Protect/Remember)
- Hook counts use approximate style ("60+ hooks") instead of hardcoded numbers
- Context-pressure-enforce thresholds corrected in code and docs (80%/85%/92%, was 70%/80%)
- Roadmap restructured with accurate v0.2.0 scope

### Fixed
- Scrub pipeline: removed post-commit-sync-reminder from whitelist (leaked private workflow shape)
- Scrub config: added forbidden tokens for spec paths, Bash(host *), agent-harness
- Removed /sync-all from command table (file never existed)
- Fixed "copied on first bootstrap" → "symlinked on first bootstrap"
- Fixed fabricated InstructionsLoaded event reference
- Fixed validate-symlinks references (merged into session-start-combined)
- Fixed MAINTENANCE.md publish.sh reference (script doesn't exist)
- Removed validate-skills.ps1 reference (file doesn't exist)

### Added
- New HOOKS.md sections: SubagentStart, UserPromptSubmit, CwdChanged/FileChanged, Sync hooks
- 14 new lib helper entries in HOOKS.md
- Hook category taxonomy (lifecycle/safety/observability/memory/sync)

## [0.1.0] — 2026-04-21

Initial public release. *Ka-chow.*

### Ship stats

- 60+ hooks + 28 lib files
- 12 shell scripts + 11 PowerShell parity (adds `self-update`, `validate-skills`)
- 13 slash commands
- MCP server: 14 tools, dependency-free, version read from VERSION file
- 9 docs (ARCHITECTURE, ADDING-A-HOOK, CROSS-PLATFORM, DROP-IN, HOOKS, LOCATIONS, MAINTENANCE, SKILLS, TROUBLESHOOTING)

### Added

- 66 hooks for Claude Code + Gemini CLI (SessionStart / PostToolUse / PreToolUse / Stop / PreCompact / Notification / SubagentStop)
- 28 library helpers: hook-selftest, hook-topology, memory-migrate, symlink-audit, observability-logger, and friends
- MCP server (`personal-context`) — 14 stdio tools, zero npm dependencies
- AGENTS.md canonical symlink surface for 5 AI tools (Claude Code, Gemini CLI, Codex CLI, OpenCode, Aider)
- Cross-platform script parity (`.sh` + `.ps1` for every user-facing script)
- Memory v2 frontmatter schema + TTL rotation
- `/preview <image>` via chafa (terminal image rendering)
- `bootstrap.sh` / `bootstrap.ps1` one-command setup with `$HOME` normalization in settings
- `customize.sh` / `customize.ps1` interactive onboarding
- `self-update.sh` / `self-update.ps1` — pull upstream, preserve USER SECTION, re-bootstrap
- `validate-skills.js` — lint SKILL.md frontmatter + cross-reference for orphans
- `docs/MAINTENANCE.md` — multi-machine maintenance guide
- `docs/HOOKS.md` — full hook catalog with event / purpose / trigger
- `docs/SKILLS.md` — per-AI skill compatibility matrix
- `docs/LOCATIONS.md` — canonical-directory layout + `AI_CONTEXT` env override
- CI smoke tests across Linux + macOS + Windows with end-to-end bootstrap assertion
- Scrub pipeline with whitelist-based shipping + three-layer defense
- `install-adapters.ps1` falls back to file-copy mode when Developer Mode is off
- Portable `stat` in `resolve-conflicts.sh` (GNU / BSD fallback)

### Security

- Triple-layer scrub defense: pre-commit, scrub-for-publish, CI fail-gate
- Obfuscated personal-token patterns in CI (printf-concatenated, no literals)
- `deep-verify-scrub` maintainer tool cross-references a master personal-token list beyond scrub-config

[Unreleased]: https://github.com/Daaboulex/kachow/compare/v0.9.5...HEAD
[0.9.5]: https://github.com/Daaboulex/kachow/compare/v0.9.1...v0.9.5
[0.9.1]: https://github.com/Daaboulex/kachow/compare/v0.8.0...v0.9.1
[0.8.0]: https://github.com/Daaboulex/kachow/compare/v0.7.1...v0.8.0
[0.7.1]: https://github.com/Daaboulex/kachow/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/Daaboulex/kachow/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/Daaboulex/kachow/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/Daaboulex/kachow/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/Daaboulex/kachow/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/Daaboulex/kachow/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Daaboulex/kachow/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Daaboulex/kachow/releases/tag/v0.1.0
