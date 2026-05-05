#!/usr/bin/env node
'use strict';
// PostToolUse hook: incremental session state capture after writes/edits.
//
// Fires after Write/Edit/Bash/TaskCreate/TaskUpdate. Saves structured state
// to ~/.ai-context/handoffs/sessions/<session-id>.json.
//
// Performance: <50ms non-git path. Git refresh <200ms, cached 30s.
// Debounce: skip if last save <5s ago (except errors — always saved).
//
// Disable: SKIP_HANDOFF_AUTOSAVE=1

const fs = require('fs');
const path = require('path');

function passthrough() {
  process.stdout.write('{"continue":true}');
  process.exit(0);
}

try {
  if (process.env.SKIP_HANDOFF_AUTOSAVE === '1') passthrough();

  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }
  const input = JSON.parse(raw || '{}');

  const toolName = input.tool_name || '';
  if (!/^(Write|Edit|MultiEdit|Bash|TaskCreate|TaskUpdate|write_file|replace|run_shell_command|shell)$/i.test(toolName)) {
    passthrough();
  }

  const { deriveProjectKeyCached, gitRootFor } = require('./lib/project-key.js');
  const { getSessionId, readState, writeState, writePointer, newState, HANDOFFS_ROOT } = require('./lib/handoff-state.js');
  const { detectTool } = require('./lib/tool-detect.js');

  const tool = detectTool();
  const cwd = process.cwd();
  const sessionId = getSessionId(input, tool);
  const proj = deriveProjectKeyCached(cwd);
  const isError = !!(input.tool_response && input.tool_response.is_error);

  // Debounce: skip if last save <5s ago (except errors)
  const debounceFile = path.join(HANDOFFS_ROOT, 'sessions', '.debounce-' + sessionId);
  if (!isError) {
    try {
      const lastSave = fs.statSync(debounceFile).mtimeMs;
      if (Date.now() - lastSave < 5000) passthrough();
    } catch {}
  }

  // Read or create state
  let state = readState(sessionId);
  if (!state) {
    state = newState(sessionId, tool, proj.key, cwd);
    writePointer(sessionId, tool, proj.key);
  }

  const now = new Date().toISOString();

  // ── Write/Edit: track file changes + cross-project detection ──
  if (/^(Write|Edit|MultiEdit|write_file|replace)$/i.test(toolName)) {
    const filePath = (input.tool_input && (input.tool_input.file_path || input.tool_input.absolute_path)) || '';
    if (filePath) {
      state.files_changed = state.files_changed.filter(f => f.path !== filePath);
      const action = /^(Write|write_file)$/i.test(toolName) ? 'create' : 'edit';
      state.files_changed.push({ path: filePath, action, at: now });

      // Cross-project detection via git root comparison
      const fileGitRoot = gitRootFor(filePath);
      const cwdGitRoot = gitRootFor(cwd);
      if (fileGitRoot && cwdGitRoot && fileGitRoot !== cwdGitRoot) {
        const otherProj = deriveProjectKeyCached(fileGitRoot);
        if (!state.projects_touched.includes(otherProj.key)) {
          state.projects_touched.push(otherProj.key);
        }
      }
    }
    state.tool_calls.edits = (state.tool_calls.edits || 0) + 1;
  }

  // ── Bash: detect git commands → refresh git state (cached 30s) ──
  if (/^(Bash|run_shell_command|shell)$/i.test(toolName)) {
    const command = (input.tool_input && (input.tool_input.command || input.tool_input.input)) || '';
    if (/\bgit\s+(commit|checkout|push|merge|rebase|reset|pull|switch|stash)\b/.test(command)) {
      const gitCacheFile = path.join(HANDOFFS_ROOT, 'sessions', '.git-cache-' + sessionId);
      let shouldRefresh = true;
      try {
        if (Date.now() - fs.statSync(gitCacheFile).mtimeMs < 30000) shouldRefresh = false;
      } catch {}

      if (shouldRefresh) {
        try {
          const { execSync } = require('child_process');
          const opts = { cwd, timeout: 2000, stdio: ['pipe', 'pipe', 'pipe'] };
          const branch = execSync('git rev-parse --abbrev-ref HEAD 2>/dev/null', opts).toString().trim();
          const status = execSync('git status --porcelain 2>/dev/null', opts).toString().trim();
          const logLine = execSync('git log --oneline -1 2>/dev/null', opts).toString().trim();
          state.git_state = {
            branch,
            dirty_files: status ? status.split('\n').map(l => l.trim().split(/\s+/).slice(1).join(' ')) : [],
            commits_ahead: 0,
            last_commit: logLine || null,
          };
          try { fs.writeFileSync(gitCacheFile, ''); } catch {}
        } catch {}
      }
    }
    state.tool_calls.bash = (state.tool_calls.bash || 0) + 1;
  }

  // ── TaskCreate/TaskUpdate: track tasks ──
  if (/^TaskCreate$/i.test(toolName)) {
    const td = input.tool_input || {};
    if (td.subject) {
      state.tasks = state.tasks.filter(t => t.subject !== td.subject);
      state.tasks.push({ id: td.id || String(state.tasks.length + 1), subject: td.subject, status: 'pending' });
    }
  }
  if (/^TaskUpdate$/i.test(toolName)) {
    const td = input.tool_input || {};
    if (td.taskId) {
      const existing = state.tasks.find(t => t.id === td.taskId);
      if (existing && td.status) existing.status = td.status;
    }
  }

  // ── Error tracking ──
  if (isError) {
    const errMsg = String(
      (input.tool_response && (input.tool_response.stderr || input.tool_response.stdout)) || 'unknown error'
    ).slice(0, 200);
    state.errors.push({
      at: now,
      message: errMsg,
      file: (input.tool_input && input.tool_input.file_path) || null,
    });
    if (state.errors.length > 20) state.errors = state.errors.slice(-20);
  }

  // ── Counters ──
  state.tool_calls.total = (state.tool_calls.total || 0) + 1;
  state.last_saved_at = now;

  // ── Atomic write ──
  writeState(sessionId, state);

  // Update debounce marker
  try { fs.writeFileSync(debounceFile, ''); } catch {}

  passthrough();
} catch (e) {
  // Never block the session on auto-save failure
  try { process.stderr.write('[handoff-auto-save] ' + e.message + '\n'); } catch {}
  passthrough();
}
