---
description: >
  Lossless document compression with round-trip validation. Preserves every fact,
  decision, and constraint while removing prose overhead. Usage:
  /distill <path> [--target-ratio 0.3] [--no-validate] [--chunk-size 500]
---

# Distill — Lossless Document Compression

## Parameters
- `path` — markdown file to compress
- `--target-ratio` — target size as fraction of original (default: 0.3 = 30%)
- `--no-validate` — skip round-trip validation
- `--chunk-size` — for files >500 lines, chunk size for parallel processing

## Process

### Phase 1: Compress

Read the source document. Apply these rules IN ORDER:

**STRIP:**
- Markdown formatting beyond H2 (remove `###`, `####`, bold, italic unless semantically meaningful)
- Blank lines (compress to single newline between sections)
- Filler phrases: "it's worth noting that", "as mentioned above", "in order to", "it should be noted", "the following section describes"
- HTML comments
- Repeated section headers

**PRESERVE (never remove):**
- All facts, numbers, dates, names, identifiers
- All decisions and their rationale
- All constraints and requirements
- File paths, code snippets, error messages
- Table data (keep tables as-is — already compact)
- Code blocks (verbatim)

**TRANSFORM:**
- Prose paragraphs → bullet points
- Nested explanations → indented sub-bullets
- If/then logic → `condition: result` format
- "X because Y" → `X — reason: Y`

**DEDUP:**
- Information repeated across sections → single canonical location
- Back-reference: `(see: Section N)` for removed duplicates

### Phase 2: Validate (unless --no-validate)

Spawn a SEPARATE agent that receives ONLY the distilled output (not the original). This agent:

1. Extracts all factual claims from the distillate as a numbered list
2. For each claim, rates confidence: HIGH (explicit statement), MEDIUM (inferable), LOW (ambiguous)

Then compare against the original:
1. Read the original document
2. For each claim in the validator's list, verify it exists in the original
3. For each fact in the original NOT in the validator's list, flag as potentially lost

If >5% of original facts are missing from the distillate, report gaps and re-compress with the gap report.

### Phase 3: Output

Write `<filename>.distilled.md` with frontmatter:
```yaml
---
source: <original-filename>.md
source_lines: <count>
distilled_lines: <count>
ratio: <distilled/source>
validation: PASS|FAIL|SKIPPED
validated_at: <ISO timestamp>
---
```

If the compression ratio would be >0.8 (only 20% reduction), skip and report: "Document is already compact (ratio would be N). No distillation needed."

## Examples

```bash
/distill .planning/phases/01-foundation/01-RESEARCH.md
# Output: 01-RESEARCH.distilled.md (30% of original)

/distill docs/architecture.md --target-ratio 0.5 --no-validate
# Output: architecture.distilled.md (50% of original, no validation)
```
