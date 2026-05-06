#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// PreToolUse hook: Catch personal tokens in Write tool content BEFORE they land
// in a public-shareable directory. Works as a runtime scrub sentinel — CI
// + pre-push still run as defense-in-depth.
//
// Active when the target file is under a "public" root:
//   ~/.ai-context/kachow-mirror/
//   any dir containing .public-ship marker
//
// Matches the same token-set-from-parts as scripts/scrub-check.sh so rules
// stay in sync. If any match, BLOCKS the write with a clear reason.
//
// Override: SKIP_SCRUB_SENTINEL=1.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function passthrough() {
  process.stdout.write('{"continue":true}');
  process.exit(0);
}

try {
  if (process.env.SKIP_SCRUB_SENTINEL === '1') passthrough();

  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { passthrough(); }
  const input = JSON.parse(raw);

  const tool = input.tool_name || '';
  if (tool !== 'Write' && tool !== 'Edit' && tool !== 'MultiEdit') passthrough();

  const filePath = (input.tool_input || {}).file_path || '';
  if (!filePath) passthrough();

  // Only gate public-shareable roots
  const home = os.homedir();
  const PUBLIC_ROOTS = [
    path.join(home, '.ai-context', 'kachow-mirror'),
  ];
  let activeRoot = PUBLIC_ROOTS.find(r => filePath.startsWith(r + path.sep) || filePath === r) || null;
  // Also check for a .public-ship marker in the path's parent chain
  if (!activeRoot) {
    let walk = path.dirname(filePath);
    for (let i = 0; i < 6 && walk !== path.dirname(walk); i++) {
      if (fs.existsSync(path.join(walk, '.public-ship'))) { activeRoot = walk; break; }
      walk = path.dirname(walk);
    }
  }
  if (!activeRoot) passthrough();

  // Doc-context allowlist: legitimate owner-identifier references (GitHub URLs,
  // contributor names, licenses). Matches scripts/scrub-check.sh convention —
  // allowlist applies ONLY at the public-root level, NOT nested inside subdirs
  // (so hooks/README.md is still scanned; root README.md is not).
  const DOC_ALLOWLIST = new Set([
    'README.md', 'LICENSE', 'CONTRIBUTING.md', 'SECURITY.md',
    'CHANGELOG.md', 'AUTHORS.md', 'MAINTAINERS.md', 'CODE_OF_CONDUCT.md',
  ]);
  const relFromRoot = path.relative(activeRoot, filePath);
  const isRootDoc = !relFromRoot.includes(path.sep) && DOC_ALLOWLIST.has(path.basename(filePath));
  if (isRootDoc) passthrough();
  // docs/ directory at public root only
  if (relFromRoot.split(path.sep)[0] === 'docs') passthrough();
  // CI workflow files are structured, not prose — skip
  if (relFromRoot.startsWith('.github' + path.sep + 'workflows' + path.sep)) passthrough();

  // Reconstruct new content
  let content = '';
  if (tool === 'Write') {
    content = (input.tool_input || {}).content || '';
  } else if (tool === 'Edit' || tool === 'MultiEdit') {
    // For Edit tools, we have new_string — scan those fragments
    const edits = (input.tool_input || {}).edits || [];
    if (edits.length > 0) {
      content = edits.map(e => e.new_string || '').join('\n');
    } else {
      content = (input.tool_input || {}).new_string || '';
    }
  }
  if (!content) passthrough();

  // Token list — assembled from parts so this file doesn't self-match.
  const p = (...parts) => parts.join('');
  const tokens = [
    p('f', 'a', 'h', 'l', 'k', 'e'),
    p('F', 'a', 'h', 'l', 'k', 'e'),
    p('D', 'a', 'a', 'b', 'o', 'u', 'l', 'e', 'x'),
    p('P', 'o', 'r', 't', 'a', 'b', 'l', 'e', '-', 'B', 'u', 'i', 'l', 'd', 'e', 'r'),
    p('/', 'h', 'o', 'm', 'e', '/', 'u', 's', 'e', 'r'),
    p('k', 'i', 'p', 'p', 'e', 'r', '_', 'e', 'l', 'i', 'x', 'i', 'r', 's'),
    p('m', 'a', 'c', 'b', 'o', 'o', 'k', '-', 'p', 'r', 'o', '-', '9', '-', '2'),
    p('r', 'y', 'z', 'e', 'n', '-', '9', '9', '5', '0', 'x', '3', 'd'),
    p('F', 'C', 'S', 'E', '0', '1'),
    p('L', 'a', 'C', 'i', 'e'),
    p('S', 't', 'e', 'p', 'h', 'a', 'n'),
    p('f', 'a', 'h', 'l', 'k', 'e', '-', 'm', 'o', 'n', 'o', 'r', 'e', 'p', 'o'),
    p('f', 'a', 'h', 'l', 'k', 'e', '-', 'f', 'i', 'r', 'm', 'w', 'a', 'r', 'e'),
  ];
  // Per-token word-boundary: \b only matches word↔non-word transitions.
  // A token starting with a non-word character (like an absolute path) would
  // fail to match when the previous char is also non-word (whitespace → slash).
  // Decide per token whether each side needs \b based on its first/last char.
  function wrap(tok) {
    const starts = /^\w/.test(tok);
    const ends   = /\w$/.test(tok);
    const esc = tok.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    return (starts ? '\\b' : '') + esc + (ends ? '\\b' : '');
  }
  const re = new RegExp(`(${tokens.map(wrap).join('|')})`, 'gi');
  const hits = [];
  for (const line of content.split('\n')) {
    const m = line.match(re);
    if (m) hits.push({ line: line.slice(0, 120), match: m[0] });
    if (hits.length >= 5) break;
  }

  // Secondary credential/secret pattern sweep — zero-coverage gap before.
  const SECRET_PATTERNS = [
    { name: 'anthropic-api-key',      re: /\bsk-ant-[a-z0-9-]{10,}/i },
    { name: 'openai-api-key',         re: /\bsk-[A-Za-z0-9]{20,}/ },
    { name: 'github-pat',             re: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
    { name: 'aws-access-key',         re: /\bAKIA[0-9A-Z]{16}\b/ },
    { name: 'aws-secret-key',         re: /\baws_secret_access_key\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}["']?/i },
    { name: 'ssh-private-key-header', re: /-----BEGIN (?:OPENSSH|RSA|DSA|EC|PGP) PRIVATE KEY-----/ },
    { name: 'generic-jwt',            re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  ];
  for (const { name, re: sre } of SECRET_PATTERNS) {
    const m = content.match(sre);
    if (m) {
      hits.push({ line: `[secret-pattern:${name}] ${m[0].slice(0, 60)}…`, match: name });
      if (hits.length >= 5) break;
    }
  }

  // Filename-based leak: personal tokens in the filename itself pass all
  // content scans. Check the filename against the same token set.
  const fileBase = path.basename(filePath).toLowerCase();
  for (const tok of tokens) {
    if (fileBase.includes(tok.toLowerCase())) {
      hits.push({ line: `[filename] ${path.basename(filePath)}`, match: tok });
      break;
    }
  }

  if (hits.length > 0) {
    const sample = hits.map((h, i) => `  ${i + 1}. matched "${h.match}" in: ${h.line}`).join('\n');
    process.stdout.write(JSON.stringify({
      continue: false,
      decision: 'block',
      reason: `scrub-sentinel: write would leak ${hits.length} personal token(s) into ${filePath}.\n\n${sample}\n\nFix before writing. Override: SKIP_SCRUB_SENTINEL=1 (not recommended for public-shareable paths).`
    }));
    process.exit(0);
  }

  passthrough();
} catch (e) {
  try { process.stderr.write('scrub-sentinel: ' + e.message + '\n'); } catch {}
  passthrough();
}
