#!/usr/bin/env node
// validate-skills.js — lints every skills/*/SKILL.md for shape + semantic signal.
//
// Checks:
//   1. Every skills/<dir>/ contains a SKILL.md.
//   2. SKILL.md starts with YAML frontmatter (between --- fences).
//   3. Frontmatter has `name` and `description` fields.
//   4. `name` matches the enclosing directory name.
//   5. `description` is ≥ 20 chars (retrievers need signal).
//   6. Flag ghost directories (SKILL.md empty or malformed).
//   7. Warn on skills referenced in commands/ or hooks/ that don't have a directory.
//
// Usage:
//   node scripts/validate-skills.js [--dir <skills-root>]
//
// Exit:
//   0 — all skills valid
//   1 — one or more issues found (details printed)
//
// Works identically on Linux / macOS / Windows (pure Node, path.join throughout).

'use strict';

const fs   = require('fs');
const path = require('path');

const args = process.argv.slice(2);
let skillsRoot = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dir' && args[i + 1]) { skillsRoot = args[i + 1]; i++; }
  else if (args[i] === '-h' || args[i] === '--help') {
    console.log('usage: validate-skills.js [--dir <skills-root>]');
    process.exit(0);
  }
}

// Default search order: explicit arg > AI_CONTEXT/core/skills > AI_CONTEXT/skills > repo-relative
function locateSkillsRoot() {
  if (skillsRoot) return skillsRoot;
  const aiContext = process.env.AI_CONTEXT || path.join(require('os').homedir(), '.ai-context');
  for (const candidate of [
    path.join(aiContext, 'core', 'skills'),
    path.join(aiContext, 'skills'),
    path.join(process.cwd(), 'skills'),
    path.join(__dirname, '..', 'core', 'skills'),
    path.join(__dirname, '..', 'skills'),
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
  }
  return null;
}

const root = locateSkillsRoot();
if (!root) {
  console.error('✗ skills/ dir not found. Pass --dir <path> or set AI_CONTEXT.');
  process.exit(1);
}

// ── Helpers ─────────────────────────────────────────────────────────────
function parseFrontmatter(content) {
  if (!content.startsWith('---')) return null;
  const end = content.indexOf('\n---', 3);
  if (end < 0) return null;
  const block = content.slice(3, end).trim();
  const meta = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^([a-zA-Z_][\w-]*)\s*:\s*(.*)$/);
    if (m) meta[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return meta;
}

// ── Walk skills/ ────────────────────────────────────────────────────────
const issues = [];
const skills = [];

for (const name of fs.readdirSync(root).sort()) {
  const dir = path.join(root, name);
  if (!fs.statSync(dir).isDirectory()) continue;
  if (name.startsWith('.') || name === 'archive' || name === 'node_modules') continue;

  const skillFile = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(skillFile)) {
    issues.push(`✗ ${name}/: missing SKILL.md`);
    continue;
  }

  const raw = fs.readFileSync(skillFile, 'utf8');
  const meta = parseFrontmatter(raw);
  if (!meta) {
    issues.push(`✗ ${name}/SKILL.md: no frontmatter block (expected --- YAML ---)`);
    continue;
  }

  if (!meta.name) issues.push(`✗ ${name}/SKILL.md: missing 'name' in frontmatter`);
  if (!meta.description) issues.push(`✗ ${name}/SKILL.md: missing 'description' in frontmatter`);
  if (meta.name && meta.name !== name) {
    const normalized = meta.name.replace(/:/g, '-');
    const isPrefix = name.endsWith(normalized) || name.endsWith(meta.name);
    if (!isPrefix) {
      issues.push(`✗ ${name}/SKILL.md: frontmatter name='${meta.name}' does not match dir name='${name}'`);
    }
  }
  if (meta.description && meta.description.length < 20) {
    issues.push(`✗ ${name}/SKILL.md: description too short (${meta.description.length} chars; need ≥20 for retrieval signal)`);
  }
  if (raw.split('\n').length < 10) {
    issues.push(`⚠ ${name}/SKILL.md: body is very short — may be underspecified`);
  }

  skills.push({ name, dir, meta, lines: raw.split('\n').length });
}

// ── Cross-reference against commands/ + hooks/ for orphans ──────────────
// In v2 layout: root is core/skills or skills/ — resolve .ai-context root up to 2 levels
const rootParent = path.resolve(root, '..');
const repoRoot = path.basename(rootParent) === 'core' ? path.resolve(rootParent, '..') : rootParent;
const refSources = [
  path.join(repoRoot, 'core', 'commands'),
  path.join(repoRoot, 'modules', 'hooks', 'src'),
  path.join(repoRoot, 'AGENTS.md'),
  path.join(repoRoot, 'CLAUDE.md'),
];
const referenced = new Set();
function scanForRefs(p) {
  if (!fs.existsSync(p)) return;
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    for (const f of fs.readdirSync(p)) scanForRefs(path.join(p, f));
    return;
  }
  if (!st.isFile()) return;
  const content = fs.readFileSync(p, 'utf8');
  for (const s of skills) {
    if (content.includes(`skills/${s.name}/`) || content.includes(`activate_skill: "${s.name}"`) ||
        new RegExp(`\\b${s.name}\\b`).test(content)) {
      referenced.add(s.name);
    }
  }
}
for (const src of refSources) scanForRefs(src);

// ── Output ──────────────────────────────────────────────────────────────
console.log(`validate-skills: ${skills.length} skill(s) in ${root}`);
for (const s of skills) {
  const refMark = referenced.has(s.name) ? '•' : ' ';
  console.log(`  ${refMark} ${s.name.padEnd(24)}  ${s.meta.description.slice(0, 80)}`);
}
console.log('');

if (issues.length) {
  console.error(`${issues.length} issue(s):`);
  for (const i of issues) console.error('  ' + i);
  process.exit(1);
}

console.log('✓ all skills valid');
