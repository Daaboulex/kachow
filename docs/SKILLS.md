# Skills + per-AI compatibility

Skills package reusable AI workflows — each is a directory containing a `SKILL.md` with frontmatter and a body. An AI invokes the skill by name and the body becomes its playbook.

## Skill format

```
core/skills/commands/<name>/SKILL.md
```

Frontmatter:
```yaml
---
name: skill-name      # must match directory basename
description: ...      # triggers activation — be specific
---
```

Body: markdown instructions the AI follows when the skill activates.

## Shipped skills

kachow ships 15 command skills (slash-invoked):

| Skill | Purpose |
|---|---|
| `/memory <query>` | Search memory files by topic |
| `/handoff` | Fast session state save at context pressure |
| `/wrap-up` | End-of-session reflect + verify + index refresh |
| `/reflect` | Session reflection with auto toggle |
| `/consolidate-memory` | 3-tier memory maintenance pass |
| `/compress-memory` | Compress old/large memory files |
| `/deep-research` | Formalized investigation workflow |
| `/distill <path>` | Lossless document compression |
| `/shard-doc <path>` | Split oversize docs into indexed sections |
| `/review-adversarial` | Enforced-minimum-findings code review |
| `/review-improvements` | Triage self-improvement findings |
| `/platform-audit` | CLI release + hook parity audit |
| `/verify-sync` | Cross-CLI drift detection |
| `/sync-all` | Sync all context artifacts across CLIs |
| `/preview <path>` | Terminal image preview via chafa |

## Per-tool compatibility

| Tool | Skill location | Invocation |
|---|---|---|
| **Claude Code** | `~/.agents/skills/` (via plugin system) | `Skill` tool — user types `/<name>` |
| **Gemini CLI** | `~/.agents/skills/` (auto-discovery) | `activate_skill` — model matches by description |
| **Codex CLI** | `~/.agents/skills/` (auto-discovery) | Progressive disclosure — loads on match |
| **Pi** | `~/.agents/skills/` (via settings.json paths) | `/skill-name` or auto-match |

## Skill exclusions

Skills irrelevant to your stack can be excluded via `modules/skill-exclusions.yaml`. The generator distributes exclusions to all 4 CLIs in their native format. See [ARCHITECTURE.md](./ARCHITECTURE.md) for details.
