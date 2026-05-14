#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// PostToolUse hook: SUPPLEMENTARY memory index updater.
// Fires on LLM Write/Edit to memory/*.md — appends new entries to MEMORY.md.
// Primary mechanism is the Stop hook memory-index-verify.js.
// This hook catches LLM memory writes in real-time (Claude/Gemini only).
// v0.9.5 W3-FIX1

const fs = require('fs');
const path = require('path');
const { rebuildCache } = require('./lib/frontmatter-cache.js');

function passthrough() {
  process.stdout.write('{"continue":true}');
  process.exit(0);
}

try {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { passthrough(); }
  const input = JSON.parse(raw || '{}');

  const filePath = input.tool_input?.file_path || input.tool_response?.filePath || '';
  if (!filePath) passthrough();

  // Only act on memory/*.md files
  const norm = filePath.replace(/\\/g, '/');
  if (!norm.includes('/memory/') || !norm.endsWith('.md')) passthrough();
  const basename = path.basename(norm);
  if (basename === 'MEMORY.md') passthrough();

  // Find the MEMORY.md in the same directory
  const memDir = path.dirname(filePath);
  const indexPath = path.join(memDir, 'MEMORY.md');
  if (!fs.existsSync(indexPath)) passthrough();

  // Check if already indexed
  const indexContent = fs.readFileSync(indexPath, 'utf8');
  if (indexContent.includes(`(${basename})`)) passthrough();

  // Rebuild full compact index so new entry lands in correct type group
  const migrate = require('./lib/memory-migrate.js');
  migrate.rebuildIndex(memDir);

  // Rebuild frontmatter cache (v0.9.5 W1-OPT1)
  try { rebuildCache(memDir); } catch {}

  passthrough();
} catch (e) {
  try { require('./lib/hook-logger.js').logError('memory-index-updater', e); } catch {}
  passthrough();
}
