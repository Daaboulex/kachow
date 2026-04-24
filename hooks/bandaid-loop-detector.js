#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// PostToolUse hook: detect when agent edits the same file 3+ times within N tool calls.
// Signals a "bandaid loop" — iterating on symptoms instead of identifying root cause.
//
// The user's #1 documented frustration: bandaid solutions over root cause.
// Triple-iterating the same file is a strong signal the current approach isn't working.
//
// State: per-session JSONL at ~/.claude/cache/edit-history/<sid>.jsonl (rolling, keeps last 30 edits).
// Fires: systemMessage after 3rd edit to same file within last 10 edits.
// Debounce: don't re-fire on same file within 60s.
//
// Disable: SKIP_BANDAID_DETECT=1

const fs = require('fs');
const path = require('path');
const os = require('os');

const WINDOW = 10;         // look at last 10 edits
const THRESHOLD = 3;       // 3 edits to same file triggers warning
const DEBOUNCE_MS = 60_000;// don't re-warn within 60s per file

function passthrough() {
  process.stdout.write('{"continue":true}');
  process.exit(0);
}

try {
  if (process.env.SKIP_BANDAID_DETECT === '1') passthrough();

  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }
  const input = JSON.parse(raw || '{}');

  const toolName = input.tool_name || '';
  if (!/^(Write|Edit|MultiEdit|replace|write_file)$/.test(toolName)) passthrough();

  const sessionId = input.session_id || '';
  if (!sessionId) passthrough();

  const filePath = (input.tool_input && (input.tool_input.file_path || input.tool_input.absolute_path)) || '';
  if (!filePath) passthrough();

  const cacheDir = path.join(os.homedir(), '.claude', 'cache', 'edit-history');
  try { fs.mkdirSync(cacheDir, { recursive: true }); } catch {}
  const historyFile = path.join(cacheDir, `${sessionId}.jsonl`);
  const warnFile = path.join(cacheDir, `${sessionId}.warn.json`);

  // Append current edit
  const now = Date.now();
  try { fs.appendFileSync(historyFile, JSON.stringify({ ts: now, file: filePath, tool: toolName }) + '\n'); } catch {}

  // Read last WINDOW edits
  let lines = [];
  try { lines = fs.readFileSync(historyFile, 'utf8').trim().split('\n').filter(Boolean); } catch {}
  const recent = lines.slice(-WINDOW).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

  const sameFileCount = recent.filter(r => r.file === filePath).length;
  if (sameFileCount < THRESHOLD) passthrough();

  // Debounce — already warned about this file recently?
  let warnState = {};
  try { warnState = JSON.parse(fs.readFileSync(warnFile, 'utf8')); } catch {}
  const lastWarn = warnState[filePath] || 0;
  if (now - lastWarn < DEBOUNCE_MS) passthrough();

  warnState[filePath] = now;
  try { fs.writeFileSync(warnFile, JSON.stringify(warnState)); } catch {}

  // R17 support (v0.2.0): emit bandaid_loop event for skill→loop correlation.
  try {
    const obs = require('./lib/observability-logger.js');
    obs.logEvent(process.cwd(), {
      type: 'bandaid_loop',
      source: 'bandaid-loop-detector',
      session_id: sid,
      meta: { file: filePath, same_file_count: sameFileCount, window: WINDOW }
    });
  } catch {}

  const msg = `[bandaid-loop] ${path.basename(filePath)} edited ${sameFileCount}× in the last ${WINDOW} tool calls. Bandaid fixes are a common AI failure mode — pause and ask: is this a symptom or root cause? Read the surrounding logic, trace upstream callers, verify the premise before the next edit.`;
  process.stdout.write(JSON.stringify({ continue: true, systemMessage: msg }));
  process.exit(0);
} catch {
  passthrough();
}
