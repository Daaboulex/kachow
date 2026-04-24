#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// PreToolUse hook: Block subagents from git state-changing commands.
// Universal — applies to every project, not just safety-critical.
//
// Mechanism:
//   1. SubagentStart hook (subagent-harness-inject.js) writes
//      ~/.claude/cache/subagent-active/<session_id>.json marker
//   2. This hook (PreToolUse on Bash) checks if marker exists for current session_id
//   3. If yes AND command matches blocked regex → return {decision: "block", reason}
//   4. SubagentStop hook (subagent-quality-gate.js) removes marker
//
// Fail-open design: if SubagentStart hook fails to write marker, this hook
// no-ops and main conversation commits still work. Silent failure is logged
// to stderr for observability.
//
// SEC-4 (v0.2.0 2026-04-23): env-var override removed. Prior
// SKIP_SUBAGENT_BLOCK=1 was self-disclosed in block-reason, allowing a
// compromised subagent to prepend it to next command and bypass. No env
// bypass exists. If a parent truly needs to authorize a subagent write,
// run the command in parent context directly.

const fs = require('fs');
const path = require('path');
const os = require('os');

function passthrough() {
  process.stdout.write('{"continue":true}');
  process.exit(0);
}

try {
  // SEC-4 (v0.2.0): SKIP_SUBAGENT_BLOCK env var removed.

  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { passthrough(); }
  const input = JSON.parse(raw);

  const sessionId = input.session_id || '';
  const command = (input.tool_input || {}).command || '';

  if (!sessionId || !command) passthrough();

  // Check marker file (written by SubagentStart hook)
  const markerDir = path.join(os.homedir(), '.claude', 'cache', 'subagent-active');
  const markerPath = path.join(markerDir, `${sessionId}.json`);
  if (!fs.existsSync(markerPath)) passthrough();

  // Subagent context confirmed. Check command against blocked patterns.
  const blockedPatterns = [
    /^git\s+commit\b/,
    /^git\s+push\b/,
    /^git\s+merge\b/,
    /^git\s+rebase\b/,
    /^git\s+reset\s+--hard\b/,
    /^git\s+cherry-pick\b/,
    /^git\s+revert\b/,
    /^git\s+tag\s+-[fd]\b/,
    /^git\s+branch\s+-[dD]\b/,
    /^git\s+checkout\s+(--\s|-b\s)/,
    /^git\s+add\s+(-A|--all|\.)\s*$/,
    /^git\s+restore\s+(--staged|\.)/,
    /^git\s+clean\s+-[fFxXdd]/,
    /^git\s+submodule\s+(update|add)/,
    /^git\s+worktree\s+(add|remove)/,
    /^git\s+stash\s+(drop|clear)/,
  ];

  // Evaluate first non-empty line (block even if wrapped in &&, ;, or heredoc)
  const cmdFirst = command.trim().split('\n')[0].trim();
  const matched = blockedPatterns.find(re => re.test(cmdFirst));

  if (matched) {
    process.stdout.write(JSON.stringify({
      continue: false,
      decision: 'block',
      reason: `Subagent cannot execute git state-changing commands.\n\n` +
              `Blocked: "${cmdFirst}"\n\n` +
              `Rule: Subagents may read git state (status, log, diff, show, ls-files, grep) ` +
              `but cannot commit, push, merge, rebase, reset, cherry-pick, revert, ` +
              `delete branches, force tags, or modify worktrees/submodules.\n\n` +
              `Parent conversation must handle all git state changes. Report your ` +
              `file changes via your return value for parent review.`
    }));
    process.exit(0);
  }

  passthrough();
} catch (e) {
  try { process.stderr.write('block-subagent-writes: ' + e.message + '\n'); } catch {}
  passthrough();
}
