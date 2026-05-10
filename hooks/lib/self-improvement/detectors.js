// detectors.js — 10 detection rules for self-improvement queue.
// Each detector: (ctx) → Finding[]. Pure (reads files, never writes).
// Ctx provides: cwd, configDir, readEvents (from observability-logger)
// Spec R1-R10: [spec-ref] 2026-04-14-self-improvement-handoff.md

const fs = require('fs');
const path = require('path');
const os = require('os');

function getTelemetryEpochMs(configDir) {
  try {
    const epoch = JSON.parse(fs.readFileSync(path.join(configDir, 'telemetry-epoch.json'), 'utf8'));
    const ts = Date.parse(epoch.cutoff_ts || epoch.timestamp || '');
    return Number.isFinite(ts) ? ts : 0;
  } catch {
    return 0;
  }
}

function eventAtOrAfterEpoch(event, epochMs) {
  if (!epochMs) return true;
  const ts = Date.parse(event.ts || event.timestamp || '');
  return Number.isFinite(ts) && ts >= epochMs;
}

// ── R1: hook_timeout_streak ──
// Fires when same hook file produces 'hook_timeout' events in 3+ consecutive sessions
function detectHookTimeoutStreak(ctx) {
  const findings = [];
  try {
    const events = ctx.readEvents(ctx.cwd, 14, { eventTypes: ['hook_timeout', 'hook_errors'] }) || [];
    const byHook = {};
    for (const e of events) {
      const hook = e.source || e.payload?.source;
      if (!hook) continue;
      // hook_errors with timeout in message counts as timeout event
      const isTimeout = e.type === 'hook_timeout' ||
        (e.type === 'hook_errors' && JSON.stringify(e.payload || e.meta || {}).toLowerCase().includes('timeout'));
      if (!isTimeout) continue;
      (byHook[hook] = byHook[hook] || []).push(e);
    }
    for (const [hook, timeouts] of Object.entries(byHook)) {
      if (timeouts.length >= 3) {
        findings.push({
          rule: 'hook_timeout_streak',
          tier: 'SUGGEST',
          target: { type: 'hook', path: `~/.claude/hooks/${hook}.js` },
          evidence: { timeouts: timeouts.length, sessions: [...new Set(timeouts.map(t => t.session_id).filter(Boolean))] },
          proposal: `Hook '${hook}' has timed out ${timeouts.length} times in 14d. Consider adding "async": true in settings.json, or raising timeout.`,
          auto_applicable: false,
          fingerprint_class: 'hook_perf'
        });
      }
    }
  } catch {}
  return findings;
}

// ── R2: hook_error_recurring ──
// Same hook error message appears ≥2 times in 7d → BLOCKER
function detectHookErrorRecurring(ctx) {
  const findings = [];
  try {
    const events = ctx.readEvents(ctx.cwd, 7, { eventTypes: ['hook_errors'] }) || [];
    const byMsg = {};
    for (const e of events) {
      const source = e.source || e.payload?.source;
      const errors = e.payload?.errors || e.meta?.errors || e.errors || [];
      if (!Array.isArray(errors) || errors.length === 0) continue;
      for (const err of errors) {
        const key = `${source}|${(err.error || '').slice(0, 80)}`;
        (byMsg[key] = byMsg[key] || []).push({ event: e, err });
      }
    }
    for (const [key, hits] of Object.entries(byMsg)) {
      if (hits.length >= 2) {
        const [source, msgStart] = key.split('|');
        findings.push({
          rule: 'hook_error_recurring',
          tier: 'BLOCKER',
          target: { type: 'hook', path: `~/.claude/hooks/${source}.js` },
          evidence: { occurrences: hits.length, error_prefix: msgStart, first_seen: hits[0].event.ts },
          proposal: `Hook '${source}' has recurring error: "${msgStart}". Investigate and fix.`,
          auto_applicable: false,
          fingerprint_class: 'hook_error'
        });
      }
    }
  } catch {}
  return findings;
}

// ── R3: orphan_hook_file ──
// Hook file in hooks/ but no registration in settings.json for 14+ days
function detectOrphanHooks(ctx) {
  const findings = [];
  try {
    const hooksDir = path.join(ctx.configDir, 'hooks');
    if (!fs.existsSync(hooksDir)) return findings;
    const settings = JSON.parse(fs.readFileSync(path.join(ctx.configDir, 'settings.json'), 'utf8'));
    const settingsStr = JSON.stringify(settings);
    // Top-level only; archive/ subdir files are intentionally retired
    const hookFiles = fs.readdirSync(hooksDir).filter(f => f.endsWith('.js') && !f.startsWith('archive'));
    const BLOCKLIST_PATHS = ['self-improvement/', 'lib/'];
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    // Pre-read all hook contents once, for require-from-sibling check
    const hookContents = {};
    for (const h of hookFiles) {
      try { hookContents[h] = fs.readFileSync(path.join(hooksDir, h), 'utf8'); } catch {}
    }
    for (const f of hookFiles) {
      if (BLOCKLIST_PATHS.some(b => f.includes(b))) continue;
      const name = f.replace(/\.js$/, '');
      if (settingsStr.includes(name)) continue;  // registered in settings
      // Check if any OTHER hook requires this one
      const requiredBy = Object.entries(hookContents)
        .filter(([other, content]) => other !== f && (
          content.includes(`./${name}`) ||
          content.includes(`/${name}.js`) ||
          content.includes(`/${name}'`) ||
          content.includes(`/${name}"`) ||
          content.includes(f)  // literal filename anywhere
        ))
        .map(([other]) => other);
      if (requiredBy.length > 0) continue;  // used as a helper by a registered hook
      const mtime = fs.statSync(path.join(hooksDir, f)).mtimeMs;
      if (mtime > cutoff) continue;
      findings.push({
        rule: 'orphan_hook_file',
        tier: 'SUGGEST',
        target: { type: 'hook', path: path.join(hooksDir, f) },
        evidence: { age_days: Math.round((Date.now() - mtime) / (24 * 60 * 60 * 1000)) },
        proposal: `Hook '${f}' exists but is not registered in settings.json. Archive or register.`,
        auto_applicable: true,   // can be moved to archive/ after 30d + 3 surfacings
        fingerprint_class: 'orphan'
      });
    }
  } catch {}
  return findings;
}

