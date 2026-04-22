#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Windows parity for bump-version.sh — semver bump from Conventional Commits.
.DESCRIPTION
  Scans commits since last tag, classifies feat / fix / BREAKING, bumps semver,
  writes VERSION + prepends CHANGELOG.md. Same CLI flags as the bash version.
.PARAMETER DryRun
  Print bump + changelog section, do not write.
.PARAMETER Set
  Force a specific version (e.g. 0.2.0).
.PARAMETER From
  Start-tag for commit scan (default: last tag).
.PARAMETER Path
  Repo path (default: cwd).
.PARAMETER StatsDir
  Directory to count ship-stats from (default: --Path).
#>

param(
  [switch]$DryRun,
  [string]$Set,
  [string]$From,
  [string]$Path = (Get-Location).Path,
  [string]$StatsDir
)

$ErrorActionPreference = 'Stop'
Set-Location $Path
if (-not (Test-Path .git)) { Write-Error "not a git repo: $Path"; exit 1 }

# Current version
$current = if (Test-Path VERSION) { (Get-Content VERSION -Raw).Trim() } else {
  $tag = (git describe --tags --abbrev=0 2>$null)
  if ($tag) { $tag -replace '^v','' } else { '0.0.0' }
}
if ($current -notmatch '^\d+\.\d+\.\d+$') { Write-Error "invalid semver: $current"; exit 1 }
$ma, $mi, $pa = $current.Split('.')
[int]$ma = $ma; [int]$mi = $mi; [int]$pa = $pa

# Bump selection
$bump = 'none'
if ($Set) {
  $new = $Set
  $bump = 'forced'
} else {
  if (-not $From) { $From = (git describe --tags --abbrev=0 2>$null) }
  $range = if ($From) { "$From..HEAD" } else { "HEAD" }
  $commits = git log $range --format='%s%n%b%n--END--' 2>$null
  $hasBreaking = $false; $hasFeat = $false; $hasFix = $false
  foreach ($line in $commits) {
    if ($line -match '^feat!|^feat\([^)]+\)!|^fix!|^fix\([^)]+\)!|BREAKING CHANGE:') { $hasBreaking = $true }
    elseif ($line -match '^feat(\([^)]+\))?:') { $hasFeat = $true }
    elseif ($line -match '^fix(\([^)]+\))?:') { $hasFix = $true }
  }
  if ($hasBreaking) { $bump = 'major'; $ma++; $mi = 0; $pa = 0 }
  elseif ($hasFeat) { $bump = 'minor'; $mi++; $pa = 0 }
  elseif ($hasFix)  { $bump = 'patch'; $pa++ }
  $new = "$ma.$mi.$pa"
}

# Ship stats from --StatsDir
$sd = if ($StatsDir) { $StatsDir } else { $Path }
function CountFiles { param($d, $maxd, $pat)
  if (-not (Test-Path $d)) { return 0 }
  (Get-ChildItem -Path $d -Depth ($maxd - 1) -Filter $pat -File -ErrorAction SilentlyContinue).Count
}
$hookCount = CountFiles (Join-Path $sd 'hooks')      1 '*.js'
$libCount  = CountFiles (Join-Path $sd 'hooks/lib')  3 '*.js'
$shCount   = CountFiles (Join-Path $sd 'scripts')    1 '*.sh'
$ps1Count  = CountFiles (Join-Path $sd 'scripts')    1 '*.ps1'
$cmdCount  = CountFiles (Join-Path $sd 'commands')   1 '*.md'

$today = (Get-Date -Format 'yyyy-MM-dd')
$section = @"
## [$new] — $today
Bump: $bump

### Ship stats
- $hookCount hooks + $libCount lib files
- $shCount shell scripts + $ps1Count PowerShell parity
- $cmdCount slash commands
- MCP server: 14 tools, dependency-free

"@

if (-not $Set -and $bump -ne 'none') {
  $breakLines = @((git log $range --format='- %s' --grep='^feat!|^fix!|BREAKING' 2>$null) | Where-Object { $_ -match '^-' })
  $featLines  = @((git log $range --format='- %s' --grep='^feat' 2>$null)             | Where-Object { $_ -match '^-' })
  $fixLines   = @((git log $range --format='- %s' --grep='^fix' 2>$null)              | Where-Object { $_ -match '^-' })
  if ($breakLines.Count -gt 0) { $section += "### Breaking`n" + ($breakLines -join "`n") + "`n`n" }
  if ($featLines.Count  -gt 0) { $section += "### Added`n"    + ($featLines  -join "`n") + "`n`n" }
  if ($fixLines.Count   -gt 0) { $section += "### Fixed`n"    + ($fixLines   -join "`n") + "`n`n" }
}

if ($DryRun) {
  Write-Host "── bump-version.ps1 DRY RUN ──"
  Write-Host "  current: $current"
  Write-Host "  bump:    $bump"
  Write-Host "  new:     $new"
  Write-Host ""
  Write-Host "── CHANGELOG section that would be prepended ──"
  Write-Host $section
  exit 0
}

if ($bump -eq 'none' -and -not $Set) {
  Write-Host "no feat/fix/breaking commits since $From — nothing to bump."
  exit 0
}

Set-Content VERSION $new -NoNewline
Add-Content VERSION "`n"

if (Test-Path CHANGELOG.md) {
  $existing = Get-Content CHANGELOG.md -Raw
  $idx = $existing.IndexOf("`n## ")
  if ($idx -ge 0) {
    $header = $existing.Substring(0, $idx + 1)
    $rest   = $existing.Substring($idx + 1)
    Set-Content CHANGELOG.md ($header + $section + $rest) -NoNewline
  } else {
    Set-Content CHANGELOG.md ($existing + "`n" + $section) -NoNewline
  }
} else {
  Set-Content CHANGELOG.md ("# Changelog`n`n" + $section) -NoNewline
}

Write-Host "bumped: $current → $new ($bump)"
Write-Host "  VERSION:   ./VERSION"
Write-Host "  CHANGELOG: ./CHANGELOG.md (prepended)"
Write-Host "  next:      git add VERSION CHANGELOG.md && git commit -m 'chore(release): v$new'"
