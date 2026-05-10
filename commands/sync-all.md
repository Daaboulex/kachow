---
description: >
  One-command sync of ALL context artifacts across all 5 tools (Claude, Gemini, Codex, Crush, OpenCode) — hooks, skills,
  rules, memories, commands, settings. Run after any context system change to ensure
  everything is in sync across all locations. Use instead of manually copying files.
---

# Sync All Context Artifacts

One command to sync everything. Run this after adding/editing any hook, skill, rule,
memory, or command to ensure all 5 tools stay in parity. Source of truth: `~/.ai-context/`. Tool dirs are derived state via symlinks.

## What it syncs

| Artifact | Direction | How |
|---|---|---|
| Skills | Source → all tool dirs | Copy .claude/skills/ → .gemini/skills/ (Codex/Crush/OpenCode read via symlinks) |
| Rules | Source → all tool dirs | Copy .claude/rules/ → .gemini/rules/ |
| Memories | `~/.ai-context/memory/` | Shared via symlinks — no copy needed for global memory |
| Commands | `~/.ai-context/commands/` → tool dirs | Copy with Claude→Gemini adaptations; Codex/Crush see via symlinks |
| AGENTS.md → GEMINI.md | Automatic | sync-gemini-md.js hook handles Claude→Gemini; other tools read AGENTS.md directly |
| Hook files | `~/.ai-context/hooks/` → tool dirs | Source of truth; tool dirs symlink here |
| Agent-harness + skill-creator | To other projects | Copy to other projects' .gemini/skills/ (discover dynamically) |

## Process

### Step 1: Run sync-ai-config.ps1 for skills/rules/memory

```bash
pwsh [tooling-dir]/sync-ai-config.ps1
```

This handles: skills, rules, memory files, AI-tasks.json, AI-progress.json, CLAUDE.md→GEMINI.md.

**Important:** After this runs, re-add any Gemini-only skills that were orphan-removed:
```bash
# skill-creator is Gemini-only (adapted Python scripts)
cp -r ~/.gemini/extensions/skill-creator/skills/skill-creator .gemini/skills/skill-creator
```

### Step 2: Sync hook FILES (shared hooks)

```bash
# Hooks that are identical on both platforms
# NOTE: hooks that were merged into combined hooks (pre-write-combined-guard,
# post-write-sync, session-start-combined) are NOT in this list — they no longer
# exist as standalone files. See .audit/dead-hooks-backup/ for the historical
# inventory of what was archived.
for h in session-context-loader.js claude-gemini-json-sync.js \
         track-skill-usage.js post-commit-sync-reminder.js \
         subagent-harness-inject.js subagent-quality-gate.js task-verification-gate.js \
         auto-push-global.js dream-auto.js \
         gsd-check-update.js gsd-context-monitor.js \
         reflect-precompact.js sync-memory-dirs.js; do
  [ -f "$HOME/.claude/hooks/$h" ] && cp "$HOME/.claude/hooks/$h" "$HOME/.gemini/hooks/$h"
done
echo "Shared hooks synced"
```

### Step 3: Sync multi-project skills

```bash
# Agent-harness to all locations
# Discover all projects with .gemini/skills/ and sync agent-harness to each
for dest in .gemini/skills/agent-harness $(find ~/Documents -maxdepth 3 -path '*/.gemini/skills' -type d 2>/dev/null | sed 's|$|/agent-harness|'); do
  mkdir -p "$dest" 2>/dev/null
  cp .claude/skills/agent-harness/SKILL.md "$dest/SKILL.md" 2>/dev/null
done
echo "Multi-project skills synced"
```

### Step 4: Verify parity

```bash
echo "Skills: $(diff <(ls .claude/skills/ | sort) <(ls .gemini/skills/ | sort) > /dev/null && echo IDENTICAL || echo DRIFT)"
echo "Rules: $(diff <(ls .claude/rules/ | sort) <(ls .gemini/rules/ | sort) > /dev/null && echo IDENTICAL || echo DRIFT)"
echo "Agents: $(diff <(ls .claude/agents/ | sort) <(ls .gemini/agents/ | sort) > /dev/null && echo IDENTICAL || echo DRIFT)"
echo "Claude hooks: $(ls ~/.claude/hooks/*.js | wc -l) files"
echo "Gemini hooks: $(ls ~/.gemini/hooks/*.js | wc -l) files"
jq empty ~/.claude/settings.json && echo "Claude settings: VALID"
jq empty ~/.gemini/settings.json && echo "Gemini settings: VALID"
```

### Step 5: Audit hook registrations

**HALT: If any check fails, fix before proceeding.**

