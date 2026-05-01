#!/usr/bin/env bash
# Thin wrapper — canonical implementation in resolve-conflicts.mjs (cross-platform).
exec node "$(dirname "$0")/resolve-conflicts.mjs" "$@"
