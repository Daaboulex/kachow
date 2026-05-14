---
description: Check all 5 tools' context files are in sync — detect drift between commands, skills, rules, instructions, and hook files.
---

# Verify AI Context Sync

Comprehensive parity check across all 5 tools (Claude, Gemini, Codex, Crush, OpenCode). Source of truth: `~/.ai-context/`. Tool dirs are derived state via symlinks.

## Architecture

Everything in tool dirs should be a symlink to `~/.ai-context/` or `~/.ai-context/project-state/<project>/`. If a file is REAL (not a symlink) in a tool dir, it's either:
- **Legitimate local config** (settings.json, hooks/, agents/ — tool-specific per upstream requirements)
- **Drift** (should be a symlink but isn't — fix it)

## Process

### 1. Global symlink integrity

```bash
echo "=== AGENTS.md chain ==="
for f in ~/.claude/CLAUDE.md ~/.gemini/GEMINI.md ~/.codex/AGENTS.md ~/.config/opencode/AGENTS.md ~/.config/aider/AGENTS.md; do
  target=$(readlink "$f" 2>/dev/null)
  [ -n "$target" ] && echo "OK: $f → $target" || echo "BROKEN: $f"
done

echo "=== Hook dirs ==="
for d in ~/.claude/hooks ~/.gemini/hooks ~/.codex/hooks; do
  target=$(readlink "$d" 2>/dev/null)
  [ "$target" = "$HOME/.ai-context/hooks" ] && echo "OK: $d" || echo "DRIFT: $d → $target"
done

echo "=== Settings ==="
for pair in "claude:settings.json:claude-settings.json" "gemini:settings.json:gemini-settings.json" "codex:config.toml:codex-config.toml"; do
  IFS=: read tool file target <<< "$pair"
  actual=$(readlink -f ~/.$tool/$file 2>/dev/null || readlink -f ~/.config/$tool/$file 2>/dev/null)
  expected="$HOME/.ai-context/configs/$target"
  [ "$actual" = "$expected" ] && echo "OK: $tool settings" || echo "DRIFT: $tool settings → $actual (expected $expected)"
done

echo "=== Memory ==="
for d in ~/.claude/memory ~/.gemini/memory; do
  target=$(readlink "$d" 2>/dev/null)
  [ "$target" = "$HOME/.ai-context/memory" ] && echo "OK: $d" || echo "DRIFT: $d → $target"
done

echo "=== Commands ==="
for d in ~/.claude/commands ~/.gemini/commands; do
  target=$(readlink "$d" 2>/dev/null)
  [ "$target" = "$HOME/.ai-context/commands" ] && echo "OK: $d" || echo "DRIFT: $d → $target"
done
```

### 2. Settings validity

```bash
node ~/.ai-context/scripts/generate-settings.mjs --check --all
```

All 4 tools should report OK. If any FAIL: run `--apply --all` to regenerate.

### 3. Per-project parity

For each project, verify:
```bash
for proj in ~/Documents/[project] ~/Documents/nix; do
  name=$(basename "$proj")
  echo "=== $name ==="
  # .ai-context symlink
  target=$(readlink "$proj/.ai-context" 2>/dev/null)
  echo ".ai-context: $target"
  
  # Instruction files chain to project-rules.md
  for f in CLAUDE.md GEMINI.md AGENTS.md; do
    resolved=$(readlink -f "$proj/$f" 2>/dev/null)
    echo "$f → $(basename "$resolved" 2>/dev/null)"
  done
  
  # Shared dirs are symlinks
  for sub in .claude/memory .gemini/memory .claude/rules .gemini/rules .claude/commands .gemini/commands .claude/.superpowers .gemini/.superpowers; do
    [ -L "$proj/$sub" ] && echo "  $sub: SYMLINK ✓" || echo "  $sub: NOT SYMLINK ✗"
  done
done
```

### 4. Skill parity

```bash
echo "Canonical: $(ls ~/.ai-context/skills/ | wc -l) skills"
echo ".agents/skills: $(ls ~/.agents/skills/ | wc -l) total (canonical + plugin)"
echo ""
echo "=== Broken symlinks in .agents/skills/ ==="
find ~/.agents/skills/ -maxdepth 1 -type l ! -exec test -e {} \; -print
```

### 5. MEMORY.md health

```bash
echo "Lines: $(wc -l < ~/.ai-context/memory/MEMORY.md) (limit: 200)"
echo "Sentinels: $(grep -c 'AUTO-INDEX' ~/.ai-context/memory/MEMORY.md)"
echo "Files: $(ls ~/.ai-context/memory/*.md | wc -l)"
```

### 6. MCP servers

```bash
node --check ~/.ai-context/mcp/personal-context/server.js && echo "MCP syntax: OK"
echo "MCP tools: $(grep -c 'description:' ~/.ai-context/mcp/personal-context/server.js) (expect ~35 description lines for 13 tools)"
```

### 7. Version consistency

```bash
ver=$(cat ~/.ai-context/VERSION)
echo "VERSION: $ver"
grep -q "v$ver" ~/.ai-context/AGENTS.md && echo "AGENTS.md: ✓" || echo "AGENTS.md: STALE"
grep -q "v$ver" ~/.ai-context/README.md && echo "README.md: ✓" || echo "README.md: STALE"
grep -q "v$ver" ~/.ai-context/KNOWN-LIMITS.md && echo "KNOWN-LIMITS.md: ✓" || echo "KNOWN-LIMITS.md: STALE"
```

### 8. Git state

```bash
echo "ai-context uncommitted: $(git -C ~/.ai-context status --porcelain | wc -l) files"
echo "ai-context branch: $(git -C ~/.ai-context branch --show-current)"
```

The `auto-push-global.js` Stop hook auto-commits at session end.

## Report format

```
## Context Sync Report

Global symlinks: [OK | N broken]
Settings (4 tools): [OK | DRIFT]
Per-project (N projects): [OK | issues]
Skills: [N] canonical + [M] plugin = [total] in .agents/
Memory: [N] lines, [M] files
MCP: [OK | issues]
Versions: [OK | STALE]
Git: [N] uncommitted
```

## Red Flags

| Thought | Reality |
|---------|---------|
| "I'll just edit ~/.claude/settings.json directly" | Edit MANIFEST.yaml + `generate-settings.mjs --apply --all` |
| "I'll copy this file to .gemini/" | Use symlinks. Never copy. |
| "Only Claude and Gemini need checking" | All 5 tools. Crush and OpenCode read from .agents/skills/. |
| "The symlinks are fine, I checked last week" | Run this command. Hooks and plugins can break symlinks. |