// ── R4: skill_zero_invocations ──
// Skill not invoked in 30d (read skill-usage.json if present)
function detectSkillZeroInvocations(ctx) {
  const findings = [];
  try {
    const skillUsageFile = path.join(ctx.configDir, 'skill-usage.json');
    if (!fs.existsSync(skillUsageFile)) return findings;
    const usage = JSON.parse(fs.readFileSync(skillUsageFile, 'utf8'));
    const now = Date.now();
    const cutoff = now - 30 * 24 * 60 * 60 * 1000;
    // Skill usage schema assumed: { skills: { <name>: { last_invoked, count_30d, ... } } }
    if (!usage.skills) return findings;
    for (const [skill, data] of Object.entries(usage.skills)) {
      const last = data.last_invoked ? new Date(data.last_invoked).getTime() : 0;
      if (last === 0 || last < cutoff) {
        findings.push({
          rule: 'skill_zero_invocations',
          tier: 'SUGGEST',
          target: { type: 'skill', path: skill },
          evidence: { last_invoked: data.last_invoked || 'never', days_silent: Math.round((now - last) / (24 * 60 * 60 * 1000)) },
          proposal: `Skill '${skill}' hasn't been invoked in 30+ days. Keep (rare but critical) or archive?`,
          auto_applicable: false,
          fingerprint_class: 'skill_stale'
        });
      }
    }
  } catch {}
  return findings;
}

// ── R5: skill_regression ──
// NOTE: already implemented inline in meta-system-stop.js Section A.
// This detector just returns [] (work done elsewhere); kept for spec completeness.
function detectSkillRegression() { return []; }

// ── R6: memory_hot_unpromoted ──
// Memory file referenced 8+ times in episodic events AND not edited in 180d
function detectMemoryHotUnpromoted(ctx) {
  const findings = [];
  try {
    const events = ctx.readEvents(ctx.cwd, 30, {}) || [];
    const refCount = {};
    for (const e of events) {
      // Look for file references in payload
      const p = e.payload || e.meta || {};
      const candidates = [p.file, p.target?.path, p.source_file].filter(Boolean);
      for (const c of candidates) {
        if (c.includes('/memory/') && c.endsWith('.md')) {
          refCount[c] = (refCount[c] || 0) + 1;
        }
      }
    }
    const cutoff = Date.now() - 180 * 24 * 60 * 60 * 1000;
    for (const [file, count] of Object.entries(refCount)) {
      if (count < 8) continue;
      try {
        const mtime = fs.statSync(file).mtimeMs;
        if (mtime < cutoff) {
          findings.push({
            rule: 'memory_hot_unpromoted',
            tier: 'SUGGEST',
            target: { type: 'memory', path: file },
            evidence: { ref_count: count, last_edited_days_ago: Math.round((Date.now() - mtime) / (24 * 60 * 60 * 1000)) },
            proposal: `Memory '${path.basename(file)}' referenced ${count}× but unedited 180+d. Promote key points to CLAUDE.md?`,
            auto_applicable: false,
            fingerprint_class: 'memory_promotion'
          });
        }
      } catch {}
    }
  } catch {}
  return findings;
}

// ── R7: memory_cold ──
// (Placeholder — needs project memory enumeration + ref check. Implement in Phase 4.)
function detectMemoryCold() { return []; }

