#!/usr/bin/env node
// symlink-audit.js — recursive scanner for symlink health.
//
// Scans all relevant surfaces, classifies each symlink, reports problems.
// No hardcoded list of "known" symlinks — everything is discovered.
//
// Classifications:
//   OK              — symlink resolves to an existing file/dir
//   BROKEN          — target does not exist
//   LOOP            — symlink loop detected
//   NIX_EPHEMERAL   — target is /nix/store/* path (expected for home-manager)
//   ARCHIVED        — inside an archive/ directory; broken OK (not a live symlink)
//
// Usage (CLI):
//   node symlink-audit.js                 → scan + print human-readable report
//   node symlink-audit.js --json          → JSON output for machine consumption
//   node symlink-audit.js --only-broken   → only list broken live links
//   node symlink-audit.js --exit-on-broken → exit 1 if any live-broken found
//
// Library usage (inside hooks):
//   const { auditAll } = require('./lib/symlink-audit.js');
//   const report = auditAll();   // returns { surfaces: [...], broken_live: [...] }

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();

// Surfaces to scan (added to a scan root list — any other dir beneath is walked).
const SURFACES = [
  path.join(HOME, '.ai-context'),
  path.join(HOME, '.claude'),
  path.join(HOME, '.gemini'),
  path.join(HOME, '.codex'),
  path.join(HOME, '.config', 'opencode'),
  path.join(HOME, '.config', 'aider'),
];

// Path segment exclusions — these dirs are walked into BUT their broken
// symlinks are tagged ARCHIVED (not live-broken).
const ARCHIVED_SEGMENTS = [
  '/projects/.archive-',   // per-cwd session archives
  '/memory/archive/',
  '/hooks/archive/',
  '/archive/',
];

// Path segment exclusions — don't descend into these at all (transient state).
const SKIP_SEGMENTS = [
  '/.stversions/',
  '/file-history/',
  '/cache/',
  '/.git/',
  '/plugins/marketplaces/',  // plugin-managed; their symlinks are their concern
  '/paste-cache/',
  '/sessions/',
  '/shell-snapshots/',
  '/backups/',
  '/node_modules/',
  '/.pytest_cache/',
  '/.venv/',
  '/projects/',
  '/data/',
  '/get-shit-done/',
  '/marketplaces/',
];

function shouldSkip(p) {
  return SKIP_SEGMENTS.some(seg => p.includes(seg));
}
function isArchived(p) {
  return ARCHIVED_SEGMENTS.some(seg => p.includes(seg));
}

function walkSymlinks(root, out = []) {
  let st;
  try { st = fs.lstatSync(root); } catch { return out; }
  if (st.isSymbolicLink()) {
    out.push(root);
    return out;
  }
  if (!st.isDirectory()) return out;
  let entries;
  try { entries = fs.readdirSync(root); } catch { return out; }
  for (const e of entries) {
    const child = path.join(root, e);
    if (shouldSkip(child)) continue;
    walkSymlinks(child, out);
  }
  return out;
}

function classify(linkPath) {
  let linkTarget;
  try { linkTarget = fs.readlinkSync(linkPath); } catch (e) {
    return { path: linkPath, target: null, status: 'READ_ERROR', error: e.message };
  }
  // Resolve relative to the link's directory
  const absTarget = path.isAbsolute(linkTarget)
    ? linkTarget
    : path.resolve(path.dirname(linkPath), linkTarget);

  // Check for loop / broken via stat (follows link).
  try {
    fs.statSync(linkPath);  // follows the link
  } catch (e) {
    if (e.code === 'ELOOP') {
      return { path: linkPath, target: linkTarget, abs_target: absTarget, status: 'LOOP' };
    }
    // ENOENT — target missing
    let status = 'BROKEN';
    if (isArchived(linkPath)) status = 'ARCHIVED';
    return { path: linkPath, target: linkTarget, abs_target: absTarget, status };
  }
  // Target resolves. Subclassify.
  if (absTarget.startsWith('/nix/store/')) {
    return { path: linkPath, target: linkTarget, abs_target: absTarget, status: 'NIX_EPHEMERAL' };
  }
  return { path: linkPath, target: linkTarget, abs_target: absTarget, status: 'OK' };
}

function auditAll() {
  const all = [];
  for (const surface of SURFACES) {
    const links = walkSymlinks(surface);
    for (const l of links) all.push(classify(l));
  }
  const broken_live   = all.filter(r => r.status === 'BROKEN');
  const broken_arch   = all.filter(r => r.status === 'ARCHIVED');
  const loops         = all.filter(r => r.status === 'LOOP');
  const nix_eph       = all.filter(r => r.status === 'NIX_EPHEMERAL');
  const ok            = all.filter(r => r.status === 'OK');
  const errors        = all.filter(r => r.status === 'READ_ERROR');
  return {
    generated_at: new Date().toISOString(),
    surfaces_scanned: SURFACES,
    summary: {
      total: all.length,
      ok: ok.length,
      broken_live: broken_live.length,
      broken_archived: broken_arch.length,
      loops: loops.length,
      nix_ephemeral: nix_eph.length,
      read_errors: errors.length,
    },
    broken_live,
    loops,
    errors,
    all,
  };
}

function printReport(report) {
  const s = report.summary;
  console.log('══ symlink audit ══');
  console.log(`  total:          ${s.total}`);
  console.log(`  ok:             ${s.ok}`);
  console.log(`  broken (live):  ${s.broken_live}${s.broken_live > 0 ? ' ⚠' : ''}`);
  console.log(`  broken (arch):  ${s.broken_archived}`);
  console.log(`  loops:          ${s.loops}${s.loops > 0 ? ' ⚠' : ''}`);
  console.log(`  nix-ephemeral:  ${s.nix_ephemeral}`);
  console.log(`  read-errors:    ${s.read_errors}${s.read_errors > 0 ? ' ⚠' : ''}`);
  console.log('');
  if (s.broken_live > 0) {
    console.log('── BROKEN LIVE SYMLINKS ──');
    for (const b of report.broken_live) console.log(`  ✗ ${b.path}\n    → ${b.target}`);
    console.log('');
  }
  if (s.loops > 0) {
    console.log('── SYMLINK LOOPS ──');
    for (const l of report.loops) console.log(`  ↻ ${l.path} → ${l.target}`);
    console.log('');
  }
  if (s.read_errors > 0) {
    console.log('── READ ERRORS ──');
    for (const e of report.errors) console.log(`  ! ${e.path}: ${e.error}`);
    console.log('');
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const report = auditAll();
  if (args.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else if (args.includes('--only-broken')) {
    for (const b of report.broken_live) console.log(`${b.path} → ${b.target}`);
  } else {
    printReport(report);
  }
  if (args.includes('--exit-on-broken') && report.summary.broken_live > 0) {
    process.exit(1);
  }
}

module.exports = { auditAll, classify, walkSymlinks, SURFACES };
