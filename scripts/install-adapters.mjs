#!/usr/bin/env node
// Install / verify symlinks for every supported AI tool.
// Idempotent — safe to re-run.
//
// WHAT'S CANONICAL (in ~/.ai-context/):
//   AGENTS.md      — global instructions (symlinked as CLAUDE.md/GEMINI.md/AGENTS.md)
//   hooks/         — all hooks (dir-symlinked into tool dirs)
//   commands/      — user slash commands (dir-symlinked into Claude/Gemini)
//   skills/        — portable skills (dir-symlinked per-skill into tool skill dirs)
//   configs/       — all tool settings (file-symlinked into tool dirs)
//   memory/        — global memories (dir-symlinked into tool memory dirs)
//
// WHAT'S PLUGIN-MANAGED (per-tool, NOT centralized):
//   GSD skills/agents/commands — managed by GSD plugin
//   CE skills                  — managed by compound-engineering plugin
//   Tool-specific plugins      — Claude plugins/, Gemini extensions/
//
// WHAT'S TOOL-SPECIFIC (per-tool, by design):
//   plugins/, file-history/, caches, credentials, active-sessions.jsonl
//
// Symlink strategy:
//   Linux / macOS — always fs.symlinkSync.
//   Windows       — tries fs.symlinkSync ('file' type). If that fails (no
//                   Developer Mode + not elevated), falls back to copy mode.

'use strict';

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const HOME       = os.homedir();

const AI_CONTEXT =
  process.env.AI_CONTEXT
  || path.dirname(__dirname) // parent of scripts/ → canonical dir
  || path.join(HOME, '.ai-context');
const CANONICAL = path.join(AI_CONTEXT, 'AGENTS.md');

if (!fs.existsSync(CANONICAL)) {
  console.error(`ERROR: canonical source missing at ${CANONICAL}`);
  process.exit(1);
}

const CORE_TARGETS = [
  { label: 'claude',   dest: path.join(HOME, '.claude',          'CLAUDE.md') },
  { label: 'gemini',   dest: path.join(HOME, '.gemini',          'GEMINI.md') },
  { label: 'codex',    dest: path.join(HOME, '.codex',           'AGENTS.md') },
  { label: 'crush',    dest: path.join(HOME, '.crush',           'AGENTS.md') },
  { label: 'opencode', dest: path.join(HOME, '.config/opencode', 'AGENTS.md') },
  { label: 'aider',    dest: path.join(HOME, '.config/aider',    'AGENTS.md') },
];

// Extra symlinks for tools whose configs/hooks are centralized in ai-context
const EXTRA_SYMLINKS = [
  { label: 'claude-settings', src: path.join(AI_CONTEXT, 'configs', 'claude-settings.json'), dest: path.join(HOME, '.claude', 'settings.json') },
  { label: 'gemini-settings', src: path.join(AI_CONTEXT, 'configs', 'gemini-settings.json'), dest: path.join(HOME, '.gemini', 'settings.json') },
  { label: 'codex-config',    src: path.join(AI_CONTEXT, 'configs', 'codex-config.toml'),    dest: path.join(HOME, '.codex', 'config.toml') },
  { label: 'claude-commands',  src: path.join(AI_CONTEXT, 'commands'),                         dest: path.join(HOME, '.claude', 'commands') },
  { label: 'gemini-commands', src: path.join(AI_CONTEXT, 'commands'),                         dest: path.join(HOME, '.gemini', 'commands') },
  { label: 'crush-hooks',     src: path.join(AI_CONTEXT, 'hooks'),                           dest: path.join(HOME, '.crush', 'hooks') },
  { label: 'crush-config',    src: path.join(AI_CONTEXT, 'configs', 'crush.json'),            dest: path.join(HOME, '.config/crush', 'crush.json') },
  { label: 'opencode-config', src: path.join(AI_CONTEXT, 'configs', 'opencode.json'),         dest: path.join(HOME, '.config/opencode', 'config.json') },
];