// ── R11: memory_cold_by_retrieval ──
// Memory file enumerated under .claude/memory/ but 0 reads in retrieval-log-<host>.jsonl for 90d.
// Source of truth: ~/.claude/cache/retrieval-log-<host>.jsonl (written by memory-retrieval-logger.js).
// Per Rule M9 (2026-04-14-memory-architecture-v2.md Phase 3).
function detectMemoryColdByRetrieval(ctx) {
  const findings = [];
  try {
    const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
    const host = os.hostname();
    const logFile = path.join(home, '.claude', 'cache', `retrieval-log-${host}.jsonl`);
    if (!fs.existsSync(logFile)) return findings; // no history yet — never fire false positives

    // Build retrieval count by memory basename (relative paths vary by cwd, basenames stable)
    const cutoff90 = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const retrieved = new Set();
    const raw = fs.readFileSync(logFile, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        const ts = Date.parse(entry.ts || '');
        if (!ts || ts < cutoff90) continue;
        const base = path.basename(entry.file || entry.abs || '');
        if (base) retrieved.add(base);
      } catch {}
    }

    // Enumerate project memory files
    const memDir = path.join(ctx.cwd, '.claude', 'memory');
    if (!fs.existsSync(memDir)) return findings;
    const files = fs.readdirSync(memDir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md');

    // Only fire when retrieval log has enough history (>= 14 days of data)
    const stat = fs.statSync(logFile);
    const logAgeDays = (Date.now() - stat.birthtimeMs) / (24 * 60 * 60 * 1000);
    if (logAgeDays < 14) return findings;

    for (const f of files) {
      if (retrieved.has(f)) continue;
      try {
        const mtime = fs.statSync(path.join(memDir, f)).mtimeMs;
        const ageDays = Math.round((Date.now() - mtime) / (24 * 60 * 60 * 1000));
        if (ageDays < 90) continue; // young memories get benefit of doubt
        findings.push({
          rule: 'memory_cold_by_retrieval',
          tier: 'SUGGEST',
          target: { type: 'memory', path: path.join(memDir, f) },
          evidence: { retrievals_90d: 0, last_edited_days_ago: ageDays, log_age_days: Math.round(logAgeDays) },
          proposal: `Memory '${f}' has 0 retrievals in 90d and was last edited ${ageDays}d ago. Archive to memory/archive/?`,
          auto_applicable: false,
          fingerprint_class: 'memory_cold'
        });
      } catch {}
    }
  } catch {}
  return findings;
}

// ── R13: memory_fact_expired ──  (v3 Phase A)
// Memory frontmatter declares `valid_until: YYYY-MM-DD` and that date is past.
// SUGGEST: move to memory/archive/ — fact no longer current.
function detectMemoryFactExpired(ctx) {
  const findings = [];
  try {
    const memDir = path.join(ctx.cwd, '.claude', 'memory');
    if (!fs.existsSync(memDir)) return findings;
    const today = new Date().toISOString().slice(0, 10);
    const files = fs.readdirSync(memDir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md');
    for (const f of files) {
      const fp = path.join(memDir, f);
      try {
        const head = fs.readFileSync(fp, 'utf8').split('\n').slice(0, 15).join('\n');
        const m = head.match(/^valid_until:\s*(\d{4}-\d{2}-\d{2})/im);
        if (!m) continue;
        if (m[1] >= today) continue;
        findings.push({
          rule: 'memory_fact_expired',
          tier: 'SUGGEST',
          target: { type: 'memory', path: fp },
          evidence: { valid_until: m[1], today, days_past: Math.round((Date.parse(today) - Date.parse(m[1])) / 86400000) },
          proposal: `Memory '${f}' declared valid_until=${m[1]}; that date is past. Archive to memory/archive/?`,
          auto_applicable: false,
          fingerprint_class: 'memory_expired'
        });
      } catch {}
    }
  } catch {}
  return findings;
}

// ── R14: memory_active_forgetting ──  (v3 Phase B)
// Cross-host retrieval aggregation: if a memory has 0 reads in ANY host's log for 180+ days
// AND is not type=user/standard (opinionated keepers) AND hasn't been edited in 14d,
// SUGGEST archive. Requires retrieval log with >=30d of history (else too noisy for young memories).
function detectMemoryActiveForgetting(ctx) {
  const findings = [];
  try {
    const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
    const cacheDir = path.join(home, '.claude', 'cache');
    if (!fs.existsSync(cacheDir)) return findings;

    // Aggregate retrievals across ALL retrieval-log-<host>.jsonl files
    const logs = fs.readdirSync(cacheDir).filter(f => /^retrieval-log-.+\.jsonl$/.test(f));
    if (logs.length === 0) return findings;

    // Gate: require >=30d of history on at least one log (birthtime-based)
    let hasMatureLog = false;
    for (const lf of logs) {
      try {
        const st = fs.statSync(path.join(cacheDir, lf));
        if ((Date.now() - st.birthtimeMs) / 86400000 >= 30) { hasMatureLog = true; break; }
      } catch {}
    }
    if (!hasMatureLog) return findings;

    const retrieved = new Set();
    for (const lf of logs) {
      try {
        const raw = fs.readFileSync(path.join(cacheDir, lf), 'utf8');
        for (const line of raw.split('\n')) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);
            const base = path.basename(entry.file || entry.abs || '');
            if (base) retrieved.add(base);
          } catch {}
        }
      } catch {}
    }

    const memDir = path.join(ctx.cwd, '.claude', 'memory');
    if (!fs.existsSync(memDir)) return findings;
    const files = fs.readdirSync(memDir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md');
    const cutoffEdit14 = Date.now() - 14 * 86400000;
    const cutoffAge180 = Date.now() - 180 * 86400000;

    for (const f of files) {
      if (retrieved.has(f)) continue;
      const fp = path.join(memDir, f);
      try {
        const st = fs.statSync(fp);
        if (st.mtimeMs > cutoffEdit14) continue;     // recently edited — still forming
        if (st.mtimeMs > cutoffAge180) continue;     // too young for active-forgetting

        // Read frontmatter to check type
        let type = 'unknown';
        try {
          const head = fs.readFileSync(fp, 'utf8').split('\n').slice(0, 15).join('\n');
          const m = head.match(/^type:\s*([a-z]+)/im);
          if (m) type = m[1].toLowerCase();
        } catch {}
        if (type === 'user' || type === 'standard') continue; // opinionated keepers

        const ageDays = Math.round((Date.now() - st.mtimeMs) / 86400000);
        findings.push({
          rule: 'memory_active_forgetting',
          tier: 'SUGGEST',
          target: { type: 'memory', path: fp },
          evidence: { retrievals_all_hosts: 0, last_edited_days_ago: ageDays, type, logs_checked: logs.length },
          proposal: `Memory '${f}' (type:${type}, age:${ageDays}d) has 0 retrievals across ${logs.length} host(s) in cumulative log. Archive to memory/archive/?`,
          auto_applicable: false,
          fingerprint_class: 'memory_active_forgetting'
        });
      } catch {}
    }
  } catch {}
  return findings;
}

