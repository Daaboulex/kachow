#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// mirror-kachow.js — Stop hook. Auto-mirror the three canonical source dirs
// (~/.ai-context/ + ~/.claude/ + ~/.gemini/) into the kachow public repo on
// a cooldown. LOCAL-MIRROR-ONLY by default — no GitHub push unless opted in.
//
// Trigger model (v2 — fixed GAP 1):
//   Fires if ANY of these has changed since the last successful mirror:
//     (a) ~/.ai-context/ git HEAD        ← rules, memory schema, skills, MCP, scripts
//     (b) ~/.claude/    git HEAD        ← hooks + commands master
//     (c) ~/.gemini/    git HEAD        ← Gemini-specific additions
//     (d) content hash of ~/.ai-context/ working tree (catches uncommitted
//         source edits — because ~/.ai-context/ has no auto-push by default)
//
// Flow per Stop:
//   1. Cooldown gate (15 min default) — skip if last run was recent.
//   2. Trigger gate (above) — skip if nothing changed.
//   3. Run scrub-for-publish → temp dir.
//   4. Run deep-verify-scrub → abort if any hard finding.
//   5. Rsync temp → $HOME/.kachow-mirror/.
//   6. Commit (if any diff). Do NOT push unless KACHOW_AUTO_PUSH=1.
//
// Turn off entirely by removing this hook from settings.json. Opt into auto-push
// via KACHOW_AUTO_PUSH=1 in env (with KACHOW_REMOTE=<name>, default "origin").
//
// Maintainer-only. Not shipped in the framework.

'use strict';

const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const cp      = require('child_process');
const crypto  = require('crypto');

const HOME         = os.homedir();
const AI_CONTEXT   = process.env.AI_CONTEXT || path.join(HOME, '.ai-context');
const CLAUDE_DIR   = path.join(HOME, '.claude');
const GEMINI_DIR   = path.join(HOME, '.gemini');
const MIRROR       = process.env.KACHOW_MIRROR || path.join(HOME, '.kachow-mirror');
const COOLDOWN_MIN = parseInt(process.env.KACHOW_COOLDOWN_MIN || '15', 10);
const AUTO_PUSH    = process.env.KACHOW_AUTO_PUSH === '1';
const REMOTE       = process.env.KACHOW_REMOTE || 'origin';
const STATE_FILE   = path.join(HOME, '.claude', 'cache', 'mirror-kachow.json');
const LOG_FILE     = path.join(HOME, '.claude', 'cache', 'mirror-kachow.log');

function log(msg) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return {}; }
}

function writeState(s) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
  } catch (e) { log('writeState: ' + e.message); }
}

