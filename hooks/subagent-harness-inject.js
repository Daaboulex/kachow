#!/usr/bin/env node
// SubagentStart hook: Auto-inject harness rules into every subagent +
// write subagent-active marker for PreToolUse commit-block enforcement.
// This replaces the model needing to REMEMBER to consult agent-harness skill.
// Zero context cost in main conversation — injected directly into subagent.

const fs = require('fs');
const path = require('path');
const os = require('os');

try {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }
  const input = JSON.parse(raw);

  const agentType = input.agent_type || '';
  const cwd = input.cwd || process.cwd();
  const sessionId = input.session_id || '';

  // ── Write subagent-active marker ──
  // Read by ~/.claude/hooks/block-subagent-writes.js (PreToolUse on Bash)
  // to enforce the "subagents cannot commit" rule UNIVERSALLY (not just
  // safety-critical projects). Removed by subagent-quality-gate.js on
  // SubagentStop. Fail-open: if write fails, block hook no-ops.
  if (sessionId) {
    try {
      const markerDir = path.join(os.homedir(), '.claude', 'cache', 'subagent-active');
      fs.mkdirSync(markerDir, { recursive: true });
      fs.writeFileSync(
        path.join(markerDir, `${sessionId}.json`),
        JSON.stringify({
          session_id: sessionId,
          agent_type: agentType,
          ts: new Date().toISOString(),
          pid: process.pid,
          cwd: cwd,
        })
      );
    } catch (e) {
      // Log to stderr so silent failures are observable — but don't block
      try { process.stderr.write('subagent-harness-inject (marker): ' + e.message + '\n'); } catch {}
    }
  }

  // Skip context injection for Explore agents (read-only, no harness needed)
  // — but marker still written above so Explore subagents also get git blocks.
  if (agentType === 'Explore') {
    process.stdout.write('{"continue":true}');
    process.exit(0);
  }

  // Build context injection based on what the subagent needs to know
  const rules = [];

  // Always: file partitioning awareness
  rules.push('CRITICAL: Do NOT edit files that other agents may be working on. If uncertain, only edit files explicitly assigned to you.');

  // Always: no self-evaluation
  rules.push('Do NOT evaluate your own work quality. Report what you changed and let a separate evaluator verify.');

  // Always: no git state changes (universal, hard-enforced by block-subagent-writes.js)
  rules.push('NEVER use git state-changing commands (commit, push, merge, rebase, reset --hard, cherry-pick, revert, tag -f/-d, branch -D, checkout -b, add -A/./--all, restore --staged/., clean -f, submodule add, worktree add/remove). Read-only git (status, log, diff, show, ls-files, grep) is allowed. This rule is HARD-ENFORCED at the PreToolUse hook level — attempts will be blocked with an explanation. Report file changes via your return value; parent handles all commits.');

  // Safety-critical project detection: check for safety-critical marker files
  // Detects by trait (IEC 61508 firmware dirs exist), not project name
  const safetyDirs = ['Actuator', 'ValveLogic', 'SafetyTimer', 'EEPROM_Control'];
  const hasSafetyCode = safetyDirs.some(d => {
    try { return fs.existsSync(path.join(cwd, d)) ||
                 fs.existsSync(path.join(cwd, '..', d)); } catch { return false; }
  });

  if (hasSafetyCode) {
    rules.push('SAFETY: Actuator/, SafetyTimer/, EEPROM/, ValveLogic/ files are safety-critical (IEC 61508 domain). Do NOT edit these in a subagent — flag for manual review.');
  }

  if (rules.length > 0) {
    process.stdout.write(JSON.stringify({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'SubagentStart',
        additionalContext: `[Agent Harness Rules]\n${rules.join('\n')}`
      }
    }));
  } else {
    process.stdout.write('{"continue":true}');
  }
} catch (e) {
  process.stderr.write('subagent-harness-inject: ' + e.message + '\n');
  process.stdout.write('{"continue":true}');
}
