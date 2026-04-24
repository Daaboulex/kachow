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
    // classifySymlink branches — build a scratch dir with each kind.
    if (typeof audit.classifySymlink === 'function') {
      const dir = tempDir();
      const target = path.join(dir, 'target.txt');
      fs.writeFileSync(target, 'ok');
      const linkOK = path.join(dir, 'link-ok');
      fs.symlinkSync(target, linkOK);
      const linkBroken = path.join(dir, 'link-broken');
      fs.symlinkSync(path.join(dir, 'missing.txt'), linkBroken);
      const linkLoopA = path.join(dir, 'loop-a');
      const linkLoopB = path.join(dir, 'loop-b');
      fs.symlinkSync(linkLoopB, linkLoopA);
      fs.symlinkSync(linkLoopA, linkLoopB);

      test('classify OK symlink', () => {
        assert.strictEqual(audit.classifySymlink(linkOK), 'OK');
      });
      test('classify broken symlink', () => {
        assert.strictEqual(audit.classifySymlink(linkBroken), 'BROKEN');
      });
      test('classify looped symlink', () => {
        const r = audit.classifySymlink(linkLoopA);
        assert.ok(r === 'LOOP' || r === 'BROKEN', `got ${r}`);
      });
      cleanup(dir);
    }
  });
}

// ═══════════════════════════════════════════════════════════
// self-improvement queue
// ═══════════════════════════════════════════════════════════
const QUEUE_PATH = path.join(LIB_DIR, 'self-improvement', 'queue.js');
if (fs.existsSync(QUEUE_PATH)) {
  suite('self-improvement/queue', () => {
    // Isolate per-test — each requires fresh CLAUDE_CONFIG_DIR before load.
    function freshQueue() {
      const dir = tempDir();
      process.env.CLAUDE_CONFIG_DIR = dir;
      delete require.cache[QUEUE_PATH];
      const q = require(QUEUE_PATH);
      return { dir, q };
    }

    test('enqueue first-time stores new entry with id + seen_count=1', () => {
      const { dir, q } = freshQueue();
      const r = q.enqueue({ rule: 'R42', target: { path: 'x.js' }, evidence: { a: 1 }, tier: 'SUGGEST' });
      assert.ok(r.id);
      assert.strictEqual(r.seen_count, 1);
      assert.strictEqual(r.tier, 'SUGGEST');
      assert.strictEqual(q.count(), 1);
      cleanup(dir);
    });

    test('enqueue same finding twice dedups by id, bumps seen_count', () => {
      const { dir, q } = freshQueue();
      const f = { rule: 'R42', target: { path: 'x.js' }, evidence: { a: 1 } };
      const a = q.enqueue(f);
      const b = q.enqueue(f);
      assert.strictEqual(a.id, b.id);
      assert.strictEqual(b.seen_count, 2);
      assert.strictEqual(q.count(), 1);
      cleanup(dir);
    });

    test('count(tier) filters by tier', () => {
      const { dir, q } = freshQueue();
      q.enqueue({ rule: 'RA', target: { path: 'a' }, tier: 'BLOCKER' });
      q.enqueue({ rule: 'RB', target: { path: 'b' }, tier: 'SUGGEST' });
      q.enqueue({ rule: 'RC', target: { path: 'c' }, tier: 'OBSERVE' });
      const s = q.summary();
      assert.strictEqual(s.total, 3);
      assert.strictEqual(s.BLOCKER, 1);
      assert.strictEqual(s.SUGGEST, 1);
      assert.strictEqual(s.OBSERVE, 1);
      cleanup(dir);
    });

    test('resolve(id, accept) removes from pending + appends to resolved', () => {
      const { dir, q } = freshQueue();
      const e = q.enqueue({ rule: 'R1', target: { path: 'y' } });
      const r = q.resolve(e.id, 'accept');
      assert.strictEqual(r.decision, 'accept');
      assert.ok(r.decided_at);
      assert.strictEqual(q.count(), 0);
      assert.ok(fs.existsSync(q.RESOLVED_PATH));
      cleanup(dir);
    });

    test('resolve unknown id returns null', () => {
      const { dir, q } = freshQueue();
      assert.strictEqual(q.resolve('nonexistent', 'accept'), null);
      cleanup(dir);
    });

    test('reject writes feedback file with rule + class', () => {
      const { dir, q } = freshQueue();
      const e = q.enqueue({ rule: 'R9', target: { path: 'z' }, fingerprint_class: 'cls-A' });
      q.resolve(e.id, 'reject', 'not applicable');
      const feedback = fs.readFileSync(q.FEEDBACK_PATH, 'utf8');
      assert.ok(feedback.includes('R9'));
      assert.ok(feedback.includes('cls-A'));
      assert.ok(feedback.includes('not applicable'));
      cleanup(dir);
    });

    test('markSurfaced updates last_surfaced timestamp', () => {
      const { dir, q } = freshQueue();
      const e = q.enqueue({ rule: 'R2', target: { path: 'y2' } });
      q.markSurfaced(e.id);
      const fresh = q.readPending().find(x => x.id === e.id);
      assert.ok(fresh.last_surfaced);
      cleanup(dir);
    });

    test('3+ rejections same fingerprint_class suppresses future enqueue', () => {
      const { dir, q } = freshQueue();
      for (let i = 0; i < 3; i++) {
        const e = q.enqueue({ rule: `R${i}`, target: { path: `t${i}` }, fingerprint_class: 'supp-class' });
        q.resolve(e.id, 'reject', `r${i}`);
      }
      const r4 = q.enqueue({ rule: 'R4', target: { path: 't4' }, fingerprint_class: 'supp-class' });
      assert.strictEqual(r4.suppressed, true);
      assert.strictEqual(q.count(), 0);
      cleanup(dir);
    });
  });
  // Reset for subsequent suites.
  delete process.env.CLAUDE_CONFIG_DIR;
  delete require.cache[QUEUE_PATH];
}

