# Changelog

All notable changes to this framework. See [Semantic Versioning](https://semver.org/).

> *"I eat losers for breakfast."* — Lightning McQueen, while your hooks pass selftest at 0.4s

## [Unreleased]

## [0.1.0] — 2026-04-21

Initial public release. *Ka-chow.*

### Ship stats

- 36 hooks + 14 lib files
- 11 shell scripts + 11 PowerShell parity (adds `self-update`, `validate-skills`)
- 17 slash commands
- MCP server: 14 tools, dependency-free, version read from VERSION file
- 9 docs (ARCHITECTURE, ADDING-A-HOOK, CROSS-PLATFORM, DROP-IN, HOOKS, LOCATIONS, MAINTENANCE, SKILLS, TROUBLESHOOTING)

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
