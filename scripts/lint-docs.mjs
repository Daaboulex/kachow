#!/usr/bin/env node
// lint-docs.mjs — detect stale references in docs and AGENTS.md
// Checks for hardcoded counts, removed scripts, wrong paths, etc.
// Run: node scripts/lint-docs.mjs

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PASS = '  PASS';
const FAIL = '  FAIL';
const WARN = '  WARN';
let failures = 0;

function lint(label, condition, detail = '') {
  if (condition) {
    console.log(`${PASS}: ${label}`);
  } else {
    console.log(`${FAIL}: ${label}${detail ? ' — ' + detail : ''}`);
    failures++;
  }
}

// Count actual hooks in MANIFEST
const manifest = readFileSync(join(ROOT, 'modules/hooks/MANIFEST.yaml'), 'utf8');
const hookCount = [...manifest.matchAll(/- file:\s*\S+\.js/g)].length;
const hookSrcCount = readdirSync(join(ROOT, 'modules/hooks/src'))
  .filter(f => f.endsWith('.js')).length;

// Count actual scripts
const scripts = readdirSync(join(ROOT, 'scripts'))
  .filter(f => f.endsWith('.mjs') || f.endsWith('.sh'));

// Docs to check
const docsToCheck = [
  'AGENTS.md',
  'docs/architecture.md',
  'docs/hooks.md',
  'docs/contributing.md',
  'docs/per-cli-quirks.md',
  'docs/onboarding.md',
  'docs/self-improvement.md',
  'scripts/publish-assets/README.md',
  'scripts/publish-assets/docs/HOOKS.md',
  'scripts/publish-assets/docs/ARCHITECTURE.md',
];

console.log('Doc Lint — detecting stale references\n');
console.log(`Actual hook count: ${hookCount} (MANIFEST), ${hookSrcCount} (src files)`);
console.log('');

for (const docPath of docsToCheck) {
  const fullPath = join(ROOT, docPath);
  if (!existsSync(fullPath)) continue;

  const content = readFileSync(fullPath, 'utf8');
  const name = docPath;

  console.log(`── ${name} ──`);

  // Check for wrong hook counts (allow per-tool counts: 15 total, 13 for Pi)
  const validCounts = new Set([hookCount, hookSrcCount, 13, 14]); // Pi=13, Claude-only excluded=14
  const hookCountRefs = [...content.matchAll(/(\d+)\s*(?:registered\s+)?hooks/gi)];
  for (const m of hookCountRefs) {
    const mentioned = parseInt(m[1]);
    if (mentioned > 0 && !validCounts.has(mentioned)) {
      lint(`hook count`, false, `says "${m[0]}" but valid counts are ${[...validCounts].join('/')}`);
    }
  }

  // Check for references to non-existent scripts
  const scriptRefs = [...content.matchAll(/scripts\/([a-z0-9_-]+\.(?:mjs|sh|js))/g)];
  for (const m of scriptRefs) {
    const scriptPath = join(ROOT, 'scripts', m[1]);
    lint(`script ref: ${m[1]}`, existsSync(scriptPath));
  }

  // Check for stale tool references
  for (const stale of ['Crush', 'OpenCode', 'Aider', 'Cursor']) {
    if (content.includes(stale) && !content.includes(`# ${stale}`)) {
      lint(`no stale tool ref: ${stale}`, false, `found "${stale}" reference`);
    }
  }

  // Check for v1 path references
  for (const v1Path of ['verify-v2', 'hooks/lib/hook-selftest', 'install-adapters.sh', 'bootstrap.sh', 'customize.sh']) {
    if (content.includes(v1Path)) {
      lint(`no v1 path: ${v1Path}`, false);
    }
  }

  // Check for hardcoded $HOME (except in examples and path-resolution docs)
  const homeLines = content.split('\n').filter(l =>
    l.includes('$HOME') && !l.includes('NOT') && !l.includes('Not') &&
    !l.includes('never') && !l.includes('Never') && !l.includes('|')
  );
  if (homeLines.length > 0 && !docPath.includes('publish-assets')) {
    lint(`no hardcoded $HOME`, false, `${homeLines.length} occurrences`);
  }

  // Check date is current year
  const dateMatch = content.match(/last.?updated.*?(\d{4})/i);
  if (dateMatch && parseInt(dateMatch[1]) < 2026) {
    lint(`date is current`, false, `says ${dateMatch[1]}`);
  }

  console.log('');
}

console.log(`── SUMMARY ──`);
console.log(`${failures} issues found`);
process.exit(failures > 0 ? 1 : 0);
