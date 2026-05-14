---
name: memory
description: Search project memories by free-text query. Pure grep across .ai-context/memory/*.md (canonical). Also searches project-state and tool-specific memory dirs.. Zero deps, works on Win + Nix + WSL. Returns top matching files with one-line context, then offers to read the full memory.
---

# /memory <query>

Search current project's memory files for a free-text query. Use when:
- You vaguely remember a memory exists but don't know which file
- You're starting a task and want all related learnings before coding
- You want to refresh on a topic before /reflect or /consolidate-memory

## Steps

1. **Resolve memory dir.** Walk up from cwd looking for `.ai-context/memory/` (canonical). Use first match. If none, fall back to `~/.ai-context/memory/` (global).

2. **Search.** Run cross-platform grep:
   ```bash
   grep -rli --include='*.md' "$ARGUMENTS" <memory-dir>
   ```
   On Windows Git Bash: same syntax. On NixOS: same. PowerShell fallback if needed:
   ```powershell
   Get-ChildItem -Path <memory-dir> -Filter '*.md' -Recurse |
     Select-String -Pattern "$ARGUMENTS" -SimpleMatch -List |
     Select-Object Path
   ```

3. **For each match, extract context:** show 2 lines around each match for relevance preview.
   ```bash
   for f in $matches; do
     echo "── $(basename "$f")"
     grep -B1 -A1 -i "$ARGUMENTS" "$f" | head -10
   done
   ```

4. **Rank by hit-count** (more matches = more relevant). Show top 5.

5. **Offer next action:**
   - "Read full memory: which one? (1-5)"
   - User picks → use Read tool to load that file
   - Or user says "all" → Read all 5
   - Or user says "skip" → exit

## Output format

```
Searching memories for "<ARGUMENTS>" in <memory-dir>:

5 matches:

1. usb-in-investigation.md (4 hits)
   "USB Host EHCI bulk IN XactErr — error -2 on every IN transfer..."
   "...root cause: timing race between TD ring update and EHCI fetch..."

2. project_remote_pst_flow.md (2 hits)
   ...

[Read 1-5 / all / skip]
```

## Cross-platform notes

- Use `grep -rli` if available (Linux/Git Bash). PowerShell fallback uses `Select-String`.
- `--include='*.md'` works in GNU grep on Win Git Bash + NixOS. PowerShell uses `-Filter '*.md'`.
- ARGUMENTS may contain spaces — quote it. `grep -F` (fixed string) avoids regex weirdness on user-typed queries.

## Self-improvement integration

Each invocation logs a `memory_query` event to episodic JSONL via `lib/observability-logger.js`:
```js
{ type: 'memory_query', source: 'memory-cmd', payload: { query, hits, picked } }
```

This feeds the Tier 3 self-improvement loop:
- Memories with high hit-count + frequent picks → candidates for promotion to MEMORY.md top section
- Memories with 0 hits across 30+ queries → candidates for archive (R11 detector)
- Common queries with 0 hits → suggest writing a new memory (R13 future detector)

## When NOT to use

- For broad concept searches across MANY memories (>10 expected hits): use `/consolidate-memory` instead — it synthesizes Tier 3 semantic summaries.
- For "what changed recently" → check `git log` on memory dir
- For per-skill memory: skill-routing-injector already handles auto-injection at SessionStart

## Examples

```
/memory USB EHCI       → finds usb-in-investigation, project_dl2_hardware_topology
/memory NOLINT         → finds feedback_no_nolint_shortcuts, feedback_nolint_placement
/memory dual-remote    → finds feedback_git_sync_never_push, project_identity_layer
/memory snapshot       → finds reference_cross_machine_sync, project_portable_builder_reorg
```
