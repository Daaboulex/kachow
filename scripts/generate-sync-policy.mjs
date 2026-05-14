#!/usr/bin/env node

// Generates .gitignore and .stignore from generated/sync/policy.yaml
// Usage: node scripts/generate-sync-policy.mjs [--root <path>]
// Defaults to the parent of the scripts/ directory as root.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootArg = process.argv.indexOf('--root');
const root = rootArg !== -1 ? process.argv[rootArg + 1] : join(__dirname, '..');

const policyPath = join(root, 'generated', 'sync', 'policy.yaml');
const raw = readFileSync(policyPath, 'utf8');

function parseSection(text, sectionName) {
  const re = new RegExp(`^${sectionName}:\\s*$`, 'm');
  const match = re.exec(text);
  if (!match) return [];
  const start = match.index + match[0].length;
  const rest = text.slice(start);
  const lines = rest.split('\n');
  const patterns = [];
  for (const line of lines) {
    if (/^\S/.test(line) && line.trim() !== '') break; // next top-level key
    const m = line.match(/^\s+-\s+"(.+)"$/);
    if (m) patterns.push(m[1]);
    const m2 = line.match(/^\s+-\s+'(.+)'$/);
    if (m2) patterns.push(m2[1]);
    const m3 = line.match(/^\s+-\s+([^"'#\s].*)$/);
    if (m3) patterns.push(m3[1].trim());
  }
  return patterns;
}

const common = parseSection(raw, 'common');
const gitOnly = parseSection(raw, 'git_only');
const syncthingOnly = parseSection(raw, 'syncthing_only');

const header = (target) =>
  `# Auto-generated from generated/sync/policy.yaml — do not edit directly\n` +
  `# Regenerate: node scripts/generate-sync-policy.mjs\n` +
  `# Target: ${target}\n`;

const gitignore = [
  header('.gitignore'),
  '# Common patterns (shared with .stignore)',
  ...common,
  '',
  '# Git-only patterns',
  ...gitOnly,
  '',
].join('\n');

const stignore = [
  '// Auto-generated from generated/sync/policy.yaml — do not edit directly',
  '// Regenerate: node scripts/generate-sync-policy.mjs',
  '// Target: .stignore',
  '',
  '// Common patterns (shared with .gitignore)',
  ...common,
  '',
  '// Syncthing-only patterns',
  ...syncthingOnly,
  '',
].join('\n');

writeFileSync(join(root, '.gitignore'), gitignore, 'utf8');
writeFileSync(join(root, '.stignore'), stignore, 'utf8');

console.log(`Generated .gitignore (${common.length + gitOnly.length} patterns)`);
console.log(`Generated .stignore (${common.length + syncthingOnly.length} patterns)`);
