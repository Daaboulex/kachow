#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// SessionEnd hook: minimal logger so session-close boundaries are observable.
// Claude Code had ZERO SessionEnd hooks before F6.A — clean session shutdowns
// were unmonitored. This emits one event per session end so we can track:
//   - session lifetime (start/end pair)
//   - exit reason (clear, resume, logout, prompt_input_exit, …)
//   - host + cwd + duration
//
// Uses observability-logger.js (same as emit-simple-timing). Idempotent —
// safe to fire multiple times if Claude Code fires SessionEnd more than once.
//
// Source spec: 2026-04-25-architecture-audit-master.md (R-AUDIT-4 F6).

const fs = require('fs');

function passthrough() {
  process.stdout.write('{"continue":true}');
  process.exit(0);
}

try {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { passthrough(); }
  const input = JSON.parse(raw || '{}');

  const reason = input.reason || input.matcher || input.event_kind || 'unknown';
  const cwd = input.cwd || process.cwd();
  const sessionId = input.session_id || null;

  try {
    const obs = require('./lib/observability-logger.js');
    obs.logEvent(cwd, {
      type: 'session_end',
      source: 'session-end-logger',
      session_id: sessionId,
      meta: {
        reason,
        cwd,
        ts: new Date().toISOString(),
      },
    });
  } catch (e) {
    try { process.stderr.write('session-end-logger (obs): ' + e.message + '\n'); } catch {}
  }

  passthrough();
} catch (e) {
  try { process.stderr.write('session-end-logger: ' + e.message + '\n'); } catch {}
  passthrough();
}