// ── R12: memory_hot_for_promotion ──
// Memory file retrieved ≥10 times in 30d AND not type:user → suggest promotion.
function detectMemoryHotForPromotion(ctx) {
  const findings = [];
  try {
    const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
    const host = os.hostname();
    const logFile = path.join(home, '.claude', 'cache', `retrieval-log-${host}.jsonl`);
    if (!fs.existsSync(logFile)) return findings;

    const cutoff30 = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const counts = {};
    const raw = fs.readFileSync(logFile, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        const ts = Date.parse(entry.ts || '');
        if (!ts || ts < cutoff30) continue;
        const base = path.basename(entry.file || entry.abs || '');
        if (base) counts[base] = (counts[base] || 0) + 1;
      } catch {}
    }

    const memDir = path.join(ctx.cwd, '.claude', 'memory');
    if (!fs.existsSync(memDir)) return findings;

    for (const [file, count] of Object.entries(counts)) {
      if (count < 10) continue;
      const full = path.join(memDir, file);
      if (!fs.existsSync(full)) continue;
      // Read frontmatter to check current type
      let currentType = 'unknown';
      try {
        const head = fs.readFileSync(full, 'utf8').split('\n').slice(0, 10).join('\n');
        const m = head.match(/^type:\s*([a-z]+)/im);
        if (m) currentType = m[1].toLowerCase();
      } catch {}
      if (currentType === 'user') continue; // already promoted

      findings.push({
        rule: 'memory_hot_for_promotion',
        tier: 'SUGGEST',
        target: { type: 'memory', path: full },
        evidence: { retrievals_30d: count, current_type: currentType },
        proposal: `Memory '${file}' retrieved ${count}× in 30d (type:${currentType}). Promote to type:user (global)?`,
        auto_applicable: false,
        fingerprint_class: 'memory_promotion'
      });
    }
  } catch {}
  return findings;
}

// ── R8: settings_drift ──
// Compare top-level keys between Claude and Gemini settings.json
function detectSettingsDrift(ctx) {
  const findings = [];
  try {
    const claudeSettings = JSON.parse(fs.readFileSync(path.join(ctx.configDir, 'settings.json'), 'utf8'));
    const geminiPath = path.join(os.homedir(), '.gemini', 'settings.json');
    if (!fs.existsSync(geminiPath)) return findings;
    const geminiSettings = JSON.parse(fs.readFileSync(geminiPath, 'utf8'));

    // Check hook event parity (Claude events → Gemini equivalent)
    const CLAUDE_TO_GEMINI_EVENTS = {
      SessionStart: 'SessionStart', Stop: 'SessionEnd', PreToolUse: 'BeforeTool',
      PostToolUse: 'AfterTool', PreCompact: 'PreCompress',
      Notification: 'Notification', UserPromptSubmit: 'UserPromptSubmit',
      SessionEnd: 'SessionEnd',
      // Claude-only events (null = skip drift check, no Gemini equivalent)
      PostCompact: null, CwdChanged: null, FileChanged: null,
      SubagentStart: null, SubagentStop: null,
      ConfigChange: null, PostToolBatch: null, InstructionsLoaded: null,
      PermissionDenied: null, StopFailure: null,
    };

    const claudeEvents = Object.keys(claudeSettings.hooks || {});
    const geminiEvents = Object.keys(geminiSettings.hooks || {});
    for (const ce of claudeEvents) {
      const geminiEquiv = CLAUDE_TO_GEMINI_EVENTS[ce] || ce;
      if (geminiEquiv === null) continue; // Claude-only event, skip
      if (!geminiEvents.includes(geminiEquiv)) {
        findings.push({
          rule: 'settings_drift',
          tier: 'SUGGEST',
          target: { type: 'settings', path: geminiPath },
          evidence: { claude_event: ce, gemini_equiv: geminiEquiv, present_gemini: false },
          proposal: `Claude has '${ce}' event hooks but Gemini missing '${geminiEquiv}'. Mirror registration if applicable.`,
          auto_applicable: false,
          fingerprint_class: 'drift'
        });
      }
    }
  } catch {}
  return findings;
}

