// project-key.js — 3-tier project key derivation for handoff system.
//
// Derives a stable identifier for any working directory:
//   1. project-identity.json (explicit, user-controlled)
//   2. git root basename (works for local-only repos)
//   3. realpath slug (fallback for non-git dirs)
//
// Special-cases tool config dirs (~/.claude, ~/.gemini, ~/.codex, ~/.ai-context).
//
// Exports: deriveProjectKey, deriveProjectKeyCached, slugify, gitRootFor

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();

// Default special dirs — tool config roots that aren't git repos.
// Extend via HANDOFF_SPECIAL_DIRS env: "dir1:key1,dir2:key2"
const SPECIAL_DIRS = new Map([
  [path.join(HOME, '.claude'), { key: 'dot-claude', display: '.claude' }],
  [path.join(HOME, '.gemini'), { key: 'dot-gemini', display: '.gemini' }],
  [path.join(HOME, '.codex'), { key: 'dot-codex', display: '.codex' }],
  [path.join(HOME, '.ai-context'), { key: 'dot-ai-context', display: '.ai-context' }],
]);

// User-specific special dirs from env
if (process.env.HANDOFF_SPECIAL_DIRS) {
  for (const pair of process.env.HANDOFF_SPECIAL_DIRS.split(',')) {
    const [dir, key] = pair.split(':');
    if (dir && key) SPECIAL_DIRS.set(dir.startsWith('/') ? dir : path.join(HOME, dir), { key, display: path.basename(dir) });
  }
}

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function deriveProjectKey(cwd) {
  let resolved;
  try { resolved = fs.realpathSync(cwd); } catch { resolved = cwd; }

  // Special-case known tool dirs (match dir itself or any subdir)
  for (const [dir, info] of SPECIAL_DIRS) {
    if (resolved === dir || resolved.startsWith(dir + path.sep)) {
      return { key: info.key, display: info.display, source: 'special' };
    }
  }

  // Walk up looking for project-identity.json or .git/
  let current = resolved;
  while (true) {
    // Priority 1: project-identity.json
    for (const sub of ['.ai-context', '.claude']) {
      const idFile = path.join(current, sub, 'project-identity.json');
      try {
        const data = JSON.parse(fs.readFileSync(idFile, 'utf8'));
        const name = data.project || data.identity;
        if (name) {
          return { key: slugify(name), display: name, source: 'identity' };
        }
      } catch {}
    }

    // Priority 2: git root
    try {
      const gitDir = path.join(current, '.git');
      const st = fs.statSync(gitDir);
      if (st.isDirectory() || st.isFile()) {
        const name = path.basename(current);
        return { key: slugify(name), display: name, source: 'git-root' };
      }
    } catch {}

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  // Priority 3: path-based fallback
  return { key: slugify(resolved), display: path.basename(resolved), source: 'path' };
}

// In-process cache for repeated calls within same hook invocation
const _cache = new Map();

function deriveProjectKeyCached(cwd) {
  const existing = _cache.get(cwd);
  if (existing) return existing;
  const result = deriveProjectKey(cwd);
  _cache.set(cwd, result);
  return result;
}

function gitRootFor(filePath) {
  const cacheKey = 'gitroot:' + filePath;
  const existing = _cache.get(cacheKey);
  if (existing !== undefined) return existing;

  let dir = path.dirname(filePath);
  while (true) {
    try {
      const gitDir = path.join(dir, '.git');
      const st = fs.statSync(gitDir);
      if (st.isDirectory() || st.isFile()) {
        _cache.set(cacheKey, dir);
        return dir;
      }
    } catch {}
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  _cache.set(cacheKey, null);
  return null;
}

module.exports = { deriveProjectKey, deriveProjectKeyCached, slugify, gitRootFor };