const OPTIONAL_TARGETS = [
  { label: 'windsurf-global',
    dest: path.join(HOME, '.codeium/windsurf/memories', 'global_rules.md') },
];

const isWindows = process.platform === 'win32';

/** Detect whether we can create symlinks. Always true on POSIX; on Windows
 *  requires Developer Mode or admin. Returns 'symlink' or 'copy'. */
function probeSymlinkCapability() {
  if (!isWindows) return 'symlink';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-ctx-probe-'));
  try {
    const target = path.join(tmp, 'target.txt');
    fs.writeFileSync(target, 'x');
    const link = path.join(tmp, 'link.txt');
    try {
      fs.symlinkSync(target, link, 'file');
      return 'symlink';
    } catch {
      return 'copy';
    }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

const MODE = probeSymlinkCapability();
if (MODE === 'copy') {
  console.log('');
  console.log('⚠ Developer Mode not enabled (or not running elevated).');
  console.log('  Falling back to COPY mode: AGENTS.md is duplicated into each tool\'s dir.');
  console.log('  Downside: you must re-run this script after every canonical edit.');
  console.log('  Fix: Settings → Privacy & security → For developers → enable Developer Mode.');
  console.log('');
}

function install({ label, dest }) {
  const dir = path.dirname(dest);
  fs.mkdirSync(dir, { recursive: true });

  // HARD GUARD: never create a symlink to a non-existent target.
  if (!fs.existsSync(CANONICAL)) {
    console.error(`✗ ${label}: REFUSING — target does not exist: ${CANONICAL}`);
    return false;
  }

  let existing;
  try { existing = fs.lstatSync(dest); } catch { existing = null; }

  if (existing) {
    if (existing.isSymbolicLink()) {
      const current = fs.readlinkSync(dest);
      if (current === CANONICAL) {
        console.log(`✓ ${label}: already linked → ${CANONICAL}`);
        return true;
      }
      console.log(`↻ ${label}: replacing stale symlink (${current} → ${CANONICAL})`);
      fs.unlinkSync(dest);
    } else {
      const bak = `${dest}.pre-ai-context-bak-${Math.floor(Date.now() / 1000)}`;
      console.log(`↻ ${label}: backing up existing file to ${path.basename(bak)}`);
      fs.renameSync(dest, bak);
    }
  }

  if (MODE === 'symlink') {
    fs.symlinkSync(CANONICAL, dest, 'file');
    if (!fs.existsSync(dest)) {
      console.error(`✗ ${label}: SYMLINK CREATED BUT BROKEN — target resolved to nothing: ${dest}`);
      return false;
    }
    console.log(`+ ${label}: linked → ${CANONICAL}`);
  } else {
    fs.copyFileSync(CANONICAL, dest);
    console.log(`+ ${label}: copied from ${CANONICAL}  (COPY MODE — re-run this script after edits)`);
  }
  return true;
}

console.log('== Core AI tools ==');
for (const t of CORE_TARGETS) install(t);

console.log('');
console.log('== Optional tools (linked if dir exists) ==');
for (const t of OPTIONAL_TARGETS) {
  if (fs.existsSync(path.dirname(t.dest))) {
    install(t);
  } else {
    console.log(`- ${t.label}: skipped (dir not present: ${path.dirname(t.dest)})`);
  }
}

console.log('');
console.log('== Extra symlinks (configs + hooks centralized in ai-context) ==');
for (const { label, src, dest } of EXTRA_SYMLINKS) {
  const dir = path.dirname(dest);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(src)) {
    console.log(`- ${label}: skipped (source not present: ${src})`);
    continue;
  }
  let existing;
  try { existing = fs.lstatSync(dest); } catch { existing = null; }
  if (existing && existing.isSymbolicLink() && fs.readlinkSync(dest) === src) {
    console.log(`✓ ${label}: already linked → ${src}`);
    continue;
  }
  if (existing) {
    const bak = dest + '.bak-' + Date.now();
    fs.renameSync(dest, bak);
    console.log(`↻ ${label}: backed up existing to ${path.basename(bak)}`);
  }
  const type = fs.statSync(src).isDirectory() ? 'dir' : 'file';
  fs.symlinkSync(src, dest, type);
  console.log(`+ ${label}: linked → ${src}`);
}

// Portable skills: ~/.agents/skills/ is the cross-tool standard.
// Gemini, Codex, OpenCode auto-discover from ~/.agents/skills/.
// Claude needs per-skill symlinks (doesn't read ~/.agents/).
// Crush uses options.skills_paths in crush.json.
console.log('');
console.log('== Portable skills (cross-tool via ~/.agents/skills/) ==');
const agentsSkills = path.join(HOME, '.agents', 'skills');
const aiContextSkills = path.join(AI_CONTEXT, 'skills');

// ~/.ai-context/skills/ is canonical. ~/.agents/skills is a symlink to it.
// Gemini, Codex, Crush, OpenCode auto-discover from ~/.agents/skills/.
// DO NOT migrate files between these dirs — that creates circular symlinks.
if (fs.existsSync(agentsSkills)) {
  try {
    const st = fs.lstatSync(agentsSkills);
    if (st.isSymbolicLink() && fs.readlinkSync(agentsSkills) === aiContextSkills) {
      // Already correct symlink
    } else if (st.isSymbolicLink()) {
      // Wrong target — fix
      fs.unlinkSync(agentsSkills);
      fs.symlinkSync(aiContextSkills, agentsSkills);
      console.log(`↻ ~/.agents/skills: re-linked → ${aiContextSkills}`);
    }
    else if (st.isDirectory()) {
      // Real dir — replace with symlink to canonical source
      // Content already in ~/.ai-context/skills/ (synced by Syncthing)
      fs.rmSync(agentsSkills, { recursive: true });
      fs.symlinkSync(aiContextSkills, agentsSkills);
      console.log(`↻ ~/.agents/skills: replaced real dir with symlink → ${aiContextSkills}`);
    }
  } catch {}
} else {
  fs.mkdirSync(path.dirname(agentsSkills), { recursive: true });
  fs.symlinkSync(aiContextSkills, agentsSkills);
  console.log(`+ ~/.agents/skills: linked → ${aiContextSkills}`);
}

// Claude: create per-skill symlinks (only tool that doesn't read ~/.agents/)
const claudeSkills = path.join(HOME, '.claude', 'skills');
fs.mkdirSync(claudeSkills, { recursive: true });
let skillCount = 0;
for (const entry of fs.readdirSync(agentsSkills, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  skillCount++;
  const src = path.join(agentsSkills, entry.name);
  const dest = path.join(claudeSkills, entry.name);
  let existing;
  try { existing = fs.lstatSync(dest); } catch { existing = null; }
  if (existing && existing.isSymbolicLink() && fs.readlinkSync(dest) === src) continue;
  if (existing && existing.isSymbolicLink()) fs.unlinkSync(dest);
  if (existing && !existing.isSymbolicLink()) continue; // plugin-managed
  fs.symlinkSync(src, dest, 'dir');
  console.log(`+ claude/${entry.name}: linked → ${src}`);
}
console.log(`  ${skillCount} skills in ~/.agents/skills/ (auto-discovered by Gemini+Codex+OpenCode, symlinked for Claude)`);

// Convert canonical commands to Codex skill format
console.log('');
console.log('== Codex command skills ==');
try {
  const { execSync } = await import('node:child_process');
  const convertScript = path.join(AI_CONTEXT, 'scripts', 'convert-commands.mjs');
  if (fs.existsSync(convertScript) && fs.existsSync(path.join(HOME, '.codex', 'skills'))) {
    execSync(`node "${convertScript}" --codex-only --force`, { stdio: 'inherit', timeout: 15000 });
  } else {
    console.log('- skipped (no convert-commands.mjs or no .codex/skills/)');
  }
} catch (e) {
  console.log(`- codex command conversion: ${e.message}`);
}

console.log('');
console.log(`Done. Edit ${CANONICAL} and every tool picks up the change.`);
