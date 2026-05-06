#!/usr/bin/env node
// system-integrity-check.mjs — Comprehensive contract verifier for one-brain architecture.
// Catches ghost hooks, broken symlinks, stale refs, memory index drift, hardcoded paths.
// Exit 0 = all PASS. Exit 1 = at least one FAIL.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

const HOME = os.homedir();
const AI = process.env.AI_CONTEXT || path.join(HOME, '.ai-context');
const HOOKS = path.join(AI, 'hooks');
const CONFIGS = path.join(AI, 'configs');

let passCount = 0, failCount = 0, warnCount = 0;
const details = [];

function pass(msg) { passCount++; details.push(`[PASS] ${msg}`); }
function fail(msg) { failCount++; details.push(`[FAIL] ${msg}`); }
function warn(msg) { warnCount++; details.push(`[WARN] ${msg}`); }

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function run(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', timeout: 5000 }).trim(); } catch { return null; }
}

// ── 1. MANIFEST ↔ Filesystem ──
function checkManifest() {
  const raw = fs.readFileSync(path.join(AI, 'scripts', 'MANIFEST.yaml'), 'utf8');
  const fileRe = /^\s+-\s*file:\s*(.+\.js)\s*$/gm;
  const hookFiles = new Set();
  let m;
  while ((m = fileRe.exec(raw)) !== null) hookFiles.add(m[1].trim());

  let missing = 0;
  for (const f of hookFiles) {
    if (!fs.existsSync(path.join(HOOKS, f))) {
      fail(`MANIFEST → missing file: hooks/${f}`);
      missing++;
    }
  }
  if (missing === 0) pass(`MANIFEST ↔ filesystem: ${hookFiles.size} hooks, all present`);
}

// ── 2. Config ↔ Filesystem ──
function checkConfigHooks() {
  const configs = [
    { name: 'claude', file: path.join(CONFIGS, 'claude-settings.json'), re: /hooks\/([a-z][-a-z0-9]+\.js)/g },
    { name: 'gemini', file: path.join(CONFIGS, 'gemini-settings.json'), re: /hooks\/([a-z][-a-z0-9]+\.js)/g },
    { name: 'codex',  file: path.join(CONFIGS, 'codex-config.toml'),    re: /hooks\/([a-z][-a-z0-9]+\.js)/g },
    { name: 'crush',  file: path.join(CONFIGS, 'crush.json'),           re: /hooks\/([a-z][-a-z0-9]+\.js)/g },
  ];
  for (const cfg of configs) {
    if (!fs.existsSync(cfg.file)) { warn(`Config missing: ${cfg.name} (${cfg.file})`); continue; }
    const content = fs.readFileSync(cfg.file, 'utf8');
    const hooks = new Set();
    let m;
    while ((m = cfg.re.exec(content)) !== null) hooks.add(m[1]);
    let ghost = 0;
    for (const h of hooks) {
      if (!fs.existsSync(path.join(HOOKS, h)) && !fs.existsSync(path.join(HOOKS, 'lib', h))) {
        fail(`Ghost hook in ${cfg.name}: ${h} (registered but file missing)`);
        ghost++;
      }
    }
    if (ghost === 0) pass(`${cfg.name} config: ${hooks.size} hooks, all files exist`);
  }
}

// ── 3. Symlink integrity ──
function checkSymlinks() {
  const expected = [
    { link: path.join(HOME, '.claude', 'settings.json'), target: path.join(AI, 'configs', 'claude-settings.json') },
    { link: path.join(HOME, '.gemini', 'settings.json'), target: path.join(AI, 'configs', 'gemini-settings.json') },
    { link: path.join(HOME, '.codex', 'config.toml'),    target: path.join(AI, 'configs', 'codex-config.toml') },
    { link: path.join(HOME, '.claude', 'memory'),         target: path.join(AI, 'memory') },
    { link: path.join(HOME, '.claude', 'hooks'),           target: path.join(AI, 'hooks') },
  ];
  let ok = 0;
  for (const { link, target } of expected) {
    try {
      const stat = fs.lstatSync(link);
      if (!stat.isSymbolicLink()) {
        warn(`Not a symlink: ${link} (expected → ${target})`);
        continue;
      }
      const actual = fs.readlinkSync(link);
      if (actual !== target && fs.realpathSync(link) !== fs.realpathSync(target)) {
        warn(`Symlink target mismatch: ${link} → ${actual} (expected ${target})`);
        continue;
      }
      if (!fs.existsSync(link)) {
        fail(`Broken symlink: ${link} → ${actual}`);
        continue;
      }
      ok++;
    } catch {
      warn(`Missing symlink: ${link}`);
    }
  }
  if (ok === expected.length) pass(`Symlinks: all ${ok} correct`);
  else if (ok > 0) pass(`Symlinks: ${ok}/${expected.length} correct (see warnings)`);
}

