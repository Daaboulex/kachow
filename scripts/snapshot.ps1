#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Merges the canonical-source AI context snapshot onto the current machine.

.DESCRIPTION
    2026-04-20 architecture: ~/.ai-context/ is the canonical source of truth.
    ~/.claude/, ~/.gemini/, ~/.codex/, ~/.config/opencode/ symlink into it.

    This script:
      1. Installs ~/.ai-context/ (real dir)
      2. Merges ~/.claude/, ~/.gemini/ tool-specific files (hooks, settings, scripts, agents)
      3. Recreates symlinks from tool dirs → ~/.ai-context/
      4. Registers personal-context MCP server in every AI tool found
      5. Removes legacy stitch MCP if present
      6. Backups pre-existing files before overwriting

    Works on Windows (PowerShell 7+, dev mode OR admin for symlinks),
    Linux/NixOS, Mac.

.PARAMETER DryRun
    Show what would happen without copying or linking.

.PARAMETER Force
    Skip confirmation.

.PARAMETER SnapshotDir
    Override auto-detect. Default: ai-context-snapshot-* (latest from LATEST.txt).

.EXAMPLE
    pwsh merge-ai-context.ps1
    # interactive

.EXAMPLE
    pwsh merge-ai-context.ps1 -DryRun
    # preview only
#>
param(
    [switch]$DryRun,
    [switch]$Force,
    [string]$SnapshotDir
)

$ErrorActionPreference = "Stop"

# ── OS detection ──
$isWin = $PSVersionTable.Platform -eq 'Win32NT' -or (-not $PSVersionTable.Platform)
$homeDir = if ($isWin) { $env:USERPROFILE } else { $env:HOME }

Write-Host "═══ merge-ai-context ═══" -ForegroundColor Cyan
Write-Host "OS: $(if ($isWin) {'Windows'} else {'Linux/Mac'})  | Home: $homeDir"
Write-Host ""

# ── Resolve snapshot ──
if (-not $SnapshotDir) {
    $latestFile = Join-Path $PSScriptRoot "ai-context-snapshot-LATEST.txt"
    if (Test-Path $latestFile) {
        $SnapshotDir = Join-Path $PSScriptRoot (Get-Content $latestFile -Raw).Trim()
    }
    else {
        $latest = Get-ChildItem -Path $PSScriptRoot -Directory -Filter "ai-context-snapshot-*" |
                  Sort-Object Name -Descending | Select-Object -First 1
        if ($latest) { $SnapshotDir = $latest.FullName }
    }
}
if (-not $SnapshotDir -or -not (Test-Path $SnapshotDir)) {
    Write-Host "ERROR: no snapshot found. Run snapshot script on source machine first." -ForegroundColor Red
    exit 1
}
Write-Host "Snapshot: $SnapshotDir"

$metadataFile = Join-Path $SnapshotDir "source-metadata.json"
if (Test-Path $metadataFile) {
    $meta = Get-Content $metadataFile | ConvertFrom-Json
    Write-Host "  source: $($meta.source_os) @ $($meta.source_hostname) ($($meta.snapshot_time))"
    Write-Host "  architecture: $($meta.architecture)"
}
Write-Host ""

# ── Symlink capability check ──
function Test-SymlinkCapability {
    $testFile = Join-Path ([System.IO.Path]::GetTempPath()) "symlink-test-$PID"
    $testLink = "$testFile.link"
    try {
        "x" | Out-File $testFile -Encoding ascii
        New-Item -ItemType SymbolicLink -Path $testLink -Target $testFile -Force -ErrorAction Stop | Out-Null
        Remove-Item $testLink, $testFile -ErrorAction SilentlyContinue
        return $true
    } catch {
        Remove-Item $testFile -ErrorAction SilentlyContinue
        return $false
    }
}
$canSymlink = Test-SymlinkCapability
Write-Host "Symlink capability: $(if ($canSymlink) {'✓'} else {'✗ (Windows needs Developer Mode or admin)'})"
Write-Host ""

