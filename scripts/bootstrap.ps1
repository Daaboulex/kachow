#!/usr/bin/env pwsh
<#
.SYNOPSIS
  One-command bootstrap for a new Windows machine. Runs all setup in order.
#>

$ErrorActionPreference = 'Stop'

# Resolve user home via env fallback chain — PowerShell's $HOME automatic
# variable is cached at process start and won't follow $env:HOME overrides
# (CI smoke tests rely on those). Always consult env vars first.
function Get-UserHome {
  if ($env:HOME)        { return $env:HOME }
  if ($env:USERPROFILE) { return $env:USERPROFILE }
  return $HOME
}
$USER_HOME = Get-UserHome

# Use the script's own location (not $HOME) so the bootstrap works regardless
# of where AI_CONTEXT is mounted — including CI scratch $HOME overrides where
# PowerShell's $HOME automatic variable was cached at process start.
$SCRIPTS = $PSScriptRoot
if (-not $SCRIPTS) { $SCRIPTS = Join-Path $USER_HOME '.ai-context/scripts' }

# ── 1. Normalize $HOME in installed settings (cross-platform safety) ──
#
# cmd.exe doesn't expand shell $HOME in settings.json hook commands. Resolve
# to absolute paths at bootstrap time so Claude Code / Gemini CLI spawn the
# hooks reliably regardless of shell.
Write-Host "── Normalizing `$HOME in installed settings ──"
foreach ($tgt in @((Join-Path $USER_HOME '.claude/settings.json'), (Join-Path $USER_HOME '.gemini/settings.json'))) {
  if ((Test-Path $tgt) -and ((Get-Content $tgt -Raw) -match '"\$HOME')) {
    $homeForward = $USER_HOME.Replace('\', '/')
    $content = (Get-Content $tgt -Raw) -replace '\$HOME', $homeForward
    Set-Content $tgt $content -NoNewline
    Write-Host "  ✓ normalized `$HOME → $homeForward in $tgt"
  }
}

Write-Host ""
Write-Host "══ 2/4 install-adapters ══"
& (Join-Path $SCRIPTS 'install-adapters.ps1')

Write-Host ""
Write-Host "══ 3/4 install-mcp ══"
& (Join-Path $SCRIPTS 'install-mcp.ps1')

Write-Host ""
Write-Host "══ 4/4 health-check ══"
& (Join-Path $SCRIPTS 'health-check.ps1')

Write-Host ""
Write-Host "Bootstrap complete. Edit ~/.ai-context/AGENTS.md to update rules globally."
Write-Host "Run this bootstrap whenever you install a new AI tool (Cursor, Cline, etc)."
