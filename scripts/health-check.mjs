#!/usr/bin/env node
// Health check: verify canonical source, symlinks, MCP server, JSON validity.
//
// Usage: node ~/.ai-context/scripts/health-check.mjs
// Exit: 0 all green, 1 any check failed.
//
// Hidden drift from sh / ps1 originals (preserved in migration commit):
//   - sh had: memory+skill symlink section, recursive symlink audit,
//             MCP-registered-in-clients across 4 clients.
//   - ps1 was missing all three. This .mjs unifies on the more-complete
//     sh behavior and runs on every OS.
//   - sh shelled out to python3 for JSON parsing (fragile dep). The .mjs
//     uses native JSON.parse.
//   - Both hardcoded the MCP server dir name ("personal-context"). The .mjs
//     auto-detects the first mcp/*/server.js so the health-check works
//     unchanged in the scrubbed public tree (where the dir is
//     "personal-context").

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

let FAILED = 0;

const C = {
  red:    (s) => process.stdout.isTTY ? `\x1b[31m${s}\x1b[0m` : s,
  green:  (s) => process.stdout.isTTY ? `\x1b[32m${s}\x1b[0m` : s,
  yellow: (s) => process.stdout.isTTY ? `\x1b[33m${s}\x1b[0m` : s,
};

function pass(msg) { console.log('  ' + C.green('✓') + ' ' + msg); }
function fail(msg) { console.log('  ' + C.red('✗')   + ' ' + msg); FAILED++; }
function warn(msg) { console.log('  ' + C.yellow('~') + ' ' + msg); }

function parseJsonFile(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}

function detectMcpServer() {
  const mcpDir = path.join(AI_CONTEXT, 'mcp');
  if (!fs.existsSync(mcpDir)) return null;
  for (const name of fs.readdirSync(mcpDir)) {
    const server = path.join(mcpDir, name, 'server.js');
    if (fs.existsSync(server)) return { name, server };
  }
  return null;
}

function readlinkSafe(p) {
  try { return fs.readlinkSync(p); } catch { return null; }
}

function isSymlink(p) {
  try { return fs.lstatSync(p).isSymbolicLink(); }
  catch { return false; }
}

// ────────────────────────────────────────────────────────────
console.log('═══ AI-context health check ═══');
console.log('');
console.log('── Canonical source ──');

const mcp = detectMcpServer();
const coreFiles = [
  { file: 'AGENTS.md', label: 'AGENTS.md exists' },
  { file: 'memory',    label: 'memory/ dir exists',    dir: true },
  { file: 'skills',    label: 'skills/ dir exists',    dir: true },
];
for (const c of coreFiles) {
  const p = path.join(AI_CONTEXT, c.file);
  const ok = c.dir ? (fs.existsSync(p) && fs.statSync(p).isDirectory()) : fs.existsSync(p);
  ok ? pass(c.label) : fail(c.label);
}
mcp
  ? pass(`MCP server exists (mcp/${mcp.name}/server.js)`)
  : fail('MCP server not found under mcp/*/server.js');
for (const s of ['install-adapters', 'install-mcp']) {
  const canonical = path.join(AI_CONTEXT, 'scripts', `${s}.mjs`);
  const wrapper   = path.join(AI_CONTEXT, 'scripts', `${s}.sh`);
  if (fs.existsSync(canonical) || fs.existsSync(wrapper)) pass(`${s} script present`);
  else fail(`${s} script missing`);
}

// ────────────────────────────────────────────────────────────
console.log('');
console.log('── AGENTS.md symlinks ──');
const agentTargets = [
  ['.claude/CLAUDE.md',            'AGENTS.md'],
  ['.gemini/GEMINI.md',            'AGENTS.md'],
  ['.codex/AGENTS.md',             'AGENTS.md'],
  ['.config/opencode/AGENTS.md',   'AGENTS.md'],
  ['.config/aider/AGENTS.md',      'AGENTS.md'],
];
const canonicalAgents = path.join(AI_CONTEXT, 'AGENTS.md');
for (const [rel] of agentTargets) {
  const target = path.join(HOME, rel);
  if (isSymlink(target) && readlinkSafe(target) === canonicalAgents) {
    pass(`${rel} → AGENTS.md`);
  } else if (isSymlink(target)) {
    warn(`${rel} → ${readlinkSafe(target)}  (not canonical)`);
  } else if (fs.existsSync(target)) {
    warn(`${rel} is a regular file (not symlinked)`);
  } else {
    warn(`${rel} missing (tool not installed?)`);
  }
}

// ────────────────────────────────────────────────────────────
console.log('');
console.log('── Memory + skill symlinks ──');
for (const rel of ['.claude/memory', '.gemini/memory']) {
  const target = path.join(HOME, rel);
  const canonical = path.join(AI_CONTEXT, 'memory');
  if (isSymlink(target) && readlinkSafe(target) === canonical) {
    pass(`${rel} → memory/`);
  } else {
    warn(`${rel} not symlinked to canonical`);
  }
}

