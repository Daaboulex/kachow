#!/usr/bin/env node
// Auto-generates MANIFEST.yaml by reverse-engineering current 3-tool hook configs.
// Usage: node bootstrap-manifest.mjs [--output path/to/MANIFEST.yaml]

import { createRequire } from 'module';
import { readFileSync, writeFileSync } from 'fs';
import { basename, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const {
  reverseToolMap,
  reverseCodexToolMap,
  reverseEventMap,
  reverseCodexEventMap,
  PASSTHROUGH_MATCHERS,
} = require(resolve(__dirname, '../hooks/lib/platform-map.js'));

// ── Config paths ─────────────────────────────────────────────────────────────
const HOME = homedir();
const CLAUDE_SETTINGS = resolve(HOME, '.claude/settings.json');
const GEMINI_SETTINGS = resolve(HOME, '.gemini/settings.json');
const CODEX_CONFIG    = resolve(HOME, '.codex/config.toml');

// ── Critical hooks ────────────────────────────────────────────────────────────
const CRITICAL_HOOKS = new Set([
  'block-subagent-writes.js',
  'block-subagent-non-bash-writes.js',
  'autosave-before-destructive.js',
  'scrub-sentinel.js',
  'pre-write-combined-guard.js',
]);

// ── Category patterns ─────────────────────────────────────────────────────────
function categorize(filename) {
  if (/-presence-/.test(filename)) return 'lifecycle';
  if (/^(block-|autosave-|scrub-|pre-write-)/.test(filename)) return 'safety';
  if (/(-logger|-tracker|-correlator)/.test(filename)) return 'observability';
  if (/^(memory-|reflect-)/.test(filename)) return 'memory';
  if (/^(sync-|post-write-sync)/.test(filename)) return 'sync';
  return 'meta';
}

// ── Passthrough matcher check ─────────────────────────────────────────────────
function isPassthrough(m) {
  return PASSTHROUGH_MATCHERS.some(pat => new RegExp(pat).test(m) || m === pat);
}

// ── Extract filename from command string ──────────────────────────────────────
function extractFilename(cmd) {
  // Match quoted path or unquoted last token
  const m = cmd.match(/["']([^"']+\.js)["']/) || cmd.match(/(\S+\.js)$/);
  return m ? basename(m[1]) : null;
}

// ── Translate a Claude-side matcher string ────────────────────────────────────
// Preserves passthrough tokens verbatim; translates known tools to canonical.
// Returns array of canonical tool names (or passthrough tokens).
function translateClaudeMatcher(matcher) {
  if (!matcher || matcher.trim() === '') return [];
  return matcher.split('|').map(t => t.trim()).filter(Boolean);
}

// ── Translate a Gemini matcher string to Claude canonical names ───────────────
function translateGeminiMatcher(matcher) {
  if (!matcher || matcher.trim() === '') return [];
  return matcher.split('|').map(t => {
    const clean = t.trim();
    if (!clean) return null;
    // Passthrough check on raw token
    if (isPassthrough(clean)) return clean;
    return reverseToolMap[clean] || clean;
  }).filter(Boolean);
}

// ── Translate Codex raw regex to canonical names where possible ────────────────
// Returns { canonical: string[], raw: string|null }
// If regex maps cleanly to known tools → canonical. Otherwise keep raw.
function translateCodexMatcher(raw) {
  if (!raw || raw.trim() === '') return { canonical: [], raw: null };
  // Try to parse simple alternation like ^(shell|apply_patch)$
  const inner = raw.replace(/^\^[\(\[]?/, '').replace(/[\)\]]?\$$/, '');
  const parts = inner.split('|').map(t => t.trim()).filter(Boolean);
  const canonical = parts.map(t => reverseCodexToolMap[t] || null);
  const allMapped = canonical.every(c => c !== null);
  if (allMapped) {
    return { canonical: canonical, raw: raw };
  }
  return { canonical: [], raw: raw };
}

// ── Translate Codex event name to Claude canonical ────────────────────────────
function toCanonicalEvent(tool, eventName) {
  if (tool === 'gemini') return reverseEventMap[eventName] || eventName;
  if (tool === 'codex')  return reverseCodexEventMap[eventName] || eventName;
  return eventName;
}

// ── Parse Claude settings.json ────────────────────────────────────────────────
function parseClaude() {
  const raw = JSON.parse(readFileSync(CLAUDE_SETTINGS, 'utf8'));
  const hooks = raw.hooks || {};
  const entries = []; // { file, event, matcher, timeout, async, if }

  for (const [eventName, eventEntries] of Object.entries(hooks)) {
    const canonicalEvent = eventName; // Claude is canonical
    for (const entry of eventEntries) {
      const matcher = entry.matcher ?? null;
      for (const h of (entry.hooks || [])) {
        const file = extractFilename(h.command || '');
        if (!file) continue;
        entries.push({
          file,
          event: canonicalEvent,
          matcher,
          timeout: h.timeout || null,
          async: h.async || false,
          if: h.if || null,
        });
      }
    }
  }
  return entries;
}

// ── Parse Gemini settings.json ────────────────────────────────────────────────
function parseGemini() {
  const raw = JSON.parse(readFileSync(GEMINI_SETTINGS, 'utf8'));
  const hooks = raw.hooks || {};
  const entries = [];

  for (const [eventName, eventEntries] of Object.entries(hooks)) {
    const canonicalEvent = toCanonicalEvent('gemini', eventName);
    for (const entry of eventEntries) {
      const matcher = entry.matcher ?? null;
      for (const h of (entry.hooks || [])) {
        const file = extractFilename(h.command || '');
        if (!file) continue;
        // timeout in ms → seconds
        const timeoutMs = h.timeout || null;
        const timeoutS = timeoutMs !== null ? Math.round(timeoutMs / 1000) : null;
        entries.push({
          file,
          event: canonicalEvent,
          matcher,
          timeout: timeoutS,
          async: h.async || false,
          name: h.name || null,
        });
      }
    }
  }
  return entries;
}

// ── Parse Codex config.toml (line-by-line) ────────────────────────────────────
function parseCodex() {
  const text = readFileSync(CODEX_CONFIG, 'utf8');
  const lines = text.split('\n');
  const entries = [];

  let currentEvent = null;
  let currentMatcher = null;
  let currentAsync = false;
  let inHooksBlock = false;
  let pendingCommand = null;
  let pendingTimeout = null;
  let pendingAsync = false;

  function flush() {
    if (pendingCommand && currentEvent) {
      const file = extractFilename(pendingCommand);
      if (file) {
        entries.push({
          file,
          event: toCanonicalEvent('codex', currentEvent),
          matcher: currentMatcher,
          timeout: pendingTimeout,
          async: pendingAsync || currentAsync,
        });
      }
    }
    pendingCommand = null;
    pendingTimeout = null;
    pendingAsync = false;
  }

  for (const line of lines) {
    const trimmed = line.trim();

    // Section header: [[hooks.EventName]]
    const eventMatch = trimmed.match(/^\[\[hooks\.(\w+)\]\]$/);
    if (eventMatch) {
      flush();
      inHooksBlock = false;
      if (currentEvent !== eventMatch[1]) {
        // New event group — reset matcher/async for the group
        currentEvent = eventMatch[1];
        currentMatcher = null;
        currentAsync = false;
      }
      continue;
    }

    // [[hooks.EventName.hooks]] sub-block
    const hooksBlockMatch = trimmed.match(/^\[\[hooks\.\w+\.hooks\]\]$/);
    if (hooksBlockMatch) {
      flush();
      inHooksBlock = true;
      continue;
    }

    // Any other [[...]] section — stop tracking
    if (trimmed.startsWith('[[') && !trimmed.startsWith('[[hooks.')) {
      flush();
      currentEvent = null;
      inHooksBlock = false;
      continue;
    }

    if (!currentEvent) continue;

    // Key=value pairs
    const kvMatch = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
    if (!kvMatch) continue;
    const [, key, val] = kvMatch;
    const unquotedVal = val.replace(/^['"]|['"]$/g, '').trim();

    if (!inHooksBlock) {
      // Event-level fields (matcher, async on the [[hooks.X]] entry)
      if (key === 'matcher') currentMatcher = unquotedVal;
      if (key === 'async' && val.trim() === 'true') currentAsync = true;
    } else {
      // Hook-level fields
      if (key === 'command') pendingCommand = unquotedVal;
      if (key === 'timeout') pendingTimeout = parseInt(val.trim(), 10) || null;
      if (key === 'async' && val.trim() === 'true') pendingAsync = true;
    }
  }
  flush();

  return entries;
}

// ── Merge entries from all 3 tools into per-file hook records ─────────────────
// hookMap: Map<file, { tools, events: Map<canonicalEvent, {matcherSets, timeout, async}>, overrides }>
function mergeEntries(claudeEntries, geminiEntries, codexEntries) {
  // Per-file, per-event, per-tool data
  // Structure: hookMap[file][event] = { claude: {...}, gemini: {...}, codex: {...} }
  const hookMap = new Map();

  function ensureFile(file) {
    if (!hookMap.has(file)) {
      hookMap.set(file, {
        tools: new Set(),
        eventData: new Map(), // event -> { claude, gemini, codex }
        overrides: {},
        orderByTool: { claude: Infinity, gemini: Infinity, codex: Infinity },
      });
    }
    return hookMap.get(file);
  }

  let claudeIdx = 0;
  for (const e of claudeEntries) {
    const rec = ensureFile(e.file);
    rec.tools.add('claude');
    rec.orderByTool.claude = Math.min(rec.orderByTool.claude, claudeIdx++);
    if (!rec.eventData.has(e.event)) rec.eventData.set(e.event, {});
    const ed = rec.eventData.get(e.event);
    if (!ed.claude) ed.claude = { matchers: new Set(), timeout: null, async: false, ifs: [] };
    const em = e.matcher;
    if (em !== null && em !== '') {
      translateClaudeMatcher(em).forEach(m => ed.claude.matchers.add(m));
    }
    if (e.timeout) ed.claude.timeout = e.timeout;
    if (e.async) ed.claude.async = true;
    if (e.if) ed.claude.ifs.push(e.if);
  }

  let geminiIdx = 0;
  for (const e of geminiEntries) {
    const rec = ensureFile(e.file);
    rec.tools.add('gemini');
    rec.orderByTool.gemini = Math.min(rec.orderByTool.gemini, geminiIdx++);
    if (!rec.eventData.has(e.event)) rec.eventData.set(e.event, {});
    const ed = rec.eventData.get(e.event);
    if (!ed.gemini) ed.gemini = { matchers: new Set(), timeout: null, async: false };
    const em = e.matcher;
    if (em !== null && em !== '') {
      translateGeminiMatcher(em).forEach(m => ed.gemini.matchers.add(m));
    }
    if (e.timeout) ed.gemini.timeout = e.timeout;
    if (e.async) ed.gemini.async = true;
    if (e.name) {
      if (!rec.overrides.gemini) rec.overrides.gemini = {};
      rec.overrides.gemini.name = e.name;
    }
  }

  let codexIdx = 0;
  for (const e of codexEntries) {
    const rec = ensureFile(e.file);
    rec.tools.add('codex');
    rec.orderByTool.codex = Math.min(rec.orderByTool.codex, codexIdx++);
    if (!rec.eventData.has(e.event)) rec.eventData.set(e.event, {});
    const ed = rec.eventData.get(e.event);
    if (!ed.codex) ed.codex = { matchers: new Set(), timeout: null, async: false, rawMatchers: [] };
    const em = e.matcher;
    if (em !== null && em !== '') {
      const { canonical, raw } = translateCodexMatcher(em);
      canonical.forEach(m => ed.codex.matchers.add(m));
      if (raw) ed.codex.rawMatchers.push(raw);
    }
    if (e.timeout) ed.codex.timeout = e.timeout;
    if (e.async) ed.codex.async = true;
  }

  return hookMap;
}

// ── Detect cross-tool event conflicts ─────────────────────────────────────────
// Conflict = same file registered on DIFFERENT canonical events across tools
function detectConflicts(hookMap) {
  const conflicts = new Map();
  for (const [file, rec] of hookMap) {
    const eventsByTool = {};
    for (const [event, toolData] of rec.eventData) {
      for (const tool of ['claude', 'gemini', 'codex']) {
        if (toolData[tool]) {
          if (!eventsByTool[tool]) eventsByTool[tool] = new Set();
          eventsByTool[tool].add(event);
        }
      }
    }
    const allEventSets = Object.values(eventsByTool).map(s => [...s].sort().join(','));
    const unique = new Set(allEventSets);
    if (unique.size > 1) {
      conflicts.set(file, `events differ: ${Object.entries(eventsByTool).map(([t,s])=>`${t}=[${[...s].join(',')}]`).join(' ')}`);
    }
  }
  return conflicts;
}

// ── Build unified matcher list for output ─────────────────────────────────────
// Union of claude + gemini canonical matchers; codex raw stored in overrides.
function unifiedMatchers(claudeData, geminiData, codexData) {
  const all = new Set();
  if (claudeData) claudeData.matchers.forEach(m => all.add(m));
  if (geminiData) geminiData.matchers.forEach(m => all.add(m));
  if (codexData) codexData.matchers.forEach(m => all.add(m));
  return [...all].sort();
}

// ── Pick representative timeout (Claude preferred) ────────────────────────────
function pickTimeout(claudeData, geminiData, codexData) {
  if (claudeData?.timeout) return claudeData.timeout;
  if (geminiData?.timeout) return geminiData.timeout;
  if (codexData?.timeout) return codexData.timeout;
  return null;
}

// ── Pick representative async ─────────────────────────────────────────────────
function pickAsync(claudeData, geminiData, codexData) {
  return !!(claudeData?.async || geminiData?.async || codexData?.async);
}

// ── YAML helpers ──────────────────────────────────────────────────────────────
function yamlStr(s) {
  if (/[:#\[\]{},!&*?|>\\'"]/.test(s) || s.includes('\n') || s.startsWith(' ') || s.endsWith(' ')) {
    return `'${s.replace(/'/g, "''")}'`;
  }
  return s;
}

function yamlInlineList(arr) {
  if (!arr || arr.length === 0) return '[]';
  return '[' + arr.map(yamlStr).join(', ') + ']';
}

// ── Main ──────────────────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--output');
  const outputPath = outIdx !== -1 ? args[outIdx + 1] : null;

  const claudeEntries = parseClaude();
  const geminiEntries = parseGemini();
  const codexEntries  = parseCodex();

  const hookMap   = mergeEntries(claudeEntries, geminiEntries, codexEntries);
  const conflicts = detectConflicts(hookMap);

  // Sort files by minimum order across tools (preserves source config order)
  const sortedFiles = [...hookMap.keys()].sort((a, b) => {
    const ra = hookMap.get(a);
    const rb = hookMap.get(b);
    const minA = Math.min(ra.orderByTool.claude, ra.orderByTool.gemini, ra.orderByTool.codex);
    const minB = Math.min(rb.orderByTool.claude, rb.orderByTool.gemini, rb.orderByTool.codex);
    return minA - minB;
  });

  const lines = [];
  lines.push('# Auto-generated by bootstrap-manifest.mjs — review and validate before use');
  lines.push('# Canonical names use Claude event/tool names (platform-map.js translates)');
  lines.push('');
  lines.push('hooks:');

  let order = 1;

  for (const file of sortedFiles) {
    const rec = hookMap.get(file);
    const tools = [...rec.tools].sort();
    const category = categorize(file);
    const critical = CRITICAL_HOOKS.has(file);
    const conflictNote = conflicts.get(file);

    // Collect all events this hook appears on
    const allEvents = [...rec.eventData.keys()].sort();

    if (conflictNote) {
      lines.push(`  # CONFLICT: ${file} — ${conflictNote}`);
    }

    lines.push(`  - file: ${yamlStr(file)}`);
    lines.push(`    category: ${category}`);
    if (critical) lines.push(`    critical: true`);
    lines.push(`    tools: ${yamlInlineList(tools)}`);
    lines.push(`    order: ${order++}`);

    // async: true if any registration is async
    let anyAsync = false;
    let repTimeout = null;
    for (const event of allEvents) {
      const ed = rec.eventData.get(event);
      anyAsync = anyAsync || pickAsync(ed.claude, ed.gemini, ed.codex);
      const t = pickTimeout(ed.claude, ed.gemini, ed.codex);
      if (!repTimeout && t) repTimeout = t;
    }
    lines.push(`    async: ${anyAsync}`);

    // events block
    lines.push(`    events:`);
    for (const event of allEvents) {
      const ed = rec.eventData.get(event);
      const matchers = unifiedMatchers(ed.claude, ed.gemini, ed.codex);
      const timeout = pickTimeout(ed.claude, ed.gemini, ed.codex);

      lines.push(`      - event: ${yamlStr(event)}`);
      if (matchers.length > 0) {
        lines.push(`        matcher: ${yamlInlineList(matchers)}`);
      }
      if (timeout !== null) {
        lines.push(`        timeout: ${timeout}`);
      }
    }

    // overrides block
    const overrides = {};

    // Collect codex raw matchers
    for (const event of allEvents) {
      const ed = rec.eventData.get(event);
      if (ed.codex?.rawMatchers?.length) {
        if (!overrides.codex) overrides.codex = {};
        if (!overrides.codex.matcher_raw) overrides.codex.matcher_raw = [];
        for (const r of ed.codex.rawMatchers) {
          if (!overrides.codex.matcher_raw.includes(r)) {
            overrides.codex.matcher_raw.push(r);
          }
        }
      }
    }

    // Collect claude if: fields
    for (const event of allEvents) {
      const ed = rec.eventData.get(event);
      if (ed.claude?.ifs?.length) {
        if (!overrides.claude) overrides.claude = {};
        overrides.claude.if = ed.claude.ifs.join('|');
      }
    }

    // Gemini name from rec.overrides
    if (rec.overrides.gemini?.name) {
      overrides.gemini = { name: rec.overrides.gemini.name };
    }

    if (Object.keys(overrides).length > 0) {
      lines.push(`    overrides:`);
      for (const [tool, toolOverrides] of Object.entries(overrides)) {
        lines.push(`      ${tool}:`);
        for (const [k, v] of Object.entries(toolOverrides)) {
          if (Array.isArray(v)) {
            if (v.length === 1) {
              lines.push(`        ${k}: ${yamlStr(v[0])}`);
            } else {
              lines.push(`        ${k}:`);
              for (const item of v) lines.push(`          - ${yamlStr(item)}`);
            }
          } else {
            lines.push(`        ${k}: ${yamlStr(String(v))}`);
          }
        }
      }
    }

    lines.push('');
  }

  const output = lines.join('\n');

  if (outputPath) {
    writeFileSync(outputPath, output, 'utf8');
    process.stderr.write(`Written to ${outputPath}\n`);
  } else {
    process.stdout.write(output + '\n');
  }
}

main();
