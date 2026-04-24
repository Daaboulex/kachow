#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// Stop hook: mark session ended + clean counter.
// Core helpers live in lib/presence.js.

const fs = require('fs');
const p = require('./lib/presence.js');

try {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }
  const input = JSON.parse(raw);

  const cwd = input.cwd || process.cwd();
  const sessionId = input.session_id || '';
  if (!sessionId) { process.stdout.write('{"continue":true}'); process.exit(0); }

  p.appendToAll(cwd, {
    ts: new Date().toISOString(),
    event: 'end',
    sid: sessionId,
    host: require('os').hostname(),
    reason: input.reason || 'stop',
  });

  p.clearCounter(sessionId);

  process.stdout.write('{"continue":true}');
} catch (e) {
  try { process.stderr.write('session-presence-end: ' + e.message + '\n'); } catch {}
  process.stdout.write('{"continue":true}');
}
