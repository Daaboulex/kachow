#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Install / verify AGENTS.md symlinks for all supported AI tools on Windows.
.DESCRIPTION
  Windows parity for install-adapters.sh. Requires Developer Mode OR admin for symlinks.
  Source of truth: ~/.ai-context/AGENTS.md
.NOTES
  On Windows 10+: enable Developer Mode (Settings → Update & Security → For developers)
  so `New-Item -ItemType SymbolicLink` works without admin.
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

$AI_CONTEXT =
  if     ($env:AI_CONTEXT) { $env:AI_CONTEXT }
  elseif ($PSScriptRoot)   { Split-Path $PSScriptRoot -Parent }
  else                     { Join-Path $USER_HOME '.ai-context' }
$CANONICAL = Join-Path $AI_CONTEXT 'AGENTS.md'

if (-not (Test-Path $CANONICAL)) {
  Write-Error "canonical source missing at $CANONICAL"
  exit 1
}

$targets = [ordered]@{
  claude   = Join-Path $USER_HOME '.claude/CLAUDE.md'
  gemini   = Join-Path $USER_HOME '.gemini/GEMINI.md'
  codex    = Join-Path $USER_HOME '.codex/AGENTS.md'
  opencode = Join-Path $USER_HOME '.config/opencode/AGENTS.md'
  aider    = Join-Path $USER_HOME '.config/aider/AGENTS.md'
}
$optional = [ordered]@{
  'windsurf-global' = Join-Path $USER_HOME '.codeium/windsurf/memories/global_rules.md'
}

# Detect whether symlinks can be created without admin (Developer Mode enabled).
# Returns 'symlink' on success, 'copy' if not permitted.
function Test-SymlinkCapability {
  $probeDir = Join-Path ([System.IO.Path]::GetTempPath()) ("ai-ctx-probe-" + [guid]::NewGuid())
  New-Item -ItemType Directory -Path $probeDir | Out-Null
  try {
    $target = Join-Path $probeDir 'target.txt'
    Set-Content $target 'x' -NoNewline
    $link = Join-Path $probeDir 'link.txt'
    try {
      New-Item -ItemType SymbolicLink -Path $link -Target $target -ErrorAction Stop | Out-Null
      return 'symlink'
    } catch {
      return 'copy'
    }
  } finally {
    Remove-Item $probeDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

$script:Mode = Test-SymlinkCapability
if ($script:Mode -eq 'copy') {
  Write-Host ""
  Write-Host "⚠ Developer Mode not enabled (or not running elevated)." -ForegroundColor Yellow
  Write-Host "  Falling back to COPY mode: AGENTS.md is duplicated into each tool's dir." -ForegroundColor Yellow
  Write-Host "  Downside: you must re-run this script after every canonical edit." -ForegroundColor Yellow
  Write-Host "  Fix: Settings → Privacy & security → For developers → enable Developer Mode." -ForegroundColor Yellow
  Write-Host ""
}

function Install-Symlink {
  param($Label, $Path)
  $dir = Split-Path -Parent $Path
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  # HARD GUARD: never create a symlink to a non-existent target.
  if (-not (Test-Path $CANONICAL)) {
    Write-Error "✗ ${Label}: REFUSING — target does not exist: $CANONICAL"
    return
  }
  if (Test-Path $Path) {
    $item = Get-Item $Path -Force
    if ($item.LinkType -eq 'SymbolicLink') {
      if ($item.Target -eq $CANONICAL) {
        Write-Host "✓ ${Label}: already linked → $CANONICAL"
        return
      }
      Write-Host "↻ ${Label}: replacing stale symlink"
      Remove-Item $Path -Force
    } else {
      $bak = "$Path.pre-ai-context-bak-$([int][double]::Parse((Get-Date -UFormat %s)))"
      Write-Host "↻ ${Label}: backing up existing file to $(Split-Path $bak -Leaf)"
      Move-Item $Path $bak
    }
  }
  if ($script:Mode -eq 'symlink') {
    New-Item -ItemType SymbolicLink -Path $Path -Target $CANONICAL | Out-Null
    if (-not (Test-Path $Path)) {
      Write-Error "✗ ${Label}: SYMLINK CREATED BUT BROKEN — target resolved to nothing: $Path"
      return
    }
    Write-Host "+ ${Label}: linked → $CANONICAL"
  } else {
    # Fallback: copy. Less efficient but works without Dev Mode / admin.
    Copy-Item -Path $CANONICAL -Destination $Path -Force
    Write-Host "+ ${Label}: copied from $CANONICAL  (COPY MODE — re-run this script after edits)"
  }
}

Write-Host "== Core AI tools =="
foreach ($kv in $targets.GetEnumerator()) { Install-Symlink -Label $kv.Key -Path $kv.Value }

Write-Host ""
Write-Host "== Optional tools (linked if dir exists) =="
foreach ($kv in $optional.GetEnumerator()) {
  $parent = Split-Path -Parent $kv.Value
  if (Test-Path $parent) {
    Install-Symlink -Label $kv.Key -Path $kv.Value
  } else {
    Write-Host "- $($kv.Key): skipped (dir not present: $parent)"
  }
}

Write-Host ""
Write-Host "Done. Edit $CANONICAL and every tool picks up the change."
