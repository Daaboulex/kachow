#!/usr/bin/env node
// skill-utilization-report.mjs
// Produce utilization analytics for installed skills vs actually-invoked skills.
//
// Reads:
//   ~/.claude/skills/*/SKILL.md                          — user-installed (Claude)
//   ~/.claude/plugins/marketplaces/*/skills/*/SKILL.md   — plugin-shipped (dedup'd)
//   ~/.claude/plugins/marketplaces/*/plugins/*/skills/*/SKILL.md
//   ~/.gemini/skills/*/SKILL.md                          — user-installed (Gemini)
//   ~/.gemini/extensions/*/skills/*/SKILL.md             — extension-shipped
//   ~/.claude/skill-usage.json                           — usage log
//
// Writes:
//   stdout: human markdown report
//   --json flag: JSON structured for programmatic triage
//
// Dedup rule: logical skill identity = SKILL.md basename's parent dir name,
// namespaced by plugin root where present (e.g. superpowers:brainstorming).
// Per-IDE mirrors (.cursor/, .gemini/, .opencode/, etc. under one plugin)
// collapse to ONE logical skill.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename, dirname, relative } from 'node:path';

const HOME = homedir();
const JSON_OUT = process.argv.includes('--json');

function safeReaddir(p) {
  try { return readdirSync(p, { withFileTypes: true }); } catch { return []; }
}

function safeStat(p) {
  try { return statSync(p); } catch { return null; }
}

// Find all SKILL.md files under a root, limited depth.
function findSkillFiles(root, maxDepth = 6) {
  const results = [];
  function walk(dir, depth) {
    if (depth > maxDepth) return;
    const entries = safeReaddir(dir);
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.git' || e.name === '.stversions') continue;
        walk(full, depth + 1);
      } else if (e.name === 'SKILL.md') {
        results.push(full);
      }
    }
  }
  walk(root, 0);
  return results;
}

// Classify a SKILL.md path into { source, namespace, name, logical_id, mirror_of }
function classify(skillPath) {
  const rel = relative(HOME, skillPath);
  const parts = rel.split('/');
  // name = parent dir of SKILL.md
  const name = parts[parts.length - 2];

  // Patterns:
  //   .claude/skills/<name>/SKILL.md                         user-installed (canonical)
  //   .gemini/skills/<name>/SKILL.md                         user-installed (canonical)
  //   .claude/plugins/marketplaces/<mp>/plugins/<plugin>/skills/<name>/SKILL.md
  //   .claude/plugins/marketplaces/<mp>/plugins/<plugin>/skills/<name>/.cursor/skills/<name>/SKILL.md  — IDE mirror
  //   .claude/plugins/marketplaces/<mp>/<plugin>/<ver>/skills/<name>/SKILL.md — cache
  //   .gemini/extensions/<ext>/skills/<name>/SKILL.md        extension-shipped
  //   .claude/plugins/marketplaces/<mp>/plugins/<plugin>/agent-harness/<...>/skills/SKILL.md — scaffold

  if (parts.includes('agent-harness')) {
    return { source: 'scaffold', name, logical_id: null, mirror_of: null, path: skillPath, skip: true };
  }

  // Detect IDE mirror: path has /.cursor/ /.gemini/ /.opencode/ /.kiro/ /.pi/ /.rovodev/ /.windsurf/ /.agents/ /.trae/ /.trae-cn/ /.github/
  const mirrorDirs = ['.cursor', '.gemini', '.opencode', '.kiro', '.pi', '.rovodev', '.windsurf', '.agents', '.trae', '.trae-cn', '.github'];
  const hasMirrorDir = parts.some(p => mirrorDirs.includes(p));
  if (hasMirrorDir) {
    return { source: 'ide-mirror', name, logical_id: null, mirror_of: null, path: skillPath, skip: true };
  }

  // plugins/cache/<mp>/<plugin>/<version>/skills/<name>/SKILL.md  (installed plugin cache)
  const cacheIdx = parts.indexOf('cache');
  if (cacheIdx !== -1 && parts[cacheIdx - 1] === 'plugins') {
    // expected layout: plugins/cache/<mp>/<plugin>/<ver>/skills/<name>/SKILL.md
    // also:            plugins/cache/<mp>/<plugin>/<ver>/.<ide>/skills/<name>/ (mirror — caught above)
    if (parts[cacheIdx + 4] === 'skills') {
      const plugin = parts[cacheIdx + 2];
      return { source: 'plugin-cache-installed', namespace: plugin, name, logical_id: `${plugin}:${name}`, path: skillPath };
    }
  }

  // plugin-cache / marketplace
  const mpIdx = parts.indexOf('marketplaces');
  if (mpIdx !== -1) {
    const mp = parts[mpIdx + 1];
    // plugins/<plugin>/skills/<name>/SKILL.md
    const pluginsIdx = parts.indexOf('plugins', mpIdx);
    if (pluginsIdx !== -1 && parts[pluginsIdx + 2] === 'skills') {
      const plugin = parts[pluginsIdx + 1];
      return { source: 'plugin', namespace: plugin, name, logical_id: `${plugin}:${name}`, path: skillPath };
    }
    // cache: <mp>/<plugin>/<ver>/skills/<name>/SKILL.md
    if (parts[mpIdx + 3] === 'skills') {
      const plugin = parts[mpIdx + 2]; // plugin name not version
      return { source: 'plugin-cache', namespace: plugin, name, logical_id: `${plugin}:${name}`, mirror_of: `plugin:${plugin}:${name}`, path: skillPath, skip: true };
    }
    // marketplaces/<mp>/skills/<name>/SKILL.md  (marketplace-level, no plugin scope)
    if (parts[mpIdx + 2] === 'skills') {
      return { source: 'marketplace-top', namespace: mp, name, logical_id: `${mp}:${name}`, path: skillPath };
    }
  }

  // .gemini/extensions/<ext>/skills/<name>
  const extIdx = parts.indexOf('extensions');
  if (extIdx !== -1 && parts[extIdx + 2] === 'skills') {
    const ext = parts[extIdx + 1];
    return { source: 'gemini-ext', namespace: ext, name, logical_id: `${ext}:${name}`, path: skillPath };
  }

  // .claude/skills/<name>  or  .gemini/skills/<name>  or  .ai-context/skills/<name>
  if (parts[1] === 'skills' || parts[0] === 'skills') {
    const tool = parts[0].replace(/^\./, '');
    return { source: 'user-installed', namespace: tool, name, logical_id: name, path: skillPath };
  }

  return { source: 'unclassified', name, logical_id: `?:${name}`, path: skillPath };
}

