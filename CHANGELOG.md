# Changelog

All notable changes to this framework. See [Semantic Versioning](https://semver.org/).

## [1.0.0] — 2026-05-14

Complete v2 architecture rewrite. 15 focused hooks, MANIFEST-driven generation, 4-CLI parity.

### Architecture
- **MANIFEST-driven config generation** — one YAML manifest → Claude JSON, Gemini JSON, Codex TOML, Pi TypeScript
- **15 hooks** consolidated from 73 (functionality preserved, not removed)
- **28 library helpers** — tool-detect, tool-paths, hook-logger, safety-timeout, and more
- **Declarative symlinks** via `symlinks.yaml` per tool
- **Centralized skill exclusions** — one list generates filters for all 4 CLIs

### Hooks
- `auto-pull-global` / `auto-push-global` — session start/end git sync
- `session-context-loader` — memory, handoffs, context injection
- `block-subagent-writes` / `block-subagent-non-bash-writes` — subagent containment
- `autosave-before-destructive` — auto-stash before dangerous commands
- `pre-write-combined-guard` / `scrub-sentinel` — path/content policy + secret stripping
- `agent-dependency-guard` — subagent dispatch validation
- `context-pressure-enforce` — context fill monitoring
- `memory-index-updater` — auto-rebuild memory index
- `caveman-precompact` / `caveman-post-compact-reinject` — mode preservation across compaction
- `meta-system-stop` — self-improvement scanner
- `handoff-session-end` — session state for cross-session continuity

### Per-CLI Support
| CLI | Config | Hooks | Exclusions |
|-----|--------|-------|------------|
| Claude Code | JSON (args[] exec form) | 15 | skillOverrides |
| Gemini CLI | JSON (ms timeouts) | 15 | skills.disabled |
| Codex CLI | TOML | 15 | [[skills.config]] |
| Pi | TypeScript extension | 13 | ! prefix |

### Verification
- `test-hooks.mjs` — runtime tests for all hooks
- `verify-symlinks.mjs` — validates symlinks from declarative config
- `lint-docs.mjs` — detects stale references
- `verify.mjs` — full structure verification
- `check-cli-versions.mjs` — CLI version drift detection
- `export-session.mjs` — session transcript → HTML (all 4 CLIs)

### Install
```bash
git clone https://github.com/Daaboulex/kachow ~/.ai-context
cd ~/.ai-context && node scripts/bootstrap.mjs
```

[1.0.0]: https://github.com/Daaboulex/kachow/releases/tag/v1.0.0
