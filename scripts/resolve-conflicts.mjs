#!/usr/bin/env node
// resolve-conflicts.mjs — resolve Syncthing .sync-conflict-* files in AI state dirs.
// Cross-platform (replaces .sh + .ps1; behavior unified).
//
// DRIFT FIXED: old .sh archived older to .sync-conflicts-archive/, supported --dry-run.
//              old .ps1 interactively prompted Y/N, deleted older.
// Unified flags:
//   --dry-run         show what would happen, don't modify
//   --delete          delete older instead of archive (matches old .ps1 behavior)
//   --interactive     prompt before resolving (matches old .ps1 behavior)
//
// Default: scan, archive older to .sync-conflicts-archive/, print summary.
// Roots: ~/.ai-context, ~/.claude, ~/.gemini + RESOLVE_EXTRA_ROOTS (PATH-style separator).

import { existsSync, statSync, mkdirSync, renameSync, unlinkSync, readdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, basename, dirname } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const DELETE = args.includes('--delete');
const INTERACTIVE = args.includes('--interactive');

const HOME = homedir();
const SEP = platform() === 'win32' ? ';' : ':';

const roots = [
  join(HOME, '.ai-context'),
  join(HOME, '.claude'),
  join(HOME, '.gemini'),
];
if (process.env.RESOLVE_EXTRA_ROOTS) {
  for (const r of process.env.RESOLVE_EXTRA_ROOTS.split(SEP)) {
    if (r) roots.push(r);
  }
}

// Recursive find of *.sync-conflict-* files
function* findConflicts(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name === '.git' || e.name === 'node_modules' || e.name === '.sync-conflicts-archive') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* findConflicts(p);
    else if (e.isFile() && e.name.includes('.sync-conflict-')) yield p;
  }
}

function originalName(conflict) {
  // foo.sync-conflict-20260409-095352-XJJK2UB.json → foo.json
  return conflict.replace(/\.sync-conflict-\d{8}-\d{6}-[A-Z0-9]+/, '');
}

function findRoot(p) {
  for (const r of roots) {
    if (p.startsWith(r + (platform() === 'win32' ? '\\' : '/'))) return r;
  }
  return dirname(p);
}

const conflicts = [];
for (const root of roots) {
  if (!existsSync(root)) continue;
  for (const c of findConflicts(root)) conflicts.push(c);
}

if (conflicts.length === 0) {
  console.log('No Syncthing conflicts found.');
  process.exit(0);
}

console.log(`Found ${conflicts.length} conflict file(s):`);
for (const c of conflicts) console.log(`  ${c}`);
console.log();

if (INTERACTIVE) {
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question('Resolve by keeping NEWEST file? (y/N): ');
  rl.close();
  if (!['y', 'Y', 'yes', 'YES'].includes(answer.trim())) {
    console.log('Aborted.');
    process.exit(0);
  }
}

let total = 0, kept = 0, archived = 0, deleted = 0;
for (const conflict of conflicts) {
  if (!existsSync(conflict)) continue;
  total++;

  const orig = originalName(conflict);
  if (!existsSync(orig)) {
    if (!DRY) renameSync(conflict, orig);
    console.log(`  ? promoted (no original): ${conflict}`);
    kept++;
    continue;
  }

  const origMt = statSync(orig).mtimeMs;
  const confMt = statSync(conflict).mtimeMs;
  const root = findRoot(conflict);
  const arcDir = join(root, '.sync-conflicts-archive');

  if (confMt > origMt) {
    // Conflict is newer — promote it
    console.log(`+ ${conflict} is NEWER than ${orig}`);
    if (!DRY) {
      if (DELETE) {
        unlinkSync(orig);
      } else {
        mkdirSync(arcDir, { recursive: true });
        renameSync(orig, join(arcDir, basename(orig) + `.older.${Math.floor(origMt / 1000)}`));
      }
      renameSync(conflict, orig);
    }
    kept++;
  } else {
    // Original is newer — drop conflict
    if (DELETE) {
      console.log(`- deleting older conflict: ${conflict}`);
      if (!DRY) unlinkSync(conflict);
      deleted++;
    } else {
      console.log(`- archiving older: ${conflict}`);
      if (!DRY) {
        mkdirSync(arcDir, { recursive: true });
        renameSync(conflict, join(arcDir, basename(conflict)));
      }
      archived++;
    }
  }
}

console.log();
console.log('═══ summary ═══');
console.log(`  total conflicts found: ${total}`);
console.log(`  conflict promoted (newer): ${kept}`);
console.log(`  conflict archived (older): ${archived}`);
if (deleted > 0) console.log(`  conflict deleted (older, --delete): ${deleted}`);
if (DRY) console.log('  (DRY RUN — no changes made)');
