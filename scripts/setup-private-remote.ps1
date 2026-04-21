#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Add a private git remote for ~/.ai-context/ and push initial commit.
.PARAMETER RemoteUrl
  Git URL (e.g. git@github.com:[user]/ai-context.git or https://...).
#>
param(
  [Parameter(Mandatory)][string]$RemoteUrl
)

$ErrorActionPreference = 'Stop'
$AI =
  if     ($env:AI_CONTEXT) { $env:AI_CONTEXT }
  elseif ($PSScriptRoot)   { Split-Path $PSScriptRoot -Parent }
  else                     { Join-Path $HOME '.ai-context' }

if (-not (Test-Path (Join-Path $AI '.git'))) {
  Write-Host "initializing git repo..."
  Push-Location $AI
  git init -q
  git add -A
  git commit -q -m "initial ai-context commit"
  Pop-Location
}

Push-Location $AI
try {
  git remote add origin $RemoteUrl 2>$null
  if ($LASTEXITCODE -ne 0) {
    git remote set-url origin $RemoteUrl
    Write-Host "updated existing origin → $RemoteUrl"
  } else {
    Write-Host "added remote origin → $RemoteUrl"
  }
  Write-Host "pushing initial state..."
  git push -u origin HEAD
  Write-Host "Done. ~/.ai-context/ now syncs to $RemoteUrl"
} finally { Pop-Location }
