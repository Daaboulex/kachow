#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// FileChanged hook: notify when project context files are modified mid-session.
// Watched files are set by cwd-changed-watcher.js via watchPaths.

const fs = require('fs');
const path = require('path');

try {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }
  const input = JSON.parse(raw);
  const cwd = input.cwd || process.cwd();
  const changedFile = input.file_path || input.tool_input?.file_path || 'unknown';

  // Log file change
  try {
    const obs = require('./lib/observability-logger.js');
    obs.logEvent(cwd, {
      type: 'context_file_changed',
      source: 'file-changed-notify',
      meta: { file: changedFile }
    });
  } catch {}

  const basename = path.basename(changedFile);
  process.stdout.write(JSON.stringify({
    continue: true,
    systemMessage: `[file-changed] ${basename} was modified externally. Re-read if you need current content.`
  }));
} catch (e) {
  try { process.stderr.write('file-changed-notify: ' + e.message + '\n'); } catch {}
  process.stdout.write('{"continue":true}');
}
