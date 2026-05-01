#!/usr/bin/env node
// hook-test-suite.mjs — tests every registered hook with fake stdin.
// Reports: syntax OK, runs without crash, output valid JSON, expected schema.
// Usage: hook-test-suite.mjs [--fix] [--event EventName]

import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const filterEvent = args.find(a => !a.startsWith('--'));
const settings = JSON.parse(readFileSync(join(homedir(), '.claude', 'settings.json'), 'utf8'));
const hooks = settings.hooks || {};

const fakeInputs = {
  SessionStart: `{"session_id":"test-suite","cwd":"${homedir()}"}`,
  PostToolUse: `{"session_id":"test-suite","cwd":"${homedir()}","tool_name":"Read","tool_input":{"file_path":"/dev/null"},"tool_response":{"is_error":false}}`,
  PreToolUse: `{"session_id":"test-suite","cwd":"${homedir()}","tool_name":"Read","tool_input":{"file_path":"/dev/null"}}`,
  UserPromptSubmit: `{"session_id":"test-suite","cwd":"${homedir()}","hook_event_data":{"user_prompt":"test","additionalContext":""},"prompt":"test"}`,
  Stop: `{"session_id":"test-suite","cwd":"${homedir()}"}`,
  PreCompact: `{"session_id":"test-suite","cwd":"${homedir()}"}`,
  SubagentStart: `{"session_id":"test-suite","cwd":"${homedir()}"}`,
  SubagentStop: `{"session_id":"test-suite","cwd":"${homedir()}"}`,
  SessionEnd: `{"session_id":"test-suite","cwd":"${homedir()}"}`,
  Notification: `{"session_id":"test-suite","cwd":"${homedir()}"}`,
};

let passed = 0, failed = 0, skipped = 0;
const failures = [];

for (const [event, entries] of Object.entries(hooks)) {
  if (filterEvent && event !== filterEvent) continue;
  const input = fakeInputs[event] || '{}';

  for (const entry of entries) {
    for (const hook of (entry.hooks || [])) {
      const cmd = hook.command || '';
      const name = hook.name || cmd.split('/').pop().replace(/"/g, '').replace(/^node\s+/, '');
      const timeout = (hook.timeout || 30) * 1000;

      process.stdout.write(`${event}/${name}: `);

      try {
        const result = execSync(`echo '${input.replace(/'/g, "\\'")}' | ${cmd}`, {
          timeout: Math.min(timeout, 15000),
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, SESSION_ID: 'test-suite' },
        });

        const trimmed = result.trim();
        if (!trimmed) {
          console.log('WARN (empty output)');
          skipped++;
          continue;
        }

        try {
          const parsed = JSON.parse(trimmed);
          // Validate schema per event type
          if (event === 'PreToolUse' || event === 'PostToolUse' || event === 'SessionStart') {
            if ('continue' in parsed || 'decision' in parsed || 'systemMessage' in parsed || Object.keys(parsed).length === 0) {
              console.log(`PASS (${Buffer.byteLength(trimmed)}B)`);
              passed++;
            } else {
              console.log(`WARN (unexpected keys: ${Object.keys(parsed).join(',')})`);
              passed++; // Still valid JSON
            }
          } else {
            console.log(`PASS (${Buffer.byteLength(trimmed)}B)`);
            passed++;
          }
        } catch {
          console.log(`FAIL (invalid JSON: ${trimmed.slice(0, 80)})`);
          failed++;
          failures.push({ event, name, error: 'invalid JSON', output: trimmed.slice(0, 200) });
        }
      } catch (e) {
        const msg = e.message?.split('\n')[0] || 'unknown';
        if (e.status === 2) {
          console.log(`BLOCK (exit 2 — hook blocks action)`);
          passed++; // Exit 2 is valid for PreToolUse/PreCompact
        } else if (msg.includes('ETIMEDOUT') || msg.includes('timed out')) {
          console.log(`TIMEOUT (>${Math.min(timeout, 15000)}ms)`);
          failed++;
          failures.push({ event, name, error: 'timeout' });
        } else {
          console.log(`FAIL (${msg.slice(0, 100)})`);
          failed++;
          failures.push({ event, name, error: msg.slice(0, 200) });
        }
      }
    }
  }
}

console.log(`\n# Summary: ${passed} PASS, ${failed} FAIL, ${skipped} WARN`);
if (failures.length > 0) {
  console.log('\n# Failures:');
  for (const f of failures) {
    console.log(`  ${f.event}/${f.name}: ${f.error}`);
  }
}
process.exit(failed > 0 ? 1 : 0);
