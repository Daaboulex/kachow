#!/usr/bin/env node
// uninstall.mjs — Remove everything kachow installed, leaving AI configs intact.
//
// Uses the install manifest to delete only what was created.
// Does NOT touch personal ~/.claude/memory or ~/.gemini/memory files.
// Does NOT remove the canonical source (~/.ai-context).
//
// Usage:
//   node scripts/uninstall.mjs         # dry-run — shows what would be removed
//   node scripts/uninstall.mjs --yes   # actually remove
//
// Replaces uninstall.sh (Wave 7A.1 of MASTER cleanup 2026-04-29).
// Cross-platform.

import { existsSync, readFileSync, lstatSync, unlinkSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();
const AI_CONTEXT = process.env.AI_CONTEXT || join(HOME, '.ai-context');
const MANIFEST = join(AI_CONTEXT, '.install-manifest');
const DO_DELETE = process.argv.includes('--yes') || process.argv.includes('-y');

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('uninstall.mjs — Remove kachow-installed files (manifest-driven)');
  console.log('');
  console.log('Usage:');
  console.log('  node scripts/uninstall.mjs         # dry-run');
  console.log('  node scripts/uninstall.mjs --yes   # actually delete');
  process.exit(0);
}

if (!existsSync(MANIFEST)) {
  console.log(`No install manifest found at ${MANIFEST} — nothing to uninstall, or install ran before manifest support.`);
  console.log('Fallback — manually remove common install targets:');
  console.log('  ~/.claude/hooks  ~/.gemini/hooks');
  console.log('  ~/.claude/commands  ~/.gemini/commands');
  console.log('  ~/.claude/CLAUDE.md (if symlink into AI_CONTEXT)');
  console.log('  ~/.gemini/GEMINI.md (if symlink)');
  console.log('  ~/.codex/AGENTS.md ~/.config/opencode/AGENTS.md ~/.config/aider/AGENTS.md');
  process.exit(0);
}

console.log('=== kachow uninstall ===');
if (!DO_DELETE) console.log('DRY RUN — re-run with --yes to actually delete');
console.log('');

const lines = readFileSync(MANIFEST, 'utf8').split('\n');
let removed = 0;
let skipped = 0;

for (const raw of lines) {
  const line = raw.trim();
  if (line === '' || line.startsWith('#')) continue;
  let exists = false;
  try {
    lstatSync(line);
    exists = true;
  } catch { exists = false; }

  if (!exists) {
    skipped++;
    continue;
  }

  if (DO_DELETE) {
    try {
      unlinkSync(line);
      removed++;
      console.log(`  ✗ ${line}`);
    } catch (e) {
      console.log(`  ! could not remove ${line}: ${e.message}`);
    }
  } else {
    console.log(`  WOULD-DELETE ${line}`);
  }
}

// Sweep broken symlinks in common install targets (manifest-drift defense)
if (DO_DELETE) {
  const sweepDirs = [
    join(HOME, '.claude'), join(HOME, '.gemini'), join(HOME, '.codex'),
    join(HOME, '.config', 'opencode'), join(HOME, '.config', 'aider'),
    join(HOME, '.cursor'), join(HOME, '.continue'), join(HOME, '.codeium'),
  ];
  for (const base of sweepDirs) {
    if (!existsSync(base)) continue;
    sweepBrokenSymlinks(base, 4);
  }
}

console.log('');
if (DO_DELETE) {
  try { unlinkSync(MANIFEST); } catch {}
  console.log(`Removed ${removed} file(s). Skipped ${skipped} already-gone entries.`);
  console.log('');
  console.log(`The canonical source at ${AI_CONTEXT} is untouched. Remove it manually if desired:`);
  console.log(`  rm -rf ${AI_CONTEXT}`);
} else {
  console.log('Dry-run complete. Run with --yes to actually delete.');
}

function sweepBrokenSymlinks(dir, maxDepth, depth = 0) {
  if (depth > maxDepth) return;
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    const full = join(dir, name);
    let lst;
    try { lst = lstatSync(full); } catch { continue; }
    if (lst.isSymbolicLink()) {
      try { statSync(full); } catch {
        // symlink target gone — broken
        try { unlinkSync(full); console.log(`  ✗ (dangling) ${full}`); } catch {}
      }
    } else if (lst.isDirectory()) {
      sweepBrokenSymlinks(full, maxDepth, depth + 1);
    }
  }
}
