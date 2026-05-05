#!/usr/bin/env node
// Combined SessionStart hook: merges 7 lightweight hooks into 1 process
// Replaces: reflect-enabled, consolidate-memory-session-counter, stale-task-cleanup,
//           sync-hook-versions, ensure-portable-memory, sync-memory-dirs, session-catchup
// Reason: 13 parallel Node processes at session start crashed KDE Wayland compositor
// All original logic preserved — just runs sequentially in one process.

const fs = require('fs');
const path = require('path');
const os = require('os');

const TIMER_START = process.hrtime.bigint();
const home = os.homedir();
const claudeDir = path.join(home, '.claude');
const geminiDir = path.join(home, '.gemini');
const scriptDir = __dirname;
const isGemini = scriptDir.includes('.gemini');
const agentDir = isGemini ? '.gemini' : '.claude';
const configDir = path.join(home, agentDir);
const projectDir = process.cwd();

let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }
let input;
try { input = JSON.parse(raw); } catch { input = {}; }

const messages = [];
const errors = [];

// Observability: emit session-start event
try {
  const obs = require('./lib/observability-logger.js');
  obs.logEvent(projectDir, { type: 'session_start', source: 'session-start-combined', agent: isGemini ? 'gemini' : 'claude' });
} catch {}

// Stale-marker sweep (SEC-3 hygiene 2026-04-23): delete subagent markers
// older than 24h. Prevents SEC-3 MCP write gate from false-blocking on
// abandoned subagents. Shared marker dir between Claude + Gemini.
try {
  const markerDir = path.join(home, '.claude', 'cache', 'subagent-active');
  const cutoff = Date.now() - (24 * 60 * 60 * 1000);
  for (const name of fs.readdirSync(markerDir)) {
    if (!name.endsWith('.json')) continue;
    const p = path.join(markerDir, name);
    try { if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p); } catch {}
  }
} catch {}

// ── 1. Reflect-enabled (touch marker file) ──
try {
  const enabledFile = path.join(configDir, '.reflect-enabled');
  if (!fs.existsSync(enabledFile)) fs.writeFileSync(enabledFile, '');
} catch (e) {
  errors.push({ section: 'reflect-enabled', error: e.message, stack: e.stack?.split('\n')[1]?.trim() });
}

// ── 1b. Stale lock cleanup (RC-003: prevents .dream-lock from blocking all future consolidations) ──
try {
  const { DREAM_LOCK_STALE_MS, TEMP_FILE_STALE_MS } = require('./lib/constants.js');
  const dreamLockFile = path.join(claudeDir, '.dream-lock');
  try {
    const lockAge = Date.now() - fs.statSync(dreamLockFile).mtimeMs;
    if (lockAge >= DREAM_LOCK_STALE_MS) fs.unlinkSync(dreamLockFile);
  } catch {}

  // Also clean up stale /tmp files from previous sessions (LC-001)
  const tmpDir = os.tmpdir();
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(tmpDir)) {
      if (f.startsWith('claude-ctx-') && (f.endsWith('.json'))) {
        const fp = path.join(tmpDir, f);
        try {
          if (now - fs.statSync(fp).mtimeMs >= TEMP_FILE_STALE_MS) fs.unlinkSync(fp);
        } catch {}
      }
    }
    // Also clean stale skill-log-*.jsonl orphans in configDir (RC-002)
    for (const f of fs.readdirSync(configDir)) {
      if (f.startsWith('.skill-log-') && f.endsWith('.jsonl')) {
        const fp = path.join(configDir, f);
        try {
          if (now - fs.statSync(fp).mtimeMs >= TEMP_FILE_STALE_MS) fs.unlinkSync(fp);
        } catch {}
      }
    }
  } catch {}
} catch (e) {
  errors.push({ section: 'stale-state-cleanup', error: e.message, stack: e.stack?.split('\n')[1]?.trim() });
}

