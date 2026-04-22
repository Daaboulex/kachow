#!/usr/bin/env node
// PreToolUse hook: Auto-git-stash before destructive bash commands.
//
// Enforces the rule in CLAUDE.md: "Autosave FIRST, then act. No exceptions."
// Rule was documented but never enforced. Now it is.
//
// Triggered patterns (destructive to uncommitted work):
//   - rm -rf / rm -f on multiple files
//   - git reset --hard
//   - git clean -f / -fd / -fx
//   - git checkout -- (discard working tree changes)
//   - git restore --source (overwrite working tree)
//   - sed -i / perl -i -e with multiple files
//   - clang-tidy --fix
//
// Action: if repo is dirty, auto-`git stash push -m "[autosave] <timestamp>"` before allowing.
// On failure or outside git: passthrough (don't block non-git work).
// Log stash ref to .claude/.autosave-stashes.log so user can recover.
//
// Disable: CLAUDE_SKIP_AUTOSAVE=1 env var.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const DESTRUCTIVE_PATTERNS = [
  /\brm\s+(-[fr]+\s+|--force\s+|--recursive\s+)+\S/,  // rm -f/-r with target
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+-[fdx]+/,
  /\bgit\s+checkout\s+--\s+\S/,       // checkout -- <paths>
  /\bgit\s+restore\s+(--source|--worktree)/,
  /\bsed\s+-i\b.*\s+\S+\s+\S+/,        // sed -i with multiple files
  /\bperl\s+-i\b.*-e/,                 // perl -i -e
  /\bclang-tidy\s+.*--fix\b/,
];

// Hard-block patterns: never stash, always reject. Cross-platform dangerous roots.
// Aligns with Claude Code 2.1.113+ sandbox safety checks for macOS /private paths.
const HARD_BLOCK_PATTERNS = [
  /\brm\s+(-[fr]+\s+|--force\s+|--recursive\s+)+\s*\/\s*$/,            // rm -rf /
  /\brm\s+(-[fr]+\s+|--force\s+|--recursive\s+)+\s*\/\*/,              // rm -rf /*
  /\brm\s+(-[fr]+\s+|--force\s+|--recursive\s+)+\s*~\s*$/,             // rm -rf ~
  /\brm\s+(-[fr]+\s+|--force\s+|--recursive\s+)+\s*\$HOME\s*$/,        // rm -rf $HOME
  /\brm\s+(-[fr]+\s+|--force\s+|--recursive\s+)+\/private\/(etc|var|tmp|home)\b/,  // macOS system roots
  /\brmdir\s+.*\/(private\/(etc|var|tmp|home))\b/,
];

function passthrough() {
  process.stdout.write('{"continue":true}');
  process.exit(0);
}

// Walk up from cwd looking for an existing .claude/ or .ai-context/ dir.
// Falls back to the git toplevel. Last resort: cwd itself.
// Prevents writing .claude/ next to unrelated subdirs (e.g. memory/.claude/).
function findRepoRoot(cwd) {
  let dir = cwd;
  const root = path.parse(dir).root;
  while (dir && dir !== root) {
    for (const candidate of ['.claude', '.ai-context']) {
      const p = path.join(dir, candidate);
      try {
        if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return dir;
      } catch {}
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  try {
    const top = execSync('git rev-parse --show-toplevel', {
      cwd, stdio: ['ignore', 'pipe', 'ignore']
    }).toString().trim();
    if (top) return top;
  } catch {}
  return cwd;
}

try {
  if (process.env.CLAUDE_SKIP_AUTOSAVE === '1') passthrough();

  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }
  const input = JSON.parse(raw || '{}');
  const cmd = input.tool_input?.command;
  const cwd = input.cwd || process.cwd();
  if (!cmd) passthrough();

  // Hard-block dangerous root paths regardless of git state
  const hardBlocked = HARD_BLOCK_PATTERNS.some(re => re.test(cmd));
  if (hardBlocked) {
    process.stderr.write(`autosave-before-destructive: BLOCKED dangerous command matching hard-block pattern\n  cmd: ${cmd}\n`);
    process.stdout.write(JSON.stringify({
      decision: 'block',
      reason: 'Matches a hard-blocked pattern (dangerous system root). Refuse even with autosave.',
    }));
    process.exit(2);
  }

  // Check if command matches any destructive pattern
  const matched = DESTRUCTIVE_PATTERNS.some(re => re.test(cmd));
  if (!matched) passthrough();

  // Only act if inside a git repo
  let isRepo = false;
  try {
    execSync('git rev-parse --git-dir', { cwd, timeout: 2000, stdio: 'pipe' });
    isRepo = true;
  } catch {}
  if (!isRepo) passthrough();

  // Check if working tree is dirty
  let dirty = '';
  try {
    dirty = execSync('git status --porcelain', { cwd, timeout: 2000, encoding: 'utf8' }).trim();
  } catch {}
  if (!dirty) passthrough();  // Clean tree, no state to save

  // Stash with timestamp + command hint
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const cmdHint = cmd.slice(0, 60).replace(/"/g, '');
  const stashMsg = `[autosave] ${ts} pre-destructive: ${cmdHint}`;
  let stashRef = '';
  function stashCount() {
    try {
      const out = execSync('git stash list', { cwd, timeout: 2000, encoding: 'utf8' });
      return out.split('\n').filter(Boolean).length;
    } catch { return 0; }
  }
  try {
    const before = stashCount();
    execSync(`git stash push -u -m "${stashMsg}"`, { cwd, timeout: 15000, stdio: 'pipe' });
    const after = stashCount();
    // git stash push can succeed without creating a stash (e.g. only submodule / ignored changes).
    // If no new stash appeared, treat as no-op: skip rev-parse and let the destructive op proceed.
    if (after <= before) passthrough();
    stashRef = execSync('git rev-parse stash@{0}', { cwd, timeout: 2000, encoding: 'utf8' }).trim();
    // Immediately pop it back — we want the stash ref as safety net, not actually clear working tree
    execSync('git stash pop --quiet', { cwd, timeout: 15000, stdio: 'pipe' });
  } catch (e) {
    // Stash failed — don't block, but warn
    process.stdout.write(JSON.stringify({
      continue: true,
      systemMessage: `[autosave-warn] Could not auto-stash before destructive op: ${e.message}. Proceed at your own risk.`
    }));
    process.exit(0);
  }

  // Log stash ref for recovery — write to repo root .claude/, not cwd's
  try {
    const repoRoot = findRepoRoot(cwd);
    const logDir = path.join(repoRoot, '.claude');
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, '.autosave-stashes.log');
    const line = `${ts}\t${stashRef}\t${cmdHint}\n`;
    fs.appendFileSync(logFile, line);
  } catch {}

  process.stdout.write(JSON.stringify({
    continue: true,
    systemMessage: `[autosave] Stashed state before destructive op. Recovery: \`git stash apply ${stashRef}\` (logged to .claude/.autosave-stashes.log).`
  }));
} catch {
  passthrough();
}