// ── 4. Memory index accuracy ──
function checkMemoryIndex(dir, label) {
  const memoryMd = path.join(dir, 'MEMORY.md');
  if (!fs.existsSync(memoryMd)) { warn(`No MEMORY.md in ${label}`); return; }

  const indexContent = fs.readFileSync(memoryMd, 'utf8');
  const indexLines = indexContent.split('\n').length;
  if (indexLines > 200) warn(`${label} MEMORY.md: ${indexLines} lines (limit 200)`);

  // Extract referenced files from markdown links [text](file.md)
  const linkedFiles = new Set();
  for (const m of indexContent.matchAll(/\]\(([^)]+\.md)\)/g)) {
    linkedFiles.add(m[1]);
  }

  // Get actual .md files on disk (excluding MEMORY.md, archive/)
  const diskFiles = [];
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f === 'MEMORY.md' || f === 'archive' || f === 'episodic') continue;
      if (f.endsWith('.md')) diskFiles.push(f);
    }
  } catch {}

  const unlisted = diskFiles.filter(f => !linkedFiles.has(f));
  const dangling = [...linkedFiles].filter(f => !fs.existsSync(path.join(dir, f)));

  if (unlisted.length > 0) warn(`${label}: ${unlisted.length} unlisted files (not in MEMORY.md): ${unlisted.slice(0, 3).join(', ')}${unlisted.length > 3 ? '...' : ''}`);
  if (dangling.length > 0) fail(`${label}: ${dangling.length} dangling index entries: ${dangling.slice(0, 3).join(', ')}${dangling.length > 3 ? '...' : ''}`);
  if (unlisted.length === 0 && dangling.length === 0) pass(`${label} memory index: ${diskFiles.length} files, all indexed`);
}

