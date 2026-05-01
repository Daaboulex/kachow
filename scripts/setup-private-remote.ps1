#!/usr/bin/env pwsh
# Thin wrapper — canonical implementation in setup-private-remote.mjs (cross-platform).
# Compat: old .ps1 took -RemoteUrl <url>; new wrapper accepts both positional URL
# and any --url <url> flag. Pre-existing scripts: -RemoteUrl <url> still works
# because we forward as positional.
& node (Join-Path $PSScriptRoot 'setup-private-remote.mjs') @args
exit $LASTEXITCODE
