# Architecture

## Directory layout

```
~/.ai-context/                    (canonical source — single repo)
├── AGENTS.md                     ← one file, symlinked to all 4 CLIs
├── core/
│   ├── memory/                   ← frontmatter + markdown, typed
│   ├── commands/                 ← slash commands (markdown)
│   └── skills/                   ← tool-neutral SKILL.md files
├── modules/
│   ├── hooks/
│   │   ├── MANIFEST.yaml         ← single source of truth for hook registration
│   │   ├── src/                  ← 15 hook files (pure Node, zero deps)
│   │   └── lib/                  ← 28 shared helpers
│   ├── skill-exclusions.yaml     ← centralized exclusion list
│   └── tools/
│       ├── claude/               ← capabilities.yaml, symlinks.yaml
│       ├── gemini/
│       ├── codex/
│       └── pi/
├── generated/configs/            ← machine-generated, never hand-edit
│   ├── claude-settings.json
│   ├── gemini-settings.json
│   ├── codex-config.toml
│   └── kachow-bridge.ts
└── scripts/
    ├── generate-settings.mjs     ← MANIFEST → per-tool configs
    ├── verify.mjs                ← structure + sync verification
    ├── test-hooks.mjs            ← hook runtime tests
    ├── verify-symlinks.mjs       ← symlink health checker
    └── scrub-for-publish.sh      ← private → public mirror pipeline
```

## Symlink architecture

Every tool's home directory contains symlinks pointing into `~/.ai-context/`:

| Target | Claude | Gemini | Codex | Pi |
|---|---|---|---|---|
| AGENTS.md | `~/.claude/CLAUDE.md` | `~/.gemini/GEMINI.md` | `~/.codex/AGENTS.md` | `~/.pi/agent/AGENTS.md` |
| Settings | `~/.claude/settings.json` | `~/.gemini/settings.json` | `~/.codex/config.toml` | `~/.pi/agent/settings.json` |
| Hooks | `~/.claude/hooks/` | `~/.gemini/hooks/` | `~/.codex/hooks/` | (generated bridge) |
| Memory | `~/.claude/memory/` | `~/.gemini/memory/` | `~/.codex/memories/` | (via extension) |
| Commands | `~/.claude/commands/` | `~/.gemini/commands/` | — | — |

Pi is unique: no declarative hook system, so hooks are delivered via an auto-generated TypeScript extension (`kachow-bridge.ts`).

## Config generation pipeline

```
MANIFEST.yaml + capabilities.yaml + skill-exclusions.yaml
                    │
          generate-settings.mjs --apply
                    │
    ┌───────────────┼───────────────┬───────────────┐
    ▼               ▼               ▼               ▼
claude-settings  gemini-settings  codex-config    kachow-bridge
    .json           .json           .toml           .ts
```

Each tool has a `capabilities.yaml` defining supported events, tool names, and timeout units. The generator translates canonical hook definitions to tool-specific format:

- Claude: JSON with `args[]` exec form, `continueOnBlock`
- Gemini: JSON with millisecond timeouts, `mcp_.*` matchers
- Codex: TOML with `[features] codex_hooks = true`
- Pi: TypeScript extension with `pi.on()` event handlers

## Skill exclusions

`modules/skill-exclusions.yaml` is the centralized list. The generator distributes it to all 4 CLIs in their native format:

| CLI | Exclusion format |
|---|---|
| Claude | `skillOverrides: {"compound-engineering:name": "name-only"}` |
| Gemini | `skills.disabled: ["name"]` |
| Codex | `[[skills.config]]` with `enabled = false` |
| Pi | `!~/.ai-context/.agents/skills/name` prefix |

## Verification

- `node scripts/verify.mjs` — structure, MANIFEST, symlinks, kachow sync
- `node scripts/test-hooks.mjs` — runs all 15 hooks with sample input
- `node scripts/verify-symlinks.mjs` — validates all symlinks from `symlinks.yaml`
- `node scripts/generate-settings.mjs --check` — critical hook presence in configs

## Public release pipeline

The scrub pipeline (`scrub-for-publish.sh`) takes the private source and produces a clean, portable framework:

1. Whitelist filter — only portable hooks, commands, skills, lib files
2. PII rewrite — forbidden tokens replaced via `scrub-config.json`
3. Template generation — AGENTS.md and settings templates sanitized
4. Scrub gate — final scan for any remaining forbidden tokens
5. Output to `public/kachow-mirror/` (gitignored, regenerated on each run)
