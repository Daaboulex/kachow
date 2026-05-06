---
description: Full AI context maintenance — consolidate memories (Tier 1), synthesize semantic summaries (Tier 3), verify skills/rules/CLAUDE.md against codebase, check hooks. Run with /consolidate-memory, /consolidate-memory deep, /consolidate-memory user, or /consolidate-memory all.
---

# Consolidate Memory — AI Context Maintenance

Consolidate, verify, and self-improve the entire AI context system. Like sleep — process experiences, fix errors, prune waste.

## Scope (2026-04-21 narrowing)

Claude Code ships **Auto-Dream** which already handles: merging duplicates, resolving contradictions, pruning stale, converting relative→absolute dates, tightening index. Auto-Dream runs on Anthropic's own schedule. See `research/audit-2026-04-21/AUTODREAM_OVERLAP.md` for the full overlap matrix.

**This skill now focuses on the unique extensions Auto-Dream doesn't cover:**
- **Phase 3.5 Tier-3 semantic consolidation** — builds `<memory>/semantic/SUMMARY.md` from episodic JSONL across machines
- **Phase 3.6 v2-frontmatter schema validation** — ensures `created/last_verified/last_accessed/ttl_days/evidence/status` present
- **Phase 4+ skill/rule/CLAUDE.md cross-check** — verifies memories still align with current codebase+rules
- **Phase 5 hook/skill health pass** — runs `lib/hook-selftest.js` + flags failures

**Phases 3a-3e (merge/dedupe/prune/date-fix/index-tighten) are now "run only if Auto-Dream hasn't fired in >7d"** — indicated by `stat ~/.ai-context/memory/MEMORY.md | grep Modify` returning >7d old.

Rotation of TTL-expired memories is separately handled by `memory-rotate.js` Stop hook (mechanical, no LLM needed). Do not re-run rotation here.

## Arguments
- `/consolidate-memory` — standard consolidation (memories only, fast)
- `/consolidate-memory deep` — full verification (memories + skills + rules + CLAUDE.md + hooks)
- `/consolidate-memory user` — consolidate user-level memory
- `/consolidate-memory all` — deep verification on everything

## Phase 1: Orient

1. Read `MEMORY.md` index and count files
2. Skim all memory file descriptions
3. Note the project type: NixOS (.ai-context/) or Private (.claude/)

## Phase 2: Gather Recent Signal

