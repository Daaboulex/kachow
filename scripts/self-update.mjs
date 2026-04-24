#!/usr/bin/env node
// self-update.mjs — pull latest from upstream, preserve USER SECTION, re-bootstrap.
//
// Safe for users maintaining a fork:
//   1. Fetch origin + show incoming commits
//   2. Verify working tree clean (aborts if dirty)
//   3. Capture AGENTS.md USER SECTION block
//   4. Merge (fast-forward) or rebase
//   5. Re-inject USER SECTION if the merge changed AGENTS.md
//   6. Re-run bootstrap.mjs so new hooks / adapters are wired in
//   7. Print CHANGELOG entries added by the merge
//
// Usage:
//   node self-update.mjs                    # fetch + merge + bootstrap
//   node self-update.mjs --dry-run          # show incoming only
//   node self-update.mjs --rebase           # rebase instead of merge
//   node self-update.mjs --no-bootstrap     # merge but skip re-bootstrap
//
// Exit: 0 up-to-date / success; 1 dirty tree or merge conflict; 2 bad args.
//
// Hidden drift fixed:
//   - sh printed a CHANGELOG.md diff at the end; ps1 did not.
//   - USER-SECTION handling used awk in sh vs .NET regex in ps1; now
//     one JavaScript regex handles both.
//   - sh called bootstrap.sh; ps1 called bootstrap.ps1. Now both call
//     bootstrap.mjs directly.

'use strict';

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import cp from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const HOME       = os.homedir();
const AI_CONTEXT =
  process.env.AI_CONTEXT
  || path.dirname(__dirname)
  || path.join(HOME, '.ai-context');

