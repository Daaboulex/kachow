#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// PostToolUse/AfterTool hook — Task 3: re-inject critical project rules every N tool calls.
//
// Rationale (handoff 2026-04-14): long sessions drift from rules established at SessionStart.
// After N tool calls within one session, briefly re-surface the short list of critical
// non-negotiable rules via systemMessage. Keeps rules active in working context without
// bloating SessionStart.
//
// Rules are SHORT and STATIC — derived from top-priority feedback memories + identity layer.
// Expensive judgment-based rules stay as Tier-1 feedback memories (shown at SessionStart).
//
// Trigger: every INTERVAL tool calls (default 60). Per-session counter.
// Scope: only fires if cwd under a project with .claude/project-identity.json or
//        .claude/memory/ present (i.e. a tracked project).
// Idempotent: duplicate re-injections harmless; Claude dedupes systemMessages.
//
// Disable: SKIP_SKILL_DRIFT=1 env var.

const fs = require('fs');
const path = require('path');
const os = require('os');

const INTERVAL = parseInt(process.env.SKILL_DRIFT_INTERVAL || '60', 10);

function passthrough() {
  process.stdout.write('{"continue":true}');
  process.exit(0);
}

try {
  if (process.env.SKIP_SKILL_DRIFT === '1') passthrough();

  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }
  const input = JSON.parse(raw || '{}');

  const sessionId = input.session_id || 'unknown';
  const cwd = input.cwd || process.cwd();

  // Scope check — only fire in tracked projects
  const projectMarker = path.join(cwd, '.claude', 'memory');
  if (!fs.existsSync(projectMarker)) passthrough();

  // Per-session counter (per-machine, gitignored)
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  const cacheDir = path.join(home, '.claude', 'cache');
  try { fs.mkdirSync(cacheDir, { recursive: true }); } catch {}
  const counterFile = path.join(cacheDir, `skill-drift-${sessionId}.count`);

  let n = 0;
  try { n = parseInt(fs.readFileSync(counterFile, 'utf8').trim(), 10) || 0; } catch {}
  n += 1;

  // Atomic write
  const tmp = counterFile + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(tmp, String(n));
    fs.renameSync(tmp, counterFile);
  } catch {}

  // Fire every INTERVAL calls (but not on first)
  if (n === 0 || n % INTERVAL !== 0) passthrough();

  // Read project identity (if present) for identity line
  let identityType = '';
  try {
    const pid = JSON.parse(fs.readFileSync(path.join(cwd, '.claude', 'project-identity.json'), 'utf8'));
    identityType = pid.type || '';
  } catch {}

  // Dynamic critical-rule loading. Reads from project-level file, falls back to universal rules.
  // Project-specific rules go in: <project>/.claude/critical-rules.txt (one rule per line, markdown)
  // Universal rules (always injected) are hardcoded below.
  const rules = [];

  // 1. Project-identity-gated rules
  if (identityType === 'local-private') {
    rules.push('- Repo is LOCAL-PRIVATE: no `gh`, no `git push origin`, no GitHub remotes.');
  }

  // 2. Project-specific rules from file (if exists)
  const rulesFile = path.join(cwd, '.claude', 'critical-rules.txt');
  try {
    const lines = fs.readFileSync(rulesFile, 'utf8').split('\n')
      .map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    rules.push(...lines);
  } catch {
    // No project-specific rules file — that's fine
  }

  // 3. Universal rules (always active, project-agnostic)
  rules.push('- **Verify before claiming done**: build + eval, not "I read it and it looks correct". Hardware/UI needs human test.');
  rules.push('- **No broad reverts**: never `git checkout .` / `git reset --hard` at root. Revert surgically.');

  const msg = [
    `## Critical-rule refresh (tool call #${n})`,
    '',
    'Drift check — these rules are always active, resurfacing now so they stay top-of-mind:',
    '',
    ...rules,
    '',
    'Full context in `.claude/memory/` (top feedback entries).',
  ].join('\n');

  process.stdout.write(JSON.stringify({
    continue: true,
    systemMessage: msg,
  }));

  // Observability
  try {
    require('./lib/observability-logger.js').logEvent(cwd, {
      type: 'skill_drift_refresh',
      source: 'skill-drift-guard',
      meta: { tool_call_n: n, interval: INTERVAL, rules_count: rules.length },
    });
  } catch {}
} catch {
  passthrough();
}
