#!/usr/bin/env node
// tri-tool-parity-check.js — SessionStart hook
// Detects hook registration drift between Claude, Gemini, Codex.
// Uses generate-settings.mjs --check --tool all as canonical source.
// 24h cooldown on actual parity scan.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const { toolHomeDir } = require('./lib/tool-detect.js');
const home = os.homedir();
const cooldownFile = path.join(toolHomeDir(), 'cache', 'tri-tool-parity-last.json');
const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const GENERATOR = path.join(home, '.ai-context', 'scripts', 'generate-settings.mjs');

function passthrough() { process.stdout.write('{"continue":true}'); process.exit(0); }

try {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }
  const input = JSON.parse(raw);

  // --full flag: bypass cooldown (passed via env since stdin is hook input)
  const fullMode = process.env.PARITY_FULL === '1';

  // Session idempotency (skip if same session already ran, unless --full)
  if (!fullMode && input.session_id) {
    const markerDir = path.join(os.tmpdir(), 'claude-session-ctx');
    const marker = path.join(markerDir, `parity-${String(input.session_id).replace(/[^a-zA-Z0-9_-]/g, '_')}.flag`);
    try { fs.mkdirSync(markerDir, { recursive: true }); } catch {}
    if (fs.existsSync(marker)) passthrough();
    try { fs.writeFileSync(marker, String(Date.now())); } catch {}
  }

  // 24h cooldown check (skip if --full)
  if (!fullMode) {
    try {
      if (fs.existsSync(cooldownFile)) {
        const cache = JSON.parse(fs.readFileSync(cooldownFile, 'utf8'));
        if (Date.now() - (cache.last_run || 0) < COOLDOWN_MS) {
          if (cache.warnings?.length) {
            process.stdout.write(JSON.stringify({
              continue: true,
              systemMessage: `[tri-tool-parity] ${cache.warnings.join(' | ')}`
            }));
            process.exit(0);
          }
          passthrough();
        }
      }
    } catch {}
  }

  // Spawn generator in --check mode
  let generatorOut = '';
  let generatorFailed = false;
  try {
    generatorOut = execSync(
      `node ${JSON.stringify(GENERATOR)} --check --tool all`,
      { encoding: 'utf8', timeout: 4500 }
    );
  } catch (err) {
    generatorFailed = true;
    generatorOut = err.stdout || '';
    // stderr/timeout: treat as unavailable
  }

  if (generatorFailed && !generatorOut.trim()) {
    const msg = 'parity check unavailable (generate-settings.mjs failed or timed out)';
    // Cache the soft failure so we don't spam every session
    try {
      const dir = path.dirname(cooldownFile);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(cooldownFile, JSON.stringify({
        last_run: Date.now(),
        warnings: [],
        generator_error: true,
      }));
    } catch {}
    process.stdout.write(JSON.stringify({
      continue: true,
      systemMessage: `[tri-tool-parity] ${msg}`
    }));
    process.exit(0);
  }

  // Parse generator output for MISSING / EXTRA / TIMEOUT lines
  const lines = generatorOut.split('\n');
  const missingCritical = [];
  const missingOther = [];
  const extras = [];
  const timeouts = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('MISSING')) {
      if (trimmed.includes('[CRITICAL]')) {
        missingCritical.push(trimmed);
      } else {
        missingOther.push(trimmed);
      }
    } else if (trimmed.startsWith('EXTRA')) {
      extras.push(trimmed);
    } else if (trimmed.startsWith('TIMEOUT')) {
      timeouts.push(trimmed);
    }
  }

  const warnings = [];
  const hasCritical = missingCritical.length > 0;

  if (missingCritical.length > 0) {
    warnings.push(`CRITICAL: ${missingCritical.length} missing critical hook(s): ${missingCritical.slice(0, 3).join('; ')}${missingCritical.length > 3 ? '...' : ''}`);
  }
  if (missingOther.length > 0) {
    warnings.push(`${missingOther.length} missing hook(s): ${missingOther.slice(0, 2).join('; ')}${missingOther.length > 2 ? '...' : ''}`);
  }
  if (extras.length > 0) {
    warnings.push(`${extras.length} extra/unregistered hook(s) (informational)`);
  }
  if (timeouts.length > 0) {
    warnings.push(`${timeouts.length} tool check(s) timed out`);
  }

  // Cache results
  try {
    const dir = path.dirname(cooldownFile);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(cooldownFile, JSON.stringify({
      last_run: Date.now(),
      warnings,
      has_critical: hasCritical,
      missing_critical: missingCritical.length,
      missing_other: missingOther.length,
      extras: extras.length,
      timeouts: timeouts.length,
    }));
  } catch {}

  if (warnings.length > 0) {
    process.stdout.write(JSON.stringify({
      continue: true,
      systemMessage: `[tri-tool-parity] ${warnings.join(' | ')}`
    }));
  } else {
    passthrough();
  }
} catch (e) {
  try { process.stderr.write('tri-tool-parity-check: ' + e.message + '\n'); } catch {}
  passthrough();
}
