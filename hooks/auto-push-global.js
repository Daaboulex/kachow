#!/usr/bin/env node
require(__dirname + '/lib/safety-timeout.js');
// Stop hook: auto-commit and push ~/.claude/ and ~/.gemini/ to GitHub.
// ALWAYS commits locally (no cooldown for commits — data safety first).
// Push has a 5-minute cooldown to prevent network spam.
// Also pushes immediately if there are unpushed local commits (regardless of cooldown).
// Safety: fetches + rebases before push. On conflict, commits locally only + warns.
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
const claudeDir = path.join(home, '.claude');
const geminiDir = path.join(home, '.gemini');
const codexDir = path.join(home, '.codex');
const aiContextDir = path.join(home, '.ai-context');
const lastPush = path.join(claudeDir, '.auto-push-last');
const PUSH_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes (push only, not commit)
// Opt-in: commit ~/.ai-context/ on each Stop too (off by default because
// ai-context is often Syncthing-synced and may have no git remote).
const AI_CONTEXT_AUTOCOMMIT = process.env.AI_CONTEXT_AUTOCOMMIT === '1';
// Opt-in: push ~/.ai-context/ too (requires a remote configured).
const AI_CONTEXT_AUTOPUSH = process.env.AI_CONTEXT_AUTOPUSH === '1';

// Shared hooks that must be kept in sync (Claude is source of truth)
const SHARED_HOOKS = [
  'dream-auto.js',
];

function syncSharedHooks() {
  const claudeHooks = path.join(claudeDir, 'hooks');
  const geminiHooks = path.join(geminiDir, 'hooks');
  if (!fs.existsSync(geminiHooks)) return;

  for (const file of SHARED_HOOKS) {
    const src = path.join(claudeHooks, file);
    const dst = path.join(geminiHooks, file);
    if (!fs.existsSync(src)) continue;

    try {
      const srcContent = fs.readFileSync(src, 'utf-8');
      const dstContent = fs.existsSync(dst) ? fs.readFileSync(dst, 'utf-8') : '';

      const srcBody = srcContent.split('\n').slice(1).join('\n');
      const dstBody = dstContent.split('\n').slice(1).join('\n');
      if (srcBody !== dstBody) {
        const updated = srcContent.replace(
          /^\/\/ (Stop|SessionStart) hook:/,
          (match) => match.replace('Stop hook:', 'SessionEnd hook:')
        );
        fs.writeFileSync(dst, updated);
      }
    } catch {}
  }
}

const warnings = [];

function autoCommit(dir, label) {
  if (!isGitRepo(dir) || !hasChanges(dir)) return false;

  // Security: never stage actual credential files (belt + suspenders with .gitignore)
  // Only match known credential filenames, not arbitrary paths containing "token"
  const status = run('git status --porcelain', dir) || '';
  const credFiles = status.split('\n').filter(line => {
    const fname = line.replace(/^.{3}/, '').trim().split('/').pop();
    return /^(\.credentials|oauth_creds|auth|\.env|\.secret|api[_-]?key)/i.test(fname);
  });
  if (credFiles.length > 0) {
    warnings.push(`${label}: SKIPPED — credential file detected: ${credFiles.map(f => f.trim().split('/').pop()).join(', ')}`);
    return false;
  }

  // Stage and commit locally — ALWAYS (no cooldown)
  // GPG-sign is intentionally bypassed here: auto-sync commits are mechanical
  // session-end snapshots, not user-authored work. Forcing GPG sign would
  // either prompt for passphrase (breaks autopush in non-interactive context)
  // or silently fail (breaks data preservation). User-authored commits remain
  // signed via standard git config. AGENTS.md documents this exception.
  run('git add -A', dir);
  const committed = run(`git commit -m "chore: auto-sync from session end" --no-gpg-sign`, dir);
  return committed !== null;
}

