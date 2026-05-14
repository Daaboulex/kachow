#!/usr/bin/env node
// Comprehensive verification of v2 staging directory
// Run: node scripts/verify-v2.mjs

import { existsSync, readdirSync, readFileSync, lstatSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';

const ROOT = resolve(homedir(), '.ai-context');
const PASS = '  PASS';
const FAIL = '  FAIL';
const WARN = '  WARN';
let failures = 0;
let warnings = 0;

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`${PASS}: ${label}`);
  } else {
    console.log(`${FAIL}: ${label}${detail ? ' — ' + detail : ''}`);
    failures++;
  }
}

function warn(label, condition, detail = '') {
  if (condition) {
    console.log(`${PASS}: ${label}`);
  } else {
    console.log(`${WARN}: ${label}${detail ? ' — ' + detail : ''}`);
    warnings++;
  }
}

function countFiles(dir, ext) {
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && (!ext || entry.name.endsWith(ext))) count++;
  }
  return count;
}

function fileContains(path, str) {
  if (!existsSync(path)) return false;
  return readFileSync(path, 'utf8').includes(str);
}

function fileLineCount(path) {
  if (!existsSync(path)) return 0;
  return readFileSync(path, 'utf8').split('\n').length;
}

console.log('\n=== AI Context v2 Verification ===\n');

// 1. Directory Structure
console.log('--- Directory Structure ---');
const requiredDirs = [
  'core/memory', 'core/memory/user', 'core/memory/feedback', 'core/memory/archive',
  'core/skills/commands', 'core/skills/global',
  'modules/tools/claude', 'modules/tools/gemini', 'modules/tools/codex', 'modules/tools/pi',
  'modules/hooks/src', 'modules/hooks/lib',
  'projects/template', 'projects/nix', 'projects/[project]',
  'generated/configs', 'generated/sync',
  'scripts', 'runtime', 'public/kachow-mirror'
];
for (const d of requiredDirs) {
  check(`Dir exists: ${d}`, existsSync(join(ROOT, d)));
}

// 2. No symlinks in staging
console.log('\n--- Symlink Check ---');
let symlinkCount = 0;
function checkSymlinks(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (lstatSync(full).isSymbolicLink()) symlinkCount++;
    if (entry.isDirectory() && entry.name !== '.git' && entry.name !== 'runtime') {
      checkSymlinks(full);
    }
  }
}
checkSymlinks(ROOT);
warn('Symlink count reasonable (<200)', symlinkCount < 200, `found ${symlinkCount}`);

// 3. Core Documents
console.log('\n--- Core Documents ---');
check('AGENTS.md exists', existsSync(join(ROOT, 'AGENTS.md')));
const agentsLines = fileLineCount(join(ROOT, 'AGENTS.md'));
check('AGENTS.md < 160 lines', agentsLines < 160, `${agentsLines} lines`);
check('No Crush references', !fileContains(join(ROOT, 'AGENTS.md'), 'Crush'));
check('No OpenCode references', !fileContains(join(ROOT, 'AGENTS.md'), 'OpenCode'));
check('Has Directory Layout section', fileContains(join(ROOT, 'AGENTS.md'), 'Directory Layout'));
check('AGENTS-domain-specific.md exists', existsSync(join(ROOT, 'AGENTS-domain-specific.md')));
check('VERSION exists', existsSync(join(ROOT, 'VERSION')));
check('DIRECTORY-MAP.md exists', existsSync(join(ROOT, 'DIRECTORY-MAP.md')));

// 4. Hooks
console.log('\n--- Hooks ---');
const manifestPath = join(ROOT, 'modules/hooks/MANIFEST.yaml');
check('MANIFEST.yaml exists', existsSync(manifestPath));
if (existsSync(manifestPath)) {
  const manifest = readFileSync(manifestPath, 'utf8');
  const hookEntries = (manifest.match(/^\s+- file:/gm) || []).length;
  check('15 hooks in manifest', hookEntries === 15, `found ${hookEntries}`);
  check('No Crush in manifest', !manifest.toLowerCase().includes('crush'));
  check('No OpenCode in manifest', !manifest.toLowerCase().includes('opencode'));
}
const hookSrcCount = countFiles(join(ROOT, 'modules/hooks/src'), '.js');
check('15+ hook source files', hookSrcCount >= 15, `found ${hookSrcCount}`);
check('lib/tool-detect.js exists', existsSync(join(ROOT, 'modules/hooks/lib/tool-detect.js')));

// 5. Tool Adapters
console.log('\n--- Tool Adapters ---');
for (const tool of ['claude', 'gemini', 'codex']) {
  check(`${tool}/adapter.yaml`, existsSync(join(ROOT, `modules/tools/${tool}/adapter.yaml`)));
  check(`${tool}/capabilities.yaml`, existsSync(join(ROOT, `modules/tools/${tool}/capabilities.yaml`)));
  check(`${tool}/symlinks.yaml`, existsSync(join(ROOT, `modules/tools/${tool}/symlinks.yaml`)));
}
check('pi/adapter.yaml', existsSync(join(ROOT, 'modules/tools/pi/adapter.yaml')));

