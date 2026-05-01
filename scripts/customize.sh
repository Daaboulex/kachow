#!/usr/bin/env bash
# Thin wrapper — canonical implementation in customize.mjs (cross-platform).
exec node "$(dirname "$0")/customize.mjs" "$@"
