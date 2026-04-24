#!/usr/bin/env node
// setup-private-remote.mjs — add a private git remote for ~/.ai-context/.
// Cross-platform (replaces .sh + .ps1; behavior unified).
//
// Two modes:
//   No args         → print hints (5 common remote options) and current state
//   --url <git-url> → idempotently set origin and push -u
//
// Env: AI_CONTEXT (override path; defaults to ~/.ai-context)

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const aiDir = process.env.AI_CONTEXT || join(__dirname, '..') || join(homedir(), '.ai-context');

function git(args, opts = {}) {
  return spawnSync('git', args, { cwd: aiDir, stdio: opts.stdio ?? 'pipe', encoding: 'utf8' });
}

function gitInherit(args) {
  return spawnSync('git', args, { cwd: aiDir, stdio: 'inherit' });
}

function parseArgs(argv) {
  const out = { url: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url' && argv[i + 1]) { out.url = argv[++i]; }
    else if (a === '-h' || a === '--help') { out.help = true; }
    else if (!out.url && !a.startsWith('-')) { out.url = a; }
  }
  return out;
}

const HINTS = `Three common options for a private ~/.ai-context/ remote:

─── Option A: GitHub private repo ────────────────────────────────
  gh repo create ai-context --private --source=. --remote=origin --push
  # requires \`gh auth login\` first. Adds GitHub as origin. Private by default.

─── Option B: Self-hosted Gitea / Forgejo ────────────────────────
  git remote add origin git@gitea.yourhost:<your-user>/ai-context.git
  git push -u origin main

─── Option C: Syncthing (no git remote, file-level sync) ─────────
  # Add ~/.ai-context/ to Syncthing, share with other devices.
  # Each device: clone empty dir to get first push, then rely on Syncthing.
  # Works offline, no external server. Git history stays local per-machine.

─── Option D: local bare-repo backup (USB drive / NAS / SSD) ─────
  git remote add backup /path/to/external/repos/ai-context.git  # bare repo
  git push -u backup main
  # Useful as an offline second copy alongside any online remote.

─── Option E: Multiple remotes (local backup + online mirror) ───
  git remote add backup /path/to/external/repos/ai-context.git
  git remote add origin git@github.com:<your-user>/ai-context-private.git
  # Push both on each commit via a sync script, or alias git-push to
  # run "git push backup main && git push origin main".

After adding a remote:
  git push -u <remote-name> main
`;

const args = parseArgs(process.argv.slice(2));

if (args.help || (!args.url && process.argv.length > 2)) {
  console.log('Usage: setup-private-remote.mjs [URL]');
  console.log('       setup-private-remote.mjs --url <git-url>');
  console.log('       setup-private-remote.mjs            (print hints + state)');
  process.exit(0);
}

if (!existsSync(aiDir)) {
  console.error(`ai-context dir not found: ${aiDir}`);
  process.exit(1);
}

if (!args.url) {
  // Hints mode (matches old .sh behavior)
  console.log('Current remotes:');
  const remotes = git(['remote', '-v']);
  console.log(remotes.stdout?.trim() || '  (none)');
  console.log();
  console.log(HINTS);
  console.log();
  const branch = git(['branch', '--show-current']);
  console.log(`Current branch: ${branch.stdout?.trim() || 'main'}`);
  console.log('To set a remote URL, re-run with: setup-private-remote.mjs --url <git-url>');
  process.exit(0);
}

// Setup mode (matches old .ps1 behavior)
if (!existsSync(join(aiDir, '.git'))) {
  console.log('initializing git repo...');
  git(['init', '-q']);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'initial ai-context commit']);
}

const addResult = git(['remote', 'add', 'origin', args.url]);
if (addResult.status !== 0) {
  git(['remote', 'set-url', 'origin', args.url]);
  console.log(`updated existing origin → ${args.url}`);
} else {
  console.log(`added remote origin → ${args.url}`);
}

console.log('pushing initial state...');
const push = gitInherit(['push', '-u', 'origin', 'HEAD']);
if (push.status !== 0) {
  console.error('push failed');
  process.exit(push.status ?? 1);
}

console.log(`Done. ${aiDir} now syncs to ${args.url}`);
