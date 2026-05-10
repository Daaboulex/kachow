#!/usr/bin/env node
// generate-settings.mjs
// Reads MANIFEST.yaml → produces hook config for Claude, Gemini, Codex.
// Flags: --tool <codex|gemini|claude|all>  --preview (default)  --check  --apply [--all]

import { createRequire } from 'module';
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { backup, restore, listBackups, formatTimestamp } from './lib/config-backup.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const {
  toolMap, codexToolMap, eventMap, codexEventMap,
  TOOL_EVENTS, TOOL_SUPPORTS_ASYNC, PASSTHROUGH_MATCHERS,
} = require('../hooks/lib/platform-map.js');

// ── Config paths ──────────────────────────────────────────────────────────────
const HOME = process.env.HOME || '$HOME';
const PATHS = {
  manifest: resolve(__dirname, 'MANIFEST.yaml'),
  claude:   resolve(HOME, '.claude/settings.json'),
  gemini:   resolve(HOME, '.gemini/settings.json'),
  codex:    resolve(HOME, '.codex/config.toml'),
  crush:    resolve(HOME, '.config/crush/crush.json'),
  hookBase: {
    claude: resolve(HOME, '.claude/hooks'),
    gemini: resolve(HOME, '.gemini/hooks'),
    codex:  resolve(HOME, '.codex/hooks'),
    crush:  resolve(HOME, '.crush/hooks'),
  },
};

// ── Argument parsing ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const MODE   = args.includes('--check')   ? 'check'
             : args.includes('--restore') ? 'restore'
             : args.includes('--apply')   ? 'apply'
             : 'preview';
const ALL    = args.includes('--all');
const toolArg = (() => {
  const i = args.indexOf('--tool');
  return i !== -1 ? args[i + 1] : null;
})();
const restoreTimestamp = (() => {
  const i = args.indexOf('--restore');
  return i !== -1 ? args[i + 1] : null;
})();

// --apply defaults to codex only; --apply --all does all four
const DEFAULT_APPLY_TOOLS = ['codex'];
let targetTools;
if (toolArg === 'all' || ALL) {
  targetTools = ['claude', 'gemini', 'codex', 'crush'];
} else if (toolArg) {
  targetTools = [toolArg];
} else if (MODE === 'apply') {
  targetTools = DEFAULT_APPLY_TOOLS;
} else {
  targetTools = ['claude', 'gemini', 'codex', 'crush'];
}

// ── YAML parser ───────────────────────────────────────────────────────────────
// Simple line-by-line parser sufficient for MANIFEST.yaml structure.
// Handles: list-of-maps, nested maps, inline arrays [...], quoted strings.

