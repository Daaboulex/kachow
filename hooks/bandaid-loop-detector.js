#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// PostToolUse hook: smart bandaid-loop detection.
//
// Distinguishes REAL loops (same region patched repeatedly, same error recurring)
// from HEALTHY iteration (TDD: edit → test → edit → test).
//
// Signals:
//   1. PRIMARY: consecutive edits to same file with NO Bash between = suspicious
//   2. SECONDARY: same normalized error after each fix attempt = stuck
//   3. TERTIARY: same region (old_string hash) edited repeatedly = patch-on-patch
//
// TDD-safe: Edit → Bash(test) → Edit → Bash(test) NEVER fires.
//
// State: per-session JSONL at <toolHome>/cache/edit-history/<sid>.jsonl
// Disable: SKIP_BANDAID_DETECT=1

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { toolHomeDir } = require('./lib/tool-detect.js');

const WINDOW = +process.env.BANDAID_WINDOW || 20;
const EDIT_THRESHOLD = +process.env.BANDAID_EDIT_THRESHOLD || 3;
const ERROR_THRESHOLD = +process.env.BANDAID_ERROR_THRESHOLD || 2;
const DEBOUNCE_MS = 120_000;

function passthrough() {
  process.stdout.write('{"continue":true}');
  process.exit(0);
}

function regionHash(toolInput) {
  if (!toolInput) return '';
  const src = toolInput.old_string || toolInput.content || '';
  if (!src) return '';
  return crypto.createHash('md5').update(src.slice(0, 500)).digest('hex').slice(0, 12);
}

function normalizeError(text) {
  if (!text) return '';
  return text
    .replace(/\/[\w\-./]+/g, '<PATH>')
    .replace(/:\d+:\d+/g, ':<L>:<C>')
    .replace(/0x[0-9a-f]+/gi, '<ADDR>')
    .replace(/\d{10,}/g, '<NUM>')
    .trim().slice(0, 200);
}

function looksLikeTest(cmd) {
  if (!cmd) return false;
  return /\b(test|jest|vitest|pytest|cargo\s+test|go\s+test|nix\s+flake\s+check|pio\s+run|npm\s+run\s+test|make\s+test|check|spec|bats)\b/i.test(cmd);
}

try {
  if (process.env.SKIP_BANDAID_DETECT === '1') passthrough();

  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }
  const input = JSON.parse(raw || '{}');

  const toolName = input.tool_name || '';
  const sessionId = input.session_id || '';
  if (!sessionId) passthrough();

  const isEdit = /^(Write|Edit|MultiEdit|replace|write_file|apply_patch)$/.test(toolName);
  const isBash = /^(Bash|shell|run_shell_command)$/.test(toolName);
  if (!isEdit && !isBash) passthrough();

  const cacheDir = path.join(toolHomeDir(), 'cache', 'edit-history');
  try { fs.mkdirSync(cacheDir, { recursive: true }); } catch {}
  const historyFile = path.join(cacheDir, `${sessionId}.jsonl`);
  const warnFile = path.join(cacheDir, `${sessionId}.warn.json`);
  const now = Date.now();

  if (isBash) {
    const cmd = (input.tool_input && input.tool_input.command) || '';
    const stderr = (input.tool_response && input.tool_response.stderr) || '';
    const kind = looksLikeTest(cmd) ? 'test' : 'bash';
    const err = normalizeError(stderr);
    try { fs.appendFileSync(historyFile, JSON.stringify({ ts: now, type: 'bash', kind, err }) + '\n'); } catch {}
    passthrough();
  }

  // Edit path
  const filePath = (input.tool_input && (input.tool_input.file_path || input.tool_input.absolute_path)) || '';
  if (!filePath) passthrough();

  const region = regionHash(input.tool_input);
  try { fs.appendFileSync(historyFile, JSON.stringify({ ts: now, type: 'edit', file: filePath, tool: toolName, region }) + '\n'); } catch {}

  // Read recent history
  let lines = [];
  try { lines = fs.readFileSync(historyFile, 'utf8').trim().split('\n').filter(Boolean); } catch {}
  const recent = lines.slice(-WINDOW).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

  // Find edits to same file (backward compat: old records without `type` have `file` but no `type` — treat as edit)
  const sameFileEdits = recent.filter(r => (r.type === 'edit' || (!r.type && r.file)) && r.file === filePath);
  if (sameFileEdits.length < EDIT_THRESHOLD) passthrough();

  // PRIMARY: check if Bash (especially test) happened between edits
  const firstEditIdx = recent.indexOf(sameFileEdits[sameFileEdits.length - EDIT_THRESHOLD]);
  const bashBetween = recent.slice(firstEditIdx).filter(r => r.type === 'bash');
  const testBetween = bashBetween.filter(r => r.kind === 'test');

  // If tests ran between edits, check if errors are CHANGING (progress) or STAGNATING (stuck)
  if (testBetween.length > 0) {
    const errHashes = testBetween.map(r => r.err).filter(Boolean);
    const uniqueErrors = new Set(errHashes);
    if (uniqueErrors.size > 1) passthrough(); // errors changing = progress
    if (errHashes.length < ERROR_THRESHOLD) passthrough(); // not enough data
    // Same error recurring after fixes = real stuck loop — fall through to warn
  } else if (bashBetween.length > 0) {
    // Non-test bash between edits — could be exploration. Less suspicious.
    if (sameFileEdits.length < EDIT_THRESHOLD + 2) passthrough();
  }
  // No bash at all between edits = definitely suspicious — fall through to warn

  // Debounce
  let warnState = {};
  try { warnState = JSON.parse(fs.readFileSync(warnFile, 'utf8')); } catch {}
  const lastWarn = warnState[filePath] || 0;
  if (now - lastWarn < DEBOUNCE_MS) passthrough();
  warnState[filePath] = now;
  try { fs.writeFileSync(warnFile, JSON.stringify(warnState)); } catch {}

  // Classify the warning
  const hasTests = testBetween.length > 0;
  const sameError = hasTests && new Set(testBetween.map(r => r.err).filter(Boolean)).size <= 1;
  const sameRegion = sameFileEdits.filter(r => r.region && r.region === region).length >= EDIT_THRESHOLD;

  let reason;
  if (sameError) {
    reason = `same error persists after ${sameFileEdits.length} fix attempts — the fixes aren't addressing root cause`;
  } else if (!bashBetween.length) {
    reason = `${sameFileEdits.length} consecutive edits with no test run between — verify the approach before continuing`;
  } else if (sameRegion) {
    reason = `same code region edited ${sameFileEdits.length}× — consider whether you're patching a symptom`;
  } else {
    reason = `${sameFileEdits.length} edits to this file in ${WINDOW} tool calls without clear progress`;
  }

  try {
    require('./lib/observability-logger.js').logEvent(process.cwd(), {
      type: 'bandaid_loop', source: 'bandaid-loop-detector', session_id: sessionId,
      meta: { file: filePath, edits: sameFileEdits.length, window: WINDOW, reason, hasTests, sameError, sameRegion }
    });
  } catch {}

  const msg = `[bandaid-loop] ${path.basename(filePath)}: ${reason}\n\nPause and ask: is this a symptom or root cause? Read surrounding logic, trace upstream, verify the premise.`;
  process.stdout.write(JSON.stringify({ continue: true, systemMessage: msg }));
  process.exit(0);
} catch {
  passthrough();
}
