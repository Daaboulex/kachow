#!/usr/bin/env bash
# macbook-catchup-v080.sh — Run on MacBook after Ryzen v0.8.0 consolidation.
# Brings MacBook to the same "one brain" state as Ryzen.
#
# Prerequisites:
#   - Syncthing ai-context folder has finished syncing from Ryzen
#   - Run as normal user (no sudo)
#
# Safe to re-run (idempotent).

set -euo pipefail

AI="$HOME/.ai-context"

# ── Colors ──
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { printf "${GREEN}✓${NC} %s\n" "$1"; }
warn() { printf "${YELLOW}⚠${NC} %s\n" "$1"; }
fail() { printf "${RED}✗${NC} %s\n" "$1"; exit 1; }
step() { printf "\n${YELLOW}── %s ──${NC}\n" "$1"; }

# ══════════════════════════════════════════════════════════════════════════════
# 1. Pre-flight checks
# ══════════════════════════════════════════════════════════════════════════════
step "Pre-flight checks"

HOSTNAME=$(hostname -s 2>/dev/null || hostname)
if [[ "$HOSTNAME" != "macbook-pro-9-2" && "$HOSTNAME" != macbook* ]]; then
  warn "Hostname is '$HOSTNAME' — expected macbook-pro-9-2. Continuing anyway (might be alias)."
fi

if [ ! -d "$AI/configs" ]; then
  fail "~/.ai-context/configs/ not found. Syncthing hasn't finished syncing yet. Wait and re-run."
fi

if [ ! -f "$AI/configs/claude-settings.json" ]; then
  fail "configs/claude-settings.json missing. Syncthing sync incomplete."
fi

ok "ai-context synced (configs/ present)"

# ══════════════════════════════════════════════════════════════════════════════
# 2. Push any unpushed MacBook commits from tool dirs
# ══════════════════════════════════════════════════════════════════════════════
step "Push unpushed commits from tool dirs (before removing .git)"

for d in "$HOME/.claude" "$HOME/.gemini" "$HOME/.codex"; do
  name=$(basename "$d")
  if [ -d "$d/.git" ]; then
    cd "$d"
    # Stage + commit any uncommitted changes
    if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
      git add -A && git commit -m "chore: final MacBook commit before v0.8.0 consolidation" --no-gpg-sign --allow-empty 2>/dev/null || true
    fi
    # Push if remote exists
    if git remote get-url origin &>/dev/null; then
      git push origin main 2>/dev/null && ok "$name: pushed to origin" || warn "$name: push failed (repo may be archived — that's expected)"
    else
      warn "$name: no remote configured"
    fi
  else
    ok "$name: no .git (already consolidated or never had one)"
  fi
done

# ══════════════════════════════════════════════════════════════════════════════
# 3. Create settings symlinks via install-adapters.mjs
# ══════════════════════════════════════════════════════════════════════════════
step "Create/verify symlinks (install-adapters.mjs)"

if command -v node &>/dev/null; then
  node "$AI/scripts/install-adapters.mjs"
  ok "install-adapters.mjs completed"
else
  fail "Node.js not found — required for install-adapters.mjs"
fi

# Explicit settings symlinks (belt + suspenders — install-adapters should handle these)
for pair in \
  "configs/claude-settings.json:.claude/settings.json" \
  "configs/gemini-settings.json:.gemini/settings.json" \
  "configs/codex-config.toml:.codex/config.toml"; do
  src="$AI/${pair%%:*}"
  dest="$HOME/${pair##*:}"
  if [ -L "$dest" ]; then
    ok "$(basename "$dest"): already symlinked"
  elif [ -f "$src" ]; then
    mkdir -p "$(dirname "$dest")"
    ln -sf "$src" "$dest"
    ok "$(basename "$dest"): symlinked → $src"
  else
    warn "$(basename "$dest"): source $src not found"
  fi
done

# ══════════════════════════════════════════════════════════════════════════════
# 4. Remove .git from tool dirs
# ══════════════════════════════════════════════════════════════════════════════
step "Remove .git from tool dirs"

for d in "$HOME/.claude" "$HOME/.gemini" "$HOME/.codex"; do
  name=$(basename "$d")
  if [ -d "$d/.git" ]; then
    rm -rf "$d/.git"
    ok "$name: .git removed"
  else
    ok "$name: no .git (clean)"
  fi
done

# ══════════════════════════════════════════════════════════════════════════════
# 5. Remove tool-dir Syncthing folders
# ══════════════════════════════════════════════════════════════════════════════
step "Remove tool-dir Syncthing folders"

if command -v syncthing &>/dev/null; then
  for f in claude gemini codex; do
    syncthing cli config folders "$f" delete 2>/dev/null && ok "Syncthing folder '$f': deleted" || ok "Syncthing folder '$f': already gone"
  done
else
  warn "syncthing CLI not found — remove claude/gemini/codex folders manually via Syncthing UI"
fi

# ══════════════════════════════════════════════════════════════════════════════
# 6. Delete stale top-level dirs
# ══════════════════════════════════════════════════════════════════════════════
step "Delete stale dirs"

for d in "$HOME/.kachow-mirror" "$HOME/.kachow-release"; do
  if [ -d "$d" ] || [ -f "$d" ]; then
    rm -rf "$d"
    ok "Deleted: $d"
  else
    ok "$(basename "$d"): not found (clean)"
  fi
done

# ══════════════════════════════════════════════════════════════════════════════
# 7. Clean ~/Documents stale dirs
# ══════════════════════════════════════════════════════════════════════════════
step "Clean ~/Documents stale dirs"