// Scan all known roots
const roots = [
  join(HOME, '.claude', 'skills'),
  join(HOME, '.claude', 'plugins', 'marketplaces'),
  join(HOME, '.claude', 'plugins', 'cache'),
  join(HOME, '.gemini', 'skills'),
  join(HOME, '.gemini', 'extensions'),
  join(HOME, '.ai-context', 'skills'),
];

const allFiles = [];
for (const r of roots) if (existsSync(r)) allFiles.push(...findSkillFiles(r));

const classified = allFiles.map(classify);
const logical = new Map();
for (const c of classified) {
  if (c.skip) continue;
  if (!c.logical_id) continue;
  const existing = logical.get(c.logical_id);
  if (!existing || c.source === 'user-installed') {
    logical.set(c.logical_id, c);
  }
}

// Load usage
const usagePath = join(HOME, '.claude', 'skill-usage.json');
const usage = existsSync(usagePath) ? JSON.parse(readFileSync(usagePath, 'utf8')) : { sessions: [] };
const invocCount = {};
let totalInvocations = 0;
for (const sess of usage.sessions || []) {
  for (const sk of sess.skills_used || []) {
    invocCount[sk] = (invocCount[sk] || 0) + 1;
    totalInvocations++;
  }
}

const uniqueInvoked = Object.keys(invocCount).length;

// skill-usage.json actually tracks BOTH slash-commands and skills — the hook
// name "track-skill-usage" is misleading. Separate:
//   - commands/<name>.md (slash commands)
//   - skills/<name>/SKILL.md (skills)
// We compute utilization for skills only. Commands tracked separately as context.
function normalize(s) {
  return s.replace(/[:_-]/g, '-').toLowerCase();
}

// Build command index from filesystem
const commandRoots = [
  join(HOME, '.claude', 'commands'),
  join(HOME, '.gemini', 'commands'),
];
const commandNames = new Set();
for (const r of commandRoots) {
  if (!existsSync(r)) continue;
  for (const e of safeReaddir(r)) {
    if (e.isFile() && e.name.endsWith('.md')) {
      commandNames.add(normalize(e.name.replace(/\.md$/, '')));
    }
  }
}

// Also include plugin-shipped commands
const pluginCmds = join(HOME, '.claude', 'plugins', 'marketplaces');
if (existsSync(pluginCmds)) {
  function walkCmds(dir, depth=0) {
    if (depth > 6) return;
    for (const e of safeReaddir(dir)) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'commands') {
          for (const f of safeReaddir(full)) if (f.name.endsWith('.md')) commandNames.add(normalize(f.name.replace(/\.md$/, '')));
        } else walkCmds(full, depth + 1);
      }
    }
  }
  walkCmds(pluginCmds);
}

