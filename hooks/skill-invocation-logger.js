#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// PostToolUse hook: log Skill tool invocations to a session-local temp file
// This is the REAL-TIME skill tracking that track-skill-usage.js reads at session end.
// Without this, skill usage is never captured (the Stop hook can't see the transcript).
// Cross-platform (Linux, macOS, Windows)

const fs = require('fs');
const path = require('path');
const os = require('os');

try {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }
  const input = JSON.parse(raw);

  const toolName = input.tool_name || '';
  if (toolName !== 'Skill') {
    process.stdout.write('{"continue":true}');
    process.exit(0);
  }

  // Extract skill name from tool input
  const skillName = (input.tool_input || {}).skill || (input.tool_input || {}).name || '';
  if (!skillName) {
    process.stdout.write('{"continue":true}');
    process.exit(0);
  }

  // Write to config dir (NOT /tmp — /tmp writes can trigger systemd events that crash KDE Wayland)
  const { toolHomeDir } = require('./lib/tool-detect.js');
  const configDir = toolHomeDir();
  const sessionId = input.session_id || 'unknown';
  const logFile = path.join(configDir, `.skill-log-${sessionId}.jsonl`);

  const entry = JSON.stringify({
    skill: skillName,
    timestamp: new Date().toISOString(),
    cwd: input.cwd || process.cwd(),
    session_id: sessionId,
    outcome: 'invoked',
    tool_response_correlation: null,
    bandaid_loop_link: false,
    user_acted_window_ms: null,
    tool_use_id: (input.tool_input || {}).tool_use_id || input.tool_use_id || null,
  }) + '\n';

  fs.appendFileSync(logFile, entry);

  // Observability: emit to episodic JSONL.
  // R17 support: includes session_id so Stop-chain reconciliation can
  // match bandaid_loop events back to skills invoked in same session.
  try {
    require('./lib/observability-logger.js').logEvent(input.cwd || process.cwd(), {
      type: 'skill_invoke',
      source: 'skill-invocation-logger',
      session_id: sessionId,
      meta: { skill: skillName, followed_by_bandaid_loop: false }
    });
  } catch {}

  process.stdout.write('{"continue":true}');
} catch {
  process.stdout.write('{"continue":true}');
}
