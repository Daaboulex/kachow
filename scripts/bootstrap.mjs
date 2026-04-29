#!/usr/bin/env node
// One-command bootstrap for a new machine.
//
// What it does:
//   1. Verify AI_CONTEXT (canonical source) is present + has AGENTS.md
//   2. Normalize $HOME in installed settings.json files (Windows safety)
//   3. Run install-adapters.mjs — AGENTS.md symlinks per tool
//   4. Run install-mcp.mjs — register MCP server in every installed tool
//   5. Link memory/ + per-skill into ~/.claude/ + ~/.gemini/
//   6. Run health-check.mjs — verify everything before declaring done
//
// Hidden drift fixed (sh + ps1 → unified .mjs):
//   - ps1 skipped the canonical-source-exists precheck; sh did it.
//   - ps1 skipped memory/ + per-skill symlink creation; sh did it.
//   - $HOME normalization was implemented twice — once in bash+Node,
//     once in pure PowerShell. Now one Node implementation handles both.
//   - Canonical path resolution: sh = env | $HOME/.ai-context;
//     ps1 = env | $PSScriptRoot parent | $HOME/.ai-context.
//     This .mjs uses the ps1 ordering everywhere.

'use strict';

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import cp from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const HOME       = os.homedir();
const AI_CONTEXT =
  process.env.AI_CONTEXT
  || path.dirname(__dirname)
  || path.join(HOME, '.ai-context');
const SCRIPTS    = path.join(AI_CONTEXT, 'scripts');

console.log('═══ AI-context bootstrap ═══');
console.log('');

// ── 1. Canonical source present? ──
if (!fs.existsSync(AI_CONTEXT)) {
  console.error(`✗ ${AI_CONTEXT} missing.`);
  console.error(`  Clone first: git clone <your-ai-context-remote> ${AI_CONTEXT}`);
  console.error(`  OR: enable Syncthing for this dir on another device.`);
  process.exit(1);
}
if (!fs.existsSync(path.join(AI_CONTEXT, 'AGENTS.md'))) {
  console.error(`✗ ${AI_CONTEXT} exists but AGENTS.md missing — did clone complete?`);
  process.exit(1);
}
console.log(`✓ canonical source at ${AI_CONTEXT}`);

// ── 2. Normalize $HOME in installed settings (cross-platform safety) ──
console.log('');
console.log('── Normalizing $HOME in installed settings ──');
const homeForward = HOME.replace(/\\/g, '/');
for (const rel of ['.claude/settings.json', '.gemini/settings.json']) {
  const p = path.join(HOME, rel);
  if (!fs.existsSync(p)) continue;
  const before = fs.readFileSync(p, 'utf8');
  if (!before.includes('"$HOME')) continue;
  const after = before.replace(/\$HOME/g, homeForward);
  fs.writeFileSync(p, after);
  console.log(`✓ normalized $HOME → ${homeForward} in ${p}`);
}

// ── 3. Adapters ──
function runNode(scriptPath, label) {
  console.log('');
  console.log(`── ${label} ──`);
  const r = cp.spawnSync('node', [scriptPath], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`✗ ${label} failed (exit ${r.status})`);
    process.exit(r.status || 1);
  }
}
runNode(path.join(SCRIPTS, 'install-adapters.mjs'), 'Installing AGENTS.md adapters');

// ── 3b. Hooks (JSON: Claude + Gemini) ──
runNode(path.join(SCRIPTS, 'install-hooks.mjs'), 'Installing hooks (Claude + Gemini)');

// ── 3c. Codex hook detection (TOML — separate from JSON installer) ──
// Codex stores hooks in config.toml, not settings.json. Currently no bulk
// wirer for kachow's Codex hooks; bulk-wire script is v0.4 work. Until then,
// surface the gap so users can hand-author config.toml or use
// wire-hook-codex.mjs per-hook.
const codexDir = path.join(os.homedir(), '.codex');
if (fs.existsSync(codexDir)) {
  const codexConfig = path.join(codexDir, 'config.toml');
  let codexHasHooks = false;
  try {
    const cfg = fs.readFileSync(codexConfig, 'utf8');
    codexHasHooks = /codex_hooks\s*=\s*true/.test(cfg);
  } catch {}
  if (!codexHasHooks) {
    console.log('  ⚠ Codex detected but config.toml missing or hooks not enabled.');
    console.log('    Manual setup needed (settings.codex.template.toml is v0.4 work).');
    console.log('    OR use scripts/wire-hook-codex.mjs per-hook to wire individual hooks.');
  } else {
    console.log('  ✓ Codex config.toml has hooks enabled.');
  }
}

// ── 4. MCP registration ──
runNode(path.join(SCRIPTS, 'install-mcp.mjs'), 'Registering MCP server');

// ── 5. Memory + per-skill symlinks ──
console.log('');
console.log('── Memory + skills symlinks ──');

function linkIfMissing({ dest, src, label }) {
  let existing;
  try { existing = fs.lstatSync(dest); } catch { existing = null; }

  if (existing && existing.isSymbolicLink()) {
    console.log(`✓ ${label}: already symlinked`);
    return;
  }
  if (existing) {
    const bak = `${dest}.pre-bootstrap-bak-${Math.floor(Date.now() / 1000)}`;
    console.log(`↻ ${label}: backing up existing to ${path.basename(bak)}`);
    fs.renameSync(dest, bak);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.symlinkSync(src, dest, 'dir');
  console.log(`+ ${label}: linked`);
}

const skillsDir = path.join(AI_CONTEXT, 'skills');
const skillNames = fs.existsSync(skillsDir)
  ? fs.readdirSync(skillsDir).filter((n) => {
      try { return fs.statSync(path.join(skillsDir, n)).isDirectory(); }
      catch { return false; }
    })
  : [];

for (const tool of ['.claude', '.gemini']) {
  const toolDir = path.join(HOME, tool);
  if (!fs.existsSync(toolDir)) continue;
  linkIfMissing({
    dest: path.join(toolDir, 'memory'),
    src:  path.join(AI_CONTEXT, 'memory'),
    label: `${tool.slice(1)} memory`,
  });
  for (const name of skillNames) {
    linkIfMissing({
      dest: path.join(toolDir, 'skills', name),
      src:  path.join(AI_CONTEXT, 'skills', name),
      label: `${tool.slice(1)} skill:${name}`,
    });
  }
}

// ── 6. Verify ──
runNode(path.join(SCRIPTS, 'health-check.mjs'), 'Verification');

console.log('');
console.log('═══ Bootstrap complete ═══');
console.log(`Edit: ${path.join(AI_CONTEXT, 'AGENTS.md')}`);
console.log('Every AI tool (Claude, Gemini, Codex, OpenCode, Aider, Cursor) now reads from it.');
console.log('MCP tools (search_memory, read_debt, list_tasks, etc.) available in every MCP-capable client.');
