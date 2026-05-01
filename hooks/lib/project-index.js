// project-index.js — project-centric session index with 50-entry cap.
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const HANDOFFS_ROOT = path.join(os.homedir(), '.ai-context', 'handoffs');
const PROJECTS_DIR = path.join(HANDOFFS_ROOT, 'projects');
const MAX_SESSIONS = 50;

function ensureProjectsDir() {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
}

function indexPath(projectKey) {
  return path.join(PROJECTS_DIR, projectKey + '.json');
}

function readIndex(projectKey) {
  try {
    return JSON.parse(fs.readFileSync(indexPath(projectKey), 'utf8'));
  } catch {
    return {
      schema_version: 1,
      project_key: projectKey,
      display_name: projectKey,
      paths: [],
      sessions: [],
      last_session: null,
    };
  }
}

function writeIndex(projectKey, data) {
  ensureProjectsDir();
  const target = indexPath(projectKey);
  const tmp = target + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, target);
}

function appendSession(projectKey, sessionEntry) {
  const data = readIndex(projectKey);
  data.sessions = data.sessions.filter(s => s.session_id !== sessionEntry.session_id);
  data.sessions.push(sessionEntry);

  if (data.sessions.length > MAX_SESSIONS) {
    data.sessions.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    data.sessions = data.sessions.slice(-MAX_SESSIONS);
  }

  data.last_session = sessionEntry.ended_at || sessionEntry.at;
  writeIndex(projectKey, data);
}

function removeSessionEntry(projectKey, sessionId) {
  const data = readIndex(projectKey);
  const before = data.sessions.length;
  data.sessions = data.sessions.filter(s => s.session_id !== sessionId);
  if (data.sessions.length !== before) {
    if (data.sessions.length > 0) {
      const last = data.sessions[data.sessions.length - 1];
      data.last_session = last.ended_at || last.at;
    } else {
      data.last_session = null;
    }
    writeIndex(projectKey, data);
  }
}

function latestSessions(projectKey, count) {
  const data = readIndex(projectKey);
  return data.sessions.slice(-count);
}

module.exports = { PROJECTS_DIR, MAX_SESSIONS, readIndex, writeIndex, appendSession, removeSessionEntry, latestSessions };
