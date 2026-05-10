#!/usr/bin/env node
// PreToolUse guard: block Agent dispatches that reference non-existent files.
require('./lib/safety-timeout.js');

const fs = require('fs');
const os = require('os');

let raw = '';
process.stdin.on('data', c => raw += c);
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw);
    if (input.tool_name !== 'Agent') {
      process.stdout.write(JSON.stringify({ continue: true }));
      return;
    }

    const prompt = input.tool_input?.prompt || '';
    if (process.env.AGENT_ALLOW_MISSING_INPUTS === '1') {
      process.stdout.write(JSON.stringify({ continue: true }));
      return;
    }

    const home = os.homedir();
    const pathMatches = prompt.match(/~\/[.\w\-\/]+\.\w+/g) || [];
    const absoluteMatches = prompt.match(new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/[.\\w\\-/]+\\.\\w+', 'g')) || [];
    const allPaths = [...new Set([...pathMatches, ...absoluteMatches])];

    for (const p of allPaths) {
      const expanded = p.replace(/^~/, home);
      if (!fs.existsSync(expanded)) {
        process.stdout.write(JSON.stringify({
          decision: 'block',
          reason: `Agent prompt references non-existent file: ${p}. Dispatch sequentially after the producing agent completes, or set AGENT_ALLOW_MISSING_INPUTS=1 if the agent is expected to create this file.`
        }));
        return;
      }
    }

    process.stdout.write(JSON.stringify({ continue: true }));
  } catch {
    process.stdout.write(JSON.stringify({ continue: true }));
  }
});
