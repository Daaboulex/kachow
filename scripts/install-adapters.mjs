#!/usr/bin/env node
// Install / verify AGENTS.md symlinks for every supported AI tool.
// Idempotent — safe to re-run.
//
// Canonical source: $AI_CONTEXT/AGENTS.md (defaults: env $AI_CONTEXT → parent
// of this script's dir → $HOME/.ai-context). The same resolution order the
// PowerShell version uses, now available on every OS.
//
// Symlink strategy:
//   Linux / macOS — always fs.symlinkSync.
//   Windows       — tries fs.symlinkSync ('file' type). If that fails (no
//                   Developer Mode + not elevated), falls back to copy mode
//                   and prints the Dev Mode fix.
//
// Hidden drift from the .sh / .ps1 originals (both preserved in .mjs):
//   - sh defaulted AI_CONTEXT to $HOME/.ai-context only; ps1 also fell back
//     to the script's parent. This .mjs uses the ps1 resolution everywhere.
//   - sh had no copy fallback; ps1 did. This .mjs keeps the copy fallback
//     (never applies on POSIX — symlinks always succeed there).

'use strict';

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const HOME       = os.homedir();

const AI_CONTEXT =
  process.env.AI_CONTEXT
  || path.dirname(__dirname) // parent of scripts/ → canonical dir
  || path.join(HOME, '.ai-context');
const CANONICAL = path.join(AI_CONTEXT, 'AGENTS.md');

if (!fs.existsSync(CANONICAL)) {
  console.error(`ERROR: canonical source missing at ${CANONICAL}`);
  process.exit(1);
}

const CORE_TARGETS = [
  { label: 'claude',   dest: path.join(HOME, '.claude',          'CLAUDE.md') },
  { label: 'gemini',   dest: path.join(HOME, '.gemini',          'GEMINI.md') },
  { label: 'codex',    dest: path.join(HOME, '.codex',           'AGENTS.md') },
  { label: 'opencode', dest: path.join(HOME, '.config/opencode', 'AGENTS.md') },
  { label: 'aider',    dest: path.join(HOME, '.config/aider',    'AGENTS.md') },
];

const OPTIONAL_TARGETS = [
  { label: 'windsurf-global',
    dest: path.join(HOME, '.codeium/windsurf/memories', 'global_rules.md') },
];

const isWindows = process.platform === 'win32';

/** Detect whether we can create symlinks. Always true on POSIX; on Windows
 *  requires Developer Mode or admin. Returns 'symlink' or 'copy'. */
function probeSymlinkCapability() {
  if (!isWindows) return 'symlink';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-ctx-probe-'));
  try {
    const target = path.join(tmp, 'target.txt');
    fs.writeFileSync(target, 'x');
    const link = path.join(tmp, 'link.txt');
    try {
      fs.symlinkSync(target, link, 'file');
      return 'symlink';
    } catch {
      return 'copy';
    }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

const MODE = probeSymlinkCapability();
if (MODE === 'copy') {
  console.log('');
  console.log('⚠ Developer Mode not enabled (or not running elevated).');
  console.log('  Falling back to COPY mode: AGENTS.md is duplicated into each tool\'s dir.');
  console.log('  Downside: you must re-run this script after every canonical edit.');
  console.log('  Fix: Settings → Privacy & security → For developers → enable Developer Mode.');
  console.log('');
}

function install({ label, dest }) {
  const dir = path.dirname(dest);
  fs.mkdirSync(dir, { recursive: true });

  // HARD GUARD: never create a symlink to a non-existent target.
  if (!fs.existsSync(CANONICAL)) {
    console.error(`✗ ${label}: REFUSING — target does not exist: ${CANONICAL}`);
    return false;
  }

  let existing;
  try { existing = fs.lstatSync(dest); } catch { existing = null; }

  if (existing) {
    if (existing.isSymbolicLink()) {
      const current = fs.readlinkSync(dest);
      if (current === CANONICAL) {
        console.log(`✓ ${label}: already linked → ${CANONICAL}`);
        return true;
      }
      console.log(`↻ ${label}: replacing stale symlink (${current} → ${CANONICAL})`);
      fs.unlinkSync(dest);
    } else {
      const bak = `${dest}.pre-ai-context-bak-${Math.floor(Date.now() / 1000)}`;
      console.log(`↻ ${label}: backing up existing file to ${path.basename(bak)}`);
      fs.renameSync(dest, bak);
    }
  }

  if (MODE === 'symlink') {
    fs.symlinkSync(CANONICAL, dest, 'file');
    if (!fs.existsSync(dest)) {
      console.error(`✗ ${label}: SYMLINK CREATED BUT BROKEN — target resolved to nothing: ${dest}`);
      return false;
    }
    console.log(`+ ${label}: linked → ${CANONICAL}`);
  } else {
    fs.copyFileSync(CANONICAL, dest);
    console.log(`+ ${label}: copied from ${CANONICAL}  (COPY MODE — re-run this script after edits)`);
  }
  return true;
}

console.log('== Core AI tools ==');
for (const t of CORE_TARGETS) install(t);

console.log('');
console.log('== Optional tools (linked if dir exists) ==');
for (const t of OPTIONAL_TARGETS) {
  if (fs.existsSync(path.dirname(t.dest))) {
    install(t);
  } else {
    console.log(`- ${t.label}: skipped (dir not present: ${path.dirname(t.dest)})`);
  }
}

console.log('');
console.log(`Done. Edit ${CANONICAL} and every tool picks up the change.`);
