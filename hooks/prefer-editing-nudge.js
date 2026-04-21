#!/usr/bin/env node
// PreToolUse hook: nudge when Write creates a new file that could logically be an Edit.
// Enforces CLAUDE.md: "Prefer editing existing files over creating new ones."
//
// Triggers only if target file path:
//   - Does NOT exist (new file)
//   - Has a "neighbour" with the same stem in the same directory
//     (e.g. writing foo-v2.ts when foo.ts exists; writing auth_helper.py when auth.py exists)
//   - AND path is not in obvious .gitignored / generated areas
//
// Output: passthrough + systemMessage suggesting consolidation. Never blocks.
//
// Disable: SKIP_PREFER_EDIT=1

const fs = require('fs');
const path = require('path');

function passthrough() {
  process.stdout.write('{"continue":true}');
  process.exit(0);
}

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '__pycache__', '.venv', 'venv',
  'target', '.next', '.turbo', '.cache', 'coverage', '.pio', '.stversions',
]);
const IGNORE_SUFFIX_RE = /\.(lock|map|min\.js|d\.ts|generated\.(ts|js|py))$/i;

try {
  if (process.env.SKIP_PREFER_EDIT === '1') passthrough();

  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }
  const input = JSON.parse(raw || '{}');

  const toolName = input.tool_name || '';
  if (!/^(Write|write_file)$/.test(toolName)) passthrough();

  const filePath = (input.tool_input && (input.tool_input.file_path || input.tool_input.absolute_path)) || '';
  if (!filePath) passthrough();

  // Skip if file already exists (Write overwrite case — not our concern)
  try { if (fs.existsSync(filePath)) passthrough(); } catch { passthrough(); }

  // Skip ignored dirs + suffixes
  const parts = filePath.split(path.sep);
  if (parts.some(p => IGNORE_DIRS.has(p))) passthrough();
  if (IGNORE_SUFFIX_RE.test(filePath)) passthrough();

  const dir = path.dirname(filePath);
  const baseName = path.basename(filePath);
  const ext = path.extname(baseName);
  const stem = baseName.slice(0, baseName.length - ext.length);
  if (!stem) passthrough();

  // Candidate neighbours: same dir, same extension, similar stem
  let neighbours;
  try { neighbours = fs.readdirSync(dir); } catch { passthrough(); }

  // Normalize stem for comparison — drop trailing version/qualifier tokens
  const normStem = stem.toLowerCase().replace(/[-_](v\d+|new|old|copy|backup|helper|utils?|final)$/, '');
  if (!normStem || normStem.length < 3) passthrough();

  const matches = [];
  for (const n of neighbours) {
    if (n === baseName) continue;
    if (path.extname(n) !== ext) continue;
    const nStem = n.slice(0, n.length - ext.length).toLowerCase();
    // Match if: neighbour stem equals normalized stem, or one contains the other
    if (nStem === normStem || nStem.includes(normStem) || normStem.includes(nStem)) {
      matches.push(n);
    }
  }

  if (matches.length === 0) passthrough();

  const msg = `[prefer-editing] Creating \`${baseName}\` — similar file(s) already exist in the same dir: ${matches.slice(0,3).join(', ')}${matches.length>3?` (+${matches.length-3})`:''}. Per CLAUDE.md: prefer editing existing files over creating new ones. If the new file is genuinely separate (different concern / different API surface), proceed. If it's a variant (foo-v2, foo-new, foo-helper), consider editing the original or merging.`;
  process.stdout.write(JSON.stringify({ continue: true, systemMessage: msg }));
  process.exit(0);
} catch {
  passthrough();
}
