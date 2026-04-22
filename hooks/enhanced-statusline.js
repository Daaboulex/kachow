#!/usr/bin/env node
// Claude-native enhanced statusline hook
// Shows: model | git branch+status | GSD task | context bar | elapsed | tokens
// Uses shared renderer: require('./lib/statusline-renderer')

const fs = require('fs');
const path = require('path');
const os = require('os');

const { COLORS, formatGit, formatContext, formatModel } = require('./lib/statusline-renderer');

const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

// Timeout guard — exit cleanly if stdin never arrives
const stdinTimeout = setTimeout(() => process.exit(0), 3000);

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    const parts = [];

    // --- Model (dimmed, compact) ---
    const modelName = data.model?.display_name || 'Claude';
    parts.push(formatModel(modelName));

    // --- Git branch + dirty (cached, fast) ---
    const dir = data.workspace?.current_dir || data.cwd || process.cwd();
    const gitInfo = formatGit(dir);
    if (gitInfo) {
      parts.push(gitInfo);
    }

    // --- Project identity badge ([user] vs nix vs github-ok) ---
    try {
      const { detect } = require('./lib/project-identity.js');
      const identity = detect(dir);
      if (identity && identity.statusBadge) {
        parts.push(identity.statusBadge);
      }
    } catch {}

    // --- Self-improvement queue badge: ⚙N (only when queue non-empty) ---
    try {
      const queue = require('./lib/self-improvement/queue.js');
      const s = queue.summary();
      if (s.total > 0) {
        const color = s.BLOCKER > 0 ? '\x1b[31m' : '\x1b[33m';  // red if BLOCKER, yellow else
        parts.push(`${color}\u2699${s.total}\x1b[0m`);
      }
    } catch {}

    // --- GSD current task (Claude-specific: uses session_id + todos) ---
    const session = data.session_id || '';
    const task = getGsdTask(session);
    if (task) {
      parts.push(`${COLORS.BOLD}${task}${COLORS.RESET}`);
    }

    // --- Context bar (Claude-specific: uses context_window.remaining_percentage) ---
    const remaining = data.context_window?.remaining_percentage;
    if (remaining != null) {
      const AUTO_COMPACT_BUFFER_PCT = 16.5;
      const usableRemaining = Math.max(0, ((remaining - AUTO_COMPACT_BUFFER_PCT) / (100 - AUTO_COMPACT_BUFFER_PCT)) * 100);
      const used = Math.max(0, Math.min(100, Math.round(100 - usableRemaining)));

      // Write bridge file for context-monitor hook
      writeBridge(session, remaining, used);

      parts.push(formatContext(used));
    }

    // --- Elapsed time (Claude-specific: uses cost.total_duration_ms) ---
    const durationMs = data.cost?.total_duration_ms;
    if (durationMs != null && durationMs > 0) {
      const mins = Math.floor(durationMs / 60000);
      const secs = Math.floor((durationMs % 60000) / 1000);
      const timeStr = mins > 0 ? `${mins}m${secs}s` : `${secs}s`;
      parts.push(`${COLORS.DIM}${timeStr}${COLORS.RESET}`);
    }

    // --- Session token usage (Claude-specific: uses cost.total_input/output_tokens) ---
    const inTok = data.cost?.total_input_tokens;
    const outTok = data.cost?.total_output_tokens;
    const msgs = data.cost?.message_count;
    if (inTok != null || outTok != null) {
      const fmt = n => n >= 1000000 ? (n/1000000).toFixed(1)+'M' : n >= 1000 ? Math.round(n/1000)+'K' : ''+n;
      let tok = COLORS.DIM;
      if (inTok) tok += '\u2193' + fmt(inTok);
      if (outTok) tok += ' \u2191' + fmt(outTok);
      if (msgs) tok += ` ${msgs}msg`;
      tok += COLORS.RESET;
      parts.push(tok);
    }

    // --- GSD update notification ---
    const gsdUpdate = getGsdUpdateNotice();

    // --- Output ---
    const line = (gsdUpdate ? gsdUpdate + ' ' : '') + parts.join(` ${COLORS.DIM}\u2502${COLORS.RESET} `);
    process.stdout.write(line);

  } catch (e) {
    // Silent fail — statusline is non-critical
  }
});

// --- Helper: GSD current task (Claude-specific) ---
function getGsdTask(session) {
  if (!session) return null;
  const todosDir = path.join(claudeDir, 'todos');
  if (!fs.existsSync(todosDir)) return null;

  try {
    const files = fs.readdirSync(todosDir)
      .filter(f => f.startsWith(session) && f.includes('-agent-') && f.endsWith('.json'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(todosDir, f)).mtime }))
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length > 0) {
      const todos = JSON.parse(fs.readFileSync(path.join(todosDir, files[0].name), 'utf8'));
      const inProgress = todos.find(t => t.status === 'in_progress');
      if (inProgress) {
        let label = inProgress.activeForm || '';
        if (label.length > 40) label = label.slice(0, 37) + '...';
        return label;
      }
    }
  } catch (e) {}
  return null;
}

// --- Helper: Write bridge file for context-monitor (Claude-specific) ---
function writeBridge(session, remaining, used) {
  if (!session) return;
  try {
    const bridgePath = path.join(os.tmpdir(), `claude-ctx-${session}.json`);
    fs.writeFileSync(bridgePath, JSON.stringify({
      session_id: session,
      remaining_percentage: remaining,
      used_pct: used,
      timestamp: Math.floor(Date.now() / 1000)
    }));
  } catch (e) {}
}

// --- Helper: GSD update notice (Claude-specific) ---
function getGsdUpdateNotice() {
  const cacheFile = path.join(claudeDir, 'cache', 'gsd-update-check.json');
  if (!fs.existsSync(cacheFile)) return '';

  try {
    const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    let notice = '';
    if (cache.update_available) {
      notice += '\x1b[33m\u2B06 /gsd:update\x1b[0m';
    }
    if (cache.stale_hooks && cache.stale_hooks.length > 0) {
      notice += (notice ? ' ' : '') + '\x1b[31m\u26A0 stale hooks\x1b[0m';
    }
    return notice;
  } catch (e) {}
  return '';
}
