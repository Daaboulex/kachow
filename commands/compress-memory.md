---
description: >
  Compress old/large memory files into summaries to reduce token overhead.
  Use when MEMORY.md exceeds 200 lines, when memory files accumulate beyond 40,
  or when /consolidate-memory reports context bloat. Inspired by AgentScope's memory compression.
---

# Compress Memory

Explicitly compress old memories to keep the system lean. Auto-memory and /reflect
accumulate knowledge over time — this command prunes without losing information.

## When to run

- MEMORY.md index exceeds 200 lines (the auto-loaded limit)
- More than 40 memory files in the directory
- `/consolidate-memory deep` reports memory bloat or redundancy
- Before starting a long, complex task (free up context budget)

## Process

### Step 1: Inventory

```bash
echo "Memory files: $(ls ~/.ai-context/memory/*.md 2>/dev/null | wc -l)"
echo "MEMORY.md lines: $(wc -l < ~/.ai-context/memory/MEMORY.md 2>/dev/null)"
```

### Step 2: Identify compression candidates

Read MEMORY.md and classify each memory:

| Category | Action |
|---|---|
| **Active feedback** (still guides behavior) | KEEP as-is |
| **Completed project state** (work is done, merged, shipped) | COMPRESS into summary or ARCHIVE |
| **Session-specific** (demo progress, investigation notes) | ARCHIVE if >14 days old (move to memory/archive/) |
| **Superseded** (newer memory covers same topic) | MERGE into the newer one |
| **Reference** (architectural docs, patterns) | KEEP — these are read on-demand, not always-loaded |

### Step 3: Compress

For each candidate:

**MERGE:** Combine 2+ overlapping memories into one:
```
feedback_no_nolint_shortcuts.md + feedback_nolint_placement.md
→ Could merge into single "NOLINT handling rules" memory
```

**SUMMARIZE:** Replace a large memory with a 5-line summary:
```
Before: 150-line build-improvements.md with completed work tracking
After: 20-line summary of what was done + what's still open
```

**ARCHIVE:** Move to a `.archive/` subdirectory (don't delete — just remove from MEMORY.md index):
```bash
mkdir -p ~/.ai-context/memory/.archive/
mv old-memory.md ~/.ai-context/memory/.archive/
```

### Step 4: Update MEMORY.md index

Remove entries for archived/removed files. Ensure every remaining file has an index entry.

### Step 5: Sync

Run `/sync-all` to propagate changes across all tools.

## Rules

- NEVER delete a memory file — update, merge, or archive (move to memory/archive/) instead
- When merging, keep the richer/more specific version
- Reference memories (architecture, patterns) don't need compression — they're read on-demand
- Feedback memories should almost never be compressed — they guide behavior directly
- After compression, verify MEMORY.md is under 200 lines
