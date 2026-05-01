#!/usr/bin/env pwsh
# Thin wrapper — canonical implementation in health-check.mjs (cross-platform).
& node (Join-Path $PSScriptRoot 'health-check.mjs') @args
exit $LASTEXITCODE
