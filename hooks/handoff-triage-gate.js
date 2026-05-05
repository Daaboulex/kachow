#!/usr/bin/env node
'use strict';
// SessionStart hook: surface stale deferred items for triage + user-action reminders.
// Budget: ≤500B triage + ≤200B user-actions within 4000B R-CTX cap.
// Skip: SKIP_TRIAGE_GATE=1

const fs = require('fs');
const path = require('path');

function passthrough() {
  process.stdout.write('{"continue":true}');
  process.exit(0);
}

try {
  if (process.env.SKIP_TRIAGE_GATE === '1') passthrough();

  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }
  const input = JSON.parse(raw || '{}');

  const { deriveProjectKeyCached } = require('./lib/project-key.js');
  const { readItems, incrementDeferCounts, computeStaleness } = require('./lib/deferred-items.js');

  const cwd = input.cwd || process.cwd();
  const proj = deriveProjectKeyCached(cwd);
  const sessionId = input.session_id || 'unknown';

  // Increment defer counts for all ai-actionable items in this project
  incrementDeferCounts(proj.key, sessionId);

  // Compute staleness
  const deferred = readItems('deferred');
  const { stale } = computeStaleness(deferred.items, proj.key, sessionId);

  const parts = [];

  // Triage prompt for stale items (≤500B)
  if (stale.length > 0) {
    const ages = stale.map(i => Math.floor((Date.now() - new Date(i.created_at).getTime()) / 86400000));
    const oldestAge = Math.max(...ages);
    let msg = `⚠ DEFERRED ITEMS need triage (${stale.length} item${stale.length > 1 ? 's' : ''}, oldest ${oldestAge}d):\n`;
    const show = Math.min(stale.length, 5);
    for (let i = 0; i < show; i++) {
      const item = stale[i];
      const age = ages[i];
      msg += `${i + 1}. [${item.type}] "${item.title.slice(0, 60)}" (deferred ${item.defer_count}\xD7, ${age}d, project: ${item.project_key || 'global'})\n`;
    }
    if (stale.length > 5) msg += `... and ${stale.length - 5} more\n`;
    msg += 'For each: KEEP / DROP / DO-NOW / → USER-ACTION / → BLOCKED:<trigger>';
    parts.push(msg);
  }

  // User-action reminders (quiet, ≤200B)
  const userActions = readItems('user-actions');
  const projectUA = userActions.items.filter(i =>
    i.status === 'active' && (!i.project_key || i.project_key === proj.key)
  );
  if (projectUA.length > 0) {
    const titles = projectUA.slice(0, 5).map(i => i.title.slice(0, 40)).join(' • ');
    parts.push(`📋 User actions (${projectUA.length}): ${titles}`);
  }

  if (parts.length > 0) {
    process.stdout.write(JSON.stringify({ continue: true, systemMessage: parts.join('\n\n') }));
  } else {
    passthrough();
  }
} catch (e) {
  try { process.stderr.write('[handoff-triage-gate] ' + e.message + '\n'); } catch {}
  passthrough();
}
