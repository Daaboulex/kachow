#!/usr/bin/env pwsh
# Thin wrapper — canonical implementation in customize.mjs (cross-platform).
& node (Join-Path $PSScriptRoot 'customize.mjs') @args
exit $LASTEXITCODE
