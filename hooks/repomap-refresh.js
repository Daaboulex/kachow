#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// PostToolUse/AfterTool hook — v3 Phase E: refresh DL2 repo map on C/H writes.
//
// Fires: Write|Edit on Development-DL2/**/*.c or *.h
// Action: spawn detached `pwsh build-repomap.ps1 -Incremental -Quiet`, fire-and-forget.
// Non-blocking. Max 2s timeout (hook-level). Output to .ai-context/repomap-dl2.md.
//
// Disable: SKIP_REPOMAP=1 env var.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function passthrough() { process.stdout.write('{"continue":true}'); process.exit(0); }

try {
  if (process.env.SKIP_REPOMAP === '1') passthrough();

  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }
  const input = JSON.parse(raw || '{}');

  const tool = input.tool_name || '';
  if (tool !== 'Write' && tool !== 'Edit' && tool !== 'write_file' && tool !== 'replace') passthrough();

  const ti = input.tool_input || {};
  const filePath = ti.file_path || ti.absolute_path || ti.path || '';
  if (!filePath) passthrough();

  const norm = filePath.replace(/\\/g, '/');
  // Only fire on DL2 firmware C/H files
  if (!/\/Development-DL2\/.+\.(c|h)$/i.test(norm)) passthrough();

  const cwd = input.cwd || process.cwd();
  const script = path.join(cwd, 'Portable-Builder', 'tooling', 'build-repomap.ps1');
  if (!fs.existsSync(script)) passthrough();

  // Cooldown: don't respawn within 10s (batch edits)
  const home = process.env.HOME || process.env.USERPROFILE || require('os').homedir();
  const cacheDir = path.join(home, '.claude', 'cache');
  try { fs.mkdirSync(cacheDir, { recursive: true }); } catch {}
  const stampFile = path.join(cacheDir, `repomap-last-${require('os').hostname()}.stamp`);
  try {
    if (fs.existsSync(stampFile)) {
      const age = Date.now() - fs.statSync(stampFile).mtimeMs;
      if (age < 10 * 1000) passthrough();
    }
    fs.writeFileSync(stampFile, new Date().toISOString());
  } catch {}

  const isWindows = process.platform === 'win32';
  try {
    const child = spawn('pwsh', ['-NoProfile', '-File', script, '-Incremental', '-Quiet'], {
      detached: true,
      stdio: 'ignore',
      shell: isWindows,
      cwd,
    });
    child.on('error', () => {});
    child.unref();

    try {
      require('./lib/observability-logger.js').logEvent(cwd, {
        type: 'repomap_refresh',
        source: 'repomap-refresh',
        meta: { trigger_file: path.basename(norm) },
      });
    } catch {}
  } catch {}

  passthrough();
} catch { passthrough(); }
