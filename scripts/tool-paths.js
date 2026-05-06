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

  // Canonical paths (always in ai-context)
  aiContextDir:   AI_CONTEXT,
  globalMemoryDir: path.join(AI_CONTEXT, 'memory'),
  handoffsDir:    path.join(AI_CONTEXT, 'handoffs'),
  projectStateDir: path.join(AI_CONTEXT, 'project-state'),
  configsDir:     path.join(AI_CONTEXT, 'configs'),
  hooksDir:       path.join(AI_CONTEXT, 'hooks'),
  scriptsDir:     path.join(AI_CONTEXT, 'scripts'),

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
