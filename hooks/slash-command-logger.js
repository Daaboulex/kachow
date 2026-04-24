#!/usr/bin/env node
// slash-command-logger.js
// UserPromptSubmit hook: greps prompt for ^/ slash command invocations
// and emits a slash_invoke episodic event (mirrors skill_invoke schema).
//
// Pivot from honest-review item #5: slash commands aren't tool invocations
// in Claude Code's model, so PostToolUse never fires for them. UserPromptSubmit
// is the only event surface that sees them server-side.

const TIMER_START = process.hrtime.bigint();
const fs = require('fs');

function emitTiming() {
  try {
    const total_ms = Number(process.hrtime.bigint() - TIMER_START) / 1e6;
    require('./lib/observability-logger.js').logEvent(process.cwd(), {
      type: 'hook_timing',
      source: 'slash-command-logger',
      meta: { total_ms: +total_ms.toFixed(3) },
    });
  } catch {}
}

let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }

try {
  const input = JSON.parse(raw);
  const prompt = (input.prompt || input.user_prompt || input.message || '').toString().trim();
  const lines = prompt.split('\n');
  const slashCommands = [];
  for (const line of lines) {
    const m = line.match(/^\/([a-zA-Z0-9:_-]+)/);
    if (m) slashCommands.push(m[1]);
  }
  if (slashCommands.length > 0) {
    try {
      require('./lib/observability-logger.js').logEvent(process.cwd(), {
        type: 'slash_invoke',
        source: 'slash-command-logger',
        meta: {
          commands: slashCommands,
          count: slashCommands.length,
          session_id: input.session_id || null,
        },
      });
    } catch {}
  }
} catch {}

emitTiming();
process.stdout.write('{"continue":true}');
