#!/usr/bin/env bash
# Thin wrapper — canonical implementation in preview-image.mjs (cross-platform).
exec node "$(dirname "$0")/preview-image.mjs" "$@"
