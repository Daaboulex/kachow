# Drop-in auto-adapt

The framework is designed to coexist with any AI-tooling setup you already have. Install it, use what you want, keep your own stuff.

## What install-adapters.sh does (and doesn't)

**Does:**
- Create symlinks from `~/.claude/CLAUDE.md` → `~/.ai-context/AGENTS.md` (same for Gemini, Codex, OpenCode, Aider).
- Back up any pre-existing file to `<path>.pre-ai-context-bak-<timestamp>` before linking.

**Does not:**
- Touch your existing hooks under `~/.claude/hooks/*`.
- Modify existing `mcpServers` — just adds `personal-context` alongside.
- Change anything under `~/.claude/commands/`, `~/.claude/agents/`, or plugin-installed dirs.
- Override your `settings.json` permissions or env vars.

## Your custom rules live between USER SECTION markers

In `AGENTS.md`:

```markdown
<!-- USER SECTION — keep your edits here; framework updates preserve this block -->
## My custom rules

- My preferences
- Project-specific identity
- Whatever

<!-- END USER SECTION -->
```

The framework's `customize.sh` writes the user section once during first install. Subsequent `bootstrap.sh` invocations only replace content OUTSIDE the markers. Your custom block survives forever.

## Hooks: framework vs user

```
~/.claude/hooks/           ← mixed: framework hooks + your hooks
~/.claude/hooks/lib/       ← shared libs (both use these)
```

Framework hooks are named generically (`bandaid-loop-detector.js`, `memory-rotate.js`, etc.). If you want your own hook that shouldn't be overwritten by framework updates, name it with a `user-` prefix:

```
~/.claude/hooks/user-my-custom-hook.js
```

Install scripts treat `user-*.js` as untouchable.

## Settings: layered merge

Framework writes `settings.template.json` fields into `settings.json` on first install, preserving any existing keys the user added. Subsequent updates only touch keys the framework manages (hooks array, plugin defaults). User-added env vars, permissions, and overrides persist.

## MCP: append-only

`install-mcp.sh` only ADDS `personal-context` to `mcpServers`. Existing entries untouched. Re-run after installing a new MCP-capable AI tool.

## Uninstall

Everything is files. To remove:

```bash
# Remove symlinks, restore any backups
for f in ~/.claude/CLAUDE.md ~/.gemini/GEMINI.md ~/.codex/AGENTS.md \
         ~/.config/opencode/AGENTS.md ~/.config/aider/AGENTS.md; do
  [ -L "$f" ] && rm "$f"
  latest_bak=$(ls -t "${f}.pre-ai-context-bak-"* 2>/dev/null | head -1)
  [ -n "$latest_bak" ] && mv "$latest_bak" "$f"
done
rm -rf ~/.ai-context
```

Hooks and MCP entries remain — delete them from `settings.json` + `~/.claude.json` manually if you want a full clean.
