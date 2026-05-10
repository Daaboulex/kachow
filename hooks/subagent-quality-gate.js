#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// SubagentStop hook: Quality gate — check subagent output before accepting.
// Warns if subagent touched safety-critical files or produced empty output.
// Also removes the subagent-active marker file (counterpart to the write in
// subagent-harness-inject.js). Does NOT block — injects systemMessage.

const fs = require('fs');
const path = require('path');
const os = require('os');

try {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }
  const input = JSON.parse(raw);

  const lastMsg = input.last_assistant_message || '';
  const agentType = input.agent_type || '';
  const cwd = input.cwd || process.cwd();
  const sessionId = input.session_id || '';

  // ── Remove subagent-active marker ──
  // Counterpart to marker creation in subagent-harness-inject.js.
  // Markers keyed by session_id-pid. Clean up both new format and legacy format.
  if (sessionId) {
    try {
      const markerDir = require('./lib/tool-paths.js').subagentMarkerDir;
      // Clean ALL markers for this session (PID varies between hooks)
      try {
        for (const f of fs.readdirSync(markerDir)) {
          if (f.startsWith(sessionId + '-') && f.endsWith('.json')) {
            fs.unlinkSync(path.join(markerDir, f));
          }
        }
      } catch {}
      // Legacy format: session_id.json
      const legacyPath = path.join(markerDir, `${sessionId}.json`);
      if (fs.existsSync(legacyPath)) fs.unlinkSync(legacyPath);
    } catch (e) {
      try { process.stderr.write('subagent-quality-gate (marker cleanup): ' + e.message + '\n'); } catch {}
    }
  }

  const warnings = [];

  // Check for empty/minimal output (skip if no input data — hook test or no-op)
  if (lastMsg.length > 0 && lastMsg.length < 50) {
    warnings.push('Subagent produced very short output — may not have completed its task.');
  }

  // Check if safety-critical files were mentioned as modified
  const safetyPatterns = (process.env.KACHOW_SAFETY_FILE_PATTERNS || 'SafetyCritical,HardwareControl,FailSafe,WatchdogTimer,FlashControl,EmergencyStop').split(',').map(s => s.trim()).filter(Boolean);
  const touchedSafety = safetyPatterns.filter(p => lastMsg.includes(p));
  // Detect safety-critical project by trait, not name (configurable via KACHOW_SAFETY_DIRS)
  const hasSafetyCode = (process.env.KACHOW_SAFETY_DIRS || 'SafetyCritical,HardwareControl').split(',').map(s => s.trim()).filter(Boolean).some(d => {
    try { return fs.existsSync(require('path').join(cwd, d)) ||
                 fs.existsSync(require('path').join(cwd, '..', d)); } catch { return false; }
  });
  if (touchedSafety.length > 0 && hasSafetyCode) {
    warnings.push(`⚠ Subagent may have modified safety-critical files: ${touchedSafety.join(', ')}. Verify changes manually before accepting.`);
  }

  // Check for git commands in output (agents should never use git)
  if (/git (commit|push|add |checkout|reset|stash)/.test(lastMsg)) {
    warnings.push('Subagent may have used git commands — verify no unintended commits were made.');
  }

  // Check for adversarial review minimum findings
  const output = (input.output || '').toLowerCase();
  const isReview = output.includes('finding') && (output.includes('p0') || output.includes('p1') || output.includes('p2'));
  if (isReview) {
    const findingMatches = output.match(/###\s*finding\s+\d+/gi) || [];
    if (findingMatches.length < 3) {
      warnings.push('Review produced only ' + findingMatches.length + ' structured findings. Consider re-reviewing with deeper analysis.');
    }
  }

  // AI-progress.json subagent_log removed in v0.9.5 W4-FIX1.
  // Subagent audit trail moves to instances/subagent-blocks.jsonl (Release 2).

  if (warnings.length > 0) {
    process.stdout.write(JSON.stringify({
      continue: true,
      systemMessage: `[Subagent Quality Gate] ${warnings.join(' | ')}`
    }));
  } else {
    process.stdout.write('{"continue":true}');
  }
} catch (e) {
  process.stderr.write('subagent-quality-gate: ' + e.message + '\n');
  process.stdout.write('{"continue":true}');
}
