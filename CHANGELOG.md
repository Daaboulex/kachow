# Changelog

All notable changes to this framework. See [Semantic Versioning](https://semver.org/).

> *"I eat losers for breakfast."* — Lightning McQueen, while your hooks pass selftest at 0.4s

## [Unreleased]

## [0.8.0] — 2026-05-06

Infrastructure consolidation — one brain architecture.

### Added
- **project-state/** — centralized project memories for per-repo context
- **configs/** — centralized tool settings (Claude, Gemini, Codex)
- CI settings.json stub for hook-test-suite

### Changed
- **install-adapters.mjs** — settings symlinks for all 5 tools
- **auto-push-global.js** — explicit pathspec replaces `git add -A`
- **mirror-kachow.js** — simplified trigger model (single source)
- **reflect-stop.js** — file mtime heuristic replaces git status
- **tri-tool-parity-check.js** — removed dead .git checks
- **validate-settings-on-write.js** — recognizes centralized config paths
- **git-global.js REPOS** — single repo model

### Removed
- `.git` from tool dirs — tool dirs are now derived state via symlinks
- Syncthing folders for individual tool dirs

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

[Unreleased]: https://github.com/Daaboulex/kachow/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/Daaboulex/kachow/compare/v0.7.1...v0.8.0
[0.7.1]: https://github.com/Daaboulex/kachow/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/Daaboulex/kachow/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/Daaboulex/kachow/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/Daaboulex/kachow/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/Daaboulex/kachow/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/Daaboulex/kachow/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Daaboulex/kachow/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Daaboulex/kachow/releases/tag/v0.1.0
