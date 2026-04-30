// observability-logger.js — Phase 2 Layer B custom JSONL writer
//
// Provides a common write interface for events that Claude Code's native
// OTel surface doesn't cover: per-machine hook fires, memory mutations,
// sync-conflict-cleaner runs, /reflect outputs, session boundary events.
//
// Writes to per-machine, per-day JSONL files at:
//   ~/.claude/projects/<project>/memory/episodic/YYYY-MM-DD-<hostname>.jsonl
//
// Per-machine filenames guarantee zero Syncthing conflicts:
// each host only writes to its own daily file. Reads all daily files for
// a complete cross-machine picture.
//
// Phase 2 REQ-02-03 / REQ-02-04. Spec: ~/Documents/.superpowers/specs/2026-04-10-ai-system-upgrade.md

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOSTNAME = os.hostname();

/**
 * Get the episodic log file path for today on this machine.
 *
 * Priority order (first match wins):
 *   1. <cwd>/.ai-context/memory/episodic/  — NixOS/nix-style project with .ai-context dir
 *   2. <cwd>/.claude/memory/episodic/      — local-private style project with .claude dir
 *   3. ~/.claude/projects/<sanitized>/memory/episodic/  — fallback for any cwd (auto-memory)
 *
 * Rationale: .ai-context takes precedence so nix projects (which symlink .claude into
 * .ai-context) don't double-write. Projects using only .claude work normally. Fallback
 * ensures non-project cwds still get tracked.
 *
 * @param {string} cwd - Current working directory (determines project)
 * @returns {string|null} - File path or null if no memory dir found
 */
function getEpisodicPath(cwd) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

  // Priority: .ai-context/memory > .claude/memory > ~/.claude/projects/<sanitized>/memory
  for (const candidate of [
    path.join(cwd, '.ai-context', 'memory', 'episodic'),
    path.join(cwd, '.claude', 'memory', 'episodic'),
  ]) {
    const parent = path.dirname(candidate);
    if (fs.existsSync(parent)) {
      return path.join(candidate, `${today}-${HOSTNAME}.jsonl`);
    }
  }

  // Fallback: use the global project memory path.
  // Match native Claude Code's sanitization (keeps leading dash from leading slash).
  const sanitized = cwd.replace(/\//g, '-');
  const globalMemory = path.join(claudeDir, 'projects', sanitized, 'memory', 'episodic');
  return path.join(globalMemory, `${today}-${HOSTNAME}.jsonl`);
}

/**
 * Log an episodic event.
 * @param {string} cwd - Current working directory
 * @param {object} event - Event to log
 * @param {string} event.type - Event type (hook_fire, memory_mutation, skill_invoke, etc.)
 * @param {string} event.source - What produced this event (hook name, skill name, etc.)
 * @param {string} [event.tool] - Tool that triggered the event (if applicable)
 * @param {string} [event.file] - File that was affected (if applicable)
 * @param {boolean} [event.success] - Whether the operation succeeded
 * @param {number} [event.duration_ms] - Duration in milliseconds
 * @param {string} [event.error] - Error message if failed
 * @param {object} [event.meta] - Additional metadata
 * @param {string} [sessionId] - Session UUID from Claude Code hook input
 */
function logEvent(cwd, event, sessionId) {
  try {
    const filePath = getEpisodicPath(cwd);
    if (!filePath) return;

    // Ensure directory exists
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });

    // Build spec-compliant entry (Section 4 schema):
    //   { ts, type, session_id, host, source, payload, ...legacy fields }
    // Spread event first for backward compat (old readers look for top-level fields like meta),
    // then override with spec fields so new readers always find session_id and payload.
    const entry = {
      ts: new Date().toISOString(),
      host: HOSTNAME,
      ...event,
      session_id: sessionId || event.session_id || null,
      payload: event.payload || event.meta || {},
    };

    // Append-only write — safe under concurrent access (each machine has its own file)
    fs.appendFileSync(filePath, JSON.stringify(entry) + '\n');
  } catch {
    // Never throw — observability must not break the caller
  }
}

/**
 * Read all episodic events for a date range across all machines.
 * Checks both the new slug (with leading dash, matching native Claude Code) and
 * the old slug (without leading dash, from earlier versions) so existing JSONL
 * files remain readable after the slug fix.
 *
 * @param {string} cwd - Current working directory
 * @param {number} [days=7] - Number of days to look back
 * @param {object} [options={}] - Optional filters
 * @param {string} [options.fromDate] - ISO-8601 string; only return events with ts >= fromDate
 * @param {string} [options.toDate] - ISO-8601 string; only return events with ts <= toDate
 * @param {string[]} [options.eventTypes] - Only return events whose type is in this array
 * @param {string} [options.host] - Only return events from this hostname
 * @param {number} [options.limit] - Max events to return (early termination to bound memory)
 * @returns {object[]} - Parsed events, sorted by timestamp
 */
function readEvents(cwd, days = 7, options = {}) {
  const { fromDate, toDate, eventTypes, host, limit } = options;
  const events = [];
  const filePath = getEpisodicPath(cwd);
  if (!filePath) return events;

  const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

  // Primary directory (new slug with leading dash)
  const primaryDir = path.dirname(filePath);

  // Also check the old-style slug (without leading dash) for backward compat
  const altSanitized = cwd.replace(/\//g, '-').replace(/^-/, '');
  const altDir = path.join(claudeDir, 'projects', altSanitized, 'memory', 'episodic');

  // Collect all dirs to scan (deduplicated)
  const dirs = [primaryDir];
  if (altDir !== primaryDir && fs.existsSync(altDir)) {
    dirs.push(altDir);
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.jsonl')) continue;
        // Extract date from filename: YYYY-MM-DD-hostname.jsonl
        const dateMatch = f.match(/^(\d{4}-\d{2}-\d{2})-/);
        if (!dateMatch || dateMatch[1] < cutoffStr) continue;

        const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const event = JSON.parse(line);
            // Apply filters
            if (fromDate && event.ts < fromDate) continue;
            if (toDate && event.ts > toDate) continue;
            if (eventTypes && eventTypes.length > 0 && !eventTypes.includes(event.type)) continue;
            if (host && event.host !== host) continue;
            events.push(event);
            // Early termination if limit reached (bounds memory for long time windows)
            if (limit && events.length >= limit) return events.sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));
          } catch {}
        }
      }
    } catch {}
  }

  return events.sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));
}

module.exports = { logEvent, readEvents, getEpisodicPath, HOSTNAME };
