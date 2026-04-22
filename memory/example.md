---
name: Example memory (delete after first use)
description: Template showing the v2 frontmatter schema for the framework's memory system
type: reference
created: 2026-04-21
last_verified: 2026-04-21
last_accessed: 2026-04-21
ttl_days: permanent
evidence: [doc:https://github.com/<owner>/<repo>/blob/main/docs/ARCHITECTURE.md]
status: active
---

# Example memory file

Delete or replace this file after you've added your first real memory.

## v2 schema at a glance

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | Short title |
| `description` | yes | One-line index hook |
| `type` | yes | user / feedback / project / reference / procedure |
| `created` | yes | YYYY-MM-DD when added |
| `last_verified` | yes | Bumped when content re-checked against reality |
| `last_accessed` | yes | Auto-updated by read hook |
| `ttl_days` | yes | `permanent` / `180` / `90` / `30` |
| `evidence` | yes | `[file:/abs/path, url:..., commit:<sha>]` |
| `status` | yes | active / archived / deprecated |

## Types

- `user` — who you are, preferences, expertise (permanent)
- `feedback` — corrections and approvals; must include **Why:** and **How to apply:** (90d)
- `project` — current work state, decisions, blockers (90d)
- `reference` — external system pointers (permanent)
- `procedure` — how-tos and runbooks (180d)

## Rotation

`memory-rotate.js` Stop hook runs every 7d. When `now - last_verified > ttl_days` and ttl != permanent, the file moves to `memory/archive/`. Never deleted.

## Rebuild the index

```
node hooks/lib/memory-migrate.js --rebuild-index memory/
```

## Drop-in compatibility

This framework lives alongside your existing hooks/commands/settings. It never overwrites without backing up. To add your own rules that survive framework updates, write them between the USER SECTION markers in `AGENTS.md`:

```markdown
<!-- USER SECTION — keep your edits here; framework updates preserve this block -->
Your personal rules go here.
<!-- END USER SECTION -->
```