// ── R9: cross_platform_asymmetry ──
// Hook file exists in ~/.claude/hooks/ but not ~/.gemini/hooks/ (or vice versa), not in known allowlist
//
// Allowlist categories (updated 2026-04-16 audit to fix detect→accept→archive→redetect loop):
//   - claude_only: platform-specific, legitimately Claude-only
//   - gemini_only: TWO types
//     (a) Gemini-specific sync hooks (sync-claude-md, sync-claude-skills, sync-claude-agents)
//     (b) Hooks ABSORBED into combined hooks on Claude side:
//         - claude-gemini-json-sync.js → absorbed into post-write-sync.js section 4
//         - sync-memory-dirs.js        → absorbed into session-start-combined.js section 6
//       These were previously re-flagged after archival, creating loops.
function detectCrossPlatformAsymmetry(ctx) {
  const findings = [];
  const ALLOWLIST = {
    claude_only: [
      'skill-routing-injector.js', 'reflect-stop.js', 'reflect-stop-failure.js',
      'reflect-precompact.js', 'subagent-harness-inject.js', 'subagent-quality-gate.js',
      'task-verification-gate.js',
      // 2026-04-22: Claude-local orchestration tools (not meaningful on Gemini):
      'mirror-kachow.js',       // mirrors canonical hooks to kachow-mirror/ (scrubbed public)
      'ai-snapshot-stop.js',    // filesystem-specific snapshot logic
      'gsd-check-update.js',    // GSD plugin version check (Claude plugins only)
      'post-commit-sync-reminder.js', // monorepo dual-remote nudge (user's [tooling-dir])
      'repomap-refresh.js',     // calls user's [tooling-dir] tooling
      // 2026-05-01: Claude-only events (PostCompact, CwdChanged, FileChanged not in Gemini/Codex):
      'memory-post-compact.js', // PostCompact event — memory-compression coupling
      'cwd-changed-watcher.js', // CwdChanged event — file watch setup
      'file-changed-notify.js', // FileChanged event — context file change notification
    ],
    gemini_only: [
      'reflect-stop.js',
      'sync-claude-md.js', 'sync-claude-skills.js', 'sync-claude-agents.js',
      // Absorbed on Claude side (standalone Gemini copy intentional):
      'claude-gemini-json-sync.js',
      'sync-memory-dirs.js',
    ]
  };
  try {
    const claudeHooks = fs.readdirSync(path.join(ctx.configDir, 'hooks')).filter(f => f.endsWith('.js'));
    const geminiHooksDir = path.join(os.homedir(), '.gemini', 'hooks');
    if (!fs.existsSync(geminiHooksDir)) return findings;
    const geminiHooks = fs.readdirSync(geminiHooksDir).filter(f => f.endsWith('.js'));

    for (const c of claudeHooks) {
      if (!geminiHooks.includes(c) && !ALLOWLIST.claude_only.includes(c) && !c.startsWith('sync-gemini-')) {
        findings.push({
          rule: 'cross_platform_asymmetry',
          tier: 'SUGGEST',
          target: { type: 'hook', path: c },
          evidence: { present_on: 'claude', missing_on: 'gemini' },
          proposal: `Hook '${c}' on Claude but missing on Gemini. Mirror or add to allowlist.`,
          auto_applicable: true,  // mirror is reversible
          fingerprint_class: 'parity'
        });
      }
    }
    for (const g of geminiHooks) {
      if (!claudeHooks.includes(g) && !ALLOWLIST.gemini_only.includes(g) && !g.startsWith('sync-claude-')) {
        findings.push({
          rule: 'cross_platform_asymmetry',
          tier: 'SUGGEST',
          target: { type: 'hook', path: g },
          evidence: { present_on: 'gemini', missing_on: 'claude' },
          proposal: `Hook '${g}' on Gemini but missing on Claude. Mirror or add to allowlist.`,
          auto_applicable: true,
          fingerprint_class: 'parity'
        });
      }
    }
  } catch {}
  return findings;
}

