# Architecture

## One source, many consumers

`~/.ai-context/` is the canonical root. Every AI tool points back to it.

```
~/.ai-context/
├── AGENTS.md                      ← single source of truth for rules
├── VERSION                        ← framework version (e.g. 0.1.0)
├── memory/                        ← markdown files with v2 frontmatter
│   ├── example.md
│   └── MEMORY.md                  ← index
├── skills/                        ← tool-neutral skill bundles
│   └── debt-tracker/
│       └── SKILL.md
├── mcp/personal-context/
│   └── server.js                  ← stdio JSON-RPC 2.0, zero deps
└── scripts/
    ├── bootstrap.{sh,ps1}
    ├── install-adapters.{sh,ps1}
    ├── install-mcp.{sh,ps1}
    ├── health-check.{sh,ps1}
    ├── hook-stats.sh
    ├── cleanup-stale.sh
    ├── scrub-check.sh
    └── self-update.{sh,ps1}
```

Each AI-tool config file is a symlink back:

```
~/.claude/CLAUDE.md           → ~/.ai-context/AGENTS.md
~/.gemini/GEMINI.md           → ~/.ai-context/AGENTS.md
~/.codex/AGENTS.md            → ~/.ai-context/AGENTS.md
~/.config/opencode/AGENTS.md  → ~/.ai-context/AGENTS.md
~/.config/aider/AGENTS.md     → ~/.ai-context/AGENTS.md
```

Edit `AGENTS.md` once, every tool picks up the change on next session open.

## What actually happens on session start

The flow below is literal — every numbered step corresponds to a hook registered
in `settings.template.json`. Timings are measured on a mid-range Linux box.

```
[user opens Claude Code]
          │
          ▼
┌─────────────────────────────────────────────────────────┐
│ SessionStart chain (parallel where safe, blocks session │
│ until all synchronous hooks complete or timeout)        │
└─────────────────────────────────────────────────────────┘
  1. auto-pull-global        │ git fetch+rebase ~/.claude + ~/.gemini
  2. plugin-update-checker   │ async — checks plugin upstreams
  3. session-start-combined  │ ~400ms — runs 13 sub-sections:
     a. .reflect-enabled marker touch
     b. stale-lock cleanup (dream-lock, /tmp claude-ctx-*)
     c. consolidate-memory session counter (atomic)
     d. handoff retention (archive >7d versioned, >14d pointer)
     e. stale-task cleanup (AI-tasks.json done >14d)
     f. sync hook versions (GSD VERSION tag)
     g. ensure portable memory symlink
     h. sync memory dirs (.claude ↔ .gemini, newer wins)
     i. session catchup (missed-reflect detection)
     j. version-change detector → auto-writes changelog memory via gh CLI
     k. research session counter (atomic)
     l. symlink integrity audit (lib/symlink-audit.js)
     m. settings drift check (managed-only / deprecated / unknown keys)
  4. session-context-loader  │ Injects a systemMessage carrying:
                             │   • AI-tasks.json open items
                             │   • self-improvement queue size
                             │   • memory index top 5 entries
                             │   • handoff progress badge (⚠ N/M)
                             │   • stale-process badge if orphans detected
                             │   • superpowers specs/plans count
                             │   • GSD milestone state
  5. skill-upstream-checker  │ async — weekly skill repo fetch
  6. session-presence-start  │ Registers session + shows peer count
  7. validate-instructions   │ async — drift check across CLAUDE.md / GEMINI.md
```

## What happens on every tool call

```
[Claude about to run tool T on file F]
          │
          ▼
┌─────────────────────────────────────────────────────────┐
│ PreToolUse chain — any hook can BLOCK the call          │
│ by returning {"continue":false,"decision":"block",...}  │
└─────────────────────────────────────────────────────────┘

Matcher=Write:
  validate-settings-on-write  ─ blocks if settings.json would become invalid
  prefer-editing-nudge        ─ warns on foo-v2.ts next to foo.ts
  pre-write-combined-guard    ─ safety net (subagent protections, path sanity)

Matcher=Bash:
  block-subagent-writes       ─ hard-blocks subagent git commit/push/reset
  pre-write-combined-guard
  autosave-before-destructive ─ auto-stashes before rm -rf / reset --hard

Matcher=TodoWrite: verifiedby-gate (blocks done-task with empty verifiedBy)

          │ (tool runs if nothing blocked)
          ▼
┌─────────────────────────────────────────────────────────┐
│ PostToolUse chain — observers + sync                    │
└─────────────────────────────────────────────────────────┘

Matcher=Write|Edit:
  post-write-sync         ─ AGENTS.md → tool configs mirroring
  dead-hook-detector      ─ catches hook file changes without settings update
  research-lint           ─ source-citation drift under research/ roots
  bandaid-loop-detector   ─ flags 3+ edits to same file → root-cause prompt
  skill-drift-guard       ─ nudges toward existing skills on ad-hoc continuation

Matcher=Skill:    skill-invocation-logger (feeds analytics)
Matcher=Read:     memory-retrieval-logger
Matcher=all:      session-presence-track (heartbeat)
```