```bash
echo "=== Gemini: No Claude tool names in matchers ==="
jq -r '.. | .matcher? // empty' ~/.gemini/settings.json .gemini/settings.json 2>/dev/null | \
  grep -E '\bBash\b|\bEdit\b|\bWrite\b|\bMultiEdit\b|\bAgent\b|\bTask\b|\bedit_file\b|\breplace_in_file\b|\bpatch_file\b' \
  && echo "FAIL: Claude tool names found in Gemini matchers!" || echo "PASS"

echo "=== Gemini: Timeouts in milliseconds (>=1000) ==="
jq -r '.. | objects | select(.timeout) | .timeout' ~/.gemini/settings.json .gemini/settings.json 2>/dev/null | \
  while read t; do [ "$t" -lt 1000 ] 2>/dev/null && echo "FAIL: timeout ${t}ms too low (should be ${t}000?)"; done
echo "PASS (if no FAIL above)"

echo "=== Gemini: No statusLine key (not supported) ==="
jq 'has("statusLine")' ~/.gemini/settings.json .gemini/settings.json 2>/dev/null | \
  grep -q true && echo "FAIL: statusLine found (not valid in Gemini)" || echo "PASS"

echo "=== Claude: No deprecated Task alias in matchers ==="
grep -c '"Task"' ~/.claude/settings.json .claude/settings.json 2>/dev/null | \
  grep -v ':0$' && echo "FAIL: Deprecated Task alias found" || echo "PASS"

echo "=== Both: All referenced hook files exist ==="
for f in $(jq -r '.. | .command? // empty' ~/.claude/settings.json ~/.gemini/settings.json 2>/dev/null | \
  grep -oP '(?<=hooks/)[a-z-]+\.js'); do
  [ ! -f "$HOME/.claude/hooks/$f" ] && [ ! -f "$HOME/.gemini/hooks/$f" ] && echo "MISSING: $f"
done
echo "PASS (if no MISSING above)"
```

### Step 6: Check plugin/extension versions

```bash
echo "=== Plugin versions ==="
echo "Claude superpowers: $(jq -r .version ~/.claude/plugins/cache/claude-plugins-official/superpowers/*/package.json 2>/dev/null)"
echo "Gemini superpowers: $(jq -r .version ~/.gemini/extensions/superpowers/gemini-extension.json 2>/dev/null)"
echo ""
echo "=== Marketplace freshness ==="
for repo in ~/.claude/plugins/marketplaces/*/; do
  name=$(basename "$repo")
  behind=$(cd "$repo" && git rev-list HEAD..origin/main --count 2>/dev/null || echo "?")
  echo "$name: $behind commits behind upstream"
done
```

If Gemini superpowers version is behind Claude, sync skills:
```bash
for sd in ~/.claude/plugins/cache/claude-plugins-official/superpowers/*/skills/*/; do
  sn=$(basename "$sd")
  gd="$HOME/.gemini/extensions/superpowers/skills/$sn/"
  [ -d "$gd" ] && cp -r "$sd"* "$gd"
done
jq ".version = \"$(jq -r .version ~/.claude/plugins/cache/claude-plugins-official/superpowers/*/package.json)\"" \
  ~/.gemini/extensions/superpowers/gemini-extension.json > /tmp/ge.json && \
  mv /tmp/ge.json ~/.gemini/extensions/superpowers/gemini-extension.json
```

If marketplaces are behind, update them:
```bash
for repo in ~/.claude/plugins/marketplaces/*/; do
  (cd "$repo" && git pull --ff-only 2>/dev/null)
done
```

## When to run

- After creating a new hook → run Step 2 + register in ALL applicable settings.json files
- After creating/editing a skill → Step 1 handles it (+ Step 3 for multi-project)
- After creating/editing a memory → Step 1 handles it (global memory auto-shared via symlinks)
- After full system changes → run all steps
- After /consolidate-memory deep finds issues → run all steps
- After Claude Code updates → run Step 5 to check plugin freshness

## Hook registration reminder

When adding a new hook, register in BOTH settings files with correct event names AND tool names:

| Claude Event | Gemini Event |
|---|---|
| SessionStart | SessionStart |
| PreToolUse | BeforeTool |
| PostToolUse | AfterTool |
| Stop | SessionEnd |
| PreCompact | PreCompress |
| SubagentStart | BeforeAgent |
| SubagentStop | AfterAgent |
| TaskCompleted | AfterTool (matcher: `complete_task\|write_todos`) |

### Hook code convention: TOOL_NORM normalizer

Every hook that checks `tool_name` MUST normalize it first so the same code works on both platforms:

```javascript
// Add at top of tool_name handling — normalizes Gemini names to Claude names
const TOOL_NORM = { write_file: 'Write', replace: 'Edit', run_shell_command: 'Bash', read_file: 'Read', activate_skill: 'Skill' };
const toolName = TOOL_NORM[input.tool_name] || input.tool_name || '';
// Now check toolName — works on BOTH platforms
```

Hooks that DON'T check tool_name (most SessionStart/Stop hooks) don't need this.

### Tool name mapping (matchers)

| Claude | Gemini |
|---|---|
| `Bash` | `run_shell_command` |
| `Write` | `write_file` |
| `Edit` / `MultiEdit` | `replace` |
| `Glob` | `glob` |
| `Grep` | `grep_search` |
| `Read` | `read_file` |
| `Agent` | (use BeforeAgent/AfterAgent events) |

**Claude matchers:** `Write|Edit|MultiEdit`
**Gemini matchers:** `write_file|replace`

### Timeout format

- **Claude:** seconds (integer) — `"timeout": 5`
- **Gemini:** milliseconds (integer) — `"timeout": 5000`
