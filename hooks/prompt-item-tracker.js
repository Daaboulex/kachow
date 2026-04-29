#!/usr/bin/env node
// prompt-item-tracker.js — UserPromptSubmit
// Detects multi-item prompts (numbered, bulleted, lettered) and injects a
// tracking reminder so the model addresses ALL items, not just the first few.
// Core problem: scope drift — user gives N-item prompt, model does 1-3.
//
// Also persists extracted items to a session file so follow-up hooks or
// the next UserPromptSubmit can remind about items from the previous prompt
// that may still be pending.

const fs = require('fs');
const path = require('path');
const os = require('os');

function passthrough() {
  process.stdout.write(JSON.stringify({}));
  process.exit(0);
}

try {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { passthrough(); }
  const input = JSON.parse(raw || '{}');
  const prompt = (input.prompt || input.user_prompt || input.message ||
                  input?.hook_event_data?.user_prompt || '').toString().trim();

  if (!prompt || prompt.length < 20) passthrough();
  if (prompt.startsWith('/') || prompt.startsWith('!')) passthrough();

  const lines = prompt.split('\n').map(l => l.trim()).filter(Boolean);

  // ── Extract numbered items: "1.", "2)", "(3)", "1:"
  const numberedRe = /^(?:\(?(\d+)[.):]|\d+\.)\s+(.+)/;
  const numbered = [];
  for (const line of lines) {
    const m = line.match(numberedRe);
    if (m) numbered.push(line);
  }

  // ── Extract bullet items: "- ", "* ", "• "
  const bulletRe = /^[-*•]\s+(.+)/;
  const bullets = [];
  for (const line of lines) {
    if (bulletRe.test(line)) bullets.push(line);
  }

  // ── Extract lettered items: "a.", "b)", "A."
  const letteredRe = /^[a-zA-Z][.)]\s+(.+)/;
  const lettered = [];
  for (const line of lines) {
    if (letteredRe.test(line)) lettered.push(line);
  }

  // ── Extract bold-header sections: "**WORD:**" or "**WORD**"
  const boldSectionRe = /^\*\*[A-Z][A-Z0-9 _/-]+:?\*\*/;
  const boldSections = [];
  for (const line of lines) {
    if (boldSectionRe.test(line)) boldSections.push(line);
  }

  // Pick the largest group as the canonical items
  const groups = [
    { type: 'numbered', items: numbered },
    { type: 'bullet', items: bullets },
    { type: 'lettered', items: lettered },
    { type: 'bold-section', items: boldSections },
  ].sort((a, b) => b.items.length - a.items.length);

  const best = groups[0];

  // Only activate for multi-item prompts (3+ items)
  if (best.items.length < 3) {
    // Check for previous-prompt pending items
    injectPreviousReminder(input);
    return;
  }

  const itemCount = best.items.length;
  const cleanItem = (item) => item
    .replace(/^(?:\(?(\d+)[.):]|\d+\.)\s+/, '')  // strip leading numbers
    .replace(/^[-*•]\s+/, '')                     // strip bullets
    .replace(/^[a-zA-Z][.)]\s+/, '');             // strip letters
  const itemSummary = best.items
    .slice(0, 15) // cap at 15 to avoid huge injection
    .map((item, i) => `  ${i + 1}. ${cleanItem(item).slice(0, 120)}`)
    .join('\n');
  const truncated = best.items.length > 15 ? `\n  ... and ${best.items.length - 15} more` : '';

  // Persist items for follow-up reminder
  const sessionId = input.session_id || process.env.SESSION_ID || 'unknown';
  const trackDir = path.join(os.tmpdir(), 'claude-prompt-items');
  try { fs.mkdirSync(trackDir, { recursive: true }); } catch {}
  const trackFile = path.join(trackDir, `${String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
  try {
    fs.writeFileSync(trackFile, JSON.stringify({
      timestamp: new Date().toISOString(),
      count: itemCount,
      type: best.type,
      items: best.items.map(i => i.slice(0, 200)),
      turn: 0,
    }));
  } catch {}

  const msg = `[prompt-item-tracker] This prompt contains ${itemCount} discrete ${best.type} items:\n` +
    itemSummary + truncated + '\n' +
    `Track ALL ${itemCount} items. Address each one. Do not move on until all are covered or explicitly deferred.`;

  process.stdout.write(JSON.stringify({ additionalContext: msg }));
  process.exit(0);

} catch (e) {
  try { process.stderr.write('prompt-item-tracker: ' + e.message + '\n'); } catch {}
  passthrough();
}

function injectPreviousReminder(input) {
  try {
    const sessionId = input.session_id || process.env.SESSION_ID || 'unknown';
    const trackDir = path.join(os.tmpdir(), 'claude-prompt-items');
    const trackFile = path.join(trackDir, `${String(sessionId).replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
    if (!fs.existsSync(trackFile)) { passthrough(); return; }

    const data = JSON.parse(fs.readFileSync(trackFile, 'utf8'));
    data.turn = (data.turn || 0) + 1;

    // Stop reminding after 5 follow-up turns
    if (data.turn > 5) {
      try { fs.unlinkSync(trackFile); } catch {}
      passthrough();
      return;
    }

    fs.writeFileSync(trackFile, JSON.stringify(data));

    // Only remind on turns 2 and 4 (not every turn — that's annoying)
    if (data.turn === 2 || data.turn === 4) {
      const msg = `[prompt-item-tracker] Reminder: previous prompt had ${data.count} items (${data.type}). ` +
        `Ensure all were addressed. Items that weren't: acknowledge the gap or continue work.`;
      process.stdout.write(JSON.stringify({ additionalContext: msg }));
      process.exit(0);
    }

    passthrough();
  } catch {
    passthrough();
  }
}
