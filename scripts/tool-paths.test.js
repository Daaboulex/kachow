#!/usr/bin/env node
// Unit tests for lib/tool-paths.js
'use strict';

const fs = require('fs');
const path = require('path');
const tp = require('../lib/tool-paths.js');

let pass = 0;
let fail = 0;

function assert(cond, label) {
  if (cond) { pass++; }
  else { fail++; console.error(`FAIL: ${label}`); }
}

// String property exports
for (const key of [
  'tool', 'configDir', 'cacheDir',
  'dreamCountFile', 'dreamLastFile', 'dreamLockFile',
  'reflectLastFile', 'reflectEnabledFile', 'wrapUpDoneFile', 'autoPushLastFile',
  'subagentMarkerDir',
  'aiContextDir', 'globalMemoryDir', 'handoffsDir', 'projectStateDir',
  'configsDir', 'hooksDir', 'scriptsDir',
]) {
  assert(typeof tp[key] === 'string', `${key} is string`);
  assert(tp[key].length > 0, `${key} is non-empty`);
}

// Function exports
for (const key of ['projectMemoryDir', 'projectProgressFile', 'projectSettingsFile', 'sanitizeCwd', 'sanitizeCwdNoDash']) {
  assert(typeof tp[key] === 'function', `${key} is function`);
}

// Directories exist on disk
assert(fs.existsSync(tp.configDir), 'configDir exists on disk');
assert(fs.existsSync(tp.aiContextDir), 'aiContextDir exists on disk');
assert(fs.existsSync(tp.globalMemoryDir), 'globalMemoryDir exists on disk');
assert(fs.existsSync(tp.hooksDir), 'hooksDir exists on disk');

// Tool is one of the known values
assert(['claude', 'gemini', 'codex', 'crush', 'opencode'].includes(tp.tool), `tool "${tp.tool}" is valid`);

// configDir contains tool home
const home = require('os').homedir();
assert(tp.configDir.startsWith(home), 'configDir under HOME');

// Paths are absolute
assert(path.isAbsolute(tp.dreamCountFile), 'dreamCountFile is absolute');
assert(path.isAbsolute(tp.autoPushLastFile), 'autoPushLastFile is absolute');
assert(path.isAbsolute(tp.subagentMarkerDir), 'subagentMarkerDir is absolute');

// autoPushLastFile is in ai-context (not tool dir)
assert(tp.autoPushLastFile.includes('.ai-context'), 'autoPushLastFile in ai-context');

// sanitizeCwd
assert(tp.sanitizeCwd('$HOME/Documents') === '-home-user-Documents', 'sanitizeCwd produces dash-prefix');
assert(tp.sanitizeCwdNoDash('$HOME/Documents') === 'home-user-Documents', 'sanitizeCwdNoDash strips leading dash');

// Frozen
try {
  tp.tool = 'hacked';
  assert(tp.tool !== 'hacked', 'object is frozen (property write rejected)');
} catch {
  pass++; // strict mode throws — that's correct
}

console.log(`tool-paths.test: ${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