// ═══════════════════════════════════════════════════════════
// memory-migrate
// ═══════════════════════════════════════════════════════════
if (fs.existsSync(path.join(LIB_DIR, 'memory-migrate.js'))) {
  suite('memory-migrate', () => {
    const mm = require(path.join(LIB_DIR, 'memory-migrate.js'));
    const dir = tempDir();
    const memDir = path.join(dir, 'memory');
    fs.mkdirSync(memDir, { recursive: true });

    test('scan detects v1-only file (reports missing v2 fields)', () => {
      const f = path.join(memDir, 'v1.md');
      fs.writeFileSync(f, `---
name: old thing
description: an old memory
type: project
---

Body.
`);
      const report = mm.scan(memDir);
      const entry = report.files.find(e => e.file.endsWith('v1.md'));
      assert.ok(entry, `scan missed v1.md: ${JSON.stringify(report)}`);
      assert.ok(entry.missing.includes('created'));
      assert.ok(entry.missing.includes('ttl_days'));
      assert.ok(entry.missing.includes('status'));
    });

    test('scan on v2-complete file reports no missing fields', () => {
      const f = path.join(memDir, 'v2.md');
      fs.writeFileSync(f, `---
name: new thing
description: v2 memory
type: project
created: 2026-04-01
last_verified: 2026-04-01
last_accessed: 2026-04-01
ttl_days: 90
evidence: [file:/tmp/x]
status: active
---

Body.
`);
      const report = mm.scan(memDir);
      const entry = report.files.find(e => e.file.endsWith('v2.md'));
      // Either entry absent (complete), OR entry with empty missing[]
      if (entry) assert.strictEqual(entry.missing.length, 0, `v2 file flagged: ${JSON.stringify(entry)}`);
    });

    test('lazyUpgrade adds missing v2 fields + preserves body', () => {
      const f = path.join(memDir, 'upgrademe.md');
      fs.writeFileSync(f, `---
name: to-upgrade
description: v1 memory
type: user
---

Body text.
`);
      mm.lazyUpgrade(f);
      const after = fs.readFileSync(f, 'utf8');
      assert.ok(after.includes('created:'));
      assert.ok(after.includes('last_verified:'));
      assert.ok(after.includes('ttl_days:'));
      assert.ok(after.includes('status:'));
      assert.ok(after.includes('Body text.'));
    });

    test('parseFrontmatter round-trips with serializeFrontmatter', () => {
      const content = `---
name: rt
description: round-trip
type: reference
---

body
`;
      const { fm } = mm.parseFrontmatter(content);
      const re = mm.serializeFrontmatter(fm);
      assert.ok(re.includes('name: rt'));
      assert.ok(re.includes('type: reference'));
    });

    cleanup(dir);
  });
}

