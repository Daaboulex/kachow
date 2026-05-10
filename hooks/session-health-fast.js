#!/usr/bin/env node
// Phase 1 SessionStart: fast health checks (≤500ms budget)
// Runs FIRST (order 1) — validates critical invariants before context injection.

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const AI_CTX = path.join(HOME, '.ai-context');
const VERBOSE = process.env.AI_CONTEXT_STARTUP_VERBOSE === '1';

function passthrough() { process.stdout.write('{"continue":true}'); }

try {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }

  const blockers = [];
  const warnings = [];

  // ── 1. Critical symlink checks ──
  const symlinks = [
    // AGENTS.md symlinks — all 5 tools
    { path: path.join(HOME, '.claude', 'CLAUDE.md'), target: path.join(AI_CTX, 'AGENTS.md') },
    { path: path.join(HOME, '.gemini', 'GEMINI.md'), target: path.join(AI_CTX, 'AGENTS.md') },
    { path: path.join(HOME, '.codex', 'AGENTS.md'), target: path.join(AI_CTX, 'AGENTS.md') },
    { path: path.join(HOME, '.config', 'opencode', 'AGENTS.md'), target: path.join(AI_CTX, 'AGENTS.md') },
    // Hooks symlink
    { path: path.join(HOME, '.claude', 'hooks'), target: path.join(AI_CTX, 'hooks') },
    // Settings symlinks — all hookable tools
    { path: path.join(HOME, '.claude', 'settings.json'), target: path.join(AI_CTX, 'configs', 'claude-settings.json') },
    { path: path.join(HOME, '.gemini', 'settings.json'), target: path.join(AI_CTX, 'configs', 'gemini-settings.json') },
    { path: path.join(HOME, '.codex', 'config.toml'), target: path.join(AI_CTX, 'configs', 'codex-config.toml') },
  ];

  for (const s of symlinks) {
    try {
      if (!fs.existsSync(s.path)) continue;
      const stat = fs.lstatSync(s.path);
      if (!stat.isSymbolicLink()) {
        blockers.push(`BLOCKER: ${s.path} is NOT a symlink — run install-adapters`);
      } else {
        const actual = fs.readlinkSync(s.path);
        const resolved = path.resolve(path.dirname(s.path), actual);
        if (resolved !== s.target) {
          warnings.push(`[symlink] ${path.basename(s.path)} → wrong target: ${actual}`);
        }
      }
    } catch {}
  }

  // ── 1b. Auto-bootstrap if critical symlinks missing ──
  try {
    const agentsSkills = path.join(HOME, '.agents', 'skills');
    const claudeMd = path.join(HOME, '.claude', 'CLAUDE.md');
    const needsBootstrap = !fs.existsSync(agentsSkills) || !fs.existsSync(claudeMd);
    if (needsBootstrap) {
      const bootstrap = path.join(AI_CTX, 'scripts', 'bootstrap.mjs');
      if (fs.existsSync(bootstrap)) {
        try {
          require('child_process').execSync(`node "${bootstrap}"`, { timeout: 30000, stdio: 'pipe' });
          warnings.push('[bootstrap] auto-ran bootstrap.mjs — symlinks were missing');
        } catch (e) {
          warnings.push('[bootstrap] bootstrap.mjs failed: ' + (e.message || '').slice(0, 80));
        }
      }
    }
  } catch {}

  // ── 2. Settings freshness ──
  try {
    const manifestPath = path.join(AI_CTX, 'scripts', 'MANIFEST.yaml');
    const settingsPath = path.join(AI_CTX, 'configs', 'claude-settings.json');
    const mMtime = fs.statSync(manifestPath).mtimeMs;
    const sMtime = fs.statSync(settingsPath).mtimeMs;
    if (mMtime > sMtime + 5000) {
      warnings.push('[settings] MANIFEST.yaml newer than configs — run generate-settings.mjs --apply');
    }
  } catch {}

  // ── 3. MEMORY.md index health ──
  try {
    const memDir = path.join(AI_CTX, 'memory');
    const indexPath = path.join(memDir, 'MEMORY.md');
    if (fs.existsSync(indexPath)) {
      const indexContent = fs.readFileSync(indexPath, 'utf8');
      const indexedCount = (indexContent.match(/^- \[/gm) || []).length;
      const files = fs.readdirSync(memDir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md');
      const fileCount = files.length;
      if (fileCount > 0 && indexedCount / fileCount < 0.8) {
        warnings.push(`[memory] index drift: ${indexedCount} indexed / ${fileCount} files (${Math.round(indexedCount/fileCount*100)}%)`);
      }
    }
  } catch {}

  // ── 4. Stale git merge state ──
  try {
    const mergeHead = path.join(AI_CTX, '.git', 'MERGE_HEAD');
    if (fs.existsSync(mergeHead)) {
      warnings.push('[git] unresolved merge in ~/.ai-context — resolve before continuing');
    }
  } catch {}

  // ── 5. Rule-enforcement violations (last 24h) ──
  try {
    const logPath = path.join(AI_CTX, 'instances', 'rule-enforcement.jsonl');
    if (fs.existsSync(logPath)) {
      const cutoff = Date.now() - 24 * 3600000;
      const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
      let violations = 0;
      for (let i = lines.length - 1; i >= 0 && i >= lines.length - 200; i--) {
        try {
          const entry = JSON.parse(lines[i]);
          if (new Date(entry.timestamp).getTime() < cutoff) break;
          if (entry.warnings > 0) violations++;
        } catch {}
      }
      if (violations > 5) {
        warnings.push(`[model-policy] ${violations} agent dispatches without model: specification in last 24h`);
      }
    }
  } catch {}

  // ── 6. Plugin hook execute-bit repair (Syncthing strips +x) ──
  try {
    const pluginCache = path.join(HOME, '.claude', 'plugins', 'cache');
    if (fs.existsSync(pluginCache)) {
      const glob = require('child_process');
      const hookFiles = glob.execSync(
        `find ${pluginCache} -type f \\( -name "*.cmd" -o -name "*.sh" \\) ! -perm -111 2>/dev/null`,
        { encoding: 'utf8', timeout: 2000 }
      ).trim().split('\n').filter(Boolean);
      for (const f of hookFiles) {
        try { fs.chmodSync(f, 0o755); } catch {}
      }
      if (hookFiles.length > 0) {
        warnings.push(`[plugin-hooks] fixed +x on ${hookFiles.length} plugin hook file(s) (Syncthing strips execute bits)`);
      }
    }
  } catch {}

  // ── Output ──
  const all = [...blockers, ...warnings];
  if (all.length === 0) { passthrough(); process.exit(0); }

  const maxLines = VERBOSE ? 20 : 3;
  const shown = all.slice(0, maxLines);
  const suppressed = all.length - shown.length;
  let msg = shown.join('\n');
  if (suppressed > 0 && !VERBOSE) {
    msg += `\n(${suppressed} more — set AI_CONTEXT_STARTUP_VERBOSE=1 to see all)`;
  }

  process.stdout.write(JSON.stringify({
    continue: true,
    systemMessage: msg,
  }));
} catch (e) {
  passthrough();
}
