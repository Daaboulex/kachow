// Shared session state between hooks within one session.
// Usage: const state = require('./lib/session-state.js');
//        state.increment('edits'); state.get('edits'); state.set('lastFile', 'foo.js');

const fs = require('fs');
const path = require('path');
const os = require('os');

const CACHE_DIR = path.join(os.homedir(), '.claude', 'cache');
const STALE_MS = 24 * 60 * 60 * 1000;

function stateFile(sessionId) {
  const safe = String(sessionId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(CACHE_DIR, `session-state-${safe}.json`);
}

function load(sessionId) {
  try {
    return JSON.parse(fs.readFileSync(stateFile(sessionId), 'utf8'));
  } catch { return {}; }
}

function save(sessionId, data) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(stateFile(sessionId), JSON.stringify(data));
  } catch {}
}

function increment(sessionId, key) {
  const d = load(sessionId);
  d[key] = (d[key] || 0) + 1;
  save(sessionId, d);
  return d[key];
}

function get(sessionId, key) {
  return load(sessionId)[key];
}

function set(sessionId, key, value) {
  const d = load(sessionId);
  d[key] = value;
  save(sessionId, d);
}

function cleanup() {
  try {
    const cutoff = Date.now() - STALE_MS;
    for (const f of fs.readdirSync(CACHE_DIR)) {
      if (!f.startsWith('session-state-')) continue;
      const fp = path.join(CACHE_DIR, f);
      try { if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp); } catch {}
    }
  } catch {}
}

module.exports = { load, save, increment, get, set, cleanup };
