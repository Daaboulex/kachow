#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// PreCompact hook: Trigger /handoff before context compression
// Replaces the vague "write a session anchor" with a structured state dump.
// This fires when auto-compact is about to run — the agent's last chance to save state.
// Cross-platform (Linux, macOS, Windows)
//
// 2.1.105+: Exit code 2 blocks compaction. Used when subagents are running
// or critical unsaved state would be lost.

const fs = require('fs');
const path = require('path');
const os = require('os');

const home = os.homedir();
const scriptDir = __dirname;
const isGemini = scriptDir.includes('.gemini');
const configDir = path.join(home, isGemini ? '.gemini' : '.claude');
const enabledFile = path.join(configDir, '.reflect-enabled');
const lastFile = path.join(configDir, '.reflect-last');

try {
  if (!fs.existsSync(enabledFile)) {
    process.stdout.write('{"continue":true}');
    process.exit(0);
  }

  // Reset cooldown so Stop hook doesn't double-fire
  fs.writeFileSync(lastFile, '');

  // Check if subagents are currently running (block compaction if so)
  const subagentMarker = path.join(configDir, '.subagent-active');
  let subagentRunning = false;
  try {
    const mtime = fs.statSync(subagentMarker).mtimeMs;
    // Marker is fresh (< 5 min) = subagent likely still running
    subagentRunning = (Date.now() - mtime < 5 * 60 * 1000);
  } catch {}

  if (subagentRunning) {
    process.stderr.write('[compact-blocked] Subagent is running — blocking compaction to preserve shared context. Will retry after subagent completes.');
    // Exit code 2 = block compaction (new in 2.1.105)
    process.exit(2);
  }

  // Detect if handoff was already done recently (within last 10 minutes)
  const handoffFile = path.join(process.cwd(), '.claude', '.session-handoff.md');
  const aiContextHandoff = path.join(process.cwd(), '.ai-context', '.session-handoff.md');
  let handoffRecent = false;
  for (const f of [handoffFile, aiContextHandoff]) {
    try {
      const mtime = fs.statSync(f).mtimeMs;
      if (Date.now() - mtime < 10 * 60 * 1000) handoffRecent = true;
    } catch {}
  }

  // Observability: emit context-compact event
  try { require('./lib/observability-logger.js').logEvent(process.cwd(), { type: 'context_compact', source: 'reflect-precompact', meta: { handoffRecent, subagentRunning } }); } catch {}

  if (handoffRecent) {
    process.stdout.write(JSON.stringify({
      systemMessage: '[compact] Handoff already saved. Context will be compressed — the handoff file survives.',
      continue: true
    }));
  } else {
    process.stdout.write(JSON.stringify({
      systemMessage: '[compact] Context is about to be compressed. Run /handoff NOW to save your state — what was done, what\'s in-flight, what needs testing, and what the next session should do. This is your last chance before context is lost. Be fast (1-2 turns max).',
      continue: true
    }));
  }
} catch {
  process.stdout.write('{"continue":true}');
}
