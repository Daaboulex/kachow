#!/usr/bin/env bash
# Thin wrapper — canonical implementation in install-mcp.mjs (cross-platform).
exec node "$(dirname "$0")/install-mcp.mjs" "$@"
