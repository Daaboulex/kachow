#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Preview an image in the terminal via chafa (Windows parity).
.PARAMETER Path
  Image file path.
.PARAMETER Width
  Columns (default $env:COLUMNS or 80).
.PARAMETER Height
  Rows (default 24).
#>
param(
  [Parameter(Mandatory)][string]$Path,
  [int]$Width = 0,
  [int]$Height = 0
)

if ($Width -eq 0) {
  $Width = if ($env:CLAUDE_PREVIEW_WIDTH) { [int]$env:CLAUDE_PREVIEW_WIDTH }
           elseif ($env:COLUMNS) { [int]$env:COLUMNS } else { 80 }
}
if ($Height -eq 0) {
  $Height = if ($env:CLAUDE_PREVIEW_HEIGHT) { [int]$env:CLAUDE_PREVIEW_HEIGHT } else { 24 }
}

$chafa = Get-Command chafa -ErrorAction SilentlyContinue
if (-not $chafa) {
  # Try WSL fallback
  $wsl = Get-Command wsl -ErrorAction SilentlyContinue
  if ($wsl) {
    try {
      & wsl -- command -v chafa 2>$null | Out-Null
      if ($LASTEXITCODE -eq 0) {
        $wslPath = (wsl wslpath -a $Path).Trim()
        & wsl chafa --size="${Width}x${Height}" --symbols=all --colors=full $wslPath
        exit $LASTEXITCODE
      }
    } catch {}
  }
  Write-Error @"
chafa not installed. Install options:
  Windows native: scoop install chafa  (or choco install chafa)
  WSL:            install chafa inside WSL, this script will auto-use it
  macOS:          brew install chafa
  Linux:          distro pkg manager
  docs:           https://hpjansson.org/chafa/
"@
  exit 1
}

if (-not (Test-Path $Path -PathType Leaf)) {
  Write-Error "preview-image: file not found: $Path"
  exit 1
}

& chafa --size="${Width}x${Height}" --symbols=all --colors=full $Path
exit $LASTEXITCODE
