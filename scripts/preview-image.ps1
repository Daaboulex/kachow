#!/usr/bin/env pwsh
# Thin wrapper — canonical implementation in preview-image.mjs (cross-platform).
& node (Join-Path $PSScriptRoot 'preview-image.mjs') @args
exit $LASTEXITCODE