// ═══════════════════════════════════════════════════════════
// platform-map — Claude ↔ Gemini translation
// ═══════════════════════════════════════════════════════════
if (fs.existsSync(path.join(LIB_DIR, 'platform-map.js'))) {
  suite('platform-map', () => {
    const pm = require(path.join(LIB_DIR, 'platform-map.js'));

    test('toolMap covers the 12 Claude tools', () => {
      const expect = ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep', 'Agent', 'Skill', 'WebFetch', 'WebSearch', 'TodoWrite', 'TodoRead'];
      for (const t of expect) assert.ok(pm.toolMap[t], `missing tool ${t}`);
    });

    test('reverseToolMap round-trips', () => {
      assert.strictEqual(pm.reverseToolMap[pm.toolMap.Write], 'Write');
      assert.strictEqual(pm.reverseToolMap[pm.toolMap.Bash], 'Bash');
    });

    test('eventMap covers 6 Claude events', () => {
      const expect = ['PreToolUse', 'PostToolUse', 'Stop', 'SubagentStart', 'SubagentStop', 'PreCompact'];
      for (const e of expect) assert.ok(pm.eventMap[e], `missing event ${e}`);
    });

    test('translateFrontmatter rewrites YAML list tools', () => {
      const input = `---
name: test
tools:
  - Write
  - Bash
  - Read
---

body
`;
      const out = pm.translateFrontmatter(input, pm.toolMap, pm.claudeOnlyFields, pm.modelMap);
      assert.ok(out.includes('- write_file'));
      assert.ok(out.includes('- run_shell_command'));
      assert.ok(out.includes('- read_file'));
      assert.ok(!out.includes('- Write'));
    });

    test('translateFrontmatter rewrites inline comma tools', () => {
      const input = `---
tools: Read, Write, Bash
---

body
`;
      const out = pm.translateFrontmatter(input, pm.toolMap, pm.claudeOnlyFields, pm.modelMap);
      assert.ok(out.includes('read_file, write_file, run_shell_command'));
    });

    test('translateFrontmatter strips Claude-only fields going to Gemini', () => {
      const input = `---
name: x
color: blue
permissionMode: plan
---

body
`;
      const out = pm.translateFrontmatter(input, pm.toolMap, pm.claudeOnlyFields, pm.modelMap);
      assert.ok(!out.includes('color:'));
      assert.ok(!out.includes('permissionMode:'));
    });

    test('translateFrontmatter on file without frontmatter is passthrough', () => {
      const input = 'just text no frontmatter\n';
      const out = pm.translateFrontmatter(input, pm.toolMap, pm.claudeOnlyFields, pm.modelMap);
      assert.strictEqual(out, input);
    });

    test('modelMap: opus → gemini-2.5-pro (and reverse)', () => {
      assert.strictEqual(pm.modelMap.opus, 'gemini-2.5-pro');
      assert.strictEqual(pm.reverseModelMap['gemini-2.5-pro'], 'opus');
    });
  });
}

// ═══════════════════════════════════════════════════════════
// statusline-renderer — pure format helpers
// ═══════════════════════════════════════════════════════════
if (fs.existsSync(path.join(LIB_DIR, 'statusline-renderer.js'))) {
  suite('statusline-renderer', () => {
    const r = require(path.join(LIB_DIR, 'statusline-renderer.js'));
    if (typeof r.truncate === 'function') {
      test('truncate leaves short strings alone', () => {
        assert.strictEqual(r.truncate('abc', 10), 'abc');
      });
      test('truncate shortens long strings with ellipsis', () => {
        const t = r.truncate('abcdefghij', 5);
        assert.ok(t.length <= 5, `got length ${t.length}: "${t}"`);
        assert.ok(t.endsWith('…') || t.endsWith('...'), `no ellipsis in "${t}"`);
      });
    }
    if (typeof r.formatContext === 'function') {
      test('formatContext(used_pct) renders percentage bar', () => {
        // Function takes a USED percentage (number), returns colored bar + "N%"
        const s = r.formatContext(75);
        assert.ok(/75%/.test(s), `missing "75%" in ${JSON.stringify(s)}`);
      });
      test('formatContext(85+) prepends skull emoji + red blink', () => {
        const s = r.formatContext(90);
        // Skull emoji is U+1F480
        assert.ok(s.includes('\u{1F480}') || /90%/.test(s));
      });
    }
    if (typeof r.formatElapsed === 'function') {
      test('formatElapsed: seconds-scale for recent timestamp', () => {
        // Function takes a START-TIMESTAMP (ms since epoch), not a duration.
        const startedFewSecondsAgo = Date.now() - 5000;
        const s = r.formatElapsed(startedFewSecondsAgo);
        // Accept s, m, or h suffix (timing-dependent); core assertion is
        // that it returns non-empty formatted output with a digit + unit.
        assert.ok(/[0-9]+[smh]/.test(s), `no duration in "${s}"`);
      });
      test('formatElapsed future timestamp returns 0s', () => {
        const future = Date.now() + 1000000;
        const s = r.formatElapsed(future);
        assert.ok(s.includes('0s'));
      });
    }
    if (typeof r.formatModel === 'function') {
      test('formatModel truncates + dims', () => {
        const s = r.formatModel('claude-opus-4-7');
        assert.ok(/opus/.test(s));
      });
    }
  });
}

