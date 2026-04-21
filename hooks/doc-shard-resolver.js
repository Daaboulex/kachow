#!/usr/bin/env node
// PreToolUse hook: Transparently resolve sharded documents.
// When Read is invoked for a .md file that doesn't exist,
// checks for a sharded directory version and advises.

const fs = require('fs');
const path = require('path');

try {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }
  const input = JSON.parse(raw);

  // Only fire on Read tool for .md files
  const toolName = input.tool_name || '';
  if (toolName !== 'Read' && toolName !== 'read_file') {
    process.stdout.write('{"continue":true}');
    process.exit(0);
  }

  const filePath = (input.tool_input || {}).file_path || '';
  if (!filePath.endsWith('.md')) {
    process.stdout.write('{"continue":true}');
    process.exit(0);
  }

  // If the file exists, nothing to do
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    process.stdout.write('{"continue":true}');
    process.exit(0);
  } catch {}

  // File doesn't exist — check for sharded directory
  const dirPath = filePath.replace(/\.md$/, '');
  const indexPath = path.join(dirPath, 'index.md');

  try {
    fs.accessSync(indexPath, fs.constants.F_OK);
    const sections = fs.readdirSync(dirPath)
      .filter(f => f.startsWith('section-') && f.endsWith('.md'))
      .sort();

    process.stdout.write(JSON.stringify({
      continue: true,
      systemMessage: '"' + path.basename(filePath) + '" is sharded into ' + sections.length + ' sections. Read "' + path.basename(dirPath) + '/index.md" for the table of contents, then read individual sections as needed.'
    }));
  } catch {
    process.stdout.write('{"continue":true}');
  }
} catch (e) {
  process.stderr.write('doc-shard-resolver: ' + e.message + '\n');
  process.stdout.write('{"continue":true}');
}
