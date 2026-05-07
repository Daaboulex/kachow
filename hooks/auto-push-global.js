#!/usr/bin/env node
require(__dirname + '/lib/safety-timeout.js');
// Stop hook: auto-commit and push ~/.ai-context/ to GitHub.
// ALWAYS commits locally (no cooldown for commits — data safety first).
// Push has a 5-minute cooldown to prevent network spam.
// Also pushes immediately if there are unpushed local commits (regardless of cooldown).
// Safety: fetches + ff-only before push. On conflict, commits locally only + warns.
// Non-blocking: offline or conflict = local commit preserved, user notified.
// Cross-platform (Linux, macOS, Windows) — no shell pipes, no /dev/null.


const TIMER_START = process.hrtime.bigint();
function __emitTiming(errCount) {
  try {
    const total_ms = Number(process.hrtime.bigint() - TIMER_START) / 1e6;
    require('./lib/observability-logger.js').logEvent(process.cwd(), {
      type: 'hook_timing',
      source: 'auto-push-global',
      meta: { total_ms: +total_ms.toFixed(3), error_count: errCount || 0 },
    });
  } catch {}
}

const fs = require('fs');
const path = require('path');
const os = require('os');
const g = require('./lib/git-global.js');
const { run, isGitRepo, getDefaultBranch, hasChanges, hasUnpushedCommits } = g;

const home = os.homedir();
const aiContextDir = path.join(home, '.ai-context');
const lastPush = path.join(aiContextDir, '.auto-push-last');
const PUSH_COOLDOWN_MS = 5 * 60 * 1000;
const AI_CONTEXT_AUTOCOMMIT = process.env.AI_CONTEXT_AUTOCOMMIT !== '0';
const AI_CONTEXT_AUTOPUSH = process.env.AI_CONTEXT_AUTOPUSH !== '0';

// Git mutex — prevents concurrent git operations on ~/.ai-context/
const GIT_LOCK_PATH = path.join(aiContextDir, '.git', 'ai-context.lock');
const GIT_LOCK_STALE_MS = 120000;
const GIT_LOCK_TIMEOUT_MS = 30000;
function acquireGitLock() {
  const deadline = Date.now() + GIT_LOCK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      fs.writeFileSync(GIT_LOCK_PATH, JSON.stringify({ pid: process.pid, hostname: os.hostname(), created: Date.now() }), { flag: 'wx' });
      return true;
    } catch (e) {
      if (e.code === 'EEXIST') {
        try {
          const lock = JSON.parse(fs.readFileSync(GIT_LOCK_PATH, 'utf8'));
          if (Date.now() - lock.created > GIT_LOCK_STALE_MS) { fs.unlinkSync(GIT_LOCK_PATH); continue; }
        } catch { try { fs.unlinkSync(GIT_LOCK_PATH); } catch {} continue; }
        try { require('child_process').execSync('sleep 0.2'); } catch {}
      } else return false;
    }
  }
  return false;
}
function releaseGitLock() { try { fs.unlinkSync(GIT_LOCK_PATH); } catch {} }

const warnings = [];

function autoCommit(dir, label) {
  if (!isGitRepo(dir) || !hasChanges(dir)) return false;

  const status = run('git status --porcelain', dir) || '';
  const credFiles = status.split('\n').filter(line => {
    const fname = line.replace(/^.{3}/, '').trim().split('/').pop();
    return /^(\.credentials|oauth_creds|auth|\.env|\.secret|api[_-]?key)/i.test(fname);
  });
  if (credFiles.length > 0) {
    warnings.push(`${label}: SKIPPED — credential file detected: ${credFiles.map(f => f.trim().split('/').pop()).join(', ')}`);
    return false;
  }

  // GPG-sign intentionally bypassed — see AGENTS.md "GPG sign exception"
  const TRACKED = ['AGENTS.md', 'AGENTS-*.md', 'CHANGELOG.md', 'VERSION', 'README.md',
    'hooks/', 'memory/', 'skills/', 'scripts/', 'configs/', 'mcp/',
    '.superpowers/', 'project-state/', 'instances/', 'handoffs/', 'docs/',
    '.gitignore', '.pre-commit-scrub.sh'];
  run(`git add ${TRACKED.join(' ')}`, dir);
  const committed = run(`git commit -m "chore: auto-sync from session end" --no-gpg-sign`, dir);
  return committed !== null;
}

