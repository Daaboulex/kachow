#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// UserPromptSubmit hook: soft nudge for ambiguous prompts.
// Counters Opus 4.7 anti-clarification bias (per Anthropic docs: model is
// biased AGAINST asking clarifying questions and TOWARD acting). When the
// user prompt is genuinely ambiguous, the harness is the only place that
// can intervene — the model itself will not ask.
//
// Soft nudge ONLY — never blocks. Adds a single systemMessage line if the
// prompt matches one of these signals:
//   1. Action verb without object: "fix it", "do that", "change them"
//   2. Pronoun with no recent antecedent: "it"/"that"/"this"/"them" alone
//   3. 3+ disjunctions: "X or Y or Z" — model will pick wrong branch
//
// Idempotent across turns: only fires once per N-turn window per session
// (cache marker prevents repeat-nudges in long ambiguous threads).
//
// Disable: SKIP_CLARITY_CHECK=1
// Source spec: 2026-04-25-architecture-audit-master.md (R-AUDIT-3 + R-AUDIT-5).

const fs = require('fs');
const path = require('path');
const os = require('os');

function passthrough() {
  process.stdout.write('{"continue":true}');
  process.exit(0);
}

try {
  if (process.env.SKIP_CLARITY_CHECK === '1') passthrough();

  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { passthrough(); }
  const input = JSON.parse(raw || '{}');

  const prompt = (input.prompt || input.user_prompt || input.message || '').toString();
  if (!prompt || prompt.trim().length < 4) passthrough();

  // Skip slash commands — already a structured invocation
  if (prompt.trim().startsWith('/')) passthrough();
  // Skip bash-prefix — local execution, not a Claude turn
  if (prompt.trim().startsWith('!')) passthrough();
  // Skip very long prompts — assume well-specified or pasted artifact
  if (prompt.length > 2000) passthrough();

  const trimmed = prompt.trim().toLowerCase();
  const signals = [];

  // ── Signal 1: action verb without object ──
  // Patterns like "fix it", "fix the issue", "do that", "change them"
  const actionNoObjectPatterns = [
    /^(fix|do|change|update|edit|modify|delete|remove|add|build|run|make|implement|handle|solve|address|tackle)\s+(it|that|this|them|those|these)\s*\.?\s*$/,
    /^(fix|do|change|update|edit|modify)\s*\.?\s*$/,
    /^please\s+(fix|do|change|update|edit|handle|address|tackle|implement|run|make)(\s+(it|that|this|them|those|these))?\s*\.?\s*$/,
  ];
  if (actionNoObjectPatterns.some(re => re.test(trimmed))) {
    signals.push('action verb without specified object (e.g. "fix it")');
  }

  // ── Signal 2: bare pronoun with no antecedent in prompt itself ──
  // Catch single-line prompts that consist mainly of "it"/"that"
  const barePronoun = /^(it|that|this|them|those|these)\b/.test(trimmed) && trimmed.length < 60;
  if (barePronoun) {
    signals.push('opening pronoun without antecedent');
  }

  // ── Signal 3: 3+ disjunctions ──
  const disjunctionCount = (trimmed.match(/\bor\b/g) || []).length;
  if (disjunctionCount >= 3) {
    signals.push(`${disjunctionCount} disjunctions ("X or Y or Z…") — pick or ask`);
  }

  // ── Signal 4: ambiguous quantifiers ──
  if (/\b(some|few|several|many)\s+(of\s+)?(them|those|these|the\s+(things|stuff|files|hooks))\b/.test(trimmed)) {
    signals.push('ambiguous quantifier ("some of them")');
  }

  if (signals.length === 0) passthrough();

  // ── Idempotency: don't nudge same session twice within 30 minutes ──
  const sessionId = input.session_id || '';
  if (sessionId) {
    const cacheDir = path.join(os.tmpdir(), 'claude-clarity-check');
    try { fs.mkdirSync(cacheDir, { recursive: true }); } catch {}
    const marker = path.join(cacheDir, `${String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '_')}.flag`);
    if (fs.existsSync(marker)) {
      try {
        const mtime = fs.statSync(marker).mtimeMs;
        if (Date.now() - mtime < 30 * 60 * 1000) passthrough();
      } catch {}
    }
    try { fs.writeFileSync(marker, String(Date.now())); } catch {}
  }

  const msg = `[Clarity check] Prompt may be ambiguous: ${signals.join('; ')}. ` +
              `Opus 4.7 is biased against asking clarifying questions and toward acting. ` +
              `Before tool calls: restate intent in one sentence using concrete nouns + file paths, ` +
              `OR ask one targeted clarifying question if the referent is genuinely missing.`;

  process.stdout.write(JSON.stringify({
    continue: true,
    systemMessage: msg,
  }));
  process.exit(0);
} catch (e) {
  try { process.stderr.write('prompt-clarity-check: ' + e.message + '\n'); } catch {}
  passthrough();
}
