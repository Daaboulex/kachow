#!/usr/bin/env node
// research-lint.js
// PostToolUse Write|Edit hook. Runs on any write under ~/Documents/research/.
// Scans for principle-style claims without citations and warns.
//
// Signals that require a citation (one of: arxiv:, github:, transcript:, doc:, commit:):
//   - "from transcript"
//   - "from the paper"
//   - "paper shows"
//   - "repo demonstrates"
//   - "study found"
//   - "study showed"
//   - "benchmark reports"
//   - "empirical study"
//
// Exit 0 on pass, 2 with message on fail (lets user fix before continuing).

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const RESEARCH_ROOT = path.join(HOME, 'Documents', 'research');
const SIGNALS = [
  /from\s+transcript/i,
  /from\s+the\s+paper/i,
  /paper\s+shows/i,
  /repo\s+demonstrates/i,
  /study\s+(found|showed)/i,
  /benchmark\s+reports/i,
  /empirical\s+study/i,
];
const CITATIONS = [
  /arxiv:\d{4}\.\d{5}/i,
  /github:[\w-]+\/[\w.-]+/i,
  /transcript:[\w-]{11}/i,
  /doc:https?:\/\//i,
  /commit:[0-9a-f]{7,}/i,
];

let input = '';
try { input = fs.readFileSync(0, 'utf8'); } catch { process.exit(0); }
let evt;
try { evt = JSON.parse(input); } catch { process.exit(0); }

const toolName = evt.tool_name || '';
if (!['Write', 'Edit', 'MultiEdit'].includes(toolName)) process.exit(0);
const filePath = evt.tool_input?.file_path || '';
if (!filePath.startsWith(RESEARCH_ROOT)) process.exit(0);
if (!/\.mdx?$/i.test(filePath)) process.exit(0);

const content = evt.tool_input?.content || evt.tool_input?.new_string || '';
if (!content) process.exit(0);

const issues = [];
const lines = content.split('\n');
for (let i = 0; i < lines.length; i++) {
  for (const sig of SIGNALS) {
    if (sig.test(lines[i])) {
      // Check same line or 3 lines below for citation
      const window = lines.slice(i, Math.min(i + 4, lines.length)).join(' ');
      if (!CITATIONS.some(c => c.test(window))) {
        issues.push(`  L${i + 1}: "${lines[i].slice(0, 80)}..."`);
      }
      break;
    }
  }
}

if (issues.length === 0) process.exit(0);

console.error('⚠ research-lint: unsourced claims detected');
console.error(`  file: ${filePath}`);
for (const iss of issues.slice(0, 5)) console.error(iss);
if (issues.length > 5) console.error(`  (+${issues.length - 5} more)`);
console.error('');
console.error('Add citation within 3 lines:');
console.error('  arxiv:YYMM.NNNNN | github:owner/repo | transcript:<11charId>#t=<sec>');
console.error('  doc:<https://url> | commit:<sha>');
console.error('Or move to research/hypotheses/ until verifiable.');
process.exit(2);
