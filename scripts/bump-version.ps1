#!/usr/bin/env pwsh
# Thin wrapper — canonical implementation in bump-version.mjs (cross-platform).
& node (Join-Path $PSScriptRoot 'bump-version.mjs') @args
exit $LASTEXITCODE
