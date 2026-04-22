#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Register personal-context MCP server in all MCP-capable AI tools on Windows.
.DESCRIPTION
  Windows parity for install-mcp.sh. Idempotent — safe to re-run.
#>

$ErrorActionPreference = 'Stop'

# Resolve user home via env fallback chain — PowerShell's $HOME automatic
# variable is cached at process start and ignores $env:HOME overrides used
# by CI smoke tests. Always check env vars first.
function Get-UserHome {
  if ($env:HOME)        { return $env:HOME }
  if ($env:USERPROFILE) { return $env:USERPROFILE }
  return $HOME
}
$USER_HOME = Get-UserHome


$AI =
  if     ($env:AI_CONTEXT) { $env:AI_CONTEXT }
  elseif ($PSScriptRoot)   { Split-Path $PSScriptRoot -Parent }
  else                     { Join-Path $USER_HOME '.ai-context' }
$Server = Join-Path $AI 'mcp/personal-context/server.js'
if (-not (Test-Path $Server)) { Write-Error "MCP server missing at $Server"; exit 1 }

function Merge-JsonMcp {
  param($Path, $Block, [string[]]$NestedKey = @('mcpServers'))
  if (-not (Test-Path $Path)) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
    '{}' | Set-Content $Path -NoNewline
  }
  $raw = Get-Content $Path -Raw
  if (-not $raw.Trim()) { $raw = '{}' }
  $json = $raw | ConvertFrom-Json -AsHashtable
  $node = $json
  for ($i = 0; $i -lt $NestedKey.Count - 1; $i++) {
    $k = $NestedKey[$i]
    if (-not $node.ContainsKey($k)) { $node[$k] = @{} }
    $node = $node[$k]
  }
  $leaf = $NestedKey[-1]
  if (-not $node.ContainsKey($leaf)) { $node[$leaf] = @{} }
  $node[$leaf]['personal-context'] = $Block
  $json | ConvertTo-Json -Depth 32 | Set-Content $Path
}

# Claude Code
$claudeJson = Join-Path $USER_HOME '.claude.json'
if (Test-Path $claudeJson) {
  Merge-JsonMcp -Path $claudeJson -Block @{ type = 'stdio'; command = 'node'; args = @($Server) } -NestedKey @('mcpServers')
  Write-Host "✓ Claude Code"
} else { Write-Host "- Claude Code: ~/.claude.json missing — run 'claude' once to create" }

# Gemini CLI
$geminiSettings = Join-Path $USER_HOME '.gemini/settings.json'
if (Test-Path $geminiSettings) {
  Merge-JsonMcp -Path $geminiSettings -Block @{ command = 'node'; args = @($Server) } -NestedKey @('mcpServers')
  Write-Host "✓ Gemini CLI"
}

# Codex CLI (TOML)
$codexCfg = Join-Path $USER_HOME '.codex/config.toml'
New-Item -ItemType Directory -Path (Split-Path -Parent $codexCfg) -Force | Out-Null
$toml = if (Test-Path $codexCfg) { Get-Content $codexCfg -Raw } else { '' }
if ($toml -notmatch '\[mcp_servers\.personal-context\]') {
  $escaped = $Server.Replace('\', '\\')
  $block = "`n[mcp_servers.personal-context]`ncommand = ""node""`nargs = [""$escaped""]`n"
  Add-Content -Path $codexCfg -Value $block
  Write-Host "✓ Codex CLI (config.toml)"
} else {
  Write-Host "✓ Codex CLI (already present)"
}

# OpenCode
$ocCfg = Join-Path $USER_HOME '.config/opencode/config.json'
Merge-JsonMcp -Path $ocCfg -Block @{ type = 'local'; command = @('node', $Server); enabled = $true } -NestedKey @('mcp')
Write-Host "✓ OpenCode"

# Cursor
$cursorCfg = Join-Path $USER_HOME '.cursor/mcp.json'
if (Test-Path (Split-Path -Parent $cursorCfg)) {
  Merge-JsonMcp -Path $cursorCfg -Block @{ command = 'node'; args = @($Server) } -NestedKey @('mcpServers')
  Write-Host "✓ Cursor"
} else { Write-Host "- Cursor: not installed (~/.cursor missing)" }

# Continue.dev
$contCfg = Join-Path $USER_HOME '.continue/config.yaml'
if (Test-Path $contCfg) {
  $yaml = Get-Content $contCfg -Raw
  if ($yaml -notmatch 'personal-context') {
    $yamlBlock = "`nmcpServers:`n  - name: personal-context`n    command: node`n    args:`n      - $Server`n"
    Add-Content -Path $contCfg -Value $yamlBlock
    Write-Host "✓ Continue.dev"
  } else { Write-Host "✓ Continue.dev (already present)" }
} else { Write-Host "- Continue.dev: not installed" }

Write-Host "- Cline: configure manually in VSCode MCP panel with: node $Server"
Write-Host ""
Write-Host "Done. 'personal-context' MCP server registered in all installed tools."
