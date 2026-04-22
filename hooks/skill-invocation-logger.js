#!/usr/bin/env node
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
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  const scriptDir = __dirname;
  const isGemini = scriptDir.includes('.gemini');
  const configDir = path.join(home, isGemini ? '.gemini' : '.claude');
  const sessionId = input.session_id || 'unknown';
  const logFile = path.join(configDir, `.skill-log-${sessionId}.jsonl`);

  const entry = JSON.stringify({
    skill: skillName,
    timestamp: new Date().toISOString(),
    cwd: input.cwd || process.cwd()
  }) + '\n';

  fs.appendFileSync(logFile, entry);

  // Observability: emit to episodic JSONL
  try { require('./lib/observability-logger.js').logEvent(input.cwd || process.cwd(), { type: 'skill_invoke', source: 'skill-invocation-logger', meta: { skill: skillName } }); } catch {}

  process.stdout.write('{"continue":true}');
} catch {
  process.stdout.write('{"continue":true}');
}
