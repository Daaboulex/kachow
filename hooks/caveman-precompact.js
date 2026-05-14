#!/usr/bin/env node
// caveman-precompact.js — PreCompact hook
// Sets a marker so the next UserPromptSubmit re-injects full caveman ruleset.
// Why: after compaction, SessionStart context (with full caveman rules) is lost.
// The UserPromptSubmit anchor is too small to fully restore behavior.

const fs = require('fs');
const path = require('path');
const os = require('os');

const { toolHomeDir } = require('./lib/tool-detect.js');
const claudeDir = process.env.CLAUDE_CONFIG_DIR || toolHomeDir();
const flagPath = path.join(claudeDir, '.caveman-active');
const markerPath = path.join(claudeDir, '.caveman-reactivate');

try {
  // Only set marker if caveman is actually active
  if (fs.existsSync(flagPath)) {
    const mode = fs.readFileSync(flagPath, 'utf8').trim();
    if (mode && mode !== 'off') {
      fs.writeFileSync(markerPath, mode);
    }
  }
} catch {}

// Allow compaction to proceed
process.stdout.write('{"continue":true}');
