#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// memory-rotate.js
// Stop hook. Cooldown-gated (7d). Rotates expired memories to archive/
// and rebuilds the MEMORY.md index. No LLM work — purely mechanical.
//
// Gates:
//   - time:     7d since last rotation (~/.claude/.last-memory-rotation)
//   - content:  at least 5 non-index .md files in memory dir
//
// Scope (scans each of):
//   ~/.claude/projects/<sanitized>/memory/   — per-cwd auto-memory
//   ~/.ai-context/memory/                    — global memory
//
// Never deletes — rotation moves to <memory>/archive/. Idempotent.

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const SCRIPT_DIR = __dirname;
const IS_GEMINI = SCRIPT_DIR.includes('.gemini');
const CONFIG_DIR = path.join(HOME, IS_GEMINI ? '.gemini' : '.claude');
const MARKER = path.join(CONFIG_DIR, '.last-memory-rotation');
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

const migrate = require(path.join(__dirname, 'lib', 'memory-migrate.js'));

function cooldownActive() {
  try {
    const last = fs.statSync(MARKER).mtimeMs;
    return (Date.now() - last) < COOLDOWN_MS;
  } catch {
    return false;
  }
}

function targetDirs() {
  const dirs = [];
  // per-cwd auto-memory
  const cwd = process.cwd();
  const sanitized = cwd.replace(/\//g, '-');
  const autoMem = path.join(HOME, '.claude', 'projects', sanitized, 'memory');
  if (fs.existsSync(autoMem)) dirs.push(autoMem);
  // ~/.ai-context/memory/
  const globalMem = path.join(HOME, '.ai-context', 'memory');
  if (fs.existsSync(globalMem)) dirs.push(globalMem);
  return dirs;
}

function main() {
  if (cooldownActive()) {
    process.stdout.write('{"continue":true}');
    return;
  }
  const results = { ts: new Date().toISOString(), dirs: [] };
  for (const dir of targetDirs()) {
    try {
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md');
      if (files.length < 5) continue;
      const rotated = migrate.rotate(dir);
      const indexed = migrate.rebuildIndex(dir);
      results.dirs.push({ dir, rotated: rotated.length, entries: indexed.entries, stale: indexed.stale });
    } catch (e) {
      results.dirs.push({ dir, error: e.message });
    }
  }
  fs.writeFileSync(MARKER, '');
  try {
    const log = path.join(CONFIG_DIR, 'cache', 'memory-rotation-log.jsonl');
    fs.mkdirSync(path.dirname(log), { recursive: true });
    fs.appendFileSync(log, JSON.stringify(results) + '\n');
  } catch {}
  process.stdout.write('{"continue":true}');
}

try { main(); } catch (e) {
  try { process.stderr.write(`memory-rotate: ${e.message}\n`); } catch {}
  process.stdout.write('{"continue":true}');
}
