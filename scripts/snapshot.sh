#!/usr/bin/env bash
# Snapshot current AI context (~/.ai-context/, ~/.claude/, ~/.gemini/) onto a drive.
# Pair with merge-ai-context.ps1 on the target machine to restore.
#
# Usage:
#   ~/.ai-context/scripts/snapshot-to-drive.sh <drive-path>
# Example:
#   ~/.ai-context/scripts/snapshot-to-drive.sh "/run/media/user/[external-drive]/Work/[workdir]"

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <drive-path>" >&2
  exit 1
fi

DRIVE="$1"
if [ ! -d "$DRIVE" ]; then
  echo "ERROR: drive path not a directory: $DRIVE" >&2
  exit 1
fi
if [ ! -w "$DRIVE" ]; then
  echo "ERROR: drive path not writable: $DRIVE" >&2
  exit 1
fi

TS=$(date -u +%Y-%m-%dT%H-%M-%S)
SNAP="$DRIVE/ai-context-snapshot-$TS"
TMP="$SNAP.incomplete"

mkdir -p "$TMP"
echo "Snapshot target: $SNAP"
echo

echo "── 1/4 ~/.ai-context (canonical)"
rsync -rptD --info=stats1 $HOME/.ai-context/ "$TMP/.ai-context/" | tail -3

echo
echo "── 2/4 ~/.claude (tool-specific; skip caches/projects/symlinks)"
rsync -rptD --info=stats1 --no-links \
  --exclude 'projects/' --exclude 'file-history/' --exclude 'paste-cache/' \
  --exclude 'plugins/cache/' --exclude 'plugins/marketplaces/' --exclude 'plugins/data/' \
  --exclude 'session-env/' --exclude 'sessions/' --exclude 'shell-snapshots/' \
  --exclude 'sandbox-cwd/' --exclude 'telemetry/' --exclude 'backups/' \
  --exclude 'debug/archive/' --exclude 'debug/*.txt' --exclude 'cache/' \
  --exclude 'history.jsonl' --exclude '.credentials.json' --exclude 'ide/' \
  --exclude '.git/' --exclude 'CLAUDE.md' --exclude 'memory' \
  --exclude 'skills/debt-tracker' --exclude 'skills/excalidraw' \
  --exclude 'skills/react-components' --exclude 'skills/shadcn-ui' \
  $HOME/.claude/ "$TMP/.claude/" | tail -3

echo
echo "── 3/4 ~/.gemini (tool-specific; skip caches/history/symlinks)"
rsync -rptD --info=stats1 --no-links \
  --exclude 'tmp/' --exclude 'projects/' --exclude 'cache/' --exclude 'history/' \
  --exclude 'oauth_creds.json' --exclude '.git/' \
  --exclude 'GEMINI.md' --exclude 'memory' \
  --exclude 'skills/debt-tracker' --exclude 'skills/excalidraw' \
  --exclude 'skills/react-components' --exclude 'skills/shadcn-ui' \
  $HOME/.gemini/ "$TMP/.gemini/" | tail -3

echo
echo "── 4/4 metadata"
cat > "$TMP/source-metadata.json" <<EOF
{
  "snapshot_time": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "source_os": "$(uname -s | tr '[:upper:]' '[:lower:]')",
  "source_hostname": "$(hostname -s)",
  "source_user": "$USER",
  "source_home": "$HOME",
  "architecture": "canonical-source-v1",
  "schema_notes": [
    "~/.ai-context/ is canonical; ~/.claude/ + ~/.gemini/ symlink into it",
    "Symlinks NOT stored (ExFAT). merge-ai-context.ps1 recreates them on target.",
    "MCP: personal-context registered in each tool on target."
  ]
}
EOF

mv "$TMP" "$SNAP"
echo "$(basename "$SNAP")" > "$DRIVE/ai-context-snapshot-LATEST.txt"

echo
echo "═══ snapshot complete ═══"
echo "path: $SNAP"
echo "size: $(du -sh "$SNAP" | cut -f1)"
echo "LATEST.txt updated → $(basename "$SNAP")"
echo
echo "On target machine, run:"
echo "  pwsh $DRIVE/merge-ai-context.ps1"
