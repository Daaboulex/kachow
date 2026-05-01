#!/usr/bin/env pwsh
# Thin wrapper — canonical implementation in install-adapters.mjs (cross-platform).
& node (Join-Path $PSScriptRoot 'install-adapters.mjs') @args
exit $LASTEXITCODE
