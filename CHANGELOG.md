# Changelog

All notable changes to this framework. See [Semantic Versioning](https://semver.org/).

> *"I eat losers for breakfast."* — Lightning McQueen, while your hooks pass selftest at 0.4s

## [0.3.0] — 2026-04-29 (tri-tool parity + 16 new hooks + Codex support)

### Added
- 16 new hooks upstreamed from local development:
  - **SessionStart:** `injection-size-monitor`, `gsd-check-update`, `tri-tool-parity-check`
  - **PostToolUse:** `skill-completion-correlator`, `rule-enforcement-check`, `post-commit-sync-reminder`, `repomap-refresh`
  - **PreToolUse:** `peer-conflict-check`
  - **Stop:** `ai-snapshot-stop`, `mirror-kachow`, `skill-auto-updater`
  - **PreCompact:** `caveman-precompact`
  - **UserPromptSubmit:** `prompt-clarity-check`, `per-prompt-overhead`, `prompt-hash-logger`, `prompt-item-tracker`, `caveman-post-compact-reinject`
- Codex CLI support: hooks compatible with Codex's 6-event model (SessionStart, PreToolUse, PostToolUse, UserPromptSubmit, PermissionRequest, Stop)
- `wire-hook-codex.mjs` script for TOML-based hook registration
- `tri-tool-parity-check` — SessionStart hook detects hook registration drift between Claude, Gemini, and Codex
- `skill-auto-updater` — Stop hook auto-updates plugins + syncs portable skills to Codex (24h cooldown)
- `prompt-item-tracker` — scope drift prevention, detects 3+ items in prompts
- `peer-conflict-check` — anti-skew concurrent session detection via side-channel

### Changed
- `auto-push-global` now commits + pushes `~/.codex/` (tri-tool parity)
- `auto-push-global` credential regex hardened: checks known credential filenames only, not arbitrary path substrings containing "token"
- Hook count: 45 → 61 (+ 21 library helpers)
- HOOKS.md updated with all 16 new hooks in correct event sections
- SESSION_START_P95_CEILING_MS default raised to 15000 (10+ SessionStart hooks take time)

### Fixed
- `auto-push-global` credential regex false-positive: `/token/i` matched "tokenfix" in .bak filenames → blocked pushes for 2+ days. Now checks `^(\.credentials|oauth_creds|auth|\.env|\.secret|api[_-]?key)` on filename only.

### Notes
- Codex `apply_patch` does NOT fire hooks (upstream bug openai/codex#16732). File write guards only protect Bash-based writes.
- Codex tool names differ: `apply_patch` (not Write/Edit), `shell` (not Bash), `read_file` (not Read). Matchers must use Codex names.
- Gemini event names differ: `AfterTool` (not PostToolUse), `BeforeTool` (not PreToolUse), `PreCompress` (not PreCompact).

[0.3.0]: https://github.com/Daaboulex/kachow/releases/tag/v0.3.0

## [0.2.1] — 2026-04-24 (parity + observability + v2.1.119 adoption)

### Security
- Register `scrub-sentinel` under Gemini BeforeTool (was offline orphan; personal-token leak guard now active on both Claude and Gemini sides). Per 2026-04-24 parity audit Gap #1.

### Added
- `scripts/setup-branch-protection.sh` — idempotent gh-api wrapper enforcing CI status checks + linear history + no-force-push on `main`. Run once after fork creation.
- ~~`.github/workflows/upstream-drift-watch.yml`~~ — weekly cron for upstream version drift detection. **Removed in v0.2.4** because GitHub Actions registration cache got stuck producing phantom 0s failures on every push regardless of file contents. Drift watch will be re-implemented out-of-Actions (local cron or different repo).
- `.github/VERSION-DEPS` — pinned upstream versions (claude-code=2.1.119, gemini-cli=0.39.0).
- `hooks/slash-command-logger.js` — UserPromptSubmit hook emitting `slash_invoke` episodic events (mirrors `skill_invoke` schema). Closes the slash-command-usage observability gap. Registered on Claude side; ships to Gemini for codebase parity (Gemini lacks UserPromptSubmit event).
- Inline TIMER instrumentation in 5 hooks: `post-write-sync`, `meta-system-stop`, `reflect-stop`, `auto-push-global`, `stop-sleep-consolidator`. Was Claude-only per 2026-04-24 drift audit; now in both Gemini and kachow.
- `tool_duration_ms` field in `post-write-sync` `hook_timing` events — ingests Claude Code v2.1.119's PostToolUse `duration_ms` for tool-perf signal distinct from hook-perf.
- CI: orphan hook file detector — flags any `hooks/*.js` not registered in `settings.template.json` (allowlist for documented standalone CLIs).

### Changed
- Consolidated `reflect-{on,off,status}.md` (3 files) into single `/reflect on|off|status` command. Honest-review (Apr 22) action item #4.
- `SESSION_START_P95_CEILING_MS=5000` set in default settings template (R15 detector tuning vs typical 400ms baseline; reduces false-positive risk).
- PORTABLE_HOOKS whitelist updated: added `bandaid-loop-detector`, `pre-write-combined-guard`, `scrub-sentinel`, `session-context-loader`, `skill-drift-guard`, `slash-command-logger`, `subagent-harness-inject`, `subagent-quality-gate`. Removed obsolete `doc-shard-resolver`, `halt-condition-validator` (gone since v0.2.0).

### Fixed
- Removed orphan `hooks/post-write-sync.js` from Gemini side — was unregistered; one-way sync direction is Claude→Gemini per AGENTS.md.
- `filesystem` MCP server registered on Gemini side for parity (was Claude-only). Per 2026-04-24 parity audit Gap #4.

[0.2.1]: https://github.com/Daaboulex/kachow/releases/tag/v0.2.1

## [0.2.0] — 2026-04-23 (security + measurement release)

**BREAKING — security fixes.** Upstream `SKIP_SUBAGENT_BLOCK=1` env-var override is removed; any subagent bypass workflow relying on it must be migrated to running the command in parent context instead.

### Security
- **SEC-1** `get_skill` MCP handler: added path-traversal containment. Prior handler constructed `path.join(SKILLS_DIR, String(name), 'SKILL.md')` with no `..` guard. Exploit: `get_skill({name: "../../.ssh/id_ed25519"})` escaped `SKILLS_DIR`. Fix: apply `slugifyName` + `path.resolve` containment before `readFileSync`.
- **SEC-2** `read_debt`, `read_handoff`, `list_handoffs`, `search_handoffs`: added caller-supplied `cwd` canonicalization. New `canonicalizeCwd()` runs `fs.realpathSync` and restricts walk to approved roots (`~`, `~/.ai-context`). Prevents crafted `cwd` (e.g., `"/tmp/evil/../../root"`) from probing system paths.
- **SEC-3** `add_memory` + `add_debt`: added subagent write gate. When any marker in `~/.claude/cache/subagent-active/` has mtime within 30-min TTL, MCP write handlers reject with `mcp_write_blocked: active subagent session`. Error text includes instruction to wait for subagent completion. Trade-off: parent MCP writes also blocked while any subagent runs. 30-min TTL bounds impact.
- **SEC-4** `block-subagent-writes.js` (both Claude + Gemini): removed `SKIP_SUBAGENT_BLOCK=1` env-var override. Override was self-disclosed in block-reason, allowing a compromised subagent to prepend the env var to its next command and defeat the guard. **BREAKING.**
- **SEC-5** `subagent-harness-inject.js` (both Claude + Gemini): safety-critical detection now walks up to nearest `.git`/`.envrc` boundary and checks `safetyDirs` at each level (was 1-level: `cwd` + `cwd/..`). Secondary content signal: grep `.c`/`.h` headers for `lpc43xx|IEC 61508|IEC 61511` markers. Deep subdirs like `Tests/Integration/Cases/` under safety-critical projects now correctly inject harness rules.

### Added
- `scripts/hook-stats.sh`: p95 column in timing table. Filters `ev.type === 'hook_timing'` before aggregating `meta.total_ms` (prevents future non-timing events with the field from contaminating the gate). Marks p95 with `*` when `n<10` (variance-dominated, not gate-eligible).
- `hooks/session-start-combined.js`: permanent stale-marker sweep (deletes `~/.claude/cache/subagent-active/*.json` with mtime > 24h). Prevents SEC-3 false-blocks from abandoned subagents.
- `hooks/lib/self-improvement/detectors.js`: **R15** (`session_start_p95_regression`) — SessionStart p95 > ceiling (default 9070ms, configurable via `SESSION_START_P95_CEILING_MS` env) → enqueues BLOCKER finding. **R17** (`skill_followed_by_bandaid_loop`) — lazy JOIN of `skill_invoke` events within 20min before `bandaid_loop` events in same session; counts per-skill; ≥3 occurrences in 14d → enqueues OBSERVE finding for manual triage. No thresholds on %; raw count only.
- `hooks/bandaid-loop-detector.js`: emits `bandaid_loop` episodic event for R17 correlation. Message extended with `/systematic-debugging` nudge.
- `hooks/skill-invocation-logger.js`: includes `session_id` on `skill_invoke` emissions for R17 correlation.

### Removed
- `hooks/halt-condition-validator.js` — zero signal in 14d of observability data; no feedback citing it.
- `hooks/doc-shard-resolver.js` — zero signal in 14d; no feedback citing it.
- Corresponding settings-template entries for both hooks.

### Migration notes
- Any automation relying on `SKIP_SUBAGENT_BLOCK=1` must be rewritten to run the command in parent context (no env bypass exists).
- `get_skill` callers that relied on undocumented path-traversal behavior (there shouldn't be any) must use slugified names only.
- R15 ceiling default in v0.2.0 was 9070ms; **superseded in v0.2.1 → 5000ms**. Tune via `SESSION_START_P95_CEILING_MS` env var. Installs still on v0.2.0 should expect higher tolerance for day-1 false-positives until upgrading.

[0.2.0]: https://github.com/Daaboulex/kachow/releases/tag/v0.2.0

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

