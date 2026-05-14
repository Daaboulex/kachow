#!/usr/bin/env node
// install-adapters.mjs (v2)
// Reads modules/tools/*/symlinks.yaml and creates symlinks.
// Idempotent — safe to re-run. Backs up pre-existing files.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const HOME = os.homedir();

function expandTilde(p) { return p.replace(/^~/, HOME); }

function parseSymlinksYaml(text) {
  const links = [];
  let current = null;
  let inLinks = false;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trimEnd();
    if (!line.trim()) continue;
    const trimmed = line.trim();
    if (trimmed === 'links:') { inLinks = true; continue; }
    if (!inLinks) continue;
    if (trimmed.startsWith('- source:')) {
      if (current) links.push(current);
      current = { source: trimmed.replace('- source:', '').trim() };
    } else if (trimmed.startsWith('target:') && current) {
      current.target = trimmed.replace('target:', '').trim();
      links.push(current);
      current = null;
    }
  }
  if (current) links.push(current);
  return links;
}

function ensureLink(srcPath, destPath, label) {
  const destDir = path.dirname(destPath);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  if (fs.existsSync(destPath)) {
    const stat = fs.lstatSync(destPath);
    if (stat.isSymbolicLink()) {
      const current = fs.readlinkSync(destPath);
      const resolved = path.resolve(path.dirname(destPath), current);
      if (resolved === srcPath) {
        console.log(`  ✓ ${label}: ${destPath} (already linked)`);
        return;
      }
      fs.unlinkSync(destPath);
    } else {
      const backup = `${destPath}.pre-ai-context-bak-${Date.now()}`;
      fs.renameSync(destPath, backup);
      console.log(`  ⚠ ${label}: backed up existing to ${path.basename(backup)}`);
    }
  }

  try {
    fs.symlinkSync(srcPath, destPath);
    console.log(`  ✓ ${label}: ${destPath} → ${srcPath}`);
  } catch (e) {
    if (e.code === 'EPERM' && process.platform === 'win32') {
      fs.cpSync(srcPath, destPath, { recursive: true });
      console.log(`  ✓ ${label}: ${destPath} (copy — no symlink permission)`);
    } else {
      console.error(`  ✗ ${label}: ${e.message}`);
    }
  }
}

const tools = ['claude', 'gemini', 'codex', 'pi'];
let total = 0;

for (const tool of tools) {
  const yamlPath = path.join(ROOT, 'modules/tools', tool, 'symlinks.yaml');
  if (!fs.existsSync(yamlPath)) {
    console.log(`  SKIP: ${tool} (no symlinks.yaml)`);
    continue;
  }

  console.log(`\n── ${tool.toUpperCase()} ──`);
  const links = parseSymlinksYaml(fs.readFileSync(yamlPath, 'utf8'));

  for (const { source, target } of links) {
    const srcPath = path.join(ROOT, source);
    const destPath = expandTilde(target);

    if (!fs.existsSync(srcPath)) {
      console.log(`  ⚠ ${tool}: source missing: ${source}`);
      continue;
    }

    ensureLink(srcPath, destPath, tool);
    total++;
  }
}

// Also ensure ~/.agents/skills/ symlinks from .ai-context/.agents/skills/
const agentsSrc = path.join(ROOT, '.agents/skills');
const agentsDest = path.join(HOME, '.agents/skills');
if (fs.existsSync(agentsSrc)) {
  if (!fs.existsSync(agentsDest)) {
    fs.mkdirSync(agentsDest, { recursive: true });
  }
  let skillLinks = 0;
  for (const entry of fs.readdirSync(agentsSrc)) {
    const src = path.join(agentsSrc, entry);
    const dest = path.join(agentsDest, entry);
    if (!fs.existsSync(dest)) {
      try {
        fs.symlinkSync(src, dest);
        skillLinks++;
      } catch {}
    }
  }
  if (skillLinks > 0) console.log(`\n  ✓ ${skillLinks} new skill symlinks in ~/.agents/skills/`);
}

// Gemini: auto-trust current .ai-context directory
const geminiTrustFile = path.join(HOME, '.gemini', 'trustedFolders.json');
if (fs.existsSync(path.join(HOME, '.gemini'))) {
  try {
    let trust = {};
    try { trust = JSON.parse(fs.readFileSync(geminiTrustFile, 'utf8')); } catch {}
    if (trust[ROOT] !== 'TRUST_FOLDER') {
      trust[ROOT] = 'TRUST_FOLDER';
      fs.writeFileSync(geminiTrustFile, JSON.stringify(trust, null, 2));
      console.log(`\n  ✓ Gemini: trusted ${ROOT}`);
    }
  } catch {}
}

console.log(`\n═══ ${total} adapter symlinks verified ═══`);
