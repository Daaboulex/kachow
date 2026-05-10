#!/usr/bin/env node
// rule-enforcement-check.js — PostToolUse hook on Agent tool
// Enforces AGENTS.md § Agent Dispatch Rules using MODEL_POLICY from constants.
// Tracks model usage per category for cost analysis.
// Also checks: is Agent dispatching to haiku for WebFetch tasks?

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

  if (input.tool_name !== 'Agent') passthrough();

  const { MODEL_POLICY, MODEL_COST_MULTIPLIER } = require('./lib/constants.js');
  const toolInput = input.tool_input || {};
  const rawModel = toolInput.model;
  const model = rawModel ? (rawModel.includes('haiku') ? 'haiku' : rawModel.includes('opus') ? 'opus' : rawModel.includes('sonnet') ? 'sonnet' : rawModel) : null;
  const prompt = (toolInput.prompt || '').toLowerCase();
  const description = (toolInput.description || '').toLowerCase();
  const subagentType = toolInput.subagent_type || '';

  // Classify task category from prompt/description/subagent_type
  function classifyTask() {
    if (prompt.includes('webfetch') || prompt.includes('websearch') ||
        prompt.includes('research') || description.includes('research') ||
        prompt.includes('web fetch') || prompt.includes('web search') ||
        subagentType.includes('researcher')) return 'research';
    if (description.includes('review') || description.includes('verify') ||
        description.includes('spot-check') || description.includes('audit') ||
        subagentType.includes('reviewer')) return 'review';
    if (description.includes('plan') || description.includes('architect') ||
        description.includes('design') || subagentType.includes('plan')) return 'architecture';
    if (description.includes('implement') || description.includes('build') ||
        description.includes('create') || description.includes('fix') ||
        description.includes('write')) return 'implementation';
    return 'implementation'; // default
  }

  const category = classifyTask();
  const recommended = MODEL_POLICY[category] || 'sonnet';
  const warnings = [];

  // Rule 1: model param should always be specified
  if (!model) {
    warnings.push(`Agent dispatched WITHOUT model: param (category: ${category}, recommended: ${recommended}). Add model: "${recommended}".`);
  }

  // Rule 2: WebFetch/research tasks should not use haiku
  if (category === 'research' && model === 'haiku') {
    warnings.push(`Research agent dispatched with haiku — haiku hallucinates ~20% web claims. Policy: ${recommended}.`);
  }

  // Rule 3: Review/spot-check should use haiku (cost efficiency)
  if (category === 'review' && model === 'opus') {
    warnings.push(`Review agent dispatched with opus — haiku is sufficient and 25x cheaper. Policy: ${recommended}.`);
  }

  // Rule 4: General policy mismatch (informational, not blocking)
  if (model && model !== recommended && warnings.length === 0) {
    // Only warn if it's a more expensive model than recommended
    const actualCost = MODEL_COST_MULTIPLIER[model] || 5;
    const recommendedCost = MODEL_COST_MULTIPLIER[recommended] || 5;
    if (actualCost > recommendedCost * 2) {
      warnings.push(`Agent uses ${model} for ${category} task — policy recommends ${recommended} (${actualCost}x vs ${recommendedCost}x cost).`);
    }
  }

  // Rule 5: dependency check — does prompt reference files that don't exist?
  const pathMatches = prompt.match(/~\/[.\w\-\/]+\.\w+/g) || [];
  for (const p of pathMatches) {
    const expanded = p.replace('~', os.homedir());
    if (!fs.existsSync(expanded)) {
      warnings.push(`Agent prompt references non-existent file: ${p} — possible dependency violation`);
    }
  }

  if (warnings.length > 0) {
    process.stderr.write(`[rule-enforcer] ${warnings.join(' | ')}\n`);
  }

  // Log enforcement check with category + cost tracking
  const logDir = path.join(os.homedir(), '.ai-context', 'instances');
  fs.mkdirSync(logDir, { recursive: true });
  fs.appendFileSync(path.join(logDir, 'rule-enforcement.jsonl'), JSON.stringify({
    timestamp: new Date().toISOString(),
    session_id: input.session_id || 'unknown',
    model: model || 'MISSING',
    category,
    recommended,
    cost_multiplier: MODEL_COST_MULTIPLIER[model] || 0,
    warnings: warnings.length,
    subagent_type: subagentType || null,
  }) + '\n');

} catch {}
passthrough();
