// Project identity detection for Claude hooks.
// Walks up from cwd looking for .claude/project-identity.json
// Returns identity object or null. Cached per-process.
//
// Marker schema (repo-root/.claude/project-identity.json):
//   {
//     "identity": "<project-name>",
//     "type": "local-private" | "github-ok" | "mixed",
//     "allowedGitRemotes": ["ssd", "server"],  // empty = any
//     "forbidRemoteHosts": ["github.com"],
//     "forbidCommands": ["gh"],
//     "statusBadge": "🔒 <project>-local",
//     "description": "..."
//   }

const fs = require('fs');
const path = require('path');

let _cache = null;

function detect(cwd) {
  if (!cwd) cwd = process.cwd();
  if (_cache && _cache.cwd === cwd) return _cache.result;

  let dir = cwd;
  const root = path.parse(dir).root;
  let result = null;
  while (dir && dir !== root) {
    const marker = path.join(dir, '.claude', 'project-identity.json');
    try {
      if (fs.existsSync(marker)) {
        const data = JSON.parse(fs.readFileSync(marker, 'utf8'));
        data._repoRoot = dir;
        data._markerPath = marker;
        result = data;
        break;
      }
    } catch { /* malformed, keep walking */ }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  _cache = { cwd, result };
  return result;
}

function checkBashCommand(cmd, identity) {
  // Returns {block: true, reason} or null. Never throws.
  if (!identity || !cmd) return null;

  // Forbidden command names (whole-word)
  for (const forbid of (identity.forbidCommands || [])) {
    const re = new RegExp(`(^|[\\s;&|])${forbid.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(cmd)) {
      return {
        block: true,
        reason: `[${identity.identity}] forbidden command '${forbid}'. This repo is ${identity.type}. ${identity.description || ''}`
      };
    }
  }

  // Forbidden hosts (word-boundary match, case-insensitive).
  // Exempt read-only display commands (echo/printf/cat/grep mentioning the host in passing).
  // Only block if the host appears in a URL-like position (`://`, `git@`, or as a standalone git remote token).
  const isReadOnlyDisplay = /^\s*(echo|printf|cat|grep|rg|less|head|tail|wc|sort|uniq|diff|file)\b/.test(cmd);
  if (!isReadOnlyDisplay) {
    for (const host of (identity.forbidRemoteHosts || [])) {
      const hostEsc = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Match: https://github.com, git@github.com:, or ' github.com ' as distinct token
      const urlMatch = new RegExp(`(https?://|git@|ssh://|\\s)${hostEsc}([/:\\s]|$)`, 'i');
      if (urlMatch.test(cmd)) {
        return {
          block: true,
          reason: `[${identity.identity}] forbidden host '${host}'. Allowed remotes: ${(identity.allowedGitRemotes || []).join(', ') || '(any local)'}`
        };
      }
    }
  }

  // git push — if allowedGitRemotes is declared, the destination MUST be in the list
  if (identity.allowedGitRemotes && identity.allowedGitRemotes.length > 0) {
    // Match: git push [flags...] <remote> [...]
    // We permit flags like -f, --force, --tags. First non-flag arg after "push" is the remote.
    const pushMatch = cmd.match(/\bgit\s+push\s+([^;&|]+)/);
    if (pushMatch) {
      const tokens = pushMatch[1].trim().split(/\s+/).filter(t => !t.startsWith('-'));
      const remote = tokens[0];
      // Skip if remote is a URL (covered by forbidRemoteHosts) or empty (push with no args)
      if (remote && !remote.includes('://') && !remote.includes('@')) {
        if (!identity.allowedGitRemotes.includes(remote)) {
          return {
            block: true,
            reason: `[${identity.identity}] push to '${remote}' blocked. Allowed: ${identity.allowedGitRemotes.join(', ')}. Use sync-repositories.ps1 for full dual-remote sync.`
          };
        }
      }
    }
  }

  return null;
}

module.exports = { detect, checkBashCommand };
