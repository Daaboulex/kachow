# Skills + per-AI compatibility

Skills package reusable AI workflows — each is a directory containing a `SKILL.md` with frontmatter and a body. An AI invokes the skill by name and the body becomes its playbook.

**The format is not identical across AI tools.** A skill that works on Claude Code may need adaptation for Gemini CLI, Codex CLI, or Cursor. This doc explains the differences and how kachow handles them.

## Shipped skill

kachow ships one example skill to demonstrate the format: `skills/debt-tracker/SKILL.md`. It tracks technical debt per repo via a `DEBT.md` file. Every tool that understands SKILL.md frontmatter can invoke it.

## Compatibility matrix

| Tool | Location | Invocation | Frontmatter keys read |
|---|---|---|---|
| **Claude Code** | `~/.claude/skills/<name>/SKILL.md` (or `~/.ai-context/skills/<name>/SKILL.md` via symlink) | `Skill` tool with `skill: "<name>"` — user types `/<name>` in the prompt | `name`, `description` |
| **Gemini CLI** | `~/.gemini/skills/<name>/SKILL.md` (symlink target) | `activate_skill` tool — the model selects based on description matching | `name`, `description` |
| **Codex CLI** | `~/.codex/skills/<name>/SKILL.md` (plugin work-in-progress) | not yet standardized — treat skills as read-only reference docs for now | `name`, `description` |
| **OpenCode** | reads `AGENTS.md`; skills as inline body sections | no dedicated skill invocation | — |
| **Aider** | same — reads AGENTS.md only | — | — |
| **Cursor** | `.cursor/rules/*.mdc` per repo | auto-activates by glob match | its own frontmatter (`description`, `globs`, `alwaysApply`) |

Key consequence: **a SKILL.md that's behaviorally correct for Claude may be silently ignored by Gemini** (because Gemini's `activate_skill` uses semantic match on description; a terse description gets skipped). Write descriptions assuming semantic retrieval.

## Authoring a skill

Every shipped skill MUST:

1. Live in its own directory: `skills/<name>/SKILL.md`.
2. Start with YAML frontmatter containing `name` + `description`.
3. Keep the description **specific**. It's the retrieval signal. Bad: "help with tests". Good: "Generate Jest tests for a React component, mocking fetch and preserving existing snapshots."
4. Put the playbook in the body, in whatever Markdown structure makes sense (headings / lists / code examples).

Minimal template:

```markdown
---
name: your-skill-name
description: One sentence explaining WHEN to activate it — specific enough that the retrieval layer finds it for the right tasks but skips it for unrelated ones.
---

# Your skill name

## When to use

- Concrete trigger condition 1
- Concrete trigger condition 2

## Steps

1. Read X
2. Check Y
3. Write Z

## Anti-patterns

- Thing to avoid
```

## Handling per-AI differences

kachow symlinks `~/.ai-context/skills/<name>/` into each tool's skill directory. The SAME file serves every tool. If a tool needs a slightly different body, add it as additional sections under per-tool headings inside the SKILL.md:

```markdown
## Claude-specific notes

Use the `Skill` tool with argument `{}`...

## Gemini-specific notes

When invoked via `activate_skill`, the tool ID is ...
```

**Planned:** per-AI skill adapters. `skills/<name>/SKILL.md` stays the source of truth, and `install-adapters` generates:

- `~/.claude/skills/<name>/SKILL.md` — Claude-formatted
- `~/.gemini/skills/<name>/SKILL.md` — Gemini-formatted (frontmatter translated via `lib/platform-map.js`)
- `.cursor/rules/<name>.mdc` — Cursor-formatted (if a `.cursor/` dir exists in the project)

Until adapters ship, use the per-tool heading convention above when a skill needs to behave differently across tools.

## Validating a skill

CI (`.github/workflows/ci.yml`) validates every shipped skill:

1. `name` and `description` present in frontmatter.
2. `description` is ≥ 20 characters (retrievers need signal).
3. Name matches directory name (so `skills/foo/SKILL.md` declares `name: foo`).
4. No orphan skills (referenced in hooks/commands but no directory).
5. No straggler directories (skill dir with empty or malformed SKILL.md).

Run the validator locally:

```bash
node scripts/validate-skills.js          # or .ps1 on Windows
```

Exit code 0 = all skills valid; non-zero = see output for the mismatch.

## Upstream-tracking built-in hooks

- `skill-upstream-checker` (SessionStart) — checks subscribed upstream skill repos for new versions on a 7-day cooldown.
- `skill-invocation-logger` (PostToolUse on `Skill`) — records which skills were actually used.
- `track-skill-usage` (Stop) — aggregates into `~/.claude/skill-usage.json`. `/consolidate-memory` reads this to identify under-used skills for pruning.

Together these give you a feedback loop: which skills does your workflow actually invoke, which get stale, which need updates upstream.

## Adding your own skill

```bash
mkdir -p ~/.ai-context/skills/my-skill
cat > ~/.ai-context/skills/my-skill/SKILL.md <<'EOF'
---
name: my-skill
description: One concrete sentence about when to activate this skill.
---

# My skill

...
EOF

node scripts/bootstrap.mjs       # re-runs install-adapters to symlink into all tools
```

The new skill lands in every installed tool's skill directory on next session start.
