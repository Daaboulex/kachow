// tier3-consolidation.js — Tier 3 semantic file synthesis helpers
//
// Provides utilities for the /consolidate-memory skill to produce semantic summary
// files from Tier 1 profile memories + Tier 2 episodic JSONL data.
//
// Exports:
//   getSemanticDir(memoryDir)            → path to memory/semantic/
//   archiveAndWrite(filePath, content)   → archive existing, write new (Law 1)
//   checkDualGate(memoryDir, cwd)        → { gate1Open, gate2Open, bothOpen, lastConsolidated, sessionCount }
//   makeFrontmatter(name, desc, type, sessionCount) → YAML frontmatter block string
//   buildSummary(semanticDir, sessionCount, episodicCount, profileCount) → SUMMARY.md string
//
// Phase 7 REQ-07-03. Spec: [spec-ref] 2026-04-12-memory-architecture.md Sections 4 + 6

const fs = require('fs');
const path = require('path');
const os = require('os');

// Require observability-logger from same lib directory (Plan 01 output)
const { readEvents } = require(path.join(__dirname, 'observability-logger.js'));

const MIN_SESSIONS = 5;
const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Return the path to the Tier 3 semantic directory.
 * @param {string} memoryDir - Base memory directory (e.g. ~/.claude/projects/<slug>/memory)
 * @returns {string}
 */
function getSemanticDir(memoryDir) {
  return path.join(memoryDir, 'semantic');
}

/**
 * Archive an existing file to history/ before writing new content.
 * Ensures Law 1 compliance: prior content is never deleted, only archived.
 *
 * Archive naming: YYYY-MM-DD-<basename>
 * If same-day archive already exists: uses full ISO timestamp (YYYY-MM-DDTHH-MM-SS-<basename>)
 *
 * @param {string} filePath - Absolute path to the file to write
 * @param {string} newContent - New content to write
 */
function archiveAndWrite(filePath, newContent) {
  const historyDir = path.join(path.dirname(filePath), 'history');

  if (fs.existsSync(filePath)) {
    // Create history/ directory if needed
    fs.mkdirSync(historyDir, { recursive: true });

    const basename = path.basename(filePath);
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const dailyArchivePath = path.join(historyDir, `${today}-${basename}`);

    if (fs.existsSync(dailyArchivePath)) {
      // Same-day collision — use full ISO timestamp (replace colons for filesystem safety)
      const isoStamp = new Date().toISOString().replace(/:/g, '-').slice(0, 19);
      const timestampedPath = path.join(historyDir, `${isoStamp}-${basename}`);
      fs.copyFileSync(filePath, timestampedPath);
    } else {
      fs.copyFileSync(filePath, dailyArchivePath);
    }
  }

  // Write new content (ensures directory exists)
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, newContent, 'utf8');
}

/**
 * Check the dual-gate for Tier 3 consolidation:
 *   Gate 1: 24h since last_consolidated (from SUMMARY.md)
 *   Gate 2: 5+ session_start events on this host since last consolidation (Tier 2 JSONL)
 *
 * @param {string} memoryDir - Base memory directory
 * @param {string} cwd - Current working directory (for readEvents)
 * @returns {{ gate1Open: boolean, gate2Open: boolean, bothOpen: boolean, lastConsolidated: string|null, sessionCount: number }}
 */
