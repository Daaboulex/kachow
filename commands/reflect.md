---
description: Reflect on session, manage auto-reflect setting. Args: on | off | status | (empty = run reflection)
---

# /reflect

If `$ARGUMENTS` is non-empty, dispatch to the matching mode and stop. Otherwise fall through to the full Session Reflection workflow below.

## Mode: `on` — enable Stop-hook auto-reflect

```bash
touch ~/.claude/.reflect-enabled
```

Confirm: `Auto-reflect enabled. Sessions will automatically capture learnings on exit.`

## Mode: `off` — disable Stop-hook auto-reflect

```bash
rm -f ~/.claude/.reflect-enabled
```

Confirm: `Auto-reflect disabled. Use /reflect manually to capture learnings.`

## Mode: `status` — report current state

```bash
if [ -f ~/.claude/.reflect-enabled ]; then
  echo "Auto-reflect: ON"
  echo "Sessions will automatically capture learnings on exit."
  echo "Disable with: /reflect off"
else
  echo "Auto-reflect: OFF"
  echo "Use /reflect manually to capture learnings."
  echo "Enable with: /reflect on"
fi
```

---

`$ARGUMENTS`

# Session Reflection (no-args mode)

Analyze the current conversation to extract learnings and update context files.

## Phase 1: Detect Project Context

Before scanning signals, identify WHERE you are:

```bash
# Detect project type and memory locations
ls .ai-context/ 2>/dev/null && echo "TYPE: NixOS (.ai-context/)" || echo "TYPE: Standard"
ls .claude/skills/ .claude/rules/ .claude/memory/ 2>/dev/null
ls .gemini/skills/ .gemini/rules/ .gemini/memory/ 2>/dev/null
```

**Project topology (determines where things go):**

| Layer | Claude | Gemini | Scope |
|-------|--------|--------|-------|
| **Global** | `~/.claude/CLAUDE.md`, `~/.claude/commands/`, `~/.claude/hooks/` | `~/.gemini/extensions/` | All projects |
| **Project** | `.claude/skills/`, `.claude/rules/`, `.claude/memory/` | `.gemini/skills/`, `.gemini/rules/`, `.gemini/memory/` | This repo |
| **NixOS variant** | `.ai-context/.claude/` (symlinked) | `.ai-context/.gemini/` (symlinked) | This repo |
| **Claude global memory** | `~/.claude/projects/<path-encoded>/memory/` | — | This project, persists across sessions |

Note the project memory directory path for Claude global memory — it encodes the project path (e.g., `~/.claude/projects/-home-user-Documents-[project]/memory/`).

## Phase 2: Scan for Signals

Review the entire conversation and extract:

**HIGH confidence (explicit corrections):**
- User said "no", "don't", "stop doing X", "never", "wrong", "not that"
- User corrected a specific behavior or output
- User rejected a tool call or approach

**MEDIUM confidence (validated patterns):**
- User said "yes exactly", "perfect", "keep doing that", accepted without pushback
- An unusual approach worked and user confirmed it
- A non-obvious decision was made and validated

**LOW confidence (observations):**
- Patterns that seemed to work well but weren't explicitly confirmed
- Preferences inferred from context (not stated directly)
- Things to watch for in future sessions

## Phase 3: Check for Staleness

Before proposing new additions, check if existing context needs UPDATING:

1. Read MEMORY.md index — scan each memory description
2. For each signal detected: does it **contradict** an existing memory?
3. For each existing memory referenced during the session: is it still accurate?
4. Check skills used during the session — did any contain stale information?

**Staleness indicators:**
- A memory describes behavior the model no longer exhibits (model capability evolved)
- A memory references files/paths that no longer exist
- A memory's workaround is no longer needed because the root issue was fixed
- A skill's steps produce errors when followed

Flag stale items for UPDATE or REMOVE alongside new additions.

## Phase 4: Classify Each Learning

For each HIGH and MEDIUM signal, determine what it should become:

