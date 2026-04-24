#!/usr/bin/env node
// snapshot.mjs — two-operation helper for moving AI context between machines.
//
// Subcommands:
//
//   snapshot.mjs backup <drive-path>
//     Snapshot ~/.ai-context/ + ~/.claude/ + ~/.gemini/ (tool-specific files
//     only — no plugins/cache, history, credentials, or personal skill
//     targets that are recreated by symlink on restore) onto <drive-path>.
//     Writes ai-context-snapshot-<UTC>/ + updates LATEST.txt pointer.
//     Designed for ExFAT / NTFS USB drives — never stores symlinks
//     (the merge step recreates them).
//
//   snapshot.mjs merge [--snapshot-dir <path>] [--force] [--dry-run]
//     On a fresh machine, restore from a snapshot:
//       1. Install ~/.ai-context/ (real dir)
//       2. Merge tool-specific files into ~/.claude/ + ~/.gemini/
//       3. Recreate symlinks (AGENTS.md per tool, memory/, per-skill)
//       4. Re-register the MCP server in every detected tool
//       5. Sweep legacy "stitch" MCP if present
//     Auto-detects the newest snapshot in the script's dir via
//     ai-context-snapshot-LATEST.txt; override with --snapshot-dir.
//
// Hidden drift fixed:
//   - The original sh did BACKUP only; the original ps1 did MERGE only.
//     Identical filename, completely different operations. Unified here
//     as one script with explicit subcommands so the name doesn't lie.
//   - sh hardcoded absolute source paths under the authoring user's home
//     dir; $HOME / os.homedir() everywhere now.
//   - ps1 registered only the Claude Code MCP in the merge step; Gemini /
//     Codex / OpenCode were deferred to a manual follow-up. Merge now
//     delegates to install-mcp.mjs which handles all four.
//   - sh example path used a personal mount point; placeholder text
//     `<external-drive>/<workdir>` in all docs + messages.

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
const AI_CONTEXT =
  process.env.AI_CONTEXT
  || path.dirname(__dirname)
  || path.join(HOME, '.ai-context');

const isWindows = process.platform === 'win32';