function checkDualGate(memoryDir, cwd) {
  const semanticDir = getSemanticDir(memoryDir);
  const summaryPath = path.join(semanticDir, 'SUMMARY.md');

  let lastConsolidated = null;
  let gate1Open = true;

  // Read last_consolidated from SUMMARY.md if it exists
  if (fs.existsSync(summaryPath)) {
    try {
      const content = fs.readFileSync(summaryPath, 'utf8');
      const match = content.match(/Last consolidated:\s*(.+?)(?:\n|$)/i);
      if (match) {
        // Try to parse the timestamp — may be "YYYY-MM-DD HH:MM UTC by <hostname>" or ISO
        const rawTs = match[1].trim().replace(/ by .+$/, '').trim();
        // Convert "YYYY-MM-DD HH:MM UTC" to ISO if needed
        const iso = rawTs.includes('T') ? rawTs : rawTs.replace(' ', 'T').replace(' UTC', 'Z');
        const parsed = new Date(iso);
        if (!isNaN(parsed.getTime())) {
          lastConsolidated = parsed.toISOString();
          const ageMs = Date.now() - parsed.getTime();
          gate1Open = ageMs >= COOLDOWN_MS;
        }
      }
    } catch {}
  }
  // If SUMMARY.md doesn't exist or can't be parsed: Gate 1 is open (first consolidation)

  // Gate 2: count session_start events since last consolidation across ALL hosts.
  // Multi-host aggregation: ryzen 3 sessions + macbook 3 sessions = 6 total.
  // Prior bug: filtered by os.hostname() so neither host alone reached threshold.
  let sessionCount = 0;
  try {
    const fromDate = lastConsolidated || undefined;
    const events = readEvents(cwd, 90, {
      fromDate,
      eventTypes: ['session_start'],
      // No host filter — aggregate all machines
    });
    sessionCount = events.length;
  } catch {}

  const gate2Open = sessionCount >= MIN_SESSIONS;

  return {
    gate1Open,
    gate2Open,
    bothOpen: gate1Open && gate2Open,
    lastConsolidated,
    sessionCount,
  };
}

/**
 * Generate a YAML frontmatter block for a Tier 3 semantic file.
 * Includes all required fields: name, description, type, tier, last_consolidated, source_sessions.
 *
 * @param {string} name - File name (e.g. "Session Patterns")
 * @param {string} description - One-line description
 * @param {string} type - Memory type: "project" | "feedback" | "user" | "reference"
 * @param {number} sessionCount - Number of sessions analyzed
 * @returns {string} YAML frontmatter block (with triple-dash delimiters)
 */
function makeFrontmatter(name, description, type, sessionCount) {
  const lastConsolidated = new Date().toISOString();
  return [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    `type: ${type}`,
    `tier: semantic`,
    `last_consolidated: ${lastConsolidated}`,
    `source_sessions: ${sessionCount}`,
    '---',
    '',
  ].join('\n');
}

/**
 * Build the content for the Tier 3 SUMMARY.md index file.
 *
 * @param {string} semanticDir - Path to memory/semantic/
 * @param {number} sessionCount - Number of sessions analyzed
 * @param {number} episodicCount - Number of episodic JSONL files read
 * @param {number} profileCount - Number of Tier 1 profile memory files read
 * @returns {string} Full markdown content for SUMMARY.md
 */
function buildSummary(semanticDir, sessionCount, episodicCount, profileCount) {
  const now = new Date();
  const utcStr = now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const hostname = os.hostname();

  const semanticFiles = [
    { file: 'session-patterns.md', description: 'Recurring patterns observed across sessions on this project' },
    { file: 'skill-health.md', description: 'Health status and usage trends for installed skills' },
    { file: 'recurring-issues.md', description: 'Problems that appear repeatedly across sessions' },
    { file: 'behavioral-drift.md', description: 'Observed changes in Claude behavior or output quality over time' },
  ];

  const tableRows = semanticFiles.map(({ file, description }) => {
    let lastUpdated = 'never';
    const filePath = path.join(semanticDir, file);
    if (fs.existsSync(filePath)) {
      try {
        const mtime = fs.statSync(filePath).mtime;
        lastUpdated = mtime.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
      } catch {}
    }
    return `| ${file} | ${description} | ${lastUpdated} |`;
  });

  return [
    '# Semantic Memory Index',
    '',
    `Last consolidated: ${utcStr} by ${hostname}`,
    `Sessions analyzed: ${sessionCount}`,
    `Source files: ${episodicCount} episodic JSONL + ${profileCount} profile memories`,
    '',
    '| File | Description | Last Updated |',
    '|------|-------------|--------------|',
    ...tableRows,
    '',
  ].join('\n');
}

module.exports = { getSemanticDir, archiveAndWrite, checkDualGate, makeFrontmatter, buildSummary };
