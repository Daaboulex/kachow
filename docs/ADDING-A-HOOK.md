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

## Register via MANIFEST (v0.7.0+)

Add an entry to `scripts/MANIFEST.yaml`:

```yaml
  - file: my-hook.js
    category: safety            # or: meta, memory, observability, sync
    tools: [claude, gemini, codex]
    order: 50                   # execution order within event
    async: false                # true = non-blocking (no stdout/exit(2))
    events:
      claude:
        - event: PreToolUse
          matcher: [Bash]
          timeout: 3            # seconds (Claude)
      gemini:
        - event: BeforeTool
          matcher: [run_shell_command]
          timeout: 3000         # milliseconds (Gemini)
      codex:
        - event: PreToolUse
          matcher: [shell]
          timeout: 3            # seconds (Codex)
```

Then regenerate all settings files:

```bash
node scripts/generate-settings.mjs --apply --all
```

This writes Claude `settings.json`, Gemini `settings.json`, and Codex `config.toml` from the single MANIFEST source. Run `--check` instead of `--apply` to preview without writing.

**Event name translation** (handled automatically by the generator):

| Claude | Gemini | Codex |
|--------|--------|-------|
| SessionStart | SessionStart | SessionStart |
| PreToolUse | BeforeTool | PreToolUse |
| PostToolUse | AfterTool | PostToolUse |
| Stop | SessionEnd | Stop |
| PreCompact | PreCompress | *(not supported)* |
| SubagentStart | BeforeAgent | *(not supported)* |
| SubagentStop | AfterAgent | *(not supported)* |

**Tool name translation** (matchers):

| Claude | Gemini | Codex |
|--------|--------|-------|
| Bash | run_shell_command | shell |
| Write | write_file | apply_patch |
| Edit | replace | apply_patch |
| Read | read_file | Read |

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
