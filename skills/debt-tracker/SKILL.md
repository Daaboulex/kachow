---
name: debt-tracker
description: Track known technical debt, bugs, and blocked work per repo via DEBT.md. Use when you identify a bug you can't fix now, a hack that needs revisiting, or work blocked waiting on hardware/info. Prevents drift — per the project pattern, bugs in session transcripts get lost; DEBT.md keeps them visible.
allowed-tools: Read, Write, Edit, Grep, Glob, mcp__personal-context__add_debt, mcp__personal-context__read_debt
---

# DEBT Tracker

Each repo has a `DEBT.md` at its root tracking known issues that aren't fixed yet. This prevents the pattern of bugs drifting 3+ sessions before being addressed.

## When to add an entry

Add an entry when you:
- Identify a bug but can't fix it in this session (blocked, scope, time)
- Apply a workaround/bandaid that needs proper fix later
- Find a test gap, missing edge case, or suspicious behavior
- Hit a hardware/protocol limitation requiring decision

## When NOT to add

- Fully fixed bugs (commit them, close them)
- Ideas/wishlist (use `.claude/deferred-work.jsonl` via `gsd:plant-seed`)
- Session state (use `/handoff`)

## Format

```markdown
# Technical Debt — <repo-name>

> Known issues not yet fixed. Add entry when discovered; remove when resolved (link to commit).

## Open

### [D-N] Short title
- **Discovered:** YYYY-MM-DD (session/PR if known)
- **Symptom:** what's broken / observed behavior
- **Root cause (if known):** ...
- **Workaround:** current bandaid (if any)
- **Fix approach:** what a proper fix looks like
- **Blocked by:** hardware / decision / upstream / time
- **Severity:** P0 (safety) / P1 (broken core) / P2 (degraded) / P3 (cosmetic)
- **Owner:** @[user]

---

## Resolved

### [D-K] Short title (commit SHA)
Closed YYYY-MM-DD — brief note on how.
```

## Rules

1. **Every entry needs severity.** P0/P1 block release; P2/P3 can ship.
2. **Resolution = commit + move to Resolved.** Don't just delete.
3. **Review monthly** — stale P1+ items should be escalated or downgraded with reasoning.
4. **Cross-ref** — when `feedback_*.md` describes a rule violated by this debt, link it.
