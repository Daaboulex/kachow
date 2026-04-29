#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
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

  // Safety-critical detection (SEC-5 v0.2.0 2026-04-23): walk up to nearest
  // .git or .envrc boundary; detect at EACH level (not just cwd + cwd/..).
  // Prior 1-level check missed deep subdirs under safety-critical projects.
  // Configurable via env vars so kachow stays domain-agnostic in public:
  //   KACHOW_SAFETY_DIRS — comma-separated dir names (default: SafetyCritical,HardwareControl)
  //   KACHOW_SAFETY_PATTERNS — regex matching file content (default: IEC 61508/61511)
  const safetyDirs = (process.env.KACHOW_SAFETY_DIRS || 'SafetyCritical,HardwareControl')
    .split(',').map(s => s.trim()).filter(Boolean);
  const safetyContentRegex = (() => {
    try { return new RegExp(process.env.KACHOW_SAFETY_PATTERNS || 'IEC\\s*615(08|11)', 'i'); }
    catch { return /IEC\s*615(08|11)/i; }
  })();
  const hasSafetyDir = (dir) => safetyDirs.some(d => {
    try { return fs.existsSync(path.join(dir, d)); } catch { return false; }
  });
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
    for (let i = 0; i < 10 && walkDir && walkDir !== root; i++) {
      if (hasSafetyDir(walkDir) || hasSafetyContent(walkDir)) { hasSafetyCode = true; break; }
      try {
        if (fs.existsSync(path.join(walkDir, '.git')) ||
            fs.existsSync(path.join(walkDir, '.envrc'))) {
          if (hasSafetyDir(walkDir) || hasSafetyContent(walkDir)) hasSafetyCode = true;
          break;
        }
      } catch {}
      const parent = path.dirname(walkDir);
      if (parent === walkDir) break;
      walkDir = parent;
    }
  } catch {}

  if (hasSafetyCode) {
    rules.push(`SAFETY: Files in safety-critical directories (configured via KACHOW_SAFETY_DIRS=${safetyDirs.join(',')}) are subject to functional-safety standards like IEC 61508/61511. Do NOT edit these in a subagent — flag for manual review.`);
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
