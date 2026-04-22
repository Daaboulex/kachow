#!/usr/bin/env node
// PreToolUse hook: Validate settings.json edits BEFORE they're written.
// Prevents the "relative path" hook bug where commands like
// `node .claude/hooks/X.js` fail when cwd is a subdirectory.
//
// Checks performed on Write/Edit of any settings*.json file:
//   1. Valid JSON
//   2. All hook command paths use absolute/env-var paths (no bare ./.claude/, ./.gemini/)
//   3. Referenced .js files exist (when path is resolvable)
//   4. Settings schema sanity (cleanupPeriodDays != 0, etc.)
//
// Returns BLOCK with explanation if violations found. Otherwise passthrough.
//
// Disable: SKIP_SETTINGS_VALIDATOR=1
//
// Ref: 2026-04-16 hook-issue prevention after relative-path bug in fahlke

const fs = require('fs');
const path = require('path');
const os = require('os');

function passthrough() {
  process.stdout.write('{"continue":true}');
  process.exit(0);
}

try {
  if (process.env.SKIP_SETTINGS_VALIDATOR === '1') passthrough();

  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { passthrough(); }
  const input = JSON.parse(raw);

  const filePath = (input.tool_input || {}).file_path || '';
  if (!filePath || !/settings(\.local)?\.json$/.test(filePath)) passthrough();

  // For Write tool, the new content is in tool_input.content
  // For Edit tool, the new content is the original + new_string substitution
  // We can't easily reconstruct Edit results, so we validate by reading the
  // file AFTER write would happen — but that's PostToolUse territory.
  // Strategy: only validate Write tool here (full content available); skip Edit.
  const toolName = input.tool_name || '';
  if (toolName !== 'Write') passthrough();

  const newContent = (input.tool_input || {}).content || '';
  if (!newContent.trim()) passthrough();

  let parsed;
  try {
    parsed = JSON.parse(newContent);
  } catch (e) {
    process.stdout.write(JSON.stringify({
      continue: false,
      decision: 'block',
      reason: `settings.json validation failed: invalid JSON.\n\nError: ${e.message}\n\nFix the JSON syntax before writing. (Override: SKIP_SETTINGS_VALIDATOR=1)`
    }));
    process.exit(0);
  }

  const issues = [];

  const isClaude = filePath.includes('/.claude/');
  const isGemini = filePath.includes('/.gemini/');
  const isProjectLevel = !filePath.startsWith(os.homedir() + '/.claude/') && !filePath.startsWith(os.homedir() + '/.gemini/');

  // Check 1: cleanupPeriodDays should not be 0 (Claude Code v2.1.110 rejects)
  if (parsed.cleanupPeriodDays === 0) {
    issues.push('cleanupPeriodDays is 0 — Claude Code v2.1.110+ rejects this. Set to a positive value (recommended: 365) or omit.');
  }

  // Check 1b: Schema drift — catch managed-only keys / deprecated / unknown BEFORE write
  // (Claude-side only — Gemini has its own schema)
  if (isClaude || filePath.endsWith('/.claude/settings.json')) {
    try {
      const { findDrift } = require('./lib/settings-schema.js');
      const drift = findDrift(parsed);
      if (drift.managedOnly.length > 0) {
        issues.push(`Managed-only keys in user settings (triggers Claude Code schema error): ${drift.managedOnly.join(', ')}. These only work in managed-settings files.`);
      }
      if (drift.deprecated.length > 0) {
        issues.push(`Deprecated keys: ${drift.deprecated.join(', ')}. Remove or replace per current docs.`);
      }
      if (drift.unknown.length > 5) {
        issues.push(`${drift.unknown.length} unknown keys (may be typos or future-version): ${drift.unknown.slice(0, 5).join(', ')}${drift.unknown.length > 5 ? '...' : ''}`);
      }
    } catch {}
  }

  // Check 2: hook command paths
  const hooks = parsed.hooks || {};

  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      const groupHooks = group.hooks || [];
      for (const h of groupHooks) {
        const cmd = h.command || '';
        if (!cmd.includes('node ')) continue; // only validate node-invoked hooks

        // Bad pattern: node .claude/hooks/X.js or node .gemini/hooks/X.js (relative)
        // These fail when cwd is a subdirectory of the project root
        const badRelative = /node\s+\.(claude|gemini)\/hooks\//.test(cmd);
        if (badRelative && isProjectLevel) {
          issues.push(`Event ${event}: command uses relative path "${cmd.slice(0, 80)}..." — fails when cwd is a subdirectory. Use $CLAUDE_PROJECT_DIR (Claude) or $GEMINI_PROJECT_DIR (Gemini) or absolute path.`);
        }

        // Bad pattern: literal ~/ in path (node doesn't expand ~)
        const badTilde = /node\s+["']?~\//.test(cmd);
        if (badTilde) {
          issues.push(`Event ${event}: command uses literal ~/ path — node does NOT expand ~. Use $HOME instead.`);
        }

        // Check referenced file exists (best-effort, when path is resolvable)
        const fileMatch = cmd.match(/node\s+["']?([^"'\s]+\.js)["']?/);
        if (fileMatch) {
          let resolved = fileMatch[1]
            .replace(/\$HOME/g, os.homedir())
            .replace(/\${HOME}/g, os.homedir())
            .replace(/^~\//, os.homedir() + '/');
          // Skip if uses other env vars we can't resolve
          if (!resolved.includes('$') && resolved.startsWith('/') && !fs.existsSync(resolved)) {
            issues.push(`Event ${event}: referenced hook file does not exist: ${resolved}`);
          }
        }
      }
    }
  }

  if (issues.length > 0) {
    process.stdout.write(JSON.stringify({
      continue: false,
      decision: 'block',
      reason: `settings.json validation failed (${issues.length} issue${issues.length > 1 ? 's' : ''}):\n\n` +
              issues.map((i, n) => `  ${n + 1}. ${i}`).join('\n\n') +
              `\n\nFix these before writing. (Override: SKIP_SETTINGS_VALIDATOR=1)`
    }));
    process.exit(0);
  }

  passthrough();
} catch (e) {
  try { process.stderr.write('validate-settings-on-write: ' + e.message + '\n'); } catch {}
  passthrough();
}
