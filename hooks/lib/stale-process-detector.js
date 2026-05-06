// stale-process-detector.js
// Detects orphaned shells, stale task output files, and abandoned background
// processes from prior Claude/Gemini sessions.
//
// Scans:
//   /tmp/claude-<uid>/*/tasks/        → per-session task output files
//   ~/.claude/projects/<hash>/tasks/  → per-project task outputs (if exists)
//   ps -o pid,ppid,etime,comm         → running processes parented by old claude
//
// Returns { staleTaskDirs, staleOutputs, orphanedShells, totalMb }.
//
// Designed to be O(100ms) — streams findings, caps at first N per category.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const STALE_MS_TASK_DIR = 24 * 60 * 60 * 1000;   // 24h idle → stale session dir
const STALE_MS_OUTPUT   = 4 * 60 * 60 * 1000;    // 4h idle → stale output file
const STALE_MS_SHELL    = 30 * 60 * 1000;        // 30min idle → stale shell process

function safeStat(p) {
  try { return fs.statSync(p); } catch { return null; }
}

function findTaskDirs() {
  const uid = process.getuid?.() ?? process.env.USERNAME ?? '';
  const base = path.join(os.tmpdir(), `claude-${uid}`);
  const out = [];
  if (!fs.existsSync(base)) return out;
  for (const cwdDir of fs.readdirSync(base)) {
    const cwdPath = path.join(base, cwdDir);
    const st = safeStat(cwdPath);
    if (!st?.isDirectory()) continue;
    for (const sid of fs.readdirSync(cwdPath)) {
      const tasksDir = path.join(cwdPath, sid, 'tasks');
      if (!fs.existsSync(tasksDir)) continue;
      const dirStat = safeStat(tasksDir);
      if (!dirStat) continue;
      out.push({ path: tasksDir, sid, cwdHash: cwdDir, mtime: dirStat.mtimeMs });
    }
  }
  return out;
}

function scanStaleTaskDirs(now, currentSid) {
  const dirs = findTaskDirs();
  const stale = [];
  for (const d of dirs) {
    if (d.sid === currentSid) continue;  // never flag our own
    const age = now - d.mtime;
    if (age < STALE_MS_TASK_DIR) continue;
    let sizeKb = 0, fileCount = 0;
    try {
      for (const f of fs.readdirSync(d.path)) {
        const st = safeStat(path.join(d.path, f));
        if (!st?.isFile()) continue;
        sizeKb += st.size;
        fileCount++;
      }
    } catch {}
    stale.push({
      sid: d.sid,
      cwdHash: d.cwdHash,
      ageHours: +(age / 3600000).toFixed(1),
      fileCount,
      kb: +(sizeKb / 1024).toFixed(1),
      path: d.path,
    });
  }
  return stale.sort((a, b) => b.ageHours - a.ageHours);
}

function scanStaleOutputs(now, currentSid) {
  const dirs = findTaskDirs();
  let staleCount = 0;
  let staleKb = 0;
  const samples = [];
  for (const d of dirs) {
    if (d.sid === currentSid) continue;
    try {
      for (const f of fs.readdirSync(d.path)) {
        if (!f.endsWith('.output')) continue;
        const fp = path.join(d.path, f);
        const st = safeStat(fp);
        if (!st?.isFile()) continue;
        const age = now - st.mtimeMs;
        if (age < STALE_MS_OUTPUT) continue;
        staleCount++;
        staleKb += st.size / 1024;
        if (samples.length < 5) samples.push({ name: f, sid: d.sid, ageHours: +(age / 3600000).toFixed(1) });
      }
    } catch {}
  }
  return { count: staleCount, kb: +staleKb.toFixed(1), samples };
}

