#!/usr/bin/env node
// tri-tool-parity-check.js — SessionStart hook
// Detects hook registration drift between Claude, Gemini, Codex.
// Warns when hooks exist in one tool but not others.
// Runs once per session (idempotency via session marker).
// 24h cooldown on actual parity scan (network-free, just config reads).

const fs = require('fs');
const path = require('path');
const os = require('os');

const home = os.homedir();
const cooldownFile = path.join(home, '.claude', 'cache', 'tri-tool-parity-last.json');
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

function passthrough() { process.stdout.write('{"continue":true}'); process.exit(0); }

try {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }
  const input = JSON.parse(raw);

  // Session idempotency
  if (input.session_id) {
    const markerDir = path.join(os.tmpdir(), 'claude-session-ctx');
    const marker = path.join(markerDir, `parity-${String(input.session_id).replace(/[^a-zA-Z0-9_-]/g, '_')}.flag`);
    try { fs.mkdirSync(markerDir, { recursive: true }); } catch {}
    if (fs.existsSync(marker)) passthrough();
    try { fs.writeFileSync(marker, String(Date.now())); } catch {}
  }

  // 24h cooldown
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

  // Extract hook script names from each tool
  function getClaudeHooks() {
    const s = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
    const scripts = new Set();
    for (const [event, entries] of Object.entries(s.hooks || {})) {
      for (const entry of entries) {
        for (const h of (entry.hooks || [])) {
          const m = h.command?.match(/([^/"]+\.js)/);
          if (m) scripts.add(m[1]);
        }
      }
    }
    return scripts;
  }

  function getGeminiHooks() {
    const p = path.join(home, '.gemini', 'settings.json');
    if (!fs.existsSync(p)) return new Set();
    const s = JSON.parse(fs.readFileSync(p, 'utf8'));
    const scripts = new Set();
    for (const [event, entries] of Object.entries(s.hooks || {})) {
      for (const entry of entries) {
        for (const h of (entry.hooks || [])) {
          const m = h.command?.match(/([^/"]+\.js)/);
          if (m) scripts.add(m[1]);
        }
      }
    }
    return scripts;
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

  // Check Claude↔Gemini parity (should be close)
  const claudeOnly = [...claude].filter(h => !gemini.has(h) && !h.includes('block-subagent'));
  const geminiOnly = [...gemini].filter(h => !claude.has(h) && !h.includes('sync-claude'));
  if (claudeOnly.length > 3) warnings.push(`${claudeOnly.length} hooks in Claude but not Gemini`);
  if (geminiOnly.length > 3) warnings.push(`${geminiOnly.length} hooks in Gemini but not Claude`);

  // Check Codex has all portable hooks
  const codexMissing = [...CODEX_PORTABLE].filter(h => !codex.has(h));
  if (codexMissing.length > 0) warnings.push(`Codex missing ${codexMissing.length} portable hooks: ${codexMissing.slice(0, 3).join(', ')}${codexMissing.length > 3 ? '...' : ''}`);

  // Check remotes
  for (const [name, dir] of [['claude', '.claude'], ['gemini', '.gemini'], ['codex', '.codex']]) {
    const gitDir = path.join(home, dir, '.git');
    if (fs.existsSync(gitDir)) {
      try {
        const { execSync } = require('child_process');
        const remote = execSync('git remote get-url origin', { cwd: path.join(home, dir), encoding: 'utf8', timeout: 2000 }).trim();
        if (!remote) warnings.push(`${name}-global: no remote`);
      } catch {
        warnings.push(`${name}-global: no remote configured`);
      }
    }
  }

  // Cache results
  try {
    const dir = path.dirname(cooldownFile);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(cooldownFile, JSON.stringify({
      last_run: Date.now(),
      warnings,
      claude_count: claude.size,
      gemini_count: gemini.size,
      codex_count: codex.size,
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
