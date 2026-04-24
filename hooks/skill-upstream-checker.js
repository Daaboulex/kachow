#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// SessionStart hook: check upstream skill repos for updates (7-day cooldown)
// Non-blocking: network failure = silent skip
// Cross-platform: uses Node.js https instead of curl

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const home = os.homedir();
const skillDirs = [
  path.join(home, '.claude', 'skills'),
  path.join(home, '.gemini', 'skills'),
];
const COOLDOWN_DAYS = 7;

function httpsGet(url) {
  return new Promise((resolve) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'skill-upstream-checker' },
      timeout: 5000
    }, (res) => {
      // Follow redirects (GitHub API returns 30x)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpsGet(res.headers.location).then(resolve);
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function checkSkill(skillDir) {
  const sourcesFile = path.join(skillDir, '.upstream-sources.json');
  if (!fs.existsSync(sourcesFile)) return null;

  let sources;
  try {
    sources = JSON.parse(fs.readFileSync(sourcesFile, 'utf8'));
  } catch { return null; }

  const lastChecked = new Date(sources.lastChecked || 0);
  const daysSince = (Date.now() - lastChecked.getTime()) / (1000 * 60 * 60 * 24);

  if (daysSince < COOLDOWN_DAYS) return null;

  const updates = [];
  let changed = false;

  for (const src of sources.sources || []) {
    const match = (src.repo || '').match(/github\.com\/([^/]+)\/([^/.]+)/);
    if (!match) continue;
    const owner = match[1];
    const repo = match[2];

    const data = await httpsGet(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=1`);
    if (!data || !Array.isArray(data) || !data[0]) continue;

    const latestSha = data[0].sha;
    if (latestSha && latestSha !== src.sha) {
      if (src.sha !== 'unknown') {
        updates.push(`${src.name}`);
      }
      src.sha = latestSha;
      changed = true;
    }
  }

  sources.lastChecked = new Date().toISOString().split('T')[0];

  try {
    fs.writeFileSync(sourcesFile, JSON.stringify(sources, null, 2));
    // Also update the other agent's copy if it exists
    const otherBase = skillDir.includes('.claude') ? '.gemini' : '.claude';
    const otherFile = sourcesFile.replace(/\.(claude|gemini)/, otherBase);
    if (fs.existsSync(path.dirname(otherFile))) {
      fs.writeFileSync(otherFile, JSON.stringify(sources, null, 2));
    }
  } catch {}

  return updates.length > 0 ? updates : null;
}

(async () => {
  try {
    let raw = '';
    try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }

    // Deduplicate skill dirs (in case both point to same skill via symlinks)
    const seen = new Set();
    const allUpdates = [];

    for (const base of skillDirs) {
      if (!fs.existsSync(base)) continue;
      for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const skillPath = path.join(base, entry.name);
        const realPath = fs.realpathSync(skillPath);
        if (seen.has(realPath)) continue;
        seen.add(realPath);

        const updates = await checkSkill(skillPath);
        if (updates) allUpdates.push(...updates);
      }
    }

    if (allUpdates.length > 0) {
      process.stdout.write(JSON.stringify({
        continue: true,
        systemMessage: `[skill-updates] Upstream changes available for: ${allUpdates.join(', ')}. Review changes at the source repos and manually merge improvements you want. Your customizations are preserved — upstream updates are never auto-applied.`
      }));
    } else {
      process.stdout.write('{"continue":true}');
    }
  } catch (e) {
    process.stderr.write('skill-upstream-checker: ' + e.message + '\n');
    process.stdout.write('{"continue":true}');
  }
})();
