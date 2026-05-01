#!/usr/bin/env node
// peer-conflict-check.js — PreToolUse hook for Write/Edit/Bash
// Anti-skew compliant: reads side-channel (active-peers.json), surfaces
// via decision:"ask" (permission prompt to USER, not model context).
// Rules: side-channel only, boundary-gated, path-scoped, TTL 5min, facts only.

const fs = require('fs');
const path = require('path');
const os = require('os');

function passthrough() {
  process.stdout.write('{"continue":true}');
  process.exit(0);
}

try {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }
  const input = JSON.parse(raw);

  const peerFile = path.join(os.homedir(), '.ai-context', 'instances', 'active-peers.json');
  if (!fs.existsSync(peerFile)) passthrough();

  const peerData = JSON.parse(fs.readFileSync(peerFile, 'utf8'));

  // TTL: 5-minute expiry (anti-skew rule 4)
  const ageMs = Date.now() - Date.parse(peerData.timestamp);
  if (ageMs > 5 * 60 * 1000) passthrough();

  // No peers = nothing to surface
  if (!peerData.peers || peerData.peers.length === 0) passthrough();

  // Don't surface for own session's peer data
  if (peerData.session_id === input.session_id) passthrough();

  // Anti-skew compliant: stderr for user visibility, passthrough for model.
  // Rule 1: never inject into model context. Rule 5: facts only on stderr.
  const peerList = peerData.peers.join(', ');
  process.stderr.write(`[peer-conflict] ${peerList} active (${Math.round(ageMs / 1000)}s ago) in ${peerData.cwd}\n`);
  process.stdout.write('{"continue":true}');
} catch {
  passthrough();
}
