#!/usr/bin/env node
// PostToolUse hook: When a global hook file (~/.claude/hooks/*.js) is modified,
// scan project CLAUDE.md files for references to that hook and warn about
// potential documentation drift.
// Cross-platform: pure Node.js, no shell commands.

const fs = require('fs');
const path = require('path');

function findFiles(dir, name, maxDepth, depth) {
  if (depth > maxDepth) return [];
  const results = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === name) results.push(full);
      else if (entry.isDirectory()) results.push(...findFiles(full, name, maxDepth, depth + 1));
    }
  } catch {}
  return results;
}

try {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }
  const input = JSON.parse(raw);

  const filePath = (input.tool_input || {}).file_path || '';
  const normalized = filePath.replace(/\\/g, '/');

  // Only trigger for .js files inside ~/.claude/hooks/ or ~/.gemini/hooks/
  if ((!normalized.includes('/.claude/hooks/') && !normalized.includes('/.gemini/hooks/')) || !normalized.endsWith('.js')) {
    process.stdout.write('{"continue":true}');
    process.exit(0);
  }

  const hookName = path.basename(filePath);
  const homeDir = require('os').homedir();
  const docsDir = path.join(homeDir, 'Documents');

  // Find CLAUDE.md files (pure Node.js, cross-platform)
  const claudeMdFiles = findFiles(docsDir, 'CLAUDE.md', 4, 0);

  if (claudeMdFiles.length === 0) {
    process.stdout.write('{"continue":true}');
    process.exit(0);
  }

  // Check which CLAUDE.md files reference this hook
  const hookBaseName = hookName.replace(/\.js$/, '');
  const affectedFiles = [];

  for (const mdFile of claudeMdFiles) {
    try {
      const content = fs.readFileSync(mdFile, 'utf8');
      if (content.includes(hookName) || content.includes(hookBaseName)) {
        affectedFiles.push(mdFile);
      }
    } catch {}
  }

  if (affectedFiles.length === 0) {
    process.stdout.write('{"continue":true}');
    process.exit(0);
  }

  const shortPaths = affectedFiles.map(f => f.replace(homeDir, '~'));

  process.stdout.write(JSON.stringify({
    continue: true,
    systemMessage: `[hook-doc-drift] Hook ${hookName} was modified. Project CLAUDE.md files that reference it may need updating: ${shortPaths.join(', ')}`
  }));
} catch (e) {
  process.stderr.write('hook-doc-drift-detector: ' + e.message + '\n');
  process.stdout.write('{"continue":true}');
}
