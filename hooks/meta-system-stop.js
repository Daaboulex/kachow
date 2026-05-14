#!/usr/bin/env node
require(__dirname + '/lib/safety-timeout.js');
// Consolidated Stop hook: self-improvement + session reflection + memory consolidation
// Absorbs: reflect-stop, dream-auto, ai-snapshot-stop (simplified)
// Advisory only — writes findings to semantic files, never auto-modifies.

const fs = require('fs');
const path = require('path');
const os = require('os');

const home = os.homedir();
const tp = require('./lib/tool-paths.js');
const configDir = tp.configDir;
const cwd = process.cwd();
const messages = [];

// ═══════════════════════════════════════════════════════════════
// Phase 1: Session Reflection (from reflect-stop)
// Detect if meaningful work was done; nudge /wrap-up if so.
// ═══════════════════════════════════════════════════════════════
try {
  const { detectTool } = require('./lib/tool-detect.js');
  const tool = detectTool();

  const wrapUpDone = path.join(configDir, '.wrapup-done');
  const reflectLast = path.join(configDir, '.reflect-last');
  const REFLECT_COOLDOWN_MS = 15 * 60 * 1000;

  let lastReflect = 0;
  try { lastReflect = fs.statSync(reflectLast).mtimeMs; } catch {}
  const reflectElapsed = Date.now() - lastReflect;

  if (reflectElapsed >= REFLECT_COOLDOWN_MS) {
    fs.writeFileSync(reflectLast, '');

    let wrapUpRecent = false;
    try { wrapUpRecent = (Date.now() - fs.statSync(wrapUpDone).mtimeMs) < REFLECT_COOLDOWN_MS; } catch {}

    if (!wrapUpRecent) {
      let aiContextChanged = false;
      const aiDir = path.join(home, '.ai-context');
      const thirtyMin = 30 * 60 * 1000;
      const now = Date.now();
      for (const sub of ['core/memory', 'modules/hooks/src', 'generated/configs', 'AGENTS.md']) {
        try {
          if ((now - fs.statSync(path.join(aiDir, sub)).mtimeMs) < thirtyMin) {
            aiContextChanged = true;
            break;
          }
        } catch {}
      }

      if (aiContextChanged) {
        messages.push('[session-end] Changes detected. Run /wrap-up to capture learnings, or /handoff for fast state save.');
      }
    }
  }
} catch {}

