#!/usr/bin/env bash
# Register personal-context MCP server in all MCP-capable AI tools.
# Idempotent — safe to re-run.

set -euo pipefail

SERVER=$HOME/.ai-context/mcp/personal-context/server.js

if [ ! -f "$SERVER" ]; then
  echo "ERROR: MCP server missing at $SERVER" >&2
  exit 1
fi

# ─── Claude Code ─── uses ~/.claude.json → mcpServers
# Create minimal ~/.claude.json if missing (health-check expects it to parse).
if [ ! -f "$HOME/.claude.json" ]; then
  echo '{}' > "$HOME/.claude.json"
  echo "  + created minimal ~/.claude.json"
fi
node - <<NODE
const fs = require('fs');
const p = '$HOME/.claude.json';
const d = JSON.parse(fs.readFileSync(p, 'utf8'));
d.mcpServers = d.mcpServers || {};
d.mcpServers['personal-context'] = {
  type: 'stdio',
  command: 'node',
  args: ['$SERVER'],
};
fs.writeFileSync(p, JSON.stringify(d, null, 2));
console.log('✓ Claude Code');
NODE

# ─── Gemini CLI ─── uses ~/.gemini/settings.json → mcpServers
# Create minimal settings.json if missing.
mkdir -p "$HOME/.gemini"
if [ ! -f "$HOME/.gemini/settings.json" ]; then
  echo '{}' > "$HOME/.gemini/settings.json"
  echo "  + created minimal ~/.gemini/settings.json"
fi
node - <<NODE
const fs = require('fs');
const p = '$HOME/.gemini/settings.json';
const d = JSON.parse(fs.readFileSync(p, 'utf8'));
d.mcpServers = d.mcpServers || {};
d.mcpServers['personal-context'] = {
  command: 'node',
  args: ['$SERVER'],
};
fs.writeFileSync(p, JSON.stringify(d, null, 2));
console.log('✓ Gemini CLI');
NODE

# ─── Codex CLI ─── uses ~/.codex/config.toml (TOML)
mkdir -p "$HOME/.codex"
CODEX_CFG="$HOME/.codex/config.toml"
if ! grep -q '\[mcp_servers.personal-context\]' "$CODEX_CFG" 2>/dev/null; then
  cat >> "$CODEX_CFG" <<TOML

[mcp_servers.personal-context]
command = "node"
args = ["$SERVER"]
TOML
  echo "✓ Codex CLI (config.toml)"
else
  echo "✓ Codex CLI (already present)"
fi

# ─── OpenCode ─── uses ~/.config/opencode/config.json
OC_CFG="$HOME/.config/opencode/config.json"
mkdir -p "$(dirname "$OC_CFG")"
if [ ! -f "$OC_CFG" ]; then echo '{}' > "$OC_CFG"; fi
node - <<NODE
const fs = require('fs');
const p = '$OC_CFG';
let d = {};
try { d = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
d.mcp = d.mcp || {};
d.mcp['personal-context'] = {
  type: 'local',
  command: ['node', '$SERVER'],
  enabled: true,
};
fs.writeFileSync(p, JSON.stringify(d, null, 2));
console.log('✓ OpenCode');
NODE

# ─── Cursor ─── uses ~/.cursor/mcp.json
CURSOR_CFG="$HOME/.cursor/mcp.json"
if [ -d "$HOME/.cursor" ]; then
  if [ ! -f "$CURSOR_CFG" ]; then echo '{"mcpServers":{}}' > "$CURSOR_CFG"; fi
  node - <<NODE
const fs = require('fs');
const p = '$CURSOR_CFG';
const d = JSON.parse(fs.readFileSync(p, 'utf8'));
d.mcpServers = d.mcpServers || {};
d.mcpServers['personal-context'] = {
  command: 'node',
  args: ['$SERVER'],
};
fs.writeFileSync(p, JSON.stringify(d, null, 2));
console.log('✓ Cursor');
NODE
else
  echo "- Cursor: not installed (~/.cursor missing)"
fi

# ─── Cline (VSCode extension) ─── uses its own panel. Print instructions.
echo "- Cline: configure manually in VSCode MCP panel with: node $SERVER"

# ─── Continue.dev ─── uses ~/.continue/config.yaml
CONT_CFG="$HOME/.continue/config.yaml"
if [ -f "$CONT_CFG" ]; then
  if ! grep -q 'personal-context' "$CONT_CFG"; then
    cat >> "$CONT_CFG" <<YAML

mcpServers:
  - name: personal-context
    command: node
    args:
      - $SERVER
YAML
    echo "✓ Continue.dev"
  else
    echo "✓ Continue.dev (already present)"
  fi
else
  echo "- Continue.dev: not installed (~/.continue/config.yaml missing)"
fi

echo
echo "Done. 'personal-context' MCP server registered in all installed tools."
echo "Tools exposed: search_memory, read_memory, list_memories, list_skills, get_skill, read_debt, get_rule"
