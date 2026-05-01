#!/usr/bin/env bash
# Thin wrapper — canonical implementation in self-update.mjs (cross-platform).
exec node "$(dirname "$0")/self-update.mjs" "$@"
