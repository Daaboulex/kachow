// Shared helpers for auto-pull-global.js + auto-push-global.js
// Deduplicates run()/isGitRepo()/getDefaultBranch()/repos list.

const { execSync } = require('child_process');
const path = require('path');
const os = require('os');

const home = os.homedir();

const REPOS = [
  { dir: path.join(home, '.ai-context'), label: '~/.ai-context' },
  { dir: path.join(home, '.claude'), label: '~/.claude' },
  { dir: path.join(home, '.gemini'), label: '~/.gemini' },
  { dir: path.join(home, '.codex'), label: '~/.codex' },
];

function run(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, timeout: 15000, stdio: 'pipe' }).toString().trim();
  } catch {
    return null;
  }
}

function isGitRepo(dir) {
  return run('git rev-parse --git-dir', dir) !== null;
}

function getDefaultBranch(dir) {
  const branch = run('git rev-parse --verify refs/heads/main', dir);
  return branch !== null ? 'main' : 'master';
}

function hasChanges(dir) {
  const status = run('git status --porcelain', dir);
  return status !== null && status.length > 0;
}

function hasUnpushedCommits(dir) {
  const branch = getDefaultBranch(dir);
  const ahead = run(`git rev-list origin/${branch}..HEAD --count`, dir);
  return ahead !== null && parseInt(ahead) > 0;
}

module.exports = { REPOS, run, isGitRepo, getDefaultBranch, hasChanges, hasUnpushedCommits };
