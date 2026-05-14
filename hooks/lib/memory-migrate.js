#!/usr/bin/env node
// memory-migrate.js
// Lazy-upgrade memory frontmatter to v2 schema.
//
// v1 schema (current):
//   name, description, type
// v2 schema (added):
//   created, last_verified, last_accessed, ttl_days, evidence[], supersedes?, status
//
// Modes:
//   --scan <dir>          : report files missing v2 fields, no mutation
//   --lazy <file>         : upgrade single file (add missing fields with safe defaults)
//   --bulk <dir>          : upgrade every .md file under dir
//   --rotate <dir>        : archive files where (now - last_verified) > ttl_days
//
// Defaults on lazy upgrade:
//   created        = file mtime (YYYY-MM-DD)
//   last_verified  = file mtime
//   last_accessed  = file atime
//   ttl_days       = 90 (feedback/project) | permanent (user/reference)
//   evidence       = []
//   status         = active

const fs = require('fs');
const path = require('path');
const os = require('os');

function parseFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { fm: null, body: content };
  const lines = m[1].split('\n');
  const fm = {};
  for (const line of lines) {
    const mm = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (mm) fm[mm[1]] = mm[2].trim();
  }
  return { fm, body: m[2], raw: m[1] };
}

function serializeFrontmatter(fm) {
  const order = ['name', 'description', 'type', 'created', 'last_verified', 'last_accessed', 'ttl_days', 'evidence', 'supersedes', 'status'];
  const seen = new Set();
  const lines = [];
  for (const k of order) {
    if (k in fm) {
      lines.push(`${k}: ${fm[k]}`);
      seen.add(k);
    }
  }
  for (const k of Object.keys(fm)) {
    if (!seen.has(k)) lines.push(`${k}: ${fm[k]}`);
  }
  return lines.join('\n');
}

function dateOnly(d) { return d.toISOString().slice(0, 10); }

function defaultTTL(type) {
  if (type === 'user' || type === 'reference') return 'permanent';
  if (type === 'procedure') return '180';
  return '90'; // feedback, project
}

function lazyUpgrade(filePath) {
  const st = fs.statSync(filePath);
  const content = fs.readFileSync(filePath, 'utf8');
  const { fm, body } = parseFrontmatter(content);
  if (!fm) return { changed: false, reason: 'no-frontmatter' };
  const before = JSON.stringify(fm);
  const type = fm.type || 'unknown';
  if (!fm.created) fm.created = dateOnly(st.mtime);
  if (!fm.last_verified) fm.last_verified = dateOnly(st.mtime);
  if (!fm.last_accessed) fm.last_accessed = dateOnly(st.atime);
  if (!fm.ttl_days) fm.ttl_days = defaultTTL(type);
  if (!fm.evidence) fm.evidence = '[]';
  if (!fm.status) fm.status = 'active';
  if (JSON.stringify(fm) === before) return { changed: false, reason: 'already-v2' };
  const out = `---\n${serializeFrontmatter(fm)}\n---\n${body}`;
  fs.writeFileSync(filePath, out);
  return { changed: true, before: JSON.parse(before), after: fm };
}

function scan(dir) {
  const report = { files: [], missing_fields_total: 0 };
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md');
  for (const f of files) {
    const fp = path.join(dir, f);
    const content = fs.readFileSync(fp, 'utf8');
    const { fm } = parseFrontmatter(content);
    if (!fm) continue;
    const missing = ['created', 'last_verified', 'last_accessed', 'ttl_days', 'evidence', 'status'].filter(k => !(k in fm));
    if (missing.length) {
      report.files.push({ file: f, missing });
      report.missing_fields_total += missing.length;
    }
  }
  return report;
}

function bulk(dir) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md');
  const results = [];
  for (const f of files) {
    const r = lazyUpgrade(path.join(dir, f));
    results.push({ file: f, ...r });
  }
  return results;
}

function rotate(dir) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md');
  const archive = path.join(dir, 'archive');
  fs.mkdirSync(archive, { recursive: true });
  const moved = [];
  for (const f of files) {
    const fp = path.join(dir, f);
    const { fm } = parseFrontmatter(fs.readFileSync(fp, 'utf8'));
    if (!fm || fm.ttl_days === 'permanent' || !fm.last_verified) continue;
    const ttl = parseInt(fm.ttl_days, 10);
    if (isNaN(ttl)) continue;
    const ageDays = (Date.now() - new Date(fm.last_verified).getTime()) / 86_400_000;
    if (ageDays > ttl) {
      fs.renameSync(fp, path.join(archive, f));
      moved.push({ file: f, age: Math.round(ageDays), ttl });
    }
  }
  return moved;
}