// ── R10: dead_lib_module ──
// lib/*.js with zero `require('.../<name>')` refs in other hooks
function detectDeadLibModule(ctx) {
  const findings = [];
  try {
    const libDir = path.join(ctx.configDir, 'hooks', 'lib');
    if (!fs.existsSync(libDir)) return findings;
    const libFiles = fs.readdirSync(libDir).filter(f => f.endsWith('.js'));
    const hooksDir = path.join(ctx.configDir, 'hooks');
    const allHookContents = {};
    for (const f of fs.readdirSync(hooksDir).filter(x => x.endsWith('.js'))) {
      try { allHookContents[f] = fs.readFileSync(path.join(hooksDir, f), 'utf8'); } catch {}
    }
    // Also scan non-hook references: slash commands, scripts, settings.json, CI.
    // These sources invoke libs via CLI (node path/to/lib.js) or name-drop them in docs.
    // Without this, CLI-only libs like hook-topology, hook-selftest show up as "dead".
    const extraSources = [
      path.join(ctx.configDir, 'commands'),
      path.join(ctx.configDir, 'scripts'),
      path.join(ctx.configDir, '..', '.ai-context', 'commands'),
      path.join(ctx.configDir, '..', '.ai-context', 'scripts'),
      path.join(ctx.configDir, 'settings.json'),
    ];
    for (const src of extraSources) {
      try {
        const st = fs.statSync(src);
        if (st.isDirectory()) {
          for (const f of fs.readdirSync(src)) {
            const fp = path.join(src, f);
            try {
              const fst = fs.statSync(fp);
              if (fst.isFile()) allHookContents['__extra__' + fp] = fs.readFileSync(fp, 'utf8');
            } catch {}
          }
        } else if (st.isFile()) {
          allHookContents['__extra__' + src] = fs.readFileSync(src, 'utf8');
        }
      } catch {}
    }
    // Also scan subdirs of lib/ recursively (self-improvement/queue.js etc.)
    function walkLibDir(dir, refList) {
      try {
        for (const entry of fs.readdirSync(dir)) {
          // Skip archive/ subdirs — files there are intentionally retired
          if (entry === 'archive' || entry.startsWith('archive')) continue;
          const p = path.join(dir, entry);
          const st = fs.statSync(p);
          if (st.isDirectory()) walkLibDir(p, refList);
          else if (entry.endsWith('.js')) refList.push(p);
        }
      } catch {}
    }
    const allLibPaths = [];
    walkLibDir(libDir, allLibPaths);
    for (const libPath of allLibPaths) {
      const rel = path.relative(libDir, libPath).replace(/\\/g, '/');
      const lib = path.basename(libPath);
      const name = lib.replace(/\.js$/, '');
      let usedByCount = 0;
      for (const [_, content] of Object.entries(allHookContents)) {
        // Match: "lib/<name>", "lib/<rel>", literal filename, or path.join(..., 'lib', '<name>')
        if (
          content.includes(`lib/${name}`) ||
          content.includes(`lib/${rel}`) ||
          content.includes(lib) ||   // catches 'tier3-consolidation.js' literal in any string
          (content.includes(`'${name}'`) && content.includes("'lib'")) ||
          (content.includes(`"${name}"`) && content.includes('"lib"'))
        ) {
          usedByCount++;
        }
      }
      // Also self-improvement/* files cross-reference each other — count sibling refs
      for (const otherLib of allLibPaths) {
        if (otherLib === libPath) continue;
        try {
          const c = fs.readFileSync(otherLib, 'utf8');
          if (c.includes(`./${name}`) || c.includes(`/${name}`)) usedByCount++;
        } catch {}
      }
      // CLI-only libs — intentional standalone utilities, never required by hooks
      const CLI_ONLY_ALLOWLIST = new Set([
        'hook-topology.js',         // CLI: node lib/hook-topology.js
        'hook-interaction-map.js',  // CLI: node lib/hook-interaction-map.js
        'hook-selftest.js',         // CLI + CI: node lib/hook-selftest.js
        'memory-migrate.js',        // one-shot migration tool, invoked manually
      ]);
      if (usedByCount === 0 && !CLI_ONLY_ALLOWLIST.has(lib)) {
        findings.push({
          rule: 'dead_lib_module',
          tier: 'OBSERVE',
          target: { type: 'lib', path: libPath },
          evidence: { used_by_count: 0, relative: rel },
          proposal: `Library module '${rel}' has zero require() references. Archive or integrate.`,
          auto_applicable: false,
          fingerprint_class: 'dead_code'
        });
      }
    }
  } catch {}
  return findings;
}

// ── R15: session_start_p95_regression ──
// Measures TOTAL blocking SessionStart time (Phases 1+2+3) per session.
// v0.9.5: expanded from session-start-combined-only to full blocking pipeline.
// Respects telemetry epoch markers — only uses post-epoch data.
function detectSessionStartP95Regression(ctx) {
  const findings = [];
  try {
    const BLOCKING_SOURCES = ['session-start-combined', 'session-context-loader', 'session-health-fast'];
    const allEvents = ctx.readEvents(ctx.cwd, 7, { eventTypes: ['hook_timing', 'epoch_marker'] }) || [];
    const telemetryEpochMs = getTelemetryEpochMs(ctx.configDir);

    // Find latest episodic epoch marker, then combine with root telemetry epoch.
    let epochMs = telemetryEpochMs;
    for (const e of allEvents) {
      if (e.type !== 'epoch_marker') continue;
      const markerMs = Date.parse(e.ts || e.timestamp || '');
      if (Number.isFinite(markerMs) && markerMs > epochMs) epochMs = markerMs;
    }

    const events = allEvents
      .filter(e => e.type === 'hook_timing')
      .filter(e => eventAtOrAfterEpoch(e, epochMs));

    // Sum per-session across all blocking SessionStart hooks
    const perSession = new Map();
    for (const e of events) {
      if (!BLOCKING_SOURCES.includes(e.source) || !e.meta || typeof e.meta.total_ms !== 'number') continue;
      const sid = e.session_id || e.meta?.session_id || 'unknown';
      perSession.set(sid, (perSession.get(sid) || 0) + e.meta.total_ms);
    }
    const samples = [...perSession.values()].sort((a, b) => a - b);
    if (samples.length < 10) return findings;
    const idx = Math.max(0, Math.ceil(0.95 * samples.length) - 1);
    const p95 = samples[idx];
    const CEILING_MS = parseInt(process.env.SESSION_START_P95_CEILING_MS, 10) || 5000;
    if (p95 > CEILING_MS) {
      findings.push({
        rule: 'session_start_p95_regression',
        tier: 'BLOCKER',
        target: { type: 'hook', path: '~/.ai-context/hooks/ (SessionStart pipeline)' },
        evidence: { p95_ms: +p95.toFixed(1), ceiling_ms: CEILING_MS, sample_n: samples.length, epoch: epochMs ? new Date(epochMs).toISOString() : 'none' },
        proposal: `SessionStart p95=${p95.toFixed(0)}ms exceeds ${CEILING_MS}ms ceiling. Investigate via: node scripts/hook-utilization-report.mjs`,
        auto_applicable: false,
        fingerprint_class: 'hook_perf'
      });
    }
  } catch {}
  return findings;
}

