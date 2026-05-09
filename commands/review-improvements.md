---
name: review-improvements
description: Review pending AI-system self-improvements detected by meta-system-stop. Shows each finding grouped by tier (BLOCKER/SUGGEST/OBSERVE) with evidence + proposal. User decides: accept (implement), reject (teaches suppression), defer (keep watching), skip (no-op). Queue at ~/.claude/self-improvements-pending.jsonl. Spec: .superpowers/specs/2026-04-14-self-improvement-handoff.md
---

# /review-improvements

> **Note:** This command is Claude-only by design, not a missing feature. The `meta-system-stop.js` detector and `self-improvements-pending.jsonl` queue are Claude Code-specific. Gemini, Codex, Crush, and OpenCode do not generate self-improvement entries — they use the same hook files but lack the Stop-hook analysis pipeline that feeds this queue.

Read `~/.claude/self-improvements-pending.jsonl` via `~/.claude/hooks/lib/self-improvement/queue.js`. For each entry, present to [user] for decision.

## Steps

1. **Load queue:**
   ```js
   const q = require('~/.claude/hooks/lib/self-improvement/queue.js');
   const pending = q.readPending();
   const summary = q.summary();
   ```

2. **If empty:** say "No pending self-improvements. System healthy." and exit.

3. **Sort by tier:** BLOCKER → SUGGEST → OBSERVE. Within tier, oldest first.

4. **Present each entry:**
   ```
   [<tier>] <rule> — <target.path>
     Evidence: <evidence summary>
     Proposal: <proposal>
     Detected: <detected_at> (seen <seen_count>x)
     ID: <id>
     [a]ccept  [r]eject  [d]efer  [s]kip
   ```
   Show `diff_preview` if present.

5. **Ask for decision** (batch-friendly; e.g. "reject all settings_drift").

6. **Apply decisions:**
   - **accept**: if `auto_applicable === true`, apply now + log; else write action item to `.session-handoff.md` under "## System Improvements — Accepted"
   - **reject**: `q.resolve(id, 'reject', userNote)` — auto-writes to `memory/reference/self-improvement-feedback.md` for 90d class suppression
   - **defer**: `q.resolve(id, 'defer', 'revisit later')`
   - **skip**: leave untouched for next review

7. **Announce summary:** "Accepted N, rejected N, deferred N, skipped N. Queue: <new summary>."

## Auto-applicable actions

Reversible only:
- `orphan_hook_file` → move to `hooks/archive/<today>/`, update archive README
- `cross_platform_asymmetry` → mirror file Claude↔Gemini

Each auto-apply: log `type: self_improvement_auto_applied` to episodic JSONL.

## Interaction

- Batch shortcuts ("reject all of class X"): honor.
- Diff preview on request.
- Match caveman / normal mode from session.

## After review

- BLOCKER remaining: warn `/wrap-up` blocks until ack'd (`--force` overrides).
- Any auto-apply: note files changed.
- Any rejections: mention class-suppression active (3/90d silence).

## Example

```
Pending: 9 SUGGEST, 1 OBSERVE

[SUGGEST] cross_platform_asymmetry — ~/.gemini/hooks/sync-claude-md.js
  Evidence: present_on=gemini, missing_on=claude
  Proposal: Mirror or add to allowlist.
  Detected: 2026-04-14T18:00Z (seen 1x)
  ID: a7b3c2d1e4f5
  [a]ccept  [r]eject  [d]efer  [s]kip

> a
Auto-applied: copied ~/.gemini/hooks/sync-claude-md.js → ~/.claude/hooks/
```
