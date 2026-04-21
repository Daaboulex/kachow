// Shared helpers for session-presence-{start,track,end}.js
// Deduplicates findCanonicalDir / rotation / append logic.
// Ref: unified-tracking plan Wave 2.7 (2026-04-16)

const fs = require('fs');
const path = require('path');
const os = require('os');

const RETAIN_LIVE_LINES = 500;
const ROTATE_THRESHOLD = 5000;
const HEARTBEAT_INTERVAL = 10;

function findCanonicalDir(cwd) {
  for (const candidate of ['.claude', '.ai-context']) {
    const p = path.join(cwd, candidate);
    try {
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return p;
    } catch {}
  }
  return null;
}

function globalPresencePath() {
  return path.join(os.homedir(), '.claude', 'cache', 'active-sessions-global.jsonl');
}

function projectPresencePath(cwd) {
  const canonical = findCanonicalDir(cwd);
  return canonical ? path.join(canonical, 'active-sessions.jsonl') : null;
}

function rotateIfNeeded(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    if (lines.length < ROTATE_THRESHOLD) return;
    // Atomic rotation: copy → rename old, write truncated to temp → rename.
    // Prevents race if two sessions rotate within same tick.
    const oldPath = filePath + '.old.jsonl';
    const tmpOld = oldPath + '.' + process.pid + '.' + Date.now() + '.tmp';
    const tmpNew = filePath + '.' + process.pid + '.' + Date.now() + '.tmp';
    fs.copyFileSync(filePath, tmpOld);
    fs.renameSync(tmpOld, oldPath);
    fs.writeFileSync(tmpNew, lines.slice(-RETAIN_LIVE_LINES).join('\n') + '\n');
    fs.renameSync(tmpNew, filePath);
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
        } else if (rec.event === 'start' || rec.event === 'heartbeat') {
          const existing = bySid.get(rec.sid);
          if (!existing || existing.ts < ts) bySid.set(rec.sid, { ...rec, ts });
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
  readActiveSessions,
};
