// handoff-progress.js
// Parse a handoff markdown doc for actionable items + completion state.
//
// Recognizes:
//   - `- [ ] item`  → pending
//   - `- [x] item`  → done
//   - `1. item`     → numbered list item (ambiguous → counted pending by default)
//   - sections tagged `## Needs Human Testing`, `## Pending`, `## Next Session Should`
//
// Returns { total, done, pending, pct, pendingItems[], section }.

'use strict';

const fs = require('fs');

// Section headers that imply actionable (pending) content when non-empty.
// Match these anywhere in the handoff, case-insensitive.
const ACTION_SECTION_RE = /^##\s+(needs human testing|pending|next session should|test plan|todo|in[- ]flight|open items)/i;

function parseHandoff(content) {
  const result = {
    total: 0,
    done: 0,
    pending: 0,
    pct: 100,
    pendingItems: [],
    sections: [],
  };

  // ── Checkbox parsing ──
  const checkboxRe = /^[\s]*-\s\[( |x|X)\]\s+(.+)$/gm;
  let m;
  while ((m = checkboxRe.exec(content))) {
    const isDone = m[1].toLowerCase() === 'x';
    result.total++;
    if (isDone) {
      result.done++;
    } else {
      result.pending++;
      result.pendingItems.push(m[2].trim());
    }
  }

  // ── Section-level action counts (when no checkboxes present) ──
  if (result.total === 0) {
    const lines = content.split(/\r?\n/);
    let inAction = false;
    let actionName = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const hdrMatch = line.match(ACTION_SECTION_RE);
      if (hdrMatch) {
        inAction = true;
        actionName = hdrMatch[1];
        continue;
      }
      if (line.startsWith('## ')) {
        inAction = false;
        actionName = null;
        continue;
      }
      if (inAction) {
        // Numbered item OR bullet item OR non-empty line inside action section
        const numbered = line.match(/^\s*(\d+)\.\s+(.+)$/);
        const bullet = line.match(/^\s*[-*]\s+(?!\[)(.+)$/);
        const item = numbered ? numbered[2] : (bullet ? bullet[1] : null);
        if (item && !/^none\b/i.test(item)) {
          result.total++;
          result.pending++;
          result.pendingItems.push(`[${actionName}] ${item.trim()}`);
        }
      }
    }
  }

  result.pct = result.total === 0 ? 100 : Math.round((result.done / result.total) * 100);
  return result;
}

function parseHandoffFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = parseHandoff(content);
    parsed.path = filePath;
    return parsed;
  } catch {
    return null;
  }
}

// Surface badge for session-context-loader. Short string, colored via ANSI codes.
// Returns null if handoff is complete / absent.
function summaryBadge(progress) {
  if (!progress) return null;
  if (progress.total === 0) return null;
  if (progress.pending === 0) return `✓ handoff complete (${progress.done}/${progress.total})`;
  const preview = progress.pendingItems.slice(0, 2).map(s => s.slice(0, 60)).join(' · ');
  return `⚠ handoff ${progress.done}/${progress.total} (${progress.pct}%) — pending: ${preview}${progress.pendingItems.length > 2 ? '...' : ''}`;
}

module.exports = { parseHandoff, parseHandoffFile, summaryBadge };

// CLI: node handoff-progress.js <path>
if (require.main === module) {
  const p = process.argv[2];
  if (!p) {
    process.stderr.write('usage: handoff-progress.js <path-to-handoff.md>\n');
    process.exit(2);
  }
  const out = parseHandoffFile(p);
  if (!out) {
    process.stderr.write('not readable: ' + p + '\n');
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}
