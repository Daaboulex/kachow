// handoff-state.js — session state read/write for the handoff system.
//
// Manages structured JSON state files at ~/.ai-context/handoffs/sessions/<id>.json.
// Writes are atomic (tmp + rename on same filesystem) to prevent partial reads on crash.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const HANDOFFS_ROOT = path.join(HOME, '.ai-context', 'handoffs');

function ensureDirs() {
  for (const sub of ['sessions', 'projects', 'deferred', 'user-actions']) {
    fs.mkdirSync(path.join(HANDOFFS_ROOT, sub), { recursive: true });
  }
}

function sessionPath(sessionId) {
  return path.join(HANDOFFS_ROOT, 'sessions', sessionId + '.json');
}

function readState(sessionId) {
  try {
    return JSON.parse(fs.readFileSync(sessionPath(sessionId), 'utf8'));
  } catch {
    return null;
  }
}

function writeState(sessionId, state) {
  ensureDirs();
  const target = sessionPath(sessionId);
  const tmp = target + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, target);
}

function getSessionId(input, tool) {
  if (input && input.session_id) return String(input.session_id);

  const pointerPath = path.join(HANDOFFS_ROOT, 'sessions', '.current-session-' + tool + '.json');
  try {
    const data = JSON.parse(fs.readFileSync(pointerPath, 'utf8'));
    if (data.session_id) return data.session_id;
  } catch {}

  const fallbackId = os.hostname() + '-' + Math.floor(Date.now() / 1000);
  try {
    ensureDirs();
    fs.writeFileSync(pointerPath, JSON.stringify({
      session_id: fallbackId,
      tool,
      created_at: new Date().toISOString(),
    }));
  } catch {}
  return fallbackId;
}

function writePointer(sessionId, tool, projectKey) {
  ensureDirs();
  const pointerPath = path.join(HANDOFFS_ROOT, 'sessions', '.current-session-' + tool + '.json');
  fs.writeFileSync(pointerPath, JSON.stringify({
    session_id: sessionId,
    tool,
    project_key: projectKey,
    updated_at: new Date().toISOString(),
  }));
}

function newState(sessionId, tool, projectKey, cwd) {
  return {
    schema_version: 1,
    session_id: sessionId,
    tool,
    host: os.hostname(),
    project_key: projectKey,
    projects_touched: [projectKey],
    cwd,
    started_at: new Date().toISOString(),
    last_saved_at: new Date().toISOString(),
    ended_at: null,
    git_state: { branch: null, dirty_files: [], commits_ahead: 0, last_commit: null },
    files_changed: [],
    tasks: [],
    errors: [],
    tool_calls: { total: 0, edits: 0, reads: 0, bash: 0 },
    has_prose_handoff: false,
    summary: null,
  };
}

module.exports = { HANDOFFS_ROOT, ensureDirs, sessionPath, readState, writeState, getSessionId, writePointer, newState };
