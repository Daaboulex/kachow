---
name: cmd-deep-research
description: "Formalize investigation-to-spec workflow: parse startup context, dispatch research agents, consolidate findings, generate spec. Use when starting a complex investigation session that needs structured research before implementation."
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Agent, AskUserQuestion, Skill
---

# Deep Research — Investigation-to-Spec Workflow

Formalize the recurring pattern: understand → investigate → consolidate → spec.

## When to use

- Starting a session with multiple research topics
- Complex tasks requiring multi-agent investigation before planning
- Sessions where startup hooks surface multiple issues to investigate
- Any task where "send agents to research, then consolidate" is the approach

## Workflow

### Step 1 — Parse startup context

Extract actionable items from startup hook output:
- Warnings, drift signals, errors from `session-start-combined.js`
- Deferred items from `handoff-triage-gate.js`
- Symlink/parity issues from `session-health-fast.js`
- Do NOT ignore startup hooks — they contain valuable signals

### Step 2 — Parse user intent

- Classify user's first prompt: investigation, implementation, debugging, maintenance
- Extract key topics, repos, and scope
- Identify what needs research vs what's already known

### Step 3 — Generate investigation plan

Before dispatching any agents, reason about:

```
R-RES-4: [agent name]
- Need: yes/no — [reason]
- Reads: [files] — exist: yes/no
- Writes: [files] — collision: none / [agent X]
- Context: fork / subagent (briefing: [what])
- Depends on: nothing / [agent Y completing]
- Running conflicts: none / [wait for Z]
- Tool: available / [check needed]
- Model: [choice] — [reason]
```

Assign models correctly:
- Research/web: `model: "sonnet"`
- Code review: `model: "sonnet"`
- Mechanical grep/locate: `model: "haiku"` (ONLY for hard-ruled tasks)
- Architecture/planning: inherit parent (opus)
- Codex agents: `model:` irrelevant (uses GPT-5.5)

### Step 4 — Dispatch + monitor agents

- Launch independent agents in parallel (one message, multiple Agent calls)
- Sequential agents: wait for dependency to complete before dispatching
- If agent returns empty or fails: retry once, then flag to user
- Track which agents are running and what files they'll read/write

### Step 5 — Auto-consolidation

After all agents return:
1. Review each agent's findings
2. Cross-reference for contradictions
3. Verify claims against actual code (agents can hallucinate)
4. Synthesize into structured summary
5. Count: did every research question get answered?

### Step 6 — Generate spec

From consolidated findings, generate `.superpowers/specs/YYYY-MM-DD-<topic>.md`:
- Follow project spec conventions (Complexity/Risk, no time estimates)
- Include all findings organized by work area
- Verification checklist per phase
- Present for user approval before any implementation

## Relationship to existing skills

- **Not replacing**: wrap-up, reflect, brainstorm, or plan skills
- **Complements**: the investigation phase that PRECEDES planning
- **Feeds into**: `superpowers:writing-plans` for implementation planning
