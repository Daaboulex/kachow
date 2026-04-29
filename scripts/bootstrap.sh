#!/usr/bin/env bash
# One-command bootstrap for a new machine.
#
# Usage:
#   curl -sL <ai-context-remote>/scripts/bootstrap.sh | bash
#   OR
#   ~/.ai-context/scripts/bootstrap.sh
#
# What it does:
#   1. Verifies ~/.ai-context/ exists (you must clone or syncthing it first)
#   2. Runs install-adapters.sh — drops AGENTS.md symlinks for every installed tool
#   3. Runs install-mcp.sh — registers personal-context MCP server in every tool
#   4. Verifies symlinks resolve
#   5. Verifies MCP server responds

set -euo pipefail

AI_CONTEXT="${AI_CONTEXT:-$HOME/.ai-context}"

echo "═══ AI-context bootstrap ═══"
echo

# ── 1. Canonical source present? ──
if [ ! -d "$AI_CONTEXT" ]; then
  echo "✗ $AI_CONTEXT missing." >&2
  echo "  Clone first: git clone <your-ai-context-remote> $AI_CONTEXT" >&2
  echo "  OR: enable Syncthing for this dir on another device." >&2
  exit 1
fi
if [ ! -f "$AI_CONTEXT/AGENTS.md" ]; then
  echo "✗ $AI_CONTEXT exists but AGENTS.md missing — did clone complete?" >&2
  exit 1
fi
echo "✓ canonical source at $AI_CONTEXT"

# ── 2. Normalize $HOME in settings templates (cross-platform safety) ──
#
# Shell-variable expansion of $HOME in hook commands is unreliable on Windows
# cmd.exe. Resolve to absolute paths at bootstrap time so settings.json works
# identically on every OS. Runs only if a settings template was installed to
# the tool's settings dir by customize.sh.
echo
echo "── Normalizing \$HOME in installed settings ──"
for tgt in "$HOME/.claude/settings.json" "$HOME/.gemini/settings.json"; do
  if [ -f "$tgt" ] && grep -q '"\$HOME' "$tgt" 2>/dev/null; then
    tmp=$(mktemp)
    # Use Node for reliable JSON-safe substitution (sed would escape-fight with backslashes on Windows Git-Bash).
    node -e "
const fs = require('fs');
const os = require('os');
const p = '$tgt';
const s = fs.readFileSync(p, 'utf8').replace(/\\\$HOME/g, os.homedir().replace(/\\\\/g, '/'));
fs.writeFileSync(p, s);
" && echo "✓ normalized \$HOME → $(node -e 'process.stdout.write(require("os").homedir())') in $tgt"
  fi
done

# ── 3. Adapters (AGENTS.md + memory symlinks) ──
echo
echo "── Installing AGENTS.md adapters ──"
# Prefer .mjs when available (single-format cross-platform 2026-04-29).
if [ -f "$AI_CONTEXT/scripts/install-adapters.mjs" ] && command -v node >/dev/null 2>&1; then
  node "$AI_CONTEXT/scripts/install-adapters.mjs"
else
  bash "$AI_CONTEXT/scripts/install-adapters.sh"
fi

# ── 3b. Hooks ──
echo
echo "── Installing hooks ──"
if [ -f "$AI_CONTEXT/scripts/install-hooks.mjs" ] && command -v node >/dev/null 2>&1; then
  node "$AI_CONTEXT/scripts/install-hooks.mjs"
else
  bash "$AI_CONTEXT/scripts/install-hooks.sh"
fi

# ── 3c. Slash commands ──
echo
echo "── Installing slash commands ──"
bash "$AI_CONTEXT/scripts/install-commands.sh"

# ── 3d. Codex hooks (config.toml — separate from JSON hook installer) ──
# Codex stores hooks in config.toml, not settings.json. Currently no bulk wirer
# for kachow's Codex hooks. Until v0.4 (codex.template.toml + bulk-wire script),
# Codex users must hand-author config.toml or use wire-hook-codex.mjs per-hook.
if [ -d "$HOME/.codex" ]; then
  if [ ! -f "$HOME/.codex/config.toml" ] || ! grep -q "codex_hooks = true" "$HOME/.codex/config.toml" 2>/dev/null; then
    echo "  ⚠ Codex detected but config.toml missing or hooks not enabled."
    echo "    Manual setup needed for now (v0.4 will deliver a template)."
  else
    echo "  ✓ Codex config.toml has hooks enabled (manual maintenance for now)."
  fi
fi

# ── 4. MCP registration ──
echo
echo "── Registering MCP server ──"
if [ -f "$AI_CONTEXT/scripts/install-mcp.mjs" ] && command -v node >/dev/null 2>&1; then
  node "$AI_CONTEXT/scripts/install-mcp.mjs"
else
  bash "$AI_CONTEXT/scripts/install-mcp.sh"
fi

# ── 4. Memory/skills symlinks (if fresh machine, may need to symlink these) ──
echo
echo "── Memory + skills symlinks ──"

link_if_missing() {
  local dest="$1" source="$2" label="$3"
  if [ -L "$dest" ]; then
    echo "✓ $label: already symlinked"
    return
  fi
  if [ -e "$dest" ]; then
    # non-empty real dir — back up, then symlink
    local bak="$dest.pre-bootstrap-bak-$(date +%s)"
    echo "↻ $label: backing up existing to $(basename "$bak")"
    mv "$dest" "$bak"
  fi
  mkdir -p "$(dirname "$dest")"
  ln -s "$source" "$dest"
  echo "+ $label: linked"
}

if [ -d "$HOME/.claude" ]; then
  link_if_missing "$HOME/.claude/memory" "$AI_CONTEXT/memory" "claude memory"
  # User skills (skip plugin skills — those live in plugins/cache)
  for skill_dir in "$AI_CONTEXT/skills"/*/; do
    name=$(basename "$skill_dir")
    link_if_missing "$HOME/.claude/skills/$name" "$AI_CONTEXT/skills/$name" "claude skill:$name"
  done
fi
if [ -d "$HOME/.gemini" ]; then
  link_if_missing "$HOME/.gemini/memory" "$AI_CONTEXT/memory" "gemini memory"
  for skill_dir in "$AI_CONTEXT/skills"/*/; do
    name=$(basename "$skill_dir")
    link_if_missing "$HOME/.gemini/skills/$name" "$AI_CONTEXT/skills/$name" "gemini skill:$name"
  done
fi

# ── 5. Verify ──
echo
echo "── Verification ──"
bash "$AI_CONTEXT/scripts/health-check.sh" || {
  echo "⚠ health check reported issues — review above" >&2
  exit 1
}

echo
echo "═══ Bootstrap complete ═══"
echo "Edit: $AI_CONTEXT/AGENTS.md"
echo "Every AI tool (Claude, Gemini, Codex, OpenCode, Aider, Cursor) now reads from it."
echo "MCP tools (search_memory, read_debt, list_tasks, etc.) available in every MCP-capable client."
