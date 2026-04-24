#!/usr/bin/env node
// bump-version.mjs — semver bump from Conventional Commits since last tag.
//
// Scans commits in the repo at --path (default: cwd). Classifies each:
//   feat!… / BREAKING CHANGE:  → major
//   feat: / feat(xxx):         → minor
//   fix:  / fix(xxx):          → patch
//   anything else              → ignored
//
// Writes new version to ./VERSION and prepends a CHANGELOG.md section.
//
// Usage:
//   node bump-version.mjs                      # auto-bump from commits
//   node bump-version.mjs --set 0.2.0          # force a specific version
//   node bump-version.mjs --dry-run            # print + don't write
//   node bump-version.mjs --from <tag>         # override start tag
//   node bump-version.mjs --path <dir>         # operate in <dir>
//   node bump-version.mjs --stats-dir <dir>    # ship-stats source (default: --path)
//
// Exit: 0 success or no-op; 1 error; 2 bad args.

'use strict';

import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';

let DRY = false, FORCE = '', FROM = '', REPO = process.cwd(), STATS = '';
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--dry-run')           DRY = true;
  else if (a === '--set')          FORCE = args[++i];
  else if (a === '--from')         FROM  = args[++i];
  else if (a === '--path')         REPO  = args[++i];
  else if (a === '--stats-dir')    STATS = args[++i];
  else if (a === '-h' || a === '--help') {
    console.log(fs.readFileSync(new URL(import.meta.url), 'utf8')
      .split('\n').slice(1, 22).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    process.exit(0);
  } else {
    console.error(`unknown arg: ${a}`);
    process.exit(2);
  }
}

if (!fs.existsSync(path.join(REPO, '.git'))) {
  console.error(`not a git repo: ${REPO}`);
  process.exit(1);
}

function git(argv) {
  const r = cp.spawnSync('git', ['-C', REPO, ...argv], { encoding: 'utf8' });
  return { code: r.status ?? 1, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

// ── Current version ─────────────────────────────────────────────────────
let current;
const versionPath = path.join(REPO, 'VERSION');
if (fs.existsSync(versionPath)) {
  current = fs.readFileSync(versionPath, 'utf8').trim();
} else {
  const t = git(['describe', '--tags', '--abbrev=0']);
  current = t.code === 0 ? t.stdout.replace(/^v/, '') : '0.0.0';
}
if (!/^\d+\.\d+\.\d+$/.test(current)) {
  console.error(`invalid current version: ${current}`);
  process.exit(1);
}

let [MA, MI, PA] = current.split('.').map(Number);

// ── Bump selection ──────────────────────────────────────────────────────
let bump = 'none';
let newVer = current;
let range = 'HEAD';

if (FORCE) {
  newVer = FORCE;
  bump = 'forced';
} else {
  if (!FROM) {
    const t = git(['describe', '--tags', '--abbrev=0']);
    if (t.code === 0) FROM = t.stdout;
  }
  range = FROM ? `${FROM}..HEAD` : 'HEAD';

  const log = git(['log', range, '--format=%s%n%b%n--END--']);
  const lines = log.code === 0 ? log.stdout.split('\n') : [];

  let hasBreaking = false, hasFeat = false, hasFix = false;
  for (const line of lines) {
    if (/^feat!|^feat\([^)]+\)!|^fix!|^fix\([^)]+\)!|BREAKING CHANGE:/.test(line)) hasBreaking = true;
    else if (/^feat(\([^)]+\))?:/.test(line)) hasFeat = true;
    else if (/^fix(\([^)]+\))?:/.test(line))  hasFix  = true;
  }

  if (hasBreaking)   { bump = 'major'; MA += 1; MI = 0; PA = 0; }
  else if (hasFeat)  { bump = 'minor'; MI += 1; PA = 0; }
  else if (hasFix)   { bump = 'patch'; PA += 1; }
  newVer = `${MA}.${MI}.${PA}`;
}

// ── Ship stats ──────────────────────────────────────────────────────────
const statsRoot = STATS || REPO;

function countFiles(dir, maxDepth, matcher) {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  const walk = (p, depth) => {
    if (depth > maxDepth) return;
    for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
      const full = path.join(p, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.isFile() && matcher(entry.name)) n++;
    }
  };
  walk(dir, 1);
  return n;
}
const hookCount = countFiles(path.join(statsRoot, 'hooks'),     1, (n) => n.endsWith('.js'));
const libCount  = countFiles(path.join(statsRoot, 'hooks/lib'), 3, (n) => n.endsWith('.js'));
const shCount   = countFiles(path.join(statsRoot, 'scripts'),   1, (n) => n.endsWith('.sh'));
const ps1Count  = countFiles(path.join(statsRoot, 'scripts'),   1, (n) => n.endsWith('.ps1'));
const cmdCount  = countFiles(path.join(statsRoot, 'commands'),  1, (n) => n.endsWith('.md'));

// ── Changelog section ───────────────────────────────────────────────────
const today = new Date().toISOString().slice(0, 10);
let section =
`## [${newVer}] — ${today}
Bump: ${bump}

### Ship stats
- ${hookCount} hooks + ${libCount} lib files
- ${shCount} shell scripts + ${ps1Count} PowerShell parity
- ${cmdCount} slash commands
- MCP server: 14 tools, dependency-free

`;

function grouped(grep) {
  const r = git(['log', range, '--format=- %s', `--grep=${grep}`]);
  if (r.code !== 0) return '';
  return r.stdout.split('\n').filter((l) => l.startsWith('- ')).join('\n');
}

if (!FORCE && bump !== 'none') {
  const breakLines = grouped('^feat!\\|^fix!\\|BREAKING');
  const featLines  = grouped('^feat');
  const fixLines   = grouped('^fix');
  if (breakLines) section += `### Breaking\n${breakLines}\n\n`;
  if (featLines)  section += `### Added\n${featLines}\n\n`;
  if (fixLines)   section += `### Fixed\n${fixLines}\n\n`;
}

// ── Apply or dry-run ────────────────────────────────────────────────────
if (DRY) {
  console.log('── bump-version.mjs DRY RUN ──');
  console.log(`  current: ${current}`);
  console.log(`  bump:    ${bump}`);
  console.log(`  new:     ${newVer}`);
  console.log('');
  console.log('── CHANGELOG section that would be prepended ──');
  process.stdout.write(section);
  process.exit(0);
}

if (bump === 'none' && !FORCE) {
  console.log(`no feat/fix/breaking commits since ${FROM || 'beginning'} — nothing to bump.`);
  process.exit(0);
}

fs.writeFileSync(versionPath, newVer + '\n');

const changelogPath = path.join(REPO, 'CHANGELOG.md');
if (fs.existsSync(changelogPath)) {
  const existing = fs.readFileSync(changelogPath, 'utf8');
  const firstH2 = existing.indexOf('\n## ');
  if (firstH2 >= 0) {
    fs.writeFileSync(changelogPath,
      existing.slice(0, firstH2 + 1) + section + existing.slice(firstH2 + 1));
  } else {
    fs.writeFileSync(changelogPath, existing + '\n' + section);
  }
} else {
  fs.writeFileSync(changelogPath, `# Changelog\n\n${section}`);
}

console.log(`bumped: ${current} → ${newVer} (${bump})`);
console.log('  VERSION:   ./VERSION');
console.log('  CHANGELOG: ./CHANGELOG.md (prepended)');
console.log(`  next:      git add VERSION CHANGELOG.md && git commit -m 'chore(release): v${newVer}'`);