### Q1: Already covered?
Check CLAUDE.md hard rules AND `.claude/rules/*.md` AND existing memories.
If already enforced → skip (don't duplicate). If partially covered → propose UPDATE to existing file.

### Q2: Should this be a HOOK?
A hook is appropriate when the learning is a **deterministic, repeatable action** triggered by a specific event (file edited, session start/end, tool invoked). Hooks run OUTSIDE the context window — zero token cost, zero LLM decision-making required.

**Hook test:** If you can describe the pattern as "WHEN [event] AND [condition], THEN [action]" with no judgment needed → it's a hook.

→ **HOOK** (`~/.claude/hooks/<name>.js` + register in `settings.json`)
Examples:
- "After editing .claude/AI-tasks.json, also copy to .gemini/" → PostToolUse hook
- "When editing Actuator/ files, warn about safety" → PreToolUse hook
- "At session start, show active tasks and git status" → SessionStart hook
- "At session end, clean up stale completed tasks" → SessionStart hook

**Event mapping (Claude → Gemini):**
| Claude | Gemini |
|---|---|
| SessionStart | SessionStart |
| PreToolUse | BeforeTool |
| PostToolUse | AfterTool |
| Stop | SessionEnd |
| PreCompact | PreCompress |

When proposing a hook, specify: event name, matcher (if tool-specific), what it does, and the Gemini equivalent event name. New hooks MUST be registered in BOTH `~/.claude/settings.json` AND `~/.gemini/settings.json`.

### Q3: Should this be a SKILL?
A skill is appropriate when the learning is a **repeatable multi-step procedure** that would save significant time if codified. Skills are the heaviest artifact — only create one when the procedure has 3+ steps, involves specific files/tools, and will be reused.

→ **SKILL** (`.claude/skills/<name>/SKILL.md`) — loaded when description matches user intent
Examples: "When adding a new protocol message, follow these 8 steps across 2 platforms"

### Q4: Should this be a RULE? (was Q3)
A rule is appropriate when the learning is a **code pattern that must ALWAYS be followed** when touching files matching a specific path glob. Rules are auto-loaded by path scope.

→ **RULE** (`.claude/rules/<scope>.md`) — path-scoped, always loaded for matching files
Examples: "ESP32 WiFi files must use FreeRTOS dual-core pattern", "Dotnet V2 uses Avalonia not WinForms"

When creating rules, check existing rules first:
```bash
ls .claude/rules/ 2>/dev/null
```
Can the learning be added to an existing rule instead of creating a new file?

### Q4: Should this be a MEMORY?
Memories store knowledge that guides behavior but isn't tied to specific file paths.

**type=feedback** — User preference about HOW to work
Examples: "don't let agents use git", "verify before claiming done", "use sync script not git push"

**type=project** — Current state, decisions, or context about ongoing work
Examples: "flash usage at 91%", "V2 migration in progress", "NASA R10 compliance status"

**type=user** — User's role, expertise, or knowledge level
Examples: "senior embedded engineer", "new to React", "deep Go expertise"

**type=reference** — Where to find information in external systems
Examples: "bugs tracked in Linear project INGEST", "pipeline docs at wiki.internal/pipeline"

### Q5: What SCOPE does this apply to?

| Scope | Where to save | When to use |
|-------|---------------|-------------|
| **All projects, all time** | `~/.claude/CLAUDE.md` (global instructions) | Universal workflow rules, tool philosophy |
| **All projects, contextual** | `~/.claude/projects/<path>/memory/` (global memory) | Project-specific learnings for Claude |
| **This project, both AIs** | `.claude/rules/` or `.claude/skills/` + sync to `.gemini/` | Code patterns, domain skills |
| **This project, memory** | `.claude/memory/` + copy to `.gemini/memory/` | Context that guides behavior |
| **NixOS project** | `.ai-context/.claude/` (symlinked) | Same as above, NixOS layout |
| **Sub-repo** | Parent project's memory, NOT the sub-repo | Sub-repos don't own their own context |

## Phase 4.5: Skill & Hook Quality Check (if relevant)

If this session USED any skill or triggered any hook that behaved incorrectly, assess:

1. **Skill accuracy** — Did any invoked skill have wrong instructions, reference deleted files, or produce broken output?
   - If yes → propose a skill UPDATE with the fix
2. **Hook behavior** — Did any hook fail silently, fire at the wrong time, or produce incorrect sync?
   - If yes → propose a hook FIX or settings.json correction
3. **Cross-platform sync** — Did CLAUDE.md/GEMINI.md, commands/skills, or memory sync work correctly?
   - If not → flag the specific sync failure for investigation

Only check skills/hooks that were ACTUALLY USED or OBSERVED during this session. Don't audit everything — that's `/consolidate-memory deep`'s job.

## Phase 4.7: Update Skill Lineage (if corrections found)

If Phase 2 detected HIGH-confidence corrections related to a skill's behavior, log them in the skill lineage tracker:

```bash
cat ~/.claude/skill-lineage.json 2>/dev/null | head -5  # Check if lineage exists
```

If the file exists and a correction maps to a tracked skill:
1. Read the skill's current entry in skill-lineage.json
2. Increment `metrics.corrections`
3. Add a history entry with `"origin": "FIX"` and a note describing the correction
4. Write the updated JSON back

**Example FIX entry:**
```json
{"version": "1.0.1", "date": "2026-03-30", "origin": "FIX", "note": "User corrected: use initContent not initExtra for Zsh"}
```

If 3+ corrections accumulate for a skill, flag it for rewrite in Phase 5 proposals.

Also update `metrics.invocations` for any skill that was used during the session, and `metrics.successes` for skills that completed without corrections.

If `~/.claude/skill-lineage.json` doesn't exist, skip this phase silently.

## Phase 5: Propose Changes

Present ALL proposals in a structured review:

```
## Signals Detected

### HIGH — Explicit Corrections
1. [Signal] → [Proposed action] → [Target file + path]

### MEDIUM — Validated Patterns
1. [Signal] → [Proposed action] → [Target file + path]

### LOW — Observations
1. [Signal] (no action — noted for future)

## Staleness Detected
1. [Memory/skill/rule] — [What's stale] → [UPDATE/REMOVE]

## Proposed Changes

### NEW: [filename] → [location]
[Full content to write]

### UPDATE: [existing filename]
[Old content → New content]

### REMOVE: [filename]
[Why it's stale]
```

For each proposal, show the EXACT target path (not just "project memory" — show the full path).

## Phase 5.5: Persist Proposals (CRITICAL — prevents context loss)

**Before asking for approval**, save all proposals to a temp file so they survive the turn boundary:

```bash
# Write the full proposals block to a temp file
# This ensures Phase 7 has a definitive reference to read back
```

Use the Write tool to save the structured proposals to `.claude/.reflect-proposals.md`. Include:
- Every file path, action (NEW/UPDATE/REMOVE), and full content
- The signals that motivated each change

This file is your single source of truth for Phase 7. Do NOT rely on conversation history alone.

## Phase 6: Ask for Approval

> **Shall I apply these changes?** (yes / modify / skip)

Do NOT proceed silently. Do NOT assume approval. Wait for the user to respond.

## Phase 7: Apply + Sync

**FIRST**: Read back `.claude/.reflect-proposals.md` to restore full context of what was approved.

When user approves:

1. **Write/update each file** using Write or Edit tools
2. **Sync Claude → Gemini** for each change:
   - Memory: copy to `.gemini/memory/` if it exists
   - Rule: copy to `.gemini/rules/`
   - Skill: copy directory to `.gemini/skills/<name>/`
   - CLAUDE.md edits: `sync-gemini-md.js` hook handles this automatically
3. **Update MEMORY.md** index in the same directory (for memory changes)
4. **Do NOT commit** — let the user decide when to commit

### Skill sync details
When creating or updating a skill, it must exist in BOTH `.claude/skills/` and `.gemini/skills/`.
The `sync-gemini-skills.js` PostToolUse hook auto-syncs on Write/Edit, but for new skill
directories with multiple files, copy the full directory manually:
```bash
cp -r .claude/skills/<name> .gemini/skills/<name>
```

If the project also exists in other locations (e.g., `~/Documents/nix/`), note that the
skill should be synced there too — but DON'T auto-copy to other projects without asking.

## Phase 7.5: Cleanup

Delete the temp proposals file:
```bash
rm -f .claude/.reflect-proposals.md
```

## Phase 8: Verify

After applying, verify:
- MEMORY.md matches disk (no orphan entries, no missing entries)
- New rules have correct `paths:` frontmatter that matches actual file globs
- New skills have correct `name:` and `description:` frontmatter
- Claude/Gemini parity: same files exist in both `.claude/` and `.gemini/` dirs
- Report: "Context sync: OK" or "Context sync: DRIFT — [details]"

## What NOT to Save

- Rules already in CLAUDE.md or `.claude/rules/` — check Q1 FIRST
- Code patterns derivable from reading the codebase
- Git history (use `git log`)
- Debugging solutions (the fix is in the code)
- Ephemeral task state (use AI-tasks.json or GSD .planning/)
- Session-specific progress (use AI-progress.json)

## Memory Frontmatter

Every memory file MUST have:
```markdown
---
name: short-name
description: one-line (used for relevance matching — be specific)
type: user | feedback | project | reference
---

[Content — for feedback/project: lead with rule, then **Why:** and **How to apply:**]
```

## Global Context Changes

If the session modified `~/.claude/hooks/`, `~/.claude/commands/`, or global skills:
- `auto-push-global.js` hook auto-commits+pushes `~/.claude/` and `~/.gemini/` on session end
- Shared hooks are auto-synced Claude→Gemini by the same hook
- Both dirs are git repos (claude-global, gemini-global)

## Hard Rules

- MUST ask "Shall I apply?" before writing — never apply silently
- Before creating ANY artifact, check Q1 (is it already covered?)
- HIGH signals should almost always be persisted
- MEDIUM signals need user confirmation
- LOW signals are noted but not acted on unless requested
- If no signals found, report "No learnings detected in this session"
- If a memory contradicts current code, UPDATE the memory (don't create a duplicate)
- Always show full target paths, not abbreviated descriptions
- Skills and rules go in BOTH .claude/ and .gemini/ — never one without the other

## Red Flags

If you catch yourself thinking any of these, STOP — you're rationalizing:

| Thought | Reality |
|---------|---------|
| "I already reflected mentally" | Mental reflection doesn't persist. Write it down or it's lost. |
| "Nothing important happened this session" | Every session has learnings. Look harder. |
| "I'll remember this without writing it" | You won't. Next session starts fresh. |
| "The memory files are good enough" | When did you last READ them? Stale = useless. |
| "This session was too short to reflect" | Short sessions often have the sharpest insights. |
