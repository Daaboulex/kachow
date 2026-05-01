#!/usr/bin/env bash
# Thin wrapper — canonical implementation in bump-version.mjs (cross-platform).
exec node "$(dirname "$0")/bump-version.mjs" "$@"