// 6. Skills
console.log('\n--- Skills ---');
const skillCount = countFiles(join(ROOT, 'core/skills'), 'SKILL.md');
check('Skills migrated (>= 15)', skillCount >= 15, `found ${skillCount}`);
const cmdSkills = existsSync(join(ROOT, 'core/skills/commands')) ? readdirSync(join(ROOT, 'core/skills/commands')).length : 0;
const globalSkills = existsSync(join(ROOT, 'core/skills/global')) ? readdirSync(join(ROOT, 'core/skills/global')).length : 0;
check('Command skills present', cmdSkills > 0, `${cmdSkills} found`);
check('Global skills present', globalSkills > 0, `${globalSkills} found`);

// 7. No OpenSpec duplicates in tool dirs
console.log('\n--- OpenSpec Dedup ---');
const toolDirs = ['.claude', '.gemini', '.codex', '.crush', '.opencode'];
for (const td of toolDirs) {
  const openspecInTool = existsSync(join(ROOT, td, 'skills'));
  warn(`No ${td}/skills/ dir (OpenSpec dedup)`, !openspecInTool, 'tool-specific skill dir still exists');
}

// 8. Single-Source AGENTS.md per project
console.log('\n--- Per-Project Single Source ---');
for (const proj of ['nix', '[project]']) {
  const projDir = join(ROOT, 'projects', proj);
  if (existsSync(projDir)) {
    check(`${proj}/AGENTS.md exists`, existsSync(join(projDir, 'AGENTS.md')));
    warn(`No ${proj}/CLAUDE.md duplicate`, !existsSync(join(projDir, 'CLAUDE.md')), 'should be symlink or absent');
    warn(`No ${proj}/GEMINI.md duplicate`, !existsSync(join(projDir, 'GEMINI.md')), 'should be symlink or absent');
    for (const td of ['claude', 'codex', 'crush', 'gemini', 'opencode', 'opencode-skills', 'opencode-commands']) {
      warn(`No ${proj}/${td}/ tool dir`, !existsSync(join(projDir, td)), 'tool dir should not exist in v2');
    }
  }
}

// 9. Memory
console.log('\n--- Memory ---');
check('Global MEMORY.md exists', existsSync(join(ROOT, 'core/memory/MEMORY.md')));
check('Memory subdirs exist', existsSync(join(ROOT, 'core/memory/user')) && existsSync(join(ROOT, 'core/memory/feedback')) && existsSync(join(ROOT, 'core/memory/project')) && existsSync(join(ROOT, 'core/memory/reference')));

// 10. Generated files
console.log('\n--- Generated ---');
check('Sync policy.yaml', existsSync(join(ROOT, 'generated/sync/policy.yaml')));
check('generate-sync-policy.mjs', existsSync(join(ROOT, 'scripts/generate-sync-policy.mjs')));
check('generate-directory-map.mjs', existsSync(join(ROOT, 'scripts/generate-directory-map.mjs')));

// 11. Project template
console.log('\n--- Project Template ---');
check('Template AGENTS.md exists', existsSync(join(ROOT, 'projects/template/AGENTS.md')));
check('Template has Available Context', fileContains(join(ROOT, 'projects/template/AGENTS.md'), 'Available Context'));

// ── Kachow Mirror Sync ──
console.log('\n── Kachow Mirror Sync ──');
try {
  const scrubScript = readFileSync(join(ROOT, 'scripts/scrub-for-publish.sh'), 'utf8');
  const manifestText2 = readFileSync(join(ROOT, 'modules/hooks/MANIFEST.yaml'), 'utf8');

  const scrubLines = scrubScript.split('\n');
  const portableHooks2 = [];
  let inBlock = false;
  for (const line of scrubLines) {
    if (line.trim().startsWith('PORTABLE_HOOKS=(')) { inBlock = true; continue; }
    if (inBlock && line.trim() === ')') { inBlock = false; break; }
    if (inBlock) {
      const cleaned = line.replace(/#.*$/, '').trim();
      if (cleaned) portableHooks2.push(cleaned);
    }
  }

  const manifestHooks2 = [...manifestText2.matchAll(/- file:\s*(\S+\.js)/g)].map(m => m[1].replace('.js', ''));
  const missing2 = manifestHooks2.filter(h => !portableHooks2.includes(h));
  const extra2 = portableHooks2.filter(h => !manifestHooks2.includes(h));

  if (missing2.length === 0 && extra2.length === 0) {
    console.log(PASS + ': scrub whitelist matches MANIFEST (' + portableHooks2.length + ' hooks)');
  } else {
    if (missing2.length > 0) {
      console.log(FAIL + `: MANIFEST hooks not in scrub whitelist: ${missing2.join(', ')}`);
      failures++;
    }
    if (extra2.length > 0) {
      console.log(WARN + `: scrub whitelist hooks not in MANIFEST: ${extra2.join(', ')}`);
      warnings++;
    }
  }
} catch (e) {
  console.log(WARN + ': kachow sync check failed — ' + e.message);
  warnings++;
}

// Summary
console.log('\n=== Summary ===');
console.log(`Failures: ${failures}`);
console.log(`Warnings: ${warnings}`);
console.log(`Result: ${failures === 0 ? 'ALL CHECKS PASSED' : 'FAILURES DETECTED'}`);
process.exit(failures > 0 ? 1 : 0);
