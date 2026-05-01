#!/usr/bin/env bash
# Thin wrapper — canonical implementation in snapshot.mjs (cross-platform).
exec node "$(dirname "$0")/snapshot.mjs" "$@"
