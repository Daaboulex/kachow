#!/usr/bin/env node
'use strict';
// Stop/SessionEnd hook: finalize session state + update project indices.
// Handles retention: delete session JSON >30d, prose .md >90d.
// Cleans up ephemeral files (.debounce-, .git-cache-, .current-session-).

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
  const input = JSON.parse(raw || '{}');

  const { getSessionId, readState, writeState, newState, HANDOFFS_ROOT, ensureDirs } = require('./lib/handoff-state.js');
  const { appendSession, removeSessionEntry } = require('./lib/project-index.js');
  const { deriveProjectKeyCached } = require('./lib/project-key.js');
  const { detectTool } = require('./lib/tool-detect.js');

  ensureDirs();
  const tool = detectTool();
  const cwd = process.cwd();
  const sessionId = getSessionId(input, tool);

  let state = readState(sessionId);
  if (!state) {
    const proj = deriveProjectKeyCached(cwd);
    state = newState(sessionId, tool, proj.key, cwd);
  }

  state.ended_at = new Date().toISOString();

  // Generate summary
  const completedTasks = (state.tasks || []).filter(t => t.status === 'completed').map(t => t.subject);
  const fileCount = (state.files_changed || []).length;
  if (completedTasks.length > 0) {
    state.summary = completedTasks.slice(0, 3).join(', ');
    if (completedTasks.length > 3) state.summary += ` (+${completedTasks.length - 3} more)`;
  } else if (fileCount > 0) {
    state.summary = `${fileCount} file(s) changed`;
  } else {
    state.summary = 'Read-only session';
  }

  // Check for prose handoff
  const prosePath = path.join(HANDOFFS_ROOT, 'sessions', sessionId + '.md');
  state.has_prose_handoff = fs.existsSync(prosePath);

  writeState(sessionId, state);

  // Update project indices
  for (const projectKey of (state.projects_touched || [])) {
    try {
      appendSession(projectKey, {
        session_id: state.session_id,
        tool: state.tool,
        host: state.host,
        at: state.started_at,
        ended_at: state.ended_at,
        summary: state.summary,
        has_prose: state.has_prose_handoff,
        files_touched: fileCount,
        deferred_added: 0,
        deferred_resolved: 0,
      });
    } catch {}
  }

  // Retention: clean old session files
  try {
    const sessionsDir = path.join(HANDOFFS_ROOT, 'sessions');
    const now = Date.now();
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;
    const projectsDir = path.join(HANDOFFS_ROOT, 'projects');

    for (const f of fs.readdirSync(sessionsDir)) {
      if (f.startsWith('.')) continue;
      const fp = path.join(sessionsDir, f);
      try {
        const age = now - fs.statSync(fp).mtimeMs;
        if (f.endsWith('.json') && age > THIRTY_DAYS) {
          const sid = f.replace('.json', '');
          // Remove from all project indices before deleting
          try {
            for (const pf of fs.readdirSync(projectsDir)) {
              if (pf.endsWith('.json')) {
                removeSessionEntry(pf.replace('.json', ''), sid);
              }
            }
          } catch {}
          fs.unlinkSync(fp);
        } else if (f.endsWith('.md') && age > NINETY_DAYS) {
          fs.unlinkSync(fp);
        }
      } catch {}
    }
  } catch {}

  // Clean up ephemeral files for this session
  const sessionsDir = path.join(HANDOFFS_ROOT, 'sessions');
  for (const prefix of ['.debounce-', '.git-cache-']) {
    try { fs.unlinkSync(path.join(sessionsDir, prefix + sessionId)); } catch {}
  }
  try { fs.unlinkSync(path.join(sessionsDir, '.current-session-' + tool + '.json')); } catch {}

  passthrough();
} catch (e) {
  try { process.stderr.write('[handoff-session-end] ' + e.message + '\n'); } catch {}
  passthrough();
}
