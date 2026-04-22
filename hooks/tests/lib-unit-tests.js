#!/usr/bin/env node
// lib-unit-tests.js — Minimal zero-dep Node test runner for hooks/lib/*.js
//
// Usage:
//   node hooks/tests/lib-unit-tests.js          # run all
//   node hooks/tests/lib-unit-tests.js --filter handoff
//
// Exit code: 0 all pass, 1 any fail.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const LIB_DIR = path.join(__dirname, '..', 'lib');
const filter = (process.argv.find(a => a.startsWith('--filter=')) || '').split('=')[1] || '';

const results = [];
let currentSuite = '';

function suite(name, fn) {
  if (filter && !name.toLowerCase().includes(filter.toLowerCase())) return;
  currentSuite = name;
  try { fn(); }
  catch (e) { results.push({ suite: name, test: '(suite-level)', ok: false, err: e.message }); }
}

function test(name, fn) {
  try {
    fn();
    results.push({ suite: currentSuite, test: name, ok: true });
  } catch (e) {
    results.push({ suite: currentSuite, test: name, ok: false, err: e.message, stack: e.stack?.split('\n').slice(0, 4).join('\n  ') });
  }
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'libunit-'));
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

// ═══════════════════════════════════════════════════════════
// atomic-counter
// ═══════════════════════════════════════════════════════════
suite('atomic-counter', () => {
  const { incrementCounter } = require(path.join(LIB_DIR, 'atomic-counter.js'));
  const dir = tempDir();
  const file = path.join(dir, 'counter');

  test('first increment returns 1', () => {
    assert.strictEqual(incrementCounter(file), 1);
  });
  test('subsequent increments monotonic', () => {
    incrementCounter(file);
    incrementCounter(file);
    assert.strictEqual(incrementCounter(file), 4);
  });
  test('100 sequential increments = 104', () => {
    for (let i = 0; i < 100; i++) incrementCounter(file);
    assert.strictEqual(incrementCounter(file), 105);
  });
  cleanup(dir);
});

// ═══════════════════════════════════════════════════════════
// handoff-progress
// ═══════════════════════════════════════════════════════════
suite('handoff-progress', () => {
  const { parseHandoff, summaryBadge } = require(path.join(LIB_DIR, 'handoff-progress.js'));

  test('all checked → pct 100', () => {
    const r = parseHandoff('- [x] one\n- [x] two\n- [x] three\n');
    assert.strictEqual(r.total, 3);
    assert.strictEqual(r.done, 3);
    assert.strictEqual(r.pct, 100);
  });
  test('all pending → pct 0', () => {
    const r = parseHandoff('- [ ] one\n- [ ] two\n');
    assert.strictEqual(r.pct, 0);
    assert.strictEqual(r.pendingItems.length, 2);
  });
  test('mixed → correct %', () => {
    const r = parseHandoff('- [x] done\n- [ ] pending\n- [x] done2\n- [ ] pending2\n');
    assert.strictEqual(r.pct, 50);
  });
  test('numbered items under action section → pending', () => {
    const r = parseHandoff('## Needs Human Testing\n1. alpha\n2. beta\n3. gamma\n');
    assert.strictEqual(r.total, 3);
    assert.strictEqual(r.pending, 3);
    assert.ok(r.pendingItems[0].includes('[Needs Human Testing]'));
  });
  test('empty → pct 100 (no items)', () => {
    const r = parseHandoff('# Handoff\n\nNothing here.\n');
    assert.strictEqual(r.total, 0);
    assert.strictEqual(r.pct, 100);
  });
  test('summaryBadge null on empty', () => {
    const r = parseHandoff('');
    assert.strictEqual(summaryBadge(r), null);
  });
  test('summaryBadge shows pct on partial', () => {
    const r = parseHandoff('- [ ] one\n- [x] two\n');
    const b = summaryBadge(r);
    assert.ok(b && b.includes('50%'));
  });
});