# ── Confirm ──
if (-not $Force -and -not $DryRun) {
    Write-Host "This will:" -ForegroundColor Yellow
    Write-Host "  • Install $homeDir/.ai-context/ (canonical source)"
    Write-Host "  • Merge $homeDir/.claude/ and $homeDir/.gemini/ (newer wins)"
    Write-Host "  • Recreate symlinks from tool dirs → .ai-context/"
    Write-Host "  • Register personal-context MCP in Claude, Gemini, Codex, OpenCode"
    Write-Host "  • Remove legacy 'stitch' MCP if present"
    Write-Host "  • Back up any pre-existing files before overwriting"
    Write-Host ""
    $confirm = Read-Host "Type MERGE to proceed"
    if ($confirm -ne "MERGE") { Write-Host "aborted."; exit 1 }
}

# ── Helper: OS-aware symlink ──
function New-CompatSymlink {
    param([string]$LinkPath, [string]$TargetPath, [string]$Label)
    $parent = Split-Path $LinkPath -Parent
    if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }

    if (Test-Path $LinkPath) {
        $item = Get-Item $LinkPath -Force
        # Already a symlink to the right place?
        if ($item.LinkType -eq 'SymbolicLink' -and $item.Target -eq $TargetPath) {
            Write-Host "  ✓ $Label : already linked" -ForegroundColor Green
            return
        }
        # Back up
        $bak = "$LinkPath.pre-merge-bak-$((Get-Date).ToString('yyyyMMddHHmmss'))"
        Write-Host "  ↻ $Label : backup existing → $(Split-Path $bak -Leaf)" -ForegroundColor Yellow
        if (-not $DryRun) { Move-Item $LinkPath $bak -Force }
    }
    if ($DryRun) { Write-Host "  + $Label : WOULD link → $TargetPath"; return }

    if ($canSymlink) {
        try {
            New-Item -ItemType SymbolicLink -Path $LinkPath -Target $TargetPath -Force | Out-Null
            Write-Host "  + $Label : linked → $TargetPath" -ForegroundColor Green
        } catch {
            Write-Host "  ✗ $Label : symlink failed ($($_.Exception.Message))" -ForegroundColor Red
            # Fallback: copy
            if (Test-Path $TargetPath -PathType Container) {
                Copy-Item $TargetPath $LinkPath -Recurse -Force
            } else {
                Copy-Item $TargetPath $LinkPath -Force
            }
            Write-Host "  ~ $Label : copied (not symlinked — edits won't sync)" -ForegroundColor Yellow
        }
    } else {
        # No symlink capability — warn and fall back to copy
        if (Test-Path $TargetPath -PathType Container) {
            Copy-Item $TargetPath $LinkPath -Recurse -Force
        } else {
            Copy-Item $TargetPath $LinkPath -Force
        }
        Write-Host "  ~ $Label : copied (no symlink — enable Dev Mode to symlink)" -ForegroundColor Yellow
    }
}

# ── Phase 1: install ~/.ai-context/ ──
Write-Host "── Phase 1: canonical source ──" -ForegroundColor Cyan
$aiCtxTarget = Join-Path $homeDir ".ai-context"
$aiCtxSrc = Join-Path $SnapshotDir ".ai-context"
if (-not (Test-Path $aiCtxSrc)) {
    Write-Host "ERROR: snapshot missing .ai-context/ — snapshot corrupt?" -ForegroundColor Red
    exit 1
}
if ($DryRun) {
    Write-Host "  WOULD rsync $aiCtxSrc → $aiCtxTarget"
} else {
    if ($isWin) {
        if (-not (Test-Path $aiCtxTarget)) { New-Item -ItemType Directory -Path $aiCtxTarget | Out-Null }
        Copy-Item "$aiCtxSrc\*" $aiCtxTarget -Recurse -Force
    } else {
        & rsync -a "$aiCtxSrc/" "$aiCtxTarget/"
    }
    Write-Host "  ✓ $aiCtxTarget installed" -ForegroundColor Green
}

