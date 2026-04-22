#!/usr/bin/env bash
# Health check: verify canonical source, symlinks, MCP server, JSON validity.
#
# Usage: ~/.ai-context/scripts/health-check.sh
# Exit code: 0 all green, 1 issues found.

set -uo pipefail  # note: no -e, want to collect all failures

AI_CONTEXT="${AI_CONTEXT:-$HOME/.ai-context}"
FAILED=0

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$*"; }

check() {
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then
    green "  ✓ $name"
  else
    red "  ✗ $name"
    FAILED=$((FAILED + 1))
  fi
}

echo "═══ AI-context health check ═══"

echo
echo "── Canonical source ──"
check "AGENTS.md exists"      test -f "$AI_CONTEXT/AGENTS.md"
check "memory/ dir exists"    test -d "$AI_CONTEXT/memory"
check "skills/ dir exists"    test -d "$AI_CONTEXT/skills"
check "MCP server exists"     test -f "$AI_CONTEXT/mcp/personal-context/server.js"
check "install-adapters.sh"   test -x "$AI_CONTEXT/scripts/install-adapters.sh"
check "install-mcp.sh"        test -x "$AI_CONTEXT/scripts/install-mcp.sh"

echo
echo "── AGENTS.md symlinks ──"
for target in \
  "$HOME/.claude/CLAUDE.md" \
  "$HOME/.gemini/GEMINI.md" \
  "$HOME/.codex/AGENTS.md" \
  "$HOME/.config/opencode/AGENTS.md" \
  "$HOME/.config/aider/AGENTS.md"; do
  label="${target#$HOME/}"
  if [ -L "$target" ] && [ "$(readlink "$target")" = "$AI_CONTEXT/AGENTS.md" ]; then
    green "  ✓ $label → AGENTS.md"
  elif [ -L "$target" ]; then
    yellow "  ~ $label → $(readlink "$target")  (not canonical)"
  elif [ -f "$target" ]; then
    yellow "  ~ $label is a regular file (not symlinked)"
  else
    yellow "  - $label missing (tool not installed?)"
  fi
done

echo
echo "── Memory + skill symlinks ──"
for target in "$HOME/.claude/memory" "$HOME/.gemini/memory"; do
  label="${target#$HOME/}"
  if [ -L "$target" ] && [ "$(readlink "$target")" = "$AI_CONTEXT/memory" ]; then
    green "  ✓ $label → memory/"
  else
    yellow "  ~ $label not symlinked to canonical"
  fi
done

echo
echo "── Recursive symlink audit ──"
if [ -f "$HOME/.claude/hooks/lib/symlink-audit.js" ] && command -v node >/dev/null 2>&1; then
  BROKEN_COUNT=$(node "$HOME/.claude/hooks/lib/symlink-audit.js" --json 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['summary']['broken_live'])" 2>/dev/null || echo "?")
  LOOPS=$(node "$HOME/.claude/hooks/lib/symlink-audit.js" --json 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['summary']['loops'])" 2>/dev/null || echo "?")
  if [ "$BROKEN_COUNT" = "0" ] && [ "$LOOPS" = "0" ]; then
    TOTAL=$(node "$HOME/.claude/hooks/lib/symlink-audit.js" --json 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['summary']['total'])" 2>/dev/null || echo "?")
    green "  ✓ $TOTAL symlinks, 0 broken"
  else
    red "  ✗ $BROKEN_COUNT broken live symlinks, $LOOPS loops"
    node "$HOME/.claude/hooks/lib/symlink-audit.js" --only-broken 2>/dev/null | head -10 | sed 's/^/    /'
    FAILED=$((FAILED + 1))
  fi
else
  yellow "  ~ symlink-audit.js not available — skipping recursive scan"
fi

echo
echo "── Settings JSON validity ──"
check "~/.claude/settings.json parses" python3 -c "import json; json.load(open('$HOME/.claude/settings.json'))"
check "~/.gemini/settings.json parses" python3 -c "import json; json.load(open('$HOME/.gemini/settings.json'))"
check "~/.claude.json parses"          python3 -c "import json; json.load(open('$HOME/.claude.json'))"

