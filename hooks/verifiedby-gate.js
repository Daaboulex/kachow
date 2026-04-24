#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// PreToolUse hook: block TodoWrite that marks a task done with empty verifiedBy.
// Enforces CLAUDE.md rule: "NEVER mark a task as done without running a real verification command."
//
// Input: tool_name=TodoWrite, tool_input.todos[].status, tool_input.todos[].verifiedBy (optional field).
//
// Behaviour:
//   - If any todo transitions to status='done'|'completed' but verifiedBy is absent/empty, emit a
//     systemMessage reminder. Does NOT hard-block — we can't tell from tool_input alone whether
//     verification actually ran. The message nudges the agent to add verifiedBy before confirming.
//
// Disable: SKIP_VERIFIEDBY_GATE=1

const fs = require('fs');

function passthrough() {
  process.stdout.write('{"continue":true}');
  process.exit(0);
}

try {
  if (process.env.SKIP_VERIFIEDBY_GATE === '1') passthrough();

  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }
  const input = JSON.parse(raw || '{}');

  const toolName = input.tool_name || '';
  if (!/^(TodoWrite|write_todos)$/.test(toolName)) passthrough();

  const todos = (input.tool_input && input.tool_input.todos) || [];
  const flagged = [];
  for (const t of todos) {
    const status = (t.status || '').toLowerCase();
    if (status === 'done' || status === 'completed') {
      const v = t.verifiedBy || t.verified_by || t.verification;
      if (!v || String(v).trim() === '' || v === 'not-verified') {
        flagged.push(t.content || t.subject || t.id || '(unnamed)');
      }
    }
  }

  if (flagged.length === 0) passthrough();

  const msg = `[verifiedBy-gate] Marked done without verification: ${flagged.slice(0,3).join('; ')}${flagged.length>3?` (+${flagged.length-3} more)`:''}. Per CLAUDE.md: task is not done until a real verification command ran. Add verifiedBy (unit-test|integration-test|human-tested) or revert status.`;
  process.stdout.write(JSON.stringify({ continue: true, systemMessage: msg }));
  process.exit(0);
} catch {
  passthrough();
}