function parseManifestYaml(text) {
  const lines = text.split('\n');
  const hooks = [];
  let current = null;        // current hook entry
  let currentEvent = null;   // current event block
  let inOverrides = false;
  let overrideTool = null;   // 'claude'|'gemini'|'codex'
  let depth = 0;             // rough indent tracking

  function indentOf(line) {
    return line.match(/^(\s*)/)[1].length;
  }

  function parseInlineArray(val) {
    // "[claude, codex, gemini]" → ['claude','codex','gemini']
    const m = val.match(/^\[(.+)\]$/);
    if (!m) return null;
    return m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
  }

  function stripComment(line) {
    // strip inline # comments (naively — OK for this manifest)
    const idx = line.indexOf(' #');
    return idx !== -1 ? line.slice(0, idx) : line;
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = stripComment(raw).trimEnd();
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const ind = indentOf(line);
    const trimmed = line.trim();

    // Top-level list item: "  - file: ..."
    if (ind === 2 && trimmed.startsWith('- file:')) {
      current = {
        file: trimmed.replace(/^- file:\s*/, '').trim(),
        category: null,
        critical: false,
        tools: [],
        order: 999,
        async: false,
        events: [],
        overrides: {},
      };
      hooks.push(current);
      inOverrides = false;
      overrideTool = null;
      currentEvent = null;
      depth = 2;
      continue;
    }

    if (!current) continue;

    // Fields at indent 4 (hook-level)
    if (ind === 4) {
      inOverrides = false;
      overrideTool = null;
      currentEvent = null;

      if (trimmed.startsWith('category:')) {
        current.category = trimmed.replace('category:', '').trim();
      } else if (trimmed.startsWith('critical:')) {
        current.critical = trimmed.replace('critical:', '').trim() === 'true';
      } else if (trimmed.startsWith('tools:')) {
        const val = trimmed.replace('tools:', '').trim();
        const arr = parseInlineArray(val);
        if (arr) current.tools = arr;
      } else if (trimmed.startsWith('order:')) {
        current.order = parseInt(trimmed.replace('order:', '').trim(), 10) || 999;
      } else if (trimmed.startsWith('async:')) {
        current.async = trimmed.replace('async:', '').trim() === 'true';
      } else if (trimmed === 'events:') {
        // nothing; events come as sub-items
      } else if (trimmed === 'overrides:') {
        inOverrides = true;
      }
      continue;
    }

    // Event list items: indent 6, starts with "- event:"
    if (ind === 6 && trimmed.startsWith('- event:')) {
      currentEvent = {
        event: trimmed.replace(/^- event:\s*/, '').trim(),
        matcher: null,
        timeout: 5,
      };
      current.events.push(currentEvent);
      inOverrides = false;
      continue;
    }

    // Event sub-fields: indent 8
    if (ind === 8 && currentEvent) {
      if (trimmed.startsWith('matcher:')) {
        const val = trimmed.replace('matcher:', '').trim();
        const arr = parseInlineArray(val);
        currentEvent.matcher = arr || [val.replace(/^['"]|['"]$/g, '')];
      } else if (trimmed.startsWith('timeout:')) {
        currentEvent.timeout = parseInt(trimmed.replace('timeout:', '').trim(), 10) || 5;
      }
      continue;
    }

    // Overrides tool keys: indent 6
    if (inOverrides && ind === 6) {
      const m = trimmed.match(/^(\w+):$/);
      if (m) {
        overrideTool = m[1];
        if (!current.overrides[overrideTool]) current.overrides[overrideTool] = {};
      }
      continue;
    }

    // Override sub-fields: indent 8
    if (inOverrides && overrideTool && ind === 8) {
      const col = trimmed.indexOf(':');
      if (col !== -1) {
        const key = trimmed.slice(0, col).trim();
        const val = trimmed.slice(col + 1).trim().replace(/^['"]|['"]$/g, '');
        current.overrides[overrideTool][key] = val;
      }
      continue;
    }
  }

  return hooks;
}

// ── Translation helpers ───────────────────────────────────────────────────────

const PASSTHROUGH_SET = new Set(PASSTHROUGH_MATCHERS);

function isPassthrough(toolName) {
  for (const p of PASSTHROUGH_MATCHERS) {
    if (new RegExp('^' + p + '$').test(toolName)) return true;
  }
  return false;
}

function translateMatcherForGemini(canonicalTools) {
  if (!canonicalTools || canonicalTools.length === 0) return null;
  const translated = [];
  for (const t of canonicalTools) {
    if (isPassthrough(t)) continue; // skip — no Gemini equivalent
    const mapped = toolMap[t];
    if (mapped) translated.push(mapped);
    else translated.push(t); // pass through unknown
  }
  return translated.length > 0 ? translated.join('|') : null;
}

function translateMatcherForCodex(canonicalTools, matcherRaw) {
  if (matcherRaw) return matcherRaw;
  if (!canonicalTools || canonicalTools.length === 0) return null;
  const mapped = new Set();
  for (const t of canonicalTools) {
    if (isPassthrough(t)) continue; // no Codex equivalent
    const m = codexToolMap[t];
    if (m !== null && m !== undefined) mapped.add(m);
    // null = no Codex equivalent, skip
  }
  if (mapped.size === 0) return null;
  if (mapped.size === 1) {
    const only = [...mapped][0];
    return `^${only}$`;
  }
  return `^(${[...mapped].join('|')})$`;
}

function translateEventForGemini(canonicalEvent) {
  return eventMap[canonicalEvent] || canonicalEvent;
}

function translateEventForCodex(canonicalEvent) {
  return codexEventMap[canonicalEvent] || null; // null = not supported
}

function geminiEventSupported(geminiEvent) {
  return TOOL_EVENTS.gemini.includes(geminiEvent);
}

function codexEventSupported(codexEvent) {
  return codexEvent !== null && TOOL_EVENTS.codex.includes(codexEvent);
}

// ── Generator: Claude JSON ────────────────────────────────────────────────────
// Returns an object: { PreToolUse: [{matcher, hooks:[...]}], ... }

function generateClaudeHooks(allHooks) {
  const out = {};

  for (const hook of allHooks) {
    if (!hook.tools.includes('claude')) continue;

    for (const ev of hook.events) {
      const event = ev.event;
      if (!out[event]) out[event] = [];

      const matcher = ev.matcher
        ? ev.matcher.join('|')
        : '';

      // Apply claude.if override as "if" field (replaces matcher-level)
      const claudeIf = hook.overrides?.claude?.if;

      const hookEntry = {
        type: 'command',
        command: `node "${PATHS.hookBase.claude}/${hook.file}"`,
        timeout: ev.timeout,
      };
      const asyncClaude = hook.overrides?.claude?.async !== undefined ? hook.overrides.claude.async === 'true' : hook.async;
      if (asyncClaude) hookEntry.async = true;
      if (claudeIf) hookEntry.if = claudeIf;

      // Group by matcher within this event
      const matcherKey = claudeIf ? `__if__${claudeIf}` : matcher;
      const existing = out[event].find(g => {
        const gKey = g._matcherKey !== undefined ? g._matcherKey : (g.matcher || '');
        return gKey === matcherKey;
      });

      if (existing) {
        existing.hooks.push(hookEntry);
      } else {
        const group = { hooks: [hookEntry], _matcherKey: matcherKey };
        if (matcher && !claudeIf) group.matcher = matcher;
        out[event].push(group);
      }
    }
  }

  // Clean up internal _matcherKey before serialisation
  for (const evGroups of Object.values(out)) {
    for (const g of evGroups) delete g._matcherKey;
  }

  return out;
}

// ── Generator: Gemini JSON ────────────────────────────────────────────────────

function generateGeminiHooks(allHooks) {
  const out = {};

  for (const hook of allHooks) {
    if (!hook.tools.includes('gemini')) continue;

    for (const ev of hook.events) {
      const geminiEvent = translateEventForGemini(ev.event);
      if (!geminiEventSupported(geminiEvent)) continue;

      if (!out[geminiEvent]) out[geminiEvent] = [];

      const geminiMatcher = ev.matcher
        ? translateMatcherForGemini(ev.matcher)
        : null;

      // If all matchers were passthrough-only, geminiMatcher is null:
      // that means this event fires on no Gemini tools → skip
      if (ev.matcher && ev.matcher.length > 0 && geminiMatcher === null) continue;

      const hookEntry = {
        type: 'command',
        command: `node "${PATHS.hookBase.gemini}/${hook.file}"`,
        timeout: ev.timeout * 1000,
      };
      // Gemini does NOT support async field — skip entirely (silently ignored by Gemini CLI)
      const gName = hook.overrides?.gemini?.name;
      if (gName) hookEntry.name = gName;

      const matcherKey = geminiMatcher || '';
      const existing = out[geminiEvent].find(g => (g.matcher || '') === matcherKey);

      if (existing) {
        existing.hooks.push(hookEntry);
      } else {
        const group = { hooks: [hookEntry] };
        if (geminiMatcher) group.matcher = geminiMatcher;
        out[geminiEvent].push(group);
      }
    }
  }

  return out;
}

// ── Generator: Codex TOML ────────────────────────────────────────────────────

function generateCodexToml(allHooks) {
  const sections = [];

  for (const hook of allHooks) {
    if (!hook.tools.includes('codex')) continue;

    for (const ev of hook.events) {
      const codexEvent = translateEventForCodex(ev.event);
      if (!codexEventSupported(codexEvent)) continue;

      const matcherRaw = hook.overrides?.codex?.matcher_raw;
      const codexMatcher = translateMatcherForCodex(ev.matcher, matcherRaw);

      // If canonical matchers exist but all mapped to null, skip
      if (ev.matcher && ev.matcher.length > 0 && !matcherRaw && codexMatcher === null) continue;

      const cmd = `node "${PATHS.hookBase.codex}/${hook.file}"`;
      const timeout = ev.timeout;
      // Codex parses async but SKIPS it with warning ("async hooks not supported yet") — don't emit
      sections.push({ event: codexEvent, matcher: codexMatcher, command: cmd, timeout, async: false, order: hook.order });
    }
  }

  // Sort by order
  sections.sort((a, b) => a.order - b.order);

  let toml = '';
  for (const s of sections) {
    toml += `\n[[hooks.${s.event}]]\n`;
    if (s.matcher) toml += `matcher = ${JSON.stringify(s.matcher)}\n`;
    toml += `command = ${JSON.stringify(s.command)}\n`;
    toml += `timeout = ${s.timeout}\n`;
    if (s.async) toml += `async = true\n`;
  }

  return toml.trimStart();
}

// ── Critical-hook guard ───────────────────────────────────────────────────────

function checkCriticalHooks(allHooks, tool, generated) {
  const criticals = allHooks.filter(h => h.critical && h.tools.includes(tool));
  const missing = [];

  for (const c of criticals) {
    let found = false;
    if (tool === 'codex') {
      found = generated.includes(c.file);
    } else {
      // JSON: scan all event groups
      for (const groups of Object.values(generated)) {
        for (const g of groups) {
          for (const h of (g.hooks || [])) {
            if (h.command && h.command.includes(c.file)) { found = true; break; }
          }
          if (found) break;
        }
        if (found) break;
      }
    }
    if (!found) missing.push(c.file);
  }

  return missing;
}

// ── --check mode ─────────────────────────────────────────────────────────────

function extractHooksFromClaudeJson(settings) {
  const reg = {};
  const hooks = settings.hooks || {};
  for (const [event, groups] of Object.entries(hooks)) {
    for (const g of groups) {
      for (const h of (g.hooks || [])) {
        const m = (h.command || '').match(/hooks\/([a-zA-Z0-9_-]+\.js)/);
        if (m) {
          const key = `${event}:${m[1]}`;
          reg[key] = { timeout: h.timeout, matcher: g.matcher };
        }
      }
    }
  }
  return reg;
}

function extractHooksFromGeminiJson(settings) {
  return extractHooksFromClaudeJson(settings); // same shape
}

function extractHooksFromCodexToml(toml) {
  const reg = {};
  let currentEvent = null;
  for (const line of toml.split('\n')) {
    // Match both [[hooks.EventName]] and [[hooks.EventName.hooks]]
    const em = line.match(/^\[\[hooks\.(\w+?)(?:\.hooks)?\]\]/);
    if (em) { currentEvent = em[1]; continue; }
    if (currentEvent) {
      const cm = line.match(/command\s*=\s*.+hooks\/([a-zA-Z0-9_.-]+\.js)/);
      if (cm) {
        reg[`${currentEvent}:${cm[1]}`] = true;
        // Don't reset currentEvent — multiple hooks under same section
      }
    }
    // Reset on new non-hooks section
    if (line.match(/^\[(?!\[hooks)/) && !line.match(/^\[\[/)) {
      currentEvent = null;
    }
  }
  return reg;
}

function buildExpectedRegistrations(allHooks, tool) {
  const reg = {};
  for (const hook of allHooks) {
    if (!hook.tools.includes(tool)) continue;
    for (const ev of hook.events) {
      let event;
      if (tool === 'codex') {
        event = translateEventForCodex(ev.event);
        if (!codexEventSupported(event)) continue;
        const matcherRaw = hook.overrides?.codex?.matcher_raw;
        const m = translateMatcherForCodex(ev.matcher, matcherRaw);
        if (ev.matcher && ev.matcher.length > 0 && !matcherRaw && m === null) continue;
      } else if (tool === 'gemini') {
        event = translateEventForGemini(ev.event);
        if (!geminiEventSupported(event)) continue;
        const gm = ev.matcher ? translateMatcherForGemini(ev.matcher) : null;
        if (ev.matcher && ev.matcher.length > 0 && gm === null) continue;
      } else if (tool === 'crush') {
        event = ev.event;
        if (!TOOL_EVENTS.crush || !TOOL_EVENTS.crush.includes(event)) continue;
      } else {
        event = ev.event; // claude — all events valid
      }
      const key = `${event}:${hook.file}`;
      reg[key] = { timeout: ev.timeout * (tool === 'gemini' ? 1000 : 1), order: hook.order };
    }
  }
  return reg;
}

function runCheck(allHooks) {
  let hasError = false;
  const tools = targetTools;

  for (const tool of tools) {
    console.log(`\n── ${tool.toUpperCase()} ──`);
    const expected = buildExpectedRegistrations(allHooks, tool);

    let actual = {};
    try {
      if (tool === 'claude') {
        const s = JSON.parse(readFileSync(PATHS.claude, 'utf8'));
        actual = extractHooksFromClaudeJson(s);
      } else if (tool === 'gemini') {
        const s = JSON.parse(readFileSync(PATHS.gemini, 'utf8'));
        actual = extractHooksFromGeminiJson(s);
      } else if (tool === 'crush') {
        if (existsSync(PATHS.crush)) {
          const s = JSON.parse(readFileSync(PATHS.crush, 'utf8'));
          actual = extractHooksFromCrushJson(s);
        }
      } else {
        const t = readFileSync(PATHS.codex, 'utf8');
        actual = extractHooksFromCodexToml(t);
      }
    } catch (e) {
      console.log(`  WARN: could not read config: ${e.message}`);
    }

    const expKeys = new Set(Object.keys(expected));
    const actKeys = new Set(Object.keys(actual));

    for (const k of expKeys) {
      if (!actKeys.has(k)) {
        const [event, file] = k.split(':');
        const crit = allHooks.find(h => h.file === file)?.critical ? ' [CRITICAL]' : '';
        console.log(`  MISSING: ${file} in ${event}${crit}`);
        hasError = true;
      }
    }
    for (const k of actKeys) {
      if (!expKeys.has(k)) {
        const [event, file] = k.split(':');
        console.log(`  EXTRA: ${file} in ${event} (not in manifest)`);
        // EXTRA is informational, not a hard error
      }
    }

    // Timeout check (Claude/Gemini only — TOML check not implemented)
    if (tool !== 'codex') {
      for (const k of expKeys) {
        if (actKeys.has(k)) {
          const expT = expected[k].timeout;
          const actT = actual[k]?.timeout;
          if (actT !== undefined && actT !== expT) {
            const [event, file] = k.split(':');
            const div = tool === 'gemini' ? 1000 : 1;
            console.log(`  TIMEOUT: ${file} in ${event} expected ${expT / div}s got ${actT / div}s`);
            hasError = true;
          }
        }
      }
    }

    if (!hasError) console.log('  OK');
  }

  process.exit(hasError ? 1 : 0);
}

// ── Git-dirty guard ───────────────────────────────────────────────────────────

const GIT_TARGETS = {
  claude: { repo: resolve(HOME, '.claude'),  file: 'settings.json' },
  gemini: { repo: resolve(HOME, '.gemini'),  file: 'settings.json' },
  codex:  { repo: resolve(HOME, '.codex'),   file: 'config.toml'   },
};

function checkGitDirty(tool) {
  const t = GIT_TARGETS[tool];
  if (!t) return;
  try {
    const out = execSync(
      `git -C "${t.repo}" status --porcelain "${t.file}"`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    if (out.length > 0) {
      console.error(`ERROR: ${tool} ${t.file} has uncommitted git changes — commit or stash first`);
      console.error(`  git -C ${t.repo} diff ${t.file}`);
      process.exit(2);
    }
  } catch {
    // not a git repo or git not available — allow proceed
  }
}

// ── Preview / Apply ───────────────────────────────────────────────────────────

function writePreview(tool, content) {
  const ext = tool === 'codex' ? 'toml' : 'json';
  const outPath = `/tmp/generate-settings-${tool}.${ext}`;
  writeFileSync(outPath, content, 'utf8');
  console.log(`  preview → ${outPath}`);
  return outPath;
}

function applyClaudeHooks(allHooks, ts) {
  checkGitDirty('claude');
  const generated = generateClaudeHooks(allHooks);
  const missing = checkCriticalHooks(allHooks, 'claude', generated);
  if (missing.length) {
    console.error(`ERROR: critical hooks missing from Claude output: ${missing.join(', ')}`);
    process.exit(2);
  }

  const settings = JSON.parse(readFileSync(PATHS.claude, 'utf8'));
  settings.hooks = generated;
  writeFileSync(PATHS.claude, JSON.stringify(settings, null, 2), 'utf8');
  console.log(`Applied to claude. Backup at ~/.ai-context/backups/${ts}/`);
}

function applyGeminiHooks(allHooks, ts) {
  checkGitDirty('gemini');
  const generated = generateGeminiHooks(allHooks);
  const missing = checkCriticalHooks(allHooks, 'gemini', generated);
  if (missing.length) {
    console.error(`ERROR: critical hooks missing from Gemini output: ${missing.join(', ')}`);
    process.exit(2);
  }

  const settings = JSON.parse(readFileSync(PATHS.gemini, 'utf8'));
  settings.hooks = generated;
  writeFileSync(PATHS.gemini, JSON.stringify(settings, null, 2), 'utf8');
  console.log(`Applied to gemini. Backup at ~/.ai-context/backups/${ts}/`);
}

function applyCodexHooks(allHooks, ts) {
  checkGitDirty('codex');
  const tomlFragment = generateCodexToml(allHooks);
  const missing = checkCriticalHooks(allHooks, 'codex', tomlFragment);
  if (missing.length) {
    console.error(`ERROR: critical hooks missing from Codex output: ${missing.join(', ')}`);
    process.exit(2);
  }

  const existing = readFileSync(PATHS.codex, 'utf8');

  // Find first [[hooks. line → replace everything from there to EOF
  const hookIdx = existing.indexOf('\n[[hooks.');
  if (hookIdx === -1) {
    console.error('ERROR: no [[hooks. section found in config.toml');
    process.exit(2);
  }
  const header = existing.slice(0, hookIdx + 1); // keep up to and including the newline before [[hooks.

  // Preserve [features] codex_hooks = true — it must exist in header
  if (!header.includes('codex_hooks = true')) {
    console.error('ERROR: [features] codex_hooks = true not found before [[hooks. section — refusing to apply');
    process.exit(2);
  }

  const newContent = header + tomlFragment + '\n';
  writeFileSync(PATHS.codex, newContent, 'utf8');
  console.log(`Applied to codex. Backup at ~/.ai-context/backups/${ts}/`);
}

// ── Generator: Crush JSON ────────────────────────────────────────────────────
// Returns an object: { PreToolUse: [{matcher, command, timeout}, ...] }
// Crush uses Claude-compatible tool names but a flat array per event (no grouped hooks wrapper).

function generateCrushHooks(allHooks) {
  const out = {};
  for (const hook of allHooks) {
    if (!hook.tools.includes('crush')) continue;
    for (const ev of hook.events) {
      if (ev.event !== 'PreToolUse') continue; // Crush only supports PreToolUse
      if (!out[ev.event]) out[ev.event] = [];
      const matcher = ev.matcher ? ev.matcher.map(m => m.toLowerCase()).join('|') : '';
      const entry = {
        matcher,
        command: `node "${PATHS.hookBase.crush}/${hook.file}"`,
        timeout: ev.timeout,
      };
      out[ev.event].push(entry);
    }
  }
  return out;
}

function applyCrushHooks(allHooks, ts) {
  if (!existsSync(PATHS.crush)) {
    console.log('Skipped crush (config not found).');
    return;
  }
  const generated = generateCrushHooks(allHooks);
  const config = JSON.parse(readFileSync(PATHS.crush, 'utf8'));
  config.hooks = generated;
  writeFileSync(PATHS.crush, JSON.stringify(config, null, 2), 'utf8');
  console.log(`Applied to crush. Backup at ~/.ai-context/backups/${ts}/`);
}

function extractHooksFromCrushJson(config) {
  const reg = {};
  for (const [event, hooks] of Object.entries(config.hooks || {})) {
    for (const h of hooks) {
      const m = (h.command || '').match(/([a-z][-a-z0-9]+\.js)/);
      if (m) {
        const key = `${event}:${m[1]}`;
        reg[key] = { timeout: h.timeout };
      }
    }
  }
  return reg;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const manifestText = readFileSync(PATHS.manifest, 'utf8');
const allHooks = parseManifestYaml(manifestText);

// Sort by order globally
allHooks.sort((a, b) => a.order - b.order);

if (MODE === 'check') {
  runCheck(allHooks);
  process.exit(0);
}

if (MODE === 'restore') {
  if (!restoreTimestamp) {
    const available = listBackups();
    if (available.length === 0) {
      console.error('ERROR: no backups found at ~/.ai-context/backups/');
    } else {
      console.error('ERROR: --restore requires a timestamp argument');
      console.error('Available backups:');
      for (const ts of available) console.error(`  ${ts}`);
    }
    process.exit(2);
  }
  restore(restoreTimestamp);
  process.exit(0);
}

if (MODE === 'apply') {
  const ts = formatTimestamp();
  // ADV-001 fix: backup ALL configs ONCE before any writes (prevent re-copy of modified files)
  backup(ts);
  console.log(`apply mode — tools: ${targetTools.join(', ')}`);
  const validTools = new Set(['claude', 'gemini', 'codex', 'crush']);
  for (const tool of targetTools) {
    if (!validTools.has(tool)) {
      console.error(`ERROR: unknown tool '${tool}'. Valid: claude, gemini, codex, crush`);
      process.exit(1);
    }
    if (tool === 'claude') applyClaudeHooks(allHooks, ts);
    else if (tool === 'gemini') applyGeminiHooks(allHooks, ts);
    else if (tool === 'codex') applyCodexHooks(allHooks, ts);
    else if (tool === 'crush') applyCrushHooks(allHooks, ts);
  }
  process.exit(0);
}

// Preview mode (default)
console.log(`preview mode — tools: ${targetTools.join(', ')}`);
for (const tool of targetTools) {
  if (tool === 'claude') {
    const generated = generateClaudeHooks(allHooks);
    const missing = checkCriticalHooks(allHooks, 'claude', generated);
    if (missing.length) console.warn(`  WARN critical missing claude: ${missing.join(', ')}`);
    writePreview('claude', JSON.stringify({ hooks: generated }, null, 2));
  } else if (tool === 'gemini') {
    const generated = generateGeminiHooks(allHooks);
    const missing = checkCriticalHooks(allHooks, 'gemini', generated);
    if (missing.length) console.warn(`  WARN critical missing gemini: ${missing.join(', ')}`);
    writePreview('gemini', JSON.stringify({ hooks: generated }, null, 2));
  } else if (tool === 'codex') {
    const generated = generateCodexToml(allHooks);
    const missing = checkCriticalHooks(allHooks, 'codex', generated);
    if (missing.length) console.warn(`  WARN critical missing codex: ${missing.join(', ')}`);
    writePreview('codex', generated);
  } else if (tool === 'crush') {
    const generated = generateCrushHooks(allHooks);
    writePreview('crush', JSON.stringify({ hooks: generated }, null, 2));
  }
}