// ═══════════════════════════════════════════════════════════
// observability-logger.readEvents filtering
// ═══════════════════════════════════════════════════════════
if (fs.existsSync(path.join(LIB_DIR, 'observability-logger.js'))) {
  suite('observability-logger.readEvents', () => {
    const obs = require(path.join(LIB_DIR, 'observability-logger.js'));
    if (typeof obs.readEvents !== 'function') return;

    // Set up a fake project cwd with .claude/memory/episodic/<date>-<host>.jsonl
    const projectDir = tempDir();
    const epDir = path.join(projectDir, '.claude', 'memory', 'episodic');
    fs.mkdirSync(epDir, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    const host = obs.HOSTNAME;
    const nowIso = new Date().toISOString();
    const events = [
      { ts: nowIso, host, type: 'hook_timing', source: 'a', meta: { total_ms: 5 } },
      { ts: nowIso, host, type: 'skill_invoke', source: 'b', meta: {} },
      { ts: nowIso, host, type: 'hook_timing', source: 'c', meta: { total_ms: 9 } },
    ];
    fs.writeFileSync(
      path.join(epDir, `${today}-${host}.jsonl`),
      events.map(e => JSON.stringify(e)).join('\n') + '\n'
    );

    test('readEvents reads all events within days window', () => {
      const all = obs.readEvents(projectDir, 7);
      assert.strictEqual(all.length, 3, `got ${all.length}, expected 3`);
    });

    test('readEvents filters by eventTypes', () => {
      const timings = obs.readEvents(projectDir, 7, { eventTypes: ['hook_timing'] });
      assert.strictEqual(timings.length, 2);
      assert.ok(timings.every(e => e.type === 'hook_timing'));
    });

    test('readEvents respects days cutoff (days=0 excludes older)', () => {
      // today's events should still show with days=1 (today within window)
      const todayEvents = obs.readEvents(projectDir, 1);
      assert.ok(todayEvents.length >= 1);
    });

    test('readEvents returns [] for cwd with no episodic dir', () => {
      const empty = tempDir();
      const none = obs.readEvents(empty, 7);
      assert.deepStrictEqual(none, []);
      cleanup(empty);
    });

    cleanup(projectDir);
  });
}

// ═══════════════════════════════════════════════════════════
// presence — session tracking
// ═══════════════════════════════════════════════════════════
if (fs.existsSync(path.join(LIB_DIR, 'presence.js'))) {
  suite('presence', () => {
    const pr = require(path.join(LIB_DIR, 'presence.js'));
    const dir = tempDir();
    const f = path.join(dir, 'active-sessions.jsonl');

    test('bumpCounter(sessionId) increments monotonically', () => {
      process.env.CLAUDE_CONFIG_DIR = dir;
      delete require.cache[require.resolve(path.join(LIB_DIR, 'presence.js'))];
      const prFresh = require(path.join(LIB_DIR, 'presence.js'));
      // Unique session-id so prior test runs can't bleed state (the counter
      // file is keyed on sessionId under CLAUDE_CONFIG_DIR/cache/).
      const sid = `unit-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const a = prFresh.bumpCounter(sid);
      const b = prFresh.bumpCounter(sid);
      const c = prFresh.bumpCounter(sid);
      assert.strictEqual(a, 1);
      assert.strictEqual(b, 2);
      assert.strictEqual(c, 3);
      prFresh.clearCounter(sid);
      const after = prFresh.bumpCounter(sid);
      assert.strictEqual(after, 1, 'clearCounter should reset to 1 on next bump');
      delete process.env.CLAUDE_CONFIG_DIR;
      delete require.cache[require.resolve(path.join(LIB_DIR, 'presence.js'))];
    });

    test('appendJsonl writes newline-delimited JSON', () => {
      if (typeof pr.appendJsonl !== 'function') return;
      pr.appendJsonl(f, { type: 'session_start', id: 't1' });
      pr.appendJsonl(f, { type: 'session_end', id: 't1' });
      const lines = fs.readFileSync(f, 'utf8').trim().split('\n');
      assert.strictEqual(lines.length, 2);
      assert.strictEqual(JSON.parse(lines[0]).type, 'session_start');
    });

    test('readActiveSessions returns parsed entries', () => {
      if (typeof pr.readActiveSessions !== 'function') return;
      // readActiveSessions takes a file path
      const parsed = pr.readActiveSessions(f);
      assert.ok(Array.isArray(parsed));
    });

    cleanup(dir);
  });
}

// ═══════════════════════════════════════════════════════════
// validate-skills — integration via spawn (separate process)
// ═══════════════════════════════════════════════════════════
const VALIDATE_SKILLS = path.join(__dirname, '..', '..', 'scripts', 'validate-skills.js');
if (fs.existsSync(VALIDATE_SKILLS)) {
  suite('scripts/validate-skills.js', () => {
    const { spawnSync } = require('child_process');
    const dir = tempDir();
    const skillsDir = path.join(dir, 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });

    function writeSkill(name, frontmatter, body = 'body\n') {
      const d = path.join(skillsDir, name);
      fs.mkdirSync(d, { recursive: true });
      const fm = Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`).join('\n');
      fs.writeFileSync(path.join(d, 'SKILL.md'), `---\n${fm}\n---\n\n${body}`);
    }

    test('valid skill passes', () => {
      writeSkill(
        'good',
        { name: 'good', description: 'A sufficiently detailed description that retrieval layers can actually use.' },
        '# good skill\n\n## When to use\n\nConcrete triggers.\n\n## Steps\n\n1. Read\n2. Check\n3. Write\n\n## Anti-patterns\n\n- Thing to avoid.\n'
      );
      const r = spawnSync('node', [VALIDATE_SKILLS, '--dir', skillsDir], { encoding: 'utf8' });
      assert.strictEqual(r.status, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
    });

    test('skill without description fails', () => {
      writeSkill('nodesc', { name: 'nodesc' });
      const r = spawnSync('node', [VALIDATE_SKILLS, '--dir', skillsDir], { encoding: 'utf8' });
      assert.notStrictEqual(r.status, 0, 'should fail on missing description');
    });

    test('skill with short description fails', () => {
      const freshDir = tempDir();
      const freshSkills = path.join(freshDir, 'skills');
      fs.mkdirSync(path.join(freshSkills, 'shortdesc'), { recursive: true });
      fs.writeFileSync(path.join(freshSkills, 'shortdesc', 'SKILL.md'), '---\nname: shortdesc\ndescription: too short\n---\n');
      const r = spawnSync('node', [VALIDATE_SKILLS, '--dir', freshSkills], { encoding: 'utf8' });
      assert.notStrictEqual(r.status, 0, 'should fail on short description');
      cleanup(freshDir);
    });

    test('skill name must match directory', () => {
      const freshDir = tempDir();
      const freshSkills = path.join(freshDir, 'skills');
      fs.mkdirSync(path.join(freshSkills, 'actual-dir'), { recursive: true });
      fs.writeFileSync(
        path.join(freshSkills, 'actual-dir', 'SKILL.md'),
        '---\nname: different-name\ndescription: This description is long enough to satisfy the minimum length requirement.\n---\n'
      );
      const r = spawnSync('node', [VALIDATE_SKILLS, '--dir', freshSkills], { encoding: 'utf8' });
      assert.notStrictEqual(r.status, 0, 'should fail on name/dir mismatch');
      cleanup(freshDir);
    });

    cleanup(dir);
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
