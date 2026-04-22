---
description: Comprehensive platform health audit — check Claude Code and Gemini CLI releases, audit hooks, verify settings parity, test translation sync, validate agent frontmatter, identify new features to adopt. Run monthly or after platform updates.
---

# Platform Audit

Full infrastructure health check for the Claude Code + Gemini CLI dual-agent system.
This is the skill that catches what /consolidate-memory, /verify-sync, and /wrap-up don't — it audits
the **platform infrastructure itself**, not just the content.

## When to Run
- After updating Claude Code or Gemini CLI to a new version
- Monthly as preventive maintenance
- When hooks seem broken or sync isn't working
- After installing new plugins/extensions
- When you suspect platform drift between Claude and Gemini

## Arguments
- `/platform-audit` — full audit (all phases)
- `/platform-audit releases` — only check releases for new features
- `/platform-audit hooks` — only audit hooks
- `/platform-audit sync` — only check translation/sync parity

---

## Phase 1: Platform Versions & Release Notes

Check current versions and recent changes:

```bash
echo "Claude Code: $(claude --version 2>/dev/null || echo 'not found')"
echo "Gemini CLI: $(gemini --version 2>/dev/null || echo 'not found')"
```

### 1a. Claude Code Release Notes
Check the latest release for new features relevant to our hook system:
```bash
gh api repos/anthropics/claude-code/releases/latest --jq '.tag_name + " — " + .name' 2>/dev/null
```

Read the full release notes and look for:
- **New hook events** (would need registration in settings.json)
- **New hook fields** (like the `if` field in v2.1.85)
- **Settings changes** (new config options we should adopt)
- **Bug fixes** affecting hooks, settings, or sub-agents
- **Breaking changes** that might affect our hooks
- **Performance improvements** we can leverage

### 1b. Gemini CLI Release Notes
```bash
# Check installed version
gemini --version 2>/dev/null
# Check latest release (GitHub)
gh api repos/google-gemini/gemini-cli/releases/latest --jq '.tag_name + " — " + .name' 2>/dev/null
```

Also check the official changelog at https://geminicli.com/docs/changelogs/ (use WebFetch).
Check if the user's NixOS config tracks stable, nightly, or preview:
```bash
# Check Gemini CLI nix module if it exists (discover dynamically)
find ~/Documents -path '*/modules/gemini-cli/default.nix' -maxdepth 5 2>/dev/null | head -1 | xargs cat 2>/dev/null
# Check what nixpkgs provides
nix eval nixpkgs#gemini-cli.version 2>/dev/null
```

If the installed version is behind the latest release, recommend updating. If the nix module
uses `pkgs.gemini-cli` (nixpkgs stable), note that it may lag behind npm releases.

Look for the same categories as Claude Code. Cross-reference with our event name mapping:
- Claude `Stop` = Gemini `SessionEnd`
- Claude `PreToolUse` = Gemini `BeforeTool`
- Claude `PostToolUse` = Gemini `AfterTool`
- Claude `PreCompact` = Gemini `PreCompress`

If new events are added to either platform, flag them for registration.

### 1c. Settings Optimization Check
Compare current settings against known best practices:

```bash
echo "=== Claude settings ==="
jq '{
  cleanup_period_days: (.cleanup_period_days // "NOT SET (default 30)"),
  maxReadFileSizeTokens: (.maxReadFileSizeTokens // "NOT SET (default 25K)"),
  maxBashOutputCharacters: (.maxBashOutputCharacters // "NOT SET (default 30K)"),
  autocompact: .env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE,
  telemetry: .env.DISABLE_TELEMETRY,
  attribution: .attribution
}' ~/.claude/settings.json
```

