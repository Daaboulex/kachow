#!/usr/bin/env node
// PreToolUse hook: Check HALT conditions before skill invocation.
// Reads .claude/halt-conditions.json for configurable conditions.
// Advisory — injects systemMessage with HALT warning. --force overrides.

const fs = require('fs');
const path = require('path');

try {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }
  const input = JSON.parse(raw);

  const toolName = input.tool_name || '';
  if (toolName !== 'Skill' && toolName !== 'activate_skill') {
    process.stdout.write('{"continue":true}');
    process.exit(0);
  }

  const skillName = (input.tool_input || {}).skill || '';
  if (!skillName) {
    process.stdout.write('{"continue":true}');
    process.exit(0);
  }

  const args = (input.tool_input || {}).args || '';
  if (args.includes('--force')) {
    process.stdout.write('{"continue":true}');
    process.exit(0);
  }

  const cwd = input.cwd || process.cwd();
  const configPaths = [
    path.join(cwd, '.claude', 'halt-conditions.json'),
    path.join(cwd, '.gemini', 'halt-conditions.json'),
  ];

  let config = null;
  for (const cp of configPaths) {
    try {
      config = JSON.parse(fs.readFileSync(cp, 'utf8'));
      break;
    } catch {}
  }

  if (!config || !config.conditions) {
    process.stdout.write('{"continue":true}');
    process.exit(0);
  }

  const halts = [];
  for (const cond of config.conditions) {
    if (!cond.skills.includes('*') && !cond.skills.includes(skillName)) continue;
    halts.push(cond.halt_message);
  }

  if (halts.length > 0) {
    process.stdout.write(JSON.stringify({
      continue: true,
      systemMessage: '\n' + halts.join('\n') + '\n\nPass --force in skill args to override.'
    }));
  } else {
    process.stdout.write('{"continue":true}');
  }
} catch (e) {
  process.stderr.write('halt-condition-validator: ' + e.message + '\n');
  process.stdout.write('{"continue":true}');
}