// ═══════════════════════════════════════════════════════════════
// Phase 2: Memory Consolidation Trigger (from dream-auto)
// Dual-gate: 24h + 5 sessions since last consolidation.
// ═══════════════════════════════════════════════════════════════
try {
  const sharedDir = path.join(home, '.ai-context');
  const dreamLastFile = path.join(sharedDir, '.dream-last');
  const dreamCounterFile = path.join(sharedDir, '.dream-session-count');
  const { DREAM_COOLDOWN_MS, DREAM_MIN_SESSIONS } = require('./lib/constants.js');
  const { readCounter } = require('./lib/atomic-counter.js');

  let dreamLastTime = 0;
  try { dreamLastTime = fs.statSync(dreamLastFile).mtimeMs; } catch {}
  const dreamElapsed = Date.now() - dreamLastTime;

  if (dreamElapsed >= DREAM_COOLDOWN_MS) {
    const sessionCount = readCounter(dreamCounterFile);
    if (sessionCount >= DREAM_MIN_SESSIONS) {
      const memDir = path.join(sharedDir, 'core', 'memory');
      const memDirLegacy = path.join(sharedDir, 'memory');
      const effectiveMemDir = fs.existsSync(memDir) ? memDir : memDirLegacy;
      let fileCount = 0;
      try {
        fileCount = fs.readdirSync(effectiveMemDir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md').length;
      } catch {}

      if (fileCount >= 5) {
        const daysSince = Math.round(dreamElapsed / 86400000);
        messages.push(`[memory] Consolidation overdue (${sessionCount} sessions, ${daysSince}d). Run /consolidate-memory — ${fileCount} memory files.`);
      }
    }
  }
} catch {}

// ═══════════════════════════════════════════════════════════════
// Phase 3: Self-Improvement Detectors
// BLOCKER always runs. Full scan dual-gated (24h OR 5 sessions).
// ═══════════════════════════════════════════════════════════════
try {
  const { logEvent } = require(path.join(configDir, 'hooks', 'lib', 'observability-logger.js'));
  const queue = require(path.join(configDir, 'hooks', 'lib', 'self-improvement', 'queue.js'));
  const { runAllDetectors, detectHookErrorRecurring } = require(path.join(configDir, 'hooks', 'lib', 'self-improvement', 'detectors.js'));
  const { readEvents } = require(path.join(configDir, 'hooks', 'lib', 'observability-logger.js'));

  const ctx = { cwd, configDir, readEvents };
  const blockerFindings = detectHookErrorRecurring(ctx);
  for (const f of blockerFindings) {
    const stored = queue.enqueue(f);
    if (stored && !stored.suppressed) {
      logEvent(cwd, { type: 'self_improvement_enqueued', source: 'meta-system-stop', meta: { rule: f.rule, tier: f.tier, id: stored.id } });
    }
  }

  const dreamLastFile = path.join(configDir, '.dream-last');
  const dreamCounter = path.join(configDir, '.dream-session-count');
  let shouldRunFull = false;
  try {
    if ((Date.now() - fs.statSync(dreamLastFile).mtimeMs) > 24 * 60 * 60 * 1000) shouldRunFull = true;
  } catch { shouldRunFull = true; }
  try {
    if (parseInt(fs.readFileSync(dreamCounter, 'utf8')) >= 5) shouldRunFull = true;
  } catch {}

  if (shouldRunFull) {
    const lockFile = path.join(os.tmpdir(), 'claude-self-improve-lock');
    let lockAcquired = false;
    try {
      const fd = fs.openSync(lockFile, 'wx');
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      lockAcquired = true;
    } catch {
      try {
        if (Date.now() - fs.statSync(lockFile).mtimeMs > 5 * 60 * 1000) fs.unlinkSync(lockFile);
      } catch {}
    }

    if (lockAcquired) {
      try {
        const allFindings = runAllDetectors(ctx);
        let enqueued = 0;
        for (const f of allFindings) {
          const stored = queue.enqueue(f);
          if (stored && !stored.suppressed && (stored.seen_count || 1) === 1) enqueued++;
        }
        const summary = queue.summary();
        if (enqueued > 0) {
          messages.push(`[self-improvement] ${enqueued} new finding(s); queue: ${summary.BLOCKER} BLOCKER, ${summary.SUGGEST} SUGGEST, ${summary.OBSERVE} OBSERVE. Run /review-improvements.`);
        }

        try {
          const activeIds = new Set(allFindings.map(f => queue.hashId(f.rule, f.target?.path || f.target?.type || 'global', '')));
          queue.autoResolveStaleObserve((id) => activeIds.has(id));
        } catch {}
      } finally {
        try { fs.unlinkSync(lockFile); } catch {};
      }
    }
  }
} catch (e) {
  try { require('./lib/hook-logger.js').logError('meta-system-stop', e); } catch {};
}

// ═══════════════════════════════════════════════════════════════
// Phase 4: Skill Regression Detector
// Per-session-rate normalized. Compares 7-day windows.
// ═══════════════════════════════════════════════════════════════
try {
  const { readEvents, logEvent } = require(path.join(configDir, 'hooks', 'lib', 'observability-logger.js'));
  const { archiveAndWrite } = require(path.join(configDir, 'hooks', 'lib', 'tier3-consolidation.js'));
  const { SKILL_REGRESSION_DROP_THRESHOLD, SKILL_MIN_INVOCATIONS, MIN_SESSIONS_PER_WINDOW, SKILL_REGRESSION_EXEMPT } = require('./lib/constants.js');

  const allSkillEvents = readEvents(cwd, 14, { eventTypes: ['skill_invoke'] });
  const allSessionEvents = readEvents(cwd, 14, { eventTypes: ['session_start'] });

  const now = Date.now();
  const cutoff = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

  let sessionsRecent = 0, sessionsOlder = 0;
  for (const e of allSessionEvents) {
    if (e.ts >= cutoff) sessionsRecent++; else sessionsOlder++;
  }

  if (sessionsRecent >= MIN_SESSIONS_PER_WINDOW && sessionsOlder >= MIN_SESSIONS_PER_WINDOW) {
    const recent = {}, older = {};
    for (const e of allSkillEvents) {
      const skill = (e.payload && e.payload.skill) || (e.meta && e.meta.skill);
      if (!skill || SKILL_REGRESSION_EXEMPT.has(skill)) continue;
      if (e.ts >= cutoff) recent[skill] = (recent[skill] || 0) + 1;
      else older[skill] = (older[skill] || 0) + 1;
    }

    const regressions = [];
    for (const skill of new Set([...Object.keys(recent), ...Object.keys(older)])) {
      const r = recent[skill] || 0, o = older[skill] || 0;
      if (r + o < SKILL_MIN_INVOCATIONS) continue;
      const rateRecent = r / sessionsRecent, rateOlder = o / sessionsOlder;
      if (rateOlder > 0 && rateRecent < rateOlder * SKILL_REGRESSION_DROP_THRESHOLD) {
        regressions.push({ skill, drop: Math.round((1 - rateRecent / rateOlder) * 100), rateOlder: +rateOlder.toFixed(2), rateRecent: +rateRecent.toFixed(2) });
      }
    }

    if (regressions.length > 0) {
      messages.push(`[skill-regression] ${regressions.length} skill(s) show >50% rate drop: ${regressions.map(r => r.skill).join(', ')}.`);
      try {
        const queue = require(path.join(configDir, 'hooks', 'lib', 'self-improvement', 'queue.js'));
        for (const r of regressions) {
          queue.enqueue({
            rule: 'skill_regression', tier: 'SUGGEST',
            target: { type: 'skill', path: r.skill },
            evidence: r,
            proposal: `Skill '${r.skill}' rate dropped ${r.drop}%: ${r.rateOlder}/sess → ${r.rateRecent}/sess.`,
            auto_applicable: false, fingerprint_class: 'skill_regression',
          });
        }
      } catch {}
    }
  }
} catch {}

// ═══════════════════════════════════════════════════════════════
// Output
// ═══════════════════════════════════════════════════════════════
if (messages.length > 0) {
  process.stdout.write(JSON.stringify({ continue: true, systemMessage: messages.join('\n') }));
} else {
  process.stdout.write('{"continue":true}');
}
