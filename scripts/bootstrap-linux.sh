#!/usr/bin/env bash
# Thin wrapper — canonical implementation in bootstrap.mjs (cross-platform).
exec node "$(dirname "$0")/bootstrap.mjs" "$@"
