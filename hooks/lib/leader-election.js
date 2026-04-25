// leader-election.js
// Minimal file-lock leader election for /consolidate-memory Phase 3.5.
//
// Solo-host case: prevents two concurrent /consolidate-memory runs in the same
// memory dir from racing on the same Tier 3 semantic synthesis. Cross-machine
// coordination not implemented (per handoff: solo-host case doesn't need it).
//
// Lock format: {memoryDir}/semantic/.tier3-lock.json with content:
//   { pid, hostname, ts }
//
// Stale detection: lock with mtime > 30 min is considered abandoned and the
// caller may take it. 30 min is generous because Tier 3 synthesis can be slow.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const STALE_MS = 30 * 60 * 1000;
const LOCK_NAME = '.tier3-lock.json';

function readLock(lockPath) {
  try {
    const raw = fs.readFileSync(lockPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function ageMinutes(lockPath) {
  try {
    const st = fs.statSync(lockPath);
    return Math.round((Date.now() - st.mtimeMs) / 60000);
  } catch {
    return null;
  }
}

function acquireLock(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
  const lockPath = path.join(dir, LOCK_NAME);

  if (fs.existsSync(lockPath)) {
    const age = ageMinutes(lockPath);
    const held = readLock(lockPath);
    const stale = age !== null && age * 60000 > STALE_MS;

    if (!stale) {
      return {
        acquired: false,
        holder: held ? `${held.hostname}:${held.pid}` : 'unknown',
        ageMinutes: age,
        stale: false,
      };
    }
    // Stale — take it.
  }

  const lock = {
    pid: process.pid,
    hostname: os.hostname(),
    ts: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2));
    return { acquired: true, holder: `${lock.hostname}:${lock.pid}`, ageMinutes: 0, stale: false };
  } catch (e) {
    return { acquired: false, holder: null, ageMinutes: null, error: e.message };
  }
}

function releaseLock(dir) {
  const lockPath = path.join(dir, LOCK_NAME);
  try {
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
      return { released: true };
    }
    return { released: false, reason: 'no-lock' };
  } catch (e) {
    return { released: false, error: e.message };
  }
}

function isHeld(dir) {
  const lockPath = path.join(dir, LOCK_NAME);
  if (!fs.existsSync(lockPath)) return { held: false };
  const age = ageMinutes(lockPath);
  const stale = age !== null && age * 60000 > STALE_MS;
  return { held: !stale, holder: readLock(lockPath), ageMinutes: age, stale };
}

module.exports = { acquireLock, releaseLock, isHeld };
