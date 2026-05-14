#!/usr/bin/env node
// verify-symlinks.mjs — validates all symlinks declared in modules/tools/*/symlinks.yaml
// Reads each tool's symlinks.yaml, resolves ~ to homedir, checks each link exists and is valid.
// Exit 0 = all OK, Exit 1 = failures found.

import { readFileSync, existsSync, lstatSync, readlinkSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const HOME = homedir();

function expandTilde(p) { return p.replace(/^~/, HOME); }

function parseSymlinksYaml(text) {
  const links = [];
  let inLinks = false;
  let current = null;

  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trimEnd();
    if (!line.trim()) continue;
    const trimmed = line.trim();

    if (trimmed === 'links:') { inLinks = true; continue; }
    if (!inLinks) continue;

    if (trimmed.startsWith('- source:')) {
      if (current) links.push(current);
      current = { source: trimmed.replace('- source:', '').trim() };
    } else if (trimmed.startsWith('target:') && current) {
      current.target = trimmed.replace('target:', '').trim();
      links.push(current);
      current = null;
    }
  }
  if (current) links.push(current);
  return links;
}

const tools = ['claude', 'gemini', 'codex', 'pi'];
let failures = 0;
let passes = 0;

for (const tool of tools) {
  const yamlPath = join(ROOT, 'modules/tools', tool, 'symlinks.yaml');
  if (!existsSync(yamlPath)) {
    console.log(`  SKIP: ${tool} (no symlinks.yaml)`);
    continue;
  }

  console.log(`\n── ${tool.toUpperCase()} ──`);
  const links = parseSymlinksYaml(readFileSync(yamlPath, 'utf8'));

  for (const { source, target } of links) {
    const sourcePath = join(ROOT, source);
    const targetPath = expandTilde(target);

    // Check target exists as symlink
    if (!existsSync(targetPath)) {
      console.log(`  FAIL: ${target} — missing`);
      failures++;
      continue;
    }

    let stat;
    try { stat = lstatSync(targetPath); } catch {
      console.log(`  FAIL: ${target} — cannot stat`);
      failures++;
      continue;
    }

    if (!stat.isSymbolicLink()) {
      console.log(`  FAIL: ${target} — not a symlink (regular file/dir)`);
      failures++;
      continue;
    }

    // Check symlink target resolves
    try {
      const actual = readlinkSync(targetPath);
      const resolvedActual = resolve(dirname(targetPath), actual);
      if (!existsSync(resolvedActual)) {
        console.log(`  FAIL: ${target} → ${actual} — broken (target missing)`);
        failures++;
        continue;
      }
    } catch {
      console.log(`  FAIL: ${target} — cannot read link`);
      failures++;
      continue;
    }

    // Check source exists in ai-context
    if (!existsSync(sourcePath)) {
      console.log(`  WARN: ${target} — link OK but source ${source} missing from ai-context`);
      continue;
    }

    console.log(`  PASS: ${target}`);
    passes++;
  }
}

console.log(`\n── SUMMARY ──`);
console.log(`  ${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