# ── Phase 2: merge tool-specific dirs ──
Write-Host "── Phase 2: tool-specific merge (hooks, settings, scripts) ──" -ForegroundColor Cyan
foreach ($tool in @(".claude", ".gemini")) {
    $src = Join-Path $SnapshotDir $tool
    $dst = Join-Path $homeDir $tool
    if (-not (Test-Path $src)) { Write-Host "  - $tool : not in snapshot"; continue }
    if ($DryRun) { Write-Host "  WOULD merge $src → $dst"; continue }

    if ($isWin) {
        if (-not (Test-Path $dst)) { New-Item -ItemType Directory -Path $dst | Out-Null }
        Copy-Item "$src\*" $dst -Recurse -Force
    } else {
        # Linux/Mac: use rsync; skip files we'll symlink (CLAUDE.md, memory, user skills)
        & rsync -a `
            --exclude 'CLAUDE.md' --exclude 'GEMINI.md' --exclude 'memory' `
            --exclude 'skills/debt-tracker' --exclude 'skills/excalidraw' `
            --exclude 'skills/react-components' --exclude 'skills/shadcn-ui' `
            "$src/" "$dst/"
    }
    Write-Host "  ✓ $dst merged" -ForegroundColor Green
}

# ── Phase 3: recreate symlinks ──
Write-Host "── Phase 3: recreate symlinks ──" -ForegroundColor Cyan
New-CompatSymlink -LinkPath (Join-Path $homeDir ".claude/CLAUDE.md")     -TargetPath (Join-Path $homeDir ".ai-context/AGENTS.md") -Label "claude CLAUDE.md"
New-CompatSymlink -LinkPath (Join-Path $homeDir ".gemini/GEMINI.md")     -TargetPath (Join-Path $homeDir ".ai-context/AGENTS.md") -Label "gemini GEMINI.md"
New-CompatSymlink -LinkPath (Join-Path $homeDir ".codex/AGENTS.md")      -TargetPath (Join-Path $homeDir ".ai-context/AGENTS.md") -Label "codex AGENTS.md"
New-CompatSymlink -LinkPath (Join-Path $homeDir ".config/opencode/AGENTS.md") -TargetPath (Join-Path $homeDir ".ai-context/AGENTS.md") -Label "opencode AGENTS.md"
New-CompatSymlink -LinkPath (Join-Path $homeDir ".config/aider/AGENTS.md")    -TargetPath (Join-Path $homeDir ".ai-context/AGENTS.md") -Label "aider AGENTS.md"
New-CompatSymlink -LinkPath (Join-Path $homeDir ".claude/memory")        -TargetPath (Join-Path $homeDir ".ai-context/memory") -Label "claude memory"
New-CompatSymlink -LinkPath (Join-Path $homeDir ".gemini/memory")        -TargetPath (Join-Path $homeDir ".ai-context/memory") -Label "gemini memory"

# User skills (anything in .ai-context/skills/)
$skillsDir = Join-Path $homeDir ".ai-context/skills"
if (Test-Path $skillsDir) {
    foreach ($skill in Get-ChildItem -Path $skillsDir -Directory) {
        $name = $skill.Name
        New-CompatSymlink -LinkPath (Join-Path $homeDir ".claude/skills/$name") -TargetPath $skill.FullName -Label "claude skill:$name"
        New-CompatSymlink -LinkPath (Join-Path $homeDir ".gemini/skills/$name") -TargetPath $skill.FullName -Label "gemini skill:$name"
    }
}

# ── Phase 4: remove legacy stitch MCP ──
Write-Host "── Phase 4: remove legacy stitch MCP ──" -ForegroundColor Cyan
$claudeJson = Join-Path $homeDir ".claude.json"
if (Test-Path $claudeJson) {
    $d = Get-Content $claudeJson -Raw | ConvertFrom-Json
    if ($d.mcpServers -and $d.mcpServers.PSObject.Properties.Name -contains 'stitch') {
        if ($DryRun) {
            Write-Host "  WOULD remove stitch from .claude.json"
        } else {
            $d.mcpServers.PSObject.Properties.Remove('stitch')
            $d | ConvertTo-Json -Depth 10 | Out-File $claudeJson -Encoding utf8
            Write-Host "  ✓ stitch removed from .claude.json" -ForegroundColor Green
        }
    } else {
        Write-Host "  ✓ stitch not present" -ForegroundColor Green
    }
}

# Stitch residual dirs
$stitchPaths = @(
    (Join-Path $homeDir ".stitch-mcp"),
    (Join-Path $homeDir ".agents/skills/stitch-design"),
    (Join-Path $homeDir ".agents/skills/stitch-loop"),
    (Join-Path $homeDir ".claude/skills/stitch-design"),
    (Join-Path $homeDir ".claude/skills/stitch-loop"),
    (Join-Path $homeDir ".gemini/skills/stitch-design"),
    (Join-Path $homeDir ".gemini/skills/stitch-loop")
)
foreach ($p in $stitchPaths) {
    if (Test-Path $p) {
        if ($DryRun) { Write-Host "  WOULD remove $p" }
        else { Remove-Item $p -Recurse -Force; Write-Host "  ✓ removed $p" }
    }
}