function scanOrphanedShells(activeSidList) {
  const activeSids = new Set(activeSidList || []);
  const orphans = [];
  try {
    // Look for zsh processes that look like Claude-spawned shells
    if (process.platform === 'win32') return orphans;
    const out = execSync(
      'ps -eo pid,ppid,etime,user,comm,args || ps -Ao pid,ppid,etime,user,comm,args',
      { encoding: 'utf8', timeout: 3000, stdio: ['pipe', 'pipe', 'ignore'] }
    );
    for (const line of out.split('\n')) {
      if (!line.trim()) continue;
      // Match: claude-triggered zsh runs carry /tmp/claude-* paths in their args
      if (!/\/tmp\/claude-/.test(line)) continue;
      const parts = line.trim().split(/\s+/);
      const pid = parts[0];
      const etime = parts[2];
      const comm = parts[4];
      const argsJoined = line.slice(line.indexOf(comm)).trim();
      // Extract session-id-like hash from args if present
      const sidMatch = argsJoined.match(/\/tmp\/claude-[a-z0-9-]+/);
      orphans.push({
        pid: parseInt(pid, 10),
        etime,
        comm,
        sidHint: sidMatch ? sidMatch[0] : null,
      });
    }
  } catch {}
  // Filter: only include shells that are probably orphaned (etime > 30min)
  return orphans.filter(o => {
    // etime format: [[dd-]hh:]mm:ss
    const m = o.etime.match(/^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)$/);
    if (!m) return false;
    const days = parseInt(m[1] || '0', 10);
    const hours = parseInt(m[2] || '0', 10);
    const minutes = parseInt(m[3], 10);
    const totalMin = days * 1440 + hours * 60 + minutes;
    return totalMin > 30;
  });
}

function analyze(opts = {}) {
  const now = Date.now();
  const currentSid = opts.currentSid || '';
  const staleTaskDirs = scanStaleTaskDirs(now, currentSid);
  const staleOutputs = scanStaleOutputs(now, currentSid);
  const activeSids = Array.from(new Set(staleTaskDirs.map(d => d.sid))); // from stale list only
  const orphanedShells = scanOrphanedShells(activeSids);
  const totalMb = +((staleTaskDirs.reduce((a, d) => a + d.kb, 0) + staleOutputs.kb) / 1024).toFixed(2);
  return { staleTaskDirs, staleOutputs, orphanedShells, totalMb };
}

function summaryBadge(report) {
  const parts = [];
  if (report.staleTaskDirs.length > 0) {
    parts.push(`${report.staleTaskDirs.length} stale session dir(s)`);
  }
  if (report.staleOutputs.count > 20) {
    parts.push(`${report.staleOutputs.count} old task outputs (${report.staleOutputs.kb}KB)`);
  }
  if (report.orphanedShells.length > 0) {
    parts.push(`${report.orphanedShells.length} orphaned shell(s) (oldest etime: ${report.orphanedShells[0].etime})`);
  }
  if (parts.length === 0) return null;
  return `⚠ stale processes: ${parts.join(' | ')} — run '~/.claude/scripts/cleanup-stale.sh' to reclaim`;
}

module.exports = { analyze, summaryBadge, findTaskDirs };

// CLI
if (require.main === module) {
  const report = analyze();
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(report, null, 2));
  } else {
    const b = summaryBadge(report);
    if (b) console.log(b);
    console.log(`\nstaleTaskDirs: ${report.staleTaskDirs.length}`);
    for (const d of report.staleTaskDirs.slice(0, 10)) {
      console.log(`  sid=${d.sid.slice(0, 8)} age=${d.ageHours}h files=${d.fileCount} kb=${d.kb}`);
    }
    console.log(`\nstaleOutputs: count=${report.staleOutputs.count} kb=${report.staleOutputs.kb}`);
    for (const s of report.staleOutputs.samples) {
      console.log(`  ${s.sid.slice(0, 8)}/${s.name} age=${s.ageHours}h`);
    }
    console.log(`\norphanedShells: ${report.orphanedShells.length}`);
    for (const o of report.orphanedShells.slice(0, 10)) {
      console.log(`  pid=${o.pid} etime=${o.etime} comm=${o.comm}`);
    }
    console.log(`\ntotal reclaimable: ${report.totalMb}MB`);
  }
}
