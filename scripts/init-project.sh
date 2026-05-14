#!/usr/bin/env bash
# init-project.sh — Initialize AI context for a new project directory.
# Creates .ai-context/ with AGENTS.md template + hidden tool dirs.
# ZERO visible AI files at project root — all in dotdirs.
#
# Usage: bash ~/.ai-context/scripts/init-project.sh [project-dir]
# If no dir given, uses current directory.

set -euo pipefail

AI_CONTEXT_HOME="$HOME/.ai-context"
PROJECT_DIR="${1:-.}"
PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd)"
PROJECT_NAME="$(basename "$PROJECT_DIR")"

echo "Initializing AI context for: $PROJECT_NAME ($PROJECT_DIR)"

# 1. Create project state in global ai-context
PROJECT_STATE="$AI_CONTEXT_HOME/projects/$PROJECT_NAME"
if [ -d "$PROJECT_STATE" ]; then
  echo "  Project state exists: $PROJECT_STATE"
else
  mkdir -p "$PROJECT_STATE/memory"
  cp "$AI_CONTEXT_HOME/projects/template/AGENTS.md" "$PROJECT_STATE/AGENTS.md"
  sed -i "s/{name}/$PROJECT_NAME/g" "$PROJECT_STATE/AGENTS.md"
  echo "  Created: $PROJECT_STATE"
fi

# 2. Create .ai-context symlink in project (hidden dotdir)
if [ -L "$PROJECT_DIR/.ai-context" ] || [ -d "$PROJECT_DIR/.ai-context" ]; then
  echo "  .ai-context exists"
else
  ln -s "$PROJECT_STATE" "$PROJECT_DIR/.ai-context"
  echo "  .ai-context -> $PROJECT_STATE"
fi

# 3. Tool symlinks — ALL in hidden dirs, ZERO at root
# Claude: .claude/CLAUDE.md
mkdir -p "$PROJECT_DIR/.claude"
[ -L "$PROJECT_DIR/.claude/CLAUDE.md" ] || ln -sf ../.ai-context/AGENTS.md "$PROJECT_DIR/.claude/CLAUDE.md"

# Gemini: .gemini/GEMINI.md
mkdir -p "$PROJECT_DIR/.gemini"
[ -L "$PROJECT_DIR/.gemini/GEMINI.md" ] || ln -sf ../.ai-context/AGENTS.md "$PROJECT_DIR/.gemini/GEMINI.md"

# Codex: .codex/AGENTS.md
mkdir -p "$PROJECT_DIR/.codex"
[ -L "$PROJECT_DIR/.codex/AGENTS.md" ] || ln -sf ../.ai-context/AGENTS.md "$PROJECT_DIR/.codex/AGENTS.md"

# Pi: reads from kachow-bridge.ts injection (.ai-context/AGENTS.md)
# No per-project file needed — extension handles it.

echo "  Tool symlinks: .claude/ .gemini/ .codex/ (all hidden)"

# 4. Clean up any root-level tool files from previous setup
for f in CLAUDE.md GEMINI.md AGENTS.md; do
  if [ -L "$PROJECT_DIR/$f" ]; then
    rm "$PROJECT_DIR/$f"
    echo "  Removed root $f (now in hidden dir)"
  fi
done

# 5. Add to .gitignore
GITIGNORE_BLOCK="# AI context — all in hidden dirs
.ai-context/
.claude/
.gemini/
.codex/"

if [ -f "$PROJECT_DIR/.gitignore" ]; then
  if ! grep -q ".ai-context" "$PROJECT_DIR/.gitignore" 2>/dev/null; then
    printf '\n%s\n' "$GITIGNORE_BLOCK" >> "$PROJECT_DIR/.gitignore"
    echo "  .gitignore updated"
  fi
else
  echo "$GITIGNORE_BLOCK" > "$PROJECT_DIR/.gitignore"
  echo "  .gitignore created"
fi

echo "Done. $PROJECT_NAME ready for Claude, Gemini, Codex, Pi."
echo "  Visible root files: ZERO (all in dotdirs)"
