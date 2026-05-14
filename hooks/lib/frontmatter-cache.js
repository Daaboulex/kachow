// frontmatter-cache.js — Cached memory frontmatter to avoid scanning 260+ files at startup.
// Cache is local-only (.stignore excludes .frontmatter-cache.json).
// Treated as untrusted: validated on read, rebuilt on mismatch or corruption.
// v0.9.5 W1-OPT1

const fs = require('fs');
const path = require('path');
const os = require('os');

const CACHE_FILENAME = '.frontmatter-cache.json';

function cachePath(memoryDir) {
  return path.join(memoryDir, CACHE_FILENAME);
}

function parseFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split('\n')) {
    const mm = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (mm) fm[mm[1]] = mm[2].trim();
  }
  return fm;
}

function collectMdFiles(dir) {
  const results = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === CACHE_FILENAME || entry.name === 'MEMORY.md') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        results.push(...collectMdFiles(full));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(full);
      }
    }
  } catch {}
  return results;
}

function readCache(memoryDir) {
  const cp = cachePath(memoryDir);
  try {
    const raw = fs.readFileSync(cp, 'utf8');
    const cache = JSON.parse(raw);
    if (!cache || cache.version !== 1 || typeof cache.entries !== 'object') return null;
    if (new Date(cache.updated).getTime() > Date.now() + 60000) return null;
    return cache;
  } catch {
    return null;
  }
}

function rebuildCache(memoryDir) {
  const files = collectMdFiles(memoryDir);
  const entries = {};
  for (const fp of files) {
    try {
      const relPath = path.relative(memoryDir, fp);
      const head = fs.readFileSync(fp, 'utf8').split('\n').slice(0, 20).join('\n');
      const fm = parseFrontmatter(head);
      if (!fm) continue;
      const st = fs.statSync(fp);
      entries[relPath] = {
        name: fm.name || path.basename(fp, '.md'),
        type: fm.type || 'unknown',
        description: fm.description || '',
        valid_until: fm.valid_until || null,
        superseded_by: fm.superseded_by || fm.supersedes || null,
        confidence: fm.confidence ? parseFloat(fm.confidence) : null,
        observation_level: fm.observation_level || null,
        last_accessed: fm.last_accessed || null,
        status: fm.status || 'active',
        mtime: st.mtimeMs,
      };
    } catch {}
  }

  const cache = {
    version: 1,
    updated: new Date().toISOString(),
    fileCount: Object.keys(entries).length,
    entries,
  };

  const cp = cachePath(memoryDir);
  const tmp = cp + '.tmp.' + process.pid;
  try {
    fs.writeFileSync(tmp, JSON.stringify(cache));
    fs.renameSync(tmp, cp);
  } catch {
    try { fs.unlinkSync(tmp); } catch {}
  }
  return cache;
}

function needsRebuild(cache, memoryDir) {
  if (!cache) return true;
  // Check dir mtime + subdirs
  const dirsToCheck = [memoryDir];
  try {
    for (const d of fs.readdirSync(memoryDir, { withFileTypes: true })) {
      if (d.isDirectory() && !d.name.startsWith('.')) {
        dirsToCheck.push(path.join(memoryDir, d.name));
      }
    }
  } catch {}
  const cacheTime = new Date(cache.updated).getTime();
  for (const d of dirsToCheck) {
    try {
      if (fs.statSync(d).mtimeMs > cacheTime) return true;
    } catch {}
  }
  // Fallback: file count comparison
  const currentCount = collectMdFiles(memoryDir).length;
  if (currentCount !== cache.fileCount) return true;
  return false;
}

function getCachedEntries(memoryDir) {
  let cache = readCache(memoryDir);
  if (needsRebuild(cache, memoryDir)) {
    cache = rebuildCache(memoryDir);
  }
  // Validate: check a sample of entries exist
  const keys = Object.keys(cache.entries);
  if (keys.length > 0) {
    const sample = keys.slice(0, Math.min(3, keys.length));
    for (const k of sample) {
      if (!fs.existsSync(path.join(memoryDir, k))) {
        cache = rebuildCache(memoryDir);
        break;
      }
    }
  }
  return cache.entries;
}

module.exports = { getCachedEntries, rebuildCache, readCache, parseFrontmatter, cachePath };
