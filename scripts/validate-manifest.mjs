#!/usr/bin/env node
// Validates MANIFEST.yaml structural correctness before generator consumes it.
// Usage: node validate-manifest.mjs [--file path/to/MANIFEST.yaml]

import { createRequire } from 'module';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const { ALL_EVENTS, TOOL_EVENTS } = require(resolve(__dirname, '../modules/hooks/lib/platform-map.js'));
const HOOKS_DIR = resolve(__dirname, '../modules/hooks/src');

const VALID_TOOLS = ['claude', 'gemini', 'codex', 'crush', 'opencode'];
const VALID_CATEGORIES = ['safety', 'lifecycle', 'observability', 'memory', 'sync', 'meta'];
const REQUIRED_CRITICAL = [
  'block-subagent-writes.js',
  'block-subagent-non-bash-writes.js',
  'autosave-before-destructive.js',
  'scrub-sentinel.js',
  'pre-write-combined-guard.js',
];

// Canonical events available per tool (using Claude canonical names)
// platform-map TOOL_EVENTS for gemini/codex use translated names — we need canonical names
const eventMap = {
  'BeforeTool': 'PreToolUse',
  'AfterTool': 'PostToolUse',
  'SessionEnd': 'Stop',
  'BeforeAgent': 'SubagentStart',
  'AfterAgent': 'SubagentStop',
  'PreCompress': 'PreCompact',
};

// Build canonical event sets per tool
const TOOL_CANONICAL_EVENTS = {
  claude: new Set(TOOL_EVENTS.claude),
  gemini: new Set(TOOL_EVENTS.gemini.map(e => eventMap[e] || e)),
  codex:  new Set(TOOL_EVENTS.codex),
  crush:  new Set(['PreToolUse']),
};

// ── Minimal line-by-line YAML parser for MANIFEST format ─────────────────────
// Handles the specific structure: top-level hooks: list of objects with
// scalar fields, inline arrays, multi-line events list, overrides block.
function parseManifest(text) {
  const lines = text.split('\n');
  const hooks = [];
  let current = null;
  let state = 'root'; // root | hook | events | overrides | override-tool
  let currentEvent = null;
  let overrideTool = null;
  let indent = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const stripped = raw.trimStart();
    if (!stripped || stripped.startsWith('#')) continue;
    const lineIndent = raw.length - stripped.length;

    // Top-level hooks: list entry
    if (stripped === 'hooks:') { state = 'root'; continue; }

    if (stripped.startsWith('- file:') && lineIndent === 2) {
      if (current) hooks.push(current);
      current = {
        file: stripped.slice('- file:'.length).trim(),
        tools: [],
        events: [],
        order: null,
        async: null,
        category: null,
        critical: false,
        overrides: {},
      };
      state = 'hook';
      continue;
    }

    if (!current) continue;

    if (state === 'hook' && lineIndent === 4) {
      if (stripped.startsWith('category:')) {
        current.category = stripped.slice('category:'.length).trim();
      } else if (stripped.startsWith('critical:')) {
        const val = stripped.slice('critical:'.length).trim();
        current.critical = val === 'true';
      } else if (stripped.startsWith('order:')) {
        current.order = Number(stripped.slice('order:'.length).trim());
      } else if (stripped.startsWith('async:')) {
        const val = stripped.slice('async:'.length).trim();
        current.async = val === 'true';
      } else if (stripped.startsWith('tools:')) {
        // inline array: tools: [claude, codex, gemini]
        const arr = stripped.slice('tools:'.length).trim();
        if (arr.startsWith('[')) {
          current.tools = arr.replace(/[\[\]]/g, '').split(',').map(t => t.trim()).filter(Boolean);
        }
      } else if (stripped === 'events:') {
        state = 'events';
      } else if (stripped === 'overrides:') {
        state = 'overrides';
      }
      continue;
    }

    if (state === 'events') {
      if (lineIndent === 4 && !stripped.startsWith('- ')) {
        // left the events block
        state = 'hook';
        i--; continue;
      }
      if (lineIndent === 6 && stripped.startsWith('- event:')) {
        currentEvent = { event: stripped.slice('- event:'.length).trim(), timeout: null, matcher: null };
        current.events.push(currentEvent);
      } else if (lineIndent === 8 && currentEvent) {
        if (stripped.startsWith('timeout:')) {
          currentEvent.timeout = Number(stripped.slice('timeout:'.length).trim());
        } else if (stripped.startsWith('matcher:')) {
          const arr = stripped.slice('matcher:'.length).trim();
          if (arr.startsWith('[')) {
            currentEvent.matcher = arr.replace(/[\[\]]/g, '').split(',').map(t => t.trim()).filter(Boolean);
          }
        }
      }
      continue;
    }

    if (state === 'overrides') {
      if (lineIndent === 4 && !stripped.startsWith('- ')) {
        // Check if still in overrides (indent 6 = tool key, indent 8 = tool fields)
        if (lineIndent < 6) {
          state = 'hook';
          i--; continue;
        }
      }
      if (lineIndent === 6) {
        // tool key like "codex:" or "gemini:"
        const tool = stripped.replace(':', '').trim();
        overrideTool = tool;
        if (!current.overrides[tool]) current.overrides[tool] = {};
      } else if (lineIndent === 8 && overrideTool) {
        const colon = stripped.indexOf(':');
        if (colon > 0) {
          const key = stripped.slice(0, colon).trim();
          const val = stripped.slice(colon + 1).trim();
          current.overrides[overrideTool][key] = val;
        }
      }
      continue;
    }
  }

  if (current) hooks.push(current);
  return hooks;
}

