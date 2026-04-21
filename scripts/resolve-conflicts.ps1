#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Resolve Syncthing .sync-conflict-* files under AI state directories.
.DESCRIPTION
  Lists conflicts, then for each offers keep-newest (default) or keep-local.
#>

$ErrorActionPreference = 'Continue'

# Default roots: the three AI-context dirs shipped by this framework.
# Add extra roots via env var: $env:RESOLVE_EXTRA_ROOTS="path1;path2"
$roots = @(
  (Join-Path $HOME '.ai-context'),
  (Join-Path $HOME '.claude'),
  (Join-Path $HOME '.gemini')
)
if ($env:RESOLVE_EXTRA_ROOTS) {
  $roots += ($env:RESOLVE_EXTRA_ROOTS -split ';' | Where-Object { $_ })
}

$conflicts = @()
foreach ($r in $roots) {
  if (-not (Test-Path $r)) { continue }
  $found = Get-ChildItem -Path $r -Recurse -File -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '\.sync-conflict-' }
  $conflicts += $found
}

if ($conflicts.Count -eq 0) { Write-Host 'No Syncthing conflicts found.'; exit 0 }

Write-Host ("Found {0} conflict file(s):" -f $conflicts.Count)
foreach ($c in $conflicts) { Write-Host ('  ' + $c.FullName) }
Write-Host ""

$confirm = Read-Host 'Resolve by keeping NEWEST file? (y/N)'
if ($confirm -notin @('y','Y','yes','YES')) { Write-Host 'Aborted.'; exit 0 }

$resolved = 0
foreach ($c in $conflicts) {
  # Original file = strip .sync-conflict-YYYYMMDD-HHMMSS-XXXXXXX suffix
  $original = ($c.FullName -replace '\.sync-conflict-[0-9]{8}-[0-9]{6}-[A-Z0-9]+','')
  if (Test-Path $original) {
    $origItem = Get-Item $original
    if ($c.LastWriteTime -gt $origItem.LastWriteTime) {
      Move-Item -Force $c.FullName $original
      Write-Host ('  + kept conflict (newer): ' + $c.Name)
    } else {
      Remove-Item $c.FullName
      Write-Host ('  + dropped conflict (older): ' + $c.Name)
    }
    $resolved++
  } else {
    # No original — promote conflict to original name
    Move-Item $c.FullName $original
    $resolved++
  }
}
Write-Host "Resolved $resolved conflict(s)."
