#!/usr/bin/env node
// hook-topology.js
// Reads ~/.claude/settings.json + ~/.gemini/settings.json, builds a
// readable interaction matrix. Detects:
//   - same-event collisions (>1 hook, same event + matcher, blocking)
//   - async/sync mixed ordering
//   - hooks referenced in settings but missing on disk
//   - hooks on disk but not referenced in settings
// Writes ~/.claude/cache/hook-topology.md.

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const OUT = path.join(HOME, '.claude', 'cache', 'hook-topology.md');

function readSettings(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { hooks: {} }; }
}

function normalize(settings, which) {
  const out = [];
  for (const [event, arr] of Object.entries(settings.hooks || {})) {
    for (const entry of arr) {
      const matcher = entry.matcher || '*';
      for (const h of (entry.hooks || [])) {
        const cmd = h.command || '';
        const m = cmd.match(/hooks\/([^"\s]+)\.js/);
        out.push({ which, event, matcher, hook: m ? m[1] : cmd, blocking: !h.async, timeout: h.timeout });
      }
    }
  }
  return out;
}

function listDisk(dir) {
  try { return fs.readdirSync(dir).filter(f => f.endsWith('.js')).map(f => f.replace(/\.js$/, '')); } catch { return []; }
}

function main() {
  const cc = readSettings(path.join(HOME, '.claude', 'settings.json'));
  const gg = readSettings(path.join(HOME, '.gemini', 'settings.json'));
  const rows = [...normalize(cc, 'claude'), ...normalize(gg, 'gemini')];
  const byEvent = {};
  for (const r of rows) {
    const k = `${r.which}|${r.event}|${r.matcher}`;
    (byEvent[k] = byEvent[k] || []).push(r);
  }
  const ccDisk = listDisk(path.join(HOME, '.claude', 'hooks'));
  const ggDisk = listDisk(path.join(HOME, '.gemini', 'hooks'));
  const ccRef = new Set(rows.filter(r => r.which === 'claude').map(r => r.hook));
  const ggRef = new Set(rows.filter(r => r.which === 'gemini').map(r => r.hook));
  const orphansCC = ccDisk.filter(h => !ccRef.has(h));
  const orphansGG = ggDisk.filter(h => !ggRef.has(h));
  const missingCC = [...ccRef].filter(h => !ccDisk.includes(h));
  const missingGG = [...ggRef].filter(h => !ggDisk.includes(h));

  const lines = [];
  lines.push(`# Hook topology — generated ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`Total registered: claude=${rows.filter(r => r.which === 'claude').length}  gemini=${rows.filter(r => r.which === 'gemini').length}`);
  lines.push(`On disk: claude=${ccDisk.length}  gemini=${ggDisk.length}`);
  lines.push('');
  lines.push('## Collisions (same event + matcher, >1 blocking hook)');
  lines.push('');
  const col = Object.entries(byEvent).filter(([, arr]) => arr.filter(r => r.blocking).length > 1);
  if (col.length === 0) lines.push('_none_');
  for (const [k, arr] of col) {
    lines.push(`### ${k}`);
    for (const r of arr) lines.push(`- ${r.hook} (${r.blocking ? 'blocking' : 'async'}, t=${r.timeout})`);
    lines.push('');
  }
  lines.push('## Orphan hooks (on disk, not registered)');
  lines.push('');
  lines.push('### claude');
  lines.push(orphansCC.length ? orphansCC.map(h => `- ${h}`).join('\n') : '_none_');
  lines.push('');
  lines.push('### gemini');
  lines.push(orphansGG.length ? orphansGG.map(h => `- ${h}`).join('\n') : '_none_');
  lines.push('');
  lines.push('## Missing hooks (registered but not on disk)');
  lines.push('');
  lines.push('### claude');
  lines.push(missingCC.length ? missingCC.map(h => `- ${h}`).join('\n') : '_none_');
  lines.push('');
  lines.push('### gemini');
  lines.push(missingGG.length ? missingGG.map(h => `- ${h}`).join('\n') : '_none_');
  lines.push('');
  lines.push('## Full matrix by event');
  lines.push('');
  const events = {};
  for (const r of rows) (events[r.event] = events[r.event] || []).push(r);
  for (const [ev, arr] of Object.entries(events).sort()) {
    lines.push(`### ${ev}`);
    lines.push('| which | matcher | hook | blocking | timeout |');
    lines.push('|---|---|---|---|---|');
    for (const r of arr) lines.push(`| ${r.which} | ${r.matcher} | ${r.hook} | ${r.blocking} | ${r.timeout || '-'} |`);
    lines.push('');
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, lines.join('\n'));
  console.log(`hook-topology: wrote ${OUT}`);
  if (col.length) console.log(`  ${col.length} collision(s)`);
  if (orphansCC.length) console.log(`  ${orphansCC.length} claude orphan(s): ${orphansCC.slice(0, 5).join(', ')}`);
  if (orphansGG.length) console.log(`  ${orphansGG.length} gemini orphan(s): ${orphansGG.slice(0, 5).join(', ')}`);
  if (missingCC.length) console.log(`  ${missingCC.length} claude missing: ${missingCC.join(', ')}`);
  if (missingGG.length) console.log(`  ${missingGG.length} gemini missing: ${missingGG.join(', ')}`);
}

if (require.main === module) main();
module.exports = { main };
