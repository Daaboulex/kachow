#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// PostToolUse hook: correlate tool outcomes back to recent skill invocations.
// Discovery D3 — upgrades outcome field from 'invoked' to 'errored' or 'completed'.
// Misattribution defense: only upgrades for the IMMEDIATELY-NEXT tool after skill invoke.

const fs = require('fs');
const path = require('path');
const os = require('os');

function passthrough() {
  process.stdout.write('{"continue":true}');
  process.exit(0);
}

try {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }
  const input = JSON.parse(raw);

  if (input.tool_name === 'Skill') passthrough();

  const sessionId = input.session_id || 'unknown';
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  const tool = require(__dirname + '/lib/tool-detect.js').detectTool();
  const configDir = path.join(home, tool === 'gemini' ? '.gemini' : '.claude');
  const logPath = path.join(configDir, `.skill-log-${sessionId}.jsonl`);

  if (!fs.existsSync(logPath)) passthrough();

  const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
  if (lines.length === 0) passthrough();

  const lastIdx = lines.length - 1;
  let lastEntry;
  try { lastEntry = JSON.parse(lines[lastIdx]); } catch { passthrough(); }

  if (lastEntry.outcome !== 'invoked') passthrough();

  const ageMs = Date.now() - Date.parse(lastEntry.timestamp);
  if (ageMs > 60000) passthrough();

  // Misattribution defense: check if any tool already fired after this skill
  // invocation by looking at log line count. If more lines exist after the
  // skill entry, another tool already claimed the correlation.
  // The logger appends one line per Skill invoke. If lastIdx is the most
  // recent and it's 'invoked', this is the first tool after the skill.

  const errored = input.tool_response?.is_error === true;
  lastEntry.outcome = errored ? 'errored' : 'completed';
  lastEntry.tool_response_correlation = input.tool_use_id || null;

  lines[lastIdx] = JSON.stringify(lastEntry);
  fs.writeFileSync(logPath, lines.join('\n') + '\n');

  process.stdout.write('{"continue":true}');
} catch {
  process.stdout.write('{"continue":true}');
}
