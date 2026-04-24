#!/usr/bin/env node
// install-mcp.mjs — register personal-context MCP server in all MCP-capable AI tools.
// Cross-platform (replaces .sh + .ps1; behavior unified). Idempotent.
//
// DRIFT FIXED: old .sh hardcoded $HOME/.ai-context/...; old .ps1 derived
// dynamically. Now both paths use dynamic resolution from $AI_CONTEXT or
// __dirname/.. or os.homedir()/.ai-context.

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const AI = process.env.AI_CONTEXT || join(__dirname, '..') || join(homedir(), '.ai-context');
const SERVER = join(AI, 'mcp', 'personal-context', 'server.js');

if (!existsSync(SERVER)) {
  console.error(`ERROR: MCP server missing at ${SERVER}`);
  process.exit(1);
}

const HOME = homedir();

function readJson(path, fallback = {}) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}

function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

// Claude Code: ~/.claude.json → mcpServers
const claudeJson = join(HOME, '.claude.json');
if (existsSync(claudeJson)) {
  const d = readJson(claudeJson);
  d.mcpServers = d.mcpServers || {};
  d.mcpServers['personal-context'] = { type: 'stdio', command: 'node', args: [SERVER] };
  writeJson(claudeJson, d);
  console.log('✓ Claude Code');
} else {
  console.log("- Claude Code: ~/.claude.json missing — run 'claude' once to create");
}

// Gemini CLI: ~/.gemini/settings.json → mcpServers
const geminiSettings = join(HOME, '.gemini', 'settings.json');
if (existsSync(geminiSettings)) {
  const d = readJson(geminiSettings);
  d.mcpServers = d.mcpServers || {};
  d.mcpServers['personal-context'] = { command: 'node', args: [SERVER] };
  writeJson(geminiSettings, d);
  console.log('✓ Gemini CLI');
}

// Codex CLI: ~/.codex/config.toml (TOML)
const codexCfg = join(HOME, '.codex', 'config.toml');
mkdirSync(dirname(codexCfg), { recursive: true });
const codexBody = existsSync(codexCfg) ? readFileSync(codexCfg, 'utf8') : '';
if (!codexBody.includes('[mcp_servers.personal-context]')) {
  // Escape backslashes for TOML strings (Windows paths)
  const tomlPath = SERVER.replace(/\\/g, '\\\\');
  const block = `\n[mcp_servers.personal-context]\ncommand = "node"\nargs = ["${tomlPath}"]\n`;
  appendFileSync(codexCfg, block);
  console.log('✓ Codex CLI (config.toml)');
} else {
  console.log('✓ Codex CLI (already present)');
}

// OpenCode: ~/.config/opencode/config.json
const ocCfg = join(HOME, '.config', 'opencode', 'config.json');
const oc = readJson(ocCfg, {});
oc.mcp = oc.mcp || {};
oc.mcp['personal-context'] = { type: 'local', command: ['node', SERVER], enabled: true };
writeJson(ocCfg, oc);
console.log('✓ OpenCode');

// Cursor: ~/.cursor/mcp.json
const cursorDir = join(HOME, '.cursor');
const cursorCfg = join(cursorDir, 'mcp.json');
if (existsSync(cursorDir)) {
  const d = readJson(cursorCfg, { mcpServers: {} });
  d.mcpServers = d.mcpServers || {};
  d.mcpServers['personal-context'] = { command: 'node', args: [SERVER] };
  writeJson(cursorCfg, d);
  console.log('✓ Cursor');
} else {
  console.log('- Cursor: not installed (~/.cursor missing)');
}

// Continue.dev: ~/.continue/config.yaml
const contCfg = join(HOME, '.continue', 'config.yaml');
if (existsSync(contCfg)) {
  const yaml = readFileSync(contCfg, 'utf8');
  if (!yaml.includes('personal-context')) {
    const yamlBlock = `\nmcpServers:\n  - name: personal-context\n    command: node\n    args:\n      - ${SERVER}\n`;
    appendFileSync(contCfg, yamlBlock);
    console.log('✓ Continue.dev');
  } else {
    console.log('✓ Continue.dev (already present)');
  }
} else {
  console.log('- Continue.dev: not installed (~/.continue/config.yaml missing)');
}

// Cline: manual
console.log(`- Cline: configure manually in VSCode MCP panel with: node ${SERVER}`);

console.log();
console.log("Done. 'personal-context' MCP server registered in all installed tools.");
console.log('Tools exposed: search_memory, read_memory, list_memories, list_skills, get_skill, read_debt, get_rule (+ add_memory, add_debt write tools)');
