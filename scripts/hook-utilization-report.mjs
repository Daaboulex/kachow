#!/usr/bin/env node
// hook-utilization-report.mjs
// Produce per-hook utilization analytics from hook_timing observability events.
//
// Reads:
//   ~/.claude/projects/*/memory/episodic/*.jsonl   — episodic event log
//
// Writes:
//   stdout: human markdown report
//   --json flag: structured JSON for programmatic triage
//   --days N: time window (default 7)
//
// Triage thresholds (flagged in report):
//   - p95 > 100ms        → "slow"
//   - error_rate > 5%    → "error-prone"
//   - count_24h > 1000   → "hot"

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOME = homedir();
const JSON_OUT = process.argv.includes('--json');

function getArg(name, defaultVal) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return defaultVal;
  return process.argv[idx + 1] ?? defaultVal;
}

const WINDOW_DAYS = parseInt(getArg('--days', '7'), 10);
const SHOW_ALL = process.argv.includes('--all');

function getTelemetryEpochMs() {
  try {
    const epoch = JSON.parse(readFileSync(join(HOME, '.ai-context', 'telemetry-epoch.json'), 'utf8'));
    const ts = Date.parse(epoch.cutoff_ts || epoch.timestamp || '');
    return Number.isFinite(ts) ? ts : 0;
  } catch {
    return 0;
  }
}

function safeReaddir(p) {
  try { return readdirSync(p, { withFileTypes: true }); } catch { return []; }
}

// Find all episodic jsonl files across all project memory dirs
function findEpisodicFiles() {
  const roots = [
    join(HOME, '.ai-context', 'project-state'),  // new centralized path
    join(HOME, '.claude', 'projects'),            // old path (historical fallback)
  ];
  const files = [];
  for (const projectsRoot of roots) {
    for (const project of safeReaddir(projectsRoot)) {
      if (!project.isDirectory()) continue;
      const epDir = join(projectsRoot, project.name, 'memory', 'episodic');
      if (!existsSync(epDir)) continue;
      for (const f of safeReaddir(epDir)) {
        if (f.isFile() && f.name.endsWith('.jsonl')) {
          files.push(join(epDir, f.name));
        }
      }
    }
  }
  return files;
}

// Parse jsonl, return hook_timing events within time window
function loadEvents(files, cutoffMs) {
  const events = [];
  for (const fp of files) {
    let raw;
    try { raw = readFileSync(fp, 'utf8'); } catch { continue; }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let evt;
      try { evt = JSON.parse(line); } catch { continue; }
      if (evt.type !== 'hook_timing') continue;
      if (!evt.source) continue;
      const ts = Date.parse(evt.ts || 0);
      if (!ts || ts < cutoffMs) continue;
      events.push(evt);
    }
  }
  return events;
}

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return 0;
  const idx = Math.min(sortedArr.length - 1, Math.floor((p / 100) * sortedArr.length));
  return sortedArr[idx];
}

function aggregateBySource(events) {
  const bySource = new Map();
  for (const e of events) {
    const s = e.source;
    if (!bySource.has(s)) {
      bySource.set(s, {
        source: s,
        count: 0,
        count_24h: 0,
        errors: 0,
        timings: [],
        last_seen: 0,
        first_seen: Infinity,
        hosts: new Set(),
      });
    }
    const agg = bySource.get(s);
    agg.count++;
    const ts = Date.parse(e.ts);
    if (ts > Date.now() - 24 * 3600 * 1000) agg.count_24h++;
    if (ts > agg.last_seen) agg.last_seen = ts;
    if (ts < agg.first_seen) agg.first_seen = ts;
    if (e.host) agg.hosts.add(e.host);
    const exit_code = e.meta?.exit_code ?? e.payload?.exit_code;
    const total_ms = e.meta?.total_ms ?? e.payload?.total_ms;
    if (exit_code !== 0 && exit_code !== undefined) agg.errors++;
    if (typeof total_ms === 'number') agg.timings.push(total_ms);
  }
  return bySource;
}

function flag(agg) {
  const flags = [];
  const p95 = percentile([...agg.timings].sort((a, b) => a - b), 95);
  const error_rate = agg.count > 0 ? agg.errors / agg.count : 0;
  if (p95 > 100) flags.push('SLOW');
  if (error_rate > 0.05) flags.push('ERROR-PRONE');
  if (agg.count_24h > 1000) flags.push('HOT');
  return flags;
}