Known good values (as of 2026-03):
- `cleanup_period_days`: 365 (keep 1 year of sessions)
- `maxReadFileSizeTokens`: 100000 (utilize 1M context)
- `maxBashOutputCharacters`: 150000 (don't truncate build logs)
- `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`: 75-80% (compact before quality degrades)

---

## Phase 2: Hook Health Audit

### 2a. File Existence (both platforms)
```bash
echo "=== Claude hooks ==="
jq -r '.hooks[][] | .hooks[]? | .command' ~/.claude/settings.json | grep -o '[^ "]*\.js' | while read f; do
  [ -f "$HOME/.claude/hooks/$f" ] && echo "  ✓ $f" || echo "  ✗ MISSING: $f"
done
echo "=== Gemini hooks ==="
jq -r '.hooks[][] | .hooks[]? | .command' ~/.gemini/settings.json | grep -o '[^ "]*\.js' | while read f; do
  [ -f "$HOME/.gemini/hooks/$f" ] && echo "  ✓ $f" || echo "  ✗ MISSING: $f"
done
```

### 2b. Output Format Validation
Run each hook with empty input and verify valid JSON output:
```bash
for f in ~/.claude/hooks/*.js; do
  result=$(echo '{}' | timeout 3 node "$f" 2>/dev/null)
  if [ -n "$result" ]; then
    echo "$result" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null || echo "BAD JSON: $(basename $f): $result"
  fi
done
```
GSD hooks outputting nothing on empty input is expected (they need GSD context).

### 2c. Sync Hook Placement (CRITICAL)
Sync hooks MUST be PostToolUse (Claude) / AfterTool (Gemini). NEVER Pre/Before.
```bash
jq -r '.hooks.PreToolUse[]?.hooks[]?.command' ~/.claude/settings.json 2>/dev/null | grep -i sync && echo "BUG: Claude sync under PreToolUse"
jq -r '.hooks.BeforeTool[]?.hooks[]?.command' ~/.gemini/settings.json 2>/dev/null | grep -i sync && echo "BUG: Gemini sync under BeforeTool"
echo "Guard hooks (should be Pre/Before):"
jq -r '.hooks.PreToolUse[]?.hooks[]?.command' ~/.claude/settings.json 2>/dev/null | grep -i 'guard\|safety\|halt'
jq -r '.hooks.BeforeTool[]?.hooks[]?.command' ~/.gemini/settings.json 2>/dev/null | grep -i 'guard\|safety\|halt'
```

### 2d. Agent Frontmatter Validation
Gemini agents only allow: name, description, kind, display_name, tools, mcp_servers, model, temperature, max_turns, timeout_mins.
```bash
for f in ~/.gemini/agents/*.md; do
  invalid=$(sed -n '/^---$/,/^---$/p' "$f" | grep -E '^[a-z_]+:' | awk -F: '{print $1}' | \
    grep -v -E '^(name|description|kind|display_name|tools|mcp_servers|model|temperature|max_turns|timeout_mins)$')
  [ -n "$invalid" ] && echo "INVALID in $(basename $f): $invalid"
done
```

### 2e. Hook File Parity
Check shared hooks are identical between repos:
```bash
for f in ~/.claude/hooks/*.js; do
  name=$(basename "$f"); gemini=~/.gemini/hooks/$name
  [ -f "$gemini" ] && ! diff -q "$f" "$gemini" > /dev/null 2>&1 && echo "DIFFERS: $name"
done
```

Expected differences (NOT bugs):
- `claude-gemini-json-sync.js` — different pattern order per platform
- Claude-only: sync-gemini-md, sync-gemini-skills, reflect-stop, reflect-stop-failure, validate-instructions-sync, plugin-update-checker, enhanced-statusline, sync-hook-versions
- Gemini-only: sync-claude-md, sync-claude-skills, reflect-session-end

Any OTHER shared hook that differs = bug. Fix by copying Claude version to Gemini.

---

## Phase 3: Settings.json Platform Parity

### 3a. Event Name Mapping
Verify both settings.json use correct platform-specific event names:

| Purpose | Claude (correct) | Gemini (correct) | Common mistakes |
|---------|-----------------|-------------------|-----------------|
| Session end | `Stop` | `SessionEnd` | Using `Stop` in Gemini |
| Before tool | `PreToolUse` | `BeforeTool` | Using `PreToolUse` in Gemini |
| After tool | `PostToolUse` | `AfterTool` | Using `PostToolUse` in Gemini |
| Before subagent | `SubagentStart` | `BeforeAgent` | Mixing names |
| After subagent | `SubagentStop` | `AfterAgent` | Mixing names |
| Context compress | `PreCompact` | `PreCompress` | Using `PreCompact` in Gemini |

```bash
echo "Claude events:" && jq -r '.hooks | keys[]' ~/.claude/settings.json
echo "Gemini events:" && jq -r '.hooks | keys[]' ~/.gemini/settings.json
```

Flag any event name that doesn't belong to its platform.

### 3b. Timeout Unit Check
Claude: seconds. Gemini: milliseconds.
```bash
echo "Gemini timeouts that look like seconds (should be ms):"
jq -r '[.hooks[][] | .hooks[]? | .timeout // empty] | map(select(. < 100))' ~/.gemini/settings.json
echo "Claude timeouts that look like milliseconds (should be seconds):"
jq -r '[.hooks[][] | .hooks[]? | .timeout // empty] | map(select(. > 1000))' ~/.claude/settings.json
```

### 3c. Tool Matcher Check
Claude uses: `Write`, `Edit`, `Bash`, `Read`, `Skill`, `Agent`, `MultiEdit`
Gemini uses: `write_file`, `replace`, `run_shell_command`, `read_file`, `activate_skill`

```bash
echo "Gemini matchers using Claude tool names (BUG):"
jq -r '.hooks[][] | .matcher // empty' ~/.gemini/settings.json | grep -E 'Write|Edit|Bash|Read(?!_)|Skill(?!s)' | grep -v 'write_file'
echo "Claude matchers using Gemini tool names (BUG):"
jq -r '.hooks[][] | .matcher // empty' ~/.claude/settings.json | grep -E 'write_file|replace|run_shell|read_file|activate_skill'
```

### 3d. Conditional `if` Field Check (v2.1.85+)
If Claude Code supports the `if` field, verify it's applied to reduce process spawning:
```bash
echo "Hooks with if field:" && jq -r '.hooks[][] | select(.if) | .if' ~/.claude/settings.json 2>/dev/null
echo "Hooks without if field that could benefit:" && jq -r '.hooks.PostToolUse[] | select(.if == null) | .hooks[0].command' ~/.claude/settings.json 2>/dev/null | grep -o '[^/]*\.js"' | tr -d '"'
```

---

## Phase 4: Translation Hook Audit

### 4a. Pattern Count Parity
Forward and reverse translation hooks should have roughly equal pattern counts:
```bash
echo "sync-gemini-md.js (Claude→Gemini): $(grep -c '\.replace(' ~/.claude/hooks/sync-gemini-md.js) patterns"
echo "sync-claude-md.js (Gemini→Claude): $(grep -c '\.replace(' ~/.gemini/hooks/sync-claude-md.js) patterns"
```
A difference >2 means a pattern was added to one direction but not the reverse.

### 4b. Pattern Symmetry Check
For each pattern in the forward hook, verify the reverse exists:
```bash
echo "Forward-only patterns (missing reverse):"
grep -oP '\.replace\(/[^/]+/' ~/.claude/hooks/sync-gemini-md.js | sort > /tmp/forward.txt
grep -oP '\.replace\(/[^/]+/' ~/.gemini/hooks/sync-claude-md.js | sort > /tmp/reverse.txt
wc -l /tmp/forward.txt /tmp/reverse.txt
```

### 4c. Bidirectional JSON Sync
Both `claude-gemini-json-sync.js` files should sync in BOTH directions:
```bash
echo "Claude hook directions:" && grep 'pattern:' ~/.claude/hooks/claude-gemini-json-sync.js
echo "Gemini hook directions:" && grep 'pattern:' ~/.gemini/hooks/claude-gemini-json-sync.js
```
Each should have 4 patterns (2 Claude→Gemini + 2 Gemini→Claude).

### 4d. Skills/Commands Sync
Claude commands should have Gemini skill equivalents and vice versa:
```bash
echo "Claude commands:" && ls ~/.claude/commands/*.md | sed 's|.*/||;s|\.md||' | sort
echo "Gemini root skills:" && ls -d ~/.gemini/skills/*/ 2>/dev/null | sed 's|.*/\(.*\)/|\1|' | grep -v gsd | sort
```

---

## Phase 5: Skill & Plugin Health

### 5a. Skill File Validation
```bash
for d in ~/.claude/skills/*/; do
  name=$(basename "$d")
  [ -f "$d/SKILL.md" ] && echo "  ✓ $name" || echo "  ✗ $name: missing SKILL.md"
done
```

### 5b. Upstream Update Check
```bash
for d in ~/.claude/skills/*/; do
  sources="$d/.upstream-sources.json"
  [ -f "$sources" ] && echo "  $(basename $d): upstream tracked (last checked: $(jq -r '.lastChecked' "$sources"))" || true
done
```

### 5c. Plugin Health
```bash
jq -r '.enabledPlugins[]' ~/.claude/settings.json 2>/dev/null
```

---

## Phase 5.5: Project CLAUDE.md Staleness Detection

When global hooks change, ALL project-level CLAUDE.md files with hook tables become stale.
Scan all known projects for outdated hook references:

```bash
# Find all project CLAUDE.md files
find ~/Documents -name 'CLAUDE.md' -not -path '*/.git/*' -not -path '*/node_modules/*' -maxdepth 4 2>/dev/null
```

For each project CLAUDE.md found, check for stale patterns:
```bash
for f in $(find ~/Documents -name 'CLAUDE.md' -not -path '*/.git/*' -maxdepth 4 2>/dev/null); do
  echo "=== $f ==="
  # Check for stale BeforeTool references (should be AfterTool for sync hooks)
  grep -n 'sync.*BeforeTool' "$f" && echo "  STALE: sync hooks moved to AfterTool"
  # Check for stale 30-min cooldown (now 5-min push + always commit)
  grep -n '30-min cooldown.*auto-push\|auto-push.*30-min' "$f" && echo "  STALE: auto-push now 5-min push cooldown + always commits"
  # Check for missing new hooks/skills
  grep -q 'skill-upstream-checker' "$f" || echo "  MISSING: skill-upstream-checker not documented"
  grep -q 'wrap-up\|platform-audit' "$f" || echo "  MISSING: wrap-up/platform-audit skills not documented"
done
```

**This is the systemic gap:** global hook changes don't propagate to project CLAUDE.md files.
When fixing, update the hook tables in the project CLAUDE.md to match current reality.

## Phase 6: New Features Adoption Check

Based on the latest release notes, check if new features should be adopted:

**Checklist (update per release):**
- [ ] New hook events → register in both settings.json with correct platform names
- [ ] New hook fields (e.g., `if` conditional) → apply to reduce process spawning
- [ ] New settings → add to settings.json if beneficial
- [ ] Deprecated features → remove from settings/hooks
- [ ] New sub-agent capabilities → update agent definitions
- [ ] New tool capabilities → update skills that reference tools

For each new feature found, assess:
1. Does it affect our hook architecture?
2. Does it need registration in BOTH settings.json files?
3. Does it need different syntax per platform?
4. Is it stable enough to adopt? (check if documented)

---

## Phase 7: Report

```
## Platform Audit Report
Date: [YYYY-MM-DD]

### Versions
- Claude Code: [version]
- Gemini CLI: [version]

### New Features Available
- [feature]: [adopt/skip/monitor] — [reason]

### Hook Health
- Files: [N] Claude, [N] Gemini — [all exist / M missing]
- Output: [all valid / M bad JSON]
- Placement: [correct / BUG details]
- Agents: [all valid / M invalid keys]
- Parity: [identical / M differ]

### Settings Parity
- Event names: [correct / BUG details]
- Timeouts: [correct / BUG details]
- Tool matchers: [correct / BUG details]
- Conditional if: [N hooks optimized / N could benefit]

### Translation Sync
- Pattern count: [N forward, N reverse — balanced/imbalanced]
- JSON sync: [bidirectional / one-way BUG]
- Skills/commands: [matched / M missing]

### Settings Optimization
- cleanup_period_days: [value / NOT SET]
- maxReadFileSizeTokens: [value / NOT SET]
- maxBashOutputCharacters: [value / NOT SET]
- autocompact: [value / NOT SET]

### Recommendations
[Prioritized list with severity]
```

---

## Phase 8: Apply Fixes

For each issue found:
1. Propose the fix with exact file path and change
2. Ask for approval before applying
3. Apply to BOTH platforms where applicable
4. Verify after applying

Do NOT auto-fix without approval. Present all findings first, then offer to fix.

---

## Hard Rules

- NEVER change settings.json without understanding the impact on both platforms
- ALWAYS check if a Claude feature exists in Gemini before applying cross-platform
- Hook changes MUST be tested with `echo '{}' | node hook.js` before committing
- New hook registrations MUST go in BOTH settings.json with correct platform names
- When in doubt about a new feature's syntax, test in isolation first