echo
echo "── MCP server ──"
if command -v node >/dev/null 2>&1; then
  green "  ✓ node available"
  # stdio test: initialize + tools/list
  # macOS ships without GNU `timeout`. Rely on EOF — server exits when stdin
  # closes after the three requests. Use the server's supported protocol
  # version (2025-06-18) rather than the older 2025-11-05 string.
  # Robust probe: scan ALL response lines for one with result.tools.
  # Handles server stderr-warmup lines, protocol-version mismatches, and CI
  # line-ordering differences.
  RESPONSE=$(printf '%s\n%s\n%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"healthcheck","version":"1"}}}' \
    '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
    '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
    | node "$AI_CONTEXT/mcp/personal-context/server.js" 2>/dev/null)
  TOOLS_COUNT=$(printf '%s\n' "$RESPONSE" | python3 -c "
import json, sys
n = 0
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    try:
        d = json.loads(line)
    except Exception:
        continue
    tools = d.get('result', {}).get('tools')
    if tools is not None:
        n = len(tools)
        break
print(n)
" 2>/dev/null || echo 0)
  if [ "$TOOLS_COUNT" -gt 0 ]; then
    green "  ✓ MCP server responds ($TOOLS_COUNT tools)"
  else
    red "  ✗ MCP server not responding correctly"
    FAILED=$((FAILED + 1))
  fi
else
  red "  ✗ node not in PATH — MCP server can't run"
  FAILED=$((FAILED + 1))
fi

echo
echo "── MCP registered in clients ──"
# Claude
if [ -f "$HOME/.claude.json" ]; then
  if python3 -c "import json; d=json.load(open('$HOME/.claude.json')); exit(0 if 'personal-context' in d.get('mcpServers',{}) else 1)" 2>/dev/null; then
    green "  ✓ Claude Code"
  else
    yellow "  ~ Claude Code: personal-context NOT registered"
  fi
fi
# Gemini
if [ -f "$HOME/.gemini/settings.json" ]; then
  if python3 -c "import json; d=json.load(open('$HOME/.gemini/settings.json')); exit(0 if 'personal-context' in d.get('mcpServers',{}) else 1)" 2>/dev/null; then
    green "  ✓ Gemini CLI"
  else
    yellow "  ~ Gemini CLI: personal-context NOT registered"
  fi
fi
# Codex
if [ -f "$HOME/.codex/config.toml" ]; then
  if grep -q '\[mcp_servers.personal-context\]' "$HOME/.codex/config.toml" 2>/dev/null; then
    green "  ✓ Codex CLI"
  else
    yellow "  ~ Codex CLI: personal-context NOT registered"
  fi
fi
# OpenCode
if [ -f "$HOME/.config/opencode/config.json" ]; then
  if python3 -c "import json; d=json.load(open('$HOME/.config/opencode/config.json')); exit(0 if 'personal-context' in d.get('mcp',{}) else 1)" 2>/dev/null; then
    green "  ✓ OpenCode"
  else
    yellow "  ~ OpenCode: personal-context NOT registered"
  fi
fi

echo
echo "── Git state ──"
check "~/.ai-context/ is git repo" test -d "$AI_CONTEXT/.git"
if [ -d "$AI_CONTEXT/.git" ]; then
  uncommitted=$(cd "$AI_CONTEXT" && git status --porcelain | wc -l)
  if [ "$uncommitted" -gt 0 ]; then
    yellow "  ~ $uncommitted uncommitted change(s) — will auto-commit on next session end"
  else
    green "  ✓ clean"
  fi
fi

echo
if [ "$FAILED" -eq 0 ]; then
  green "═══ ALL CHECKS PASSED ═══"
  exit 0
else
  red "═══ $FAILED CHECK(S) FAILED ═══"
  exit 1
fi
