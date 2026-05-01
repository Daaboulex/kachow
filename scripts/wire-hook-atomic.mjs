#!/usr/bin/env node
// wire-hook-atomic.mjs <event> <command> <name> <timeout-seconds>
// Wires the same hook into Claude + Gemini settings atomically.
// Backup both files first. If either write fails, restore from backup.

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const [event, command, name, timeoutSec] = process.argv.slice(2);
if (!event || !command || !name || !timeoutSec) {
  console.error('usage: wire-hook-atomic.mjs <event> <command> <name> <timeout-seconds>');
  process.exit(2);
}

const claudePath = join(homedir(), '.claude', 'settings.json');
const geminiPath = join(homedir(), '.gemini', 'settings.json');
const ts = Date.now();
const claudeBackup = claudePath + '.bak-' + ts;
const geminiBackup = geminiPath + '.bak-' + ts;

copyFileSync(claudePath, claudeBackup);
if (existsSync(geminiPath)) copyFileSync(geminiPath, geminiBackup);

function wire(filePath, timeoutKey, timeoutVal) {
  if (!existsSync(filePath)) return 'skip-missing';
  const s = JSON.parse(readFileSync(filePath, 'utf8'));
  s.hooks = s.hooks || {};
  s.hooks[event] = s.hooks[event] || [];
  const exists = s.hooks[event].some(h =>
    (h.hooks || []).some(x => x.name === name)
  );
  if (exists) return 'already-wired';
  const hookEntry = { type: 'command', command, name };
  hookEntry[timeoutKey] = timeoutVal;
  s.hooks[event].push({ matcher: '', hooks: [hookEntry] });
  writeFileSync(filePath, JSON.stringify(s, null, 2) + '\n');
  return 'wired';
}

try {
  const claudeStatus = wire(claudePath, 'timeout', parseInt(timeoutSec, 10));
  const geminiStatus = wire(geminiPath, 'timeoutMs', parseInt(timeoutSec, 10) * 1000);

  // Codex: delegate to wire-hook-codex.mjs (TOML format)
  let codexStatus = 'skip';
  try {
    const codexScript = join(homedir(), '.ai-context', 'scripts', 'wire-hook-codex.mjs');
    if (existsSync(codexScript)) {
      const { execSync } = await import('node:child_process');
      const result = execSync(
        `node "${codexScript}" "${event}" "${command}" --timeout ${timeoutSec}`,
        { encoding: 'utf8', timeout: 5000 }
      ).trim();
      codexStatus = result;
    }
  } catch (ce) { codexStatus = 'error:' + (ce.message || '').slice(0, 50); }

  console.log(`claude:${claudeStatus} gemini:${geminiStatus} codex:${codexStatus}`);
} catch (e) {
  console.error('FAIL:', e.message, '— restoring backups');
  try { copyFileSync(claudeBackup, claudePath); } catch {}
  try { if (existsSync(geminiBackup)) copyFileSync(geminiBackup, geminiPath); } catch {}
  process.exit(1);
}
