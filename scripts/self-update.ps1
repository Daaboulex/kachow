#!/usr/bin/env pwsh
# Thin wrapper — canonical implementation in self-update.mjs (cross-platform).
& node (Join-Path $PSScriptRoot 'self-update.mjs') @args
exit $LASTEXITCODE
