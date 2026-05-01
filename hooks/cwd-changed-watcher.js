#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// CwdChanged hook: set up file watches for project-specific context files.
// Returns watchPaths so FileChanged monitors CLAUDE.md, AGENTS.md, .envrc.

const fs = require('fs');
const path = require('path');

try {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }
  const input = JSON.parse(raw);
  const cwd = input.cwd || process.cwd();

  // Discover which context files exist in the new directory
  const watchCandidates = [
    'CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.envrc',
    '.claude/CLAUDE.md', '.ai-context/AGENTS.md',
  ];

  const watchPaths = watchCandidates
    .filter(f => fs.existsSync(path.join(cwd, f)))
    .map(f => path.join(cwd, f));

  // Log directory change
  try {
    const obs = require('./lib/observability-logger.js');
    obs.logEvent(cwd, {
      type: 'cwd_changed',
      source: 'cwd-changed-watcher',
      meta: { new_cwd: cwd, watch_count: watchPaths.length }
    });
  } catch {}

  if (watchPaths.length > 0) {
    process.stdout.write(JSON.stringify({
      continue: true,
      watchPaths: watchPaths
    }));
  } else {
    process.stdout.write('{"continue":true}');
  }
} catch (e) {
  try { process.stderr.write('cwd-changed-watcher: ' + e.message + '\n'); } catch {}
  process.stdout.write('{"continue":true}');
}
