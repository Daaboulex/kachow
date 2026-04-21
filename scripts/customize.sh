#!/usr/bin/env bash
# customize.sh — interactive first-install onboarding for kachow.
#
# What it does:
#   1. Asks your name + git email (pre-fill from git config if available)
#   2. Substitutes <owner> in LICENSE, <repo-name> / <owner> in README
#   3. Writes a starter USER SECTION block into AGENTS.md with your identity
#   4. Asks which AI tools to wire (Claude / Gemini / Codex / OpenCode / Aider)
#   5. Asks about optional add-ons (NixOS, embedded, Python)
#   6. Merges selected settings fragments into your tools' settings files
#   7. Runs bootstrap.sh (install-adapters + install-mcp + health-check)
#
# Safe to re-run — idempotent where possible; skips steps already done.

set -euo pipefail

AI="${AI:-$HOME/.ai-context}"
[ -d "$AI" ] || { echo "ERROR: $AI not found — clone first" >&2; exit 1; }
cd "$AI"

# ── Colors ──────────────────────────────────────────────────────────────
C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'; C_GREEN=$'\033[32m'
C_YELLOW=$'\033[33m'; C_CYAN=$'\033[36m'; C_RESET=$'\033[0m'

say()    { printf '\n%s=== %s%s\n' "$C_CYAN$C_BOLD" "$*" "$C_RESET" >&2; }
ok()     { printf '  %s✓%s %s\n' "$C_GREEN" "$C_RESET" "$*" >&2; }
# ask() writes prompt to stderr so $(ask ...) captures only the answer on stdout.
ask()    { printf '%s? %s%s ' "$C_YELLOW" "$*" "$C_RESET" >&2; local _ANS; read -r _ANS; printf '%s' "$_ANS"; }
confirm(){
  local q="$1" default="${2:-N}"
  local hint
  [ "$default" = "Y" ] && hint="[Y/n]" || hint="[y/N]"
  printf '%s? %s %s%s ' "$C_YELLOW" "$q" "$hint" "$C_RESET" >&2
  read -r a
  [ -z "$a" ] && a="$default"
  case "$a" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
}

# ── Splash ──────────────────────────────────────────────────────────────
cat <<'KACHOW'

   _  __           _
  | |/ /__ _   ___| |__   _____      __
  | ' // _` | / __| '_ \ / _ \ \ /\ / /
  | . \ (_| || (__| | | | (_) \ V  V /
  |_|\_\__,_| \___|_| |_|\___/ \_/\_/
                          K A - C H O W !

  Once-setup for the hook + MCP framework. ~2 minutes.

KACHOW

# ── 1. Identity ─────────────────────────────────────────────────────────
say "Identity"
git_email=$(git config --get user.email 2>/dev/null || echo "")
git_name=$(git config --get user.name 2>/dev/null || echo "")

[ -n "$git_name" ] && printf '  %sdetected git name:%s  %s\n' "$C_DIM" "$C_RESET" "$git_name"
[ -n "$git_email" ] && printf '  %sdetected git email:%s %s\n' "$C_DIM" "$C_RESET" "$git_email"

your_name=$(ask "Your name" )
[ -z "$your_name" ] && your_name="$git_name"
your_name="${your_name:-<your-name>}"

your_email=$(ask "Your git email")
[ -z "$your_email" ] && your_email="$git_email"
your_email="${your_email:-<your-email>}"

your_role=$(ask "One-line 'who you are' (skip with Enter)")
ok "Identity captured: $your_name <$your_email>"

# ── 2. LICENSE + README substitutions ──────────────────────────────────
say "Substitute placeholders in LICENSE / README"
if [ -f LICENSE ]; then
  sed -i.bak "s/<owner>/$your_name/g" LICENSE && rm -f LICENSE.bak
  ok "LICENSE copyright → $your_name"
fi
if [ -f README.md ]; then
  default_repo="kachow-fork"
  repo_name=$(ask "Repo name for this fork (default: $default_repo)")
  repo_name="${repo_name:-$default_repo}"
  sed -i.bak "s|<owner>|$your_name|g; s|<repo-name>|$repo_name|g" README.md && rm -f README.md.bak
  ok "README → $your_name/$repo_name"
fi

# ── 3. USER SECTION in AGENTS.md ────────────────────────────────────────
say "Write your USER SECTION in AGENTS.md"
if [ -f AGENTS.md ] && grep -q 'USER SECTION' AGENTS.md; then
  if confirm "write starter identity block into USER SECTION?" Y; then
    tmp_agents=$(mktemp)
    # Replace body between the USER SECTION markers with a fresh identity block.
    # Start marker: line containing "USER SECTION — keep"
    # End marker:   line containing "END USER SECTION"
    awk -v name="$your_name" -v email="$your_email" -v role="$your_role" '
      BEGIN { inside = 0 }
      /USER SECTION — keep/ {
        print
        print ""
        print "## My additions"
        print ""
        print "- Name: " name
        print "- Email: " email
        if (length(role) > 0) print "- Role: " role
        print "- Customize any rules below. Framework updates leave this block alone."
        print ""
        inside = 1
        next
      }
      /END USER SECTION/ { inside = 0; print; next }
      !inside { print }
    ' AGENTS.md > "$tmp_agents"
    mv "$tmp_agents" AGENTS.md
    ok "USER SECTION populated"
  fi
fi

# ── 4. AI tool selection ────────────────────────────────────────────────
say "Which AI tools should I wire?"
declare -A TOOLS
TOOLS[claude]="Claude Code (~/.claude)"
TOOLS[gemini]="Gemini CLI (~/.gemini)"
TOOLS[codex]="Codex CLI (~/.codex)"
TOOLS[opencode]="OpenCode (~/.config/opencode)"
TOOLS[aider]="Aider (~/.config/aider)"

selected=()
for key in claude gemini codex opencode aider; do
  exists=""
  case "$key" in
    claude)   [ -d "$HOME/.claude" ]            && exists="$C_GREEN[installed]$C_RESET" ;;
    gemini)   [ -d "$HOME/.gemini" ]            && exists="$C_GREEN[installed]$C_RESET" ;;
    codex)    [ -d "$HOME/.codex" ]             && exists="$C_GREEN[installed]$C_RESET" ;;
    opencode) [ -d "$HOME/.config/opencode" ]   && exists="$C_GREEN[installed]$C_RESET" ;;
    aider)    [ -d "$HOME/.config/aider" ] || command -v aider >/dev/null 2>&1 && exists="$C_GREEN[installed]$C_RESET" ;;
  esac
  default="N"
  [ -n "$exists" ] && default="Y"
  if confirm "  wire ${TOOLS[$key]} $exists" "$default"; then
    selected+=("$key")
  fi
