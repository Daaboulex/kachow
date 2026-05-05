#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// SubagentStop hook: log what subagents claim they accomplished.
// Enables post-hoc verification of agent claims.
// Pattern: jcode intent tracking + Hermes checkpoint verification.

const fs = require('fs');
const path = require('path');
const os = require('os');

try {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }
  const input = JSON.parse(raw);

  const sessionId = input.session_id || 'unknown';
  const cwd = input.cwd || process.cwd();

  // Extract subagent result summary
  const result = input.tool_response || {};
  const subagentType = input.tool_input?.subagent_type || 'fork';
  const description = input.tool_input?.description || '';
  const model = input.tool_input?.model || 'inherited';

  // Log the claim for verification
  try {
    const obs = require('./lib/observability-logger.js');
    obs.logEvent(cwd, {
      type: 'subagent_claim',
      source: 'subagent-claim-logger',
      session_id: sessionId,
      meta: {
        subagent_type: subagentType,
        description: description.slice(0, 200),
        model,
        result_length: JSON.stringify(result).length,
        timestamp: new Date().toISOString(),
      }
    });
  } catch {}

  // Also append to a per-session claims file for easy review
  const claimsDir = path.join(os.homedir(), '.ai-context', 'instances');
  fs.mkdirSync(claimsDir, { recursive: true });
  const claimsFile = path.join(claimsDir, 'subagent-claims.jsonl');
  const entry = {
    ts: new Date().toISOString(),
    session_id: sessionId,
    type: subagentType,
    description: description.slice(0, 200),
    model,
    claimed_result_preview: typeof result === 'string' ? result.slice(0, 300) : JSON.stringify(result).slice(0, 300),
  };
  fs.appendFileSync(claimsFile, JSON.stringify(entry) + '\n');

  process.stdout.write('{"continue":true}');
} catch (e) {
  try { process.stderr.write('subagent-claim-logger: ' + e.message + '\n'); } catch {}
  process.stdout.write('{"continue":true}');
}