// ── R17: skill_followed_by_bandaid_loop ──
// Skills invoked before bandaid-loop-detector fires ≥3 times in 14d may be
// causing loops (correlation ≠ causation — user triage required).
// JOIN at query time: for each bandaid_loop event, find skill_invoke events
// from same session_id with ts within preceding 20min. Count per-skill.
function detectSkillFollowedByBandaidLoop(ctx) {
  const findings = [];
  try {
    const bandaids = ctx.readEvents(ctx.cwd, 14, { eventTypes: ['bandaid_loop'] }) || [];
    if (bandaids.length === 0) return findings;
    const skillInvokes = ctx.readEvents(ctx.cwd, 14, { eventTypes: ['skill_invoke'] }) || [];
    const bySid = {};
    for (const s of skillInvokes) {
      const sid = s.session_id;
      const skill = s.payload?.skill || s.meta?.skill;
      if (!sid || !skill) continue;
      (bySid[sid] = bySid[sid] || []).push({ ts: new Date(s.ts).getTime(), skill });
    }
    const LOOKBACK_MS = 20 * 60 * 1000;
    const byName = {};
    for (const b of bandaids) {
      const sid = b.session_id;
      if (!sid || !bySid[sid]) continue;
      const bandaidTs = new Date(b.ts).getTime();
      for (const s of bySid[sid]) {
        if (s.ts < bandaidTs && (bandaidTs - s.ts) <= LOOKBACK_MS) {
          byName[s.skill] = (byName[s.skill] || 0) + 1;
        }
      }
    }
    for (const [skill, count] of Object.entries(byName)) {
      if (count >= 3) {
        findings.push({
          rule: 'skill_followed_by_bandaid_loop',
          tier: 'OBSERVE',
          target: { type: 'skill', path: skill },
          evidence: { loop_follow_count: count, window_days: 14, lookback_min: 20 },
          proposal: `Skill '${skill}' was invoked within 20min before a bandaid-loop ${count} times in 14d. May indicate the skill triggers unproductive edit loops. Manual triage needed — correlation ≠ causation.`,
          auto_applicable: false,
          fingerprint_class: 'skill_outcome'
        });
      }
    }
  } catch {}
  return findings;
}

// ── R18: tool_call_p95_regression ──
// Aggregate per-tool-call hook overhead (PostToolUse hooks) exceeds ceiling.
// Measures total hook time per tool call, not individual hook time.
function detectToolCallP95Regression(ctx) {
  const findings = [];
  try {
    const epochMs = getTelemetryEpochMs(ctx.configDir);
    const events = ctx.readEvents(ctx.cwd, 7, { eventTypes: ['hook_timing'] }) || [];
    // Collect PostToolUse hook timings, grouped by approximate tool-call timestamp
    // (hooks firing within 500ms of each other are the same tool call)
    const NON_TOOL_CALL_HOOKS = new Set([
      'session-start-combined', 'session-context-loader', 'session-end-logger',
      'auto-push-global', 'mirror-kachow', 'meta-system-stop', 'reflect-stop', 'dream-auto',
      'track-skill-usage', 'todowrite-persist', 'stop-sleep-consolidator', 'memory-rotate',
      'ai-snapshot-stop', 'session-presence-start', 'session-presence-end', 'enhanced-statusline',
      'plugin-update-checker', 'skill-upstream-checker', 'validate-instructions-sync',
      'gsd-check-update', 'auto-pull-global', 'skill-auto-updater', 'handoff-session-end',
      'notify-with-fallback', 'memory-post-compact', 'cwd-changed-watcher', 'file-changed-notify',
    ]);
    const postToolTimings = events
      .filter(e => eventAtOrAfterEpoch(e, epochMs))
      .filter(e => e.source && !NON_TOOL_CALL_HOOKS.has(e.source))
      .filter(e => e.meta && typeof e.meta.total_ms === 'number')
      .map(e => e.meta.total_ms);

    if (postToolTimings.length < 50) return findings; // need enough samples

    postToolTimings.sort((a, b) => a - b);
    const idx = Math.max(0, Math.ceil(0.95 * postToolTimings.length) - 1);
    const p95 = postToolTimings[idx];

    const CEILING_MS = parseInt(process.env.TOOL_CALL_P95_CEILING_MS, 10) || 200;
    if (p95 > CEILING_MS) {
      findings.push({
        rule: 'tool_call_p95_regression',
        tier: 'BLOCKER',
        target: { type: 'hook', path: 'PostToolUse hooks (aggregate)' },
        evidence: { p95_ms: +p95.toFixed(1), ceiling_ms: CEILING_MS, sample_n: postToolTimings.length },
        proposal: `PostToolUse aggregate p95=${p95.toFixed(0)}ms exceeds ${CEILING_MS}ms ceiling. Run hook-utilization-report.mjs to identify slowest hooks.`,
        auto_applicable: false,
        fingerprint_class: 'hook_perf'
      });
    }
  } catch {}
  return findings;
}

