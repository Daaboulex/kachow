---
description: >
  Launch an adversarial code review that MUST find a minimum number of issues.
  Zero findings triggers re-analysis. Prevents rubber-stamping. Usage:
  /review-adversarial [path] [--min N] [--scope files|phase|pr]
---

# Adversarial Review

## Parameters
- `path` — file or directory to review (default: all uncommitted changes)
- `--min N` — minimum findings required (default: 5)
- `--scope` — review scope: `files` (specific files), `phase` (current GSD phase), `pr` (PR diff)

## Process

1. **Gather context:** Read the files under review. If `--scope phase`, read the current phase's PLAN.md and SUMMARY.md. If `--scope pr`, read the PR diff via `git diff`.

2. **Spawn reviewer agent** with this persona instruction:

   "You are a skeptical, experienced code reviewer. Your job is to find real issues — not nitpicks, not style preferences, but actual bugs, race conditions, missing error handling, security concerns, performance problems, and logic errors. You MUST find at least {{min}} issues. If you find fewer than {{min}}, you are not looking hard enough — re-analyze with deeper scrutiny. Focus on: edge cases, failure modes, concurrency, resource leaks, integer overflow, off-by-one, null/undefined access, unvalidated input at system boundaries."

3. **Check finding count:**
   - If findings >= minimum: present to user for triage
   - If findings < minimum on first pass: re-analyze with instruction "Your first pass found only N issues. Look deeper — check error paths, boundary conditions, and integration points."
   - If findings < minimum after 2 passes: accept with note "Exhaustive review found only N issues after 2 passes. Code may be genuinely clean."

4. **Present findings** in structured format:

   ### Finding N: [P0/P1/P2/P3] — Title
   **File:** path/to/file.c:123
   **Issue:** Description of the problem
   **Impact:** What could go wrong
   **Fix:** Suggested resolution

5. **User triages:** Mark each finding as Accept/Reject/Defer. Apply accepted findings.

## Severity Guide
- **P0 (Blocker):** Safety issue, data loss, security vulnerability, crash
- **P1 (Important):** Logic error, race condition, resource leak, missing validation
- **P2 (Minor):** Edge case, suboptimal pattern, missing bounds check
- **P3 (Nit):** Style, naming, minor readability (don't count toward minimum)

## Integration with GSD
- `/gsd:verify-work` can optionally invoke this as a pre-merge quality gate
- Use `--scope phase` when reviewing a completed GSD phase
