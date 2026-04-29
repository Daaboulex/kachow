#!/usr/bin/env node
// install-hooks.mjs — install kachow hooks into ~/.claude/hooks/ + ~/.gemini/hooks/
// (and Codex via separate wire-hook-codex.mjs).
//
// Replaces install-hooks.sh (Wave 7A.1 of MASTER cleanup 2026-04-29).
// Cross-platform: works on Linux/macOS/Windows wherever Node runs.
//
// Idempotent: existing hooks are overwritten; existing non-empty settings
// are preserved with a merge hint.

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, copyFileSync, chmodSync, appendFileSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();
const AI_CONTEXT = process.env.AI_CONTEXT || join(HOME, '.ai-context');

if (!existsSync(join(AI_CONTEXT, 'hooks'))) {
  console.error(`ERROR: ${AI_CONTEXT}/hooks missing`);
  process.exit(1);
}

const MANIFEST = join(AI_CONTEXT, '.install-manifest');
const ts = new Date().toISOString();
writeFileSync(MANIFEST,
  '# kachow install manifest — lines are absolute paths of installed files/symlinks\n' +
  `# Generated ${ts}\n`
);

function appendManifest(line) {
  appendFileSync(MANIFEST, line + '\n');
}

function copyDirRecursive(src, dst, manifestEach = true) {
  if (!existsSync(dst)) mkdirSync(dst, { recursive: true });
  for (const name of readdirSync(src)) {
    const s = join(src, name);
    const d = join(dst, name);
    const st = statSync(s);
    if (st.isDirectory()) {
      copyDirRecursive(s, d, manifestEach);
    } else if (st.isFile()) {
      copyFileSync(s, d);
      if (manifestEach) appendManifest(d);
    }
  }
}

function installHooksTo(toolDir, toolName) {
  if (!existsSync(toolDir)) {
    console.log(`  ~ ${toolName} dir not present, skipping`);
    return;
  }

  const hooksDst = join(toolDir, 'hooks');
  mkdirSync(hooksDst, { recursive: true });
  console.log(`  + ${toolName}: installing hooks → ${hooksDst}/`);

  // Top-level *.js files (flat, no subdirs)
  const hooksSrc = join(AI_CONTEXT, 'hooks');
  for (const name of readdirSync(hooksSrc)) {
    const s = join(hooksSrc, name);
    if (!statSync(s).isFile()) continue;
    if (!name.endsWith('.js')) continue;
    const d = join(hooksDst, name);
    copyFileSync(s, d);
    appendManifest(d);
  }

  // lib/ recursive
  const libSrc = join(hooksSrc, 'lib');
  if (existsSync(libSrc)) {
    copyDirRecursive(libSrc, join(hooksDst, 'lib'));
  }

  // tests/ recursive (chmod +x for .sh)
  const testsSrc = join(hooksSrc, 'tests');
  if (existsSync(testsSrc)) {
    copyDirRecursive(testsSrc, join(hooksDst, 'tests'));
    // chmod .sh files (no-op on Windows; Node ignores)
    const testsDst = join(hooksDst, 'tests');
    for (const name of readdirSync(testsDst)) {
      if (name.endsWith('.sh') || name.endsWith('.mjs')) {
        try { chmodSync(join(testsDst, name), 0o755); } catch {}
      }
    }
  }

  // Settings — seed from template only if missing/empty/{}
  const settings = join(toolDir, 'settings.json');
  // Pick the right template per tool (basename of toolDir)
  const isGemini = toolDir.endsWith('.gemini');
  const templateName = isGemini ? 'settings.gemini.template.json' : 'settings.template.json';
  const template = join(AI_CONTEXT, templateName);

  let needsSeed = false;
  if (!existsSync(settings)) needsSeed = true;
  else {
    try {
      const content = readFileSync(settings, 'utf8').trim();
      if (content === '' || content === '{}') needsSeed = true;
    } catch { needsSeed = true; }
  }

  if (needsSeed) {
    if (existsSync(template)) {
      const content = readFileSync(template, 'utf8').replace(/\$HOME/g, HOME);
      writeFileSync(settings, content);
      console.log(`    ✓ settings.json seeded from ${templateName}`);
      appendManifest(settings);
    }
  } else {
    const bytes = readFileSync(settings, 'utf8').length;
    console.log(`    ~ settings.json already exists (${bytes} bytes) — NOT overwritten`);
    console.log(`      (merge hooks block manually from ${template} if desired)`);
  }
}

installHooksTo(join(HOME, '.claude'), 'Claude Code');
installHooksTo(join(HOME, '.gemini'), 'Gemini CLI');

// Codex hooks: wired via separate wire-hook-codex.mjs (TOML config).
// Only wire if Codex is present.
const codexDir = join(HOME, '.codex');
if (existsSync(codexDir)) {
  console.log(`  ~ Codex CLI: hooks live in config.toml — see wire-hook-codex.mjs`);
}

console.log('');
console.log(`Hooks installed. Manifest: ${MANIFEST}`);
