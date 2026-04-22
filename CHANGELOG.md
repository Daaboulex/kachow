# Changelog

All notable changes to this framework. See [Semantic Versioning](https://semver.org/).

> *"I eat losers for breakfast."* — Lightning McQueen, while your hooks pass selftest at 0.4s

## [0.1.0] — 2026-04-22 (initial public release)

All changes below collapsed from pre-release iteration. Semver: 0.x → expect breaking changes in hook interface and settings-template shape until v1.0.0.

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

[0.1.0]: https://github.com/Daaboulex/kachow/releases/tag/v0.1.0
