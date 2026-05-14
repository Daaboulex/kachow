#!/usr/bin/env node
require(__dirname + '/lib/safety-timeout.js');
// Modular SessionStart side-effects — runs lifecycle checks, counters, cleanup.
// Can be called standalone OR imported by session-context-loader.
// When imported: exports runSections(ctx) which appends to ctx.messages.
// When standalone: reads stdin, outputs JSON (backward compat).

const fs = require('fs');
const path = require('path');
const os = require('os');
const { detectTool, toolHomeDir } = require('./lib/tool-detect.js');

const SECTIONS = [
  ['reflect-enabled', './lib/session-start/reflect-enabled'],
  ['stale-lock-cleanup', './lib/session-start/stale-lock-cleanup'],
  ['consolidate-counter', './lib/session-start/consolidate-counter'],
  ['handoff-retention', './lib/session-start/handoff-retention'],
  ['stale-task-cleanup', './lib/session-start/stale-task-cleanup'],
  ['project-provisioning', './lib/session-start/project-provisioning'],
  ['session-catchup', './lib/session-start/session-catchup'],
  ['version-change', './lib/session-start/version-change'],
  ['research-counter', './lib/session-start/research-counter'],
  ['settings-drift', './lib/session-start/settings-drift'],
  ['symlink-integrity', './lib/session-start/symlink-integrity'],
];

function runSections(ctx) {
  // Stale subagent marker sweep
  try {
    const markerDir = path.join(ctx.configDir, 'cache', 'subagent-active');
    if (fs.existsSync(markerDir)) {
      const cutoff = Date.now() - 86400000;
      for (const name of fs.readdirSync(markerDir)) {
        if (!name.endsWith('.json')) continue;
        const p = path.join(markerDir, name);
        try { if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p); } catch {}
      }
    }
  } catch {}

  for (const [name, modPath] of SECTIONS) {
    try {
      require(modPath)(ctx);
    } catch (e) {
      ctx.errors = ctx.errors || [];
      ctx.errors.push({ section: name, error: e.message });
    }
  }

  if (ctx.errors && ctx.errors.length > 0) {
    ctx.messages.push(`[session-start] ${ctx.errors.length} section(s) failed: ${ctx.errors.map(e => e.section).join(', ')}`);
  }
}

// Export for use by session-context-loader
module.exports = { runSections };

// Standalone mode: if run directly (not require'd)
if (require.main === module) {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }

  const ctx = {
    home: os.homedir(),
    tool: detectTool(),
    configDir: toolHomeDir(),
    projectDir: process.cwd(),
    messages: [],
    errors: [],
  };

  try { require('./lib/observability-logger.js').logEvent(ctx.projectDir, { type: 'session_start', source: 'session-start-combined', agent: ctx.tool }); } catch {}

  runSections(ctx);

  if (ctx.messages.length > 0) {
    process.stdout.write(JSON.stringify({ continue: true, systemMessage: ctx.messages.join('\n') }));
  } else {
    process.stdout.write('{"continue":true}');
  }
}
