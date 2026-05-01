#!/usr/bin/env node
// harness-analytics.mjs — Passive harness effectiveness analytics.
// Zero-cost: reads existing observability data (episodic JSONL, rule-enforcement,
// skill-usage, prompt-hashes, per-prompt-overhead, hook-timing).
// No benchmarks needed — measures real usage patterns.
//
// Usage:
//   node harness-analytics.mjs                 # 7-day summary
//   node harness-analytics.mjs --days 30       # 30-day summary
//   node harness-analytics.mjs --json          # machine-readable output
//   node harness-analytics.mjs --compare       # compare this week vs last week

import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';

const home = homedir();
const args = process.argv.slice(2);
const DAYS = parseInt(args.find(a => a.match(/^\d+$/)) || args[args.indexOf('--days') + 1] || '7', 10);
const JSON_OUT = args.includes('--json');
const COMPARE = args.includes('--compare');

// ── Data sources ──

function readJsonl(filePath) {
  if (!existsSync(filePath)) return [];
  try {
    return readFileSync(filePath, 'utf8').split('\n').filter(Boolean).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

function readEpisodicEvents(days) {
  const cutoffMs = Date.now() - days * 86400000;
  const cutoff = new Date(cutoffMs > 0 ? cutoffMs : 0).toISOString().slice(0, 10);
  const events = [];
  const dirs = [];

  // Global episodic
  const globalEp = join(home, '.ai-context', 'memory', 'episodic');
  if (existsSync(globalEp)) dirs.push(globalEp);

  // Project episodic (scan all project memory dirs)
  const projectsDir = join(home, '.claude', 'projects');
  if (existsSync(projectsDir)) {
    try {
      for (const proj of readdirSync(projectsDir)) {
        const ep = join(projectsDir, proj, 'memory', 'episodic');
        if (existsSync(ep)) dirs.push(ep);
      }
    } catch {}
  }

  for (const dir of dirs) {
    try {
      for (const f of readdirSync(dir).filter(f => f.endsWith('.jsonl'))) {
        const date = f.slice(0, 10);
        if (date >= cutoff) {
          events.push(...readJsonl(join(dir, f)));
        }
      }
    } catch {}
  }
  return events;
}

// ── Metrics ──

function computeMetrics(events, days) {
  const m = {
    period_days: days,
    total_events: events.length,

    // Session metrics
    sessions: 0,
    avg_session_duration_min: 0,

    // Hook performance
    hook_fires_total: 0,
    hook_errors_total: 0,
    hook_error_rate_pct: 0,
    hook_p50_ms: 0,
    hook_p95_ms: 0,
    hooks_blocked: 0,         // how many times hooks prevented bad actions

    // Guard effectiveness (the KEY metric — did guards actually catch things?)
    guards_fired: {
      autosave_before_destructive: 0,
      block_subagent_writes: 0,
      identity_guard_block: 0,
      injection_warning: 0,
      bandaid_loop_warning: 0,
      context_pressure_warning: 0,
      verifiedby_nudge: 0,
      prefer_editing_nudge: 0,
      settings_validation_block: 0,
      async_blocks_output: 0,
    },

    // Skill usage
    skills_invoked: 0,
    unique_skills: new Set(),
    top_skills: {},

    // Model dispatch
    agent_dispatches: 0,
    model_missing_count: 0,
    model_policy_violations: 0,
    model_cost_units: 0,      // relative cost (haiku=1, sonnet=5, opus=25)

    // Memory system
    memories_retrieved: 0,
    peer_card_retrievals: 0,

    // Self-improvement
    findings_detected: 0,
    findings_resolved: 0,
    blockers_detected: 0,

    // Regression detection
    skill_regressions: 0,
    hook_p95_regressions: 0,
  };

  const sessionStarts = {};
  const sessionEnds = {};
  const hookTimings = [];

  for (const e of events) {
    const type = e.type || '';
    const source = e.source || '';

    // Sessions
    if (type === 'session_start') {
      m.sessions++;
      if (e.session_id) sessionStarts[e.session_id] = new Date(e.ts).getTime();
    }
    if (type === 'session_end' && e.session_id) {
      sessionEnds[e.session_id] = new Date(e.ts).getTime();
    }

    // Hook timing
    if (type === 'hook_timing') {
      m.hook_fires_total++;
      const ms = e.meta?.total_ms || 0;
      hookTimings.push(ms);
    }

    // Hook errors
    if (type === 'hook_errors') m.hook_errors_total++;

    // Guard fires
    if (type === 'autosave_triggered') m.guards_fired.autosave_before_destructive++;
    if (type === 'subagent_write_blocked') m.guards_fired.block_subagent_writes++;
    if (type === 'identity_guard_fire' && e.meta?.decision === 'block') m.guards_fired.identity_guard_block++;
    if (type === 'injection_warning') m.guards_fired.injection_warning++;
    if (type === 'bandaid_loop') m.guards_fired.bandaid_loop_warning++;
    if (type === 'context_pressure_warning' || type === 'context_pressure_block') m.guards_fired.context_pressure_warning++;
    if (type === 'verifiedby_nudge') m.guards_fired.verifiedby_nudge++;
    if (type === 'prefer_editing_nudge') m.guards_fired.prefer_editing_nudge++;
    if (type === 'settings_validation_block') m.guards_fired.settings_validation_block++;

    // Skills
    if (type === 'skill_invoke') {
      m.skills_invoked++;
      const skill = e.payload?.skill || e.meta?.skill || 'unknown';
      m.unique_skills.add(skill);
      m.top_skills[skill] = (m.top_skills[skill] || 0) + 1;
    }

    // Self-improvement
    if (type === 'self_improvement_finding') m.findings_detected++;
    if (type === 'self_improvement_resolved') m.findings_resolved++;
    if (type === 'skill_regression_detected') m.skill_regressions++;

    // Memory
    if (type === 'memory_retrieval') m.memories_retrieved++;
  }

  // Agent dispatch data (separate log)
  const ruleLog = readJsonl(join(home, '.ai-context', 'instances', 'rule-enforcement.jsonl'));
  const cutoff = Date.now() - days * 86400000;
  for (const entry of ruleLog) {
    const ts = new Date(entry.timestamp).getTime();
    if (ts < cutoff) continue;
    m.agent_dispatches++;
    if (entry.model === 'MISSING') m.model_missing_count++;
    if (entry.warnings > 0) m.model_policy_violations++;
    m.model_cost_units += entry.cost_multiplier || 0;
  }

  // Session duration
  const durations = [];
  for (const [sid, start] of Object.entries(sessionStarts)) {
    if (sessionEnds[sid]) {
      durations.push((sessionEnds[sid] - start) / 60000);
    }
  }
  if (durations.length > 0) {
    m.avg_session_duration_min = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
  }

  // Hook timing percentiles
  hookTimings.sort((a, b) => a - b);
  if (hookTimings.length > 0) {
    m.hook_p50_ms = hookTimings[Math.floor(hookTimings.length * 0.50)];
    m.hook_p95_ms = hookTimings[Math.floor(hookTimings.length * 0.95)];
  }
  m.hook_error_rate_pct = m.hook_fires_total > 0
    ? +(m.hook_errors_total / m.hook_fires_total * 100).toFixed(2)
    : 0;

  // Total guards blocked
  m.hooks_blocked = Object.values(m.guards_fired).reduce((a, b) => a + b, 0);

  // Convert Set to count
  m.unique_skills_count = m.unique_skills.size;
  delete m.unique_skills;

  // Top 5 skills
  m.top_skills = Object.entries(m.top_skills)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  return m;
}

// ── Output ──

function printReport(m, label) {
  console.log(`\n# Harness Analytics — ${label} (${m.period_days}d)\n`);

  console.log('## Session Activity');
  console.log(`  Sessions: ${m.sessions}`);
  console.log(`  Avg duration: ${m.avg_session_duration_min} min`);
  console.log(`  Events recorded: ${m.total_events}`);

  console.log('\n## Hook Performance');
  console.log(`  Total fires: ${m.hook_fires_total}`);
  console.log(`  p50: ${m.hook_p50_ms?.toFixed(1)}ms  p95: ${m.hook_p95_ms?.toFixed(1)}ms`);
  console.log(`  Error rate: ${m.hook_error_rate_pct}%`);

  console.log('\n## Guard Effectiveness (the value metric)');
  console.log(`  Total interventions: ${m.hooks_blocked}`);
  for (const [guard, count] of Object.entries(m.guards_fired)) {
    if (count > 0) console.log(`    ${guard}: ${count}`);
  }
  if (m.hooks_blocked === 0) console.log('    (no interventions — either clean work or guards not firing)');

  console.log('\n## Skill Usage');
  console.log(`  Invocations: ${m.skills_invoked} (${m.unique_skills_count} unique)`);
  if (m.top_skills.length > 0) {
    console.log('  Top 5:');
    for (const s of m.top_skills) console.log(`    ${s.name}: ${s.count}`);
  }

  console.log('\n## Agent Dispatch');
  console.log(`  Total dispatches: ${m.agent_dispatches}`);
  console.log(`  Model missing: ${m.model_missing_count} (${m.agent_dispatches > 0 ? (m.model_missing_count/m.agent_dispatches*100).toFixed(0) : 0}%)`);
  console.log(`  Policy violations: ${m.model_policy_violations}`);
  console.log(`  Cost units: ${m.model_cost_units} (haiku=1 baseline)`);

  console.log('\n## Self-Improvement');
  console.log(`  Findings detected: ${m.findings_detected}`);
  console.log(`  Findings resolved: ${m.findings_resolved}`);
  console.log(`  Skill regressions: ${m.skill_regressions}`);

  console.log('\n## Memory');
  console.log(`  Retrievals: ${m.memories_retrieved}`);
}

// ── Main ──

const events = readEpisodicEvents(DAYS);
const current = computeMetrics(events, DAYS);

if (JSON_OUT) {
  console.log(JSON.stringify(current, null, 2));
} else if (COMPARE) {
  const olderEvents = readEpisodicEvents(DAYS * 2).filter(e => {
    const ts = new Date(e.ts).getTime();
    return ts < Date.now() - DAYS * 86400000;
  });
  const older = computeMetrics(olderEvents, DAYS);

  printReport(older, `Previous ${DAYS}d`);
  printReport(current, `Current ${DAYS}d`);

  console.log(`\n## Comparison (current vs previous ${DAYS}d)`);
  const pct = (curr, prev) => prev > 0 ? `${((curr - prev) / prev * 100).toFixed(0)}%` : 'n/a';
  console.log(`  Sessions: ${current.sessions} vs ${older.sessions} (${pct(current.sessions, older.sessions)})`);
  console.log(`  Hook fires: ${current.hook_fires_total} vs ${older.hook_fires_total} (${pct(current.hook_fires_total, older.hook_fires_total)})`);
  console.log(`  Guard interventions: ${current.hooks_blocked} vs ${older.hooks_blocked} (${pct(current.hooks_blocked, older.hooks_blocked)})`);
  console.log(`  Hook p95: ${current.hook_p95_ms?.toFixed(1)}ms vs ${older.hook_p95_ms?.toFixed(1)}ms`);
  console.log(`  Skills invoked: ${current.skills_invoked} vs ${older.skills_invoked}`);
  console.log(`  Agent cost units: ${current.model_cost_units} vs ${older.model_cost_units}`);
} else {
  printReport(current, 'Current');
}
