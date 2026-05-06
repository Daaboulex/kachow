#!/usr/bin/env node
// Stop/SessionEnd hook — v3 Phase D: sleep-time background consolidator.
//
// When dual-gate opens (24h + 5 sessions), spawn a DETACHED `claude -p` (or `gemini -p`)
// subprocess that runs `/consolidate-memory deep` and exits. Hook returns within ~200ms
// regardless of subprocess duration. Subprocess survives parent session close.
//
// Complements dream-auto.js (which nudges the primary agent). This hook provides an
// unattended path: if the user just closes the terminal, the consolidator still runs.
//
// Guards:
//   - Dual-gate (24h cooldown + 5-session counter) — SAME gate as dream-auto, so both
//     fire together or not at all; the lock prevents both from consolidating twice.
//   - Lock file `.sleep-consolidator-lock` (separate from dream-lock so the two hooks
//     don't block each other; dream-auto's lock is for the agent-triggered path).
//   - Per-machine log `~/.claude/cache/sleep-consolidator-<host>.log`.
//   - Disable: SKIP_SLEEP_CONSOLIDATOR=1 env var.
//   - Max 1 concurrent run per host (via lock).
//
// Platform detection: script path (.claude vs .gemini) determines which binary to spawn.
// Windows: spawn with shell:true to pick up .cmd wrappers.

const TIMER_START = process.hrtime.bigint();
function __emitTiming(errCount) {
  try {
    const total_ms = Number(process.hrtime.bigint() - TIMER_START) / 1e6;
    require('./lib/observability-logger.js').logEvent(process.cwd(), {
      type: 'hook_timing',
      source: 'stop-sleep-consolidator',
      meta: { total_ms: +total_ms.toFixed(3), error_count: errCount || 0 },
    });
  } catch {}
}

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

function passthrough() { __emitTiming(0); process.stdout.write('{"continue":true}'); process.exit(0); }

try {
  if (process.env.SKIP_SLEEP_CONSOLIDATOR === '1') passthrough();

  const home = os.homedir();
  const scriptDir = __dirname;
  const { detectTool, toolHomeDir } = require('./lib/tool-detect.js');
  const tool = detectTool();
  const isGemini = tool === 'gemini';
  const configDir = toolHomeDir(tool);
  const cacheDir = path.join(configDir, 'cache');
  try { fs.mkdirSync(cacheDir, { recursive: true }); } catch {}

  // Dual-gate reuse — same counters as dream-auto for consistency
  const lastFile = path.join(configDir, '.dream-last');
  const counterFile = path.join(configDir, '.dream-session-count');
  const { DREAM_COOLDOWN_MS, DREAM_MIN_SESSIONS } = require('./lib/constants.js');
  const { readCounter } = require('./lib/atomic-counter.js');

  let lastTime = 0;
  try { lastTime = fs.statSync(lastFile).mtimeMs; } catch {}
  if (Date.now() - lastTime < DREAM_COOLDOWN_MS) passthrough();
  if (readCounter(counterFile) < DREAM_MIN_SESSIONS) passthrough();

  // Scope: only run in tracked projects
  const cwd = process.cwd();
  const memDir = path.join(cwd, '.claude', 'memory');
  if (!fs.existsSync(memDir)) passthrough();

  // Per-host lock (separate from dream-lock)
  const host = os.hostname();
  const lockFile = path.join(cacheDir, `sleep-consolidator-${host}.lock`);
  const LOCK_STALE_MS = 10 * 60 * 1000; // 10 min
  try {
    if (fs.existsSync(lockFile)) {
      const age = Date.now() - fs.statSync(lockFile).mtimeMs;
      if (age < LOCK_STALE_MS) passthrough();
      try { fs.unlinkSync(lockFile); } catch {}
    }
    fs.writeFileSync(lockFile, String(process.pid) + '\n' + new Date().toISOString(), { flag: 'wx' });
  } catch { passthrough(); }

  // Locate binary. Prefer `claude` for .claude platform, `gemini` for .gemini.
  const binary = isGemini ? 'gemini' : 'claude';
  const prompt = '/consolidate-memory deep';
  const logFile = path.join(cacheDir, `sleep-consolidator-${host}.log`);

  // Append run header to log
  try {
    fs.appendFileSync(logFile, `\n=== ${new Date().toISOString()} — spawning ${binary} -p (cwd=${cwd}) ===\n`);
  } catch {}

  // Spawn detached. Subprocess outlives parent.
  // On Windows, shell:true resolves .cmd wrappers (claude is usually a .cmd on Windows).
  const isWindows = process.platform === 'win32';
  try {
    const child = spawn(binary, ['-p', prompt], {
      detached: true,
      stdio: ['ignore',
        fs.openSync(logFile, 'a'),
        fs.openSync(logFile, 'a')],
      shell: isWindows,
      cwd,
      env: {
        ...process.env,
        // Prevent recursive trigger: child session should NOT re-fire this hook
        SKIP_SLEEP_CONSOLIDATOR: '1',
        SKIP_SKILL_DRIFT: '1',
      },
    });
    child.on('error', (err) => {
      try { fs.appendFileSync(logFile, `SPAWN_ERROR: ${err.message}\n`); } catch {}
      try { fs.unlinkSync(lockFile); } catch {}
    });
    child.unref();

    // Release lock after reasonable time — spawn write+unref is ~50ms.
    // Lock will be cleaned by child exit (below) or stale-timeout.
    // We write child PID for observers.
    try { fs.writeFileSync(lockFile, String(child.pid) + '\n' + new Date().toISOString()); } catch {}

    // Observability
    try {
      require('./lib/observability-logger.js').logEvent(cwd, {
        type: 'sleep_consolidator_spawned',
        source: 'stop-sleep-consolidator',
        meta: { binary, pid: child.pid, host, platform: isGemini ? 'gemini' : 'claude' },
      });
    } catch {}
  } catch (e) {
    try { fs.appendFileSync(logFile, `SPAWN_FAIL: ${e.message}\n`); } catch {}
    try { fs.unlinkSync(lockFile); } catch {}
  }

  passthrough();
} catch (e) {
  try { process.stderr.write(`stop-sleep-consolidator: ${e.message}\n`); } catch {}
  passthrough();
}