function autoPush(dir, label) {
  if (!isGitRepo(dir)) return;

  const branch = getDefaultBranch(dir);

  // Fetch remote state before pushing
  const fetched = run(`git fetch origin ${branch}`, dir);
  if (!fetched && fetched !== '') {
    warnings.push(`${label}: committed locally (offline — will push next session)`);
    return;
  }

  // Check if we're behind
  const behind = run(`git rev-list HEAD..origin/${branch} --count`, dir);
  if (behind && parseInt(behind) > 0) {
    const rebased = run(`git rebase origin/${branch}`, dir);
    if (!rebased) {
      run('git rebase --abort', dir);
      warnings.push(`${label}: committed locally but push skipped — remote has conflicting changes. Run: cd ${dir} && git pull --rebase origin ${branch}`);
      return;
    }
  }

  // Push
  const pushed = run(`git push origin ${branch}`, dir);
  if (!pushed && pushed !== '') {
    warnings.push(`${label}: committed locally but push failed. Run: cd ${dir} && git push origin ${branch}`);
  }
}

try {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }

  // Sync shared hooks first (so Gemini gets latest before commit)
  syncSharedHooks();

  // Update README stats + context graph before committing (non-blocking)
  try {
    const statsScript = path.join(claudeDir, 'scripts', 'update-readme-stats.js');
    if (fs.existsSync(statsScript)) run(`node "${statsScript}"`, claudeDir);
  } catch {}
  try {
    const graphScript = path.join(claudeDir, 'scripts', 'context-graph.js');
    if (fs.existsSync(graphScript)) run(`node "${graphScript}"`, claudeDir);
  } catch {}

  // Phase 1: ALWAYS commit locally (no cooldown — data safety first)
  const claudeCommitted    = autoCommit(claudeDir, '~/.claude');
  const geminiCommitted    = autoCommit(geminiDir, '~/.gemini');
  const codexCommitted     = autoCommit(codexDir, '~/.codex');
  const aiContextCommitted = AI_CONTEXT_AUTOCOMMIT
    ? autoCommit(aiContextDir, '~/.ai-context')
    : false;

  // Phase 2: Push with cooldown (network operation)
  let lastTime = 0;
  try { lastTime = fs.statSync(lastPush).mtimeMs; } catch {}
  const cooldownElapsed = (Date.now() - lastTime) >= PUSH_COOLDOWN_MS;

  // Push if: cooldown elapsed OR there are unpushed commits (from previous skipped pushes)
  const claudeUnpushed = hasUnpushedCommits(claudeDir);
  const geminiUnpushed = hasUnpushedCommits(geminiDir);
  const codexUnpushed = isGitRepo(codexDir) && hasUnpushedCommits(codexDir);
  const aiContextUnpushed = AI_CONTEXT_AUTOPUSH && isGitRepo(aiContextDir) && hasUnpushedCommits(aiContextDir);
  const shouldPush = cooldownElapsed || claudeUnpushed || geminiUnpushed || codexUnpushed || aiContextUnpushed;

  if (shouldPush) {
    autoPush(claudeDir, '~/.claude');
    autoPush(geminiDir, '~/.gemini');
    if (isGitRepo(codexDir)) {
      const codexRemotes = run('git remote', codexDir);
      if (codexRemotes && codexRemotes.trim()) autoPush(codexDir, '~/.codex');
    }
    // Only push ai-context if opted in AND a remote is configured.
    if (AI_CONTEXT_AUTOPUSH && isGitRepo(aiContextDir)) {
      const remotes = run('git remote', aiContextDir);
      if (remotes && remotes.trim()) autoPush(aiContextDir, '~/.ai-context');
    }
    try { fs.writeFileSync(lastPush, ''); } catch {}
  } else if (claudeCommitted || geminiCommitted || aiContextCommitted) {
    warnings.push('committed locally (push cooldown active — will push on next session end)');
  }

  // Observability: emit auto-push event
  try { require('./lib/observability-logger.js').logEvent(process.cwd(), { type: 'auto_push', source: 'auto-push-global', success: warnings.length === 0, meta: { claudeCommitted, geminiCommitted, aiContextCommitted, pushed: shouldPush, warnings } }); } catch {}

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
