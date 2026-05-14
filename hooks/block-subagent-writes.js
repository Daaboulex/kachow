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
// SEC-4 (2026-04-23): env-var override removed. Prior `SKIP_SUBAGENT_BLOCK=1`
// was self-disclosed in block-reason, allowing a compromised subagent to
// prepend the env var to its next command and bypass. No env bypass exists.
// If a parent truly needs to authorize a subagent write, run the command in
// parent context directly.
//
// Ref: unified-tracking plan Wave 2.6 (2026-04-16)

const fs = require('fs');
const path = require('path');
const os = require('os');
let _isSubagentCached = undefined;

function passthrough() {
  process.stdout.write('{"continue":true}');
  process.exit(0);
}

try {
  // SEC-4: SKIP_SUBAGENT_BLOCK env var removed 2026-04-23. No bypass.

  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { passthrough(); }
  const input = JSON.parse(raw);

  const sessionId = input.session_id || '';
  const command = (input.tool_input || {}).command || '';

  if (!sessionId || !command) passthrough();

  // Check marker files (written by SubagentStart hook, keyed by session_id-pid).
  // Module-level cache: computed once per process, avoids readdirSync on every call.
  const tp = require('./lib/tool-paths.js');
  const markerDir = tp.subagentMarkerDir;
  if (_isSubagentCached === undefined) {
    _isSubagentCached = false;
    try {
      for (const f of fs.readdirSync(markerDir)) {
        if (f.startsWith(sessionId + '-') && f.endsWith('.json')) { _isSubagentCached = true; break; }
      }
    } catch {}
  }
  if (!_isSubagentCached) passthrough();

  // Subagent context confirmed. Check command against blocked patterns.
  // R-AUDIT-5 hardening (2026-04-25):
  //   - Add gh state-changing commands (pr/repo/release/issue/workflow/secret/gist/api -X)
  //   - Allow optional `-C <dir>` flag in git regex (so `git -C /tmp push` blocks)
  //   - Split command into ATOMS by shell metacharacters (;, &&, ||, |, &, newlines)
  //     and check each atom — prevents `; git push` and `true && git push` bypass
  //   - Extract bash/sh/zsh/dash -c '<inner>' and check inner separately
  const blockedPatterns = [
    // Git state-changing — accept optional `-C <dir>` segment
    /^git\s+(?:-C\s+\S+\s+)?commit\b/,
    /^git\s+(?:-C\s+\S+\s+)?push\b/,
    /^git\s+(?:-C\s+\S+\s+)?merge\b/,
    /^git\s+(?:-C\s+\S+\s+)?rebase\b/,
    /^git\s+(?:-C\s+\S+\s+)?reset\s+--hard\b/,
    /^git\s+(?:-C\s+\S+\s+)?cherry-pick\b/,
    /^git\s+(?:-C\s+\S+\s+)?revert\b/,
    /^git\s+(?:-C\s+\S+\s+)?tag\s+-[fd]\b/,
    /^git\s+(?:-C\s+\S+\s+)?branch\s+-[dD]\b/,
    /^git\s+(?:-C\s+\S+\s+)?checkout\s+(--\s|-b\s)/,
    /^git\s+(?:-C\s+\S+\s+)?add\s+(-A|--all|\.)\s*$/,
    /^git\s+(?:-C\s+\S+\s+)?restore\s+(--staged|\.)/,
    /^git\s+(?:-C\s+\S+\s+)?clean\s+-[fFxXdd]/,
    /^git\s+(?:-C\s+\S+\s+)?submodule\s+(update|add)/,
    /^git\s+(?:-C\s+\S+\s+)?worktree\s+(add|remove)/,
    /^git\s+(?:-C\s+\S+\s+)?stash\s+(drop|clear)/,
    // gh state-changing — F4.A
    /^gh\s+pr\s+(create|merge|close|edit|comment|review|ready|reopen)\b/,
    /^gh\s+repo\s+(create|delete|edit|fork|rename|transfer|archive|unarchive|sync)\b/,
    /^gh\s+release\s+(create|delete|edit|upload|download)\b/,
    /^gh\s+issue\s+(create|close|edit|delete|transfer|reopen|comment)\b/,
    /^gh\s+workflow\s+(run|enable|disable)\b/,
    /^gh\s+secret\s+(set|delete)\b/,
    /^gh\s+variable\s+(set|delete)\b/,
    /^gh\s+gist\s+(create|delete|edit)\b/,
    /^gh\s+label\s+(create|delete|edit|clone)\b/,
    /^gh\s+ruleset\s+(create|delete|edit)\b/,
    /^gh\s+api\b.*\s+-X\s+(POST|PUT|DELETE|PATCH)\b/i,
    /^gh\s+api\b.*\s+--method\s+(POST|PUT|DELETE|PATCH)\b/i,
  ];

  // F4.D: split command into atoms before pattern check.
  // Naive split — does not handle full shell quoting, but covers common bypasses.
  function splitAtoms(cmd) {
    const atoms = [];
    // 1. Extract bash/sh/zsh/dash -c '<inner>' or "<inner>" — check inner separately
    const shellCRe = /(?:^|[\s;&|])(?:bash|sh|zsh|dash|ash)\s+-c\s+(['"])([\s\S]*?)\1/g;
    let m;
    while ((m = shellCRe.exec(cmd)) !== null) {
      atoms.push(m[2].trim());
    }
    // 2. Split on shell metacharacters: ;, &&, ||, |, &, newlines, backticks-extract not handled
    const parts = cmd.split(/\s*(?:;|&&|\|\||\||&(?!\&)|\n|\r)\s*/);
    for (const p of parts) {
      const t = p.trim();
      if (!t) continue;
      // Strip common command-prefix wrappers that don't change semantics
      const stripped = t
        .replace(/^(?:time|nice|nohup|sudo|env\s+\S+=\S+)\s+/, '')
        .trim();
      if (stripped) atoms.push(stripped);
    }
    return atoms;
  }

  const atoms = splitAtoms(command);
  let matchedAtom = null;
  let matchedPattern = null;
  for (const atom of atoms) {
    const re = blockedPatterns.find(p => p.test(atom));
    if (re) { matchedAtom = atom; matchedPattern = re; break; }
  }

  if (matchedAtom) {
    try {
      const logPath = path.join(os.homedir(), '.ai-context', 'instances', 'subagent-blocks.jsonl');
      fs.appendFileSync(logPath, JSON.stringify({ ts: new Date().toISOString(), hook: 'block-subagent-writes', blocked: matchedAtom.slice(0, 200), session_id: sessionId }) + '\n');
    } catch {}
    process.stdout.write(JSON.stringify({
      continue: false,
      decision: 'block',
      reason: `Subagent cannot execute state-changing commands (git or gh).\n\n` +
              `Blocked atom: "${matchedAtom.slice(0, 200)}"\n` +
              (atoms.length > 1 ? `(extracted from compound command with ${atoms.length} segments)\n` : '') +
              `\nRule: Subagents may READ git/gh state (status, log, diff, pr view, etc.) ` +
              `but cannot commit, push, merge, rebase, reset, cherry-pick, revert, ` +
              `delete branches, force tags, modify worktrees/submodules, or perform ` +
              `gh state changes (pr create, release create, repo create, etc.).\n\n` +
              `Parent conversation must handle all state changes. Report your ` +
              `file changes via your return value for parent review.`
    }));
    process.exit(0);
  }

  passthrough();
} catch (e) {
  try { require('./lib/hook-logger.js').logError('block-subagent-writes', e); } catch {}
  passthrough();
}