// ═══════════════════════════════════════════════════════════
// hook-interaction-map
// ═══════════════════════════════════════════════════════════
suite('hook-interaction-map', () => {
  const { analyzeHook, renderMarkdown, buildMap } = require(path.join(LIB_DIR, 'hook-interaction-map.js'));

  test('sanitizePath replaces /home/USER with ~', () => {
    const fakeMap = { generated: 't', hooksDir: '/home/testuser/proj/hooks', count: 0, hooks: [] };
    const md = renderMarkdown(fakeMap);
    assert.ok(md.includes('~/proj/hooks'), 'expected ~/proj/hooks in: ' + md.slice(0, 200));
    assert.ok(!md.includes('/home/testuser/'));
  });
  test('sanitize=false preserves path', () => {
    const fakeMap = { generated: 't', hooksDir: '/home/testuser/proj/hooks', count: 0, hooks: [] };
    const md = renderMarkdown(fakeMap, { sanitize: false });
    assert.ok(md.includes('/home/testuser/'));
  });
  test('buildMap returns hooks array', () => {
    const map = buildMap(LIB_DIR, '/nonexistent-settings.json');
    assert.ok(Array.isArray(map.hooks));
    assert.ok(map.count > 0);
  });
});

// ═══════════════════════════════════════════════════════════
// hook-timer
// ═══════════════════════════════════════════════════════════
suite('hook-timer', () => {
  const { timed, getTimings, reset } = require(path.join(LIB_DIR, 'hook-timer.js'));

  test('timed records duration', () => {
    reset();
    timed('fast', () => { /* noop */ });
    const t = getTimings();
    assert.strictEqual(t.length, 1);
    assert.strictEqual(t[0].section, 'fast');
    assert.ok(t[0].duration_ms >= 0);
    assert.strictEqual(t[0].ok, true);
  });
  test('timed propagates error but records ok:false', () => {
    reset();
    assert.throws(() => timed('bad', () => { throw new Error('boom'); }));
    const t = getTimings();
    assert.strictEqual(t[0].ok, false);
  });
  test('timings are append-only until reset', () => {
    reset();
    timed('a', () => {});
    timed('b', () => {});
    assert.strictEqual(getTimings().length, 2);
    reset();
    assert.strictEqual(getTimings().length, 0);
  });
});

// ═══════════════════════════════════════════════════════════
// hostname-presence
// ═══════════════════════════════════════════════════════════
suite('hostname-presence', () => {
  const { hostname, perHostPresencePath, allHostPresencePaths, readAllHostSessions } = require(path.join(LIB_DIR, 'hostname-presence.js'));

  test('hostname sanitizes special chars', () => {
    const h = hostname();
    assert.ok(/^[a-zA-Z0-9-]+$/.test(h), 'hostname must be alphanumeric+dash: ' + h);
  });
  test('perHostPresencePath includes hostname', () => {
    const p = perHostPresencePath();
    assert.ok(p.includes('active-sessions-global-'));
    assert.ok(p.endsWith('.jsonl'));
  });
  test('readAllHostSessions returns array', () => {
    const r = readAllHostSessions(0, () => []);
    assert.ok(Array.isArray(r));
  });
});

// ═══════════════════════════════════════════════════════════
// release-notes-cache
// ═══════════════════════════════════════════════════════════
suite('release-notes-cache', () => {
  const { detectBreakingHookSignals } = require(path.join(LIB_DIR, 'release-notes-cache.js'));

  test('detects "breaking change"', () => {
    const sigs = detectBreakingHookSignals('## Changes\n- Breaking change: hooks removed');
    assert.ok(sigs.length >= 1);
  });
  test('detects deprecation', () => {
    const sigs = detectBreakingHookSignals('- `PostToolUse` is deprecated');
    assert.ok(sigs.length >= 1);
  });
  test('empty body → zero signals', () => {
    assert.strictEqual(detectBreakingHookSignals('').length, 0);
    assert.strictEqual(detectBreakingHookSignals('Just added a new feature').length, 0);
  });
});

