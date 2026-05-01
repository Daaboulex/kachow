#!/usr/bin/env node
// hook-debug.mjs — diagnostic tool: shows what each hook outputs per event.
// Runs hooks with fake stdin, captures stdout/stderr, reports injection analysis.
// Usage: hook-debug.mjs [event] [--verbose]
// Events: SessionStart, PostToolUse, PreToolUse, UserPromptSubmit, Stop

import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const event = process.argv[2] || 'SessionStart';
const verbose = process.argv.includes('--verbose');
const settingsPath = join(homedir(), '.claude', 'settings.json');

if (!existsSync(settingsPath)) {
  console.error('settings.json not found');
  process.exit(1);
}

const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
const hookEntries = settings.hooks?.[event] || [];

if (hookEntries.length === 0) {
  console.log(`No hooks registered for ${event}`);
  process.exit(0);
}

const fakeStdin = JSON.stringify({
  session_id: 'hook-debug-probe',
  cwd: process.cwd(),
  tool_name: 'Read',
  tool_input: { file_path: '/dev/null' },
  hook_event_data: { user_prompt: 'hook debug probe', additionalContext: '' },
});

console.log(`# Hook Debug — ${event} (${hookEntries.length} entries)`);
console.log(`Fake stdin: session_id=hook-debug-probe cwd=${process.cwd()}`);
console.log('');

let totalBytes = 0;
let injectCount = 0;

for (const entry of hookEntries) {
  const matcher = entry.matcher || 'ALL';
  const hooks = entry.hooks || [];
  for (const hook of hooks) {
    const cmd = hook.command || hook.type || '?';
    const name = hook.name || cmd.split('/').pop().replace(/"/g, '');
    const timeout = hook.timeout || hook.timeoutMs || '?';

    console.log(`## ${name} (matcher: ${matcher}, timeout: ${timeout}s)`);

    try {
      const result = execSync(`echo '${fakeStdin.replace(/'/g, "\\'")}' | ${cmd}`, {
        timeout: 10000,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const trimmed = result.trim();
      if (!trimmed) {
        console.log('  output: (empty)');
        continue;
      }

      let parsed;
      try { parsed = JSON.parse(trimmed); } catch {
        console.log(`  output: ${trimmed.slice(0, 200)}`);
        continue;
      }

      const bytes = Buffer.byteLength(trimmed, 'utf8');
      totalBytes += bytes;

      const injects = [];
      if (parsed.systemMessage) injects.push(`systemMessage (${Buffer.byteLength(parsed.systemMessage, 'utf8')}B)`);
      if (parsed.additionalContext) injects.push(`additionalContext (${Buffer.byteLength(parsed.additionalContext, 'utf8')}B)`);
      if (parsed.decision && parsed.decision !== 'approve') injects.push(`decision:${parsed.decision}`);
      if (parsed.hookSpecificOutput) injects.push('hookSpecificOutput');

      if (injects.length > 0) {
        injectCount++;
        console.log(`  INJECTS: ${injects.join(', ')}`);
      } else {
        console.log(`  passthrough (${bytes}B output, no injection)`);
      }

      if (verbose && parsed.systemMessage) {
        console.log(`  systemMessage preview: ${parsed.systemMessage.slice(0, 200)}...`);
      }
    } catch (e) {
      console.log(`  ERROR: ${e.message?.split('\n')[0] || 'unknown'}`);
    }
    console.log('');
  }
}

console.log(`# Summary: ${hookEntries.reduce((n, e) => n + (e.hooks?.length || 0), 0)} hooks, ${injectCount} inject context, ${totalBytes}B total output`);
