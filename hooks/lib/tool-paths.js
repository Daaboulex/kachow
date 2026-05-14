// tool-paths.js — single canonical import for all tool-aware paths.
// Every hook should use this instead of hardcoding .claude/.gemini paths.
// Adding tool N+1 = update tool-detect.js TOOL_DIRS; zero changes here.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { detectTool, toolHomeDir, toolCacheDir, TOOL_DIRS } = require('./tool-detect.js');

const HOME = os.homedir();
const AI_CONTEXT = path.join(HOME, '.ai-context');

// Detect once at module load
const _tool = detectTool();
const _configDir = toolHomeDir(_tool);
const _cacheDir = toolCacheDir(_tool);

module.exports = Object.freeze({
  // Which tool we are
  tool: _tool,

  // Core tool directories
  configDir: _configDir,
  cacheDir: _cacheDir,

  // State files (per-tool, per-machine)
  dreamCountFile:    path.join(_configDir, '.dream-session-count'),
  dreamLastFile:     path.join(_configDir, '.dream-last'),
  dreamLockFile:     path.join(_configDir, '.dream-lock'),
  reflectLastFile:   path.join(_configDir, '.reflect-last'),
  reflectEnabledFile: path.join(_configDir, '.reflect-enabled'),
  wrapUpDoneFile:    path.join(_configDir, '.wrapup-done'),
  autoPushLastFile:  path.join(AI_CONTEXT, '.auto-push-last'),

  // Subagent markers
  subagentMarkerDir: path.join(_cacheDir, 'subagent-active'),

  // Canonical paths (always in ai-context) — v2 structure
  aiContextDir:   AI_CONTEXT,
  globalMemoryDir: path.join(AI_CONTEXT, 'core', 'memory'),
  globalSkillsDir: path.join(AI_CONTEXT, 'core', 'skills'),
  globalCommandsDir: path.join(AI_CONTEXT, 'core', 'commands'),
  handoffsDir:    path.join(AI_CONTEXT, 'handoffs'),
  projectStateDir: path.join(AI_CONTEXT, 'projects'),
  configsDir:     path.join(AI_CONTEXT, 'generated', 'configs'),
  hooksDir:       path.join(AI_CONTEXT, 'modules', 'hooks', 'src'),
  hooksLibDir:    path.join(AI_CONTEXT, 'modules', 'hooks', 'lib'),
  toolsDir:       path.join(AI_CONTEXT, 'modules', 'tools'),
  scriptsDir:     path.join(AI_CONTEXT, 'scripts'),
  runtimeDir:     path.join(AI_CONTEXT, 'runtime'),
  selfImprovementDir: path.join(AI_CONTEXT, 'runtime', 'self-improvement'),
  mcpDir:         path.join(AI_CONTEXT, 'mcp'),

  // Per-tool memory directory names (Codex uses plural 'memories')
  toolMemoryDirName: { claude: 'memory', gemini: 'memory', codex: 'memories', pi: null },
  getToolMemoryDir(tool) {
    const name = (tool === 'claude' && 'memory') || (tool === 'gemini' && 'memory') || (tool === 'codex' && 'memories') || null;
    if (!name) return null;
    const homePath = (tool === 'claude' && path.join(HOME, '.claude')) || (tool === 'gemini' && path.join(HOME, '.gemini')) || (tool === 'codex' && path.join(HOME, '.codex')) || null;
    return homePath ? path.join(homePath, name) : null;
  },

  // Discover canonical project dir (.ai-context or .claude) under cwd
  findCanonicalDir(cwd) {
    for (const candidate of ['.ai-context', '.claude']) {
      const p = path.join(cwd, candidate);
      try {
        if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return p;
      } catch {}
    }
    return null;
  },

  // Project-level path resolvers (take cwd as argument)

  projectMemoryDir(cwd) {
    const candidates = [
      path.join(cwd, '.ai-context', 'memory'),
      path.join(cwd, path.relative(HOME, _configDir), 'memory'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(path.join(c, 'MEMORY.md'))) return c;
    }
    return null;
  },

  projectProgressFile(cwd) {
    const candidates = [
      path.join(cwd, '.ai-context', 'AI-progress.json'),
      path.join(cwd, path.relative(HOME, _configDir), 'AI-progress.json'),
      path.join(cwd, 'AI-progress.json'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return null;
  },

  projectSettingsFile(cwd) {
    const rel = path.relative(HOME, _configDir);
    const p = path.join(cwd, rel, 'settings.json');
    return fs.existsSync(p) ? p : null;
  },

  // Claude project dir sanitization (matches Claude's internal naming)
  sanitizeCwd(cwd) {
    return cwd.replace(/[/\\]/g, '-').replace(/^([A-Z]):/i, '$1');
  },

  sanitizeCwdNoDash(cwd) {
    return cwd.replace(/^\//, '').replace(/[/\\]/g, '-').replace(/^([A-Z]):/i, '$1');
  },
});
