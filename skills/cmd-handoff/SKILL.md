---
name: cmd-handoff
description: "Fast context-pressure session save — captures state, learnings, and handoff instructions in 1-2 turns. Use when context is filling up (70%+), pausing mid-task, or PreCompact fires. Includes quick-reflect so no learnings are lost."
---

# Session Handoff

Fast, structured session save. Completes in **1-2 turns**. Captures state AND learnings.

**IMPORTANT: /handoff is a CHECKPOINT, not a stop signal.** After saving state, CONTINUE
WORKING unless the user explicitly says to stop or context is critically low (80%+).
At 57% context you have plenty of room — save state and keep going.

## When to use
- Context at 70%+ AND you cannot finish the current task in the remaining space
- User explicitly says "let's pause here" or "continue next session"
- PreCompact hook fires (compaction imminent — save and stop)
- Mid-task break where significant state would be lost

## When NOT to use
- Context below 65% — you have plenty of room, keep working
- As an excuse to stop early — the user wants the task DONE, not a handoff
- When the user asks you to "save context" — save it, then CONTINUE the task

## Step 1: Quick Reflect (CRITICAL — don't skip)

Before dumping state, do a FAST signal scan (30 seconds, not 10 minutes):

**Scan the conversation for:**
- Did the user correct you? ("no", "don't", "wrong", "not that") → Note it
- Did the user validate a non-obvious approach? ("yes exactly", "perfect") → Note it
- Did a skill or hook malfunction? → Note it
- Any key decisions or discoveries? → Note it

**Format as a compact block** (included in the handoff file, not separate memories):
```
## Session Learnings (quick-reflect)
- CORRECTION: [what was corrected and the right approach]
- VALIDATED: [what worked and was confirmed]
- DISCOVERY: [anything surprising learned about the codebase/system]
- SKILL-ISSUE: [any skill/hook that behaved wrong]
```

If nothing notable: write `## Session Learnings — None detected`

These get picked up by the next session. If any are HIGH-confidence corrections, the next
session's /reflect (or /wrap-up) should persist them as proper memory files.

## Step 2: Capture State (MUST be self-contained)

The handoff file is the ONLY thing the next session reads. It must be a complete briefing.

**CRITICAL RULE: INLINE, don't reference.** Don't write "see memory file X" or "check
planning state." The next agent has ZERO context. If a fact matters, write it directly
in the handoff. The next session should NOT need to read any other file to understand
the situation.

Write a structured handoff file:

```markdown
# Session Handoff — [DATE]

## Session Learnings (quick-reflect)
[From Step 1]

## Current Bug/Issue (if applicable)
[Full description of what's broken, not a pointer to another file]
[Root cause analysis so far — what was tried, what failed, what's the current hypothesis]
[Exact file:line where the issue manifests]
[Relevant error messages or log output — copy them here, don't say "check the logs"]

## What Was Accomplished
- [Bullet list of completed work WITH the file paths changed]
- [For each change: what it does and why, not just "edited foo.c"]

## In-Flight (NOT complete)
- [What was being worked on when the session ended]
- [Current status: exactly how far along, what specific step is next]
- [Any partial changes: which files were modified but not committed]

## Needs Human Testing
- [What the user needs to test before the next session]
- [EXACT commands to run or steps to follow]
- [What to look for: specific log messages, UI behavior, error codes]
- [Expected behavior: what "working" looks like]
- [Known issues: what's still broken even if the fix works]
- (If nothing to test, write "None — all changes are verified")

## Next Session Should (in this exact order)
1. [Read THIS handoff file — already done if you're seeing this]
2. [SPECIFIC first action — not "review results" but "open [safety-project]Decryptor.log and search for ERROR"]
3. [Second action with exact details]
4. [If tests passed: commit with message "..."]
5. [If tests failed: investigate X in file Y starting at line Z]

## Key Context (inlined, not referenced)
- [Decision 1: what was decided and WHY — not "see spec"]
- [Decision 2: approach that was tried and DIDN'T work — so next session doesn't repeat it]
- [Architecture fact: e.g., "USB host uses EHCI async schedule, not periodic" — inline the key facts]
- [File map: which files are relevant and what each one does in this context]
```

## Step 3: Write Files

**3a. Write the detailed handoff** to the canonical location:

Write to: `~/.ai-context/handoffs/sessions/<session-id>.md`

**To get the session ID:** Read `~/.ai-context/handoffs/sessions/.current-session-claude.json` (Claude) or `.current-session-gemini.json` / `.current-session-codex.json` as appropriate — the auto-save hook writes this pointer. Use the `session_id` field from that file.
If the file doesn't exist (auto-save never fired), use a timestamp-based ID: `manual-YYYY-MM-DDTHH-MM`.

**One location. No cascade. No fallback.** Per-session-id filenames prevent collisions.
No Glob check needed for concurrent sessions.

## Deferred Items (managed in ~/.ai-context/handoffs/deferred/items.json)

New items added this session:
- [type] "title" (project: X)

Do NOT copy-paste deferred items from previous handoffs. They live in the canonical store.
Use MCP tool `update_deferred` to add items, or write directly to the JSON file.

**3b. Update AI-progress.json** (if it exists):
```json
{
  "agent": "claude",
  "timestamp": "ISO-DATE",
  "summary": "1-2 sentences of what was accomplished",
  "filesChanged": ["list", "of", "files"],
  "inFlight": {
    "status": "needs-human-testing|needs-verification|in-progress",
    "description": "What's in progress",
    "nextSteps": ["step 1", "step 2"],
    "testInstructions": "What the user should test"
  }
}
```

## Step 4: Confirm to User

Tell the user clearly:
1. **Saved:** what files were written and where
2. **Test this:** what they should test (exact steps) — or "nothing to test"
3. **Resume:** "Next session will auto-load the handoff. Start with: [specific first action]"
4. **Learnings:** if HIGH-confidence corrections were found, mention they need persisting next session

## How the Next Session Picks This Up

The `session-context-loader.js` SessionStart hook reads the project index at
`~/.ai-context/handoffs/projects/<key>.json` and shows a banner with the latest session
summary. If a prose handoff exists, it points to `~/.ai-context/handoffs/sessions/<id>.md`.

The `handoff-triage-gate.js` hook surfaces stale deferred items from the canonical store.

If the next session runs /wrap-up or /reflect, the quick-reflect learnings from the handoff
file should be promoted to proper memory files (if they're still relevant).

## Hard Rules
- NEVER skip Step 1 (quick-reflect) — lost learnings cost more than 30 seconds
- NEVER skip "Needs Human Testing" — if nothing to test, say so explicitly
- NEVER be vague about next steps — the next session agent has ZERO context
- Include file paths and line numbers — "the fix in that file" is useless
- Complete in 1-2 turns MAX — if you're spending more, you're defeating the purpose
- Do NOT ask for approval — context pressure means act NOW, not wait for confirmation

## Red Flags

If you catch yourself thinking any of these, STOP — you're rationalizing:

| Thought | Reality |
|---------|---------|
| "The session state is obvious from git history" | Git shows WHAT changed, not WHY or what's NEXT. |
| "I'll inline the state in my final message" | Final messages aren't persisted. .session-handoff.md IS. |
| "There's nothing in-flight" | Check: uncommitted changes? Failing tests? Blocked items? Be explicit. |
| "The next session can figure it out" | The next session starts with zero context. Give it a running start. |
