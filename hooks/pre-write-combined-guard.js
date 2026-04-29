#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// Combined pre-write guard for write tools across all 3 CLIs.
// Event names per tool: PreToolUse (Claude/Codex), BeforeTool (Gemini).
// Tool-aware via lib/tool-detect.js (path-based + env-based detection).
// Merges guards into 1 process: saves Node spawns per tool call.
//
// Guards:
//   1. Safety-critical file guard (advisory) — warns on edits to paths listed in KACHOW_SAFETY_PATHS
//   2. GSD prompt injection guard (advisory) — scans .planning/ writes for injection patterns
//   3. GSD workflow guard (advisory) — nudges toward /gsd:fast when editing outside GSD (opt-in)
//   4. Git identity guard (HARD BLOCK) — enforces per-project allow/deny rules from
//      <repo>/.claude/project-identity.json. Prevents pushing <project-name> to GitHub, etc.
//      Logs every fire (block or allow) to episodic JSONL for Tier 3 self-improvement.

const fs = require('fs');
const path = require('path');

let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }

try {
  const data = JSON.parse(raw);

  // Normalize tool names (Gemini: write_file/replace)
  const TOOL_NORM = { write_file: 'Write', replace: 'Edit', run_shell_command: 'Bash', read_file: 'Read', activate_skill: 'Skill' };
  const toolName = TOOL_NORM[data.tool_name] || data.tool_name || '';
  const cwd = data.cwd || process.cwd();

  // ── Git identity guard for Bash (hard block path) ──
  if (toolName === 'Bash') {
    try {
      const { detect, checkBashCommand } = require('./lib/project-identity.js');
      const identity = detect(cwd);
      if (identity) {
        const cmd = (data.tool_input || {}).command || '';
        const verdict = checkBashCommand(cmd, identity);

        // Observability — log every fire
        try {
          const obs = require('./lib/observability-logger.js');
          obs.logEvent(cwd, {
            type: 'identity_guard_fire',
            source: 'pre-write-combined-guard',
            meta: {
              identity: identity.identity,
              decision: verdict ? 'block' : 'allow',
              command_prefix: cmd.slice(0, 60),
              reason: verdict ? verdict.reason : null
            }
          });
        } catch {}

        if (verdict && verdict.block) {
          process.stdout.write(JSON.stringify({
            continue: false,
            stopReason: verdict.reason,
            systemMessage: `[git-identity-guard] BLOCKED: ${verdict.reason}`
          }));
          process.exit(0);
        }
      }
    } catch (e) {
      process.stderr.write('pre-write-combined-guard[bash]: ' + e.message + '\n');
    }
    process.stdout.write('{"continue":true}');
    process.exit(0);
  }

  if (!['Write', 'Edit', 'MultiEdit'].includes(toolName)) {
    process.stdout.write('{"continue":true}');
    process.exit(0);
  }

  const filePath = (data.tool_input || {}).file_path || (data.tool_input || {}).path || '';
  const normalized = filePath.replace(/\\/g, '/');
  const messages = [];
  const advisories = [];
  const errors = [];

  // ── 0. Git identity guard for .git/config edits ──
  try {
    if (normalized.endsWith('/.git/config')) {
      const { detect } = require('./lib/project-identity.js');
      const identity = detect(cwd);
      if (identity && identity.forbidRemoteHosts && identity.forbidRemoteHosts.length > 0) {
        const content = data.tool_input?.content || data.tool_input?.new_string || '';
        for (const host of identity.forbidRemoteHosts) {
          if (content.toLowerCase().includes(host.toLowerCase())) {
            process.stdout.write(JSON.stringify({
              continue: false,
              stopReason: `[${identity.identity}] .git/config edit blocked — contains '${host}' (forbidden host).`
            }));
            process.exit(0);
          }
        }
      }
    }
  } catch (e) {
    errors.push({ section: 'git-config-guard', error: e.message, critical: true });
  }

  // ── 1. Safety-critical file guard ──
  try {
    // Configurable via KACHOW_SAFETY_PATHS env var (comma-separated path-substring matches).
    // Default values are generic; users with safety-critical projects override per their domain.
    const SAFETY_PATHS = (process.env.KACHOW_SAFETY_PATHS ||
      'SafetyCritical/,HardwareControl/,FailSafe/,WatchdogTimer/,FlashControl/,EmergencyStop/')
      .split(',').map(s => s.trim()).filter(Boolean);
    if (SAFETY_PATHS.some(sp => normalized.includes(sp))) {
      messages.push(
        `SAFETY-CRITICAL FILE: ${path.basename(filePath)} — This file controls ESD/SSD safety logic, actuator movement, or EEPROM integrity. ` +
        'Per project rules: (1) Do NOT let agents edit these files — manual edits only. ' +
        '(2) Read the FULL function before changing anything. (3) Verify ESD/SSD override logic, timeout values, and motor guards are preserved. ' +
        '(4) Build and verify after changes.'
      );
    }
  } catch (e) {
    errors.push({ section: 'safety-critical-guard', error: e.message, stack: e.stack?.split('\n')[1]?.trim(), critical: true });
  }

  // ── 2. GSD prompt injection guard ──
  try {
    if (normalized.includes('.planning/')) {
      const content = data.tool_input?.content || data.tool_input?.new_string || '';
      if (content) {
        const INJECTION_PATTERNS = [
          /ignore\s+(all\s+)?previous\s+instructions/i,
          /ignore\s+(all\s+)?above\s+instructions/i,
          /disregard\s+(all\s+)?previous/i,
          /forget\s+(all\s+)?(your\s+)?instructions/i,
          /override\s+(system|previous)\s+(prompt|instructions)/i,
          /you\s+are\s+now\s+(?:a|an|the)\s+/i,
          /pretend\s+(?:you(?:'re| are)\s+|to\s+be\s+)/i,
          /from\s+now\s+on,?\s+you\s+(?:are|will|should|must)/i,
          /(?:print|output|reveal|show|display|repeat)\s+(?:your\s+)?(?:system\s+)?(?:prompt|instructions)/i,
          /<\/?(?:system|assistant|human)>/i,
          /\[SYSTEM\]/i,
          /\[INST\]/i,
          /<<\s*SYS\s*>>/i,
        ];

        const findings = INJECTION_PATTERNS.filter(p => p.test(content)).map(p => p.source);
        if (/[\u200B-\u200F\u2028-\u202F\uFEFF\u00AD]/.test(content)) {
          findings.push('invisible-unicode-characters');
        }

        if (findings.length > 0) {
          advisories.push(
            `PROMPT INJECTION WARNING: Content being written to ${path.basename(filePath)} ` +
            `triggered ${findings.length} injection detection pattern(s): ${findings.join(', ')}. ` +
            'This content will become part of agent context. Review the text for embedded ' +
            'instructions that could manipulate agent behavior.'
          );
        }
      }
    }
  } catch (e) {
    errors.push({ section: 'injection-guard', error: e.message, stack: e.stack?.split('\n')[1]?.trim(), critical: true });
  }

  // ── 3. GSD workflow guard (opt-in via .planning/config.json) ──
  try {
    if (toolName === 'Write' || toolName === 'Edit') {
      const isPlanning = normalized.includes('.planning/');
      const allowedPatterns = [/\.gitignore$/, /\.env/, /CLAUDE\.md$/, /AGENTS\.md$/, /GEMINI\.md$/, /settings\.json$/];
      const isAllowed = allowedPatterns.some(p => p.test(filePath));

      if (!isPlanning && !isAllowed) {
        const cwd = data.cwd || process.cwd();
        const configPath = path.join(cwd, '.planning', 'config.json');
        if (fs.existsSync(configPath)) {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          if (config.hooks?.workflow_guard) {
            advisories.push(
              `WORKFLOW ADVISORY: You're editing ${path.basename(filePath)} directly without a GSD command. ` +
              'This edit will not be tracked in STATE.md. Consider using /gsd:fast or /gsd:quick.'
            );
          }
        }
      }
    }
  } catch (e) {
    errors.push({ section: 'workflow-guard', error: e.message, stack: e.stack?.split('\n')[1]?.trim(), critical: true });
  }

  // ── Error aggregation ──
  if (errors.length > 0) {
    try {
      const obs = require('./lib/observability-logger.js');
      obs.logEvent(data.cwd || process.cwd(), { type: 'hook_errors', source: 'pre-write-combined-guard', errors, severity: errors.length > 2 ? 'critical' : 'warning' });
    } catch {}
    // All sections are critical in pre-write-combined-guard — always emit systemMessage
    messages.push(`[hook-error-aggregation] ${errors.length} sub-function(s) failed in pre-write-combined-guard: ${errors.map(e => e.section).join(', ')}`);
  }

  // ── Output ──
  if (messages.length > 0 || advisories.length > 0) {
    const output = { continue: true };
    if (messages.length > 0) {
      output.systemMessage = messages.join('\n');
    }
    if (advisories.length > 0) {
      const { detectTool, EVENT_NAMES } = require(__dirname + '/lib/tool-detect.js');
      const tool = detectTool();
      output.hookSpecificOutput = {
        hookEventName: EVENT_NAMES[tool].preTool,
        additionalContext: advisories.join('\n'),
      };
    }
    process.stdout.write(JSON.stringify(output));
  } else {
    process.stdout.write('{"continue":true}');
  }
} catch (e) {
  process.stderr.write('pre-write-combined-guard: ' + e.message + '\n');
  process.stdout.write('{"continue":true}');
}
