#!/usr/bin/env node
// prompt-hash-logger.js — Discovery D4.
// UserPromptSubmit. Hashes normalized prompt; appends to JSONL.
// Normalization option-2: keep /cmdname, drop args after; lowercase; collapse whitespace.

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const os = require('os');

function normalize(prompt) {
  let p = (prompt || '').trim().toLowerCase();
  p = p.replace(/\s+/g, ' ');
  if (p.startsWith('/')) {
    const cmdMatch = p.match(/^(\/[a-z0-9_:-]+)/);
    if (cmdMatch) p = cmdMatch[1];
  }
  return p;
}

let stdin = '';
process.stdin.on('data', c => { stdin += c; });
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(stdin || '{}');
    const userPrompt = payload?.hook_event_data?.user_prompt || '';
    const normalized = normalize(userPrompt);
    const hash = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);

    const logDir = path.join(os.homedir(), '.ai-context', 'instances');
    fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, 'prompt-hashes.jsonl');
    const entry = {
      timestamp: new Date().toISOString(),
      session_id: payload?.session_id || 'unknown',
      cwd: payload?.cwd || process.cwd(),
      prompt_hash: hash,
      normalized_length: normalized.length,
      is_slash_cmd: normalized.startsWith('/'),
    };
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
  } catch (_e) {
    // never block prompt
  }
  process.stdout.write(JSON.stringify({}));
});
