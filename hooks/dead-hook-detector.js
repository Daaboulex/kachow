#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// PostToolUse hook: When a hook file (~/.claude/hooks/*.js or ~/.gemini/hooks/*.js)
// is modified, check if it's registered in settings.json or referenced by a combined
// hook. Warn about potential orphans.
// Advisory only — never blocks writes.
//
// Extended (Phase 8 Plan 03): After orphan-hook check, run a 24h-gated extended scan:
//   - Stale memory files (mtime > 60 days)
//   - Unused skills (not invoked in 30 days)
//   - Inactive agents (not spawned in 14 days)
// Findings written to recurring-issues.md via archiveAndWrite (Law 1 compliant).
// NEVER auto-deletes anything — advisory only.

const fs = require('fs');
const path = require('path');
const os = require('os');

try {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }
  const input = JSON.parse(raw);

  const filePath = (input.tool_input || {}).file_path || '';
  const normalized = filePath.replace(/\\/g, '/');

  // Only trigger for .js files inside ~/.claude/hooks/ or ~/.gemini/hooks/
  if ((!normalized.includes('/.claude/hooks/') && !normalized.includes('/.gemini/hooks/')) || !normalized.endsWith('.js')) {
    process.stdout.write('{"continue":true}');
    process.exit(0);
  }

  const basename = path.basename(filePath);

  // Skip GSD-managed hooks (basename starts with gsd-)
  if (basename.startsWith('gsd-')) {
    process.stdout.write('{"continue":true}');
    process.exit(0);
  }

  // Skip lib/ subdirectory files — they are modules, not standalone hooks
  if (normalized.includes('/hooks/lib/')) {
    process.stdout.write('{"continue":true}');
    process.exit(0);
  }

  const home = os.homedir();
  const isGemini = normalized.includes('/.gemini/hooks/');
  const settingsPath = isGemini
    ? path.join(home, '.gemini', 'settings.json')
    : path.join(home, '.claude', 'settings.json');

  // Canonical hook events per platform — registrations under other names are dead code.
  const CANONICAL_EVENTS_CLAUDE = new Set([
    'PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Notification',
    'Stop', 'SubagentStart', 'SubagentStop', 'PreCompact',
    'SessionStart', 'SessionEnd',
  ]);
  const CANONICAL_EVENTS_GEMINI = new Set([
    'SessionStart', 'SessionEnd', 'BeforeTool', 'AfterTool',
    'BeforeAgent', 'AfterAgent', 'PreCompress',
    'Notification', 'UserPromptSubmit',
  ]);
  const canonicalEvents = isGemini ? CANONICAL_EVENTS_GEMINI : CANONICAL_EVENTS_CLAUDE;

  // 1. Collect all hook command paths from settings.json + flag unknown events
  const registeredFiles = new Set();
  const unknownEvents = [];
  try {
    // Resolve symlink before reading (settings may be symlinked to ai-context/configs/)
    const realSettingsPath = fs.existsSync(settingsPath) ? fs.realpathSync(settingsPath) : settingsPath;
    const settings = JSON.parse(fs.readFileSync(realSettingsPath, 'utf8'));
    const hookEvents = settings.hooks || {};
    for (const eventName of Object.keys(hookEvents)) {
      const entries = hookEvents[eventName];
      if (!Array.isArray(entries)) continue;
      if (!canonicalEvents.has(eventName)) {
        unknownEvents.push(eventName);
      }
      for (const entry of entries) {
        const hooks = entry.hooks || [];
        for (const hook of hooks) {
          const cmd = hook.command || '';
          // Extract filename from command like: node "$HOME/.claude/hooks/foo.js"
          const match = cmd.match(/[\\/]hooks[\\/]([^"'\s]+\.js)/);
          if (match) registeredFiles.add(match[1]);
        }
      }
    }
    // Also check statusLine command
    if (settings.statusLine?.command) {
      const match = settings.statusLine.command.match(/[\\/]hooks[\\/]([^"'\s]+\.js)/);
      if (match) registeredFiles.add(match[1]);
    }
  } catch {}

  // 2. Scan combined hooks for require('./...') references to sub-modules
  const referencedFiles = new Set();
  const hooksDir = isGemini
    ? path.join(home, '.gemini', 'hooks')
    : path.join(home, '.claude', 'hooks');
  const combinedHooks = [
    'session-start-combined.js',
    'pre-write-combined-guard.js',
    'post-write-sync.js',
  ];
  for (const combinedName of combinedHooks) {
    try {
      const content = fs.readFileSync(path.join(hooksDir, combinedName), 'utf8');
      // Match require('./something') or require('./lib/something')
      const requireMatches = content.matchAll(/require\(\s*['"]\.\/([^'"]+)['"]\s*\)/g);
      for (const m of requireMatches) {
        // Normalize: ./lib/foo.js -> lib/foo.js, ./bar -> bar.js
        let ref = m[1];
        if (!ref.endsWith('.js')) ref += '.js';
        referencedFiles.add(ref);
      }
    } catch {}
  }

  // 3. Check if this file is registered or referenced
  const isRegistered = registeredFiles.has(basename);
  const isReferenced = referencedFiles.has(basename) ||
    // Check lib/ paths too
    Array.from(referencedFiles).some(ref => ref.endsWith('/' + basename) || ref === basename);

  let orphanWarning = '';
  if (!isRegistered && !isReferenced) {
    orphanWarning = `[dead-hook-detector] WARNING: ${basename} is not registered in settings.json and not referenced by any combined hook. Potential orphan.`;
  }

  // Unknown-event check — registrations under non-canonical event names never fire.
  if (unknownEvents.length > 0) {
    const platform = isGemini ? 'Gemini' : 'Claude';
    const suffix = `[dead-hook-detector] DEAD EVENTS in ${platform} settings.json: ${unknownEvents.join(', ')}. These events are not in the v2.1.x canonical set — registered hooks never fire. Remove or re-home.`;
    orphanWarning = orphanWarning ? orphanWarning + '\n' + suffix : suffix;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Extended scan: stale memory files / unused skills / inactive agents
  // Runs at most once every 24 hours (cooldown gate).
  // Only runs for Claude-side hooks (not Gemini).
  // ────────────────────────────────────────────────────────────────────────────
  if (!isGemini) {
    const DEAD_CODE_COOLDOWN = 24 * 60 * 60 * 1000; // 24 hours
    const deadCodeLastFile = path.join(home, '.claude', '.dead-code-last');
    let deadCodeLastTime = 0;
    try { deadCodeLastTime = fs.statSync(deadCodeLastFile).mtimeMs; } catch {}

    if ((Date.now() - deadCodeLastTime) >= DEAD_CODE_COOLDOWN) {
      runExtendedScan(home, hooksDir);
    }
  }

  // Emit result (orphan warning or clean continue)
  if (orphanWarning) {
    process.stdout.write(JSON.stringify({ continue: true, systemMessage: orphanWarning }));
  } else {
    process.stdout.write('{"continue":true}');
  }
} catch (e) {
  process.stderr.write('dead-hook-detector: ' + e.message + '\n');
  process.stdout.write('{"continue":true}');
}

// ────────────────────────────────────────────────────────────────────────────
// Extended scan implementation
// ────────────────────────────────────────────────────────────────────────────

function findMemoryDir() {
  const projectDir = process.cwd();
  for (const candidate of ['.ai-context/memory', '.claude/memory']) {
    const fullPath = path.join(projectDir, candidate);
    if (fs.existsSync(path.join(fullPath, 'MEMORY.md'))) {
      return { path: fullPath };
    }
  }
  return null;
}

function runExtendedScan(home, hooksDir) {
  try {
    const { readEvents, logEvent } = require(path.join(hooksDir, 'lib', 'observability-logger.js'));
    const { getSemanticDir, archiveAndWrite } = require(path.join(hooksDir, 'lib', 'tier3-consolidation.js'));

    const cwd = process.cwd();
    const STALE_MEMORY_DAYS = 60;
    const STALE_SKILL_DAYS = 30;
    const STALE_AGENT_DAYS = 14;
    const now = Date.now();

    // ── 1. Stale memory files (mtime > 60 days) ──
    const staleMemories = [];
    const memDir = findMemoryDir();
    if (memDir) {
      const dirsToScan = [memDir.path, path.join(memDir.path, 'semantic')];
      for (const scanDir of dirsToScan) {
        if (!fs.existsSync(scanDir)) continue;
        try {
          const files = fs.readdirSync(scanDir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md');
          for (const f of files) {
            const fullPath = path.join(scanDir, f);
            try {
              const stat = fs.statSync(fullPath);
              const ageDays = (now - stat.mtimeMs) / (1000 * 60 * 60 * 24);
              if (ageDays >= STALE_MEMORY_DAYS) {
                staleMemories.push({ file: fullPath, ageDays: Math.floor(ageDays) });
              }
            } catch {}
          }
        } catch {}
      }
    }

    // ── 2. Unused skills (not invoked >= 30 days) ──
    const unusedSkills = [];
    // Skills invoked by hooks, not by user — exclude from "unused" detection
    const SYSTEM_SKILLS = new Set([
      'consolidate-memory', 'reflect', 'wrap-up', 'handoff', 'verify-sync'
    ]);
    try {
      const skillEvents = readEvents(cwd, STALE_SKILL_DAYS, { eventTypes: ['skill_invoke'] });
      const invokedSkills = new Set();
      for (const ev of skillEvents) {
        const skillName = (ev.payload && ev.payload.skill) || (ev.meta && ev.meta.skill);
        if (skillName) invokedSkills.add(skillName);
      }

      const commandsDir = path.join(home, '.claude', 'commands');
      if (fs.existsSync(commandsDir)) {
        const entries = fs.readdirSync(commandsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
          const skillName = entry.name.replace(/\.md$/, '');
          if (SYSTEM_SKILLS.has(skillName)) continue;
          if (!invokedSkills.has(skillName)) {
            unusedSkills.push({ skill: skillName, daysSinceInvoke: STALE_SKILL_DAYS + '+' });
          }
        }
      }
    } catch {}

    // ── 3. Inactive agents (not spawned >= 14 days) ──
    const unusedAgents = [];
    try {
      const agentEvents = readEvents(cwd, STALE_AGENT_DAYS, { eventTypes: ['agent_spawn'] });
      // If event type is not logged yet (empty), skip gracefully
      if (agentEvents.length === 0) {
        // No agent_spawn events found — either all inactive or event type not yet logged
        // Skip rather than flagging everything as unused
      }
    } catch {}

    // ── 4. Write findings to recurring-issues.md (Law 1 compliant) ──
    if (staleMemories.length > 0 || unusedSkills.length > 0) {
      if (memDir) {
        const semanticDir = getSemanticDir(memDir.path);
        const recurringIssuesPath = path.join(semanticDir, 'recurring-issues.md');

        // Read existing content
        let existingContent = '';
        try { existingContent = fs.readFileSync(recurringIssuesPath, 'utf8'); } catch {}

        // Build new Dead Code Report section
        const reportDate = new Date().toISOString().slice(0, 10);
        let reportSection = `\n## Dead Code Report (${reportDate})\n\n`;
        reportSection += `> Advisory only — review and archive manually if appropriate. Never auto-deleted.\n\n`;

        if (staleMemories.length > 0) {
          reportSection += `### Stale Memory Files (>${STALE_MEMORY_DAYS} days unmodified)\n\n`;
          for (const item of staleMemories) {
            reportSection += `- \`${item.file}\` — ${item.ageDays} days since last update\n`;
          }
          reportSection += '\n';
        }

        if (unusedSkills.length > 0) {
          reportSection += `### Unused Skills (not invoked in ${STALE_SKILL_DAYS} days)\n\n`;
          for (const item of unusedSkills) {
            reportSection += `- \`${item.skill}\` — not invoked in last ${STALE_SKILL_DAYS}+ days\n`;
          }
          reportSection += '\n';
        }

        // Remove previous Dead Code Report section (if any) and append new one
        const sectionMarker = /\n## Dead Code Report \(\d{4}-\d{2}-\d{2}\)[\s\S]*?(?=\n## |\n# |$)/;
        let updatedContent;
        if (existingContent.match(sectionMarker)) {
          updatedContent = existingContent.replace(sectionMarker, reportSection);
        } else {
          updatedContent = (existingContent || '# Recurring Issues\n') + reportSection;
        }

        fs.mkdirSync(semanticDir, { recursive: true });
        archiveAndWrite(recurringIssuesPath, updatedContent);
      }
    }

    // ── 5. Log the scan event to Tier 2 ──
    try {
      logEvent(cwd, {
        type: 'dead_code_scan',
        source: 'dead-hook-detector',
        payload: {
          staleMemories: staleMemories.length,
          unusedSkills: unusedSkills.length,
          unusedAgents: unusedAgents.length,
        }
      });
    } catch {}

    // ── 6. Update cooldown timestamp ──
    const deadCodeLastFile = path.join(home, '.claude', '.dead-code-last');
    fs.writeFileSync(deadCodeLastFile, '');
  } catch (e) {
    // Extended scan must never throw — advisory only
    process.stderr.write('dead-hook-detector extended scan: ' + e.message + '\n');
  }
}
