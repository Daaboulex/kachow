#!/usr/bin/env node
// Stop hook: meta-system detectors (skill regression + research scheduler)
// Phase 8 REQ-08-02, REQ-08-03
// Advisory only — writes findings to semantic files, never auto-modifies.


const TIMER_START = process.hrtime.bigint();
function __emitTiming(errCount) {
  try {
    const total_ms = Number(process.hrtime.bigint() - TIMER_START) / 1e6;
    require('./lib/observability-logger.js').logEvent(process.cwd(), {
      type: 'hook_timing',
      source: 'meta-system-stop',
      meta: { total_ms: +total_ms.toFixed(3), error_count: errCount || 0 },
    });
  } catch {}
}

const fs = require('fs');
const path = require('path');
const os = require('os');

const home = os.homedir();
const configDir = path.join(home, '.claude');
const cwd = process.cwd();
const messages = [];

// Constants centralized in lib/constants.js (CI-001)
const { SKILL_REGRESSION_DROP_THRESHOLD, SKILL_MIN_INVOCATIONS, RESEARCH_COOLDOWN_MS: RES_COOLDOWN, RESEARCH_MIN_SESSIONS: RES_MIN_SESSIONS } = require(path.join(configDir, 'hooks', 'lib', 'constants.js'));
const { readCounter } = require(path.join(configDir, 'hooks', 'lib', 'atomic-counter.js'));

