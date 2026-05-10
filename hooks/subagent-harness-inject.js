#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// SubagentStart hook: Auto-inject harness rules into every subagent +
// write subagent-active marker for PreToolUse commit-block enforcement.
// This replaces the model needing to REMEMBER to consult [agent-skill] skill.
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
      const markerDir = require('./lib/tool-paths.js').subagentMarkerDir;
      fs.mkdirSync(markerDir, { recursive: true });
      // Key by session_id + pid to avoid blocking parent session.
      // Old key was session_id alone — parent's own git commands got blocked
      // when subagent marker wasn't cleaned up by SubagentStop.
      const markerKey = `${sessionId}-${process.pid}`;
      fs.writeFileSync(
        path.join(markerDir, `${markerKey}.json`),
        JSON.stringify({
          session_id: sessionId,
          marker_key: markerKey,
          agent_type: agentType,
          ts: new Date().toISOString(),
          pid: process.pid,
          cwd: cwd,
        })
      );
    } catch (e) {
      // Log to stderr so silent failures are observable — but don't block
      try { process.stderr.write('sub[agent-skill]-inject (marker): ' + e.message + '\n'); } catch {}
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

  // R-RES-6 2026-04-25: reasoning anchors counter Opus 4.7 zero-reasoning turns.
  // Sub-agents inherit explicit intent + plan + verification expectations.
  rules.push('REASONING ANCHOR: Before any non-trivial tool call (Edit, Write, Bash with side effects), state intent in ONE sentence. For multi-step work (3+ tool calls or 2+ edits), output a numbered plan first. State what command/test will verify success. Skip these for pure-read tasks.');

  // Always: no git state changes (universal, hard-enforced by block-subagent-writes.js)
  // Use the tool-specific event name so subagents see the correct identifier for their tool.
  const _hookEventName = require(__dirname + '/lib/tool-detect.js').EVENT_NAMES[require(__dirname + '/lib/tool-detect.js').detectTool()].preTool;
  rules.push(`NEVER use git state-changing commands (commit, push, merge, rebase, reset --hard, cherry-pick, revert, tag -f/-d, branch -D, checkout -b, add -A/./--all, restore --staged/., clean -f, submodule add, worktree add/remove). Read-only git (status, log, diff, show, ls-files, grep) is allowed. This rule is HARD-ENFORCED at the ${_hookEventName} hook level — attempts will be blocked with an explanation. Report file changes via your return value; parent handles all commits.`);

  // Safety-critical project detection (SEC-5 2026-04-23): walk up to nearest
  // .git or .envrc boundary; detect by directory trait at EACH level (not
  // just cwd + cwd/..). Prior 1-level check missed Tests/Integration/Cases/
  // style deep subdirs under safety-critical projects.
  const safetyDirs = (process.env.KACHOW_SAFETY_DIRS || 'SafetyCritical,HardwareControl').split(',').map(s => s.trim()).filter(Boolean);
  const hasSafetyDir = (dir) => safetyDirs.some(d => {
    try { return fs.existsSync(path.join(dir, d)); } catch { return false; }
  });
  // Configurable via KACHOW_SAFETY_PATTERNS env var (regex string).
  // Default matches functional-safety standards (IEC 61508/61511).
  // Users with safety-critical projects can extend per their domain markers.
  const safetyContentRegex = (() => {
    try { return new RegExp(process.env.KACHOW_SAFETY_PATTERNS || 'IEC\\s*615(08|11)', 'i'); }
    catch { return /IEC\s*615(08|11)/i; }
  })();
  const hasSafetyContent = (dir) => {
    try {
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.c') && !name.endsWith('.h')) continue;
        try {
          const head = fs.readFileSync(path.join(dir, name), 'utf8').slice(0, 2000);
          if (safetyContentRegex.test(head)) return true;
        } catch {}
      }
    } catch {}
    return false;
  };
  let hasSafetyCode = false;
  try {
    let walkDir = cwd;
    const root = path.parse(walkDir).root;
    // Walk up until we hit .git, .envrc, or filesystem root — detect at each level
    for (let i = 0; i < 10 && walkDir && walkDir !== root; i++) {
      if (hasSafetyDir(walkDir) || hasSafetyContent(walkDir)) { hasSafetyCode = true; break; }
      // Stop at project boundary markers
      try {
        if (fs.existsSync(path.join(walkDir, '.git')) ||
            fs.existsSync(path.join(walkDir, '.envrc'))) {
          // Final check at boundary before stopping
          if (hasSafetyDir(walkDir) || hasSafetyContent(walkDir)) hasSafetyCode = true;
          break;
        }
      } catch {}
      const parent = path.dirname(walkDir);
      if (parent === walkDir) break;
      walkDir = parent;
    }
  } catch {}

  // Always: verify input file existence before starting work
  rules.push('Before starting work, verify that any input files referenced in your task exist (Read or stat them). If a file you need to read or review does not exist, report immediately and exit — do not retry or wait.');

  if (hasSafetyCode) {
    rules.push(`SAFETY: Files in ${safetyDirs.join('/, ')}/ are safety-critical (IEC 61508 domain). Do NOT edit these in a subagent — flag for manual review.`);
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
  process.stderr.write('sub[agent-skill]-inject: ' + e.message + '\n');
  process.stdout.write('{"continue":true}');
}
