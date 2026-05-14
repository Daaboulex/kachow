#!/usr/bin/env node
// check-cli-versions.mjs — detect CLI version changes and warn about compatibility
// Run: node scripts/check-cli-versions.mjs [--update]
// Called by session-context-loader at session start (lightweight, <100ms)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const HOME = homedir();
const VERSION_FILE = join(ROOT, 'runtime', 'known-cli-versions.json');
const shouldUpdate = process.argv.includes('--update');

function getVersion(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 3000, stdio: ['pipe', 'pipe', 'ignore'] }).trim().match(/(\d+\.\d+\.\d+)/)?.[1] || null;
  } catch { return null; }
}

const current = {
  claude: getVersion('claude --version'),
  gemini: getVersion('gemini --version'),
  codex: getVersion('codex --version'),
  pi: getVersion('pi --version'),
};

// Load known versions
let known = {};
try { known = JSON.parse(readFileSync(VERSION_FILE, 'utf8')); } catch {}

const changes = [];
const warnings = [];

for (const [tool, version] of Object.entries(current)) {
  if (!version) continue;
  const prev = known[tool];
  if (prev && prev !== version) {
    changes.push({ tool, from: prev, to: version });

    // Version-specific compatibility warnings
    const [, minor] = version.split('.').map(Number);
    const [, prevMinor] = prev.split('.').map(Number);

    if (tool === 'claude' && minor !== prevMinor) {
      warnings.push(`Claude ${prev}→${version}: check hooks API (args[], continueOnBlock, terminalSequence)`);
      warnings.push(`  Run: node scripts/test-hooks.mjs && node scripts/lint-docs.mjs`);
    }
    if (tool === 'gemini') {
      warnings.push(`Gemini ${prev}→${version}: check hook events, settings schema, skill system`);
      warnings.push(`  Run: node scripts/generate-settings.mjs --check`);
    }
    if (tool === 'codex') {
      warnings.push(`Codex ${prev}→${version}: check TOML config schema, feature flags`);
      warnings.push(`  Run: node scripts/generate-settings.mjs --check`);
    }
    if (tool === 'pi') {
      warnings.push(`Pi ${prev}→${version}: check extension API events, settings schema`);
    }
  }
}

if (shouldUpdate || Object.keys(known).length === 0) {
  mkdirSync(dirname(VERSION_FILE), { recursive: true });
  writeFileSync(VERSION_FILE, JSON.stringify(current, null, 2));
  console.log('Updated known versions:', JSON.stringify(current));
}

if (changes.length > 0) {
  console.log('CLI VERSION CHANGES DETECTED:');
  for (const c of changes) {
    console.log(`  ${c.tool}: ${c.from} → ${c.to}`);
  }
  if (warnings.length > 0) {
    console.log('\nCompatibility checks recommended:');
    for (const w of warnings) {
      console.log(`  ${w}`);
    }
  }
  console.log('\nRun with --update to acknowledge these versions.');
} else if (!shouldUpdate) {
  console.log('All CLI versions match known state:', JSON.stringify(current));
}
