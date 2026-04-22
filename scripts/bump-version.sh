#!/usr/bin/env bash
# bump-version.sh — semver bump from Conventional Commits since last tag.
#
# Scans commits in THIS repo (cwd defaults to ~/.ai-context). Classifies each:
#   feat!…  / BREAKING CHANGE: → major
#   feat:   / feat(xxx):       → minor
#   fix:    / fix(xxx):        → patch
#   anything else              → ignored for bumping
#
# Writes new version to ./VERSION and prepends a CHANGELOG.md section.
#
# Usage:
#   bump-version.sh                     # auto-bump based on commits
#   bump-version.sh --set 0.2.0         # force a specific version
#   bump-version.sh --dry-run           # print the bump + changelog, no writes
#   bump-version.sh --from <tag>        # override start tag (default: last tag)
#   bump-version.sh --path <dir>        # operate in <dir> (default: cwd)
#
# Exit:
#   0 — bumped (or no-op if nothing to bump and not --set)
#   1 — error

set -euo pipefail

DRY=0
FORCE_VER=""
FROM_TAG=""
REPO_PATH="$PWD"
STATS_DIR=""

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)    DRY=1; shift ;;
    --set)        FORCE_VER="$2"; shift 2 ;;
    --from)       FROM_TAG="$2"; shift 2 ;;
    --path)       REPO_PATH="$2"; shift 2 ;;
    --stats-dir)  STATS_DIR="$2"; shift 2 ;;
    -h|--help)    sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

cd "$REPO_PATH"
[ -d .git ] || { echo "not a git repo: $REPO_PATH" >&2; exit 1; }

# ── Current version ──────────────────────────────────────────────────────
if [ -f VERSION ]; then
  current=$(tr -d ' \n' < VERSION)
else
  # fall back to last tag like v0.1.0
  last_tag=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
  if [ -n "$last_tag" ]; then
    current="${last_tag#v}"
  else
    current="0.0.0"
  fi
fi

# Validate semver
if ! printf '%s\n' "$current" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "invalid current version: $current" >&2
  exit 1
fi

IFS='.' read -r MA MI PA <<< "$current"

# ── Figure out which bump ────────────────────────────────────────────────
bump="none"
if [ -n "$FORCE_VER" ]; then
  new="$FORCE_VER"
  bump="forced"
else
  # Determine start-point for log scan
  if [ -z "$FROM_TAG" ]; then
    FROM_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
  fi

  if [ -n "$FROM_TAG" ]; then
    log_range="${FROM_TAG}..HEAD"
  else
    log_range="HEAD"
  fi

  commits=$(git log "$log_range" --format='%s%n%b%n--END--' 2>/dev/null || true)

  has_breaking=0
  has_feat=0
  has_fix=0
  while IFS= read -r line; do
    # Title-line classification
    case "$line" in
      feat!:*|feat\(*\)!:*) has_breaking=1 ;;
      feat:*|feat\(*\):*)   has_feat=1 ;;
      fix!:*|fix\(*\)!:*)   has_breaking=1 ;;
      fix:*|fix\(*\):*)     has_fix=1 ;;
      *BREAKING\ CHANGE:*)  has_breaking=1 ;;
    esac
  done <<< "$commits"

  if [ $has_breaking -eq 1 ]; then bump="major"
  elif [ $has_feat -eq 1 ]; then    bump="minor"
  elif [ $has_fix -eq 1 ]; then     bump="patch"
  else                              bump="none"
  fi

  case "$bump" in
    major) MA=$((MA + 1)); MI=0; PA=0 ;;
    minor) MI=$((MI + 1)); PA=0 ;;
    patch) PA=$((PA + 1)) ;;
    none)  : ;;
  esac
  new="${MA}.${MI}.${PA}"
fi

# ── Generate changelog section ──────────────────────────────────────────
today=$(date +%Y-%m-%d)

# Count current ship-stats for CHANGELOG honesty (P2 #16). Tolerate missing dirs
# (when running in the source repo, these may not exist until publish-time scrub).
count_files() {
  local d="$1" maxd="${2:-1}" pat="$3"
  [ -d "$d" ] || { echo 0; return 0; }
  find "$d" -maxdepth "$maxd" -name "$pat" -type f 2>/dev/null | wc -l | tr -d ' '
}
SD="${STATS_DIR:-.}"
hook_count=$(count_files "$SD/hooks" 1 '*.js')
lib_count=$(count_files "$SD/hooks/lib" 3 '*.js')
sh_count=$(count_files "$SD/scripts" 1 '*.sh')
ps1_count=$(count_files "$SD/scripts" 1 '*.ps1')
cmd_count=$(count_files "$SD/commands" 1 '*.md')

read -r -d '' section <<EOF || true
## [${new}] — ${today}
Bump: ${bump}

### Ship stats
- ${hook_count} hooks + ${lib_count} lib files
- ${sh_count} shell scripts + ${ps1_count} PowerShell parity
- ${cmd_count} slash commands
- MCP server: 14 tools, dependency-free
EOF
section+=$'\n\n'

# Grouped bullets from commit log
if [ -z "$FORCE_VER" ] && [ "$bump" != "none" ]; then
  feat_lines=$(git log "$log_range" --format='- %s' --grep='^feat' 2>/dev/null | grep '^-' || true)
  fix_lines=$(git log "$log_range" --format='- %s' --grep='^fix' 2>/dev/null | grep '^-' || true)
  break_lines=$(git log "$log_range" --format='- %s' --grep='^feat!\|^fix!\|BREAKING' 2>/dev/null | grep '^-' || true)
  if [ -n "$break_lines" ]; then
    section+=$'### Breaking\n'"$break_lines"$'\n\n'
  fi
  if [ -n "$feat_lines" ]; then
    section+=$'### Added\n'"$feat_lines"$'\n\n'
  fi
  if [ -n "$fix_lines" ]; then
    section+=$'### Fixed\n'"$fix_lines"$'\n\n'
  fi
fi

# ── Apply or dry-run ─────────────────────────────────────────────────────
if [ "$DRY" = "1" ]; then
  echo "── bump-version.sh DRY RUN ──"
  echo "  current:  $current"
  echo "  bump:     $bump"
  echo "  new:      $new"
  echo
  echo "── CHANGELOG section that would be prepended ──"
  printf '%s\n' "$section"
  exit 0
fi

if [ "$bump" = "none" ] && [ -z "$FORCE_VER" ]; then
  echo "no feat/fix/breaking commits since ${FROM_TAG:-beginning} — nothing to bump."
  exit 0
fi

# Write VERSION
printf '%s\n' "$new" > VERSION

# Prepend CHANGELOG section
if [ -f CHANGELOG.md ]; then
  tmp=$(mktemp)
  # Keep header (first few lines until first "## " section) — insert new section before first H2
  awk -v section="$section" '
    BEGIN { inserted = 0 }
    /^## / && !inserted { print section; inserted = 1 }
    { print }
  ' CHANGELOG.md > "$tmp"
  mv "$tmp" CHANGELOG.md
else
  {
    echo "# Changelog"
    echo
    printf '%s\n' "$section"
  } > CHANGELOG.md
fi

echo "bumped: $current → $new ($bump)"
echo "  VERSION:     ./VERSION"
echo "  CHANGELOG:   ./CHANGELOG.md (prepended)"
echo "  next step:   git add VERSION CHANGELOG.md && git commit -m 'chore(release): v$new'"
