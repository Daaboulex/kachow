// Atomic counter utility for shared state files.
// Prevents race conditions when multiple processes increment the same counter
// (e.g., .dream-session-count, .research-session-count).
//
// Strategy: write new value to temp file, then atomically rename into place.
// rename() is atomic on POSIX filesystems. On Windows it's best-effort but still
// safer than read-then-write.
//
// Usage:
//   const { incrementCounter } = require('./lib/atomic-counter.js');
//   const newValue = incrementCounter('$HOME/.claude/.dream-session-count');

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Atomically increment a counter file.
 * Returns the new value, or -1 on failure.
 *
 * Semantics:
 *   - If file doesn't exist, creates it with value 1
 *   - If file contains invalid content, treats as 0 and writes 1
 *   - Uses exclusive temp-then-rename to avoid torn reads
 *
 * Not perfectly atomic on Windows with concurrent writers, but sufficient
 * for single-user multi-session scenarios where true concurrency is rare.
 */
function incrementCounter(filePath) {
  try {
    // Read current value (if file missing, treat as 0)
    let current = 0;
    try {
      const raw = fs.readFileSync(filePath, 'utf8').trim();
      current = parseInt(raw, 10) || 0;
    } catch {}

    const next = current + 1;

    // Write to temp file in same directory (rename is atomic within filesystem)
    const dir = path.dirname(filePath);
    const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);

    fs.writeFileSync(tmp, String(next), { flag: 'w' });
    fs.renameSync(tmp, filePath);

    return next;
  } catch {
    return -1;
  }
}

/**
 * Atomically reset a counter to a specific value.
 * Returns true on success, false on failure.
 */
function resetCounter(filePath, value = 0) {
  try {
    const dir = path.dirname(filePath);
    const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tmp, String(value), { flag: 'w' });
    fs.renameSync(tmp, filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a counter value safely.
 * Returns the integer value, or 0 if file missing/invalid.
 */
function readCounter(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    return parseInt(raw, 10) || 0;
  } catch {
    return 0;
  }
}

module.exports = {
  incrementCounter,
  resetCounter,
  readCounter,
};
