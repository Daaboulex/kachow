#!/usr/bin/env bash
# Thin wrapper — canonical implementation in install-adapters.mjs (cross-platform).
exec node "$(dirname "$0")/install-adapters.mjs" "$@"
