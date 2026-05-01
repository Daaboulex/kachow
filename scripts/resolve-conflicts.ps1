#!/usr/bin/env pwsh
# Thin wrapper — canonical implementation in resolve-conflicts.mjs (cross-platform).
# Compat: old .ps1 was interactive — pass --interactive to keep that behavior.
& node (Join-Path $PSScriptRoot 'resolve-conflicts.mjs') @args
exit $LASTEXITCODE
