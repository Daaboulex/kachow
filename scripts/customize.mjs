#!/usr/bin/env node
// customize.mjs — interactive first-install onboarding for kachow.
//
// What it does:
//   1. Asks name + git email (pre-fill from git config if available)
//   2. Substitutes <owner> / <repo-name> in LICENSE + README.md
//   3. Writes a starter USER SECTION into AGENTS.md
//   4. Asks which AI tools to wire (Claude / Gemini / Codex / OpenCode / Aider)
//   5. Asks about optional add-ons (NixOS / embedded / Python)
//   6. Copies settings templates into each selected tool
//   7. Runs bootstrap.mjs (install-adapters + install-mcp + health-check)
//
// Safe to re-run — idempotent where possible; existing settings are kept.
//
// Hidden drift fixed:
//   - sh showed add-on permission hints (WebFetch domains, toolchains,
//     Python tooling); ps1 only showed the bare add-on name. Hints unified.
//   - sh surfaced `settings.<addon>.json.example` fragment paths after
//     add-on selection; ps1 did not. Unified.
//   - sh auto-detected Aider via `$HOME/.config/aider` OR `command -v aider`;
//     ps1 only checked the path. Unified.
//   - Canonical path resolution: both used env $AI or $HOME/.ai-context.
//     The .mjs also falls back to the script's parent dir (matches
//     bootstrap.mjs / self-update.mjs conventions).

'use strict';

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import cp from 'node:child_process';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const HOME       = os.homedir();
const AI =
  process.env.AI
  || path.dirname(__dirname)
  || path.join(HOME, '.ai-context');

if (!fs.existsSync(AI)) {
  console.error(`ERROR: ${AI} not found — clone first`);
  process.exit(1);
}
process.chdir(AI);

// ── Colors (ANSI; auto-skip on non-TTY) ─────────────────────────────────
const tty = process.stderr.isTTY;
const C = {
  bold:   (s) => tty ? `\x1b[1m${s}\x1b[0m`  : s,
  dim:    (s) => tty ? `\x1b[2m${s}\x1b[0m`  : s,
  green:  (s) => tty ? `\x1b[32m${s}\x1b[0m` : s,
  yellow: (s) => tty ? `\x1b[33m${s}\x1b[0m` : s,
  cyan:   (s) => tty ? `\x1b[36m${s}\x1b[0m` : s,
};

const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
function say(msg)  { process.stderr.write(`\n${C.cyan(C.bold('=== ' + msg))}\n`); }
function ok(msg)   { process.stderr.write(`  ${C.green('✓')} ${msg}\n`); }
async function ask(prompt) {
  const a = await rl.question(`${C.yellow('? ')}${prompt} `);
  return a.trim();
}
async function confirm(prompt, def = 'N') {
  const hint = def === 'Y' ? '[Y/n]' : '[y/N]';
  const a = (await rl.question(`${C.yellow('? ')}${prompt} ${hint} `)).trim() || def;
  return /^(y|yes)$/i.test(a);
}

// ── Splash ──────────────────────────────────────────────────────────────
console.log(`
   _  __           _
  | |/ /__ _   ___| |__   _____      __
  | ' // _\` | / __| '_ \\ / _ \\ \\ /\\ / /
  | . \\ (_| || (__| | | | (_) \\ V  V /
  |_|\\_\\__,_| \\___|_| |_|\\___/ \\_/\\_/
                          K A - C H O W !

  Once-setup for the hook + MCP framework. ~2 minutes.
`);

function gitConfigGet(key) {
  const r = cp.spawnSync('git', ['config', '--get', key], { encoding: 'utf8' });
  return r.status === 0 ? (r.stdout || '').trim() : '';
}

