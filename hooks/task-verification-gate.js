#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// SubagentStop hook: Enforce verification before subagent tasks are marked done.
// Checks if the task description suggests code changes were made,
// and warns if no build/test command was run in the session.
// (Claude Code has no TaskCompleted event — this hook fires on SubagentStop.)

const fs = require('fs');

try {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }
  const input = JSON.parse(raw);

  const subject = input.task_subject || '';
  const description = input.task_description || '';
  const combined = `${subject} ${description}`.toLowerCase();

  // Only check tasks that look like code changes
  const codeKeywords = ['implement', 'fix', 'add', 'create', 'update', 'refactor', 'migrate', 'build'];
  const isCodeTask = codeKeywords.some(kw => combined.includes(kw));

  if (!isCodeTask) {
    process.stdout.write('{"continue":true}');
    process.exit(0);
  }

  // Warn about verification
  process.stdout.write(JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'SubagentStop',
      additionalContext: `Task "${subject}" marked complete. Reminder: verify with a build/test command before considering this done. Per project rules, NEVER claim done without running a real verification command.`
    }
  }));
} catch (e) {
  process.stderr.write('task-verification-gate: ' + e.message + '\n');
  process.stdout.write('{"continue":true}');
}
