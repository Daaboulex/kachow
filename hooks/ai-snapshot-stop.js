#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// Stop hook: snapshot ~/.claude and ~/.gemini to SSD if present + cooldown met.
// Cross-platform: detects SSD via mount paths on Linux/macOS/Windows.
// Cooldown: 7 days (configurable via .ai-snapshot-cooldown-days).
// Safe: never blocks session, never errors loud, only runs if SSD writable.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawn } = require('child_process');

const home = os.homedir();
const STATE_FILE = path.join(home, '.claude', '.ai-snapshot-last');
const COOLDOWN_DAYS = 7;
const COOLDOWN_MS = COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

// Cooldown check
let lastTime = 0;
try { lastTime = fs.statSync(STATE_FILE).mtimeMs; } catch {}
if ((Date.now() - lastTime) < COOLDOWN_MS) {
  process.stdout.write('{"continue":true}');
  process.exit(0);
}

// Detect SSD path — prefer developer.json (per-machine config), fallback to hardcoded list
// developer.json lives at <project>/Portable-Builder/developer.json
// machines[hostname].remotes.ssd = "<ssd-root>/Git Server/<repo>.git"
// machines[hostname].backup.backupFolder = folder under <ssd-root>
function findDeveloperJson(startDir) {
  let dir = startDir;
  const root = path.parse(dir).root;
  while (dir && dir !== root) {
    const candidate = path.join(dir, 'Portable-Builder', 'developer.json');
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {}
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Also check env var override
  if (process.env.FAHLKE_DEVELOPER_JSON && fs.existsSync(process.env.FAHLKE_DEVELOPER_JSON)) {
    return process.env.FAHLKE_DEVELOPER_JSON;
  }
  return null;
}

function ssdFromDeveloperJson() {
  try {
    const cwd = process.env.PWD || process.cwd();
    const devJson = findDeveloperJson(cwd) || findDeveloperJson(home);
    if (!devJson) return null;
    const data = JSON.parse(fs.readFileSync(devJson, 'utf8'));
    const hostname = os.hostname();
    const machine = data.machines && data.machines[hostname];
    if (!machine || !machine.remotes || !machine.remotes.ssd) return null;
    const ssdRemote = machine.remotes.ssd;
    // Strip "/Git Server/<repo>.git" suffix → parent dir of Git Server
    // e.g. "I:\\Work\\Git Server\\project-firmware.git" → "I:\\Work"
    const ssdRoot = path.dirname(path.dirname(ssdRemote));
    const folder = (machine.backup && machine.backup.backupFolder) || 'AI-Snapshots';
    return path.join(ssdRoot, folder);
  } catch { return null; }
}

const SSD_CANDIDATES = [
  // Linux
  '/run/media/user/LaCie/Work/Stephan\'s Playground',
  '/media/user/LaCie/Work/Stephan\'s Playground',
  '/mnt/LaCie/Work/Stephan\'s Playground',
  // macOS
  '/Volumes/LaCie/Work/Stephan\'s Playground',
  // Windows (paths Node sees from native or WSL)
  'E:\\Work\\Stephan\'s Playground',
  'F:\\Work\\Stephan\'s Playground',
  'I:\\Work\\Stephan\'s Playground',
  '/mnt/e/Work/Stephan\'s Playground',
  '/mnt/f/Work/Stephan\'s Playground',
  '/mnt/i/Work/Stephan\'s Playground',
];

let ssdPath = ssdFromDeveloperJson();
if (ssdPath) {
  // Verify writable; if not, fall back to candidates
  try {
    fs.mkdirSync(ssdPath, { recursive: true });
    fs.accessSync(ssdPath, fs.constants.W_OK);
  } catch { ssdPath = null; }
}
if (!ssdPath) {
  for (const p of SSD_CANDIDATES) {
    try { fs.accessSync(p, fs.constants.W_OK); ssdPath = p; break; } catch {}
  }
}
if (!ssdPath) {
  try {
    require('./lib/observability-logger.js').logEvent(process.cwd(), {
      type: 'ai_snapshot_skipped_no_ssd',
      source: 'ai-snapshot-stop',
      meta: { hostname: os.hostname(), platform: os.platform() }
    });
  } catch {}
  process.stdout.write('{"continue":true}');
  process.exit(0);
}

// Build snapshot dir name
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const snapDir = path.join(ssdPath, `AI-context_${ts}`);

// Run rsync (Linux/macOS/WSL) or robocopy (Windows native)
const isWindows = os.platform() === 'win32';
const sources = [
  path.join(home, '.claude'),
  path.join(home, '.gemini'),
];

// Spawn detached so session can end while snapshot continues
function snapshot() {
  try {
    fs.mkdirSync(snapDir, { recursive: true });
    if (isWindows) {
      for (const src of sources) {
        const dst = path.join(snapDir, path.basename(src));
        spawn('robocopy', [src, dst, '/E', '/MIR', '/R:1', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS',
          '/XD', 'debug', 'paste-cache', 'image-cache', 'tmp', 'statsig', 'telemetry', 'projects',
          '/XF', '.credentials.json', '.credentials.*'], { detached: true, stdio: 'ignore' }).unref();
      }
    } else {
      const args = [
        '-a', '--delete',
        '--exclude=debug/', '--exclude=paste-cache/', '--exclude=image-cache/',
        '--exclude=tmp/', '--exclude=statsig/', '--exclude=telemetry/',
        '--exclude=projects/*/tool-results/', '--exclude=projects/*/todos/',
        '--exclude=projects/*/shell-snapshots/',
        '--exclude=.credentials.json', '--exclude=.credentials.*',
        '--exclude=.skill-log-*.jsonl',
        ...sources, snapDir,
      ];
      spawn('rsync', args, { detached: true, stdio: 'ignore' }).unref();
    }
    // Update cooldown marker
    fs.writeFileSync(STATE_FILE, '');

    // Also clean old snapshots (keep last 4)
    setTimeout(() => {
      try {
        const dirs = fs.readdirSync(ssdPath)
          .filter(f => f.startsWith('AI-context_'))
          .sort()
          .reverse();
        for (const d of dirs.slice(4)) {
          spawn(isWindows ? 'cmd' : 'rm', isWindows ? ['/c', 'rmdir', '/s', '/q', path.join(ssdPath, d)] : ['-rf', path.join(ssdPath, d)], { detached: true, stdio: 'ignore' }).unref();
        }
      } catch {}
    }, 60000);

    try {
      require('./lib/observability-logger.js').logEvent(process.cwd(), {
        type: 'ai_snapshot_started',
        source: 'ai-snapshot-stop',
        meta: { ssdPath, snapDir, isWindows }
      });
    } catch {}

    return true;
  } catch (e) {
    try { process.stderr.write(`ai-snapshot-stop: ${e.message}\n`); } catch {}
    return false;
  }
}

const ok = snapshot();
const msg = ok
  ? `[ai-snapshot] Started background snapshot to ${ssdPath} (next in ${COOLDOWN_DAYS}d)`
  : `[ai-snapshot] Failed — see stderr`;
process.stdout.write(JSON.stringify({ continue: true, systemMessage: msg }));