// ────────────────────────────────────────────────────────────
console.log('');
console.log('── Recursive symlink audit ──');
const auditor = path.join(HOME, '.claude/hooks/lib/symlink-audit.js');
if (fs.existsSync(auditor)) {
  const r = cp.spawnSync('node', [auditor, '--json'], { encoding: 'utf8' });
  let summary = null;
  try { summary = JSON.parse(r.stdout || '{}').summary; } catch { /* ignore */ }
  if (summary && summary.broken_live === 0 && summary.loops === 0) {
    pass(`${summary.total} symlinks, 0 broken`);
  } else if (summary) {
    fail(`${summary.broken_live} broken live symlinks, ${summary.loops} loops`);
    const brokenList = cp.spawnSync('node', [auditor, '--only-broken'], { encoding: 'utf8' });
    (brokenList.stdout || '').split('\n').slice(0, 10)
      .filter(Boolean).forEach((l) => console.log('    ' + l));
  } else {
    warn('symlink-audit.js ran but returned no summary');
  }
} else {
  warn('symlink-audit.js not available — skipping recursive scan');
}

// ────────────────────────────────────────────────────────────
console.log('');
console.log('── Settings JSON validity ──');
for (const rel of ['.claude/settings.json', '.gemini/settings.json', '.claude.json']) {
  const p = path.join(HOME, rel);
  if (!fs.existsSync(p)) { warn(`${rel} missing`); continue; }
  parseJsonFile(p) !== null ? pass(`${rel} parses`) : fail(`${rel} invalid JSON`);
}

// ────────────────────────────────────────────────────────────
console.log('');
console.log('── MCP server ──');
if (!cp.spawnSync('node', ['--version'], { stdio: 'ignore' }).status === 0) {
  fail('node not in PATH — MCP server can\'t run');
} else if (!mcp) {
  fail('MCP server path unknown — skipping smoke test');
} else {
  pass('node available');
  const init = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'healthcheck', version: '1' } } });
  const noti = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const list = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const input = `${init}\n${noti}\n${list}\n`;
  const r = cp.spawnSync('node', [mcp.server], { input, encoding: 'utf8', timeout: 10000 });
  let toolsCount = 0;
  for (const line of (r.stdout || '').split('\n')) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.result && Array.isArray(msg.result.tools)) {
        toolsCount = msg.result.tools.length;
        break;
      }
    } catch { /* ignore non-JSON */ }
  }
  toolsCount > 0
    ? pass(`MCP server responds (${toolsCount} tools)`)
    : fail('MCP server not responding correctly');
}

// ────────────────────────────────────────────────────────────
console.log('');
console.log('── MCP registered in clients ──');
if (mcp) {
  // Claude
  const claudeJson = path.join(HOME, '.claude.json');
  if (fs.existsSync(claudeJson)) {
    const d = parseJsonFile(claudeJson);
    d && d.mcpServers && d.mcpServers[mcp.name]
      ? pass('Claude Code')
      : warn(`Claude Code: ${mcp.name} NOT registered`);
  }
  // Gemini
  const gemJson = path.join(HOME, '.gemini/settings.json');
  if (fs.existsSync(gemJson)) {
    const d = parseJsonFile(gemJson);
    d && d.mcpServers && d.mcpServers[mcp.name]
      ? pass('Gemini CLI')
      : warn(`Gemini CLI: ${mcp.name} NOT registered`);
  }
  // Codex (TOML — simple regex check, no parser dep)
  const codexToml = path.join(HOME, '.codex/config.toml');
  if (fs.existsSync(codexToml)) {
    const txt = fs.readFileSync(codexToml, 'utf8');
    new RegExp(`\\[mcp_servers\\.${mcp.name}\\]`).test(txt)
      ? pass('Codex CLI')
      : warn(`Codex CLI: ${mcp.name} NOT registered`);
  }
  // OpenCode
  const ocJson = path.join(HOME, '.config/opencode/config.json');
  if (fs.existsSync(ocJson)) {
    const d = parseJsonFile(ocJson);
    d && d.mcp && d.mcp[mcp.name]
      ? pass('OpenCode')
      : warn(`OpenCode: ${mcp.name} NOT registered`);
  }
} else {
  warn('MCP server not detected — skipping client registration checks');
}

// ────────────────────────────────────────────────────────────
console.log('');
console.log('── Git state ──');
if (fs.existsSync(path.join(AI_CONTEXT, '.git'))) {
  pass('~/.ai-context/ is git repo');
  const r = cp.spawnSync('git', ['-C', AI_CONTEXT, 'status', '--porcelain'], { encoding: 'utf8' });
  const uncommitted = (r.stdout || '').split('\n').filter(Boolean).length;
  uncommitted > 0
    ? warn(`${uncommitted} uncommitted change(s) — will auto-commit on next session end`)
    : pass('clean');
} else {
  fail('~/.ai-context/ is not a git repo (run: cd ~/.ai-context && git init)');
}

console.log('');
if (FAILED === 0) {
  console.log(C.green('═══ ALL CHECKS PASSED ═══'));
  process.exit(0);
} else {
  console.log(C.red(`═══ ${FAILED} CHECK(S) FAILED ═══`));
  process.exit(1);
}