const logicalByNormId = new Map();
for (const [id, c] of logical) logicalByNormId.set(normalize(id), id);
const logicalByBareName = new Map();
for (const [id, c] of logical) {
  const bare = id.includes(':') ? id.split(':').pop() : id;
  if (!logicalByBareName.has(normalize(bare))) logicalByBareName.set(normalize(bare), id);
}

const invokedLogical = new Set();
const invokedCommands = new Set();
const unmatchedInvocations = [];
for (const name of Object.keys(invocCount)) {
  const norm = normalize(name);
  const bare = norm.includes(':') ? norm.split(':').pop() : norm;
  const skillHit = logicalByNormId.get(norm) || logicalByBareName.get(norm);
  if (skillHit) {
    invokedLogical.add(skillHit);
  } else if (commandNames.has(norm) || commandNames.has(bare)) {
    invokedCommands.add(name);
  } else {
    unmatchedInvocations.push(name);
  }
}

const rawTotal = classified.filter(c => !c.skip).length;
const logicalTotal = logical.size;
const scaffoldCount = classified.filter(c => c.source === 'scaffold').length;
const mirrorCount = classified.filter(c => c.source === 'ide-mirror').length;
const cacheCount = classified.filter(c => c.source === 'plugin-cache').length;

const reportJson = {
  generated_at: new Date().toISOString(),
  counts: {
    skill_md_files_found: allFiles.length,
    logical_skills: logicalTotal,
    raw_non_skipped: rawTotal,
    scaffold_skipped: scaffoldCount,
    ide_mirror_skipped: mirrorCount,
    plugin_cache_skipped: cacheCount,
    unique_invoked: uniqueInvoked,
    total_invocations: totalInvocations,
  },
  utilization_pct: +(invokedLogical.size / logicalTotal * 100).toFixed(2),
  invoked_logical_count: invokedLogical.size,
  invoked_commands: Array.from(invokedCommands),
  command_count: commandNames.size,
  unmatched_invocations: unmatchedInvocations,
  top_invoked: Object.entries(invocCount).sort((a, b) => b[1] - a[1]).slice(0, 20),
  never_invoked_user_installed: classified
    .filter(c => c.source === 'user-installed')
    .filter(c => !invokedLogical.has(c.logical_id))
    .map(c => ({ id: c.logical_id, path: c.path })),
};

if (JSON_OUT) {
  console.log(JSON.stringify(reportJson, null, 2));
  process.exit(0);
}

console.log('# Skill Utilization Report');
console.log('');
console.log(`Generated: ${reportJson.generated_at}`);
console.log('');
console.log('## Counts');
console.log('');
console.log('| Metric | Value |');
console.log('|---|---|');
console.log(`| SKILL.md files on disk (raw) | ${reportJson.counts.skill_md_files_found} |`);
console.log(`| Logical skills (after dedupe) | **${reportJson.counts.logical_skills}** |`);
console.log(`| Unique invoked (26d window) | **${reportJson.counts.unique_invoked}** |`);
console.log(`| Total invocations | ${reportJson.counts.total_invocations} |`);
console.log(`| Utilization | **${reportJson.utilization_pct}%** |`);
console.log('');
console.log('Skipped (not invocable):');
console.log(`- Scaffold SKILL.md (agent-harness internals): ${reportJson.counts.scaffold_skipped}`);
console.log(`- IDE-mirror SKILL.md (.cursor/.gemini/.opencode/ etc.): ${reportJson.counts.ide_mirror_skipped}`);
console.log(`- Plugin-cache SKILL.md (duplicate of marketplace version): ${reportJson.counts.plugin_cache_skipped}`);
console.log('');
console.log('## Top 20 invoked');
console.log('');
for (const [name, count] of reportJson.top_invoked) {
  console.log(`- ${count.toString().padStart(4)} ${name}`);
}
console.log('');
console.log('## Never-invoked user-installed (triage candidates)');
console.log('');
if (reportJson.never_invoked_user_installed.length === 0) {
  console.log('_all user-installed skills have been invoked at least once_');
} else {
  for (const s of reportJson.never_invoked_user_installed.slice(0, 30)) {
    console.log(`- \`${s.id}\` — ${s.path.replace(HOME, '~')}`);
  }
  if (reportJson.never_invoked_user_installed.length > 30) {
    console.log(`- ... ${reportJson.never_invoked_user_installed.length - 30} more`);
  }
}
console.log('');
console.log('## Decision surface (user)');
console.log('');
console.log('- KEEP if skill was not invoked because its trigger conditions never occurred in 26d (e.g. `security-review` fires on specific prompts).');
console.log('- TRIAGE if description is vague — rewrite to improve semantic matching.');
console.log('- ARCHIVE if skill is genuinely unused. Move to `skills/.archive/<date>/`.');
console.log('');
console.log('Run with `--json` for machine-readable output.');
