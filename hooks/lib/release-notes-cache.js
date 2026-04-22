// release-notes-cache.js
// Fetch + cache GitHub release notes by version.
// Cross-platform: uses `gh` CLI if present, else silent no-op.
// Keyed by repo+version → one file per release. TTL-less (releases are immutable).

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const CACHE_DIR = path.join(os.homedir(), '.claude', 'cache', 'release-notes');

function ensureCacheDir() {
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch {}
}

function hasGh() {
  try {
    execSync('gh --version', { stdio: 'ignore', timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

function fetchReleaseNotes(version, repo = 'anthropics/claude-code') {
  ensureCacheDir();
  const safeRepo = repo.replace(/[^a-zA-Z0-9_-]/g, '_');
  const cachePath = path.join(CACHE_DIR, `${safeRepo}__v${version}.json`);
  if (fs.existsSync(cachePath)) {
    try { return JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch {}
  }
  if (!hasGh()) return null;
  try {
    const out = execSync(
      `gh release view v${version} --repo ${repo} --json name,body,tagName,publishedAt`,
      { encoding: 'utf8', timeout: 8000 }
    );
    const data = JSON.parse(out);
    try { fs.writeFileSync(cachePath, JSON.stringify(data, null, 2)); } catch {}
    return data;
  } catch {
    return null;
  }
}

function detectBreakingHookSignals(body) {
  if (!body) return [];
  const signals = [];
  const patterns = [
    /\bhooks?\s+(deprecated|removed|breaking|renamed)/i,
    /\b(SessionStart|SessionEnd|PreToolUse|PostToolUse|Stop|PreCompact|SubagentStart|SubagentStop|Notification)\b.*\b(remov|deprecat|renam|break)/i,
    /\bbreaking[-\s]change\b/i,
    /\bdeprecat(ed|ion)\b/i,
    /\b(remove[d]?|dropp?ed)\s+(hook|event|setting)/i,
  ];
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    for (const re of patterns) {
      if (re.test(line)) {
        signals.push(line.trim().replace(/^[-*]\s*/, ''));
        break;
      }
    }
  }
  return signals;
}

function diffReleaseNotes(fromVersion, toVersion, repo = 'anthropics/claude-code') {
  const to = fetchReleaseNotes(toVersion, repo);
  if (!to) return null;
  return {
    fromVersion,
    toVersion,
    title: to.name,
    publishedAt: to.publishedAt,
    body: to.body,
    breakingHookSignals: detectBreakingHookSignals(to.body || ''),
  };
}

module.exports = {
  fetchReleaseNotes,
  diffReleaseNotes,
  detectBreakingHookSignals,
  hasGh,
};
