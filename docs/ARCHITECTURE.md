# Architecture

## Canonical-source pattern

```
~/.ai-context/
├── AGENTS.md          ← one file
├── memory/            ← plain markdown with v2 frontmatter
├── skills/            ← tool-neutral skill files
├── mcp/personal-context/server.js   ← stdio JSON-RPC, dep-free Node
└── scripts/           ← install / bootstrap / health-check / snapshot
```

Every AI tool symlinks into it:

```
~/.claude/CLAUDE.md   → ~/.ai-context/AGENTS.md
~/.gemini/GEMINI.md   → ~/.ai-context/AGENTS.md
~/.codex/AGENTS.md    → ~/.ai-context/AGENTS.md
~/.config/opencode/AGENTS.md → ~/.ai-context/AGENTS.md
~/.config/aider/AGENTS.md    → ~/.ai-context/AGENTS.md
```

## Hook lifecycle (Claude + Gemini only)

- **SessionStart**: auto-pull, load context, validate symlinks, check plugin updates
- **PreToolUse**: safety guards (block-subagent-writes, autosave-before-destructive, verifiedby-gate, pre-write-combined-guard)
- **PostToolUse**: sync hooks, loggers, drift detectors, pattern enforcement
- **SubagentStart/Stop**: harness inject + quality gate
- **Stop**: session-end ritual (presence, todowrite persist, ai-snapshot (excluded from public mirror — user-specific), reflect, dream-auto, meta-system, auto-push)
- **PreCompact**: reflect-precompact if Claude is about to compact context
- **Notification**: desktop/headless notification routing (notify-with-fallback)
- **UserPromptSubmit** (Claude only): per-prompt overhead logging, prompt hashing, scope-drift tracking, slash-command logging
- **CwdChanged / FileChanged** (Claude only): directory change tracking, external file change notification, post-compaction memory handling

## MCP protocol

- Transport: stdio, JSON-RPC 2.0
- Version: `2025-11-05`
- Zero dependencies — only Node stdlib
- Tools registered in each client's config file via `install-mcp.sh`

## Memory v2 schema

See [`memory/example.md`](../memory/example.md) for the full frontmatter spec.

TTL rotation: `memory-rotate.js` Stop hook runs every 7d; moves expired to `memory/archive/` (never deletes).
