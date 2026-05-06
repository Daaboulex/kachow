#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// SessionStart hook: register session in presence files, report active peers.
// Core helpers live in lib/presence.js.

const fs = require('fs');
const path = require('path');
const p = require('./lib/presence.js');

try {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }
  const input = JSON.parse(raw);

  const cwd = input.cwd || process.cwd();
  const sessionId = input.session_id || `${Date.now()}-${process.pid}`;

  const record = {
    ts: new Date().toISOString(),
    event: 'start',
    sid: sessionId,
    // Codex hooks run from ~/.claude/hooks/ (config.toml points there).
    // Detect by env var that Codex CLI sets (CODEX_HOME or argv[0] hints) since
    // __dirname can't distinguish Codex from Claude. AGENT_TOOL takes precedence.
    agent: require('./lib/tool-detect.js').detectTool(),
    host: require('os').hostname(),
    pid: process.pid,
    tmux: process.env.TMUX_PANE || '',
    cwd,
  };

  p.appendToAll(cwd, record);

  // Peer awareness (5-min window) — merged across all per-host presence files.
  const fiveMinAgo = Date.now() - 5 * 60 * 1000;
  const globalPeers = (p.readActiveSessionsAllHosts
    ? p.readActiveSessionsAllHosts(fiveMinAgo)
    : p.readActiveSessions(p.globalPresencePath(), fiveMinAgo))
    .filter(s => s.sid !== sessionId);
  const projectPath = p.projectPresencePath(cwd);
  const projectPeers = projectPath
    ? p.readActiveSessions(projectPath, fiveMinAgo).filter(s => s.sid !== sessionId)
    : [];

  const parts = [];
  if (projectPeers.length > 0) {
    const names = projectPeers.map(s => `${s.agent}@${s.tmux || s.pid}`).join(', ');
    parts.push(`⚠ ${projectPeers.length} peer(s) in THIS PROJECT: ${names}. Coordinate edits — check active-sessions.jsonl.`);
  }
  const otherProjects = globalPeers.filter(s => !projectPeers.some(pp => pp.sid === s.sid));
  if (otherProjects.length > 0) {
    const cwds = [...new Set(otherProjects.map(s => path.basename(s.cwd || '?')))].slice(0, 3).join(', ');
    parts.push(`${otherProjects.length} session(s) in other projects: ${cwds}`);
  }

  if (parts.length > 0) {
    process.stdout.write(JSON.stringify({
      continue: true,
      systemMessage: `[Presence] ${parts.join(' | ')}`,
    }));
  } else {
    process.stdout.write('{"continue":true}');
  }
} catch (e) {
  try { process.stderr.write('session-presence-start: ' + e.message + '\n'); } catch {}
  process.stdout.write('{"continue":true}');
}