// ── 5. Hardcoded path scanner ──
function checkHardcodedPaths() {
  let count = 0;
  const hookFiles = fs.readdirSync(HOOKS).filter(f => f.endsWith('.js'));
  for (const f of hookFiles) {
    const content = fs.readFileSync(path.join(HOOKS, f), 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip comments
      if (line.trim().startsWith('//')) continue;
      // Skip the claudeDir definition line itself and legacy markers
      if (line.includes('Legacy') || line.includes('claudeDir =') || line.includes('geminiDir =')) continue;
      // Check for hardcoded .claude path usage (not definition)
      if (/path\.join\(home,\s*['"]\.claude['"]/.test(line) || /path\.join\(home,\s*['"]\.gemini['"]/.test(line)) {
        // Skip project-relative paths like path.join(projectDir, '.claude')
        if (line.includes('projectDir') || line.includes('cwd')) continue;
        warn(`Hardcoded tool path: ${f}:${i + 1}`);
        count++;
        if (count >= 10) break;
      }
    }
    if (count >= 10) break;
  }
  if (count === 0) pass('Hardcoded path scan: clean');
  else if (count >= 10) warn(`Hardcoded paths: ${count}+ matches (showing first 10)`);
}

// ── 6. Binary tool branch scanner ──
function checkBinaryBranches() {
  let count = 0;
  const hookFiles = fs.readdirSync(HOOKS).filter(f => f.endsWith('.js'));
  for (const f of hookFiles) {
    const content = fs.readFileSync(path.join(HOOKS, f), 'utf8');
    // Pattern: isGemini ? 'something' : '.claude' or similar
    if (/isGemini\s*\?\s*['"][^'"]*['"]\s*:\s*['"]\.claude/.test(content)) {
      warn(`Binary tool branch: ${f} (isGemini ? X : .claude — missing codex/crush/opencode)`);
      count++;
    }
  }
  if (count === 0) pass('Binary tool branch scan: clean');
}

// ── 7. Stale reference scanner ──
function checkStaleRefs() {
  // Build patterns from parts so this file doesn't self-match
  const p = (...a) => a.join('');
  const patterns = [
    { label: 'tri-tool-parity', re: new RegExp(p('tri', '-tool', '-parity'), 'g') },
    { label: '~/.kachow-mirror (old path)', re: new RegExp(p('home.*\\.kachow', '-mirror'), 'g') },
    { label: '~/.kachow-release', re: new RegExp(p('kachow', '-release'), 'g') },
  ];
  const scanDirs = [HOOKS, path.join(AI, 'scripts'), CONFIGS];
  const SKIP_FILES = new Set(['system-integrity-check.mjs', 'CHANGELOG.md']);
  let found = 0;

  for (const dir of scanDirs) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.js') || f.endsWith('.mjs') || f.endsWith('.json') || f.endsWith('.yaml') || f.endsWith('.toml'));
    for (const f of files) {
      if (SKIP_FILES.has(f)) continue;
      const content = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const { label, re } of patterns) {
        if (re.test(content)) {
          re.lastIndex = 0;
          warn(`Stale ref "${label}" in ${path.basename(dir)}/${f}`);
          found++;
        }
      }
    }
  }
  if (found === 0) pass('Stale reference scan: clean');
}

// ── 8. Tool config validity ──
function checkConfigValidity() {
  const checks = [
    { name: 'claude', file: path.join(CONFIGS, 'claude-settings.json'), check: c => { JSON.parse(c); return true; } },
    { name: 'gemini', file: path.join(CONFIGS, 'gemini-settings.json'), check: c => { JSON.parse(c); return true; } },
    { name: 'codex',  file: path.join(CONFIGS, 'codex-config.toml'),   check: c => c.includes('[hooks') },
    { name: 'crush',  file: path.join(CONFIGS, 'crush.json'),          check: c => { JSON.parse(c); return true; } },
    { name: 'opencode', file: path.join(HOME, '.config', 'opencode', 'config.json'), check: c => { JSON.parse(c); return true; } },
  ];
  let ok = 0;
  for (const { name, file, check } of checks) {
    try {
      const content = fs.readFileSync(file, 'utf8');
      if (check(content)) { ok++; }
      else { fail(`${name} config: validation failed`); }
    } catch (e) {
      if (!fs.existsSync(file)) warn(`${name} config: file missing (${file})`);
      else fail(`${name} config: parse error — ${e.message}`);
    }
  }
  if (ok === checks.length) pass(`Tool configs: all ${ok} valid`);
  else pass(`Tool configs: ${ok}/${checks.length} valid (see warnings/fails)`);
}

// ── 9. Git state ──
function checkGitState() {
  let ok = true;
  if (!fs.existsSync(path.join(AI, '.git'))) { fail('~/.ai-context missing .git'); ok = false; }
  for (const d of ['.claude', '.gemini', '.codex']) {
    if (fs.existsSync(path.join(HOME, d, '.git'))) { fail(`${d} still has .git (should be derived state)`); ok = false; }
  }
  // Pre-commit executable
  const preCommit = path.join(AI, '.git', 'hooks', 'pre-commit');
  try {
    const stat = fs.statSync(preCommit);
    if (!(stat.mode & 0o111)) { warn('Pre-commit hook not executable'); ok = false; }
  } catch { warn('Pre-commit hook missing'); ok = false; }

  if (ok) pass('Git state: ai-context has .git, tool dirs clean, pre-commit executable');
}

// ── 10. Syncthing state ──
function checkSyncthing() {
  const result = run('syncthing cli config folders list 2>/dev/null');
  if (!result) { warn('Syncthing CLI not available — skipping'); return; }
  const folders = result.split('\n').map(s => s.trim()).filter(Boolean);
  const expected = new Set(['ai-context', 'documents']);
  const unexpected = folders.filter(f => !expected.has(f));
  if (unexpected.length > 0) {
    fail(`Unexpected Syncthing folders: ${unexpected.join(', ')} (should only be ai-context + documents)`);
  } else {
    pass(`Syncthing: ${folders.length} folders (${folders.join(', ')})`);
  }
}

// ── Run all checks ──
console.log('=== System Integrity Check (v0.8.1) ===\n');

checkManifest();
checkConfigHooks();
checkSymlinks();
checkMemoryIndex(path.join(AI, 'memory'), 'global');
for (const d of ['nix', '[project]', 'documents']) {
  const dir = path.join(AI, 'project-state', d, 'memory');
  if (fs.existsSync(dir)) checkMemoryIndex(dir, `project-state/${d}`);
}
checkHardcodedPaths();
checkBinaryBranches();
checkStaleRefs();
checkConfigValidity();
checkGitState();
checkSyncthing();

console.log(details.join('\n'));
console.log(`\n=== Summary: ${passCount} PASS, ${failCount} FAIL, ${warnCount} WARN ===`);

process.exit(failCount > 0 ? 1 : 0);
