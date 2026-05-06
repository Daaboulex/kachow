#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// PostToolUse/AfterTool hook — Task 2 per 2026-04-14-memory-architecture-v2.md Phase 3 (Rule M9)
// Logs memory-file Reads to per-machine retrieval log. Feeds detectors R11 (cold) + R12 (hot).
//
// Registered on: Claude PostToolUse (Read) + Gemini AfterTool (read_file).
// Normalizes tool names via TOOL_NORM convention (see feedback_tool_norm_convention.md).
// Per-machine filename (retrieval-log-<host>.jsonl) — Syncthing safe.
// Output file listed in ~/.claude/.stignore + ~/.gemini/.stignore.
//
// JSONL entry shape:
//   { ts, file, cwd, session_id, host, platform }
//
// Silent on errors. Hook never blocks tool flow.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { toolHomeDir } = require('./lib/tool-detect.js');

function normTool(name) {
  // TOOL_NORM — map Gemini → Claude names
  const map = { 'read_file': 'Read' };
  return map[name] || name;
}

try {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }
  const input = JSON.parse(raw || '{}');

  const tool = normTool(input.tool_name || '');
  if (tool !== 'Read') {
    process.stdout.write('{"continue":true}');
    process.exit(0);
  }

  // Extract file path (Claude: tool_input.file_path; Gemini: tool_input.absolute_path)
  const ti = input.tool_input || {};
  const filePath = ti.file_path || ti.absolute_path || ti.path || '';
  if (!filePath) {
    process.stdout.write('{"continue":true}');
    process.exit(0);
  }

  // Filter: only memory-dir Reads. Match .claude/memory/*.md or .gemini/memory/*.md
  // (exclude MEMORY.md — that's the index, always loaded).
  const normalized = filePath.replace(/\\/g, '/');
  const isMemoryFile = /\/(?:\.claude|\.gemini|\.ai-context)\/memory\/[^/]+\.md$/i.test(normalized)
    && !/\/MEMORY\.md$/i.test(normalized);
  if (!isMemoryFile) {
    process.stdout.write('{"continue":true}');
    process.exit(0);
  }

  // Resolve cache dir — always under ~/.claude/cache regardless of platform
  // (single per-machine log; both platforms feed same retrieval history).
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  const cacheDir = path.join(toolHomeDir(), 'cache');
  try { fs.mkdirSync(cacheDir, { recursive: true }); } catch {}

  const host = os.hostname();
  const logFile = path.join(cacheDir, `retrieval-log-${host}.jsonl`);

  const platform = require('./lib/tool-detect.js').detectTool();

  // Store relative-to-cwd path for portability across hosts
  const cwd = input.cwd || process.cwd();
  let relFile = normalized;
  try {
    const cwdNorm = cwd.replace(/\\/g, '/');
    if (normalized.startsWith(cwdNorm + '/')) relFile = normalized.slice(cwdNorm.length + 1);
  } catch {}

  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    file: relFile,
    abs: normalized,
    cwd,
    session_id: input.session_id || 'unknown',
    host,
    platform,
  }) + '\n';

  fs.appendFileSync(logFile, entry);

  // Observability bridge — feeds Tier 3 recurring-issues + skill-health synthesis
  try {
    require('./lib/observability-logger.js').logEvent(cwd, {
      type: 'memory_retrieval',
      source: 'memory-retrieval-logger',
      meta: { file: relFile, platform },
    });
  } catch {}

  process.stdout.write('{"continue":true}');
} catch {
  process.stdout.write('{"continue":true}');
}
