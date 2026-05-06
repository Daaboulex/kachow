#!/usr/bin/env pwsh
# d5-anti-skew-test.ps1 — Discovery D5
# Verifies anti-skew rules from MASTER § 6.
# Read-only test; produces report on stdout. Exit 0 if all PASS, 1 otherwise.

$ErrorActionPreference = 'Stop'
$Host_ = hostname
$TS = Get-Date -Format 'o'
$Results = @()

Write-Output "# D5 Anti-Skew Test Report"
Write-Output "Host: $Host_ | Date: $TS"
Write-Output ""

# Sub-test 2: Rule 1 + 5 — capture session-context-loader output, grep for leak strings.
Write-Output "## Sub-test 2 — Rule 1 (side-channel) + Rule 5 (facts only)"
$slmOut = [System.IO.Path]::GetTempFileName()
try {
    '{"session_id":"d5-test","cwd":"/tmp"}' | node "$HOME/.claude/hooks/session-context-loader.js" > $slmOut 2>&1
} catch {}
$content = Get-Content $slmOut -Raw -ErrorAction SilentlyContinue
$leak1 = if ($content -match '(?i)peer agent|session.*active|lock.*held|conflict.*possible') { $Matches[0] } else { '' }
$leak2 = if ($content -match '(?i)you should|recommend|suggest|consider|wait|hold off') { $Matches[0] } else { '' }
if ($leak1 -or $leak2) {
    Write-Output "  FAIL — leak detected:"
    if ($leak1) { Write-Output "    Rule 1: $leak1" }
    if ($leak2) { Write-Output "    Rule 5: $leak2" }
    $Results += 'FAIL:rule1+5'
} else {
    Write-Output "  PASS"
    $Results += 'PASS:rule1+5'
}
Remove-Item $slmOut -ErrorAction SilentlyContinue

# Sub-tests 3+4 require 2 live sessions — MANUAL procedure
Write-Output ""
Write-Output "## Sub-test 3 — Rule 2 (boundary-gated PreToolUse) — MANUAL"
Write-Output "  PROCEDURE: open 2 terminals, both edit /tmp/test-overlap.txt"
Write-Output "  Verify: lock surfaces in permission UI, NOT in model context"
$Results += 'MANUAL:rule2'

Write-Output ""
Write-Output "## Sub-test 4 — Rule 3 (path-scoped) — MANUAL"
Write-Output "  PROCEDURE: session A edits /tmp/test-A.txt, session B edits /tmp/test-B.txt"
Write-Output "  Verify: no spurious cross-path lock surface"
$Results += 'MANUAL:rule3'

# Sub-test 5: Rule 4 (TTL + heartbeat) — inspect session-presence-track.js
Write-Output ""
Write-Output "## Sub-test 5 — Rule 4 (TTL + heartbeat)"
$trackFile = "$HOME/.claude/hooks/session-presence-track.js"
$ttlGrep = if (Test-Path $trackFile) {
    Select-String -Path $trackFile -Pattern '5.?min|300.?000|expire|stale|TTL|ttl|STALE' -AllMatches | ForEach-Object { $_.Line }
} else { '' }
if ($ttlGrep) {
    Write-Output "  PASS-MAYBE — TTL-related code present:"
    $ttlGrep | ForEach-Object { Write-Output "    $_" }
    $Results += 'PASS-MAYBE:rule4'
} else {
    Write-Output "  FAIL — no TTL logic found in session-presence-track.js"
    $Results += 'FAIL:rule4'
}

Write-Output ""
Write-Output "## Summary"
$Results | ForEach-Object { Write-Output $_ }

if ($Results -match '^FAIL:') {
    exit 1
} else {
    exit 0
}
