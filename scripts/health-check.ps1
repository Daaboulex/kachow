#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Windows parity for health-check.sh. Verify canonical source, symlinks, MCP server, JSON validity.
#>

$ErrorActionPreference = 'Continue'
$AI =
  if     ($env:AI_CONTEXT) { $env:AI_CONTEXT }
  elseif ($PSScriptRoot)   { Split-Path $PSScriptRoot -Parent }
  else                     { Join-Path $USER_HOME '.ai-context' }
$fails = 0

function Pass { param($m); Write-Host ('  ✓ ' + $m) -ForegroundColor Green }
function Fail { param($m); Write-Host ('  ✗ ' + $m) -ForegroundColor Red; $script:fails++ }
function Warn { param($m); Write-Host ('  ~ ' + $m) -ForegroundColor Yellow }

Write-Host "═══ AI-context health check ═══"
Write-Host ""
Write-Host "── Canonical source ──"
foreach ($p in @(
  @{file='AGENTS.md';label='AGENTS.md exists'},
  @{file='memory';label='memory/ dir exists'},
  @{file='skills';label='skills/ dir exists'},
  @{file='mcp/personal-context/server.js';label='MCP server exists'},
  @{file='scripts/install-adapters.mjs';label='install-adapters.mjs'},
  @{file='scripts/install-mcp.mjs';label='install-mcp.mjs'}
)) {
  if (Test-Path (Join-Path $AI $p.file)) { Pass $p.label } else { Fail $p.label }
}

Write-Host ""
Write-Host "── AGENTS.md symlinks ──"
foreach ($kv in @{
  '.claude/CLAUDE.md'            = 'AGENTS.md'
  '.gemini/GEMINI.md'            = 'AGENTS.md'
  '.codex/AGENTS.md'             = 'AGENTS.md'
  '.config/opencode/AGENTS.md'   = 'AGENTS.md'
  '.config/aider/AGENTS.md'      = 'AGENTS.md'
}.GetEnumerator()) {
  $p = Join-Path $USER_HOME $kv.Key
  if (Test-Path $p) {
    $i = Get-Item $p -Force
    if ($i.LinkType -eq 'SymbolicLink' -and $i.Target -eq (Join-Path $AI 'AGENTS.md')) {
      Pass "$($kv.Key) → $($kv.Value)"
    } else {
      Fail "$($kv.Key) not symlinked to canonical"
    }
  } else {
    Warn "$($kv.Key) missing (optional?)"
  }
}

Write-Host ""
Write-Host "── Settings JSON validity ──"
foreach ($f in @('.claude/settings.json', '.gemini/settings.json', '.claude.json')) {
  $p = Join-Path $USER_HOME $f
  if (Test-Path $p) {
    try {
      Get-Content $p -Raw | ConvertFrom-Json | Out-Null
      Pass "$f parses"
    } catch { Fail "$f invalid JSON: $_" }
  } else { Warn "$f missing" }
}

Write-Host ""
Write-Host "── MCP server ──"
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) { Pass 'node available' } else { Fail 'node not in PATH' }
# MCP smoke (skip on Windows unless node present)
if ($node) {
  $server = Join-Path $AI 'mcp/personal-context/server.js'
  if (Test-Path $server) {
    try {
      $init = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}'
      $list = '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
      $resp = ($init + "`n" + $list + "`n") | & node $server 2>$null | Select-Object -Last 1
      if ($resp -match '"tools":\[') {
        $toolsCount = ($resp | Select-String -Pattern '"name":"' -AllMatches).Matches.Count
        Pass "MCP server responds ($toolsCount tools)"
      } else { Fail 'MCP server no tools in response' }
    } catch { Fail "MCP smoke failed: $_" }
  }
}

Write-Host ""
Write-Host "── Git state ──"
Push-Location $AI
try {
  git rev-parse --git-dir 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Pass '~/.ai-context/ is git repo'
    $st = git status --porcelain
    if ($st) { Warn "$(($st -split "`n").Count) uncommitted change(s) — will auto-commit on next session end" }
  } else { Fail '~/.ai-context/ is not a git repo (run: cd ~/.ai-context && git init)' }
} finally { Pop-Location }

Write-Host ""
if ($fails -eq 0) {
  Write-Host '═══ ALL CHECKS PASSED ═══' -ForegroundColor Green
  exit 0
} else {
  Write-Host "═══ $fails CHECK(S) FAILED ═══" -ForegroundColor Red
  exit 1
}