// ── args ────────────────────────────────────────────────────────────
let DRY = false, REBASE = false, BOOTSTRAP = true;
for (const a of process.argv.slice(2)) {
  if (a === '--dry-run')         DRY = true;
  else if (a === '--rebase')     REBASE = true;
  else if (a === '--no-bootstrap') BOOTSTRAP = false;
  else if (a === '-h' || a === '--help') {
    const src = fs.readFileSync(__filename, 'utf8').split('\n');
    console.log(src.slice(1, 20).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    process.exit(0);
  } else {
    console.error(`unknown arg: ${a}`);
    process.exit(2);
  }
}

function git(args, opts = {}) {
  const r = cp.spawnSync('git', ['-C', AI_CONTEXT, ...args], { encoding: 'utf8', ...opts });
  return { code: r.status ?? 1, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

if (!fs.existsSync(path.join(AI_CONTEXT, '.git'))) {
  console.error(`ERROR: ${AI_CONTEXT} is not a git repo.`);
  process.exit(1);
}

console.log(`── self-update: ${AI_CONTEXT} ──`);
console.log('');

// ── 1. Fetch + show incoming ────────────────────────────────────────
const fetchR = cp.spawnSync('git', ['-C', AI_CONTEXT, 'fetch', 'origin', '--tags'], { encoding: 'utf8' });
(fetchR.stderr || '').split('\n').filter(Boolean).forEach((l) => console.log('  ' + l));

let branch = git(['branch', '--show-current']).stdout;
if (!branch) branch = 'main';
const upstream = `origin/${branch}`;

if (git(['rev-parse', upstream]).code !== 0) {
  console.error(`ERROR: no ${upstream} branch on origin — set remote first.`);
  process.exit(1);
}

const ahead  = parseInt(git(['rev-list', '--count', `${upstream}..${branch}`]).stdout, 10);
const behind = parseInt(git(['rev-list', '--count', `${branch}..${upstream}`]).stdout, 10);

if (behind === 0) {
  console.log(`✓ already up to date (local=${branch} upstream=${upstream})`);
  if (ahead > 0) console.log(`  note: you have ${ahead} local commits not on upstream`);
  process.exit(0);
}

console.log(`incoming: ${behind} commit(s) on ${upstream}`);
console.log(`your local: ${ahead} commit(s) ahead`);
console.log('');
console.log('── changelog since your HEAD ──');
const logLines = git(['log', '--oneline', '--no-decorate', `${branch}..${upstream}`]).stdout.split('\n').slice(0, 20);
logLines.forEach((l) => console.log(l));
console.log('');

if (DRY) { console.log('(dry-run — nothing written)'); process.exit(0); }

// ── 2. Working tree clean check ─────────────────────────────────────
const dirty = git(['status', '--porcelain']).stdout;
if (dirty) {
  console.error('✗ working tree has uncommitted changes — commit or stash them, then re-run.');
  console.error('  (refusing to auto-merge into a dirty tree)');
  process.exit(1);
}

// ── 3. Capture AGENTS.md USER SECTION ───────────────────────────────
const agentsPath = path.join(AI_CONTEXT, 'AGENTS.md');
const USER_SECTION_RE =
  /USER SECTION — keep[\s\S]*?-->([\s\S]*?)<!-- END USER SECTION/;

let userSection = null;
if (fs.existsSync(agentsPath)) {
  const agents = fs.readFileSync(agentsPath, 'utf8');
  const m = agents.match(USER_SECTION_RE);
  if (m) {
    userSection = m[1].trim();
    const lineCount = userSection ? userSection.split('\n').length : 0;
    console.log(`✓ captured USER SECTION (${lineCount} line(s))`);
  }
}

// ── 4. Merge or rebase ──────────────────────────────────────────────
if (REBASE) {
  console.log(`── rebasing onto ${upstream} ──`);
  const r = cp.spawnSync('git', ['-C', AI_CONTEXT, 'rebase', upstream], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('✗ rebase failed — resolve conflicts, then \'git rebase --continue\' or \'--abort\'');
    process.exit(1);
  }
} else {
  console.log(`── merging ${upstream} ──`);
  const r = cp.spawnSync('git', ['-C', AI_CONTEXT, 'merge', '--ff', '--no-edit', upstream], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('✗ merge failed — resolve conflicts manually, then re-run bootstrap');
    process.exit(1);
  }
}

// ── 5. Re-inject USER SECTION if AGENTS.md changed ──────────────────
if (userSection !== null && fs.existsSync(agentsPath)) {
  const after = fs.readFileSync(agentsPath, 'utf8');
  const replaced = after.replace(
    USER_SECTION_RE,
    (_, _inner, _offset, _full) =>
      `USER SECTION — keep your edits here; framework updates preserve this block -->\n\n${userSection}\n\n<!-- END USER SECTION`
  );
  if (replaced !== after) {
    fs.writeFileSync(agentsPath, replaced);
    git(['add', 'AGENTS.md']);
    const ci = cp.spawnSync('git', [
      '-C', AI_CONTEXT,
      '-c', 'user.email=self-update@localhost',
      '-c', 'user.name=self-update',
      'commit', '--no-gpg-sign', '-q',
      '-m', 'chore: restore USER SECTION after self-update',
    ], { encoding: 'utf8' });
    if (ci.status === 0) console.log('✓ USER SECTION restored');
    else console.log('⚠ USER SECTION reinject committed with warnings');
  } else {
    console.log('✓ USER SECTION unchanged after merge');
  }
}

// ── 6. Re-run bootstrap ─────────────────────────────────────────────
if (BOOTSTRAP) {
  console.log('');
  console.log('── re-running bootstrap.mjs ──');
  const r = cp.spawnSync('node', [path.join(AI_CONTEXT, 'scripts', 'bootstrap.mjs')], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`✗ bootstrap failed (exit ${r.status})`);
    process.exit(r.status || 1);
  }
}

// ── 7. CHANGELOG diff ───────────────────────────────────────────────
console.log('');
console.log('── CHANGELOG entries added ──');
if (fs.existsSync(path.join(AI_CONTEXT, 'CHANGELOG.md'))) {
  const logP = cp.spawnSync('git',
    ['-C', AI_CONTEXT, 'log', '-p', `${branch}@{1}..${branch}`, '--', 'CHANGELOG.md'],
    { encoding: 'utf8' });
  const added = (logP.stdout || '')
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .slice(0, 30);
  if (added.length) added.forEach((l) => console.log(l));
  else console.log('  (no CHANGELOG changes)');
}

console.log('');
const head = git(['log', '-1', '--format=%h %s']).stdout;
console.log(`✓ self-update complete — now at ${head}`);
