#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// Notification hook: tries notify-send (desktop), falls back to JSONL for SSH/headless.
//
// Prior hook: `notify-send ... || true` — silently dropped messages in headless sessions.
// Now: if notify-send fails OR no display, append to ~/.claude/.notifications.jsonl.
// SessionStart injects unread count so AI can surface missed messages.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

try {
  const title = process.env.CLAUDE_NOTIFICATION_TITLE || 'Claude Code';
  const message = process.env.CLAUDE_NOTIFICATION_MESSAGE || '';

  // Try desktop notification first (fails silently on headless)
  let desktopOk = false;
  if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) {
    try {
      const res = spawnSync('notify-send', ['-a', 'Claude Code', '-i', 'dialog-information', title, message], {
        timeout: 3000, stdio: 'ignore',
      });
      desktopOk = res.status === 0;
    } catch {}
  }

  // Always append to fallback file (single source of truth even if desktop succeeded)
  // SessionStart clears this on notice; user can manually truncate.
  if (!desktopOk) {
    try {
      const notifFile = path.join(os.homedir(), '.claude', '.notifications.jsonl');
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        title,
        message,
        desktop_ok: desktopOk,
      }) + '\n';
      fs.appendFileSync(notifFile, line);
    } catch {}
  }
} catch {}

process.exit(0);
