#!/usr/bin/env bash
# Thin wrapper — canonical implementation in setup-private-remote.mjs (cross-platform).
exec node "$(dirname "$0")/setup-private-remote.mjs" "$@"
