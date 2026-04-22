#!/usr/bin/env node
// SessionStart hook: pull latest config from remote before session begins.
// Safety: stash once, pull with rebase, restore stash. On conflict, warn + skip.
// Self-healing: if local branch diverged, attempts rebase. If that fails, warns.
// Non-blocking: offline or conflict = session continues with local state + warning.
// Cross-platform (Linux, macOS, Windows) — no shell pipes, no /dev/null.

const path = require('path');
const os = require('os');
const fs = require('fs');
const g = require('./lib/git-global.js');
const { REPOS: repos, run, isGitRepo, getDefaultBranch } = g;

// Cooldown: don't pull if we pulled within the last 30 minutes
const COOLDOWN_MS = 30 * 60 * 1000;
const cooldownFile = path.join(os.tmpdir(), 'claude-auto-pull-last.json');

try {
  // Read stdin
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }

  // Check cooldown
  try {
    const last = JSON.parse(fs.readFileSync(cooldownFile, 'utf8'));
    if (Date.now() - last.timestamp < COOLDOWN_MS) {
      process.stdout.write('{"continue":true}');
      process.exit(0);
    }
  } catch {}

  const messages = [];

  for (const { dir, label } of repos) {
    if (!isGitRepo(dir)) continue;

    // Check if remote exists
    const remote = run('git remote', dir);
    if (!remote) continue;

    const branch = getDefaultBranch(dir);

    // Fetch remote (non-blocking if offline)
    const fetched = run(`git fetch origin ${branch}`, dir);
    if (fetched === null) {
      // Offline — skip pull, use local state
      continue;
    }

    // Check divergence
    const ahead = parseInt(run(`git rev-list origin/${branch}..HEAD --count`, dir) || '0');
    const behind = parseInt(run(`git rev-list HEAD..origin/${branch} --count`, dir) || '0');

    if (behind === 0) {
      // Already up to date (or ahead — our commits will push later)
      continue;
    }

    // We're behind remote — need to pull
    // Stash any local uncommitted changes ONCE
    const status = run('git status --porcelain', dir) || '';
    const hasLocal = status.length > 0;
    let stashed = false;

    if (hasLocal) {
      const stashResult = run('git stash --include-untracked', dir);
      stashed = stashResult !== null && !stashResult.includes('No local changes');
    }

    let pullOk = false;

    if (ahead === 0) {
      // Clean fast-forward — safest case
      pullOk = run(`git merge --ff-only origin/${branch}`, dir) !== null;
    } else {
      // Diverged — attempt rebase (local commits on top of remote)
      const rebased = run(`git rebase origin/${branch}`, dir);
      if (rebased !== null) {
        pullOk = true;
      } else {
        // Rebase conflict — abort, warn user
        run('git rebase --abort', dir);
        messages.push(`${label}: diverged from remote (${ahead} local, ${behind} remote). Auto-merge failed. Run manually: cd ${dir} && git pull --rebase origin ${branch}`);
      }
    }

    // Restore stash ONCE (only if we stashed)
    if (stashed) {
      const popResult = run('git stash pop', dir);
      if (popResult === null) {
        // Stash pop conflict — drop the stash so subsequent pulls don't re-apply it.
        // Original files remain safe in stash reflog (git fsck finds it for 30 days).
        run('git stash drop', dir);
        messages.push(`${label}: stash restore had conflicts. Stash dropped; check working tree + \`git fsck --lost-found\` if needed.`);
      }
    }

    if (pullOk) {
      messages.push(`${label}: updated from remote (was ${behind} commits behind)`);
    }
  }

  // Write cooldown
  try {
    fs.writeFileSync(cooldownFile, JSON.stringify({ timestamp: Date.now() }));
  } catch {}

  if (messages.length > 0) {
    process.stdout.write(JSON.stringify({
      continue: true,
      systemMessage: '[auto-pull] ' + messages.join('; ')
    }));
  } else {
    process.stdout.write('{"continue":true}');
  }
} catch (e) {
  process.stderr.write('auto-pull-global: ' + e.message + '\n');
  process.stdout.write('{"continue":true}');
}