function autoPush(dir, label) {
  if (!isGitRepo(dir)) return;

  const branch = getDefaultBranch(dir);

  const fetched = run(`git fetch origin ${branch}`, dir);
  if (!fetched && fetched !== '') {
    warnings.push(`${label}: committed locally (offline — will push next session)`);
    return;
  }

  const behind = run(`git rev-list HEAD..origin/${branch} --count`, dir);
  if (behind && parseInt(behind) > 0) {
    const ffResult = run(`git merge --ff-only origin/${branch}`, dir);
    if (ffResult !== null) {
      // Fast-forward succeeded
    } else {
      const merged = run(`git merge origin/${branch} --no-edit -m "chore: auto-merge remote changes" --no-gpg-sign`, dir);
      if (merged === null) {
        run('git merge --abort', dir);
        warnings.push(`${label}: committed locally but push skipped — real content conflict with remote. Run: cd ${dir} && git pull origin ${branch} (resolve manually to preserve both edits)`);
        return;
      }
      const postMergeStatus = run('git diff --name-only HEAD~1', dir) || '';
      const mergedCredFiles = postMergeStatus.split('\n').filter(line => {
        const fname = line.trim().split('/').pop();
        return /^(\.credentials|oauth_creds|auth|\.env|\.secret|api[_-]?key|.*\.pem|id_rsa|kubeconfig)/i.test(fname);
      });
      if (mergedCredFiles.length > 0) {
        const stashResult = run('git stash --include-untracked', dir);
        run('git reset --hard HEAD~1', dir);
        if (stashResult && !stashResult.includes('No local changes')) {
          run('git stash pop', dir);
        }
        warnings.push(`${label}: MERGE REVERTED — credential file detected in remote: ${mergedCredFiles.join(', ')}. Resolve manually.`);
        return;
      }
    }
  }

  const pushed = run(`git push origin ${branch}`, dir);
  if (!pushed && pushed !== '') {
    warnings.push(`${label}: committed locally but push failed. Run: cd ${dir} && git push origin ${branch}`);
  }
}

try {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }

  if (!acquireGitLock()) {
    warnings.push('git lock acquisition timed out — skipping commit/push (another session may be pushing)');
  } else {
    try {
      const aiContextCommitted = AI_CONTEXT_AUTOCOMMIT
        ? autoCommit(aiContextDir, '~/.ai-context')
        : false;

      let lastTime = 0;
      try { lastTime = fs.statSync(lastPush).mtimeMs; } catch {}
      const cooldownElapsed = (Date.now() - lastTime) >= PUSH_COOLDOWN_MS;

      const aiContextUnpushed = AI_CONTEXT_AUTOPUSH && isGitRepo(aiContextDir) && hasUnpushedCommits(aiContextDir);
      const shouldPush = cooldownElapsed || aiContextUnpushed;

      if (shouldPush) {
        if (AI_CONTEXT_AUTOPUSH && isGitRepo(aiContextDir)) {
          const remotes = run('git remote', aiContextDir);
          if (remotes && remotes.trim()) autoPush(aiContextDir, '~/.ai-context');
        }
        try { fs.writeFileSync(lastPush, ''); } catch {}
      } else if (aiContextCommitted) {
        warnings.push('committed locally (push cooldown active — will push on next session end)');
      }
    } finally {
      releaseGitLock();
    }
  }

  try { require('./lib/observability-logger.js').logEvent(process.cwd(), { type: 'auto_push', source: 'auto-push-global', success: warnings.length === 0, meta: { aiContextCommitted, pushed: shouldPush, warnings } }); } catch {}

  if (warnings.length > 0) {
    __emitTiming(0); process.stdout.write(JSON.stringify({
      continue: true,
      systemMessage: '[auto-push] ' + warnings.join('; ')
    }));
  } else {
    __emitTiming(0); process.stdout.write('{"continue":true}');
  }
} catch (e) {
  process.stderr.write('auto-push-global: ' + e.message + '\n');
  __emitTiming(0); process.stdout.write('{"continue":true}');
}