function run(cmd, args, opts = {}) {
  const r = cp.spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  return { code: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function gitHead(dir) {
  if (!fs.existsSync(path.join(dir, '.git'))) return null;
  const r = run('git', ['-C', dir, 'rev-parse', 'HEAD']);
  return r.code === 0 ? r.stdout.trim() : null;
}

// Content hash for a narrow subset — catches uncommitted source edits that
// would otherwise make mirror-kachow skip "because HEAD hasn't changed".
// Only hashes the files that actually make it into the kachow scrub.
function workingTreeHash(dir) {
  if (!fs.existsSync(dir)) return '';
  const interesting = ['AGENTS.md', 'scripts', 'mcp', 'skills'];
  const h = crypto.createHash('sha256');
  function walk(p) {
    let st;
    try { st = fs.statSync(p); } catch { return; }
    if (st.isDirectory()) {
      if (path.basename(p) === '.git' || path.basename(p) === 'node_modules') return;
      for (const name of fs.readdirSync(p).sort()) walk(path.join(p, name));
    } else if (st.isFile()) {
      h.update(p + ':' + st.size + ':' + st.mtimeMs);
    }
  }
  for (const name of interesting) walk(path.join(dir, name));
  return h.digest('hex').slice(0, 16);
}

function computeTrigger() {
  return {
    aiHead:      gitHead(AI_CONTEXT),
    claudeHead:  gitHead(CLAUDE_DIR),
    geminiHead:  gitHead(GEMINI_DIR),
    aiWorkHash:  workingTreeHash(AI_CONTEXT),
  };
}

function triggersMatch(state, current) {
  return state.lastAiHead      === current.aiHead
      && state.lastClaudeHead  === current.claudeHead
      && state.lastGeminiHead  === current.geminiHead
      && state.lastAiWorkHash  === current.aiWorkHash;
}

function main() {
  const now = Date.now();
  const state = readState();

  // Silent exits — Stop hook should never disrupt Claude.
  if (!fs.existsSync(AI_CONTEXT)) { log('AI_CONTEXT missing — skip'); return; }

  // Platform gate: this hook shells out to bash + rsync. Silently skip on
  // Windows if the POSIX layer (Git-Bash / WSL / Cygwin) isn't installed.
  if (process.platform === 'win32') {
    const bashOK = cp.spawnSync('bash', ['--version'], { stdio: 'ignore' }).status === 0;
    const rsyncOK = cp.spawnSync('rsync', ['--version'], { stdio: 'ignore' }).status === 0;
    if (!bashOK || !rsyncOK) {
      log(`win32 without bash/rsync — skip (bash=${bashOK} rsync=${rsyncOK})`);
      return;
    }
  }

  // Cooldown gate
  if (state.lastRun && (now - state.lastRun) < COOLDOWN_MIN * 60_000) {
    log(`cooldown (${Math.round((now - state.lastRun) / 60_000)}m < ${COOLDOWN_MIN}m) — skip`);
    return;
  }

  // Trigger gate — any of 4 signals changed?
  const trig = computeTrigger();
  if (triggersMatch(state, trig)) {
    log('no source changes (ai-context/claude/gemini HEAD + working-tree unchanged) — skip');
    return;
  }
  log(`trigger: aiHead=${trig.aiHead?.slice(0,8)} ` +
      `claudeHead=${trig.claudeHead?.slice(0,8)} ` +
      `geminiHead=${trig.geminiHead?.slice(0,8)} ` +
      `workHash=${trig.aiWorkHash}`);

  // Run scrub → temp dir (scrub-for-publish creates the dir; refuses if exists)
  const tmp = path.join(os.tmpdir(), 'kachow-mirror-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
  const scrub = run('bash', [path.join(AI_CONTEXT, 'scripts/scrub-for-publish.sh'), tmp]);
  if (scrub.code !== 0) {
    log('scrub-for-publish FAILED:\n' + scrub.stderr.slice(-500));
    return;
  }
  log(`scrub OK: ${tmp}`);

  // Deep verify
  const verify = run('node', [path.join(AI_CONTEXT, 'scripts/deep-verify-scrub.js'), tmp]);
  if (verify.code !== 0) {
    log('deep-verify FAILED — aborting mirror:\n' + (verify.stdout + verify.stderr).slice(-2000));
    return;
  }
  log('deep-verify passed');

  // Ensure mirror dir is a git repo
  if (!fs.existsSync(path.join(MIRROR, '.git'))) {
    fs.mkdirSync(MIRROR, { recursive: true });
    run('git', ['-C', MIRROR, 'init', '-q']);
    run('git', ['-C', MIRROR, 'checkout', '-q', '-b', 'main']);
    log(`initialized mirror at ${MIRROR}`);
  }

  // Rsync snapshot → mirror (preserve .git)
  const rsync = run('rsync', ['-a', '--delete', '--exclude=.git/', tmp + '/', MIRROR + '/']);
  if (rsync.code !== 0) { log('rsync FAILED: ' + rsync.stderr); return; }

  // Commit if any diff
  const status = run('git', ['-C', MIRROR, 'status', '--porcelain']);
  if (!status.stdout.trim()) {
    log('no diff in mirror — nothing to commit');
    writeState({ lastRun: now, ...trig });
    return;
  }

  run('git', ['-C', MIRROR, 'add', '-A']);
  const src = (trig.aiHead || '').slice(0, 12);
  const commitMsg = `mirror: auto-sync from source@${src}`;
  const commit = run('git', ['-C', MIRROR, '-c', `user.email=mirror@localhost`,
                              '-c', `user.name=kachow-mirror`, 'commit', '-q', '-m', commitMsg]);
  if (commit.code !== 0) {
    log('commit failed: ' + commit.stderr);
    return;
  }
  log(`committed: ${commitMsg}`);

  // Optional push
  if (AUTO_PUSH) {
    const remotes = run('git', ['-C', MIRROR, 'remote']);
    if (remotes.stdout.split('\n').map(s => s.trim()).includes(REMOTE)) {
      const push = run('git', ['-C', MIRROR, 'push', REMOTE, 'main']);
      if (push.code === 0) log(`pushed to ${REMOTE}`);
      else log(`push FAILED: ${push.stderr}`);
    } else {
      log(`remote ${REMOTE} not configured — skipping push`);
    }
  }

  writeState({
    lastRun:         now,
    lastAiHead:      trig.aiHead,
    lastClaudeHead:  trig.claudeHead,
    lastGeminiHead:  trig.geminiHead,
    lastAiWorkHash:  trig.aiWorkHash,
  });

  // Cleanup snapshot
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}

try { main(); }
catch (e) { log('FATAL: ' + (e.stack || e.message)); }
// Always exit 0 — never disrupt Stop hook chain
process.exit(0);
