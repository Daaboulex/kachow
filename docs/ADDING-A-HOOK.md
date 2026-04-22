# Adding a hook

Hooks are Node.js scripts that read JSON on stdin, do work, and write JSON on stdout.

## Template

```javascript
#!/usr/bin/env node
// my-hook.js — describes what it does in one sentence

const fs = require('fs');
const path = require('path');
const os = require('os');

let input = '';
try { input = fs.readFileSync(0, 'utf8'); } catch {}
let evt;
try { evt = JSON.parse(input); } catch { process.exit(0); }

// Gate on tool/matcher if needed
if (evt.tool_name !== 'Bash') process.exit(0);

// Do work — side effects / file writes OK

// Signal continue to the harness
process.stdout.write(JSON.stringify({ continue: true }));
```

## Register in both surfaces

Append to `settings.template.json` under the right event:

```json
{
  "matcher": "Bash",
  "hooks": [
    {
      "type": "command",
      "command": "node \"$HOME/.claude/hooks/my-hook.js\"",
      "timeout": 3
    }
  ]
}
```

And to `settings.gemini.template.json` — note `ms` timeout + different tool name.

## Add a selftest

Open `hooks/lib/hook-selftest.js`. Append to `SPECS`:

```javascript
{
  hook: 'my-hook.js',
  event: 'PreToolUse',
  tests: [
    { name: 'passes on ls', stdin: '{"tool_name":"Bash","tool_input":{"command":"ls"}}', expect: { exit: 0 } }
  ]
}
```

Run `node hooks/lib/hook-selftest.js` — must pass before commit.