try {
  // ── 1. Identity ──────────────────────────────────────────────────────
  say('Identity');
  const gitName  = gitConfigGet('user.name');
  const gitEmail = gitConfigGet('user.email');
  if (gitName)  process.stderr.write(`  ${C.dim('detected git name:')}  ${gitName}\n`);
  if (gitEmail) process.stderr.write(`  ${C.dim('detected git email:')} ${gitEmail}\n`);

  let yourName  = await ask('Your name');
  yourName  = yourName  || gitName  || '<your-name>';
  let yourEmail = await ask('Your git email');
  yourEmail = yourEmail || gitEmail || '<your-email>';
  const yourRole = await ask("One-line 'who you are' (skip with Enter)");
  ok(`Identity captured: ${yourName} <${yourEmail}>`);

  // ── 2. LICENSE + README substitutions ────────────────────────────────
  say('Substitute placeholders in LICENSE / README');
  if (fs.existsSync('LICENSE')) {
    const text = fs.readFileSync('LICENSE', 'utf8');
    fs.writeFileSync('LICENSE', text.replace(/<owner>/g, yourName));
    ok(`LICENSE copyright → ${yourName}`);
  }
  if (fs.existsSync('README.md')) {
    const defaultRepo = 'kachow-fork';
    const raw = await ask(`Repo name for this fork (default: ${defaultRepo})`);
    const repoName = raw || defaultRepo;
    const text = fs.readFileSync('README.md', 'utf8')
      .replace(/<owner>/g, yourName)
      .replace(/<repo-name>/g, repoName);
    fs.writeFileSync('README.md', text);
    ok(`README → ${yourName}/${repoName}`);
  }

  // ── 3. USER SECTION in AGENTS.md ─────────────────────────────────────
  say('Write your USER SECTION in AGENTS.md');
  if (fs.existsSync('AGENTS.md')) {
    const agents = fs.readFileSync('AGENTS.md', 'utf8');
    if (/USER SECTION/.test(agents)) {
      if (await confirm('write starter identity block into USER SECTION?', 'Y')) {
        const roleLine = yourRole ? `\n- Role: ${yourRole}` : '';
        const block =
`## My additions

- Name: ${yourName}
- Email: ${yourEmail}${roleLine}
- Customize any rules below. Framework updates leave this block alone.
`;
        const re = /(USER SECTION — keep[^\n]*-->\s*)(?:[\s\S]*?)(<!-- END USER SECTION)/;
        const replaced = agents.replace(re, `$1\n${block}\n$2`);
        if (replaced !== agents) {
          fs.writeFileSync('AGENTS.md', replaced);
          ok('USER SECTION populated');
        }
      }
    }
  }

  // ── 4. AI tool selection ─────────────────────────────────────────────
  say('Which AI tools should I wire?');
  const TOOLS = [
    { key: 'claude',   label: 'Claude Code (~/.claude)',           probe: () => fs.existsSync(path.join(HOME, '.claude')) },
    { key: 'gemini',   label: 'Gemini CLI (~/.gemini)',            probe: () => fs.existsSync(path.join(HOME, '.gemini')) },
    { key: 'codex',    label: 'Codex CLI (~/.codex)',              probe: () => fs.existsSync(path.join(HOME, '.codex')) },
    { key: 'opencode', label: 'OpenCode (~/.config/opencode)',     probe: () => fs.existsSync(path.join(HOME, '.config/opencode')) },
    { key: 'aider',    label: 'Aider (~/.config/aider)',           probe: () => fs.existsSync(path.join(HOME, '.config/aider')) || !!cp.spawnSync('aider', ['--version'], { stdio: 'ignore' }).status === 0 },
  ];
  const selected = [];
  for (const t of TOOLS) {
    const installed = t.probe() ? C.green('[installed]') : '';
    const def = installed ? 'Y' : 'N';
    if (await confirm(`  wire ${t.label} ${installed}`, def)) selected.push(t.key);
  }
  ok(`Selected: ${selected.join(' ') || 'none'}`);

  // ── 5. Optional add-ons ──────────────────────────────────────────────
  say('Optional add-ons');
  const addons = [];
  if (await confirm('NixOS flake support (WebFetch nixos.org/nix.dev permissions)')) addons.push('nixos');
  if (await confirm('Embedded / firmware (arm-none-eabi + pio + platformio permissions)')) addons.push('embedded');
  if (await confirm('Python stack (pytest + uv + ruff + mypy permissions)')) addons.push('python');
  ok(`Add-ons: ${addons.join(' ') || 'none'}`);

  // ── 6. Settings templates ────────────────────────────────────────────
  say('Apply settings template + add-ons');
  for (const tool of selected) {
    if (tool === 'claude') {
      const src = path.join(AI, 'settings.template.json');
      const dst = path.join(HOME, '.claude', 'settings.json');
      if (fs.existsSync(src)) {
        if (fs.existsSync(dst)) {
          ok(`existing ${dst} — NOT overwritten (merge manually)`);
        } else {
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          fs.copyFileSync(src, dst);
          ok(`installed ${dst}`);
        }
      }
    } else if (tool === 'gemini') {
      const src = path.join(AI, 'settings.gemini.template.json');
      const dst = path.join(HOME, '.gemini', 'settings.json');
      if (fs.existsSync(src)) {
        if (fs.existsSync(dst)) {
          ok(`existing ${dst} — NOT overwritten`);
        } else {
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          fs.copyFileSync(src, dst);
          ok(`installed ${dst}`);
        }
      }
    }
  }
  for (const a of addons) {
    const frag = path.join(AI, `settings.${a}.json.example`);
    if (fs.existsSync(frag)) ok(`add-on fragment available: ${frag} (merge manually into your settings)`);
  }

  // ── 7. Bootstrap ─────────────────────────────────────────────────────
  say('Run bootstrap (install-adapters + install-mcp + health-check)');
  if (await confirm('run bootstrap.mjs now?', 'Y')) {
    const r = cp.spawnSync('node', [path.join(AI, 'scripts', 'bootstrap.mjs')], { stdio: 'inherit' });
    if (r.status !== 0) {
      process.stderr.write(`\n${C.yellow('✗ bootstrap reported issues — review output above.')}\n`);
      process.exit(1);
    }
    ok('bootstrap complete');
  }

  console.log(`\n${C.green(C.bold('Ka-chow! Setup complete.'))}`);
  console.log(`  Next: edit your USER SECTION in ${path.join(AI, 'AGENTS.md')} to fine-tune rules.`);
  console.log(`  Verify:  node ${path.join(AI, 'scripts', 'health-check.mjs')}`);
} finally {
  rl.close();
}