function rebuildIndex(dir) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md');
  const now = Date.now();
  const entries = [];
  for (const f of files) {
    const fp = path.join(dir, f);
    const content = fs.readFileSync(fp, 'utf8');
    const { fm } = parseFrontmatter(content);
    if (!fm || fm.status === 'archived') continue;
    const lv = fm.last_verified ? new Date(fm.last_verified).getTime() : fs.statSync(fp).mtime.getTime();
    const ageDays = Math.round((now - lv) / 86_400_000);
    entries.push({
      file: f,
      name: fm.name || f,
      description: fm.description || '',
      type: fm.type || 'unknown',
      ageDays,
      ttl: fm.ttl_days || '90',
    });
  }
  const groups = { user: [], feedback: [], project: [], reference: [], procedure: [], unknown: [] };
  for (const e of entries) (groups[e.type] || groups.unknown).push(e);
  for (const k of Object.keys(groups)) groups[k].sort((a, b) => a.ageDays - b.ageDays);

  // Preserve pinned section above AUTO-INDEX sentinels
  const indexPath = path.join(dir, 'MEMORY.md');
  let pinned = '';
  if (fs.existsSync(indexPath)) {
    const existing = fs.readFileSync(indexPath, 'utf8');
    const startMarker = existing.indexOf('<!-- AUTO-INDEX:START -->');
    if (startMarker > 0) {
      pinned = existing.slice(0, startMarker).trimEnd();
    }
  }

  const cwdLabel = path.basename(path.dirname(dir)) === 'memory' ? path.dirname(path.dirname(dir)) : dir;
  if (!pinned) {
    pinned = `# Memory Index — ${cwdLabel}\n\n_${entries.length} entries, refreshed ${new Date().toISOString().slice(0, 10)} (host: ${os.hostname()})_`;
  } else {
    // Update entry count in pinned header if present
    pinned = pinned.replace(/_\d+ entries,/, `_${entries.length} entries,`);
    pinned = pinned.replace(/refreshed \d{4}-\d{2}-\d{2}/, `refreshed ${new Date().toISOString().slice(0, 10)}`);
  }

  // Build compact auto-index: 4 links per line, grouped by type
  const LINKS_PER_LINE = 4;
  const autoLines = [];
  const titles = { user: 'User', feedback: 'Feedback', project: 'Project', reference: 'Reference', procedure: 'Procedure', unknown: 'Other' };
  for (const [k, label] of Object.entries(titles)) {
    if (!groups[k].length) continue;
    autoLines.push(`### ${label} (${groups[k].length})`);
    const links = groups[k].map(e => `[${e.name}](${e.file})`);
    for (let i = 0; i < links.length; i += LINKS_PER_LINE) {
      autoLines.push(links.slice(i, i + LINKS_PER_LINE).join('; '));
    }
    autoLines.push('');
  }

  const out = pinned + '\n\n<!-- AUTO-INDEX:START -->\n' + autoLines.join('\n') + '<!-- AUTO-INDEX:END -->\n';
  fs.writeFileSync(indexPath, out);
  return { entries: entries.length, stale: entries.filter(e => e.ttl !== 'permanent' && e.ageDays > parseInt(e.ttl || '90', 10)).length };
}

if (require.main === module) {
  const [, , cmd, target] = process.argv;
  if (cmd === '--scan') console.log(JSON.stringify(scan(target), null, 2));
  else if (cmd === '--lazy') console.log(JSON.stringify(lazyUpgrade(target), null, 2));
  else if (cmd === '--bulk') console.log(JSON.stringify(bulk(target), null, 2));
  else if (cmd === '--rotate') console.log(JSON.stringify(rotate(target), null, 2));
  else if (cmd === '--rebuild-index') console.log(JSON.stringify(rebuildIndex(target), null, 2));
  else {
    console.error('usage: memory-migrate.js --scan|--lazy|--bulk|--rotate|--rebuild-index <path>');
    process.exit(2);
  }
}

module.exports = { parseFrontmatter, serializeFrontmatter, lazyUpgrade, scan, bulk, rotate, rebuildIndex };
