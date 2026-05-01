#!/usr/bin/env node
// system-health-check.mjs — comprehensive health audit
// Run at session start or manually to verify entire system.
// Checks: symlinks, hook registration, cross-tool parity, injection sizes,
// orphans, AGENTS.md budget, memory count, stale data.

import { readFileSync, existsSync, readdirSync, statSync, readlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';

const HOME = homedir();
let pass = 0, fail = 0, warn = 0;

function check(name, condition, detail) {
  if (condition) { console.log(`✅ ${name}`); pass++; }
  else { console.log(`❌ ${name}: ${detail}`); fail++; }
}
function warning(name, detail) { console.log(`⚠️  ${name}: ${detail}`); warn++; }

console.log('# System Health Check\n');

// 1. Symlink parity
console.log('## Cross-tool symlinks');
const symlinks = [
  ['.claude/CLAUDE.md', '.ai-context/AGENTS.md'],
  ['.gemini/GEMINI.md', '.ai-context/AGENTS.md'],
  ['.codex/AGENTS.md', '.ai-context/AGENTS.md'],
  ['.claude/memory', '.ai-context/memory'],
  ['.gemini/memory', '.ai-context/memory'],
  ['.codex/memories', '.ai-context/memory'],
  ['.claude/.superpowers', '.ai-context/.superpowers'],
  ['.gemini/.superpowers', '.ai-context/.superpowers'],
  ['.codex/.superpowers', '.ai-context/.superpowers'],
];
for (const [link, target] of symlinks) {
  const linkPath = join(HOME, link);
  const targetPath = join(HOME, target);
  try {
    const actual = readlinkSync(linkPath);
    const matches = actual === targetPath || actual.endsWith(target);
    check(`${link} → ${target}`, matches, `points to ${actual}`);
  } catch {
    check(`${link} symlink`, false, 'missing or not a symlink');
  }
}

// 2. AGENTS.md budget
console.log('\n## AGENTS.md');
try {
  const agentsLines = readFileSync(join(HOME, '.ai-context/AGENTS.md'), 'utf8').split('\n').filter(Boolean).length;
  check(`AGENTS.md ≤200 lines`, agentsLines <= 200, `${agentsLines} lines`);
  if (agentsLines > 190) warning('AGENTS.md near budget', `${agentsLines}/200 lines`);
} catch { check('AGENTS.md readable', false, 'file not found'); }

// 3. Hook registration (no orphans across all 3 tools)
// Post-canonicalization 2026-04-29: hooks live at ~/.ai-context/hooks/ and are
// symlinked into ~/.claude/hooks/ + ~/.gemini/hooks/. Codex registers in TOML.
// A hook is "orphaned" only if NONE of the 3 tools register it.
console.log('\n## Hook registration');
try {
  const hooksDir = join(HOME, '.claude/hooks');
  const claudeSettings = readFileSync(join(HOME, '.claude/settings.json'), 'utf8');
  let geminiSettings = '';
  try { geminiSettings = readFileSync(join(HOME, '.gemini/settings.json'), 'utf8'); } catch {}
  let codexConfig = '';
  try { codexConfig = readFileSync(join(HOME, '.codex/config.toml'), 'utf8'); } catch {}
  const allRegistrations = claudeSettings + '\n' + geminiSettings + '\n' + codexConfig;
  const hookFiles = readdirSync(hooksDir).filter(f => f.endsWith('.js') || f.endsWith('.sh'));
  // Allowlisted standalone hooks (used as CLIs, not registered as event hooks):
  const STANDALONE_ALLOWED = new Set(['validate-symlinks.js']);
  let orphans = 0;
  for (const f of hookFiles) {
    if (STANDALONE_ALLOWED.has(f)) continue;
    if (!allRegistrations.includes(f)) {
      warning(`Orphan hook: ${f}`, 'not registered in any tool');
      orphans++;
    }
  }
  check('Zero orphan hooks (claude + gemini + codex)', orphans === 0, `${orphans} orphans found`);
} catch { check('Hook dir readable', false, 'error'); }

// 4. Memory count
console.log('\n## Memory system');
const memDir = join(HOME, '.ai-context/memory');
try {
  const memFiles = readdirSync(memDir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md');
  console.log(`  ${memFiles.length} memory files (3 loaded per session, rest searchable)`);
  if (memFiles.length > 80) warning('Memory bloat', `${memFiles.length} files — consider consolidation`);

  // Check for AGENTS.md rules that should be there
  const agents = readFileSync(join(HOME, '.ai-context/AGENTS.md'), 'utf8');
  check('AGENTS.md has model selection rules', agents.includes('model.*sonnet') || agents.includes('Agent Dispatch Rules'), 'missing');
} catch { check('Memory dir readable', false, 'error'); }

// 5. Codex hooks
console.log('\n## Codex parity');
try {
  const codexConfig = readFileSync(join(HOME, '.codex/config.toml'), 'utf8');
  check('Codex hooks enabled', codexConfig.includes('codex_hooks = true'), 'codex_hooks not enabled');
  const codexHookCount = (codexConfig.match(/\[\[hooks\./g) || []).length;
  console.log(`  ${codexHookCount} hook entries in config.toml`);
} catch { check('Codex config readable', false, 'file not found'); }

// 6. Git repos + remotes
console.log('\n## Git repos');
for (const repo of ['.claude', '.gemini', '.codex', '.ai-context']) {
  const gitDir = join(HOME, repo, '.git');
  check(`${repo} is git repo`, existsSync(gitDir), 'no .git dir');
  if (existsSync(gitDir) && repo !== '.ai-context') {
    try {
      const remote = execSync('git remote get-url origin', { cwd: join(HOME, repo), encoding: 'utf8', timeout: 2000 }).trim();
      check(`${repo} has remote`, !!remote, 'no origin remote');
    } catch { check(`${repo} has remote`, false, 'no origin remote — run: git remote add origin <url>'); }
  }
}

// 7. Stale data
console.log('\n## Stale data');
const staleFiles = [
  '.ai-context/instances/active-peers.json',
  '.claude/.caveman-reactivate',
];
for (const f of staleFiles) {
  const p = join(HOME, f);
  if (existsSync(p)) {
    const age = Date.now() - statSync(p).mtimeMs;
    if (age > 10 * 60 * 1000) {
      warning(`Stale file: ${f}`, `${Math.round(age/60000)}min old`);
    }
  }
}

// Summary
console.log(`\n# Summary: ${pass} PASS, ${fail} FAIL, ${warn} WARN`);
process.exit(fail > 0 ? 1 : 0);