// ── 2. Consolidate-memory session counter (RC-001: atomic increment) ──
try {
  const { incrementCounter } = require('./lib/atomic-counter.js');
  const { DREAM_COOLDOWN_MS, DREAM_MIN_SESSIONS } = require('./lib/constants.js');
  const countFile = path.join(claudeDir, '.dream-session-count');
  const lastFile = path.join(claudeDir, '.dream-last');
  const lockFile = path.join(claudeDir, '.dream-lock');
  const COOLDOWN_MS = DREAM_COOLDOWN_MS;
  const MIN_SESSIONS = DREAM_MIN_SESSIONS;

  const count = incrementCounter(countFile);

  let lastTime = 0;
  try { lastTime = fs.statSync(lastFile).mtimeMs; } catch {}
  const elapsed = Date.now() - lastTime;

  if (count >= MIN_SESSIONS && elapsed >= COOLDOWN_MS && !fs.existsSync(lockFile)) {
    fs.writeFileSync(lockFile, '');
    const memDir = [
      path.join(projectDir, '.ai-context', 'memory'),
      path.join(projectDir, '.claude', 'memory'),
    ].find(d => fs.existsSync(path.join(d, 'MEMORY.md')));
    if (memDir) {
      const memCount = fs.readdirSync(memDir).filter(f => f.endsWith('.md')).length;
      messages.push(`[consolidate-memory] Run /consolidate-memory on ${memDir} (${memCount} memory files, ${count} sessions since last consolidation). After consolidation, reset counters: write '0' to ${countFile}, touch ${lastFile}, delete ${lockFile}`);
      try { require('./lib/observability-logger.js').logEvent(projectDir, { type: 'dream_trigger', source: 'session-start-combined', meta: { memCount, sessionCount: count } }); } catch {}
    }
  }
} catch (e) {
  errors.push({ section: 'consolidate-memory-counter', error: e.message, stack: e.stack?.split('\n')[1]?.trim() });
}

