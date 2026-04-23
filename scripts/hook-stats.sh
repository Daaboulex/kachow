#!/usr/bin/env bash
# hook-stats.sh — Reports hook + skill usage analytics.
# POSIX + bash 3.2 safe. Reads:
#   ~/.claude/skill-usage.json              → skill invocation frequency
#   ~/.claude/projects/*/memory/episodic/*  → observability events
# Usage:
#   ./hook-stats.sh [--days N]   (default 7)
set -eu

DAYS="${1:-7}"
[ "$DAYS" = "--days" ] && { DAYS="${2:-7}"; }

node - "$DAYS" <<'EOF'
const fs = require('fs');
const path = require('path');
const os = require('os');

const days = parseInt(process.argv[2] || '7', 10);
const cutoff = Date.now() - days * 86400000;

// ── Skill usage ──
const skillUsagePath = path.join(os.homedir(), '.claude', 'skill-usage.json');
if (fs.existsSync(skillUsagePath)) {
  try {
    const data = JSON.parse(fs.readFileSync(skillUsagePath, 'utf8'));
    const recent = (data.sessions || []).filter(s => {
      try { return new Date(s.timestamp).getTime() >= cutoff; } catch { return false; }
    });
    const freq = {};
    for (const s of recent) {
      for (const sk of (s.skills_used || [])) freq[sk] = (freq[sk] || 0) + 1;
    }
    const rows = Object.entries(freq).sort((a, b) => b[1] - a[1]);
    console.log(`\n=== Skill usage (last ${days}d) — ${recent.length} sessions tracked of ${data.total_sessions || '?'} total ===`);
    console.log(`coverage: ${((recent.length/(data.total_sessions||1))*100).toFixed(1)}%  (tracker fires only on Skill-tool invocations)`);
    if (rows.length === 0) {
      console.log('  _no skill invocations in window_');
    } else {
      for (const [k, v] of rows.slice(0, 20)) console.log(`  ${v.toString().padStart(3)}  ${k}`);
    }
  } catch (e) { console.log('skill-usage.json parse error:', e.message); }
} else {
  console.log('no skill-usage.json');
}

// ── Episodic events ──
const projectsDir = path.join(os.homedir(), '.claude', 'projects');
const events = {};
const timings = {};
let filesRead = 0;

function walk(dir) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.isFile() && e.name.endsWith('.jsonl') && p.includes('/episodic/')) {
      try {
        const mtime = fs.statSync(p).mtimeMs;
        if (mtime < cutoff) continue;
        filesRead++;
        const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
        for (const l of lines) {
          try {
            const ev = JSON.parse(l);
            const t = new Date(ev.ts).getTime();
            if (t < cutoff) continue;
            events[ev.type] = (events[ev.type] || 0) + 1;
            // v0.2.0: type-filter prevents future non-timing events with
            // total_ms from silently contaminating the gate.
            if (ev.type === 'hook_timing' && ev.meta && typeof ev.meta.total_ms === 'number' && ev.source) {
              if (!timings[ev.source]) timings[ev.source] = { n: 0, total: 0, max: 0, samples: [] };
              timings[ev.source].n++;
              timings[ev.source].total += ev.meta.total_ms;
              timings[ev.source].max = Math.max(timings[ev.source].max, ev.meta.total_ms);
              timings[ev.source].samples.push(ev.meta.total_ms);
            }
          } catch {}
        }
      } catch {}
    }
  }
}

if (fs.existsSync(projectsDir)) walk(projectsDir);

console.log(`\n=== Observability events (last ${days}d) — ${filesRead} episodic files ===`);
const evRows = Object.entries(events).sort((a, b) => b[1] - a[1]);
if (evRows.length === 0) {
  console.log('  _no events captured_');
} else {
  for (const [k, v] of evRows) console.log(`  ${v.toString().padStart(4)}  ${k}`);
}

console.log(`\n=== Hook timing telemetry (last ${days}d) ===`);
const tRows = Object.entries(timings).sort((a, b) => (b[1].total / b[1].n) - (a[1].total / a[1].n));
if (tRows.length === 0) {
  console.log('  _no hook timing data — instrument hooks via lib/hook-timer.js_');
} else {
  console.log('  source                           n       avg       max       p95');
  for (const [src, v] of tRows) {
    const avg = (v.total / v.n).toFixed(1);
    const sorted = [...v.samples].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
    const p95 = sorted.length ? sorted[Math.max(0, idx)].toFixed(1) : 'n/a';
    const p95Mark = v.n < 10 ? `${p95}*` : p95;
    console.log(`  ${src.padEnd(30)} ${String(v.n).padStart(4)}  ${avg.padStart(6)}ms ${v.max.toFixed(1).padStart(7)}ms ${p95Mark.padStart(8)}ms`);
  }
  console.log('  * p95 with n<10 is variance-dominated; not gate-eligible');
}

// ── Orphan hooks check ──
const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
const hooksDir = path.join(os.homedir(), '.claude', 'hooks');
if (fs.existsSync(settingsPath) && fs.existsSync(hooksDir)) {
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const registered = new Set();
    const blob = JSON.stringify(settings.hooks || {});
    const re = /hooks\/([a-zA-Z0-9_-]+\.js)/g;
    let m;
    while ((m = re.exec(blob))) registered.add(m[1]);
    const statusLine = settings.statusLine && settings.statusLine.command;
    if (statusLine) {
      const m2 = statusLine.match(/hooks\/([a-zA-Z0-9_-]+\.js)/);
      if (m2) registered.add(m2[1]);
    }
    const onDisk = fs.readdirSync(hooksDir)
      .filter(f => f.endsWith('.js'))
      .filter(f => !f.includes('archive'));
    const orphans = onDisk.filter(f => !registered.has(f));
    console.log(`\n=== Hook orphans (on disk, not in settings.json) ===`);
    if (orphans.length === 0) console.log('  _none_');
    else for (const o of orphans.sort()) console.log(`  ${o}`);
  } catch {}
}
EOF
