#!/usr/bin/env node
// validate-symlinks.js
// SessionStart hook. Runs recursive symlink audit across every AI-tool surface.
// Non-fatal (always exits 0), but emits a warning banner + JSONL event if any
// live-broken symlink is found so they don't rot silently.
//
// Library: ~/.claude/hooks/lib/symlink-audit.js handles the discovery +
// classification. This hook only formats output and logs.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const audit = require('./lib/symlink-audit.js');

const HOME = os.homedir();
const NOTIF = path.join(HOME, '.claude', '.notifications.jsonl');

function main() {
  let report;
  try { report = audit.auditAll(); } catch (e) {
    process.stderr.write(`validate-symlinks: ${e.message}\n`);
    process.exit(0);
  }

  const broken = report.broken_live;
  const loops = report.loops;
  const errors = report.errors;

  if (broken.length === 0 && loops.length === 0 && errors.length === 0) {
    process.exit(0);  // silent when healthy
  }

  const lines = [];
  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('⚠  SYMLINK ISSUES DETECTED (validate-symlinks.js)');
  lines.push('═══════════════════════════════════════════════════════════');
  if (broken.length > 0) {
    lines.push(`${broken.length} broken live symlink(s):`);
    for (const b of broken.slice(0, 10)) lines.push(`  ✗ ${b.path}`);
    if (broken.length > 10) lines.push(`  (+${broken.length - 10} more — run 'node ~/.claude/hooks/lib/symlink-audit.js' for full list)`);
  }
  if (loops.length > 0) {
    lines.push(`${loops.length} symlink loop(s):`);
    for (const l of loops.slice(0, 5)) lines.push(`  ↻ ${l.path}`);
  }
  if (errors.length > 0) {
    lines.push(`${errors.length} read error(s):`);
    for (const e of errors.slice(0, 5)) lines.push(`  ! ${e.path}: ${e.error}`);
  }
  lines.push('');
  lines.push('Fix: restore targets, or remove stale symlinks.');
  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('');
  console.log(lines.join('\n'));

  try {
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      type: 'broken_symlinks',
      broken_count: broken.length,
      loop_count: loops.length,
      error_count: errors.length,
      broken_paths: broken.map(b => b.path),
    }) + '\n';
    fs.appendFileSync(NOTIF, entry);
  } catch {}

  process.exit(0);
}

try { main(); } catch (e) {
  try { process.stderr.write(`validate-symlinks fatal: ${e.message}\n`); } catch {}
  process.exit(0);
}

module.exports.selftest = () => ({
  event: 'SessionStart',
  matcher: '*',
  tests: [
    {
      name: 'exits 0 (silent when healthy)',
      stdin: JSON.stringify({}),
      expect: { exit: 0 }
    }
  ]
});
