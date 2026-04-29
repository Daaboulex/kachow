#!/usr/bin/env node
// scrub-check.mjs — Pre-push gate for kachow public repo.
// Scans for personal tokens (ident, project names, paths, emails) outside
// permitted doc files. Cross-platform port of scrub-check.sh (Wave G 2026-04-29).
//
// Usage:
//   node scripts/scrub-check.mjs            # scan + report hits (exit 1 if any)
//   node scripts/scrub-check.mjs --quiet    # no banner; output only hits
//   node scripts/scrub-check.mjs --list     # show token list (no repo scan)
//
// Designed to be callable from pre-push git hook + CI.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const QUIET = args.includes('--quiet') || args.includes('-q');
const LIST_ONLY = args.includes('--list');
const HELP = args.includes('--help') || args.includes('-h');

if (HELP) {
  console.log('scrub-check.mjs — Pre-push gate for kachow public repo.');
  console.log('Scans for personal tokens (ident, project names, paths, emails) outside');
  console.log('permitted doc files. Matches CI scrub-gate behavior.');
  console.log('');
  console.log('Usage:');
  console.log('  node scripts/scrub-check.mjs            # scan + report hits (exit 1 if any)');
  console.log('  node scripts/scrub-check.mjs --quiet    # no banner; output only hits');
  console.log('  node scripts/scrub-check.mjs --list     # show token list');
  process.exit(0);
}

// Assemble tokens from parts so this file itself doesn't match.
// Split assembly: each part holds substrings that JOIN to make the literal.
function asm(...parts) { return parts.join(''); }
const tokens = [
  asm('f','a','h','l','k','e'),                                                       // ident-lower
  asm('F','a','h','l','k','e'),                                                       // ident-cap
  asm('D','a','a','b','o','u','l','e','x'),                                           // ident2
  asm('P','o','r','t','a','b','l','e','-','B','u','i','l','d','e','r'),               // proj
  asm('/','h','o','m','e','/','u','s','e','r'),                                       // abs-home linux
  asm('/','U','s','e','r','s','/'),                                                   // abs-home macOS prefix
  asm('k','i','p','p','e','r','_','e','l','i','x','i','r','s'),                       // email-local
  asm('m','a','c','b','o','o','k','-','p','r','o','-','9','-','2'),                   // host1
  asm('r','y','z','e','n','-','9','9','5','0','x','3','d'),                           // host2
  asm('F','C','S','E','0','1'),                                                       // host3
  asm('L','a','C','i','e'),                                                           // drive brand
  asm('S','t','e','p','h','a','n'),                                                   // other-name
  // Domain-structure tokens — word-boundary anchored.
  '\\b' + asm('A','c','t','u','a','t','o','r') + '\\b',
  '\\b' + asm('V','a','l','v','e','L','o','g','i','c') + '\\b',
  '\\b' + asm('S','a','f','e','t','y','T','i','m','e','r') + '\\b',
  '\\b' + asm('E','E','P','R','O','M','_','C','o','n','t','r','o','l') + '\\b',
  '\\b' + asm('l','p','c','4','3','x','x') + '\\b',
  asm('M','o','d','b','u','s','-','R','T','U','-','p','s','t'),
];

if (LIST_ONLY) {
  console.log('Token list (assembled from parts):');
  for (const t of tokens) console.log('  ' + t);
  process.exit(0);
}

const PATTERN = new RegExp(tokens.join('|'));
const SECRET_PATTERN = new RegExp(
  '(-----BEGIN (OPENSSH|RSA|DSA|EC|PGP) PRIVATE KEY-----|' +
  '\\bsk-ant-[a-z0-9-]{10,}|' +
  '\\bghp_[A-Za-z0-9]{30,}|\\bgho_[A-Za-z0-9]{30,}|\\bghs_[A-Za-z0-9]{30,}|' +
  '\\bAKIA[0-9A-Z]{16}\\b|' +
  '\\beyJ[A-Za-z0-9_-]{10,}\\.eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\b)'
);

const SCAN_EXTS = new Set([
  '.md', '.js', '.mjs', '.json', '.sh', '.ps1', '.yml', '.yaml',
  '.toml', '.nix', '.txt', '.env',
]);

// Doc-context allowlist — these files legitimately reference identity tokens
// (README/LICENSE/CHANGELOG/etc). Match exactly the bash version's exclusions.
const CONTENT_ALLOWLIST_PATHS = new Set([
  './README.md',
  './LICENSE',
  './CONTRIBUTING.md',
  './SECURITY.md',
  './CHANGELOG.md',
  './.github/workflows/ci.yml',
  './scripts/scrub-check.sh',
  './scripts/scrub-check.mjs',
]);

const SECRET_ALLOWLIST_PATHS = new Set([
  './hooks/scrub-sentinel.js',
  './scripts/scrub-check.sh',
  './scripts/scrub-check.mjs',
]);

// Find repo root: parent of scripts/ dir
const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = dirname(dirname(__filename));
process.chdir(REPO_ROOT);

if (!QUIET) console.log(`=== scrub-check: ${REPO_ROOT} ===`);

const contentHits = [];
const filenameHits = [];
const secretHits = [];

function walk(dir) {
  const rel = relative(REPO_ROOT, dir);
  // Prune .git and docs directory (matches bash version's grep -v)
  if (rel === '.git' || rel === 'docs' || rel.startsWith('.git/') || rel.startsWith('docs/')) return;
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      if (name === '.git' || name === 'docs' || name === 'node_modules') continue;
      walk(full);
    } else if (st.isFile()) {
      const relFile = './' + relative(REPO_ROOT, full).replace(/\\/g, '/');
      // Filename leak check — applies to ALL files (no extension filter)
      if (PATTERN.test(relFile)) filenameHits.push(relFile);
      // Content scan — only for whitelisted extensions
      const ext = name.match(/\.[^.]+$/)?.[0]?.toLowerCase();
      if (!ext || !SCAN_EXTS.has(ext)) continue;
      // Doc-context allowlist for content scan
      const skipContent = CONTENT_ALLOWLIST_PATHS.has(relFile) || /\.example\b/.test(relFile);
      const skipSecret = SECRET_ALLOWLIST_PATHS.has(relFile);
      let content;
      try { content = readFileSync(full, 'utf8'); } catch { continue; }
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!skipContent && PATTERN.test(line)) {
          contentHits.push(`${relFile}:${i + 1}:${line}`);
        }
        if (!skipSecret && SECRET_PATTERN.test(line)) {
          secretHits.push(`${relFile}:${i + 1}:${line}`);
        }
      }
    }
  }
}

walk(REPO_ROOT);

const anyHit = contentHits.length || filenameHits.length || secretHits.length;

if (anyHit) {
  if (contentHits.length) {
    console.log('⚠ personal tokens in file content:');
    for (const h of contentHits) console.log(h);
  }
  if (filenameHits.length) {
    console.log('⚠ personal tokens in filenames:');
    for (const h of filenameHits) console.log(h);
  }
  if (secretHits.length) {
    console.log('⚠ credential/secret patterns:');
    for (const h of secretHits) console.log(h);
  }
  process.exit(1);
}

if (!QUIET) console.log('✓ scrub-check clean (content + filename + secret)');
process.exit(0);
