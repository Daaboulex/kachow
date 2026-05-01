#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// Stop hook: Promote in-progress + blocked todos from session cache into
// AI-tasks.json at the project canonical location. Done todos go into
// completed_log (rotating cap 50). Pending todos are dropped (ephemeral).
//
// Orphan fallback: if cwd has no canonical dir (.claude/ or .ai-context/),
// writes cache to ~/.claude/cache/orphan-todos/<date>.json so nothing is lost.
//
// v3 schema:
//   { version: 3, updated, tasks: [], completed_log: [] }
//
// Ref: unified-tracking plan Wave 2.8 (2026-04-16)

const fs = require('fs');
const path = require('path');
const os = require('os');
const { toolHomeDir, toolCacheDir } = require('./lib/tool-detect.js');

function findCanonicalDir(cwd) {
  for (const candidate of ['.claude', '.ai-context']) {
    const p = path.join(cwd, candidate);
    try {
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return p;
    } catch {}
  }
  return null;
}

try {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }
  const input = JSON.parse(raw);

  const sessionId = input.session_id || '';
  const cwd = input.cwd || process.cwd();

  if (!sessionId) { process.stdout.write('{"continue":true}'); process.exit(0); }

  // Read session todo cache
  const cachePath = path.join(toolHomeDir(), 'cache', 'todos', `${sessionId}.json`);
  if (!fs.existsSync(cachePath)) { process.stdout.write('{"continue":true}'); process.exit(0); }

  let cache;
  try { cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch {
    process.stdout.write('{"continue":true}');
    process.exit(0);
  }
  const todos = cache.todos || [];
  if (todos.length === 0) {
    try { fs.unlinkSync(cachePath); } catch {}
    process.stdout.write('{"continue":true}');
    process.exit(0);
  }

  // Find canonical dir or fall back to orphan cache
  const canonicalDir = findCanonicalDir(cwd);

  if (!canonicalDir) {
    // Orphan fallback — preserve todos even when no project dir
    try {
      const orphanDir = path.join(toolHomeDir(), 'cache', 'orphan-todos');
      fs.mkdirSync(orphanDir, { recursive: true });
      const dateStr = new Date().toISOString().slice(0, 10);
      const orphanPath = path.join(orphanDir, `${dateStr}-${sessionId}.json`);
      fs.writeFileSync(orphanPath, JSON.stringify({
        session_id: sessionId,
        cwd: cwd,
        saved_at: new Date().toISOString(),
        todos: todos,
        note: 'cwd had no .claude/ or .ai-context/ canonical dir — preserved here instead',
      }, null, 2));
      try { fs.unlinkSync(cachePath); } catch {}
      process.stdout.write(JSON.stringify({
        continue: true,
        systemMessage: `[Tasks] ${todos.length} todo(s) saved to orphan cache (${dateStr}) — no project canonical dir in ${cwd}`
      }));
    } catch {
      process.stdout.write('{"continue":true}');
    }
    process.exit(0);
  }

  const tasksPath = path.join(canonicalDir, 'AI-tasks.json');

  // Load existing AI-tasks.json or init v3
  let aiTasks = { version: 3, updated: '', tasks: [], completed_log: [] };
  if (fs.existsSync(tasksPath)) {
    try { aiTasks = JSON.parse(fs.readFileSync(tasksPath, 'utf8')); } catch {}
    if (typeof aiTasks !== 'object' || aiTasks === null) aiTasks = {};
    if (!aiTasks.version) aiTasks.version = 3;
    if (!Array.isArray(aiTasks.tasks)) aiTasks.tasks = [];
    if (!Array.isArray(aiTasks.completed_log)) aiTasks.completed_log = [];
  }

  // Index existing by id
  const byId = new Map(aiTasks.tasks.map(t => [t.id, t]));
  const agent = process.argv[1].includes('/.gemini/') ? 'gemini' : 'claude';

  let changed = false;
  const now = new Date().toISOString();

  for (let i = 0; i < todos.length; i++) {
    const todo = todos[i];
    const id = todo.id || `todo-${sessionId}-${i}`;
    const status = todo.status;

    if (status === 'in_progress' || status === 'blocked') {
      const existing = byId.get(id) || {};
      const updated = {
        ...existing,
        id: id,
        title: todo.content || todo.activeForm || existing.title || '(untitled)',
        status: status,
        source: 'todowrite',
        source_ref: sessionId,
        created: existing.created || now,
        verifiedBy: existing.verifiedBy || 'not-verified',
        agent_last_worked: agent,
        updated: now,
      };
      byId.set(id, updated);
      changed = true;
    } else if (status === 'done') {
      if (byId.has(id)) {
        const done = byId.get(id);
        aiTasks.completed_log.unshift({
          id: done.id,
          title: done.title,
          completed_at: now,
          verified_by: done.verifiedBy || 'not-verified',
        });
        byId.delete(id);
        changed = true;
      } else {
        // Task was done within same session (never persisted as in-progress);
        // still log it
        aiTasks.completed_log.unshift({
          id: id,
          title: todo.content || todo.activeForm || '(untitled)',
          completed_at: now,
          verified_by: 'not-verified',
        });
        changed = true;
      }
    }
    // 'pending' todos are ephemeral — don't promote
  }

  if (!changed) {
    try { fs.unlinkSync(cachePath); } catch {}
    process.stdout.write('{"continue":true}');
    process.exit(0);
  }

  aiTasks.tasks = [...byId.values()];
  aiTasks.completed_log = aiTasks.completed_log.slice(0, 50);
  aiTasks.updated = now;

  try {
    fs.writeFileSync(tasksPath, JSON.stringify(aiTasks, null, 2));
  } catch (e) {
    // Write failed — preserve cache (don't unlink) so next session can retry,
    // AND surface warning via systemMessage so failure is observable (not silent).
    try { process.stderr.write('todowrite-persist: ' + e.message + '\n'); } catch {}
    process.stdout.write(JSON.stringify({
      continue: true,
      systemMessage: `[Tasks] ⚠ FAILED to write AI-tasks.json to ${tasksPath}: ${e.message}. Cache preserved at ${cachePath} for retry.`
    }));
    process.exit(0);
  }

  // Clean up session cache (only on successful write)
  try { fs.unlinkSync(cachePath); } catch {}

  process.stdout.write(JSON.stringify({
    continue: true,
    systemMessage: `[Tasks] Persisted ${aiTasks.tasks.length} open task(s) to ${path.basename(canonicalDir)}/AI-tasks.json`
  }));
} catch (e) {
  // Outer catch — something catastrophic. Surface via systemMessage, don't silent-pass.
  try { process.stderr.write('todowrite-persist: ' + e.message + '\n'); } catch {}
  process.stdout.write(JSON.stringify({
    continue: true,
    systemMessage: `[Tasks] ⚠ todowrite-persist error: ${e.message}. Session todos may not have persisted — check stderr.`
  }));
}
