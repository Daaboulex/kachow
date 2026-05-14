#!/usr/bin/env pwsh
# Thin wrapper — canonical implementation in bootstrap.mjs (cross-platform).
& node (Join-Path $PSScriptRoot 'bootstrap.mjs') @args
exit $LASTEXITCODE