# Stitch scripts (files, not dirs)
$stitchFiles = @(
    (Join-Path $homeDir ".claude/scripts/stitch-proxy.sh"),
    (Join-Path $homeDir ".claude/scripts/stitch-proxy.ps1"),
    (Join-Path $homeDir ".claude/scripts/patch-stitch-mcp.sh"),
    (Join-Path $homeDir ".claude/scripts/patch-stitch-mcp.ps1"),
    (Join-Path $homeDir ".gemini/scripts/stitch-proxy.sh"),
    (Join-Path $homeDir ".gemini/scripts/stitch-proxy.ps1"),
    (Join-Path $homeDir ".gemini/scripts/patch-stitch-mcp.sh"),
    (Join-Path $homeDir ".gemini/scripts/patch-stitch-mcp.ps1")
)
foreach ($f in $stitchFiles) {
    if (Test-Path $f) {
        if ($DryRun) { Write-Host "  WOULD remove $f" }
        else { Remove-Item $f -Force; Write-Host "  ✓ removed $f" }
    }
}

# ── Phase 5: register personal-context MCP ──
Write-Host "── Phase 5: register personal-context MCP ──" -ForegroundColor Cyan
$mcpServer = Join-Path $homeDir ".ai-context/mcp/personal-context/server.js"
if (-not (Test-Path $mcpServer)) {
    Write-Host "  ✗ MCP server missing ($mcpServer) — snapshot incomplete" -ForegroundColor Red
} else {
    if ($isWin) {
        # PS-native edits
        if (Test-Path $claudeJson) {
            $d = Get-Content $claudeJson -Raw | ConvertFrom-Json
            if (-not $d.mcpServers) { $d | Add-Member -NotePropertyName mcpServers -NotePropertyValue (@{}) -Force }
            $d.mcpServers | Add-Member -NotePropertyName 'personal-context' -NotePropertyValue @{
                type = 'stdio'; command = 'node'; args = @($mcpServer)
            } -Force
            if (-not $DryRun) { $d | ConvertTo-Json -Depth 10 | Out-File $claudeJson -Encoding utf8 }
            Write-Host "  ✓ Claude Code" -ForegroundColor Green
        }
        # Similar for Gemini/Codex/OpenCode — less verbose, trust user to verify
        Write-Host "  (Gemini/Codex/OpenCode: run the Linux install-mcp.sh equivalent manually)" -ForegroundColor Yellow
    } else {
        # Linux/Mac/Git-Bash: prefer install-mcp.ps1; fall back to .sh via bash if present.
        $ps1Script = Join-Path $homeDir ".ai-context/scripts/install-mcp.ps1"
        $shScript  = Join-Path $homeDir ".ai-context/scripts/install-mcp.sh"
        if (Test-Path $ps1Script) {
            if ($DryRun) { Write-Host "  WOULD run install-mcp.ps1" }
            else { & $ps1Script }
        } elseif ((Test-Path $shScript) -and (Get-Command bash -ErrorAction SilentlyContinue)) {
            if ($DryRun) { Write-Host "  WOULD run install-mcp.sh via bash" }
            else { & bash $shScript }
        } else {
            Write-Host "  (install-mcp: no .ps1 or bash available — run scripts/install-mcp.* manually)" -ForegroundColor Yellow
        }
    }
}

# ── Done ──
Write-Host ""
Write-Host "═══ merge complete ═══" -ForegroundColor Green
Write-Host ""
if ($IsWindows -or $env:OS -match 'Windows') {
    Write-Host "Verify: pwsh ~/.ai-context/scripts/health-check.ps1" -ForegroundColor Cyan
} else {
    Write-Host "Verify: bash ~/.ai-context/scripts/health-check.sh" -ForegroundColor Cyan
}
Write-Host "Edit: ~/.ai-context/AGENTS.md (all tools pick it up)" -ForegroundColor Cyan
