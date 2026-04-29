#!/usr/bin/env node
// rule-enforcement-check.js — PostToolUse hook on Agent tool
// Checks: did the Agent dispatch include a model: parameter?
// If not, warns via stderr (user-visible, model-invisible).
// Also checks: is Agent dispatching to haiku for WebFetch tasks?
// Enforces AGENTS.md § Agent Dispatch Rules.

const fs = require('fs');
const path = require('path');
const os = require('os');

function passthrough() {
  process.stdout.write('{"continue":true}');
  process.exit(0);
}

try {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }
  const input = JSON.parse(raw);

  // Only check Agent tool calls
  if (input.tool_name !== 'Agent') passthrough();

  const toolInput = input.tool_input || {};
  const model = toolInput.model;
  const prompt = (toolInput.prompt || '').toLowerCase();
  const description = (toolInput.description || '').toLowerCase();

  const warnings = [];

  // Rule 1: model param should always be specified
  if (!model) {
    warnings.push('Agent dispatched WITHOUT model: param — inherits parent model (likely opus). Add model: "sonnet" or "haiku".');
  }

  // Rule 2: WebFetch/WebSearch tasks should use sonnet, not haiku
  const isResearch = prompt.includes('webfetch') || prompt.includes('websearch') ||
    prompt.includes('research') || description.includes('research') ||
    prompt.includes('web fetch') || prompt.includes('web search');
  if (isResearch && model === 'haiku') {
    warnings.push('Research/WebFetch agent dispatched with haiku — haiku hallucinates ~20% web claims. Use sonnet.');
  }

  // Rule 3: Review/spot-check should use haiku (cost efficiency)
  const isReview = description.includes('review') || description.includes('verify') ||
    description.includes('spot-check') || description.includes('audit');
  if (isReview && model === 'opus') {
    warnings.push('Review/verify agent dispatched with opus — haiku is 5x cheaper and sufficient for file reads. Use haiku.');
  }

  if (warnings.length > 0) {
    process.stderr.write(`[rule-enforcer] ${warnings.join(' | ')}\n`);
  }

  // Log enforcement check
  const logDir = path.join(os.homedir(), '.ai-context', 'instances');
  fs.mkdirSync(logDir, { recursive: true });
  fs.appendFileSync(path.join(logDir, 'rule-enforcement.jsonl'), JSON.stringify({
    timestamp: new Date().toISOString(),
    session_id: input.session_id || 'unknown',
    model: model || 'MISSING',
    is_research: isResearch,
    is_review: isReview,
    warnings: warnings.length,
  }) + '\n');

} catch {}
passthrough();