## What happens on session end

```
[Claude Code exits]
          │
          ▼
Stop chain (fires sequentially; slow ones marked async):

  1. session-presence-end     ─ remove from presence files
  2. todowrite-persist        ─ promote in-progress → AI-tasks.json
  3. reflect-stop             ─ nudges /wrap-up if meaningful work done
  4. dream-auto               ─ dual-gate /consolidate-memory trigger
  5. memory-rotate (async)    ─ TTL rotation to memory/archive/
  6. auto-push-global (async) ─ commit + push ~/.claude + ~/.gemini
  7. track-skill-usage(async) ─ skill-usage.json append
  8. meta-system-stop         ─ self-improvement detectors + queue
  9. stop-sleep-consolidator  ─ idle-box long-tail cleanup
```

## MCP server

- **Transport:** stdio, JSON-RPC 2.0
- **Protocol versions:** `2025-06-18` (preferred) + `2025-03-26` + `2024-11-05`
  (advertised via `SUPPORTED_PROTOCOL_VERSIONS` in `server.js`)
- **Dependencies:** zero — Node stdlib only
- **Tools exposed:** 14 (read: `search_memory`, `read_memory`, `list_memories`,
  `list_skills`, `get_skill`, `read_debt`, `get_rule`, `read_handoff`,
  `list_handoffs`, `list_tasks`, `read_progress`, `search_handoffs`;
  write: `add_memory`, `add_debt`)
- **Registered in:** Claude Code (`~/.claude.json`), Gemini CLI
  (`~/.gemini/settings.json`), Codex CLI (`~/.codex/config.toml`), OpenCode
  (`~/.config/opencode/config.json`), Cursor (`~/.cursor/mcp.json`),
  Continue.dev (`~/.continue/config.yaml`) — whichever clients are installed.

## Memory v2 schema

Every file in `memory/` has YAML frontmatter:

```yaml
---
name: Short human-readable title
description: One-line description — specific, searchable
type: user | feedback | project | reference | procedure
created: 2026-04-21          # YYYY-MM-DD when added
last_verified: 2026-04-21    # bumped when content re-checked against reality
last_accessed: 2026-04-21    # auto-updated by memory-retrieval-logger
ttl_days: permanent          # permanent | 180 | 90 | 30
evidence: [file:/abs/path, url:..., commit:<sha>]
status: active               # active | archived | deprecated
# optional:
superseded_by: new_file.md
---
```

`type` determines shape + default TTL:
- **user** — who the user is / preferences / expertise (permanent)
- **feedback** — corrections + approvals (include **Why** + **How to apply**) (90d)
- **project** — current work context (90d)
- **reference** — pointer to external systems (permanent)
- **procedure** — how-tos and runbooks (180d)

`MEMORY.md` is a one-line-per-entry index — always loaded; truncated after line 200.

**TTL rotation:** `memory-rotate.js` (Stop hook, 7-day cooldown) moves a file
to `memory/archive/` when `now - last_verified > ttl_days` and `ttl_days != permanent`. Archive is never deleted — audit trail survives.

**v1 backward compat:** older memories with just `name`/`description`/`type` plus
optional `superseded_by`/`valid_until` still load. Run
`node hooks/lib/memory-migrate.js --migrate-to-v2` to upgrade in place.

## Scrub pipeline (personal info containment)

Four layers protect the public repo:

```
1. Editor / pre-commit  ← developer convenience, not authoritative
       │
2. scripts/scrub-check.sh  ← assembles token regex from parts, scans repo
       │                     Install as .git/hooks/pre-push to block local push
3. CI scrub-gate          ← same regex, runs on every push/PR to main
       │                     Fails build if any personal token surfaces
4. hook-interaction-map   ← sanitizePath() replaces /home/USER, /Users/USER,
                            C:\Users\USER with `~` in auto-generated docs
```

The token list is assembled at runtime from parts so the scan file doesn't
self-match. Permitted locations: `docs/`, `README.md`, `LICENSE`,
`CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, `.github/workflows/ci.yml`.

## Portability model

Hooks are pure Node (stdlib-only). Scripts ship as `.sh` + `.ps1` pairs.
CI runs on ubuntu-latest + macos-latest + windows-latest and exercises:

- `node -c` syntax check on every hook + lib
- `hooks/tests/hook-selftest.sh` per-hook smoke
- `hooks/tests/session-lifecycle-test.sh` end-to-end lifecycle
- `bash -n` on every `.sh` (Linux + macOS)
- `[scriptblock]::Create()` parse on every `.ps1` (all 3 OSes via pwsh)
- MCP server smoke (init + tools/list, expects ≥10 tools)
- scrub-gate against personal-token list
