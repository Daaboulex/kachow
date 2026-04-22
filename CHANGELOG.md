# Changelog

All notable changes to this framework. See [Semantic Versioning](https://semver.org/).

> *"I eat losers for breakfast."* — Lightning McQueen, while your hooks pass selftest at 0.4s

## [Unreleased]

### Added (2026-04-22)
- `scripts/install-hooks.sh` — copies hooks + lib + tests into ~/.claude + ~/.gemini, seeds settings.json from template. Called by `bootstrap.sh`.
- `scripts/install-commands.sh` — copies slash commands. Called by `bootstrap.sh`.
- `scripts/uninstall.sh` — reads install manifest, removes every file/symlink kachow installed, sweeps dangling symlinks.
- `scripts/scrub-check.sh` — local pre-push scrub gate. Install as `.git/hooks/pre-push`.
- `scripts/cleanup-stale.sh` — clears orphan shell outputs + stale session dirs under `/tmp/claude-<uid>/`.
- `scripts/hook-stats.sh` — observability reporter (skill freq, timing, event counts, orphans).
- `scripts/note.sh` — timestamped-note append to active handoff or a task.
- Hook libs: `handoff-progress`, `hook-interaction-map`, `hook-timer`, `hostname-presence`, `release-notes-cache`, `settings-schema`, `stale-process-detector`.
- Hooks: `bandaid-loop-detector`, `pre-write-combined-guard`, `session-context-loader`, `skill-drift-guard`, `subagent-harness-inject`, `subagent-quality-gate`.
- Tests: `hooks/tests/lib-unit-tests.js` (34 unit tests), `hooks/tests/run-regressions.sh` (8 regression fixtures).
- CI: new jobs for lib unit tests + regression fixtures.

### Fixed (2026-04-22)
- Windows CI bootstrap: PowerShell `$HOME` is cached at process start and ignores `$env:HOME` overrides used by CI smoke. All .ps1 scripts now use a shared `Get-UserHome` helper that prefers `$env:HOME` → `$env:USERPROFILE` → `$HOME`.
- MCP server health-check probe: `tail -n +2 | head -1` was fragile across OS line-ordering. New probe scans all response lines for `result.tools`.
- MCP `add_debt`: required fields (`title`/`symptom`/`severity`) now enforced at handler level — previously wrote `undefined` literals into DEBT.md when called without them.
- `install-mcp.sh`: creates minimal `{}` stubs for `~/.claude.json` and `~/.gemini/settings.json` when missing. Fresh machines no longer fail `health-check.sh`.
- `bootstrap.sh`: now runs `install-hooks` + `install-commands` — previous release shipped hooks on disk but never installed them into `~/.claude/hooks/`.
- Scrub-gate: `hooks/INTERACTION-MAP.md` (auto-generated) no longer leaks user paths (`sanitizePath()` in `lib/hook-interaction-map.js`).
- `task-verification-gate.js`: header + emitted event name claimed `TaskCompleted` but hook is registered as `SubagentStop`. Updated to match.
- `hostname-presence.js`: scrubbed personal hostnames from comment header.

## [0.1.0] — 2026-04-21

Initial public release. *Ka-chow.*

### Added

- 36 hooks for Claude Code + Gemini CLI (SessionStart / PostToolUse / PreToolUse / Stop / PreCompact / Notification / SubagentStop)
- 14 library helpers: hook-selftest, hook-topology, memory-migrate, symlink-audit, observability-logger, and friends
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

[Unreleased]: https://github.com/Daaboulex/kachow/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Daaboulex/kachow/releases/tag/v0.1.0
