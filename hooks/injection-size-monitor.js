#!/usr/bin/env node
// injection-size-monitor.js — SessionStart hook
// Monitors total bytes injected by all SessionStart hooks.
// If total exceeds threshold, warns on stderr (not model context).
// Prevents silent context pollution from runaway hooks.

const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_TOTAL_BYTES = parseInt(process.env.INJECTION_SIZE_LIMIT, 10) || 5000;

try {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }
  const input = JSON.parse(raw);

  // Read the per-prompt-overhead log for this session's SessionStart entries
  const logPath = path.join(os.homedir(), '.ai-context', 'instances', 'per-prompt-overhead.jsonl');
  if (!fs.existsSync(logPath)) {
    process.stdout.write('{"continue":true}');
    process.exit(0);
  }

  const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
  const sessionId = input.session_id || '';

  // Find entries from this session's SessionStart
  const sessionEntries = lines
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(e => e && e.session_id === sessionId && e.source === 'session-context-loader');

  const totalBytes = sessionEntries.reduce((sum, e) => sum + (e.bytes || 0), 0);

  if (totalBytes > MAX_TOTAL_BYTES) {
    process.stderr.write(
      `[injection-monitor] WARNING: SessionStart injected ${totalBytes}B (limit: ${MAX_TOTAL_BYTES}B). ` +
      `Check hooks via: ~/.ai-context/scripts/hook-debug.mjs SessionStart --verbose\n`
    );
  }

  // Log this check
  const checkDir = path.join(os.homedir(), '.ai-context', 'instances');
  fs.mkdirSync(checkDir, { recursive: true });
  fs.appendFileSync(
    path.join(checkDir, 'injection-monitor.jsonl'),
    JSON.stringify({
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      total_bytes: totalBytes,
      threshold: MAX_TOTAL_BYTES,
      exceeded: totalBytes > MAX_TOTAL_BYTES,
    }) + '\n'
  );
} catch {}

process.stdout.write('{"continue":true}');
