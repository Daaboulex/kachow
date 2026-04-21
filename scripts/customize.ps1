#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Windows parity for customize.sh — interactive onboarding for kachow.
.DESCRIPTION
  Substitutes <owner> / <repo-name>, writes USER SECTION into AGENTS.md,
  wires selected AI tools, runs bootstrap.
#>

$ErrorActionPreference = 'Stop'
$AI = if ($env:AI) { $env:AI } else { Join-Path $HOME '.ai-context' }
if (-not (Test-Path $AI)) { Write-Error "$AI not found — clone first"; exit 1 }
Set-Location $AI

function Say  { param($m) Write-Host ""; Write-Host ("=== " + $m) -ForegroundColor Cyan }
function Pass { param($m) Write-Host ("  ✓ " + $m) -ForegroundColor Green }
function Ask  { param($q) (Read-Host ("? " + $q)).Trim() }
function Yn   { param($q, $def = 'N')
  $hint = if ($def -eq 'Y') { '[Y/n]' } else { '[y/N]' }
  $a = (Read-Host ("? " + $q + " " + $hint)).Trim()
  if (-not $a) { $a = $def }
  return ($a -match '^(y|yes)$')
}

@"

   _  __           _
  | |/ /__ _   ___| |__   _____      __
  | ' // _` | / __| '_ \ / _ \ \ /\ / /
  | . \ (_| || (__| | | | (_) \ V  V /
  |_|\_\__,_| \___|_| |_|\___/ \_/\_/
                          K A - C H O W !

"@ | Write-Host

# 1. Identity
Say "Identity"
$gitEmail = (git config --get user.email 2>$null)
$gitName  = (git config --get user.name 2>$null)
if ($gitName)  { Write-Host "  detected git name:  $gitName" -ForegroundColor DarkGray }
if ($gitEmail) { Write-Host "  detected git email: $gitEmail" -ForegroundColor DarkGray }

$yourName  = Ask "Your name"
if (-not $yourName) { $yourName = $gitName }
if (-not $yourName) { $yourName = '<your-name>' }

$yourEmail = Ask "Your git email"
if (-not $yourEmail) { $yourEmail = $gitEmail }
if (-not $yourEmail) { $yourEmail = '<your-email>' }

$yourRole = Ask "One-line 'who you are' (skip with Enter)"
Pass "Identity captured: $yourName <$yourEmail>"

# 2. LICENSE + README substitution
Say "Substitute placeholders"
if (Test-Path LICENSE) {
  (Get-Content LICENSE -Raw) -replace '<owner>', $yourName | Set-Content LICENSE -NoNewline
  Pass "LICENSE copyright → $yourName"
}
if (Test-Path README.md) {
  $defaultRepo = 'kachow-fork'
  $repoName = Ask "Repo name (default: $defaultRepo)"
  if (-not $repoName) { $repoName = $defaultRepo }
  $r = (Get-Content README.md -Raw) -replace '<owner>', $yourName -replace '<repo-name>', $repoName
  $r | Set-Content README.md -NoNewline
  Pass "README → $yourName/$repoName"
}

# 3. USER SECTION
Say "USER SECTION in AGENTS.md"
if ((Test-Path AGENTS.md) -and (Yn "write starter identity block into USER SECTION?" 'Y')) {
  $agents = Get-Content AGENTS.md -Raw
  $block = @"
## My additions

- Name: $yourName
- Email: $yourEmail
"@
  if ($yourRole) { $block += "`n- Role: $yourRole" }
  $block += "`n- Customize any rules below. Framework updates leave this block alone.`n"

  $agents = [regex]::Replace(
    $agents,
    '(USER SECTION — keep your edits.*?-->\r?\n)(?s:.*?)(<!-- END USER SECTION -->)',
    "`$1`n$block`n`$2"
  )
  $agents | Set-Content AGENTS.md -NoNewline
  Pass "USER SECTION populated"
}

# 4. Which AI tools?
Say "Which AI tools should I wire?"
$tools = @(
  @{ key='claude';   label='Claude Code (~/.claude)';            path=(Join-Path $HOME '.claude') },
  @{ key='gemini';   label='Gemini CLI (~/.gemini)';             path=(Join-Path $HOME '.gemini') },
  @{ key='codex';    label='Codex CLI (~/.codex)';               path=(Join-Path $HOME '.codex') },
  @{ key='opencode'; label='OpenCode (~/.config/opencode)';      path=(Join-Path $HOME '.config/opencode') },
  @{ key='aider';    label='Aider (~/.config/aider)';            path=(Join-Path $HOME '.config/aider') }
)
$selected = @()
foreach ($t in $tools) {
  $installed = if (Test-Path $t.path) { '[installed]' } else { '' }
  $def = if ($installed) { 'Y' } else { 'N' }
  if (Yn ("  wire $($t.label) $installed") $def) { $selected += $t.key }
}
Pass ("Selected: " + ($selected -join ' '))

# 5. Add-ons
Say "Optional add-ons"
$addons = @()
if (Yn "NixOS flake support") { $addons += 'nixos' }
if (Yn "Embedded / firmware") { $addons += 'embedded' }
if (Yn "Python stack") { $addons += 'python' }

# 6. Settings merge
Say "Apply settings templates"
foreach ($tool in $selected) {
  switch ($tool) {
    'claude' {
      $dst = Join-Path $HOME '.claude/settings.json'
      if ((Test-Path settings.template.json) -and -not (Test-Path $dst)) {
        New-Item -ItemType Directory -Force (Split-Path $dst -Parent) | Out-Null
        Copy-Item settings.template.json $dst
        Pass "installed $dst"
      } elseif (Test-Path $dst) {
        Pass "existing $dst — NOT overwritten"
      }
    }
    'gemini' {
      $dst = Join-Path $HOME '.gemini/settings.json'
      if ((Test-Path settings.gemini.template.json) -and -not (Test-Path $dst)) {
        New-Item -ItemType Directory -Force (Split-Path $dst -Parent) | Out-Null
        Copy-Item settings.gemini.template.json $dst
        Pass "installed $dst"
      } elseif (Test-Path $dst) {
        Pass "existing $dst — NOT overwritten"
      }
    }
  }
}

# 7. Bootstrap
Say "Bootstrap"
if (Yn "run bootstrap.ps1 now?" 'Y') {
  & (Join-Path $AI 'scripts/bootstrap.ps1')
  Pass "bootstrap complete"
}

Write-Host ""
Write-Host "Ka-chow! Setup complete." -ForegroundColor Green
Write-Host "  Next: edit your USER SECTION in $AI/AGENTS.md to fine-tune rules."
Write-Host "  Verify:  pwsh $AI/scripts/health-check.ps1"
