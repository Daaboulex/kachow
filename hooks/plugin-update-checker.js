#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// gsd-hook-version: 1.29.0
// Plugin Update Checker - runs on SessionStart
// Checks if installed plugins have newer versions in their marketplaces
// Outputs systemMessage if updates available (was stderr-only, fixed for LLM visibility)

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Gemini has no plugin marketplace (extensions instead) — skip on Gemini-side runs.
// Detected via hook copy location so symmetric sync stays clean.
// Fixes "Hook(s) [plugin-update-checker] failed for event SessionStart" on Gemini CLI 0.39+.
if (__dirname.includes('/.gemini/')) {
  process.stdout.write('{"continue":true}');
  process.exit(0);
}

const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(require('os').homedir(), '.claude');
const installedPath = path.join(claudeDir, 'plugins', 'installed_plugins.json');
const marketplacesDir = path.join(claudeDir, 'plugins', 'marketplaces');
const cacheFile = path.join(claudeDir, 'cache', 'plugin-update-check.json');

function output(updates) {
  if (updates && updates.length > 0) {
    process.stdout.write(JSON.stringify({
      continue: true,
      systemMessage: `[plugin-updates] Updates available: ${updates.join(', ')}. Run: /plugin update <name>`
    }));
  } else {
    process.stdout.write('{"continue":true}');
  }
}

// Only hit the network once per day (git fetch is slow). But we STILL surface
// any cached pending updates every session — otherwise the hook detects
// updates once, writes the cache, and the user never sees them until they
// manually rerun with a stale cache. Previous behavior: silent on cache-hit
// → user shipped for 5 days with 5 pending plugin updates invisible.
try {
  if (fs.existsSync(cacheFile)) {
    const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    const age = Date.now() - (cache.checked_at || 0);
    if (age < 86400000) { // 24 hours
      output(cache.updates || []);
      process.exit(0);
    }
  }
} catch (e) {}

try {
  const installed = JSON.parse(fs.readFileSync(installedPath, 'utf8'));
  const plugins = installed.plugins || {};
  const updates = [];

  for (const [fullName, entries] of Object.entries(plugins)) {
    const [pluginName, marketplace] = fullName.split('@');
    if (!marketplace) continue;

    const userEntry = entries.find(e => e.scope === 'user');
    if (!userEntry) continue;

    const mktDir = path.join(marketplacesDir, marketplace);
    if (!fs.existsSync(mktDir)) continue;

    // Check git for newer commits
    try {
      const currentSha = userEntry.gitCommitSha;
      if (!currentSha) continue;

      // Fetch latest (quick, timeout 5s)
      execSync('git fetch origin --quiet', {
        cwd: mktDir,
        stdio: 'pipe',
        timeout: 5000
      });

      const latestSha = execSync('git rev-parse origin/HEAD', {
        cwd: mktDir,
        stdio: 'pipe',
        timeout: 2000
      }).toString().trim();

      if (latestSha !== currentSha) {
        updates.push(pluginName);
      }
    } catch (e) {
      // Skip plugins where we can't check
    }
  }

  // Write cache
  const cacheDir = path.dirname(cacheFile);
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify({
    checked_at: Date.now(),
    updates
  }));

  output(updates);
} catch (e) {
  // Silent fail - don't break session start
  process.stdout.write('{"continue":true}');
}
