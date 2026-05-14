---
description: >
  One-command sync of ALL context artifacts across all 5 tools (Claude, Gemini, Codex, Crush, OpenCode) — hooks, skills,
  rules, memories, commands, settings. Run after any context system change to ensure
  everything is in sync across all locations. Use instead of manually copying files.
---

# Sync All Context Artifacts

Source of truth: `~/.ai-context/`. All 5 tool dirs are derived state via symlinks. This command verifies and restores that architecture.

## Architecture

```
~/.ai-context/                    ← CANONICAL (only git repo)
├── AGENTS.md                     ← symlinked to all tool dirs
├── hooks/                        ← symlinked from all tool hook dirs
├── commands/                     ← symlinked from Claude + Gemini command dirs
├── skills/                       ← 20 canonical skills (real dirs)
├── configs/                      ← generated settings for all 4 tools
├── memory/                       ← symlinked from all tool memory dirs
├── mcp/personal-context/        ← MCP server (registered in all tools)
├── project-state/<project>/      ← per-project: rules, memory, skills, .superpowers
└── scripts/MANIFEST.yaml         ← hook registry → generate-settings.mjs

~/.agents/skills/                 ← 120 skills (20 canonical + 100 plugin symlinks)
~/.claude/, ~/.gemini/, etc.      ← DERIVED STATE (symlinks to canonical)
```

## Process

### Step 1: Regenerate settings from MANIFEST

```bash
cd ~/.ai-context
node scripts/generate-settings.mjs --apply --all
```

This reads `scripts/MANIFEST.yaml` and generates settings for Claude, Gemini, Codex, and Crush. Tool settings files are symlinks to `configs/`.

### Step 2: Verify symlinks (global)

```bash
node scripts/install-adapters.mjs --check 2>&1 || node scripts/install-adapters.mjs
```

This checks and restores symlinks:
- `~/.claude/CLAUDE.md` → `~/.ai-context/AGENTS.md`
- `~/.gemini/GEMINI.md` → `~/.ai-context/AGENTS.md`
- `~/.codex/AGENTS.md` → `~/.ai-context/AGENTS.md`
- `~/.config/opencode/AGENTS.md` → `~/.ai-context/AGENTS.md`
- Hook dirs: `~/.claude/hooks`, `~/.gemini/hooks`, `~/.codex/hooks` → `~/.ai-context/hooks`
- Settings: tool settings files → `~/.ai-context/configs/*`
- Memory: `~/.claude/memory`, `~/.gemini/memory` → `~/.ai-context/memory`
- Commands: `~/.claude/commands`, `~/.gemini/commands` → `~/.ai-context/commands`

### Step 3: Verify per-project symlinks

For each project with `.ai-context/`:
```bash
for proj in ~/Documents/[project] ~/Documents/nix; do
  echo "=== $(basename $proj) ==="
  [ -L "$proj/.ai-context" ] && echo ".ai-context: $(readlink $proj/.ai-context)" || echo "MISSING .ai-context symlink"
  for sub in .claude/memory .gemini/memory .claude/rules .gemini/rules .claude/commands .gemini/commands; do
    [ -L "$proj/$sub" ] && echo "  $sub: OK" || echo "  $sub: NOT SYMLINKED"
  done
done
```

### Step 4: Run health checks

```bash
node scripts/health-check.mjs
node scripts/system-integrity-check.mjs
node scripts/generate-settings.mjs --check --all
```

### Step 5: Verify plugin skill parity

```bash
echo "Canonical skills: $(ls ~/.ai-context/skills/ | wc -l)"
echo ".agents/skills: $(ls ~/.agents/skills/ | wc -l)"
echo "Claude skills: $(ls ~/.claude/skills/ | wc -l)"
echo "Gemini skills: $(ls ~/.gemini/skills/ | wc -l)"
echo "Codex skills: $(ls ~/.codex/skills/ | wc -l)"
```

### Step 6: Verify MCP servers

All 5 tools should have `personal-context` MCP registered. Check:
```bash
for tool in claude gemini codex crush opencode; do
  echo "$tool: $(grep -c 'personal-context' ~/.ai-context/configs/*$tool* ~/.claude.json 2>/dev/null | grep -v ':0' | head -1)"
done
```

## When to run

- After editing MANIFEST.yaml (hook changes) → Steps 1 + 4
- After adding/editing skills → Step 5
- After system updates (Claude Code, Gemini CLI releases) → All steps
- After `/consolidate-memory` finds issues → Steps 2-4
- After setting up a new project → Steps 2-3

## What NOT to do

- **Never manually copy files** between tool dirs — use symlinks
- **Never edit tool dir configs directly** — edit canonical at `~/.ai-context/`, then run this command
- **Never run `sync-ai-config.ps1`** — that was the old pre-One-Brain approach, now replaced by symlinks
