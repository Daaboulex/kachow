#!/usr/bin/env node
// generate-settings.mjs (v2)
// Reads modules/hooks/MANIFEST.yaml + modules/tools/<tool>/capabilities.yaml
// → produces hook config for Claude (JSON), Gemini (JSON), Codex (TOML).
// Flags: --tool <codex|gemini|claude|all>  --preview (default)  --apply [--all]  --check

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const HOME = process.env.HOME || '$HOME';
const PATHS = {
  manifest: resolve(ROOT, 'modules/hooks/MANIFEST.yaml'),
  outputDir: resolve(ROOT, 'generated/configs'),
  hookSrc: resolve(ROOT, 'modules/hooks/src'),
  capabilities: {
    claude: resolve(ROOT, 'modules/tools/claude/capabilities.yaml'),
    gemini: resolve(ROOT, 'modules/tools/gemini/capabilities.yaml'),
    codex:  resolve(ROOT, 'modules/tools/codex/capabilities.yaml'),
    pi:     resolve(ROOT, 'modules/tools/pi/capabilities.yaml'),
  },
  hookBase: {
    claude: resolve(HOME, '.claude/hooks'),
    gemini: resolve(HOME, '.gemini/hooks'),
    codex:  resolve(HOME, '.codex/hooks'),
  },
};

// ── Argument parsing ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const MODE = args.includes('--check') ? 'check'
           : args.includes('--apply') ? 'apply'
           : 'preview';
const ALL = args.includes('--all');
const toolArg = (() => {
  const i = args.indexOf('--tool');
  return i !== -1 ? args[i + 1] : null;
})();

const VALID_TOOLS = ['claude', 'gemini', 'codex', 'pi'];
let targetTools;
if (toolArg === 'all' || ALL) {
  targetTools = VALID_TOOLS;
} else if (toolArg) {
  if (!VALID_TOOLS.includes(toolArg)) {
    console.error(`ERROR: unknown tool '${toolArg}'. Valid: ${VALID_TOOLS.join(', ')}`);
    process.exit(1);
  }
  targetTools = [toolArg];
} else {
  targetTools = VALID_TOOLS;
}

// ── Simple YAML parsers ─────────────────────────────────────────────────────

function parseCapabilitiesYaml(text) {
  const caps = { hook_events: [], tool_names: {}, timeout_unit: 'seconds' };
  let section = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trimEnd();
    if (!line.trim()) continue;
    const indent = line.match(/^(\s*)/)[1].length;

    if (indent === 0) {
      if (line.startsWith('hook_events:')) section = 'events';
      else if (line.startsWith('tool_names:')) section = 'tools';
      else if (line.startsWith('timeout_unit:')) {
        caps.timeout_unit = line.split(':')[1].trim();
        section = null;
      } else {
        section = null;
      }
      continue;
    }

    if (section === 'events' && line.trim().startsWith('- ')) {
      caps.hook_events.push(line.trim().replace(/^- /, '').trim());
    }
    if (section === 'tools' && line.includes(':')) {
      const [k, v] = line.trim().split(':').map(s => s.trim());
      caps.tool_names[k] = v;
    }
  }
  return caps;
}