// --- Section A: Skill Regression Detector ---
// D-05 adapted: success field absent from skill_invoke events — using frequency
// analysis instead. >50% drop in invocation rate between two 7-day windows = regression.
try {
  const { readEvents, logEvent } = require(path.join(configDir, 'hooks', 'lib', 'observability-logger.js'));
  const { archiveAndWrite } = require(path.join(configDir, 'hooks', 'lib', 'tier3-consolidation.js'));

  const allEvents = readEvents(cwd, 14, { eventTypes: ['skill_invoke'] });

  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const cutoff = new Date(now - sevenDaysMs).toISOString();

  // Split into two 7-day windows: recent (days 1-7) and older (days 8-14)
  const recent = {}, older = {};
  for (const e of allEvents) {
    const skill = e.payload && e.payload.skill;
    if (!skill) continue;
    if (e.ts >= cutoff) {
      recent[skill] = (recent[skill] || 0) + 1;
    } else {
      older[skill] = (older[skill] || 0) + 1;
    }
  }

  const regressions = [];
  const allSkills = new Set([...Object.keys(recent), ...Object.keys(older)]);
  for (const skill of allSkills) {
    const r = recent[skill] || 0;
    const o = older[skill] || 0;
    if (r + o < SKILL_MIN_INVOCATIONS) continue; // skip low-signal skills
    if (o > 0 && r < o * SKILL_REGRESSION_DROP_THRESHOLD) {
      const drop = Math.round((1 - r / o) * 100);
      regressions.push({ skill, older: o, recent: r, drop });
    }
  }

  if (regressions.length > 0) {
    // Find semantic dir: project memory dir pattern (same as dream-auto.js findMemoryDir)
    let semanticDir = null;
    for (const candidate of ['.ai-context/memory', '.claude/memory']) {
      const fullPath = path.join(cwd, candidate);
      if (fs.existsSync(path.join(fullPath, 'MEMORY.md'))) {
        semanticDir = path.join(fullPath, 'semantic');
        break;
      }
    }
    if (!semanticDir) {
      const sanitized = cwd.replace(/\//g, '-');
      semanticDir = path.join(configDir, 'projects', sanitized, 'memory', 'semantic');
    }

    const today = new Date().toISOString().slice(0, 10);
    const rows = regressions.map(r =>
      `| ${r.skill} | ${r.older} | ${r.recent} | ${r.drop}% | ${today} |`
    ).join('\n');
    const content = `# Skill Health\n\n| Skill | Older 7d | Recent 7d | Drop | Detected |\n|-------|---------|-----------|------|----------|\n${rows}\n`;

    archiveAndWrite(path.join(semanticDir, 'skill-health.md'), content);
    logEvent(cwd, { type: 'skill_regression_detected', source: 'meta-system-stop', meta: { regressions } });
    messages.push(`[skill-regression] ${regressions.length} skill(s) show >50% frequency drop: ${regressions.map(r => r.skill).join(', ')}. See skill-health.md.`);
  }
} catch (e) {
  // SF-002: log silent failures
  try { process.stderr.write(`meta-system-stop regression: ${e.message}\n`); } catch {}
  try { require(path.join(configDir, 'hooks', 'lib', 'observability-logger.js')).logEvent(cwd, { type: 'hook_errors', source: 'meta-system-stop', errors: [{ section: 'skill-regression', error: e.message }] }); } catch {}
}

// --- Section B: Research Scheduler ---
// Dual-gate: 30 days (Gate 1) + 20 sessions (Gate 2). Both must pass.
// Counters NOT reset here — reset by the research command after success.
try {
  const researchLastFile = path.join(configDir, '.research-last');
  const researchCounterFile = path.join(configDir, '.research-session-count');

  // Gate 1: time cooldown
  let lastTime = 0;
  try { lastTime = fs.statSync(researchLastFile).mtimeMs; } catch {}
  if ((Date.now() - lastTime) < RES_COOLDOWN) throw new Error('gate1');

  // Gate 2: session count (RC-001: atomic read)
  const sessionCount = readCounter(researchCounterFile);
  if (sessionCount < RES_MIN_SESSIONS) throw new Error('gate2');

  // Both gates passed
  const { logEvent } = require(path.join(configDir, 'hooks', 'lib', 'observability-logger.js'));
  logEvent(cwd, { type: 'research_refresh_trigger', source: 'meta-system-stop' });
  messages.push(`[research-scheduler] 30-day research refresh due. Run background research agent to update: Claude Code changelog since last review, hook/skill/settings schema changes, native memory subsystem updates. After completion, touch ${researchLastFile} and write '0' to ${researchCounterFile}.`);
} catch (e) {
  // SF-002: log gate failures (errors named 'gate1'/'gate2' are normal skips, not errors)
  if (e.message !== 'gate1' && e.message !== 'gate2') {
    try { process.stderr.write(`meta-system-stop research: ${e.message}\n`); } catch {}
    try { require(path.join(configDir, 'hooks', 'lib', 'observability-logger.js')).logEvent(cwd, { type: 'hook_errors', source: 'meta-system-stop', errors: [{ section: 'research-scheduler', error: e.message }] }); } catch {}
  }
}

// --- Section C: Self-Improvement Detectors (R1, R2, R3, R4, R6, R8, R9, R10) ---
// Dual-gated: runs only when dream-auto gate fires (24h OR 5 sessions). R2 (BLOCKERs)
// always runs regardless of gate. Findings written to self-improvements-pending.jsonl.
try {
  const { logEvent } = require(path.join(configDir, 'hooks', 'lib', 'observability-logger.js'));
  const queue = require(path.join(configDir, 'hooks', 'lib', 'self-improvement', 'queue.js'));
  const { runAllDetectors, detectHookErrorRecurring } = require(path.join(configDir, 'hooks', 'lib', 'self-improvement', 'detectors.js'));
  const { readEvents } = require(path.join(configDir, 'hooks', 'lib', 'observability-logger.js'));

  // BLOCKER rule always runs (R2 — hook_error_recurring)
  const ctx = { cwd, configDir, readEvents };
  const blockerFindings = detectHookErrorRecurring(ctx);
  for (const f of blockerFindings) {
    const stored = queue.enqueue(f);
    if (stored && !stored.suppressed) logEvent(cwd, { type: 'self_improvement_enqueued', source: 'meta-system-stop', meta: { rule: f.rule, tier: f.tier, id: stored.id } });
  }

  // Full detector chain runs on dual-gate (24h OR 5 sessions); cheaper than running every Stop
  const dreamLastFile = path.join(configDir, '.dream-last');
  const dreamCounter = path.join(configDir, '.dream-session-count');
  let shouldRunFull = false;
  try {
    const mt = fs.statSync(dreamLastFile).mtimeMs;
    if ((Date.now() - mt) > 24 * 60 * 60 * 1000) shouldRunFull = true;
  } catch { shouldRunFull = true; }
  try {
    const count = parseInt(fs.readFileSync(dreamCounter, 'utf8')) || 0;
    if (count >= 5) shouldRunFull = true;
  } catch {}

  if (shouldRunFull) {
    const allFindings = runAllDetectors(ctx);
    let enqueued = 0;
    for (const f of allFindings) {
      const stored = queue.enqueue(f);
      if (stored && !stored.suppressed) enqueued++;
    }
    const summary = queue.summary();
    if (enqueued > 0) {
      messages.push(`[self-improvement] ${enqueued} new finding(s); queue: ${summary.BLOCKER} BLOCKER, ${summary.SUGGEST} SUGGEST, ${summary.OBSERVE} OBSERVE. Run /review-improvements.`);
    }
    logEvent(cwd, { type: 'self_improvement_scan_run', source: 'meta-system-stop', meta: { findings_count: allFindings.length, enqueued_count: enqueued, ...summary } });
  }
} catch (e) {
  try { process.stderr.write(`meta-system-stop self-improvement: ${e.message}\n`); } catch {}
  try { require(path.join(configDir, 'hooks', 'lib', 'observability-logger.js')).logEvent(cwd, { type: 'hook_errors', source: 'meta-system-stop', errors: [{ section: 'self-improvement', error: e.message }] }); } catch {}
}

// --- Output ---
if (messages.length > 0) {
  __emitTiming(0); process.stdout.write(JSON.stringify({
      continue: true, systemMessage: messages.join('\n') }));
} else {
  __emitTiming(0); process.stdout.write('{"continue":true}');
}
