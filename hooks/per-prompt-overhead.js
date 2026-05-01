#!/usr/bin/env node
// per-prompt-overhead.js
// UserPromptSubmit hook — measures additionalContext bytes injected into prompt.
// Discovery D2 instrumentation. 2026-04-28.

const fs = require('fs');
const path = require('path');
const os = require('os');

let stdin = '';
process.stdin.on('data', chunk => { stdin += chunk; });
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(stdin || '{}');
    const additionalContext = payload?.hook_event_data?.additionalContext || '';
    const userPrompt = payload?.hook_event_data?.user_prompt || '';
    const totalBytes = Buffer.byteLength(additionalContext + userPrompt, 'utf8');
    const ctxBytes = Buffer.byteLength(additionalContext, 'utf8');

    const logDir = path.join(os.homedir(), '.ai-context', 'instances');
    fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, 'per-prompt-overhead.jsonl');
    const entry = {
      timestamp: new Date().toISOString(),
      session_id: payload?.session_id || process.env.SESSION_ID || 'unknown',
      cwd: payload?.cwd || process.cwd(),
      bytes: ctxBytes,
      total_bytes: totalBytes,
      source: 'user-prompt-submit',
    };
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
  } catch (_e) {
    // never block prompt
  }
  process.stdout.write(JSON.stringify({}));
});
