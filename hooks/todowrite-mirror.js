#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// PostToolUse hook for TodoWrite: cache the todo list per-session so Stop hook
// (todowrite-persist.js) can promote remaining in-progress/blocked tasks to
// AI-tasks.json at the project canonical location.
//
// Cache at ~/.claude/cache/todos/<session_id>.json. Removed by persist hook.
//
// Ref: unified-tracking plan Wave 2.8 (2026-04-16)

const fs = require('fs');
const path = require('path');
const os = require('os');
const { toolHomeDir, toolCacheDir } = require('./lib/tool-detect.js');

try {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }
  const input = JSON.parse(raw);

  const toolName = input.tool_name || '';
  // Claude: TodoWrite | Gemini: write_todos
  if (toolName !== 'TodoWrite' && toolName !== 'write_todos') {
    process.stdout.write('{"continue":true}');
    process.exit(0);
  }

  const sessionId = input.session_id || '';
  const todos = (input.tool_input || {}).todos || [];
  const cwd = input.cwd || process.cwd();

  if (!sessionId) {
    process.stdout.write('{"continue":true}');
    process.exit(0);
  }

  const cacheDir = path.join(toolHomeDir(), 'cache', 'todos');
  try { fs.mkdirSync(cacheDir, { recursive: true }); } catch {}
  const cachePath = path.join(cacheDir, `${sessionId}.json`);

  try {
    fs.writeFileSync(cachePath, JSON.stringify({
      session_id: sessionId,
      cwd: cwd,
      updated: new Date().toISOString(),
      todos: todos,
    }, null, 2));
  } catch (e) {
    try { process.stderr.write('todowrite-mirror: ' + e.message + '\n'); } catch {}
  }

  process.stdout.write('{"continue":true}');
} catch (e) {
  try { process.stderr.write('todowrite-mirror: ' + e.message + '\n'); } catch {}
  process.stdout.write('{"continue":true}');
}