// ── 2b. Handoff retention (added 2026-04-17) ──
// Enforces CLAUDE.md rule: versioned handoffs >7d archived, pointer >14d archived, keep 3 newest.
// Scans all known handoff locations (cwd root, .claude/, .ai-context/).
try {
  const VERSIONED_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  const POINTER_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
  const KEEP_NEWEST = 3;

  for (const handoffDir of [projectDir, path.join(projectDir, '.claude'), path.join(projectDir, '.ai-context')]) {
    if (!fs.existsSync(handoffDir)) continue;

    const archiveDir = path.join(handoffDir, 'handoff-archive');
    const now = Date.now();

    try {
      const entries = fs.readdirSync(handoffDir, { withFileTypes: true });

      // Versioned handoffs: .session-handoff-<label>-<ts>.md
      const versioned = entries
        .filter(e => e.isFile() && /^\.session-handoff-.+\.md$/.test(e.name))
        .map(e => ({ name: e.name, path: path.join(handoffDir, e.name), mtime: fs.statSync(path.join(handoffDir, e.name)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);

      // Archive versioned >7d, EXCEPT keep 3 newest regardless
      for (let i = KEEP_NEWEST; i < versioned.length; i++) {
        const v = versioned[i];
        if (now - v.mtime >= VERSIONED_MAX_AGE_MS) {
          try {
            fs.mkdirSync(archiveDir, { recursive: true });
            fs.renameSync(v.path, path.join(archiveDir, v.name));
          } catch {}
        }
      }

      // Archive pointer (.session-handoff.md) if >14d old
      const pointerPath = path.join(handoffDir, '.session-handoff.md');
      try {
        const pointerAge = now - fs.statSync(pointerPath).mtimeMs;
        if (pointerAge >= POINTER_MAX_AGE_MS) {
          fs.mkdirSync(archiveDir, { recursive: true });
          const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          fs.renameSync(pointerPath, path.join(archiveDir, `pointer-${ts}.md`));
        }
      } catch {}
    } catch {}
  }
} catch (e) {
  errors.push({ section: 'handoff-retention', error: e.message, stack: e.stack?.split('\n')[1]?.trim() });
}

// ── 3. Stale task cleanup ──
try {
  const MAX_AGE_DAYS = 14;
  const now = Date.now();
  for (const tasksPath of [
    path.join(projectDir, '.claude', 'AI-tasks.json'),
    path.join(projectDir, '.gemini', 'AI-tasks.json'),
    path.join(projectDir, 'AI-tasks.json'),
    path.join(projectDir, '.ai-context', 'AI-tasks.json'),
  ]) {
    if (!fs.existsSync(tasksPath)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
      const tasks = data.tasks || [];
      let changed = false;
      data.tasks = tasks.filter(t => {
        if (t.status === 'done' && t.completedDate) {
          const age = now - new Date(t.completedDate).getTime();
          if (age > MAX_AGE_DAYS * 86400000) { changed = true; return false; }
        }
        return true;
      });
      if (changed) fs.writeFileSync(tasksPath, JSON.stringify(data, null, 2));
    } catch {}
    break;
  }
} catch (e) {
  errors.push({ section: 'stale-task-cleanup', error: e.message, stack: e.stack?.split('\n')[1]?.trim() });
}

// ── 4. Sync hook versions (GSD version tag patching) ──
try {
  const versionFile = path.join(claudeDir, 'get-shit-done', 'VERSION');
  if (fs.existsSync(versionFile)) {
    const gsdVersion = fs.readFileSync(versionFile, 'utf8').trim();
    if (gsdVersion) {
      const CUSTOM_HOOKS = ['enhanced-statusline.js', 'plugin-update-checker.js', 'sync-hook-versions.js'];
      for (const hookFile of CUSTOM_HOOKS) {
        const filePath = path.join(claudeDir, 'hooks', hookFile);
        if (!fs.existsSync(filePath)) continue;
        let content = fs.readFileSync(filePath, 'utf8');
        const match = content.match(/^\/\/ gsd-hook-version: (.+)$/m);
        if (match && match[1].trim() !== gsdVersion) {
          content = content.replace(/^\/\/ gsd-hook-version: .+$/m, `// gsd-hook-version: ${gsdVersion}`);
          fs.writeFileSync(filePath, content);
        }
      }
    }
  }
} catch (e) {
  errors.push({ section: 'sync-hook-versions', error: e.message, stack: e.stack?.split('\n')[1]?.trim() });
}

// ── 5. Ensure portable memory ──
try {
  const sanitized = projectDir.replace(/^\//, '').replace(/[/\\]/g, '-').replace(/^([A-Z]):/i, '$1');
  const memoryDir = path.join(home, agentDir, 'projects', sanitized, 'memory');

  let needsLink = true;
  try {
    const stat = fs.lstatSync(memoryDir);
    if ((stat.isSymbolicLink() || stat.isDirectory()) && fs.existsSync(path.join(memoryDir, 'MEMORY.md'))) {
      needsLink = false;
    }
  } catch {}

  if (needsLink) {
    const candidates = ['.ai-context/memory', '.claude/memory'];
    let portable = null;
    for (const candidate of candidates) {
      const fullPath = path.join(projectDir, candidate);
      if (fs.existsSync(fullPath) && fs.existsSync(path.join(fullPath, 'MEMORY.md'))) {
        portable = fullPath;
        break;
      }
    }
    if (portable) {
      fs.mkdirSync(path.dirname(memoryDir), { recursive: true });
      try {
        const stat = fs.lstatSync(memoryDir);
        if (stat.isSymbolicLink()) fs.unlinkSync(memoryDir);
        else if (stat.isDirectory() && fs.readdirSync(memoryDir).length === 0) fs.rmdirSync(memoryDir);
      } catch {}
      if (os.platform() === 'win32') {
        fs.symlinkSync(portable, memoryDir, 'junction');
      } else {
        fs.symlinkSync(portable, memoryDir);
      }
    }
  }
} catch (e) {
  errors.push({ section: 'ensure-portable-memory', error: e.message, stack: e.stack?.split('\n')[1]?.trim(), critical: true });
}

// ── 6. Sync memory dirs ──
try {
  const claudeMemory = path.join(projectDir, '.claude', 'memory');
  const geminiMemory = path.join(projectDir, '.gemini', 'memory');
  if (fs.existsSync(claudeMemory) && fs.existsSync(geminiMemory)) {
    function syncDirs(src, dest) {
      let count = 0;
      for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcFile = path.join(src, entry.name);
        const destFile = path.join(dest, entry.name);
        try {
          if (entry.isDirectory()) {
            fs.mkdirSync(destFile, { recursive: true });
            count += syncDirs(srcFile, destFile);
          } else if (entry.isFile()) {
            if (!fs.existsSync(destFile)) { fs.copyFileSync(srcFile, destFile); count++; }
            else if (fs.statSync(srcFile).mtimeMs > fs.statSync(destFile).mtimeMs) { fs.copyFileSync(srcFile, destFile); count++; }
          }
        } catch {}
      }
      return count;
    }
    syncDirs(claudeMemory, geminiMemory);
    syncDirs(geminiMemory, claudeMemory);
  }
} catch (e) {
  errors.push({ section: 'sync-memory-dirs', error: e.message, stack: e.stack?.split('\n')[1]?.trim() });
}

// ── 7. Session catchup (missed reflect detection) ──
try {
  const historyFile = path.join(configDir, 'history.jsonl');
  const lastReflect = path.join(configDir, '.reflect-last');
  const catchupFile = path.join(configDir, '.catchup-done');

  let historyMtime = 0, reflectMtime = 0, catchupMtime = 0;
  try { historyMtime = fs.statSync(historyFile).mtimeMs; } catch {}
  try { reflectMtime = fs.statSync(lastReflect).mtimeMs; } catch {}
  try { catchupMtime = fs.statSync(catchupFile).mtimeMs; } catch {}

  if (catchupMtime < historyMtime) {
    // Check handoff
    let handoffRecent = false;
    for (const hp of [
      path.join(projectDir, '.ai-context', '.session-handoff.md'),
      path.join(projectDir, '.claude', '.session-handoff.md'),
      path.join(home, '.claude', '.session-handoff.md'),
    ]) {
      try {
        if (historyMtime - fs.statSync(hp).mtimeMs < 10 * 60 * 1000) { handoffRecent = true; break; }
      } catch {}
    }

    fs.writeFileSync(catchupFile, '');

    if (!handoffRecent && (historyMtime - reflectMtime) >= 5 * 60 * 1000) {
      const memDir = ['.ai-context/memory', '.claude/memory'].find(d =>
        fs.existsSync(path.join(projectDir, d, 'MEMORY.md'))
      );
      if (memDir) {
        messages.push(`[catch-up] Previous session missed reflection. Scan for unsaved corrections/patterns → ${path.join(projectDir, memDir)}/. Silent if nothing.`);
        try { require('./lib/observability-logger.js').logEvent(projectDir, { type: 'catchup_trigger', source: 'session-start-combined' }); } catch {}
      }
    }
  }
} catch (e) {
  errors.push({ section: 'session-catchup', error: e.message, stack: e.stack?.split('\n')[1]?.trim(), critical: true });
}

// ── 8. Version-change detector (REQ-08-01) ──
try {
  const versionFile = path.join(claudeDir, '.last-known-version');

  // Extract version from CLAUDE_CODE_EXECPATH (CLAUDE_CODE_VERSION does NOT exist)
  // e.g. /nix/store/...-claude-code-2.1.104/bin/.claude-unwrapped
  function getCurrentVersion() {
    const execPath = process.env.CLAUDE_CODE_EXECPATH || '';
    const match = execPath.match(/claude-code-(\d+\.\d+\.\d+)/);
    if (match) return match[1];
    // Fallback: parse claude --version
    try {
      const { execSync } = require('child_process');
      const out = execSync('claude --version 2>/dev/null', { encoding: 'utf8', timeout: 3000 });
      const m = out.match(/(\d+\.\d+\.\d+)/);
      return m ? m[1] : null;
    } catch { return null; }
  }

  const currentVersion = getCurrentVersion();
  if (currentVersion) {
    let lastVersion = null;
    try { lastVersion = fs.readFileSync(versionFile, 'utf8').trim(); } catch {}

    if (lastVersion && lastVersion !== currentVersion) {
      // Version changed — auto-fetch release notes, write dated memory, surface breaking-hook signals
      let signals = [];
      let memPath = null;
      try {
        const { diffReleaseNotes } = require('./lib/release-notes-cache.js');
        const diff = diffReleaseNotes(lastVersion, currentVersion);
        if (diff) {
          signals = diff.breakingHookSignals || [];
          const today = new Date().toISOString().slice(0, 10);
          memPath = path.join(home, '.ai-context', 'memory',
            `project_${today}_claude-code-v${currentVersion}.md`);
          const description = signals.length > 0
            ? `Upgrade notes ${lastVersion}→${currentVersion} — ${signals.length} potential breaking-hook signal(s) detected`
            : `Upgrade notes ${lastVersion}→${currentVersion} — non-breaking for hooks`;
          const frontmatter = `---\nname: Claude Code ${lastVersion}→${currentVersion} upgrade notes\ndescription: ${description}\ntype: project\n---\n\n`;
          const signalsBlock = signals.length > 0
            ? signals.map(s => `- ${s}`).join('\n')
            : '_none detected_';
          const bodyBlock = `# Upgrade ${lastVersion} → ${currentVersion}\n\nPublished: ${diff.publishedAt || 'unknown'}\n\n## Breaking hook signals (auto-detected)\n\n${signalsBlock}\n\n## Full release notes\n\n${diff.body || '_notes unavailable_'}\n`;
          try { fs.writeFileSync(memPath, frontmatter + bodyBlock); } catch {}
        }
      } catch {}
      try {
        require('./lib/observability-logger.js').logEvent(projectDir, {
          type: 'version_change',
          source: 'session-start-combined',
          meta: { from: lastVersion, to: currentVersion, signals: signals.length }
        });
      } catch {}
      const signalNote = signals.length > 0
        ? ` — ${signals.length} potential breaking-hook signal(s), review ${memPath}`
        : (memPath ? ` — notes saved to ${memPath}` : '');
      messages.push(`[version-change] Claude Code ${lastVersion} → ${currentVersion}${signalNote}`);
    }

    // Always update version file (creates on first run)
    fs.writeFileSync(versionFile, currentVersion);
  }
} catch (e) {
  errors.push({ section: 'version-change-detector', error: e.message, stack: e.stack?.split('\n')[1]?.trim() });
}

// ── 9. Research session counter (REQ-08-03 — gate fires in meta-system-stop.js; RC-001: atomic) ──
try {
  const { incrementCounter } = require('./lib/atomic-counter.js');
  const researchCountFile = path.join(claudeDir, '.research-session-count');
  incrementCounter(researchCountFile);

  // Auto-init .research-last baseline if missing (prevents gate 1 from always firing on fresh install)
  const researchLastFile = path.join(claudeDir, '.research-last');
  try {
    fs.statSync(researchLastFile);
  } catch {
    // File missing — create with current timestamp so 30-day cooldown starts from first session
    try { fs.writeFileSync(researchLastFile, ''); } catch {}
  }

  // Also auto-init .dream-last if missing (same reason — cooldown starts from first session)
  const dreamLastFile = path.join(claudeDir, '.dream-last');
  try {
    fs.statSync(dreamLastFile);
  } catch {
    try { fs.writeFileSync(dreamLastFile, ''); } catch {}
  }
} catch (e) {
  errors.push({ section: 'research-session-counter', error: e.message, stack: e.stack?.split('\n')[1]?.trim() });
}

// ── 11. Settings schema drift detection ──
try {
  const settingsPath = path.join(claudeDir, 'settings.json');
  if (fs.existsSync(settingsPath)) {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const { findDrift } = require('./lib/settings-schema.js');
    const drift = findDrift(settings);
    const issues = [];
    if (drift.managedOnly.length > 0) {
      issues.push(`managed-only keys in user settings (will trigger schema error): ${drift.managedOnly.join(', ')}`);
    }
    if (drift.deprecated.length > 0) {
      issues.push(`deprecated: ${drift.deprecated.join(', ')}`);
    }
    if (drift.unknown.length > 3) {
      issues.push(`${drift.unknown.length} unknown keys (review for current version): ${drift.unknown.slice(0, 5).join(', ')}${drift.unknown.length > 5 ? '...' : ''}`);
    }
    if (issues.length > 0) {
      messages.push(`[settings-drift] ${issues.join(' | ')}`);
    }
  }
} catch (e) {
  errors.push({ section: 'settings-drift', error: e.message, stack: e.stack?.split('\n')[1]?.trim() });
}

// ── 10. Symlink integrity (merged from validate-symlinks.js) ──
try {
  const audit = require('./lib/symlink-audit.js');
  const report = audit.auditAll();
  const broken = report.broken_live || [];
  const loops = report.loops || [];
  if (broken.length > 0 || loops.length > 0) {
    const summary = [];
    if (broken.length > 0) summary.push(`${broken.length} broken live symlink(s): ${broken.slice(0, 3).map(b => b.path).join(', ')}${broken.length > 3 ? '...' : ''}`);
    if (loops.length > 0) summary.push(`${loops.length} loop(s)`);
    messages.push(`[symlink-integrity] ${summary.join('; ')}. Run 'node ~/.claude/hooks/lib/symlink-audit.js' for full list.`);
  }
} catch (e) {
  errors.push({ section: 'symlink-integrity', error: e.message, stack: e.stack?.split('\n')[1]?.trim() });
}

// ── Error aggregation (SF-001: surface ANY error, not just 3+) ──
if (errors.length > 0) {
  try {
    const obs = require('./lib/observability-logger.js');
    obs.logEvent(projectDir, { type: 'hook_errors', source: 'session-start-combined', errors, severity: errors.some(e => e.critical) ? 'critical' : (errors.length > 2 ? 'warning' : 'info') });
  } catch {}
  // Previously suppressed errors unless count > 2 or critical. Now: surface everything
  // so silent failures become visible. Users can mute via settings if noisy.
  messages.push(`[hook-error-aggregation] ${errors.length} sub-function(s) failed in session-start-combined: ${errors.map(e => e.section).join(', ')}`);
}

// ── Hook timing telemetry ──
try {
  const total_ms = Number(process.hrtime.bigint() - TIMER_START) / 1e6;
  require('./lib/observability-logger.js').logEvent(projectDir, {
    type: 'hook_timing',
    source: 'session-start-combined',
    meta: {
      total_ms: +total_ms.toFixed(3),
      error_count: errors.length,
      message_count: messages.length,
    },
  });
} catch {}

// ── Output ──
if (messages.length > 0) {
  process.stdout.write(JSON.stringify({ continue: true, systemMessage: messages.join('\n') }));
} else {
  process.stdout.write('{"continue":true}');
}