// ═══════════════════════════════════════════════════════════
// settings-schema
// ═══════════════════════════════════════════════════════════
suite('settings-schema', () => {
  const { findDrift, SCHEMA_2_1_117 } = require(path.join(LIB_DIR, 'settings-schema.js'));

  test('empty settings → no drift', () => {
    const d = findDrift({});
    assert.deepStrictEqual(d, { deprecated: [], managedOnly: [], unknown: [] });
  });
  test('managed-only key flagged', () => {
    const d = findDrift({ strictKnownMarketplaces: true });
    assert.deepStrictEqual(d.managedOnly, ['strictKnownMarketplaces']);
  });
  test('deprecated key flagged', () => {
    const d = findDrift({ includeCoAuthoredBy: true });
    assert.deepStrictEqual(d.deprecated, ['includeCoAuthoredBy']);
  });
  test('unknown key flagged', () => {
    const d = findDrift({ totallyFakeKey: 1 });
    assert.deepStrictEqual(d.unknown, ['totallyFakeKey']);
  });
  test('real settings known keys recognized', () => {
    const d = findDrift({ cleanupPeriodDays: 90, env: {}, hooks: {}, permissions: {} });
    assert.deepStrictEqual(d, { deprecated: [], managedOnly: [], unknown: [] });
  });
  test('schema has ≥30 known keys', () => {
    assert.ok(SCHEMA_2_1_117.knownKeys.size >= 30);
  });
});

// ═══════════════════════════════════════════════════════════
// stale-process-detector
// ═══════════════════════════════════════════════════════════
suite('stale-process-detector', () => {
  const { analyze, summaryBadge } = require(path.join(LIB_DIR, 'stale-process-detector.js'));

  test('analyze returns structured report', () => {
    const r = analyze();
    assert.ok('staleTaskDirs' in r);
    assert.ok('staleOutputs' in r);
    assert.ok('orphanedShells' in r);
    assert.ok(typeof r.totalMb === 'number');
  });
  test('summaryBadge null when clean', () => {
    assert.strictEqual(summaryBadge({ staleTaskDirs: [], staleOutputs: { count: 0, kb: 0 }, orphanedShells: [], totalMb: 0 }), null);
  });
  test('summaryBadge includes "stale processes" when dirty', () => {
    const b = summaryBadge({
      staleTaskDirs: [{ sid: 'x', ageHours: 30 }],
      staleOutputs: { count: 100, kb: 5 },
      orphanedShells: [],
      totalMb: 0.005,
    });
    assert.ok(b.includes('stale processes'));
  });
});

// ═══════════════════════════════════════════════════════════
// observability-logger
// ═══════════════════════════════════════════════════════════
suite('observability-logger', () => {
  const obs = require(path.join(LIB_DIR, 'observability-logger.js'));

  test('logEvent exported', () => {
    assert.strictEqual(typeof obs.logEvent, 'function');
  });
  test('logEvent doesnt crash on nonsense cwd', () => {
    assert.doesNotThrow(() => obs.logEvent('/nonexistent/' + Math.random(), { type: 'test' }));
  });
});

// ═══════════════════════════════════════════════════════════
// symlink-audit (if present — kachow has it, claude may too)
// ═══════════════════════════════════════════════════════════
if (fs.existsSync(path.join(LIB_DIR, 'symlink-audit.js'))) {
  suite('symlink-audit', () => {
    const audit = require(path.join(LIB_DIR, 'symlink-audit.js'));
    test('auditAll returns structured report', () => {
      const r = audit.auditAll();
      assert.ok(Array.isArray(r.broken_live));
      assert.ok(Array.isArray(r.loops) || r.loops === undefined);
    });
  });
}

// ═══════════════════════════════════════════════════════════
// Report
// ═══════════════════════════════════════════════════════════
const passed = results.filter(r => r.ok).length;
const failed = results.filter(r => !r.ok);

for (const r of results) {
  const icon = r.ok ? '  ✓' : '  ✗';
  console.log(`${icon}  ${r.suite.padEnd(25)} ${r.test}`);
  if (!r.ok) {
    console.log(`      → ${r.err}`);
    if (r.stack) console.log(`      ${r.stack}`);
  }
}

console.log(`\n${passed} passed, ${failed.length} failed, ${results.length} total`);

if (failed.length > 0) process.exit(1);