// ── R19: async_blocks_output ──
// Hook file registered as async:true but contains systemMessage or exit(2).
// Async hooks have stdout discarded — these would silently fail.
function detectAsyncBlocksOutput(ctx) {
  const findings = [];
  try {
    const settingsPath = path.join(ctx.configDir, 'settings.json');
    if (!fs.existsSync(settingsPath)) return findings;
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const hooks = settings.hooks || {};
    for (const [event, groups] of Object.entries(hooks)) {
      if (!Array.isArray(groups)) continue;
      for (const group of groups) {
        for (const h of (group.hooks || [])) {
          if (!h.async) continue;
          const cmd = h.command || '';
          const fileMatch = cmd.match(/node\s+["']?([^"'\s]+\.js)["']?/);
          if (!fileMatch) continue;
          let resolved = fileMatch[1].replace(/\$HOME/g, os.homedir()).replace(/\${HOME}/g, os.homedir());
          if (!resolved.startsWith('/') || !fs.existsSync(resolved)) continue;
          try {
            const src = fs.readFileSync(resolved, 'utf8');
            const hasMsg = /systemMessage/.test(src);
            const hasExit2 = /process\.exit\(2\)/.test(src);
            if (hasMsg || hasExit2) {
              const reasons = [];
              if (hasMsg) reasons.push('emits systemMessage');
              if (hasExit2) reasons.push('uses exit(2)');
              findings.push({
                rule: 'async_blocks_output',
                tier: 'BLOCKER',
                target: { type: 'hook', path: resolved },
                evidence: { event, async: true, reasons },
                proposal: `Hook '${path.basename(resolved)}' is async:true but ${reasons.join(' and ')}. Async stdout is DISCARDED. Remove async:true from settings.json.`,
                auto_applicable: true,
                fingerprint_class: 'hook_config'
              });
            }
          } catch {}
        }
      }
    }
  } catch {}
  return findings;
}

function runAllDetectors(ctx) {
  const allFindings = [];
  const detectors = [
    { name: 'R1', fn: detectHookTimeoutStreak },
    { name: 'R2', fn: detectHookErrorRecurring },
    { name: 'R3', fn: detectOrphanHooks },
    { name: 'R4', fn: detectSkillZeroInvocations },
    // R5 handled inline in meta-system-stop
    { name: 'R6', fn: detectMemoryHotUnpromoted },
    // R7 placeholder
    { name: 'R8', fn: detectSettingsDrift },
    { name: 'R9', fn: detectCrossPlatformAsymmetry },
    { name: 'R10', fn: detectDeadLibModule },
    { name: 'R11', fn: detectMemoryColdByRetrieval },
    { name: 'R12', fn: detectMemoryHotForPromotion },
    { name: 'R13', fn: detectMemoryFactExpired },
    { name: 'R14', fn: detectMemoryActiveForgetting },
    { name: 'R15', fn: detectSessionStartP95Regression },
    // R16 reserved (skill-coverage drop) — deferred until R15 proves pipeline
    { name: 'R17', fn: detectSkillFollowedByBandaidLoop },
    { name: 'R18', fn: detectToolCallP95Regression },
    { name: 'R19', fn: detectAsyncBlocksOutput }
  ];
  for (const { name, fn } of detectors) {
    try { allFindings.push(...fn(ctx)); }
    catch (e) { allFindings.push({ rule: '_detector_error', tier: 'OBSERVE', target: { type: 'detector', path: name }, evidence: { error: e.message } }); }
  }
  return allFindings;
}

module.exports = {
  detectHookTimeoutStreak,
  detectHookErrorRecurring,
  detectOrphanHooks,
  detectSkillZeroInvocations,
  detectSkillRegression,
  detectMemoryHotUnpromoted,
  detectSettingsDrift,
  detectCrossPlatformAsymmetry,
  detectDeadLibModule,
  detectMemoryColdByRetrieval,
  detectMemoryHotForPromotion,
  detectMemoryFactExpired,
  detectMemoryActiveForgetting,
  detectSessionStartP95Regression,
  detectSkillFollowedByBandaidLoop,
  detectToolCallP95Regression,
  detectAsyncBlocksOutput,
  runAllDetectors
};
