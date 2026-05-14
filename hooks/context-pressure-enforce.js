#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// PostToolUse hook: Enforces context pressure thresholds documented in CLAUDE.md.
//
// ENFORCES context pressure thresholds
// at 20%/15%/8% remaining (80%/85%/92% used), matching the rule:
//   "At 80% context: advance notice (early warn)"
//   "At 85% context: run /handoff (soft-pause, suggest save)"
//   "At 92% context: stop unconditionally (hard-block, require save)"
//
// Soft-pause (15% remaining): exit 0 with systemMessage strongly urging /handoff.
// Hard-block (8% remaining): exit 2 with stderr — blocks the tool call entirely.
//
// Checks if handoff was saved within last 10 min to avoid spamming after save.
// Disable: CLAUDE_SKIP_CONTEXT_ENFORCE=1 env var.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { toolHomeDir } = require('./lib/tool-detect.js');

// Thresholds tuned for 1M context (Opus 4.6/4.7). Previous values (35/30/20)
// were designed for 200K and fired WAY too early on 1M, wasting tokens nagging.
const EARLY_THRESHOLD = 20; // remaining <= 20% (80% used) — advance notice
const SOFT_THRESHOLD = 15;  // remaining <= 15% (85% used) — suggest /handoff
const HARD_THRESHOLD = 8;   // remaining <= 8% (92% used) — block
const STALE_SECONDS = 60;

function passthrough() {
  process.stdout.write('{"continue":true}');
  process.exit(0);
}

try {
  if (process.env.CLAUDE_SKIP_CONTEXT_ENFORCE === '1') passthrough();

  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }
  const input = JSON.parse(raw || '{}');
  const sessionId = input.session_id;
  const cwd = input.cwd || process.cwd();
  if (!sessionId) passthrough();

  // Read context metrics from statusline bridge
  const ctxFile = path.join(os.tmpdir(), `claude-ctx-${sessionId}.json`);
  let metrics;
  try {
    metrics = JSON.parse(fs.readFileSync(ctxFile, 'utf8'));
  } catch {
    passthrough();  // No metrics available — can't enforce
  }

  // Staleness check
  const age = Date.now() / 1000 - (metrics.timestamp || 0);
  if (age > STALE_SECONDS) passthrough();

  const remaining = metrics.remaining_percentage;
  if (typeof remaining !== 'number') passthrough();

  // Check if handoff was saved recently (within 10 min)
  const handoffPaths = [
    path.join(os.homedir(), '.ai-context', 'handoffs', 'sessions', '.current-session-' + (require('./lib/tool-detect.js').detectTool()) + '.json'),
    path.join(cwd, '.claude', '.session-handoff.md'),
    path.join(cwd, '.ai-context', '.session-handoff.md'),
  ];
  let handoffRecent = false;
  for (const p of handoffPaths) {
    try {
      const mtime = fs.statSync(p).mtimeMs;
      if (Date.now() - mtime < 10 * 60 * 1000) { handoffRecent = true; break; }
    } catch {}
  }

  // Debounce: don't re-fire if we just fired (per-session counter file)
  const home = os.homedir();
  const cacheDir = path.join(toolHomeDir(), 'cache');
  try { fs.mkdirSync(cacheDir, { recursive: true }); } catch {}
  const fireFile = path.join(cacheDir, `ctx-enforce-${sessionId}.last`);
  let lastFire = 0;
  try { lastFire = parseInt(fs.readFileSync(fireFile, 'utf8').trim(), 10) || 0; } catch {}

  if (remaining <= HARD_THRESHOLD) {
    // HARD BLOCK — exit 2 stops the tool call, stderr shown to agent + user
    const msg = handoffRecent
      ? `[CONTEXT 92%+ USED] Handoff exists (${Math.round(remaining)}% remaining). Compaction imminent — consider /wrap-up now.`
      : `[CONTEXT 92%+ USED — HARD STOP] Only ${Math.round(remaining)}% remaining. RUN /handoff NOW before any more tool calls. Set CLAUDE_SKIP_CONTEXT_ENFORCE=1 to override.`;
    try { require('./lib/hook-logger.js').logError('context-pressure-enforce', msg); } catch {}
    try { fs.writeFileSync(fireFile, String(Date.now())); } catch {}
    if (!handoffRecent) process.exit(2);  // Block
    passthrough();  // Already saved, don't block
  } else if (remaining <= SOFT_THRESHOLD) {
    // SOFT WARN — passthrough + systemMessage. Only fire once per ~10 tool calls.
    if (Date.now() - lastFire < 5 * 60 * 1000) passthrough();
    try { fs.writeFileSync(fireFile, String(Date.now())); } catch {}
    const msg = handoffRecent
      ? `[CONTEXT 85% USED] ${Math.round(remaining)}% remaining. Handoff recent — OK to continue but be concise.`
      : `[CONTEXT 85% USED] ${Math.round(remaining)}% remaining. Run /handoff to save state while context is still abundant. At 92% the next tool call will be BLOCKED.`;
    process.stdout.write(JSON.stringify({ continue: true, systemMessage: msg }));
    process.exit(0);
  } else if (remaining <= EARLY_THRESHOLD) {
    // EARLY NOTICE — low-key, infrequent (once per 5 min).
    if (Date.now() - lastFire < 5 * 60 * 1000) passthrough();
    try { fs.writeFileSync(fireFile, String(Date.now())); } catch {}
    const msg = `[context ${Math.round(remaining)}% remaining] Wrap up current task soon — /handoff at 20%.`;
    process.stdout.write(JSON.stringify({ continue: true, systemMessage: msg }));
    process.exit(0);
  }

  passthrough();
} catch {
  passthrough();
}
