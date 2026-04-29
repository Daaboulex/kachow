#!/usr/bin/env node
// wire-hook-codex.mjs <event> <command> [--matcher <pattern>] [--timeout <seconds>]
// Appends a hook to ~/.codex/config.toml (TOML format).
// Does NOT rewrite — appends only. Validates with tomllib after write.

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('usage: wire-hook-codex.mjs <event> <command> [--matcher <pattern>] [--timeout <seconds>]');
  console.error('events: SessionStart, PreToolUse, PostToolUse, UserPromptSubmit, PermissionRequest, Stop');
  process.exit(2);
}

const event = args[0];
const command = args[1];
let matcher = '';
let timeout = 5;

for (let i = 2; i < args.length; i++) {
  if (args[i] === '--matcher' && args[i + 1]) { matcher = args[++i]; }
  if (args[i] === '--timeout' && args[i + 1]) { timeout = parseInt(args[++i], 10); }
}

const VALID_EVENTS = ['SessionStart', 'PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'PermissionRequest', 'Stop'];
if (!VALID_EVENTS.includes(event)) {
  console.error(`Invalid event: ${event}. Must be one of: ${VALID_EVENTS.join(', ')}`);
  process.exit(2);
}

const configPath = join(homedir(), '.codex', 'config.toml');
if (!existsSync(configPath)) {
  console.error('~/.codex/config.toml not found');
  process.exit(1);
}

const backup = configPath + '.bak-wire-' + Date.now();
copyFileSync(configPath, backup);

const existing = readFileSync(configPath, 'utf8');
if (existing.includes(command)) {
  console.log('already-wired');
  process.exit(0);
}

let block = `\n# ${event}: auto-wired\n[[hooks.${event}]]\n`;
if (matcher) block += `matcher = "${matcher}"\n`;
block += `[[hooks.${event}.hooks]]\ntype = "command"\ncommand = '${command}'\ntimeout = ${timeout}\n`;

writeFileSync(configPath, existing.trimEnd() + '\n' + block);

try {
  execSync(`python3 -c "import tomllib; tomllib.load(open('${configPath}','rb'))"`, { stdio: 'pipe' });
  console.log('wired');
} catch {
  console.error('TOML validation failed — restoring backup');
  copyFileSync(backup, configPath);
  process.exit(1);
}
