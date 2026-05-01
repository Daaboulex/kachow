#!/usr/bin/env node
// spec-graph-lint.mjs — Discovery D6.
// Scans all specs in ~/.ai-context/.superpowers/specs/ for cross-references
// matching 2026-MM-DD-*.md pattern. Reports any dangling references (cited
// doc does not exist in any sibling .superpowers/ directory).
// Search dirs: specs/, plans/, reports/, archive/ (cross-ref resolution).

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const SP_ROOT = join(homedir(), '.ai-context', '.superpowers');
const SPEC_DIR = join(SP_ROOT, 'specs');
// Resolve refs against active dirs first, then archive subdirs.
const SEARCH_DIRS = [
  join(SP_ROOT, 'specs'),
  join(SP_ROOT, 'plans'),
  join(SP_ROOT, 'reports'),
  join(SP_ROOT, 'archive'),                // top-level archive (legacy)
  join(SP_ROOT, 'specs', 'archive'),       // current archive location
  join(SP_ROOT, 'plans', 'archive'),
  join(SP_ROOT, 'reports', 'archive'),
].filter(existsSync);
const REF_RE = /2026-[0-9]{2}-[0-9]{2}-[A-Za-z0-9_.-]+\.md/g;

function refExistsAnywhere(refName) {
  return SEARCH_DIRS.some(d => existsSync(join(d, refName)));
}

let dangling = 0;
let total = 0;
const files = readdirSync(SPEC_DIR).filter(f => f.endsWith('.md'));

for (const f of files) {
  const fullPath = join(SPEC_DIR, f);
  const text = readFileSync(fullPath, 'utf8');
  const refs = Array.from(new Set(text.match(REF_RE) || []));
  for (const r of refs) {
    if (r === f) continue;
    total += 1;
    if (!refExistsAnywhere(r)) {
      console.log(`DANGLING: ${f} → ${r}`);
      dangling += 1;
    }
  }
}

console.log(`\nScanned ${files.length} specs against ${SEARCH_DIRS.length} dirs (${SEARCH_DIRS.map(d=>d.split('/').pop()).join(',')}), ${total} cross-references, ${dangling} dangling.`);
process.exit(dangling > 0 ? 1 : 0);
