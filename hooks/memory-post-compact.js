#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// PostCompact hook: memory-compression coupling.
// When context compaction occurs, re-inject critical peer-card facts
// so they survive the compression. Pattern from Honcho's on_pre_compress.

const fs = require('fs');
const path = require('path');
const os = require('os');

try {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }
  const input = JSON.parse(raw);
  const cwd = input.cwd || process.cwd();

  // Log compaction event
  try {
    const obs = require('./lib/observability-logger.js');
    obs.logEvent(cwd, {
      type: 'context_compaction',
      source: 'memory-post-compact',
      meta: { session_id: input.session_id || 'unknown' }
    });
  } catch {}

  // Read peer-card if exists — these are the most critical facts
  const peerCardPaths = [
    path.join(cwd, '.ai-context', 'memory', 'peer-card.md'),
    path.join(cwd, '.claude', 'memory', 'peer-card.md'),
    path.join(os.homedir(), '.ai-context', 'memory', 'peer-card.md'),
  ];

  let peerCardContent = null;
  for (const p of peerCardPaths) {
    if (fs.existsSync(p)) {
      try {
        const content = fs.readFileSync(p, 'utf8');
        // Strip frontmatter
        const bodyMatch = content.match(/---[\s\S]*?---\s*([\s\S]*)/);
        peerCardContent = bodyMatch ? bodyMatch[1].trim() : content.trim();
        break;
      } catch {}
    }
  }

  if (peerCardContent) {
    process.stdout.write(JSON.stringify({
      continue: true,
      systemMessage: `[post-compact] Critical context re-injected from peer-card:\n${peerCardContent}`
    }));
  } else {
    process.stdout.write('{"continue":true}');
  }
} catch (e) {
  try { process.stderr.write('memory-post-compact: ' + e.message + '\n'); } catch {}
  process.stdout.write('{"continue":true}');
}
