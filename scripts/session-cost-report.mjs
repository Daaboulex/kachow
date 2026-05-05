#!/usr/bin/env node
// Session cost tracker — parses Claude Code session JSONL files.
// Usage: node session-cost-report.mjs [--last N] [--project PATH]
// Inspired by ruflo cost-tracker plugin (track.mjs).

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';

const PRICING = {
  'claude-opus-4-6': { input: 15, output: 75, cache_read: 1.5, cache_write: 18.75 },
  'claude-opus-4-7': { input: 15, output: 75, cache_read: 1.5, cache_write: 18.75 },
  'claude-sonnet-4-6': { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
  'claude-haiku-4-5': { input: 0.80, output: 4, cache_read: 0.08, cache_write: 1 },
};

const args = process.argv.slice(2);
const lastN = args.includes('--last') ? parseInt(args[args.indexOf('--last') + 1]) || 5 : 5;
const projectsDir = join(homedir(), '.claude', 'projects');

let sessions = [];
try {
  for (const proj of readdirSync(projectsDir)) {
    const projDir = join(projectsDir, proj);
    try {
      for (const f of readdirSync(projDir)) {
        if (!f.endsWith('.jsonl')) continue;
        const fp = join(projDir, f);
        try {
          const stat = statSync(fp);
          sessions.push({ path: fp, project: proj, mtime: stat.mtimeMs, size: stat.size });
        } catch {}
      }
    } catch {}
  }
} catch {}

sessions.sort((a, b) => b.mtime - a.mtime);
sessions = sessions.slice(0, lastN);

let grandTotal = 0;
for (const s of sessions) {
  let tokens = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  let model = 'unknown';
  try {
    const lines = readFileSync(s.path, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const d = JSON.parse(line);
        if (d.message?.model) model = d.message.model;
        const u = d.message?.usage;
        if (u) {
          tokens.input += u.input_tokens || 0;
          tokens.output += u.output_tokens || 0;
          tokens.cache_read += u.cache_read_input_tokens || 0;
          tokens.cache_write += u.cache_creation_input_tokens || 0;
        }
      } catch {}
    }
  } catch {}
  const p = PRICING[model] || PRICING['claude-sonnet-4-6'];
  const cost = (tokens.input * p.input + tokens.output * p.output +
    tokens.cache_read * p.cache_read + tokens.cache_write * p.cache_write) / 1_000_000;
  grandTotal += cost;
  const date = new Date(s.mtime).toISOString().slice(0, 16);
  console.log(`${date}  ${model.padEnd(20)}  ${(tokens.input + tokens.output + tokens.cache_read + tokens.cache_write).toLocaleString().padStart(10)} tok  $${cost.toFixed(4).padStart(8)}  ${basename(s.path).slice(0, 20)}`);
}
console.log(`${''.padEnd(50)}  TOTAL: $${grandTotal.toFixed(4)}`);
