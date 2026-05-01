#!/usr/bin/env pwsh
# Thin wrapper — canonical implementation in install-mcp.mjs (cross-platform).
& node (Join-Path $PSScriptRoot 'install-mcp.mjs') @args
exit $LASTEXITCODE
