#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// Stop hook: auto-consolidate-memory with dual-gate trigger (time + session count)
// Consolidates memories periodically — merges duplicates, resolves contradictions,
// prunes stale data, converts dates, tightens index.
// Dual-gate: triggers when BOTH 24+ hours AND 5+ sessions since last consolidation.
// Lock file prevents concurrent consolidation.
// NOTE: Counters are NOT reset here — the /consolidate-memory command resets them after
// successful consolidation. This prevents lost triggers if agent ignores the systemMessage.
// Cross-platform (Linux, macOS, Windows)

const fs = require('fs');
const path = require('path');
const os = require('os');

const home = os.homedir();

const { detectTool, toolHomeDir } = require('./lib/tool-detect.js');
// v0.9.5 W7-CRIT-3: use shared ~/.ai-context/ for dream state (not per-tool dir)
const sharedDir = path.join(home, '.ai-context');

const lastFile = path.join(sharedDir, '.dream-last');
const counterFile = path.join(sharedDir, '.dream-session-count');
const lockFile = path.join(sharedDir, '.dream-lock');

// Constants centralized in lib/constants.js (CI-001)
const { DREAM_COOLDOWN_MS, DREAM_MIN_SESSIONS, DREAM_LOCK_STALE_MS } = require('./lib/constants.js');
const { readCounter, resetCounter } = require('./lib/atomic-counter.js');
const COOLDOWN_MS = DREAM_COOLDOWN_MS;
const MIN_SESSIONS = DREAM_MIN_SESSIONS;
const LOCK_STALE_MS = DREAM_LOCK_STALE_MS;

// Find memory directory
function findMemoryDir() {
  const projectDir = process.cwd();
  for (const candidate of ['.ai-context/memory', path.basename(toolHomeDir()) + '/memory']) {
    const fullPath = path.join(projectDir, candidate);
    if (fs.existsSync(path.join(fullPath, 'MEMORY.md'))) {
      return { path: fullPath, type: candidate };
    }
  }
  return null;
}

// Atomic lock acquisition using exclusive create flag
function acquireLock() {
  try {
    // Check for stale lock first
    if (fs.existsSync(lockFile)) {
      const lockAge = Date.now() - fs.statSync(lockFile).mtimeMs;
      if (lockAge < LOCK_STALE_MS) {
        return false; // Lock is fresh — another consolidation is running
      }
      // Lock is stale — remove it before attempting exclusive create
      try { fs.unlinkSync(lockFile); } catch {}
    }
    // Atomic exclusive create — fails if another process created it between our check and write
    fs.writeFileSync(lockFile, String(process.pid), { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}

try {
  // Gate 1: Check time cooldown (24 hours)
  let lastTime = 0;
  try { lastTime = fs.statSync(lastFile).mtimeMs; } catch {}
  const elapsed = Date.now() - lastTime;

  if (elapsed < COOLDOWN_MS) {
    process.stdout.write('{"continue":true}');
    process.exit(0);
  }

  // Gate 2: Check session count (5+ sessions) - RC-001: use atomic reader
  const sessionCount = readCounter(counterFile);

  if (sessionCount < MIN_SESSIONS) {
    process.stdout.write('{"continue":true}');
    process.exit(0);
  }

  // Both gates passed — check if consolidation is worthwhile
  const memDir = findMemoryDir();
  if (!memDir) {
    process.stdout.write('{"continue":true}');
    process.exit(0);
  }

  // Count memory files
  const files = fs.readdirSync(memDir.path).filter(f => f.endsWith('.md') && f !== 'MEMORY.md');
  if (files.length < 5) {
    // Too few files to bother — reset counters atomically (nothing to consolidate)
    try { fs.writeFileSync(lastFile, ''); } catch {}
    resetCounter(counterFile, 0);
    process.stdout.write('{"continue":true}');
    process.exit(0);
  }

  // Acquire lock to prevent concurrent runs
  if (!acquireLock()) {
    process.stdout.write('{"continue":true}');
    process.exit(0);
  }

  // DO NOT reset counters here — /consolidate-memory resets them after successful consolidation
  // This ensures: if agent ignores the systemMessage, the trigger fires again next session

  // Observability: emit dream trigger event
  try { require('./lib/observability-logger.js').logEvent(process.cwd(), { type: 'dream_trigger', source: 'dream-auto', meta: { memoryFiles: files.length, sessionCount } }); } catch {}

  // Must emit systemMessage to trigger agent action
  const daysSince = Math.round(elapsed / 86400000);
  process.stdout.write(JSON.stringify({
    systemMessage: `[ACTION REQUIRED] Memory consolidation overdue (${sessionCount} sessions, ${daysSince}d since last). Run /consolidate-memory now — memory corpus is ${files.length} files and growing unbounded. Target: ${memDir.path}. After consolidation, reset counters: write '0' to ~/.ai-context/.dream-session-count, touch ~/.ai-context/.dream-last, delete ~/.ai-context/.dream-lock`,
    continue: true
  }));
} catch (e) {
  // SF-002: log silent failures to stderr for debuggability
  try { process.stderr.write(`dream-auto: ${e.message}\n`); } catch {}
  try { require('./lib/observability-logger.js').logEvent(process.cwd(), { type: 'hook_errors', source: 'dream-auto', errors: [{ section: 'main', error: e.message }] }); } catch {}
  process.stdout.write('{"continue":true}');
}