// ── Validation ────────────────────────────────────────────────────────────────
function validate(hooks) {
  const errors = [];
  const warnings = [];
  const seenFiles = new Set();
  const criticalSeen = new Set();

  // Per-event per-tool order uniqueness: map tool:event -> Set<order>
  const orderMap = {};

  for (const hook of hooks) {
    const ctx = hook.file || '<unknown>';

    // Rule 7: no duplicate files
    if (seenFiles.has(hook.file)) {
      errors.push(`ERROR: ${ctx} — duplicate file entry`);
    }
    seenFiles.add(hook.file);

    // Rule 1: required fields
    if (!hook.file) {
      errors.push(`ERROR: ${ctx} — missing 'file' field`);
    }
    if (!hook.tools || hook.tools.length === 0) {
      errors.push(`ERROR: ${ctx} — missing or empty 'tools'`);
    }
    if (!hook.events || hook.events.length === 0) {
      errors.push(`ERROR: ${ctx} — missing or empty 'events'`);
    }
    if (hook.order === null || hook.order === undefined || isNaN(hook.order)) {
      errors.push(`ERROR: ${ctx} — missing or non-numeric 'order'`);
    }

    // Rule 2: file must exist
    const fullPath = resolve(HOOKS_DIR, hook.file);
    if (!existsSync(fullPath)) {
      errors.push(`ERROR: ${ctx} — file not found in hooks/`);
    }

    // Rule 3: tools subset
    for (const t of (hook.tools || [])) {
      if (!VALID_TOOLS.includes(t)) {
        errors.push(`ERROR: ${ctx} — invalid tool '${t}'`);
      }
    }

    // Rule 9: timeout positive number
    for (const ev of (hook.events || [])) {
      if (ev.timeout !== null && ev.timeout !== undefined) {
        if (typeof ev.timeout !== 'number' || isNaN(ev.timeout) || ev.timeout <= 0) {
          errors.push(`ERROR: ${ctx} — timeout must be positive number (got ${ev.timeout})`);
        }
      }
    }

    // Rule 10: async boolean
    if (hook.async !== null && hook.async !== undefined && typeof hook.async !== 'boolean') {
      errors.push(`ERROR: ${ctx} — async must be boolean`);
    }

    // Rule 10b: critical hooks MUST NOT be async (exit(2) blocking is silently discarded when async)
    if (hook.critical && hook.async) {
      errors.push(`ERROR: ${ctx} — critical hook must not be async (exit(2) block signal is discarded when async:true)`);
    }

    // Rule 10c: PreToolUse hooks should not be async (defeats blocking purpose)
    if (hook.async) {
      const hasPreTool = (hook.events || []).some(ev => ev.event === 'PreToolUse');
      if (hasPreTool) {
        warnings.push(`WARNING: ${ctx} — async PreToolUse hook cannot block tool calls (exit(2) is ignored when async)`);
      }
    }

    // Rule 11: category valid
    if (hook.category && !VALID_CATEGORIES.includes(hook.category)) {
      errors.push(`ERROR: ${ctx} — invalid category '${hook.category}'`);
    }

    // Rule 4: event names canonical
    for (const ev of (hook.events || [])) {
      if (!ALL_EVENTS.includes(ev.event)) {
        errors.push(`ERROR: ${ctx} — unknown event '${ev.event}' (not in ALL_EVENTS)`);
      }

      // Rule 5: tool × event compatibility (warn, not error — generator filters by tool)
      for (const tool of (hook.tools || [])) {
        const toolEvents = TOOL_CANONICAL_EVENTS[tool];
        if (toolEvents && !toolEvents.has(ev.event)) {
          warnings.push(`WARNING: ${ctx} — tool '${tool}' doesn't support event '${ev.event}' (generator will skip)`);
        }
      }

      // Rule 12: order unique within tool:event
      for (const tool of (hook.tools || [])) {
        const key = `${tool}:${ev.event}`;
        if (!orderMap[key]) orderMap[key] = new Map();
        if (orderMap[key].has(hook.order)) {
          const other = orderMap[key].get(hook.order);
          errors.push(`ERROR: ${ctx} — order ${hook.order} conflicts with ${other} on ${key}`);
        } else {
          orderMap[key].set(hook.order, ctx);
        }
      }
    }

    // Rule 6: overrides keys subset of tools
    for (const overrideTool of Object.keys(hook.overrides || {})) {
      if (!(hook.tools || []).includes(overrideTool)) {
        errors.push(`ERROR: ${ctx} — override for '${overrideTool}' but tool not in tools[]`);
      }
    }

    // Track critical hooks seen
    if (hook.critical) {
      criticalSeen.add(hook.file);
    }
  }

  // Rule 8: required critical hooks
  for (const required of REQUIRED_CRITICAL) {
    if (!seenFiles.has(required)) {
      errors.push(`ERROR: ${required} — required critical hook missing from MANIFEST`);
    } else if (!criticalSeen.has(required)) {
      errors.push(`ERROR: ${required} — required critical hook not marked critical: true`);
    }
  }

  // Warnings: hooks in hooks/ dir not in MANIFEST
  let hooksOnDisk = [];
  try {
    hooksOnDisk = readdirSync(HOOKS_DIR).filter(f => f.endsWith('.js') && !f.startsWith('lib/'));
  } catch {}
  for (const f of hooksOnDisk) {
    if (!seenFiles.has(f)) {
      warnings.push(`WARNING: ${f} — unregistered hook (not in any tool config)`);
    }
  }

  return { errors, warnings, criticalCount: criticalSeen.size };
}

// ── Main ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let manifestPath = resolve(__dirname, '../modules/hooks/MANIFEST.yaml');
const fileIdx = args.indexOf('--file');
if (fileIdx !== -1 && args[fileIdx + 1]) {
  manifestPath = resolve(args[fileIdx + 1]);
}

if (!existsSync(manifestPath)) {
  console.error(`ERROR: MANIFEST not found at ${manifestPath}`);
  process.exit(1);
}

const text = readFileSync(manifestPath, 'utf8');
const hooks = parseManifest(text);

if (hooks.length === 0) {
  console.error('ERROR: parsed 0 hooks — MANIFEST may be malformed or empty');
  process.exit(1);
}

const { errors, warnings, criticalCount } = validate(hooks);

for (const w of warnings) console.warn(w);

if (errors.length > 0) {
  for (const e of errors) console.error(e);
  process.exit(1);
}

console.log(`MANIFEST valid: ${hooks.length} hooks, ${criticalCount} critical`);
process.exit(0);
