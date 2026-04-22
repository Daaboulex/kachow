// hostname-presence.js
// Per-host presence filename + multi-host merged reader.
// User runs macbook-pro-9-2 + ryzen-9950x3d. ~/.claude/cache/ may be Syncthing-synced,
// in which case a single active-sessions-global.jsonl would merge-conflict and
// confuse peer counts across hosts. Sharding by hostname avoids this.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

function hostname() {
  try {
    return (os.hostname() || 'unknown-host').replace(/[^a-zA-Z0-9-]/g, '-');
  } catch {
    return 'unknown-host';
  }
}

function perHostPresencePath() {
  return path.join(os.homedir(), '.claude', 'cache',
    `active-sessions-global-${hostname()}.jsonl`);
}

function allHostPresencePaths() {
  const dir = path.join(os.homedir(), '.claude', 'cache');
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir)
      .filter(f => f.startsWith('active-sessions-global-') && f.endsWith('.jsonl'))
      .map(f => path.join(dir, f));
  } catch {
    return [];
  }
}

// Accepts a per-file reader (to avoid circular require with lib/presence.js).
// readSingle(filePath, sinceMs) → array of session records.
function readAllHostSessions(sinceMs, readSingle) {
  const paths = allHostPresencePaths();
  const byKey = new Map();
  for (const p of paths) {
    const sessions = readSingle(p, sinceMs) || [];
    for (const s of sessions) {
      const host = s.host || path.basename(p).replace(/^active-sessions-global-|\.jsonl$/g, '');
      const key = `${s.sid}@${host}`;
      const ts = s.ts ? (typeof s.ts === 'number' ? s.ts : new Date(s.ts).getTime()) : 0;
      if (!byKey.has(key) || (byKey.get(key)._cmpTs || 0) < ts) {
        byKey.set(key, { ...s, host, _cmpTs: ts });
      }
    }
  }
  return [...byKey.values()].map(s => { delete s._cmpTs; return s; });
}

module.exports = {
  hostname,
  perHostPresencePath,
  allHostPresencePaths,
  readAllHostSessions,
};