DOCS="$HOME/Documents"
if [ -d "$DOCS" ]; then
  # Empty dirs
  for d in ".codex" ".agents" ".git"; do
    target="$DOCS/$d"
    if [ -d "$target" ]; then
      # Only remove if empty or just has .git internals
      if [ -z "$(ls -A "$target" 2>/dev/null)" ]; then
        rmdir "$target" && ok "Deleted empty: Documents/$d"
      else
        warn "Documents/$d not empty — skipping ($(ls "$target" | wc -l) items)"
      fi
    fi
  done
  # Stale planning/audit
  for d in ".planning" ".audit"; do
    target="$DOCS/$d"
    if [ -d "$target" ]; then
      rm -rf "$target"
      ok "Deleted stale: Documents/$d"
    fi
  done
  # Stale .superpowers (should have been consolidated to ai-context)
  if [ -d "$DOCS/.superpowers" ]; then
    rm -rf "$DOCS/.superpowers"
    ok "Deleted stale: Documents/.superpowers"
  fi
else
  warn "~/Documents not found"
fi

# ══════════════════════════════════════════════════════════════════════════════
# 8. Clean project dirs
# ══════════════════════════════════════════════════════════════════════════════
step "Clean project-level stale dirs"

FM="$DOCS/[project]"
if [ -d "$FM" ]; then
  for d in \
    "$FM/.claude/sync-conflicts-archive-2026-04-14" \
    "$FM/.claude/get-shit-done.removed-2026-04-29" \
    "$FM/.gemini/get-shit-done.removed-2026-04-29"; do
    if [ -d "$d" ]; then
      rm -rf "$d"
      ok "Deleted: $(echo "$d" | sed "s|$DOCS/||")"
    fi
  done

  # Ensure memory symlinks in [project]
  for sub in .claude .gemini; do
    memdir="$FM/$sub/memory"
    target="$AI/project-state/[project]/memory"
    if [ -L "$memdir" ]; then
      ok "[user]/$sub/memory: already symlinked"
    elif [ -d "$target" ]; then
      rm -rf "$memdir"
      ln -sf "$target" "$memdir"
      ok "[user]/$sub/memory: symlinked"
    fi
  done
fi

# Nix submodule → symlink (should already be done via Syncthing)
NIX="$DOCS/nix"
if [ -d "$NIX" ]; then
  if [ -L "$NIX/.ai-context" ]; then
    ok "nix/.ai-context: already symlinked"
  elif [ -d "$NIX/.ai-context/.git" ]; then
    warn "nix/.ai-context is still a submodule — needs manual 'git submodule deinit' + symlink"
  fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# 9. Verify
# ══════════════════════════════════════════════════════════════════════════════
step "Verification"

ERRORS=0

# 9a. Settings symlinks resolve
for pair in \
  ".claude/settings.json:Claude" \
  ".gemini/settings.json:Gemini" \
  ".codex/config.toml:Codex"; do
  file="$HOME/${pair%%:*}"
  label="${pair##*:}"
  if [ -L "$file" ] && [ -f "$file" ]; then
    ok "$label settings: symlink OK"
  else
    warn "$label settings: NOT a valid symlink"; ERRORS=$((ERRORS+1))
  fi
done

# 9b. JSON/TOML valid
python3 -c "import json; json.load(open('$HOME/.claude/settings.json')); print('  Claude JSON: valid')" 2>/dev/null || { warn "Claude settings: invalid JSON"; ERRORS=$((ERRORS+1)); }
python3 -c "import json; json.load(open('$HOME/.gemini/settings.json')); print('  Gemini JSON: valid')" 2>/dev/null || { warn "Gemini settings: invalid JSON"; ERRORS=$((ERRORS+1)); }
if [ -f "$HOME/.codex/config.toml" ] && grep -q '\[hooks' "$HOME/.codex/config.toml" 2>/dev/null; then
  ok "Codex TOML: valid"
else
  warn "Codex TOML: missing or no [hooks]"; ERRORS=$((ERRORS+1))
fi

# 9c. Crush + OpenCode
[ -L "$HOME/.config/crush/crush.json" ] && ok "Crush config: symlink OK" || warn "Crush config: missing"
[ -L "$HOME/.config/opencode/config.json" ] && ok "OpenCode config: symlink OK" || warn "OpenCode config: missing"

# 9d. No .git in tool dirs
for d in "$HOME/.claude" "$HOME/.gemini" "$HOME/.codex"; do
  name=$(basename "$d")
  [ -d "$d/.git" ] && { warn "$name: still has .git!"; ERRORS=$((ERRORS+1)); } || ok "$name: no .git"
done

# 9e. Syncthing folders
if command -v syncthing &>/dev/null; then
  FOLDERS=$(syncthing cli config folders list 2>/dev/null || echo "")
  for expect in "ai-context" "documents"; do
    echo "$FOLDERS" | grep -q "^${expect}$" && ok "Syncthing folder '$expect': present" || warn "Syncthing folder '$expect': missing"
  done
  for gone in "claude" "gemini" "codex"; do
    echo "$FOLDERS" | grep -q "^${gone}$" && { warn "Syncthing folder '$gone': still present!"; ERRORS=$((ERRORS+1)); } || ok "Syncthing folder '$gone': removed"
  done
fi

# 9f. VERSION
if [ -f "$AI/VERSION" ]; then
  VER=$(cat "$AI/VERSION" | tr -d '[:space:]')
  [ "$VER" = "0.8.0" ] && ok "VERSION: $VER" || warn "VERSION: $VER (expected 0.8.0)"
else
  warn "VERSION file not found"
fi

# ── Summary ──
step "Summary"
if [ "$ERRORS" -eq 0 ]; then
  printf "${GREEN}All checks passed. MacBook is consolidated.${NC}\n"
else
  printf "${RED}%d issue(s) found — review warnings above.${NC}\n" "$ERRORS"
fi