function parseManifestYaml(text) {
  const lines = text.split('\n');
  const hooks = [];
  let current = null;
  let currentEvent = null;
  let inOverrides = false;
  let overrideTool = null;

  function indentOf(line) { return line.match(/^(\s*)/)[1].length; }
  function parseInlineArray(val) {
    const m = val.match(/^\[(.+)\]$/);
    if (!m) return null;
    return m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
  }
  function stripComment(line) {
    const idx = line.indexOf(' #');
    return idx !== -1 ? line.slice(0, idx) : line;
  }

  for (const raw of lines) {
    const line = stripComment(raw).trimEnd();
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const ind = indentOf(line);
    const trimmed = line.trim();

    if (ind === 2 && trimmed.startsWith('- file:')) {
      current = {
        file: trimmed.replace(/^- file:\s*/, '').trim(),
        category: null, critical: false, tools: [],
        order: 999, async: false, events: [], overrides: {},
      };
      hooks.push(current);
      inOverrides = false; overrideTool = null; currentEvent = null;
      continue;
    }
    if (!current) continue;

    if (ind === 4) {
      inOverrides = false; overrideTool = null; currentEvent = null;
      if (trimmed.startsWith('category:')) current.category = trimmed.replace('category:', '').trim();
      else if (trimmed.startsWith('critical:')) current.critical = trimmed.replace('critical:', '').trim() === 'true';
      else if (trimmed.startsWith('execForm:')) current.execForm = trimmed.replace('execForm:', '').trim() === 'true';
      else if (trimmed.startsWith('tools:')) {
        const arr = parseInlineArray(trimmed.replace('tools:', '').trim());
        if (arr) current.tools = arr;
      }
      else if (trimmed.startsWith('order:')) current.order = parseInt(trimmed.replace('order:', '').trim(), 10) || 999;
      else if (trimmed.startsWith('async:')) current.async = trimmed.replace('async:', '').trim() === 'true';
      else if (trimmed === 'overrides:') inOverrides = true;
      continue;
    }

    if (ind === 6 && trimmed.startsWith('- event:')) {
      currentEvent = { event: trimmed.replace(/^- event:\s*/, '').trim(), matcher: null, timeout: 5 };
      current.events.push(currentEvent);
      inOverrides = false;
      continue;
    }

    if (ind === 8 && currentEvent) {
      if (trimmed.startsWith('matcher:')) {
        const val = trimmed.replace('matcher:', '').trim();
        const arr = parseInlineArray(val);
        currentEvent.matcher = arr || [val.replace(/^['"]|['"]$/g, '')];
      } else if (trimmed.startsWith('timeout:')) {
        currentEvent.timeout = parseInt(trimmed.replace('timeout:', '').trim(), 10) || 5;
      } else if (trimmed.startsWith('continueOnBlock:')) {
        currentEvent.continueOnBlock = trimmed.replace('continueOnBlock:', '').trim() === 'true';
      }
      continue;
    }

    if (inOverrides && ind === 6) {
      const m = trimmed.match(/^(\w+):$/);
      if (m) { overrideTool = m[1]; current.overrides[overrideTool] = current.overrides[overrideTool] || {}; }
      continue;
    }

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

// ── Load capabilities ─────────────────────────────────────────────────────────

const capabilities = {};
for (const tool of VALID_TOOLS) {
  capabilities[tool] = parseCapabilitiesYaml(readFileSync(PATHS.capabilities[tool], 'utf8'));
}

function buildReverseToolMap(targetCaps) {
  const map = {};
  const claudeNames = capabilities.claude.tool_names;
  const targetNames = targetCaps.tool_names;
  for (const [key, claudeName] of Object.entries(claudeNames)) {
    const targetName = targetNames[key];
    if (targetName !== undefined) map[claudeName] = targetName;
  }
  return map;
}

const geminiToolMap = buildReverseToolMap(capabilities.gemini);
const codexToolMap = buildReverseToolMap(capabilities.codex);

const GEMINI_EVENT_MAP = { PreToolUse: 'BeforeTool', PostToolUse: 'AfterTool', Stop: 'SessionEnd', PreCompact: 'PreCompress' };
const CODEX_EVENT_MAP = {};

function translateEventGemini(ev) { return GEMINI_EVENT_MAP[ev] || ev; }
function translateEventCodex(ev) { return CODEX_EVENT_MAP[ev] || ev; }
function isEventSupported(tool, event) { return capabilities[tool].hook_events.includes(event); }

const GEMINI_MCP_PATTERN = 'mcp_.*';
const CODEX_MCP_PATTERN = 'mcp__.*';
const SKIP_MATCHERS_GEMINI = ['NotebookEdit'];
const SKIP_MATCHERS_CODEX = ['mcp__.*', 'NotebookEdit'];

function translateMatcherGemini(canonicalTools) {
  if (!canonicalTools || canonicalTools.length === 0) return null;
  const translated = [];
  for (const t of canonicalTools) {
    if (SKIP_MATCHERS_GEMINI.includes(t)) continue;
    if (t === 'mcp__.*') { translated.push(GEMINI_MCP_PATTERN); continue; }
    const mapped = geminiToolMap[t];
    if (mapped) translated.push(mapped);
    else translated.push(t);
  }
  return translated.length > 0 ? translated.join('|') : null;
}

function translateMatcherCodex(canonicalTools, matcherRaw) {
  if (matcherRaw) return matcherRaw;
  if (!canonicalTools || canonicalTools.length === 0) return null;
  const mapped = new Set();
  for (const t of canonicalTools) {
    if (SKIP_MATCHERS_CODEX.includes(t)) continue;
    const m = codexToolMap[t];
    if (m !== null && m !== undefined) mapped.add(m);
  }
  if (mapped.size === 0) return null;
  if (mapped.size === 1) return `^${[...mapped][0]}$`;
  return `^(${[...mapped].join('|')})$`;
}

// ── Generator: Claude JSON ────────────────────────────────────────────────────

function generateClaudeHooks(allHooks) {
  const out = {};
  for (const hook of allHooks) {
    if (!hook.tools.includes('claude')) continue;
    for (const ev of hook.events) {
      const event = ev.event;
      if (!out[event]) out[event] = [];
      const matcher = ev.matcher ? ev.matcher.join('|') : '';
      const claudeIf = hook.overrides?.claude?.if;
      const hookPath = `${PATHS.hookBase.claude}/${hook.file}`;
      const hookEntry = { type: 'command' };
      if (hook.execForm) {
        hookEntry.command = 'node';
        hookEntry.args = [hookPath];
      } else {
        hookEntry.command = `node "${hookPath}"`;
      }
      hookEntry.timeout = ev.timeout;
      if (hook.async) hookEntry.async = true;
      if (claudeIf) hookEntry.if = claudeIf;
      if (ev.continueOnBlock) hookEntry.continueOnBlock = true;

      const matcherKey = claudeIf ? `__if__${claudeIf}` : matcher;
      const existing = out[event].find(g => (g._matcherKey || g.matcher || '') === matcherKey);
      if (existing) { existing.hooks.push(hookEntry); }
      else {
        const group = { hooks: [hookEntry], _matcherKey: matcherKey };
        if (matcher && !claudeIf) group.matcher = matcher;
        out[event].push(group);
      }
    }
  }
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
      const geminiEvent = translateEventGemini(ev.event);
      if (!isEventSupported('gemini', geminiEvent)) continue;
      if (!out[geminiEvent]) out[geminiEvent] = [];
      const geminiMatcher = ev.matcher ? translateMatcherGemini(ev.matcher) : null;
      if (ev.matcher && ev.matcher.length > 0 && geminiMatcher === null) continue;

      const hookEntry = { type: 'command', command: `node "${PATHS.hookBase.gemini}/${hook.file}"`, timeout: ev.timeout * 1000 };
      const gName = hook.overrides?.gemini?.name;
      if (gName) hookEntry.name = gName;

      const matcherKey = geminiMatcher || '';
      const existing = out[geminiEvent].find(g => (g.matcher || '') === matcherKey);
      if (existing) { existing.hooks.push(hookEntry); }
      else {
        const group = { hooks: [hookEntry] };
        if (geminiMatcher) group.matcher = geminiMatcher;
        out[geminiEvent].push(group);
      }
    }
  }
  return out;
}

// ── Generator: Codex TOML ─────────────────────────────────────────────────────

function generateCodexToml(allHooks) {
  const sections = [];
  for (const hook of allHooks) {
    if (!hook.tools.includes('codex')) continue;
    for (const ev of hook.events) {
      const codexEvent = translateEventCodex(ev.event);
      if (!isEventSupported('codex', codexEvent)) continue;
      const matcherRaw = hook.overrides?.codex?.matcher_raw;
      const codexMatcher = translateMatcherCodex(ev.matcher, matcherRaw);
      if (ev.matcher && ev.matcher.length > 0 && !matcherRaw && codexMatcher === null) continue;
      sections.push({ event: codexEvent, matcher: codexMatcher, command: `node "${PATHS.hookBase.codex}/${hook.file}"`, timeout: ev.timeout, order: hook.order });
    }
  }
  sections.sort((a, b) => a.order - b.order);
  let toml = '';
  for (const s of sections) {
    toml += `\n[[hooks.${s.event}]]\n`;
    if (s.matcher) toml += `matcher = ${JSON.stringify(s.matcher)}\n`;
    toml += `command = ${JSON.stringify(s.command)}\n`;
    toml += `timeout = ${s.timeout}\n`;
  }
  return toml.trimStart();
}

// ── Generator: Pi TypeScript Extension ────────────────────────────────────────

const PI_EVENT_MAP = {
  SessionStart: 'session_start',
  PreToolUse: 'tool_call',
  PostToolUse: 'turn_end',
  Stop: 'session_shutdown',
  PreCompact: 'session_before_compact',
  UserPromptSubmit: null,
};

function generatePiBridge(allHooks) {
  const piHooks = allHooks.filter(h => h.tools.includes('pi'));
  const byEvent = {};
  for (const hook of piHooks) {
    for (const ev of hook.events) {
      const piEvent = PI_EVENT_MAP[ev.event];
      if (!piEvent) continue;
      if (!byEvent[piEvent]) byEvent[piEvent] = [];
      byEvent[piEvent].push({ file: hook.file, blocking: ev.event === 'PreToolUse' });
    }
  }

  const lines = [
    'import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";',
    'import { execSync } from "child_process";',
    'import { existsSync, readFileSync } from "fs";',
    'import { join } from "path";',
    '',
    'const HOME = process.env.HOME || "$HOME";',
    'const HOOKS_DIR = join(HOME, ".ai-context", "modules", "hooks", "src");',
    '',
    'function runHook(hookFile: string, input: object): any {',
    '  try {',
    '    const json = JSON.stringify(input).replace(/\'/g, "\'\\\\\'\'");',
    '    const result = execSync(',
    '      `echo \'${json}\' | node "${HOOKS_DIR}/${hookFile}"`,',
    '      { timeout: 8000, encoding: "utf-8", env: { ...process.env, AI_TOOL: "pi" } }',
    '    );',
    '    return result.trim() ? JSON.parse(result.trim()) : null;',
    '  } catch {',
    '    return null;',
    '  }',
    '}',
    '',
    'export default function (pi: ExtensionAPI) {',
  ];

  // before_agent_start — hardcoded (Pi-specific AGENTS.md injection)
  lines.push('  pi.on("before_agent_start", async (event, _ctx) => {');
  lines.push('    const cwd = process.cwd();');
  lines.push('    const projectAgents = join(cwd, ".ai-context", "AGENTS.md");');
  lines.push('    if (existsSync(projectAgents)) {');
  lines.push('      try {');
  lines.push('        const content = readFileSync(projectAgents, "utf8");');
  lines.push('        return { systemPrompt: (event as any).systemPrompt + "\\n" + content };');
  lines.push('      } catch {}');
  lines.push('    }');
  lines.push('  });');
  lines.push('');

  // Generate event handlers from MANIFEST
  for (const [piEvent, hooks] of Object.entries(byEvent)) {
    const hasBlocking = hooks.some(h => h.blocking);

    if (piEvent === 'tool_call') {
      lines.push(`  pi.on("${piEvent}", async (event, _ctx) => {`);
      lines.push('    const input = { tool_name: event.toolName, tool_input: event.input };');
      for (const h of hooks) {
        if (h.blocking) {
          lines.push(`    const r_${h.file.replace(/[^a-zA-Z0-9]/g, '_')} = runHook("${h.file}", input);`);
          lines.push(`    if (r_${h.file.replace(/[^a-zA-Z0-9]/g, '_')}?.decision === "block") {`);
          lines.push(`      return { block: true, reason: r_${h.file.replace(/[^a-zA-Z0-9]/g, '_')}.reason };`);
          lines.push('    }');
        } else {
          lines.push(`    runHook("${h.file}", input);`);
        }
      }
      lines.push('  });');
    } else if (piEvent === 'turn_end') {
      lines.push(`  pi.on("${piEvent}", async (_event, _ctx) => {`);
      lines.push('    const input = { tool_name: "aggregate", tool_input: {} };');
      for (const h of hooks) {
        lines.push(`    runHook("${h.file}", input);`);
      }
      lines.push('  });');
    } else if (piEvent === 'session_start') {
      lines.push(`  pi.on("${piEvent}", async (_event, _ctx) => {`);
      for (const h of hooks) {
        lines.push(`    runHook("${h.file}", { cwd: process.cwd() });`);
      }
      lines.push('  });');
    } else if (piEvent === 'session_shutdown') {
      lines.push(`  pi.on("${piEvent}", async (_event, _ctx) => {`);
      lines.push('    const cwd = process.cwd();');
      for (const h of hooks) {
        lines.push(`    runHook("${h.file}", { cwd });`);
      }
      lines.push('  });');
    } else {
      lines.push(`  pi.on("${piEvent}", async (_event, _ctx) => {`);
      for (const h of hooks) {
        lines.push(`    runHook("${h.file}", {});`);
      }
      lines.push('  });');
    }
    lines.push('');
  }

  lines.push('}');
  return lines.join('\n');
}

// ── Critical-hook guard ───────────────────────────────────────────────────────

function checkCriticalHooks(allHooks, tool, generated) {
  const criticals = allHooks.filter(h => h.critical && h.tools.includes(tool));
  const text = typeof generated === 'string' ? generated : JSON.stringify(generated);
  return criticals.filter(c => !text.includes(c.file)).map(c => c.file);
}

// ── Merge helpers ─────────────────────────────────────────────────────────────

// For Claude/Gemini JSON: read existing file, replace only `hooks` key, keep all others.
function mergeJsonSettings(existingPath, newHooks) {
  let existing = {};
  if (existsSync(existingPath)) {
    try { existing = JSON.parse(readFileSync(existingPath, 'utf8')); }
    catch (e) { console.warn(`  WARN: could not parse ${existingPath}, starting fresh`); }
  }
  return Object.assign({}, existing, { hooks: newHooks });
}

// For Codex TOML: strip all [[hooks.*]] sections, then append freshly generated ones.
function mergeTomlSettings(existingPath, newHooksToml) {
  if (!existsSync(existingPath)) return newHooksToml;
  let existing = '';
  try { existing = readFileSync(existingPath, 'utf8'); }
  catch (e) { console.warn(`  WARN: could not read ${existingPath}, starting fresh`); return newHooksToml; }

  // Remove all [[hooks.*]] blocks (each block runs until next [[...]] or EOF)
  const lines = existing.split('\n');
  const kept = [];
  let inHooksBlock = false;
  for (const line of lines) {
    if (/^\[\[hooks\.[^\]]+\]\]/.test(line.trim())) {
      inHooksBlock = true;
      continue;
    }
    if (/^\[\[/.test(line.trim()) && !/^\[\[hooks\./.test(line.trim())) {
      inHooksBlock = false;
    }
    if (!inHooksBlock) kept.push(line);
  }

  // Trim trailing blank lines from non-hooks content
  const preserved = kept.join('\n').trimEnd();
  if (preserved.length === 0) return newHooksToml;
  return preserved + '\n\n' + newHooksToml;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const manifestText = readFileSync(PATHS.manifest, 'utf8');
const allHooks = parseManifestYaml(manifestText);
allHooks.sort((a, b) => a.order - b.order);

mkdirSync(PATHS.outputDir, { recursive: true });

function filenameForTool(tool) {
  if (tool === 'codex') return 'codex-config.toml';
  if (tool === 'pi') return 'kachow-bridge.ts';
  return `${tool}-settings.json`;
}

if (MODE === 'check') {
  let hasError = false;
  for (const tool of targetTools) {
    console.log(`\n── ${tool.toUpperCase()} ──`);
    const filename = filenameForTool(tool);
    const outPath = resolve(PATHS.outputDir, filename);
    if (!existsSync(outPath)) { console.log('  SKIP (no generated config)'); continue; }
    const content = readFileSync(outPath, 'utf8');
    const criticals = allHooks.filter(h => h.critical && h.tools.includes(tool));
    for (const c of criticals) {
      if (!content.includes(c.file)) { console.log(`  MISSING CRITICAL: ${c.file}`); hasError = true; }
    }
    if (!hasError) console.log('  OK');
  }
  process.exit(hasError ? 1 : 0);
}

function generate(tool) {
  if (tool === 'pi') return generatePiBridge(allHooks);
  const filename = tool === 'codex' ? 'codex-config.toml' : `${tool}-settings.json`;
  const existingPath = resolve(PATHS.outputDir, filename);

  if (tool === 'claude') {
    const hooks = generateClaudeHooks(allHooks);
    const missing = checkCriticalHooks(allHooks, 'claude', hooks);
    if (missing.length) { console.error(`ERROR: critical hooks missing (claude): ${missing.join(', ')}`); process.exit(2); }
    const merged = mergeJsonSettings(existingPath, hooks);
    return JSON.stringify(merged, null, 2);
  }
  if (tool === 'gemini') {
    const hooks = generateGeminiHooks(allHooks);
    const missing = checkCriticalHooks(allHooks, 'gemini', hooks);
    if (missing.length) { console.error(`ERROR: critical hooks missing (gemini): ${missing.join(', ')}`); process.exit(2); }
    const merged = mergeJsonSettings(existingPath, hooks);
    return JSON.stringify(merged, null, 2);
  }
  if (tool === 'codex') {
    const toml = generateCodexToml(allHooks);
    const missing = checkCriticalHooks(allHooks, 'codex', toml);
    if (missing.length) { console.error(`ERROR: critical hooks missing (codex): ${missing.join(', ')}`); process.exit(2); }
    return mergeTomlSettings(existingPath, toml);
  }
}

// ── Skill sync: copy plugin skills to .agents/skills + update symlinks ──
import { readdirSync, lstatSync, symlinkSync, cpSync } from 'fs';
function syncPluginSkills() {
  const pluginCache = resolve(HOME, '.claude/plugins/cache');
  const agentsSrc = resolve(ROOT, '.agents/skills');
  const agentsDiscovery = resolve(HOME, '.agents/skills');
  if (!existsSync(pluginCache) || !existsSync(agentsSrc)) return 0;
  let added = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        if (existsSync(resolve(full, 'SKILL.md'))) {
          const dest = resolve(agentsSrc, entry.name);
          if (!existsSync(dest)) { cpSync(full, dest, { recursive: true }); added++; }
          const link = resolve(agentsDiscovery, entry.name);
          if (!existsSync(link)) { try { symlinkSync(dest, link); } catch {} }
        } else { walk(full); }
      }
    }
  };
  walk(pluginCache);
  return added;
}

// ── Exclusion list: centralized, generates Claude skillOverrides, Gemini skills.disabled,
//    Codex [[skills.config]], and Pi settings ──
function readExclusions() {
  const exclusionsPath = resolve(ROOT, 'modules/skill-exclusions.yaml');
  if (!existsSync(exclusionsPath)) return [];
  return readFileSync(exclusionsPath, 'utf8').split('\n')
    .map(l => l.trim()).filter(l => l && !l.startsWith('#'));
}

function syncExclusions() {
  const lines = readExclusions();
  if (lines.length === 0) return;

  // Update Pi settings.json
  const piSettingsPath = resolve(ROOT, 'modules/tools/pi/settings.json');
  if (existsSync(piSettingsPath)) {
    const pi = JSON.parse(readFileSync(piSettingsPath, 'utf8'));
    const basePaths = (pi.skills || []).filter(s => !s.startsWith('!'));
    const exclusions = lines.map(name => `!~/.ai-context/.agents/skills/${name}`);
    pi.skills = [...basePaths, ...exclusions];
    writeFileSync(piSettingsPath, JSON.stringify(pi, null, 2));
  }

  // Update Claude settings.json — sync skillOverrides from exclusion list
  const claudePath = resolve(PATHS.outputDir, 'claude-settings.json');
  if (existsSync(claudePath)) {
    const claude = JSON.parse(readFileSync(claudePath, 'utf8'));
    const overrides = claude.skillOverrides || {};
    for (const name of lines) {
      const ceKey = `compound-engineering:${name}`;
      if (!overrides[ceKey]) overrides[ceKey] = 'name-only';
    }
    claude.skillOverrides = overrides;
    writeFileSync(claudePath, JSON.stringify(claude, null, 2));
  }

  // Update Gemini settings.json — add skills.disabled array + general.vimMode
  const geminiPath = resolve(PATHS.outputDir, 'gemini-settings.json');
  if (existsSync(geminiPath)) {
    const gemini = JSON.parse(readFileSync(geminiPath, 'utf8'));
    gemini.general = { ...(gemini.general || {}), vimMode: true };
    gemini.skills = { ...(gemini.skills || {}), disabled: lines };
    writeFileSync(geminiPath, JSON.stringify(gemini, null, 2));
  }

  // Update Codex config.toml — add [features] + [[skills.config]] entries
  const codexPath = resolve(PATHS.outputDir, 'codex-config.toml');
  if (existsSync(codexPath)) {
    let toml = readFileSync(codexPath, 'utf8');
    // Add or fix [features] section
    if (!toml.includes('[features]')) {
      toml = '[features]\nhooks = true\n\n' + toml;
    } else {
      toml = toml.replace('codex_hooks = true', 'hooks = true');
    }
    // Add skill exclusions if not present
    if (!toml.includes('[[skills.config]]')) {
      const skillEntries = lines.map(name =>
        `\n[[skills.config]]\nname = ${JSON.stringify(name)}\nenabled = false`
      ).join('\n');
      toml += '\n' + skillEntries + '\n';
    }
    writeFileSync(codexPath, toml);
  }
}

console.log(`${MODE} mode — tools: ${targetTools.join(', ')}`);
for (const tool of targetTools) {
  const content = generate(tool);
  const filename = filenameForTool(tool);
  if (MODE === 'apply') {
    const outPath = resolve(PATHS.outputDir, filename);
    writeFileSync(outPath, content, 'utf8');
    console.log(`  ${tool} → ${outPath}`);
    // Pi: also copy to extension dir
    if (tool === 'pi') {
      const piExtDir = resolve(HOME, '.pi/agent/extensions');
      const piExtPath = resolve(piExtDir, 'kachow-bridge.ts');
      try { mkdirSync(piExtDir, { recursive: true }); } catch {}
      writeFileSync(piExtPath, content, 'utf8');
      console.log(`  ${tool} → ${piExtPath} (extension copy)`);
    }
  } else {
    const ext = filename.split('.').pop();
    const outPath = `/tmp/generate-settings-v2-${tool}.${ext}`;
    writeFileSync(outPath, content, 'utf8');
    console.log(`  ${tool} preview → ${outPath}`);
  }
}

// Post-generation: sync plugin skills + exclusions + directory map
if (MODE === 'apply') {
  const added = syncPluginSkills();
  if (added > 0) console.log(`  skills: ${added} new plugin skills synced to .agents/`);
  syncExclusions();

  // Regenerate DIRECTORY-MAP.md
  try {
    const { execSync: exec } = await import('child_process');
    exec(`node "${resolve(ROOT, 'scripts/generate-directory-map.mjs')}"`, { stdio: 'inherit' });
  } catch {}
}
