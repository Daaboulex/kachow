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

  function getJsonHooks(settingsPath) {
    if (!fs.existsSync(settingsPath)) return new Set();
    try {
      const realPath = fs.realpathSync(settingsPath);
      const settings = JSON.parse(fs.readFileSync(realPath, 'utf8'));
      const scripts = new Set();
      for (const groups of Object.values(settings.hooks || {})) {
        if (!Array.isArray(groups)) continue;
        for (const group of groups) {
          for (const h of (group.hooks || [])) {
            const m = (h.command || '').match(/([a-z][-a-z0-9]+\.js)/);
            if (m) scripts.add(m[1]);
          }
        }
      }
      return scripts;
    } catch { return new Set(); }
  }

  function getClaudeHooks() {
    return getJsonHooks(path.join(home, '.claude', 'settings.json'));
  }

  function getGeminiHooks() {
    return getJsonHooks(path.join(home, '.gemini', 'settings.json'));
  }

  function getCodexHooks() {
    const p = path.join(home, '.codex', 'config.toml');
    if (!fs.existsSync(p)) return new Set();
    const content = fs.readFileSync(p, 'utf8');
    const scripts = new Set();
    for (const line of content.split('\n')) {
      if (!line.includes('command') || !line.includes('.js')) continue;
      const m = line.match(/([a-z][-a-z0-9]+\.js)/);
      if (m) scripts.add(m[1]);
    }
    return scripts;
  }

  const claude = getClaudeHooks();
  const gemini = getGeminiHooks();
  const codex = getCodexHooks();

  // Hooks bound to events that don't exist in Gemini — exclude from parity count.
  // These are structurally non-portable, not missing registrations.
  const GEMINI_STRUCTURAL_EXCLUSIONS = new Set([
    'caveman-post-compact-reinject.js',
    'cwd-changed-watcher.js',
    'file-changed-notify.js',
    'memory-post-compact.js',
    'per-prompt-overhead.js',
    'prompt-clarity-check.js',
    'prompt-hash-logger.js',
    'prompt-item-tracker.js',
    'slash-command-logger.js',
  ]);

  // Hooks that SHOULD be in all tools (core shared hooks)
  // Codex has fewer events, so only check hooks for events Codex supports
  const CODEX_PORTABLE = new Set([
    'session-context-loader.js', 'session-presence-start.js', 'auto-pull-global.js',
    'session-start-combined.js', 'injection-size-monitor.js',
    'autosave-before-destructive.js', 'peer-conflict-check.js',
    'pre-write-combined-guard.js', 'scrub-sentinel.js',
    'session-presence-track.js', 'bandaid-loop-detector.js',
    'context-pressure-enforce.js', 'skill-drift-guard.js', 'rule-enforcement-check.js',
    'caveman-post-compact-reinject.js', 'per-prompt-overhead.js',
    'prompt-hash-logger.js', 'prompt-item-tracker.js', 'prompt-clarity-check.js',
    'session-presence-end.js', 'auto-push-global.js', 'todowrite-persist.js',
    'ai-snapshot-stop.js', 'meta-system-stop.js', 'skill-auto-updater.js',
  ]);

  const warnings = [];
  const hasCritical = missingCritical.length > 0;

  // Check Claude↔Gemini parity (should be close)
  const claudeOnly = [...claude].filter(h => !gemini.has(h) && !h.includes('block-subagent') && !GEMINI_STRUCTURAL_EXCLUSIONS.has(h));
  const geminiOnly = [...gemini].filter(h => !claude.has(h) && !h.includes('sync-claude'));
  if (claudeOnly.length > 3) warnings.push(`${claudeOnly.length} hooks in Claude but not Gemini`);
  if (geminiOnly.length > 3) warnings.push(`${geminiOnly.length} hooks in Gemini but not Claude`);

  // Check Codex has all portable hooks
  const codexMissing = [...CODEX_PORTABLE].filter(h => !codex.has(h));
  if (codexMissing.length > 0) warnings.push(`Codex missing ${codexMissing.length} portable hooks: ${codexMissing.slice(0, 3).join(', ')}${codexMissing.length > 3 ? '...' : ''}`);

  // Check ai-context git remote (tool dirs no longer have .git — consolidated v0.8.0)
  try {
    const aiDir = path.join(home, '.ai-context');
    if (fs.existsSync(path.join(aiDir, '.git'))) {
      const remote = execSync('git remote get-url origin', { cwd: aiDir, encoding: 'utf8', timeout: 2000 }).trim();
      if (!remote) warnings.push('ai-context: no remote');
    }
  } catch {}

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
