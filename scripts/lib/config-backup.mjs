// lib/config-backup.mjs
// Timestamped backup/restore for Claude, Gemini, Codex config files.

import { mkdirSync, copyFileSync, existsSync, readdirSync } from 'fs';
import { resolve } from 'path';

const HOME = process.env.HOME || '$HOME';

const CONFIG_FILES = [
  { tool: 'claude', src: resolve(HOME, '.claude/settings.json'),  name: 'claude-settings.json' },
  { tool: 'gemini', src: resolve(HOME, '.gemini/settings.json'),  name: 'gemini-settings.json' },
  { tool: 'codex',  src: resolve(HOME, '.codex/config.toml'),     name: 'codex-config.toml'    },
];

const BACKUPS_DIR = resolve(HOME, '.ai-context/backups');

/** Returns YYYY-MM-DD-HHMMSS string from a Date. */
export function formatTimestamp(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-') + '-' + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

/**
 * Copies all 3 config files into ~/.ai-context/backups/<timestamp>/.
 * @param {string} [timestamp] - use formatTimestamp() if omitted
 * @returns {string} timestamp used
 */
export function backup(timestamp) {
  const ts = timestamp || formatTimestamp();
  const dir = resolve(BACKUPS_DIR, ts);
  mkdirSync(dir, { recursive: true });

  for (const f of CONFIG_FILES) {
    if (!existsSync(f.src)) continue;
    copyFileSync(f.src, resolve(dir, f.name));
  }

  return ts;
}

/**
 * Copies backup files from ~/.ai-context/backups/<timestamp>/ back to their tool locations.
 * @param {string} timestamp
 */
export function restore(timestamp) {
  const dir = resolve(BACKUPS_DIR, timestamp);
  if (!existsSync(dir)) {
    throw new Error(`Backup not found: ${dir}`);
  }

  for (const f of CONFIG_FILES) {
    const src = resolve(dir, f.name);
    if (!existsSync(src)) {
      console.warn(`  WARN: backup missing ${f.name} — skipping ${f.tool}`);
      continue;
    }
    copyFileSync(src, f.src);
    console.log(`  restored ${f.tool} → ${f.src}`);
  }
}

/**
 * Lists available backup timestamps (directory names), newest first.
 * @returns {string[]}
 */
export function listBackups() {
  if (!existsSync(BACKUPS_DIR)) return [];
  return readdirSync(BACKUPS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort()
    .reverse();
}
