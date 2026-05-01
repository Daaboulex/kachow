#!/usr/bin/env node
// Stop hook: proactive session wrap-up reminder
// If meaningful work was done and /wrap-up hasn't been run, nudge the agent.
// Falls back to silent timestamp if cooldown hasn't elapsed.
// Cross-platform (Linux, macOS, Windows)

const TIMER_START = process.hrtime.bigint();
function __emitTiming(errCount) {
  try {
    const total_ms = Number(process.hrtime.bigint() - TIMER_START) / 1e6;
    require('./lib/observability-logger.js').logEvent(process.cwd(), {
      type: 'hook_timing',
      source: 'reflect-session-end',
      meta: { total_ms: +total_ms.toFixed(3), error_count: errCount || 0 },
    });
  } catch {}
}

const fs = require('fs');
const path = require('path');
const os = require('os');

const home = os.homedir();
const claudeDir = path.join(home, '.claude');
const enabledFile = path.join(claudeDir, '.reflect-enabled');
const lastFile = path.join(claudeDir, '.reflect-last');
const wrapUpDone = path.join(claudeDir, '.wrapup-done');
const COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes (was 60 — most sessions never got nudged)

try {
  if (!fs.existsSync(enabledFile)) {
    fs.writeFileSync(enabledFile, '');
  }

  // Check cooldown
  let lastTime = 0;
  try { lastTime = fs.statSync(lastFile).mtimeMs; } catch {}
  const elapsed = Date.now() - lastTime;

  if (elapsed < COOLDOWN_MS) {
    __emitTiming(0); process.stdout.write('{"continue":true}');
    process.exit(0);
  }

  // Update timestamp
  fs.writeFileSync(lastFile, '');

  // Check if /wrap-up was already run this session
  let wrapUpTime = 0;
  try { wrapUpTime = fs.statSync(wrapUpDone).mtimeMs; } catch {}
  const wrapUpRecent = (Date.now() - wrapUpTime) < COOLDOWN_MS;

  if (wrapUpRecent) {
    // Wrap-up was run — just continue silently
    __emitTiming(0); process.stdout.write('{"continue":true}');
    process.exit(0);
  }

  // Check if meaningful work was done (heuristic: any files changed in global repos)
  let claudeChanged = false;
  let geminiChanged = false;
  try {
    const { execSync } = require('child_process');
    const cStatus = execSync('git status --porcelain', { cwd: claudeDir, timeout: 3000, stdio: 'pipe' }).toString();
    claudeChanged = cStatus.trim().length > 0;
  } catch {}
  try {
    const { execSync } = require('child_process');
    const gDir = path.join(home, '.gemini');
    const gStatus = execSync('git status --porcelain', { cwd: gDir, timeout: 3000, stdio: 'pipe' }).toString();
    geminiChanged = gStatus.trim().length > 0;
  } catch {}

  // Touch AI-progress.json timestamp so it's never completely stale
  // This is minimal bookkeeping — just marks "a session happened here"
  const cwd = process.cwd();
  for (const progPath of [
    path.join(cwd, '.ai-context', 'AI-progress.json'),
    path.join(cwd, '.claude', 'AI-progress.json'),
    path.join(cwd, 'AI-progress.json'),
  ]) {
    if (fs.existsSync(progPath)) {
      try {
        const prog = JSON.parse(fs.readFileSync(progPath, 'utf8'));
        prog.lastSessionEnd = new Date().toISOString();
        prog.lastAgent = 'claude';
        if (!prog.inFlight) prog.inFlight = {};
        // Don't overwrite existing inFlight details — just mark that a session touched it
        fs.writeFileSync(progPath, JSON.stringify(prog, null, 2));
      } catch {}
      break;
    }
  }

  if (claudeChanged || geminiChanged) {
    __emitTiming(0); process.stdout.write(JSON.stringify({
      continue: true,
      systemMessage: '[session-end] Changes detected. Run /wrap-up (comprehensive) or /handoff (fast) to capture state and learnings before this session ends. Without either, only a timestamp is saved — session context and learnings are lost.'
    }));
  } else {
    __emitTiming(0); process.stdout.write('{"continue":true}');
  }
} catch {
  __emitTiming(1); process.stdout.write('{"continue":true}');
}