done
ok "Selected: ${selected[*]:-none}"

# ── 5. Optional add-ons ─────────────────────────────────────────────────
say "Optional add-ons"
addons=()
if confirm "NixOS flake support (WebFetch nixos.org/nix.dev permissions)"; then
  addons+=(nixos)
fi
if confirm "Embedded / firmware (arm-none-eabi + pio + platformio permissions)"; then
  addons+=(embedded)
fi
if confirm "Python stack (pytest + uv + ruff + mypy permissions)"; then
  addons+=(python)
fi
ok "Add-ons: ${addons[*]:-none}"

# ── 6. Merge settings — copy template then apply add-ons ───────────────
say "Apply settings template + add-ons"
for tool in "${selected[@]}"; do
  case "$tool" in
    claude)
      dst="$HOME/.claude/settings.json"
      if [ -f settings.template.json ]; then
        if [ -f "$dst" ]; then
          ok "existing $dst — NOT overwritten (merge manually)"
        else
          mkdir -p "$(dirname "$dst")"
          cp settings.template.json "$dst"
          ok "installed $dst"
        fi
      fi
      ;;
    gemini)
      dst="$HOME/.gemini/settings.json"
      if [ -f settings.gemini.template.json ]; then
        if [ -f "$dst" ]; then
          ok "existing $dst — NOT overwritten"
        else
          mkdir -p "$(dirname "$dst")"
          cp settings.gemini.template.json "$dst"
          ok "installed $dst"
        fi
      fi
      ;;
  esac
done

# Optional add-on permissions fragments
for a in "${addons[@]}"; do
  frag="$AI/settings.${a}.json.example"
  if [ -f "$frag" ]; then
    ok "add-on fragment available: $frag (merge manually into your settings)"
  fi
done

# ── 7. Bootstrap ────────────────────────────────────────────────────────
say "Run bootstrap (install-adapters + install-mcp + health-check)"
if confirm "run bootstrap.sh now?" Y; then
  bash "$AI/scripts/bootstrap.sh" || {
    printf '\n%s✗ bootstrap reported issues — review output above.%s\n' "$C_YELLOW" "$C_RESET"
    exit 1
  }
  ok "bootstrap complete"
fi

printf '\n%sKa-chow! Setup complete.%s\n' "$C_GREEN$C_BOLD" "$C_RESET"
echo "  Next: edit your USER SECTION in $AI/AGENTS.md to fine-tune rules."
echo "  Verify:  bash $AI/scripts/health-check.sh"
