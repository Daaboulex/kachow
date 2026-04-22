// Shared statusline rendering utilities for Claude + Gemini hooks
// Used by: ~/.claude/hooks/enhanced-statusline.js, ~/.gemini/hooks/enhanced-statusline.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// --- ANSI color codes ---
const COLORS = {
  DIM: '\x1b[2m',
  BOLD: '\x1b[1m',
  RESET: '\x1b[0m',
  GREEN: '\x1b[32m',
  YELLOW: '\x1b[33m',
  ORANGE: '\x1b[38;5;208m',
  RED: '\x1b[31m',
  CYAN: '\x1b[36m',
  BLINK_RED: '\x1b[5;31m',
};

/**
 * Get git branch + status info for a directory.
 * Returns formatted string like "main" or "feat/x ●2●1+3", or null if not a git repo.
 * Uses file-based cache to reduce git calls.
 */
function formatGit(dir) {
  const cacheFile = path.join(os.tmpdir(), `claude-statusline-git-${Buffer.from(dir).toString('base64').slice(0, 20)}.json`);
  const CACHE_MAX_AGE = 10; // seconds

  // Check cache first
  try {
    if (fs.existsSync(cacheFile)) {
      const stat = fs.statSync(cacheFile);
      const age = (Date.now() - stat.mtimeMs) / 1000;
      if (age < CACHE_MAX_AGE) {
        const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        return cached.display || null;
      }
    }
  } catch (e) {}

  try {
    execSync('git rev-parse --git-dir', { cwd: dir, stdio: 'pipe', timeout: 2000 });
    const branch = execSync('git --no-optional-locks rev-parse --abbrev-ref HEAD', { cwd: dir, stdio: 'pipe', timeout: 2000 }).toString().trim();
    const status = execSync('git --no-optional-locks status --porcelain', { cwd: dir, stdio: 'pipe', timeout: 2000 }).toString().trim();

    const lines = status ? status.split('\n') : [];
    const staged = lines.filter(l => l[0] !== ' ' && l[0] !== '?').length;
    const modified = lines.filter(l => l[1] === 'M' || l[1] === 'D').length;
    const untracked = lines.filter(l => l.startsWith('??')).length;

    let display = `${COLORS.CYAN}${branch}${COLORS.RESET}`;
    const indicators = [];
    if (staged > 0) indicators.push(`${COLORS.GREEN}\u25CF${staged}${COLORS.RESET}`);
    if (modified > 0) indicators.push(`${COLORS.YELLOW}\u25CF${modified}${COLORS.RESET}`);
    if (untracked > 0) indicators.push(`${COLORS.DIM}+${untracked}${COLORS.RESET}`);
    if (indicators.length > 0) display += ' ' + indicators.join('');

    // Write cache
    try { fs.writeFileSync(cacheFile, JSON.stringify({ display })); } catch (e) {}

    return display;
  } catch (e) {
    return null;
  }
}

/**
 * Format context usage as a colored bar.
 * @param {number} percent - Context used percentage (0-100)
 * @returns {string} Colored progress bar with percentage
 */
function formatContext(percent) {
  const used = Math.max(0, Math.min(100, Math.round(percent)));
  const filled = Math.floor(used / 10);
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(10 - filled);

  let barColor;
  if (used < 50) barColor = COLORS.GREEN;
  else if (used < 70) barColor = COLORS.YELLOW;
  else if (used < 85) barColor = COLORS.ORANGE;
  else barColor = COLORS.BLINK_RED;

  const prefix = used >= 85 ? '\uD83D\uDC80 ' : '';
  return `${barColor}${prefix}${bar} ${used}%${COLORS.RESET}`;
}

/**
 * Format elapsed time from a start timestamp.
 * @param {number} startMs - Session start time in milliseconds
 * @returns {string} Human-readable duration like "12m" or "1h23m"
 */
function formatElapsed(startMs) {
  const elapsed = Date.now() - startMs;
  if (elapsed < 0) return '0s';

  const totalSecs = Math.floor(elapsed / 1000);
  const hours = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;

  if (hours > 0) return `${COLORS.DIM}${hours}h${mins}m${COLORS.RESET}`;
  if (mins > 0) return `${COLORS.DIM}${mins}m${secs}s${COLORS.RESET}`;
  return `${COLORS.DIM}${secs}s${COLORS.RESET}`;
}

/**
 * Format model name (dimmed, truncated).
 * @param {string} name - Model display name
 * @returns {string} Dimmed, truncated model name
 */
function formatModel(name) {
  const display = truncate(name || 'Unknown', 20);
  return `${COLORS.DIM}${display}${COLORS.RESET}`;
}

/**
 * Truncate string with ellipsis.
 * @param {string} str - Input string
 * @param {number} max - Maximum length (including ellipsis)
 * @returns {string} Truncated string
 */
function truncate(str, max) {
  if (!str || str.length <= max) return str || '';
  return str.slice(0, max - 1) + '\u2026';
}

module.exports = { COLORS, formatGit, formatContext, formatElapsed, formatModel, truncate };
