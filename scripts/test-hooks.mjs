#!/usr/bin/env node
// test-hooks.mjs — runtime test harness for all registered hooks
// For each hook in MANIFEST.yaml, runs it with sample input and validates output.
// Exit 0 = all pass, Exit 1 = failures.

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const HOOKS_DIR = join(ROOT, 'modules/hooks/src');

// Sample inputs for different hook events
const SAMPLE_INPUTS = {
  SessionStart: { session_id: 'test-001', cwd: ROOT },
  PreToolUse: { tool_name: 'Bash', tool_input: { command: 'echo hello' } },
  PostToolUse: { tool_name: 'Bash', tool_input: { command: 'echo hello' }, tool_response: 'hello' },
  Stop: { session_id: 'test-001', cwd: ROOT },
  PreCompact: {},
  UserPromptSubmit: { prompt: 'test prompt' },
};

// Safety hooks that should block on dangerous input
const BLOCK_TESTS = [
  {
    hook: 'autosave-before-destructive.js',
    input: { tool_name: 'Bash', tool_input: { command: 'rm -rf /' } },
    expectBlock: false, // autosave doesn't block, it saves
  },
];

function parseManifestHooks(text) {
  const hooks = [];
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/ #.*$/, '').trimEnd();
    if (!line.trim()) continue;
    const trimmed = line.trim();
    if (/^- file:/.test(trimmed)) {
      if (current) hooks.push(current);
      current = { file: trimmed.replace(/^- file:\s*/, '').trim(), events: [] };
    }
    if (current && /^- event:/.test(trimmed)) {
      current.events.push(trimmed.replace(/^- event:\s*/, '').trim());
    }
  }
  if (current) hooks.push(current);
  return hooks;
}

const manifest = readFileSync(join(ROOT, 'modules/hooks/MANIFEST.yaml'), 'utf8');
const hooks = parseManifestHooks(manifest);

let passes = 0;
let failures = 0;
let skips = 0;

console.log('Hook Runtime Tests\n');

for (const hook of hooks) {
  const hookPath = join(HOOKS_DIR, hook.file);
  const event = hook.events[0] || 'SessionStart';
  const input = SAMPLE_INPUTS[event] || {};

  // 1. File exists
  if (!existsSync(hookPath)) {
    console.log(`  FAIL: ${hook.file} — source file missing`);
    failures++;
    continue;
  }

  // 2. Syntax check
  try {
    execSync(`node --check "${hookPath}"`, { encoding: 'utf-8', timeout: 5000 });
  } catch (e) {
    console.log(`  FAIL: ${hook.file} — syntax error: ${e.message.split('\n')[0]}`);
    failures++;
    continue;
  }

  // 3. Run with sample input, check output is valid JSON with continue field
  try {
    const inputJson = JSON.stringify(input);
    const result = execSync(
      `echo '${inputJson.replace(/'/g, "'\\''")}' | node "${hookPath}"`,
      {
        encoding: 'utf-8',
        timeout: 10000,
        env: { ...process.env, AI_TOOL: 'claude', HOME: process.env.HOME },
        cwd: ROOT,
      }
    );

    const trimmed = result.trim();
    if (!trimmed) {
      console.log(`  WARN: ${hook.file} — no output (empty stdout)`);
      skips++;
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      console.log(`  FAIL: ${hook.file} — invalid JSON output: ${trimmed.slice(0, 80)}`);
      failures++;
      continue;
    }

    if (typeof parsed.continue !== 'boolean') {
      console.log(`  FAIL: ${hook.file} — missing "continue" field in output`);
      failures++;
      continue;
    }

    const extras = [];
    if (parsed.systemMessage) extras.push('systemMessage');
    if (parsed.decision) extras.push(`decision:${parsed.decision}`);
    if (parsed.hookSpecificOutput) extras.push('hookSpecificOutput');

    console.log(`  PASS: ${hook.file}${extras.length ? ' [' + extras.join(', ') + ']' : ''}`);
    passes++;
  } catch (e) {
    const exitCode = e.status;
    if (exitCode === 2) {
      console.log(`  PASS: ${hook.file} [exit 2 = block]`);
      passes++;
    } else {
      console.log(`  FAIL: ${hook.file} — exit ${exitCode}: ${(e.stderr || e.message || '').split('\n')[0].slice(0, 100)}`);
      failures++;
    }
  }
}

console.log(`\n── SUMMARY ──`);
console.log(`  ${passes} passed, ${failures} failed, ${skips} warnings`);
process.exit(failures > 0 ? 1 : 0);
