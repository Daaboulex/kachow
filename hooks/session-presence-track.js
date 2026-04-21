#!/usr/bin/env node
// PostToolUse hook: Track file touches + emit heartbeat every HEARTBEAT_INTERVAL tool calls.
// Core logic lives in lib/presence.js.

const fs = require('fs');
const p = require('./lib/presence.js');

try {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }
  const input = JSON.parse(raw);

  const cwd = input.cwd || process.cwd();
  const sessionId = input.session_id || '';
  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};

  if (!sessionId) { process.stdout.write('{"continue":true}'); process.exit(0); }

  if ((toolName === 'Write' || toolName === 'Edit' || toolName === 'MultiEdit') && toolInput.file_path) {
    p.appendToAll(cwd, {
      ts: new Date().toISOString(),
      event: 'file_touch',
      sid: sessionId,
      tool: toolName,
      file: toolInput.file_path,
    });
  }

  const count = p.bumpCounter(sessionId);
  if (count % p.HEARTBEAT_INTERVAL === 0) {
    p.appendToAll(cwd, {
      ts: new Date().toISOString(),
      event: 'heartbeat',
      sid: sessionId,
      tool_count: count,
    });
  }

  process.stdout.write('{"continue":true}');
} catch (e) {
  try { process.stderr.write('session-presence-track: ' + e.message + '\n'); } catch {}
  process.stdout.write('{"continue":true}');
}
