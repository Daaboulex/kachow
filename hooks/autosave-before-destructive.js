#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
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
  // F4.E (R-AUDIT-5 2026-04-25): R-CTX-style triggers — operations that
  // delete or wipe state where loss-recovery via git stash is valuable.
  /\bfind\b.*\s+-delete\b/,                                  // find ... -delete
  /\bfind\b.*\s+-(?:exec|execdir)\s+rm\b/,                   // find ... -exec rm
  /\brsync\b.*\s+--delete(?:-after|-before|-during|-excluded)?\b/,  // rsync --delete*
  /\bcargo\s+clean\b/,                                       // cargo clean
  /\bnpm\s+(?:clean|prune)\b/,                               // npm clean / prune
  /\byarn\s+(?:clean|cache\s+clean)\b/,                      // yarn clean
  /\bpnpm\s+(?:clean|store\s+prune)\b/,                      // pnpm clean
  /\bnix-collect-garbage\b/,                                 // nix-collect-garbage
  /\bnix\s+store\s+(?:gc|delete|optimise)\b/,                // nix store gc
  /\bdocker\s+(?:system\s+prune|volume\s+rm|image\s+rm|rmi)\b/,
  /\bkubectl\s+delete\b/,
  /\bdd\s+if=\S+\s+of=\/dev\//,                              // dd ... of=/dev/...
  /\bshred\s+-[uvz]+\b/,                                     // shred -uvz
  /\btruncate\s+(?:-s\s+0|--size\s+0)/,                      // truncate -s 0
  /\b(?:>\s*\/dev\/null|>\s*\/dev\/zero)\b.*\bof=/,          // dd-style overwrite
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
    for (const candidate of ['.ai-context', '.claude', '.gemini', '.codex', '.crush']) {
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
  // Safety: use commit instead of stash. Stash is dangerous with concurrent sessions
  // or manual changes — stash push captures ALL changes (including other session's work),
  // and stash pop can fail or silently merge, trapping changes. A commit is recoverable
  // via git log/reflog and doesn't affect the stash stack.
  try {
    // Check if there are changes to save
    const statusOut = execSync('git status --porcelain', { cwd, timeout: 2000, encoding: 'utf8' }).trim();
    if (!statusOut) passthrough(); // nothing to save

    // Create a safety commit (will be on current branch, easy to find)
    execSync('git add -A', { cwd, timeout: 5000, stdio: 'pipe' });
    execSync(`git commit --no-verify --no-gpg-sign -m "${stashMsg}"`, { cwd, timeout: 15000, stdio: 'pipe' });
    stashRef = execSync('git rev-parse HEAD', { cwd, timeout: 2000, encoding: 'utf8' }).trim();
    // Immediately undo the commit but keep changes in working tree
    execSync('git reset --soft HEAD~1', { cwd, timeout: 5000, stdio: 'pipe' });
    // Unstage (return to original dirty state)
    execSync('git reset HEAD', { cwd, timeout: 5000, stdio: 'pipe' });
  } catch (e) {
    // Stash failed — don't block, but warn
    process.stdout.write(JSON.stringify({
      continue: true,
      systemMessage: `[autosave-warn] Could not auto-stash before destructive op: ${e.message}. Proceed at your own risk.`
    }));
    process.exit(0);
  }

  // Log recovery ref — write to .ai-context/ (canonical) or tool-local dir
  const { toolHomeDir } = require('./lib/tool-detect.js');
  try {
    const repoRoot = findRepoRoot(cwd);
    const logDir = path.join(repoRoot, '.ai-context');
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, '.autosave-recovery.log');
    const line = `${ts}\t${stashRef}\t${cmdHint}\n`;
    fs.appendFileSync(logFile, line);
  } catch {}

  process.stdout.write(JSON.stringify({
    continue: true,
    systemMessage: `[autosave] Safety commit before destructive op. Recovery: check git reflog for ${stashRef.slice(0, 8)}.`
  }));
} catch {
  passthrough();
}
