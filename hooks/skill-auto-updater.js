#!/usr/bin/env node
// skill-auto-updater.js — Stop hook (async)
// Auto-updates Claude plugins + syncs portable skills to Codex.
// 24h cooldown. Runs silently at session end.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const home = os.homedir();
const claudeDir = path.join(home, '.claude');
const codexSkills = path.join(home, '.codex', 'skills');
const cooldownFile = path.join(claudeDir, 'cache', 'skill-auto-update-last.json');
const logFile = path.join(home, '.ai-context', 'instances', 'skill-auto-updates.jsonl');
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

function run(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf8', timeout: 30000, stdio: 'pipe' }).trim();
  } catch { return null; }
}

function log(entry) {
  try {
    const dir = path.dirname(logFile);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(logFile, JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + '\n');
  } catch {}
}

try {
  // Cooldown check
  try {
    if (fs.existsSync(cooldownFile)) {
      const cache = JSON.parse(fs.readFileSync(cooldownFile, 'utf8'));
      if (Date.now() - (cache.last_run || 0) < COOLDOWN_MS) {
        process.stdout.write('{}');
        process.exit(0);
      }
    }
  } catch {}

  const updated = [];
  const failed = [];

  // Phase 1: Check plugin update cache for pending updates
  const updateCacheFile = path.join(claudeDir, 'cache', 'plugin-update-check.json');
  let pendingPlugins = [];
  try {
    if (fs.existsSync(updateCacheFile)) {
      const cache = JSON.parse(fs.readFileSync(updateCacheFile, 'utf8'));
      pendingPlugins = cache.updates || [];
    }
  } catch {}

  // Phase 2: Update each pending plugin
  // plugin-update-checker stores short names; claude plugin update needs qualified names
  let installedMap = {};
  try {
    const instPath = path.join(claudeDir, 'plugins', 'installed_plugins.json');
    const inst = JSON.parse(fs.readFileSync(instPath, 'utf8'));
    for (const fullName of Object.keys(inst.plugins || {})) {
      const short = fullName.split('@')[0];
      installedMap[short] = fullName;
    }
  } catch {}

  for (const pluginName of pendingPlugins) {
    const qualifiedName = installedMap[pluginName] || pluginName;
    const result = run(`claude plugin update ${qualifiedName}`, home);
    if (result && !result.includes('Failed') && !result.includes('not found')) {
      updated.push(pluginName);
    } else {
      failed.push(pluginName);
    }
  }

  // Phase 3: Sync portable skills to Codex
  // Only sync skills from the KEEP list (spec §17)
  if (fs.existsSync(codexSkills)) {
    // Final 25 Codex-portable skills (audited 2026-04-28, spec §17)
    const PORTABLE_CE = [
      'ce-brainstorm', 'ce-clean-gone-branches', 'ce-commit', 'ce-commit-push-pr',
      'ce-debug', 'ce-plan', 'ce-pr-description', 'ce-resolve-pr-feedback',
      'ce-work', 'ce-worktree',
    ];
    const PORTABLE_CAVEMAN = [
      'caveman', 'caveman-commit', 'caveman-compress', 'caveman-help', 'caveman-review',
    ];
    const PORTABLE_OTHER = [
      'debt-tracker', 'excalidraw', 'verification-before-completion',
    ];
    const PORTABLE_GSD = [
      'gsd-do', 'gsd-fast', 'gsd-quick', 'gsd-note', 'gsd-progress',
      'gsd-add-todo', 'gsd-check-todos',
    ];

    const ALL_PORTABLE = [
      ...PORTABLE_CE, ...PORTABLE_CAVEMAN,
      ...PORTABLE_OTHER, ...PORTABLE_GSD,
    ];

    let synced = 0;
    // Source: Claude user skills
    const claudeSkills = path.join(claudeDir, 'skills');
    // Source: Claude plugin skills (installed cache)
    const pluginCache = path.join(claudeDir, 'plugins', 'cache');

    for (const skillName of ALL_PORTABLE) {
      const codexDest = path.join(codexSkills, skillName);
      const codexSkillMd = path.join(codexDest, 'SKILL.md');

      // Find source: try Claude skills dir first, then plugin cache
      let srcSkillMd = path.join(claudeSkills, skillName, 'SKILL.md');
      if (!fs.existsSync(srcSkillMd)) {
        // Search plugin cache
        try {
          const found = execSync(
            `find "${pluginCache}" -maxdepth 5 -path "*/${skillName}/SKILL.md" -print -quit 2>/dev/null`,
            { encoding: 'utf8', timeout: 3000 }
          ).trim();
          if (found) srcSkillMd = found;
        } catch {}
      }

      if (!fs.existsSync(srcSkillMd)) continue;

      // Compare content — only sync if different
      try {
        const srcContent = fs.readFileSync(srcSkillMd, 'utf8');
        const dstContent = fs.existsSync(codexSkillMd) ? fs.readFileSync(codexSkillMd, 'utf8') : '';
        if (srcContent !== dstContent) {
          const srcDir = path.dirname(srcSkillMd);
          // Copy entire skill directory
          run(`cp -r "${srcDir}" "${codexDest}"`, home);
          synced++;
        }
      } catch {}
    }

    if (synced > 0) {
      log({ action: 'codex-skill-sync', synced });
    }
  }

  // Write cooldown marker
  try {
    const dir = path.dirname(cooldownFile);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(cooldownFile, JSON.stringify({
      last_run: Date.now(),
      updated,
      failed,
    }));
  } catch {}

  // Clear update cache if all succeeded
  if (updated.length > 0 && failed.length === 0) {
    try {
      fs.writeFileSync(updateCacheFile, JSON.stringify({ checked_at: Date.now(), updates: [] }));
    } catch {}
  }

  if (updated.length > 0 || failed.length > 0) {
    log({ action: 'plugin-update', updated, failed });
  }

  process.stdout.write('{}');
} catch (e) {
  try { process.stderr.write('skill-auto-updater: ' + e.message + '\n'); } catch {}
  process.stdout.write('{}');
}
