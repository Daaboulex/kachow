#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// PostToolUse hook: After a git commit in a dual-remote project, remind to sync.
// Detects dual-remote projects by trait (sync script exists), not by project name.
// Cross-platform (Linux, macOS, Windows).

const fs = require('fs');
const path = require('path');

function findProjectRoot(dir) {
  // Walk up to find a directory with [tooling-dir]/git/sync-repositories.ps1
  const home = require('os').homedir();
  let d = dir;
  while (d.length >= home.length) {
    const syncScript = path.join(d, '[tooling-dir]', 'git', 'sync-repositories.ps1');
    if (fs.existsSync(syncScript)) return d;
    const parent = path.dirname(d);
    if (parent === d) break;
    d = parent;
  }
  return null;
}

try {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }
  const input = JSON.parse(raw);

  // Normalize tool names (Gemini: run_shell_command → Bash)
  const TOOL_NORM = { write_file: 'Write', replace: 'Edit', run_shell_command: 'Bash', read_file: 'Read', activate_skill: 'Skill' };
  const toolName = TOOL_NORM[input.tool_name] || input.tool_name || '';
  if (toolName !== 'Bash') {
    process.stdout.write('{"continue":true}');
    process.exit(0);
  }

  const cmd = (input.tool_input || {}).command || '';
  const cwd = input.cwd || process.cwd();

  // Only trigger on git commit commands
  if (!cmd.match(/git\s+commit/)) {
    process.stdout.write('{"continue":true}');
    process.exit(0);
  }

  // Detect dual-remote project by trait: sync-repositories.ps1 exists
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) {
    process.stdout.write('{"continue":true}');
    process.exit(0);
  }

  process.stdout.write(JSON.stringify({
    continue: true,
    systemMessage: 'Commit done. Remember: this repo uses dual-remote sync (SSD + Server). Run `pwsh [tooling-dir]/git/sync-repositories.ps1 -Interactive` to persist across machines.'
  }));
} catch (e) {
  process.stderr.write('post-commit-sync-reminder: ' + e.message + '\n');
  process.stdout.write('{"continue":true}');
}
