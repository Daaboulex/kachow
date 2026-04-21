---
description: >
  Split a large markdown file into a directory with index + sections.
  Consumers transparently discover either format. Usage:
  /shard-doc <path> [--threshold 500] [--reassemble]
---

# Document Sharding

## Shard a Document

1. Read the markdown file at `<path>`
2. If line count < threshold (default 500), report "Document is small enough. No sharding needed."
3. Split at `## ` (H2) headings
4. Create directory `<name>/` (same location as original, without .md extension)
5. Write `index.md` with frontmatter + table of contents
6. Write `section-NN-<slug>.md` for each H2 section
7. Keep original as `<name>.original.md` backup

### index.md Format

```yaml
---
source: <original-filename>.md
sharded_at: <ISO timestamp>
sections: <count>
---
```

Followed by a TOC:
```markdown
# <Original Title>

Sharded into <N> sections for context efficiency.

1. [Section Title](section-01-slug.md)
2. [Section Title](section-02-slug.md)
...
```

## Reassemble

`/shard-doc --reassemble <directory>`

Concatenates all `section-*.md` files in order, separated by blank lines. Writes to `<directory-name>.md` in the parent directory.

## When to Shard

Suggest sharding when:
- A planning doc exceeds 500 lines
- A research doc exceeds 800 lines
- Any doc exceeds 1000 lines
