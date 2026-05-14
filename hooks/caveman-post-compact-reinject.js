#!/usr/bin/env node
// caveman-post-compact-reinject.js — UserPromptSubmit hook
// After compaction, re-injects full caveman ruleset via additionalContext.
// Detects compaction via .caveman-reactivate marker (set by PreCompact hook).
// One-shot: clears marker after injection.

const fs = require('fs');
const path = require('path');
const os = require('os');

const { toolHomeDir } = require('./lib/tool-detect.js');
const claudeDir = process.env.CLAUDE_CONFIG_DIR || toolHomeDir();
const markerPath = path.join(claudeDir, '.caveman-reactivate');

let stdin = '';
process.stdin.on('data', c => { stdin += c; });
process.stdin.on('end', () => {
  try {
    // No marker = no compaction happened, passthrough
    if (!fs.existsSync(markerPath)) {
      process.stdout.write('{"continue":true}');
      return;
    }

    const mode = fs.readFileSync(markerPath, 'utf8').trim();
    if (!mode || mode === 'off') {
      try { fs.unlinkSync(markerPath); } catch {}
      process.stdout.write('{"continue":true}');
      return;
    }

    // Read SKILL.md from caveman plugin (same logic as caveman-activate.js)
    const pluginCacheBase = path.join(claudeDir, 'plugins', 'cache', 'caveman', 'caveman');
    let skillContent = '';
    try {
      // Find latest installed version
      const versions = fs.readdirSync(pluginCacheBase)
        .filter(d => fs.statSync(path.join(pluginCacheBase, d)).isDirectory())
        .sort()
        .reverse();
      if (versions.length > 0) {
        skillContent = fs.readFileSync(
          path.join(pluginCacheBase, versions[0], 'skills', 'caveman', 'SKILL.md'), 'utf8'
        );
      }
    } catch {}

    if (!skillContent) {
      // Fallback: minimal ruleset
      const ctx = `CAVEMAN MODE RE-ACTIVATED after context compaction — level: ${mode}.\n` +
        'Drop articles/filler/pleasantries/hedging. Fragments OK. ' +
        'Code/commits/security: write normal.';
      process.stdout.write(JSON.stringify({ continue: true, additionalContext: ctx }));
      try { fs.unlinkSync(markerPath); } catch {}
      return;
    }

    // Strip YAML frontmatter
    const body = skillContent.replace(/^---[\s\S]*?---\s*/, '');

    // Filter to active level (simplified — keep header + matching rows)
    const modeLabel = mode === 'wenyan' ? 'wenyan-full' : mode;
    const lines = body.split('\n');
    const filtered = lines.filter(line => {
      const tableRowMatch = line.match(/^\|\s*\*\*(\S+?)\*\*\s*\|/);
      if (tableRowMatch) return tableRowMatch[1] === modeLabel;
      const exampleMatch = line.match(/^- (\S+?):\s/);
      if (exampleMatch) return exampleMatch[1] === modeLabel || exampleMatch[1] === 'full';
      return true;
    });

    const ctx = `CAVEMAN MODE RE-ACTIVATED after context compaction — level: ${mode}\n\n` +
      filtered.join('\n');

    process.stdout.write(JSON.stringify({ continue: true, additionalContext: ctx }));
    // Clear marker — one-shot reactivation
    try { fs.unlinkSync(markerPath); } catch {}
  } catch {
    process.stdout.write('{"continue":true}');
  }
});
