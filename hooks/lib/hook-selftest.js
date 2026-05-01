#!/usr/bin/env node
// hook-selftest.js
// Runtime verification runner for Claude Code hooks.
//
// Design: test specs live in this file (not in hook files). Hooks must
// tolerate being run with synthetic stdin — but we do NOT `require()` them
// (that would re-run top-level logic with side effects).
//
// Adding a new test: append to SPECS below.
// Running: `node hook-selftest.js` or `node hook-selftest.js --hook=<name>`.

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const HOOKS = process.env.HOOKS_DIR || path.join(HOME, '.claude', 'hooks');
const CACHE = path.join(HOME, '.claude', 'cache', 'hook-healthcheck-latest.json');

const SPECS = [
  {
    hook: 'session-start-combined.js',
    event: 'SessionStart',
    tests: [
      // Silent-when-healthy design: assert no crash/fatal marker leaked to stdout.
      // validate-symlinks logic merged into session-start-combined.js (2026-04-21 audit).
      { name: 'exits 0 with no fatal marker', stdin: '{}', expect: { exit: 0, stdoutNotMatch: 'fatal|TypeError|ReferenceError|ENOENT' } },
    ],
  },
  {
    hook: 'research-lint.js',
    event: 'PostToolUse',
    matcher: 'Write|Edit',
    skipOnWindows: true, // POSIX-utility dependent; Git-Bash exit-code semantics differ
    tests: [
      {
        name: 'passes on non-research path',
        stdin: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: '/tmp/unrelated.md', content: 'from transcript\n' } }),
        expect: { exit: 0 },
      },
      {
        name: 'passes on research path with citation',
        stdin: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: `${HOME}/Documents/research/ok.md`, content: 'paper shows X (arxiv:2603.19461)\n' } }),
        expect: { exit: 0 },
      },
      {
        name: 'blocks on research path without citation',
        stdin: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: `${HOME}/Documents/research/bad.md`, content: 'from transcript: foo did a thing\n' } }),
        expect: { exit: 2, stdoutMatch: 'unsourced' },
      },
      {
        name: 'ignores non-Write tool',
        stdin: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } }),
        expect: { exit: 0 },
      },
    ],
  },
  {
    hook: 'autosave-before-destructive.js',
    event: 'PreToolUse',
    matcher: 'Bash',
    tests: [
      // Passthrough MUST emit `{"continue":true}` — a silent exit=0 (e.g. crash before write)
      // would otherwise look identical to success.
      { name: 'passthrough on ls emits continue signal', stdin: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } }), expect: { exit: 0, stdoutMatch: 'continue' } },
    ],
  },
  {
    hook: 'block-subagent-writes.js',
    event: 'PreToolUse',
    matcher: 'Bash',
    tests: [
      { name: 'main-thread passthrough on git status emits continue', stdin: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git status' } }), expect: { exit: 0, stdoutMatch: 'continue' } },
    ],
  },
  {
    hook: 'memory-rotate.js',
    event: 'Stop',
    tests: [
      { name: 'exits 0 with continue signal', stdin: '{}', expect: { exit: 0, stdoutMatch: 'continue' } },
    ],
  },
  {
    hook: 'verifiedby-gate.js',
    event: 'PreToolUse',
    matcher: 'TodoWrite',
    tests: [
      { name: 'passthrough on empty todo list emits continue', stdin: JSON.stringify({ tool_name: 'TodoWrite', tool_input: { todos: [] } }), expect: { exit: 0, stdoutMatch: 'continue' } },
    ],
  },
];

function runCase(hookPath, testCase) {
  const r = spawnSync('node', [hookPath], {
    input: testCase.stdin || '',
    timeout: 8000,
    encoding: 'utf8',
  });
  const actualExit = r.status;
  const actualStdout = (r.stdout || '') + (r.stderr || '');
  const exp = testCase.expect || {};
  const fails = [];
  if ('exit' in exp && actualExit !== exp.exit) fails.push(`exit ${actualExit} vs ${exp.exit}`);
  if (exp.stdoutMatch && !new RegExp(exp.stdoutMatch, 'i').test(actualStdout)) {
    fails.push(`stdout missing /${exp.stdoutMatch}/i`);
  }
  if (exp.stdoutNotMatch && new RegExp(exp.stdoutNotMatch, 'i').test(actualStdout)) {
    fails.push(`stdout contains /${exp.stdoutNotMatch}/i (should not)`);
  }
  return { name: testCase.name, ok: fails.length === 0, fails, actualExit, stdoutPrefix: actualStdout.slice(0, 200) };
}

function main() {
  const report = { ts: new Date().toISOString(), hooks: [], summary: { tested: 0, passed: 0, failed: 0, missing: 0, skipped: 0 } };
  const argHook = (process.argv.find(a => a.startsWith('--hook=')) || '').split('=')[1];
  const isWindows = process.platform === 'win32';
  for (const spec of SPECS) {
    if (argHook && spec.hook !== argHook) continue;
    if (spec.skipOnWindows && isWindows) {
      report.hooks.push({ hook: spec.hook, status: 'skipped-windows' });
      report.summary.skipped++;
      continue;
    }
    const hp = path.join(HOOKS, spec.hook);
    if (!fs.existsSync(hp)) {
      report.hooks.push({ hook: spec.hook, status: 'missing' });
      report.summary.missing++;
      continue;
    }
    const cases = spec.tests.map(t => runCase(hp, t));
    const ok = cases.every(c => c.ok);
    report.hooks.push({ hook: spec.hook, event: spec.event, matcher: spec.matcher, status: ok ? 'pass' : 'fail', cases });
    report.summary.tested++;
    ok ? report.summary.passed++ : report.summary.failed++;
  }
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify(report, null, 2));
  const missingSuffix = report.summary.missing > 0 ? ` missing=${report.summary.missing}` : '';
  const skippedSuffix = report.summary.skipped > 0 ? ` skipped=${report.summary.skipped}` : '';
  console.log(`hook-selftest: tested=${report.summary.tested} passed=${report.summary.passed} failed=${report.summary.failed}${missingSuffix}${skippedSuffix}`);
  for (const h of report.hooks) {
    if (h.status === 'pass') continue;
    if (h.status === 'skipped-windows') { console.log(`  SKIP (Windows): ${h.hook}`); continue; }
    if (h.status === 'missing') { console.log(`  MISSING: ${h.hook}`); continue; }
    console.log(`  FAIL: ${h.hook}`);
    for (const c of h.cases || []) if (!c.ok) console.log(`    - ${c.name}: ${c.fails.join('; ')}`);
  }
  // Missing hooks are treated as failures — previously silent-passed when a
  // hook file was deleted. Override with SELFTEST_ALLOW_MISSING=1 if you're
  // intentionally running against a partial install.
  const allowMissing = process.env.SELFTEST_ALLOW_MISSING === '1';
  const hadProblems = report.summary.failed > 0 || (!allowMissing && report.summary.missing > 0);
  process.exit(hadProblems ? 1 : 0);
}

if (require.main === module) main();
module.exports = { main, SPECS };