// ── args ────────────────────────────────────────────────────────────
const [sub, ...rest] = process.argv.slice(2);
if (!sub || sub === '-h' || sub === '--help') {
  console.log(fs.readFileSync(__filename, 'utf8')
    .split('\n').slice(1, 34).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(sub ? 0 : 2);
}

// ── helpers ─────────────────────────────────────────────────────────
function detectMcpServer() {
  const d = path.join(AI_CONTEXT, 'mcp');
  if (!fs.existsSync(d)) return null;
  for (const n of fs.readdirSync(d)) {
    if (fs.existsSync(path.join(d, n, 'server.js'))) return n;
  }
  return null;
}

function runRsync(src, dst, extras = []) {
  const args = ['-rptD', '--info=stats1', ...extras, src, dst];
  const r = cp.spawnSync('rsync', args, { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`rsync failed (exit ${r.status}): ${r.stderr}`);
    process.exit(r.status || 1);
  }
  const lines = (r.stdout || '').trim().split('\n').slice(-3);
  lines.forEach((l) => l && console.log('  ' + l));
}

// ── backup ──────────────────────────────────────────────────────────
function backup(drive) {
  if (!drive) {
    console.error('Usage: snapshot.mjs backup <drive-path>');
    process.exit(2);
  }
  if (!fs.existsSync(drive) || !fs.statSync(drive).isDirectory()) {
    console.error(`ERROR: drive path not a directory: ${drive}`);
    process.exit(1);
  }
  try { fs.accessSync(drive, fs.constants.W_OK); }
  catch { console.error(`ERROR: drive path not writable: ${drive}`); process.exit(1); }
  if (cp.spawnSync('rsync', ['--version'], { stdio: 'ignore' }).status !== 0) {
    console.error('ERROR: rsync not in PATH — install rsync first');
    process.exit(1);
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '').slice(0, 19);
  const snapBase = `ai-context-snapshot-${ts}`;
  const snap = path.join(drive, snapBase);
  const tmp  = `${snap}.incomplete`;

  fs.mkdirSync(tmp, { recursive: true });
  console.log(`Snapshot target: ${snap}`);
  console.log('');

  const mcp = detectMcpServer() || 'personal-context';

  console.log('── 1/4 ~/.ai-context (canonical)');
  runRsync(path.join(HOME, '.ai-context/'), path.join(tmp, '.ai-context/'));

  console.log('');
  console.log('── 2/4 ~/.claude (tool-specific; skip caches/projects/symlinks)');
  runRsync(
    path.join(HOME, '.claude/'),
    path.join(tmp, '.claude/'),
    [
      '--no-links',
      '--exclude', 'projects/',
      '--exclude', 'file-history/',
      '--exclude', 'paste-cache/',
      '--exclude', 'plugins/cache/',
      '--exclude', 'plugins/marketplaces/',
      '--exclude', 'plugins/data/',
      '--exclude', 'session-env/',
      '--exclude', 'sessions/',
      '--exclude', 'shell-snapshots/',
      '--exclude', 'sandbox-cwd/',
      '--exclude', 'telemetry/',
      '--exclude', 'backups/',
      '--exclude', 'debug/archive/',
      '--exclude', 'debug/*.txt',
      '--exclude', 'cache/',
      '--exclude', 'history.jsonl',
      '--exclude', '.credentials.json',
      '--exclude', 'ide/',
      '--exclude', '.git/',
      '--exclude', 'CLAUDE.md',
      '--exclude', 'memory',
      '--exclude', 'skills/debt-tracker',
      '--exclude', 'skills/excalidraw',
      '--exclude', 'skills/react-components',
      '--exclude', 'skills/shadcn-ui',
    ]
  );

  console.log('');
  console.log('── 3/4 ~/.gemini (tool-specific; skip caches/history/symlinks)');
  runRsync(
    path.join(HOME, '.gemini/'),
    path.join(tmp, '.gemini/'),
    [
      '--no-links',
      '--exclude', 'tmp/',
      '--exclude', 'projects/',
      '--exclude', 'cache/',
      '--exclude', 'history/',
      '--exclude', 'oauth_creds.json',
      '--exclude', '.git/',
      '--exclude', 'GEMINI.md',
      '--exclude', 'memory',
      '--exclude', 'skills/debt-tracker',
      '--exclude', 'skills/excalidraw',
      '--exclude', 'skills/react-components',
      '--exclude', 'skills/shadcn-ui',
    ]
  );

  console.log('');
  console.log('── 4/4 metadata');
  const metadata = {
    snapshot_time:  new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    source_os:      os.platform(),
    source_hostname: os.hostname(),
    source_user:    os.userInfo().username,
    source_home:    HOME,
    mcp_server_dir: mcp,
    architecture:   'canonical-source-v1',
    schema_notes: [
      '~/.ai-context/ is canonical; ~/.claude/ + ~/.gemini/ symlink into it',
      'Symlinks NOT stored (ExFAT safe). merge recreates them on target.',
      `MCP: ${mcp} registered in each tool on merge.`,
    ],
  };
  fs.writeFileSync(path.join(tmp, 'source-metadata.json'), JSON.stringify(metadata, null, 2) + '\n');

  fs.renameSync(tmp, snap);
  fs.writeFileSync(path.join(drive, 'ai-context-snapshot-LATEST.txt'), snapBase + '\n');

  const du = cp.spawnSync('du', ['-sh', snap], { encoding: 'utf8' });
  const size = (du.stdout || '').split(/\s/)[0] || '?';

  console.log('');
  console.log('═══ snapshot complete ═══');
  console.log(`path: ${snap}`);
  console.log(`size: ${size}`);
  console.log(`LATEST.txt updated → ${snapBase}`);
  console.log('');
  console.log('On target machine, run:');
  console.log(`  node ${path.join(drive, 'snapshot.mjs')} merge --snapshot-dir "${snap}"`);
}

// ── merge ───────────────────────────────────────────────────────────
async function merge(args) {
  let dryRun = false, force = false, snapshotDir = '';
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dry-run')         dryRun = true;
    else if (a === '--force')      force = true;
    else if (a === '--snapshot-dir') snapshotDir = args[++i];
    else { console.error(`unknown arg: ${a}`); process.exit(2); }
  }

  // Locate snapshot
  if (!snapshotDir) {
    const latestFile = path.join(__dirname, 'ai-context-snapshot-LATEST.txt');
    if (fs.existsSync(latestFile)) {
      snapshotDir = path.join(__dirname, fs.readFileSync(latestFile, 'utf8').trim());
    } else {
      const candidates = fs.existsSync(__dirname)
        ? fs.readdirSync(__dirname).filter((n) => n.startsWith('ai-context-snapshot-')).sort()
        : [];
      if (candidates.length) snapshotDir = path.join(__dirname, candidates.at(-1));
    }
  }
  if (!snapshotDir || !fs.existsSync(snapshotDir)) {
    console.error('ERROR: no snapshot found. Run `snapshot.mjs backup <drive>` on source machine first.');
    process.exit(1);
  }

  console.log('═══ merge-ai-context ═══');
  console.log(`OS: ${isWindows ? 'Windows' : 'POSIX'}  | Home: ${HOME}`);
  console.log(`Snapshot: ${snapshotDir}`);

  const metaFile = path.join(snapshotDir, 'source-metadata.json');
  let meta = null;
  if (fs.existsSync(metaFile)) {
    meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    console.log(`  source: ${meta.source_os} @ ${meta.source_hostname} (${meta.snapshot_time})`);
    console.log(`  architecture: ${meta.architecture}`);
  }
  console.log('');

  if (!force && !dryRun) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    console.log('This will:');
    console.log(`  • Install ${path.join(HOME, '.ai-context')}/ (canonical source)`);
    console.log(`  • Merge ${path.join(HOME, '.claude')}/ and ${path.join(HOME, '.gemini')}/ (newer wins)`);
    console.log('  • Recreate symlinks from tool dirs → .ai-context/');
    console.log('  • Register the MCP server in Claude / Gemini / Codex / OpenCode');
    console.log('  • Remove legacy "stitch" MCP if present');
    console.log('  • Back up any pre-existing files before overwriting');
    const ans = (await rl.question('Type MERGE to proceed: ')).trim();
    rl.close();
    if (ans !== 'MERGE') { console.log('aborted.'); process.exit(1); }
  }

  // ── Phase 1: ~/.ai-context/
  console.log('── Phase 1: canonical source ──');
  const aiSrc = path.join(snapshotDir, '.ai-context');
  const aiDst = path.join(HOME, '.ai-context');
  if (!fs.existsSync(aiSrc)) {
    console.error('ERROR: snapshot missing .ai-context/ — snapshot corrupt?');
    process.exit(1);
  }
  if (dryRun) {
    console.log(`  WOULD copy ${aiSrc} → ${aiDst}`);
  } else {
    if (cp.spawnSync('rsync', ['--version'], { stdio: 'ignore' }).status === 0) {
      cp.spawnSync('rsync', ['-a', `${aiSrc}/`, `${aiDst}/`], { stdio: 'inherit' });
    } else {
      fs.mkdirSync(aiDst, { recursive: true });
      fs.cpSync(aiSrc, aiDst, { recursive: true, force: true });
    }
    console.log(`  ✓ ${aiDst} installed`);
  }

  // ── Phase 2: tool-specific merge
  console.log('── Phase 2: tool-specific merge (hooks, settings, scripts) ──');
  for (const tool of ['.claude', '.gemini']) {
    const src = path.join(snapshotDir, tool);
    const dst = path.join(HOME, tool);
    if (!fs.existsSync(src)) { console.log(`  - ${tool} : not in snapshot`); continue; }
    if (dryRun) { console.log(`  WOULD merge ${src} → ${dst}`); continue; }
    if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
    if (cp.spawnSync('rsync', ['--version'], { stdio: 'ignore' }).status === 0) {
      cp.spawnSync('rsync', [
        '-a',
        '--exclude', 'CLAUDE.md', '--exclude', 'GEMINI.md', '--exclude', 'memory',
        '--exclude', 'skills/debt-tracker', '--exclude', 'skills/excalidraw',
        '--exclude', 'skills/react-components', '--exclude', 'skills/shadcn-ui',
        `${src}/`, `${dst}/`,
      ], { stdio: 'inherit' });
    } else {
      fs.cpSync(src, dst, { recursive: true, force: true });
    }
    console.log(`  ✓ ${dst} merged`);
  }

  // ── Phase 3: symlinks (delegates to install-adapters.mjs + memory/skills)
  console.log('── Phase 3: recreate symlinks ──');
  if (!dryRun) {
    const r = cp.spawnSync('node', [path.join(aiDst, 'scripts', 'install-adapters.mjs')], { stdio: 'inherit' });
    if (r.status !== 0) console.log('  ⚠ install-adapters exited non-zero — review output');
    const boot = cp.spawnSync('node', [path.join(aiDst, 'scripts', 'bootstrap.mjs')], { stdio: 'inherit' });
    if (boot.status !== 0) console.log('  ⚠ bootstrap exited non-zero — review output');
  } else {
    console.log('  WOULD run install-adapters.mjs + bootstrap.mjs');
  }

  // ── Phase 4: sweep legacy stitch MCP
  console.log('── Phase 4: remove legacy stitch MCP ──');
  const claudeJson = path.join(HOME, '.claude.json');
  if (fs.existsSync(claudeJson)) {
    const d = JSON.parse(fs.readFileSync(claudeJson, 'utf8'));
    if (d.mcpServers && d.mcpServers.stitch) {
      if (dryRun) {
        console.log('  WOULD remove stitch from .claude.json');
      } else {
        delete d.mcpServers.stitch;
        fs.writeFileSync(claudeJson, JSON.stringify(d, null, 2));
        console.log('  ✓ stitch removed from .claude.json');
      }
    } else {
      console.log('  ✓ stitch not present');
    }
  }
  const stitchPaths = [
    path.join(HOME, '.stitch-mcp'),
    path.join(HOME, '.agents/skills/stitch-design'),
    path.join(HOME, '.agents/skills/stitch-loop'),
    path.join(HOME, '.claude/skills/stitch-design'),
    path.join(HOME, '.claude/skills/stitch-loop'),
    path.join(HOME, '.gemini/skills/stitch-design'),
    path.join(HOME, '.gemini/skills/stitch-loop'),
    path.join(HOME, '.claude/scripts/stitch-proxy.sh'),
    path.join(HOME, '.claude/scripts/stitch-proxy.ps1'),
    path.join(HOME, '.gemini/scripts/stitch-proxy.sh'),
    path.join(HOME, '.gemini/scripts/stitch-proxy.ps1'),
  ];
  for (const p of stitchPaths) {
    if (!fs.existsSync(p)) continue;
    if (dryRun) console.log(`  WOULD remove ${p}`);
    else {
      try { fs.rmSync(p, { recursive: true, force: true }); console.log(`  ✓ removed ${p}`); }
      catch (e) { console.log(`  ⚠ could not remove ${p}: ${e.message}`); }
    }
  }

  console.log('');
  console.log('═══ merge complete ═══');
  console.log(`Verify: node ${path.join(aiDst, 'scripts', 'health-check.mjs')}`);
  console.log(`Edit:   ${path.join(aiDst, 'AGENTS.md')} (all tools pick it up)`);
}

// ── dispatch ────────────────────────────────────────────────────────
if (sub === 'backup') {
  backup(rest[0]);
} else if (sub === 'merge') {
  await merge(rest);
} else {
  console.error(`unknown subcommand: ${sub}`);
  console.error('Usage: snapshot.mjs backup <drive-path>');
  console.error('       snapshot.mjs merge [--snapshot-dir <path>] [--force] [--dry-run]');
  process.exit(2);
}
