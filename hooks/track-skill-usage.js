#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// Stop hook: Track which skills were invoked during the session.
// Writes to ~/.claude/skill-usage.json — consumed by /consolidate-memory for staleness analysis.
// Lightweight: only reads stdin for session context, appends one entry.

const fs = require('fs');
const path = require('path');

const os = require('os');

// Detect platform from script location
const scriptDir = __dirname;
const isGemini = scriptDir.includes('.gemini');
const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
const { toolHomeDir } = require('./lib/tool-detect.js');
const configDir = toolHomeDir();

const USAGE_FILE = path.join(configDir, 'skill-usage.json');
const MAX_ENTRIES = 500; // Rolling window — prevents unbounded growth

try {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }
  const input = JSON.parse(raw);

  // Extract session info
  const sessionId = input.session_id || 'unknown';
  const cwd = input.cwd || process.cwd();
  const project = path.basename(cwd);

  // Read skills from the real-time invocation log (written by skill-invocation-logger.js)
  // This is the PRIMARY source — the PostToolUse hook logs each Skill invocation as it happens
  // RC-002: rename-before-read pattern to prevent race with concurrent appenders
  let skillsUsed = [];
  try {
    const logFile = path.join(configDir, `.skill-log-${sessionId}.jsonl`);
    if (fs.existsSync(logFile)) {
      // Rename to .reading first (atomic on POSIX) so appends from racing writers
      // go to a fresh file instead of one we're about to delete
      const readingFile = `${logFile}.reading-${process.pid}`;
      let readFrom = logFile;
      try {
        fs.renameSync(logFile, readingFile);
        readFrom = readingFile;
      } catch {} // fall back to reading original if rename fails

      try {
        const lines = fs.readFileSync(readFrom, 'utf8').trim().split('\n');
        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            if (entry.skill && !skillsUsed.includes(entry.skill)) {
              skillsUsed.push(entry.skill);
            }
          } catch {}
        }
      } finally {
        // Clean up read file (original or renamed)
        try { fs.unlinkSync(readFrom); } catch {}
      }
    }
  } catch (e) {
    try { process.stderr.write(`track-skill-usage log-read: ${e.message}\n`); } catch {}
  }

  // Fallback: try parsing from hook input (may not contain transcript)
  if (skillsUsed.length === 0) {
    try {
      const transcript = input.transcript || input.messages || [];
      if (Array.isArray(transcript)) {
        for (const msg of transcript) {
          const content = typeof msg === 'string' ? msg : JSON.stringify(msg);
          const skillMatches = content.match(/(?:skill|Skill|activate_skill)[:\s]*["']([^"']+)/g);
          if (skillMatches) {
            for (const m of skillMatches) {
              const name = m.replace(/.*["']/, '').replace(/["']$/, '');
              if (name && !skillsUsed.includes(name)) skillsUsed.push(name);
            }
          }
        }
      }
    } catch {}
  }

  // Update skill-lineage.json if skills were used
  if (skillsUsed.length > 0) {
    const lineagePath = path.join(configDir, 'skill-lineage.json');
    try {
      let lineage = { version: '1.0.0', skills: {}, evolution_modes: {} };
      if (fs.existsSync(lineagePath)) {
        try {
          lineage = JSON.parse(fs.readFileSync(lineagePath, 'utf8'));
          // MV-001: schema validation — if file is corrupted, back it up before overwriting
          if (typeof lineage !== 'object' || lineage === null) {
            throw new Error('skill-lineage.json not an object');
          }
        } catch (parseErr) {
          // Backup corrupted file before resetting (don't silently lose data)
          try {
            const backup = lineagePath + `.corrupted-${Date.now()}`;
            fs.copyFileSync(lineagePath, backup);
            process.stderr.write(`track-skill-usage: skill-lineage.json corrupted, backed up to ${backup}: ${parseErr.message}\n`);
          } catch {}
          lineage = { version: '1.0.0', skills: {}, evolution_modes: {} };
        }
      }
      if (!lineage.skills) lineage.skills = {};
      for (const skill of skillsUsed) {
        if (lineage.skills[skill]) {
          // Increment existing entry
          lineage.skills[skill].metrics.invocations = (lineage.skills[skill].metrics.invocations || 0) + 1;
        } else {
          // Auto-create entry for newly observed skills
          lineage.skills[skill] = {
            current_version: '1.0.0',
            origin: 'AUTO_DISCOVERED',
            created: new Date().toISOString().split('T')[0],
            history: [{
              version: '1.0.0',
              date: new Date().toISOString().split('T')[0],
              origin: 'AUTO_DISCOVERED',
              note: `First observed via skill-invocation-logger`
            }],
            metrics: { invocations: 1, successes: 0, corrections: 0 }
          };
        }
      }
      // Atomic write via temp+rename to avoid partial-write corruption
      const tmpPath = lineagePath + `.tmp-${process.pid}-${Date.now()}`;
      fs.writeFileSync(tmpPath, JSON.stringify(lineage, null, 2));
      fs.renameSync(tmpPath, lineagePath);
    } catch (e) {
      try { process.stderr.write(`track-skill-usage lineage: ${e.message}\n`); } catch {}
    }
  }

  // Load existing usage data
  let usage = { sessions: [], stats: {}, total_sessions: 0 };
  if (fs.existsSync(USAGE_FILE)) {
    try {
      usage = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'));
    } catch {
      usage = { sessions: [], stats: {}, total_sessions: 0 };
    }
  }

  // Always increment total session count (for analytics even without skills)
  if (!Array.isArray(usage.sessions)) usage.sessions = [];
  usage.total_sessions = (usage.total_sessions || 0) + 1;

  // Only store sessions with actual skill usage (saves ~140KB of empty entries)
  if (skillsUsed.length > 0) {
    const entry = {
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      project: project,
      skills_used: skillsUsed,
      note: `auto-tracked: ${skillsUsed.join(', ')}`
    };
    usage.sessions.push(entry);

    // Trim to MAX_ENTRIES (rolling window of skill-using sessions only)
    if (usage.sessions.length > MAX_ENTRIES) {
      usage.sessions = usage.sessions.slice(-MAX_ENTRIES);
    }
  }

  // Write back atomically (MV-001: temp+rename prevents torn writes)
  const usageTmp = USAGE_FILE + `.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(usageTmp, JSON.stringify(usage, null, 2));
  fs.renameSync(usageTmp, USAGE_FILE);

  // Observability: emit skill usage summary for the session
  if (skillsUsed.length > 0) {
    try { require('./lib/observability-logger.js').logEvent(cwd, { type: 'skill_usage_summary', source: 'track-skill-usage', meta: { skills: skillsUsed, sessionId } }); } catch {}
  }

  process.stdout.write('{"continue":true}');
} catch (e) {
  // Never block session end
  process.stderr.write('track-skill-usage: ' + e.message + '\n');
  process.stdout.write('{"continue":true}');
}
