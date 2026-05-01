# Changelog

## [0.3.0] — 2026-05-01
Bump: forced

### Ship stats
- 59 hooks + 23 lib files
- 12 shell scripts + 11 PowerShell parity
- 14 slash commands
- MCP server: 14 tools, dependency-free

## [0.3.0] — 2026-05-01
Bump: forced

### Ship stats
- 44 hooks + 14 lib files
- 12 shell scripts + 11 PowerShell parity
- 14 slash commands
- MCP server: 14 tools, dependency-free

## [0.3.0] — 2026-05-02

### Performance
- Hook matcher optimization: rule-enforcement-check fires only on Agent (was all tools, ~9K wasted spawns/week)
- 4 hooks converted to async (handoff-auto-save, skill-completion-correlator, dead-hook-detector, hook-doc-drift-detector)
- 5 pre-existing async+systemMessage bugs fixed (hooks were silently neutered)
- Session-context-loader: eliminated N redundant file reads via cached memType
- R18 blocklist converted from Array.includes to Set.has (O(n×24) → O(n×1))
- AGENTS.md reduced 33% (281→201 lines, ~4500 tokens/session saved)
- esp32-hart/cellular moved from always-loaded rules to on-demand skills (~2200 tokens saved)

### New features
- R18 detector: per-tool-call p95 regression monitoring
- R19 detector: async+systemMessage/exit(2) guard (catches silent hook neutering)
- PostCompact hook: memory-compression coupling (re-injects peer-card after compaction)
- CwdChanged hook: sets up file watches for project context files
- FileChanged hook: notifies when CLAUDE.md/AGENTS.md/.envrc change mid-session
- Model selection system: MODEL_POLICY maps task categories to recommended models with cost tracking
- Peer-card: capped 40-entry ultra-low-latency fact list loaded first at session start
- 40/60 memory budget ratio: synthesized knowledge (feedback/user) gets 40% of slots
- observation_level frontmatter: inductive/deductive/explicit scoring for memory ranking
- Subagent claim logger: tracks what agents claim vs what changed (SubagentStop)
- Skill awareness injection: surfaces available skills in session context
- SYSTEM_OVERHEAD_TOKENS constant (18K reserved for system prompt + tools)
- validate-settings-on-write Check 3: blocks writes that make blocking hooks async

### Bug fixes
- Skill regression detector rewritten: per-session-rate normalization, MIN_SESSIONS_PER_WINDOW=5, exempt set
- bandaid-loop-detector: fixed undeclared `sid` variable (was `sessionId`)
- rule-enforcement-check: model name normalization (claude-haiku-4-5 → haiku)
- meta-system-stop: reads both e.payload.skill AND e.meta.skill (backward compat)
- session-context-loader nextTitles: Set-based exclusion (was position-based slice causing duplication)
- cwd-changed-watcher: absolute paths for watchPaths (was relative)
- SUMMARY_RATIO edge case: clamp synthSlots to prevent zero recentSlots at FULL_N=1

### Cross-platform parity
- Gemini: deleted invalid UserPromptSubmit event (never fired), fixed 3 broken hook schemas, fixed 13 wrong paths (.claude→.gemini), added AI_CONTEXT_AUTOCOMMIT/AUTOPUSH env vars
- Codex: added block-subagent-writes, validate-settings-on-write, verifiedby-gate guards
- R8 drift detector: updated CLAUDE_TO_GEMINI_EVENTS with null entries for Claude-only events
- Codex tool names corrected in AGENTS.md (apply_patch, shell, Read — NOT same as Claude)
- Codex apply_patch fix marked UNVERIFIED until empirically tested

### Documentation
- AGENTS.md: R-RES-1/R-RES-2 consolidated then R-RES-2 plan anchor restored
- AGENTS.md: new hook events documented (PostCompact, CwdChanged, FileChanged, etc.)
- AGENTS.md: Gemini v0.40 and Codex v0.128 changelog notes added
- nix/CLAUDE.md: session protocol simplified (hooks auto-inject state)
- monorepo/CLAUDE.md: removed duplicated sections, compressed DLP

### Ship stats
- 44 hooks + 14 lib files
- 12 shell scripts + 11 PowerShell parity
- 14 slash commands
- MCP server: 14 tools, dependency-free
- 19 self-improvement detectors (R1-R19)

## [0.1.0] — 2026-04-21
Bump: forced

### Ship stats
- 36 hooks + 14 lib files
- 10 shell scripts + 9 PowerShell parity
- 17 slash commands
- MCP server: 14 tools, dependency-free