1. Check if memories contradict the CURRENT codebase (grep the code, don't trust the memory)
2. If needed, grep session transcripts narrowly:
   ```bash
   grep -rn "<narrow term>" ~/.claude/projects/*/  --include="*.jsonl" | tail -50
   ```
3. Compare what memory claims vs what the code shows

## Phase 3: Consolidate Memories

Apply in order:

**3a. Merge duplicates** — same topic in two files → combine into one
**3b. Resolve contradictions** — memory vs memory, memory vs CLAUDE.md, memory vs codebase. Most recent truth wins.
**3c. Prune stale** — completed work, old sprints, resolved bugs, session artifacts. Test: does this help FUTURE sessions?
**3d. Fix dates** — "next Friday" → "2026-03-28". Absolute dates survive time.
**3e. Check against CLAUDE.md/rules** — if a memory duplicates enforced rules, delete it
**3f. Fix frontmatter** — every file needs: name, description, type (user/feedback/project/reference)
**3g. Tighten index** — MEMORY.md under 200 lines, no orphans, no dead refs

## Phase 3.5: Tier 3 Semantic Consolidation

Synthesize high-level semantic summaries from Tier 1 profile memories + Tier 2 episodic JSONL data.
This phase runs as part of every standard `/consolidate-memory` invocation (not just deep mode).
It is additive — it does not replace any existing Phase 3 steps.

**Step 1: Acquire Leader Election Lock**

Run `~/.claude/hooks/lib/leader-election.js` `acquireLock()` on the `<memory_dir>/semantic` path:

```bash
node -e "
const le = require('$HOME/.claude/hooks/lib/leader-election.js');
const t3 = require('$HOME/.claude/hooks/lib/tier3-consolidation.js');
const memoryDir = '<memory_dir>';  // Replace with actual memory dir
const semanticDir = t3.getSemanticDir(memoryDir);
const result = le.acquireLock(semanticDir);
console.log(JSON.stringify(result));
"
```

- If `acquired: false`: log "Tier 3 lock held by {holder} ({ageMinutes} min), skipping Tier 3 consolidation" and skip to Phase 4.
- If `acquired: true`: proceed to Step 2.

**Step 2: Check Dual-Gate and Read Episodic Data**

Run `checkDualGate()` and `readEvents()` to gather the data needed for synthesis:

```bash
node -e "
const t3 = require('$HOME/.claude/hooks/lib/tier3-consolidation.js');
const { readEvents, HOSTNAME } = require('$HOME/.claude/hooks/lib/observability-logger.js');
const os = require('os');
const memoryDir = '<memory_dir>';  // Replace with actual memory dir
const cwd = process.cwd();

// Check dual-gate
const gate = t3.checkDualGate(memoryDir, cwd);
console.log('Dual-gate:', JSON.stringify(gate));

if (!gate.bothOpen) {
  const reason = !gate.gate1Open
    ? 'Gate 1 closed (< 24h since last consolidation)'
    : 'Gate 2 closed (< 5 sessions since last consolidation)';
  console.log('Tier 3 deferred:', reason);
  process.exit(0);
}

// Read episodic events since last consolidation
const events = readEvents(cwd, 90, {
  fromDate: gate.lastConsolidated || undefined,
  host: os.hostname(),
});

// Summarize event counts by type
const counts = {};
for (const e of events) { counts[e.type] = (counts[e.type] || 0) + 1; }
console.log('Event counts:', JSON.stringify(counts));
console.log('Session count:', gate.sessionCount);
console.log('Last consolidated:', gate.lastConsolidated || 'never');
"
```

If the dual-gate is not open (output shows "Tier 3 deferred"), skip to Phase 4.

**Step 3: Write Semantic Files**

For each of the 4 semantic files, synthesize content from Tier 1 memories (read in Phase 1-2) and Tier 2 episodic event counts from Step 2. Use `archiveAndWrite()` to preserve prior content in `history/` before overwriting (Law 1 compliance).

Write each file using this pattern:
```bash
node -e "
const t3 = require('$HOME/.claude/hooks/lib/tier3-consolidation.js');
const path = require('path');
const memoryDir = '<memory_dir>';
const semanticDir = t3.getSemanticDir(memoryDir);
const sessionCount = <N>;  // from Step 2

// Write session-patterns.md
const spFrontmatter = t3.makeFrontmatter(
  'Session Patterns',
  'Recurring patterns observed across sessions on this project',
  'project',
  sessionCount
);
const spContent = spFrontmatter + \`
## Common Session Flows

<synthesize from session_start/session_end event patterns>

## Tool Usage Patterns

<synthesize which tools appear most frequently in hook_fire events>

## Session Duration Distribution

<synthesize from session_end duration_s payload values: short (<15min), medium (15-60min), long (>60min)>
\`;
t3.archiveAndWrite(path.join(semanticDir, 'session-patterns.md'), spContent);
console.log('wrote session-patterns.md');
"
```

**Files to synthesize:**

- **`session-patterns.md`**
  - Frontmatter: `name="Session Patterns"`, `type="project"`
  - Content: Analyze `session_start`/`session_end` events for common flows, duration distribution, time-of-day patterns, tool usage from `hook_fire` events
  - Sections: "Common Session Flows", "Tool Usage Patterns", "Session Duration Distribution"

- **`skill-health.md`**
  - Frontmatter: `name="Skill Health Report"`, `type="project"`
  - Content: Analyze `skill_invoke` and `error` events for success rates, degraded skills (error rate >10% or zero invocations in 14 days), unused skills
  - Sections: "Healthy Skills (>=3 successful invocations, no recent errors)", "Degraded Skills (errors or declining usage)", "Unused Skills"

- **`recurring-issues.md`**
  - Frontmatter: `name="Recurring Issues"`, `type="feedback"`
  - Content: Analyze `error` and `memory_mutation` events for problems appearing in >=3 separate sessions
  - Sections: "Active Issues", "Resolved Issues (appeared, addressed, not recurred in 14+ days)"

- **`behavioral-drift.md`**
  - Frontmatter: `name="Behavioral Drift Log"`, `type="feedback"`
  - Content: Analyze all events for tool usage pattern changes, version-correlated regressions from `session_start` payload `claude_version` field
  - Sections: "Detected Drifts", "Regressions After Version Updates"

All frontmatter fields (name, description, type, tier, last_consolidated, source_sessions) are generated by `makeFrontmatter()`.
All files are written via `archiveAndWrite()` — the prior content is copied to `history/` before the new content is written.

**Step 4: Update SUMMARY.md**

Generate and write the semantic index:

```bash
node -e "
const t3 = require('$HOME/.claude/hooks/lib/tier3-consolidation.js');
const path = require('path');
const fs = require('fs');
const memoryDir = '<memory_dir>';
const semanticDir = t3.getSemanticDir(memoryDir);
const sessionCount = <N>;

// Count source files
const episodicDir = path.join(memoryDir, 'episodic');
const episodicCount = fs.existsSync(episodicDir)
  ? fs.readdirSync(episodicDir).filter(f => f.endsWith('.jsonl')).length
  : 0;
const profileCount = fs.readdirSync(memoryDir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md').length;

const summary = t3.buildSummary(semanticDir, sessionCount, episodicCount, profileCount);
t3.archiveAndWrite(path.join(semanticDir, 'SUMMARY.md'), summary);
console.log('wrote SUMMARY.md');
"
```

**Step 5: Release Lock**

Release the leader election lock after successful completion:

```bash
node -e "
const le = require('$HOME/.claude/hooks/lib/leader-election.js');
const t3 = require('$HOME/.claude/hooks/lib/tier3-consolidation.js');
const memoryDir = '<memory_dir>';
const semanticDir = t3.getSemanticDir(memoryDir);
le.releaseLock(semanticDir);
console.log('Lock released');
"
```

On error: leave the lock in place. The 30-minute stale timeout allows any host to take over. Do NOT attempt to release on error paths — missing a release is safer than releasing prematurely.

**Step 6: Log Consolidation Event**

Write a `tier3_consolidation` event to Tier 2 JSONL via `logEvent()`:

```bash
node -e "
const { logEvent, HOSTNAME } = require('$HOME/.claude/hooks/lib/observability-logger.js');
const cwd = process.cwd();
logEvent(cwd, {
  type: 'tier3_consolidation',
  source: 'consolidate-memory',
  payload: {
    files_written: ['session-patterns.md', 'skill-health.md', 'recurring-issues.md', 'behavioral-drift.md', 'SUMMARY.md'],
    session_count: <N>,
    host: HOSTNAME,
  }
});
console.log('logged tier3_consolidation event');
"
```

---

## Phase 4: Verify Context (only on `/consolidate-memory deep` or `/consolidate-memory all`)

This is what makes `/consolidate-memory` self-improving. Check each layer against REALITY:

### 4a. Skills/Commands — Do they match the codebase?
For each skill file, ask: does the code it references still exist?
```bash
# Example: if a skill references "build-system.ps1 line ~2267", check it
grep -n "New-SimpleMakefile" build-system.ps1 | head -1
```
- If a skill references a function/file that was renamed/deleted → flag it
- If a skill's step-by-step instructions produce errors when followed → flag it
- Output: list of skills that need updating

**Skill usage data** — check `~/.claude/skill-usage.json` if it exists:
```bash
cat ~/.claude/skill-usage.json 2>/dev/null | jq '.sessions | length' # total tracked sessions
```
- Sessions with empty `skills_used` arrays are normal (hook logs sessions, /reflect populates skills)
- Cross-reference with installed skills to identify skills never used across many sessions
- Don't remove unused skills rashly — they may apply to domains not recently worked on (mobile, dotnet)
- Apply staleness test: "Would removing this still produce acceptable results with the current model?"
- Flag truly dead skills (referenced code deleted, domain abandoned) vs dormant skills (valid but not recently needed)

### 4a-ii. Hook-or-Instruct Audit — Can any instruction become a hook?

Scan CLAUDE.md, memories (especially type=feedback), and rules for patterns that:
- Say "always do X after Y" or "never do X without Y"
- Describe deterministic, event-triggered behavior with no judgment needed
- Cost context tokens every time they're followed

**The test:** Can you express it as "WHEN [event] AND [condition] THEN [action]"?
If yes → it should be a hook, not an LLM instruction.

Check existing hooks first:
```bash
jq -r '.hooks | to_entries[] | "\(.key): \(.value | length) hook groups"' ~/.claude/settings.json
```

For each hookable pattern found, propose:
- Hook event (Claude name + Gemini equivalent)
- Matcher (tool name pattern)
- What it does (1-line description)
- Which instruction/memory it replaces

**Don't propose hooks that require judgment** — if the action depends on context
the model needs to reason about, keep it as an instruction.

Report: "Hook opportunities: [N] found" or "No new hookable patterns — instructions are appropriately judgment-based."

### 4a-iii. Capability Adaptation Check — Can any constraint be removed?

Per AgentScope's principle: "design for capability growth, not current limitations."

For each skill, rule, and significant CLAUDE.md instruction, ask:
- "Would the current model handle this correctly WITHOUT this instruction?"
- "Was this added to work around a limitation that may no longer exist?"
- "Has a model upgrade (e.g., Sonnet 4.5 → Opus 4.6) made this unnecessary?"

Common candidates for removal:
- Instructions that say "be thorough" or "don't be lazy" (newer models are less lazy)
- Complex multi-step workarounds for things the model now does natively
- Aggressive skill triggering language ("YOU MUST use this") that causes overtriggering
- Explicit "think step by step" instructions (models with adaptive thinking do this naturally)

**Test by removal:** Temporarily disable one component and check if output quality degrades.
If no degradation → the constraint was compensating for a limitation that no longer exists.

Report: "Capability check: [N] candidates for simplification" or "All constraints still load-bearing."

### 4a-iv. Memory Health Check

Don't just count files — verify content health:

```bash
# Count per project
for dir in ~/.claude/projects/*/memory/; do
  project=$(basename "$(dirname "$dir")")
  count=$(ls "$dir"/*.md 2>/dev/null | wc -l)
  echo "$project: $count files"
done
```

**Duplicate path detection:** Check if multiple project paths resolve to the same project:
```bash
# Find paths that might be duplicates (same project, different sanitization)
for dir in ~/.claude/projects/*/memory/; do
  [ -L "$dir" ] && echo "SYMLINK: $(basename $(dirname $dir)) → $(readlink $dir)"
done
```

If two paths have overlapping file names, **diff the actual content** before calling it bloat.
A large monorepo with 40+ memory files may be perfectly healthy — count alone is not a signal.

**Real bloat indicators** (not just file count):
- Multiple paths for the same project with identical content → stale copies
- Memory files that reference deleted code/files → stale content
- Memory files with no frontmatter → malformed
- MEMORY.md entries with no matching file on disk → orphaned index entries

If MEMORY.md exceeds 200 lines, recommend `/compress-memory`.

### 4b. Rules — Do they match current code patterns?
For each rule file, spot-check one claim against the code:
```bash
# Example: if a rule says "Module pattern uses lib.mkEnableOption"
grep -r "mkEnableOption" parts/ | head -3
```
- If the rule describes a pattern that no longer exists → flag it
- If the rule's path glob doesn't match any files → the rule is dead
- Output: list of stale rules

### 4c. CLAUDE.md — Does it match reality?
Check key claims:
- Does the module list match actual directories?
- Do the option paths match actual code?
- Are the commands listed still available?
- Has the architecture changed since CLAUDE.md was last updated?
```bash
# Example: check if listed HM modules still exist
ls home/modules/ | wc -l  # compare with count in CLAUDE.md
```
- Output: CLAUDE.md sections that need updating

### 4d. Hooks — Comprehensive Health Check

Go beyond "file exists." Test actual functionality:

**4d-i. File existence** (all tools share hooks via `~/.ai-context/hooks/`):
```bash
# Claude hooks
jq -r '.hooks[][] | .hooks[]? | .command' ~/.claude/settings.json | grep -o '[^ ]*\.js' | while read f; do
  [ -f "$HOME/.claude/hooks/$f" ] || echo "MISSING (Claude): $f"
done
# Gemini hooks
jq -r '.hooks[][] | .hooks[]? | .command' ~/.gemini/settings.json | grep -o '[^ ]*\.js' | while read f; do
  [ -f "$HOME/.gemini/hooks/$f" ] || echo "MISSING (Gemini): $f"
done
# Codex/Crush hooks use the same ~/.ai-context/hooks/ symlinks — verify their settings.json references if modified
```

**4d-ii. Output format validation** — run each hook with empty input, verify valid JSON:
```bash
for f in ~/.claude/hooks/*.js; do
  result=$(echo '{}' | timeout 3 node "$f" 2>/dev/null)
  echo "$result" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null || echo "BAD OUTPUT: $(basename $f)"
done
```
GSD hooks may output nothing on empty input — that's expected. Flag hooks that output non-JSON.

**4d-iii. Sync hook placement** — sync hooks MUST be PostToolUse/AfterTool, not Pre/Before:
```bash
# Claude: sync hooks should be under PostToolUse
jq -r '.hooks.PreToolUse[]?.hooks[]?.command' ~/.claude/settings.json 2>/dev/null | grep -i sync && echo "WARNING: sync hook under PreToolUse (should be PostToolUse)"
# Gemini: sync hooks should be under AfterTool
jq -r '.hooks.BeforeTool[]?.hooks[]?.command' ~/.gemini/settings.json 2>/dev/null | grep -i sync && echo "WARNING: sync hook under BeforeTool (should be AfterTool)"
# Codex: sync hooks should be under PostToolUse; Crush: PreToolUse only (no PostToolUse)
```

**4d-iv. Agent frontmatter validation** — check for platform-invalid keys:
```bash
# Gemini agents: only name, description, kind, display_name, tools, mcp_servers, model, temperature, max_turns, timeout_mins are valid
for f in ~/.gemini/agents/*.md; do
  invalid=$(sed -n '/^---$/,/^---$/p' "$f" | grep -E '^[a-z_]+:' | awk -F: '{print $1}' | grep -v -E '^(name|description|kind|display_name|tools|mcp_servers|model|temperature|max_turns|timeout_mins)$')
  [ -n "$invalid" ] && echo "INVALID KEY in $(basename $f): $invalid"
done
```

### 4e. Platform Parity — Cross-check settings.json

Verify all tools' settings.json files have equivalent hooks with correct platform mappings (Claude + Gemini are the primary pair; Codex and Crush share the same hook files via symlinks from `~/.ai-context/`):

**Event name mapping** (Claude → Gemini):
- `SessionStart` → `SessionStart` (same)
- `Stop` → `SessionEnd`
- `PreToolUse` → `BeforeTool`
- `PostToolUse` → `AfterTool`
- `SubagentStart` → `BeforeAgent`
- `SubagentStop` → `AfterAgent`
- `PreCompact` → `PreCompress`

**Tool name mapping** (Claude → Gemini):
- `Write|Edit` → `write_file|replace`
- `Bash` → `run_shell_command`
- `Read` → `read_file`
- `Skill` → `activate_skill`

**Timeout mapping**: Claude uses seconds, Gemini uses milliseconds.

For each hook registered in Claude, check that an equivalent exists in Gemini (and vice versa). Report mismatches.
Exceptions: `InstructionsLoaded`, `StopFailure`, `TaskCompleted` are Claude-only events with no Gemini equivalent.

**Translation pattern parity** — count forward vs reverse patterns:
```bash
echo "sync-gemini-md.js patterns: $(grep -c '\.replace(' ~/.ai-context/hooks/sync-gemini-md.js)"
echo "sync-claude-md.js patterns: $(grep -c '\.replace(' ~/.ai-context/hooks/sync-claude-md.js)"
```
These should be roughly equal. A large imbalance means a pattern was added to one direction but not the reverse.

### 4e. Skill Lineage — Evolution Health Check

If `~/.claude/skill-lineage.json` exists, analyze it:
```bash
cat ~/.claude/skill-lineage.json 2>/dev/null | python3 -c "
import json, sys
d = json.load(sys.stdin)
for name, s in d.get('skills', {}).items():
    m = s.get('metrics', {})
    fixes = m.get('corrections', 0)
    uses = m.get('invocations', 0)
    rate = f'{m.get(\"successes\",0)}/{uses}' if uses else 'unused'
    stale = '  ← STALE (unused)' if uses == 0 and s.get('created','') < '2026-03' else ''
    needs_fix = '  ← NEEDS REWRITE (3+ corrections)' if fixes >= 3 else ''
    print(f'  {name}: v{s[\"current_version\"]} ({s[\"origin\"]}) success={rate} fixes={fixes}{stale}{needs_fix}')
" 2>/dev/null || echo "  (no lineage file or parse error)"
```

**Check for:**
- Skills with 0 invocations that are >30 days old → flag as potentially stale
- Skills with 3+ corrections → flag for rewrite (DERIVE a new version)
- Skills with high success rate → candidates for AUTO-LEARN (lock as reference template)

## Phase 5: Report

```
## Consolidation Report

### Memories
Files: [before] → [after]
Merged: [list] | Pruned: [list] | Updated: [list]

### Context Verification (deep only)
Skills: [N] checked, [M] issues found
  - [skill]: [issue]
Rules: [N] checked, [M] issues found
  - [rule]: [issue]
CLAUDE.md: [OK | N sections stale]
Hooks: [OK | N missing/broken]

### Skill Lineage (if tracked)
Tracked: [N] skills | Stale: [M] | Needs rewrite: [K]
  - [skill]: [status + metrics]

### Recommendations
[Prioritized list of what to fix]
```

## Phase 6: Cleanup State

After successful consolidation, reset the trigger state so the dual-gate timer restarts:

```bash
# Reset session counter (Claude state dir)
echo "0" > ~/.claude/.dream-session-count
# Reset cooldown timer
touch ~/.claude/.dream-last
# Release lock
rm -f ~/.claude/.dream-lock
```

This is critical — dream-auto.js does NOT reset these on trigger (prevents lost consolidations if agent ignores the systemMessage). The /consolidate-memory command is responsible for cleanup after success.

## Important Rules
- NEVER delete a memory file — update, merge, or archive (move to memory/archive/) instead
- When merging, keep the richer version and archive the other
- When in doubt about staleness, keep it (false pruning > false deletion)
- Skills/rules flagged as stale should be REPORTED, not auto-fixed (they need human review)
- Always verify MEMORY.md matches disk after changes
- Always run Phase 6 cleanup at the end, even if no changes were made
