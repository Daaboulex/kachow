#!/usr/bin/env pwsh
# Thin wrapper — canonical implementation in snapshot.mjs (cross-platform).
& node (Join-Path $PSScriptRoot 'snapshot.mjs') @args
exit $LASTEXITCODE
