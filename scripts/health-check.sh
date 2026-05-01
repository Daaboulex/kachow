#!/usr/bin/env bash
# Thin wrapper — canonical implementation in health-check.mjs (cross-platform).
exec node "$(dirname "$0")/health-check.mjs" "$@"
