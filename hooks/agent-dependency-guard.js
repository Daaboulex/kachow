#!/usr/bin/env node
// PreToolUse guard: block Agent dispatches that reference non-existent INPUT files.
// Distinguishes read-intent paths (must exist) from write-intent paths (agent will create).
require('./lib/safety-timeout.js');

const fs = require('fs');
const os = require('os');

const WRITE_VERBS = /(?:write|create|overwrite|save|output|generate|produce|cp\b.*\bto)\s/i;
const READ_VERBS = /(?:read|cat|check|examine|look at|inspect|verify|parse|load|import from)\s/i;

function classifyPath(prompt, pathStr, pathIndex) {
  const contextStart = Math.max(0, pathIndex - 120);
  const before = prompt.slice(contextStart, pathIndex).toLowerCase();
  const lines = before.split('\n');
  const nearestLine = lines[lines.length - 1] || '';
  const prevLine = lines.length > 1 ? lines[lines.length - 2] : '';
  const context = prevLine + ' ' + nearestLine;

  if (/(?:→|->|output\s*(?:to|:)|save\s+(?:to|as)|write\s+(?:to|at)|overwrite|create\s+at|produce|cp\s+\S+\s+)/i.test(context)) return 'write';
  if (/(?:placeholder|already exists|exists as placeholder)/i.test(context)) return 'write';
  if (READ_VERBS.test(context)) return 'read';
  if (WRITE_VERBS.test(context)) return 'write';

  return 'unknown';
}

let raw = '';
process.stdin.on('data', c => raw += c);
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw);
    if (input.tool_name !== 'Agent') {
      process.stdout.write(JSON.stringify({ continue: true }));
      return;
    }

    const prompt = input.tool_input?.prompt || '';
    if (process.env.AGENT_ALLOW_MISSING_INPUTS === '1') {
      process.stdout.write(JSON.stringify({ continue: true }));
      return;
    }

    const home = os.homedir();
    const pathRe = /~\/[.\w\-\/]+\.\w+/g;
    const absRe = new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/[.\\w\\-/]+\\.\\w+', 'g');

    const seen = new Set();
    const missing = [];

    for (const re of [pathRe, absRe]) {
      let m;
      while ((m = re.exec(prompt)) !== null) {
        const p = m[0];
        if (seen.has(p)) continue;
        seen.add(p);

        const expanded = p.replace(/^~/, home);
        if (fs.existsSync(expanded)) continue;

        const intent = classifyPath(prompt, p, m.index);
        if (intent === 'write') continue;

        missing.push({ path: p, intent });
      }
    }

    if (missing.length > 0) {
      const readMissing = missing.filter(m => m.intent === 'read');
      const unknownMissing = missing.filter(m => m.intent === 'unknown');

      if (readMissing.length > 0) {
        const paths = readMissing.map(m => m.path).join(', ');
        process.stdout.write(JSON.stringify({
          decision: 'block',
          reason: `Agent needs ${readMissing.length} input file(s) that don't exist: ${paths}. Dispatch sequentially after the producing agent completes.`
        }));
        return;
      }

      if (unknownMissing.length > 0) {
        const paths = unknownMissing.map(m => m.path).join(', ');
        process.stdout.write(JSON.stringify({
          decision: 'block',
          reason: `Agent references ${unknownMissing.length} non-existent file(s) with unclear intent: ${paths}. Add write-intent context ("Write to ...", "Create ...") or set AGENT_ALLOW_MISSING_INPUTS=1 if creating them.`
        }));
        return;
      }
    }

    process.stdout.write(JSON.stringify({ continue: true }));
  } catch {
    process.stdout.write(JSON.stringify({ continue: true }));
  }
});