function fmt(agg) {
  const sorted = [...agg.timings].sort((a, b) => a - b);
  return {
    source: agg.source,
    count: agg.count,
    count_24h: agg.count_24h,
    p50_ms: +percentile(sorted, 50).toFixed(2),
    p95_ms: +percentile(sorted, 95).toFixed(2),
    p99_ms: +percentile(sorted, 99).toFixed(2),
    max_ms: +(sorted[sorted.length - 1] || 0).toFixed(2),
    error_rate: +(agg.count > 0 ? agg.errors / agg.count : 0).toFixed(4),
    error_count: agg.errors,
    last_seen: new Date(agg.last_seen).toISOString().slice(0, 19) + 'Z',
    hosts: [...agg.hosts],
    flags: flag(agg),
  };
}

// ── Main ──
const cutoffMs = Date.now() - WINDOW_DAYS * 24 * 3600 * 1000;
const epochMs = getTelemetryEpochMs();
const effectiveCutoffMs = Math.max(cutoffMs, epochMs);
const files = findEpisodicFiles();
const events = loadEvents(files, effectiveCutoffMs);
const bySource = aggregateBySource(events);

const rows = [...bySource.values()]
  .map(fmt)
  .sort((a, b) => b.count - a.count);

const flagged = rows.filter(r => r.flags.length > 0);

const summary = {
  window_days: WINDOW_DAYS,
  cutoff: new Date(cutoffMs).toISOString(),
  telemetry_epoch_cutoff: epochMs ? new Date(epochMs).toISOString() : null,
  effective_cutoff: new Date(effectiveCutoffMs).toISOString(),
  generated_at: new Date().toISOString(),
  episodic_files_scanned: files.length,
  total_events: events.length,
  unique_sources: bySource.size,
  flagged_count: flagged.length,
};

if (JSON_OUT) {
  console.log(JSON.stringify({ summary, hooks: rows, flagged }, null, 2));
  process.exit(0);
}

// ── Markdown report ──
console.log(`# Hook Utilization Report`);
console.log('');
console.log(`Generated: ${summary.generated_at}`);
console.log(`Window: last ${WINDOW_DAYS}d (since ${summary.cutoff})`);
if (summary.telemetry_epoch_cutoff) {
  console.log(`Telemetry epoch: ${summary.telemetry_epoch_cutoff} (effective since ${summary.effective_cutoff})`);
}
console.log(`Sources: ${summary.unique_sources} unique • Events: ${summary.total_events} • Episodic files: ${summary.episodic_files_scanned}`);
console.log('');

if (flagged.length > 0) {
  console.log(`## Triage (${flagged.length} flagged)`);
  console.log('');
  console.log(`| Source | Flags | Count (${WINDOW_DAYS}d) | 24h | p50 | p95 | p99 | err_rate | last seen |`);
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const r of flagged) {
    console.log(`| ${r.source} | ${r.flags.join(', ')} | ${r.count} | ${r.count_24h} | ${r.p50_ms}ms | ${r.p95_ms}ms | ${r.p99_ms}ms | ${(r.error_rate * 100).toFixed(2)}% | ${r.last_seen} |`);
  }
  console.log('');
}

console.log(`## All hooks${SHOW_ALL ? '' : ' (top 30 by count, --all for full list)'}`);
console.log('');
console.log(`| Source | Count | 24h | p50 | p95 | p99 | max | err_rate | hosts | last seen |`);
console.log('|---|---|---|---|---|---|---|---|---|---|');

const display = SHOW_ALL ? rows : rows.slice(0, 30);
for (const r of display) {
  console.log(`| ${r.source} | ${r.count} | ${r.count_24h} | ${r.p50_ms}ms | ${r.p95_ms}ms | ${r.p99_ms}ms | ${r.max_ms}ms | ${(r.error_rate * 100).toFixed(2)}% | ${r.hosts.length} | ${r.last_seen} |`);
}

if (!SHOW_ALL && rows.length > 30) {
  console.log('');
  console.log(`_${rows.length - 30} more hooks not shown — use \`--all\` to view all._`);
}

console.log('');
console.log('## Triage thresholds');
console.log('');
console.log('- **SLOW**: p95 > 100ms');
console.log('- **ERROR-PRONE**: error_rate > 5%');
console.log('- **HOT**: count_24h > 1000');
console.log('');
console.log('Run with `--json` for programmatic output. `--days N` to change window. `--all` to list every hook.');
