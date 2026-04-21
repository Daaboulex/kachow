#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Pull latest kachow from upstream, preserve USER SECTION, re-bootstrap.
.DESCRIPTION
  Fetches origin, shows incoming commits, merges (or rebases with -Rebase),
  preserves the AGENTS.md USER SECTION across the merge, and re-runs bootstrap
  so new hooks and adapters are wired in. Aborts on dirty tree.
.PARAMETER DryRun
  Show incoming commits only; do not write.
.PARAMETER Rebase
  Rebase instead of merge (linear history).
.PARAMETER NoBootstrap
  Merge but do not re-run bootstrap.
#>

param(
  [switch]$DryRun,
  [switch]$Rebase,
  [switch]$NoBootstrap
)

$ErrorActionPreference = 'Stop'
$AI = if ($env:AI_CONTEXT) { $env:AI_CONTEXT } else { Join-Path $HOME '.ai-context' }
Set-Location $AI
if (-not (Test-Path .git)) { Write-Error "$AI is not a git repo"; exit 1 }

Write-Host "── self-update: $AI ──"
Write-Host ""

# 1. Fetch + show incoming
git fetch origin --tags 2>&1 | ForEach-Object { Write-Host "  $_" }

$branch = (git branch --show-current).Trim()
if (-not $branch) { $branch = 'main' }
$upstream = "origin/$branch"

git rev-parse $upstream 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Error "no $upstream on origin — set a remote first"
  exit 1
}

$ahead  = [int](git rev-list --count "$upstream..$branch")
$behind = [int](git rev-list --count "$branch..$upstream")

if ($behind -eq 0) {
  Write-Host "✓ already up to date (local=$branch upstream=$upstream)"
  if ($ahead -gt 0) { Write-Host "  note: you have $ahead local commits not on upstream" }
  exit 0
}

Write-Host "incoming: $behind commit(s) on $upstream"
Write-Host "your local: $ahead commit(s) ahead"
Write-Host ""
Write-Host "── changelog since your HEAD ──"
git log --oneline --no-decorate "$branch..$upstream" | Select-Object -First 20

if ($DryRun) { Write-Host ""; Write-Host "(dry-run — nothing written)"; exit 0 }

# 2. Dirty tree check
if (git status --porcelain) {
  Write-Error "working tree has uncommitted changes — commit or stash them first"
  exit 1
}

# 3. Preserve USER SECTION
$userSection = $null
if (Test-Path AGENTS.md) {
  $agents = Get-Content AGENTS.md -Raw
  if ($agents -match '(?s)USER SECTION — keep.*?-->(.*?)<!-- END USER SECTION') {
    $userSection = $Matches[1].Trim()
    Write-Host "✓ captured USER SECTION"
  }
}

# 4. Merge or rebase
Write-Host ""
if ($Rebase) {
  Write-Host "── rebasing onto $upstream ──"
  git rebase $upstream
  if ($LASTEXITCODE -ne 0) { Write-Error "rebase failed — resolve and continue"; exit 1 }
} else {
  Write-Host "── merging $upstream ──"
  git merge --ff --no-edit $upstream
  if ($LASTEXITCODE -ne 0) { Write-Error "merge failed — resolve conflicts"; exit 1 }
}

# 5. Re-inject USER SECTION
if ($userSection -and (Test-Path AGENTS.md)) {
  $agents = Get-Content AGENTS.md -Raw
  $pattern = '(?s)(USER SECTION — keep.*?-->).*?(<!-- END USER SECTION)'
  $replacement = "`$1`n`n$userSection`n`n`$2"
  $new = [regex]::Replace($agents, $pattern, $replacement)
  if ($new -ne $agents) {
    Set-Content AGENTS.md $new -NoNewline
    git add AGENTS.md
    git -c user.email=self-update@localhost -c user.name=self-update `
      commit --no-gpg-sign -q -m "chore: restore USER SECTION after self-update"
    Write-Host "✓ USER SECTION restored"
  }
}

# 6. Re-bootstrap
if (-not $NoBootstrap) {
  Write-Host ""
  Write-Host "── re-running bootstrap.ps1 ──"
  & (Join-Path $AI 'scripts/bootstrap.ps1')
}

Write-Host ""
Write-Host ("✓ self-update complete — now at " + (git log -1 --format='%h %s'))
