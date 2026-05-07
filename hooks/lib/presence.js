// Shared helpers for session-presence-{start,track,end}.js
// Deduplicates findCanonicalDir / rotation / append logic.
// Ref: unified-tracking plan Wave 2.7 (2026-04-16)

const fs = require('fs');
const path = require('path');
const os = require('os');

const RETAIN_LIVE_LINES = 500;
const ROTATE_THRESHOLD = 5000;
const HEARTBEAT_INTERVAL = 10;

const { findCanonicalDir } = require('./tool-paths.js');

function globalPresencePath() {
  // Per-host shard — avoids Syncthing merge-conflicts across machines.
  const { perHostPresencePath } = require('./hostname-presence.js');
  return perHostPresencePath();
}

function readActiveSessionsAllHosts(sinceMs) {
  const { readAllHostSessions } = require('./hostname-presence.js');
  return readAllHostSessions(sinceMs, readActiveSessions);
}

function projectPresencePath(cwd) {
  const canonical = findCanonicalDir(cwd);
  if (!canonical) return null;
  const { hostname } = require('./hostname-presence.js');
  return path.join(canonical, `active-sessions-${hostname()}.jsonl`);
}

function readProjectSessionsAllHosts(cwd, sinceMs) {
  const canonical = findCanonicalDir(cwd);
  if (!canonical) return [];
  try {
    const files = fs.readdirSync(canonical)
      .filter(f => f.startsWith('active-sessions-') && f.endsWith('.jsonl'))
      .map(f => path.join(canonical, f));
    const byKey = new Map();
    for (const fp of files) {
      const sessions = readActiveSessions(fp, sinceMs) || [];
      for (const s of sessions) {
        const host = s.host || path.basename(fp).replace(/^active-sessions-|\.jsonl$/g, '');
        const key = `${s.sid}@${host}`;
        const ts = s.ts ? (typeof s.ts === 'number' ? s.ts : new Date(s.ts).getTime()) : 0;
        if (!byKey.has(key) || (byKey.get(key)._cmpTs || 0) < ts) {
          byKey.set(key, { ...s, host, _cmpTs: ts });
        }
      }
    }
    return [...byKey.values()].map(s => { delete s._cmpTs; return s; });
  } catch { return []; }
}

function rotateIfNeeded(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    if (lines.length < ROTATE_THRESHOLD) return;

    // Lock-then-rotate (CG-3 fix 2026-04-29). Exclusive lockfile create
    // ensures only one session rotates per tick. Concurrent sessions skip
    // rotation cleanly — at-most-N+ROTATE_THRESHOLD entries before the next
    // session rotates. Prevents the prior race where two sessions would each
    // copyFileSync→renameSync, with the second overwriting the first's
    // backup data.
    const lockPath = filePath + '.rotate.lock';
    let lockFd;
    try {
      lockFd = fs.openSync(lockPath, 'wx');
    } catch (e) {
      // Another session holds the lock OR a stale lock from a crashed session.
      // If the lock file is older than 60s, treat as stale and reclaim.
      try {
        const lockAge = Date.now() - fs.statSync(lockPath).mtimeMs;
        if (lockAge > 60000) {
          fs.unlinkSync(lockPath);
          lockFd = fs.openSync(lockPath, 'wx');
        } else {
          return; // active rotation in progress; skip this tick
        }
      } catch { return; }
    }

    try {
      const oldPath = filePath + '.old.jsonl';
      const tmpOld = oldPath + '.' + process.pid + '.' + Date.now() + '.tmp';
      const tmpNew = filePath + '.' + process.pid + '.' + Date.now() + '.tmp';
      fs.copyFileSync(filePath, tmpOld);
      fs.renameSync(tmpOld, oldPath);
      fs.writeFileSync(tmpNew, lines.slice(-RETAIN_LIVE_LINES).join('\n') + '\n');
      fs.renameSync(tmpNew, filePath);
    } finally {
      try { fs.closeSync(lockFd); } catch {}
      try { fs.unlinkSync(lockPath); } catch {}
    }
  } catch {}
}

function readActiveSessions(filePath, sinceMs) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    const bySid = new Map();
    for (const line of lines) {
      try {
        const rec = JSON.parse(line);
        const ts = new Date(rec.ts).getTime();
        if (ts < sinceMs) continue;
        if (rec.event === 'end') {
          bySid.delete(rec.sid);
        } else if (rec.event === 'start') {
          const existing = bySid.get(rec.sid);
          if (!existing || existing.ts < ts) bySid.set(rec.sid, { ...rec, ts });
        } else if (rec.event === 'heartbeat') {
          // Heartbeat records lack agent/host/cwd — only update ts on existing.
          // If no start record exists (e.g. file_touch resurrection after end),
          // ignore the heartbeat instead of inserting a fields-undefined peer.
          // Bug fixed 2026-04-29 — was producing "undefined@undefined" peer.
          const existing = bySid.get(rec.sid);
          if (existing) { existing.ts = ts; bySid.set(rec.sid, existing); }
        }
      } catch {}
    }
    return [...bySid.values()];
  } catch { return []; }
}

function appendJsonl(filePath, record) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    rotateIfNeeded(filePath);
    fs.appendFileSync(filePath, JSON.stringify(record) + '\n');
  } catch {}
}

function appendToAll(cwd, record) {
  appendJsonl(globalPresencePath(), record);
  const proj = projectPresencePath(cwd);
  if (proj) appendJsonl(proj, record);
}

function sessionCounterPath(sessionId) {
  const dir = path.join(os.homedir(), '.claude', 'cache', 'session-counters');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  return path.join(dir, `${sessionId}.count`);
}

function bumpCounter(sessionId) {
  const p = sessionCounterPath(sessionId);
  let count = 0;
  try { count = parseInt(fs.readFileSync(p, 'utf8'), 10) || 0; } catch {}
  count++;
  try { fs.writeFileSync(p, String(count)); } catch {}
  return count;
}

function clearCounter(sessionId) {
  try { fs.unlinkSync(sessionCounterPath(sessionId)); } catch {}
}

module.exports = {
  RETAIN_LIVE_LINES, ROTATE_THRESHOLD, HEARTBEAT_INTERVAL,
  findCanonicalDir, globalPresencePath, projectPresencePath,
  appendJsonl, appendToAll, bumpCounter, clearCounter,
  readActiveSessions, readActiveSessionsAllHosts, readProjectSessionsAllHosts,
};
