#!/usr/bin/env node
// changelog-parse.mjs
// Parses ~/.claude/cache/changelog.md, extracts versions in target range,
// prints markdown table rows for D1 inventory.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const TARGET_VERSIONS = [
  '2.1.113', '2.1.114', '2.1.116',
  '2.1.117', '2.1.118', '2.1.119', '2.1.120', '2.1.121',
  // 2.1.115 skipped upstream — confirmed via gh tags API 2026-04-28.
];

const CHANGELOG_PATH = join(homedir(), '.claude', 'cache', 'changelog.md');
const text = readFileSync(CHANGELOG_PATH, 'utf8');

const sections = {};
let currentVersion = null;
let buffer = [];

for (const line of text.split('\n')) {
  const versionMatch = line.match(/^## (\d+\.\d+\.\d+)\s*$/);
  if (versionMatch) {
    if (currentVersion) sections[currentVersion] = buffer;
    currentVersion = versionMatch[1];
    buffer = [];
    continue;
  }
  if (currentVersion) buffer.push(line);
}
if (currentVersion) sections[currentVersion] = buffer;

console.log('| id | version | summary | adoptable? | rationale | applies-to | risk class | depends-on |');
console.log('|----|---------|---------|-----------|-----------|-----------|------------|-----------|');

for (const version of TARGET_VERSIONS) {
  const lines = sections[version];
  if (!lines) {
    console.error(`MISSING: ${version}`);
    continue;
  }
  const bullets = lines
    .map(l => l.trim())
    .filter(l => l.startsWith('- '))
    .map(l => l.slice(2));

  bullets.forEach((bullet, idx) => {
    const id = `CL-${version.replaceAll('.', '')}-${String(idx + 1).padStart(2, '0')}`;
    const summary = bullet.replace(/\|/g, '\\|').slice(0, 200);
    console.log(`| ${id} | ${version} | ${summary} | TBD-classify | TBD | TBD | TBD | none |`);
  });
}
