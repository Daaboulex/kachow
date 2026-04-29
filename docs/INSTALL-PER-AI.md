# Install — per AI tool

Step-by-step install tutorials for each supported AI. Pick the one(s) you use. Install order doesn't matter; bootstrap only configures tools it finds.

**Prerequisites (all tools):**
- Node.js ≥20 (`node --version`)
- git
- 2 minutes

**Common step (run once, regardless of AI):**

```bash
git clone https://github.com/Daaboulex/kachow ~/.ai-context
cd ~/.ai-context
./scripts/customize.mjs    # asks which AIs + add-ons you have
./scripts/bootstrap.mjs    # installs symlinks + hooks + MCP + runs health-check
```

Windows equivalent (PowerShell 7+, Developer Mode enabled):

```powershell
git clone https://github.com/Daaboulex/kachow "$HOME\.ai-context"
cd "$HOME\.ai-context"
.\scripts\customize.ps1
.\scripts\bootstrap.ps1
```

After bootstrap, your rules + hooks + MCP are installed for every AI below that you actually have. Missing AIs are silently skipped.

---

## Claude Code

**Files populated:**
```
~/.claude/CLAUDE.md                → symlink to ~/.ai-context/AGENTS.md
~/.claude/settings.json            → seeded from settings.template.json (if missing)
~/.claude/hooks/*.js               → copied from ~/.ai-context/hooks/
~/.claude/hooks/lib/*.js           → copied from ~/.ai-context/hooks/lib/
~/.claude/hooks/tests/*.sh         → runnable unit + lifecycle tests
~/.claude/commands/*.md            → copied from ~/.ai-context/commands/
~/.claude/memory                   → symlink to ~/.ai-context/memory/
~/.claude.json → mcpServers.personal-context → registered
```

**Verify:**
```bash
# 1. Rule file resolves
cat ~/.claude/CLAUDE.md | head -5

# 2. Hooks present
ls ~/.claude/hooks/*.js | wc -l    # expect >30

# 3. MCP registered
node -e 'console.log(require("os").homedir()+"/.claude.json"); console.log(JSON.parse(require("fs").readFileSync(require("os").homedir()+"/.claude.json","utf8")).mcpServers)'

# 4. Health
bash ~/.ai-context/scripts/health-check.mjs
```

**First session after install:** Claude Code will show you an `⚡ HANDOFF`, memory index, and self-improvement queue in the session-start banner. Zero manual steps.

**Key slash commands** (in `~/.claude/commands/`):
- `/handoff` — save a compressed session snapshot
- `/wrap-up` — end-of-session reflector + sync
- `/consolidate-memory` — dedupe + archive old memories
- `/memory` — search memory for a substring
- `/reflect` — analyze the session for unsaved corrections
- `/review-improvements` — triage self-improvement queue

**Disable the auto-context loader** (if too chatty):
```bash
# Remove session-context-loader entry from ~/.claude/settings.json → hooks.SessionStart
```

**Uninstall:**
```bash
bash ~/.ai-context/scripts/uninstall.mjs --yes
```

---

## Gemini CLI

**Files populated:**
```
~/.gemini/GEMINI.md                → symlink to ~/.ai-context/AGENTS.md
~/.gemini/settings.json            → seeded from template; timeouts translated ms → * for Gemini
~/.gemini/hooks/*.js               → copied
~/.gemini/commands/*.md            → copied
~/.gemini/memory                   → symlink
~/.gemini/settings.json → mcpServers.personal-context → registered
```

**Gemini-specific gotchas:**
1. **Hook event names differ.** Gemini uses `BeforeTool` / `AfterTool` / `SessionEnd` instead of Claude's `PreToolUse` / `PostToolUse` / `Stop`. Kachow's template maps these correctly.
2. **Timeout units differ.** Claude timeouts are in seconds; Gemini in milliseconds. `install-hooks.sh` translates when seeding Gemini's settings.
3. **Skills activate by description, not slash commands.** Claude skills with terse descriptions may not trigger in Gemini. `scripts/validate-skills.js` surfaces skills whose descriptions are too short for Gemini's semantic retrieval.
4. **MCP tool names must not collide.** Kachow uses `personal-context` namespace — safe.

**Verify:**
```bash
cat ~/.gemini/GEMINI.md | head -5
ls ~/.gemini/hooks/*.js | wc -l
node -e 'console.log(JSON.parse(require("fs").readFileSync(require("os").homedir()+"/.gemini/settings.json","utf8")).mcpServers)'
```

**First session after install:** Gemini CLI reads GEMINI.md and activates relevant skills automatically based on semantic match.

**Useful commands** (Gemini-specific):
- Gemini doesn't have slash commands the same way Claude does. Skills fire by description match.

---

## Codex CLI

**Files populated:**
```
~/.codex/AGENTS.md                 → symlink to ~/.ai-context/AGENTS.md
~/.codex/config.toml               → appended with [mcp_servers.personal-context]
```

**No hooks.** Codex has no hook interface at time of writing. Kachow gives Codex the rules file + MCP server. You get:
- Shared rules via AGENTS.md
- `personal-context` MCP tools available in Codex's MCP UI

**Verify:**
```bash
ls -la ~/.codex/AGENTS.md          # should be a symlink
grep -A3 '\[mcp_servers.personal-context\]' ~/.codex/config.toml
```

**Enable in Codex UI:**
After first Codex run, confirm `personal-context` appears in the MCP panel. If not, restart Codex.

---

## OpenCode

**Files populated:**
```
~/.config/opencode/AGENTS.md       → symlink to ~/.ai-context/AGENTS.md
~/.config/opencode/config.json     → mcp.personal-context added
```

**Verify:**
```bash
readlink -f ~/.config/opencode/AGENTS.md
node -e 'console.log(JSON.parse(require("fs").readFileSync(require("os").homedir()+"/.config/opencode/config.json","utf8")).mcp)'
```

**MCP tools in OpenCode:** available via OpenCode's MCP panel under the name `personal-context`.

---

## Aider

**Files populated:**
```
~/.config/aider/AGENTS.md          → symlink to ~/.ai-context/AGENTS.md
```

**Aider loads rules by argument**, not auto-discovery. Either:
```bash
aider --read ~/.config/aider/AGENTS.md
```

Or add to `.aider.conf.yml` in your project root:
```yaml
read:
  - ~/.config/aider/AGENTS.md
```

**No MCP support** in Aider at time of writing. No hooks either.

---

## Cursor

**Files populated:**
```
~/.cursor/mcp.json                 → mcpServers.personal-context added (if ~/.cursor exists)
```

Cursor reads `AGENTS.md` at the **project root** — kachow doesn't install global Cursor rules (Cursor has no `~/.cursor/AGENTS.md` concept). Options:

1. **Project-scoped:** symlink at your project root:
   ```bash
   cd /path/to/your/project
   ln -s ~/.ai-context/AGENTS.md AGENTS.md
   ```
2. **Per-project `.cursor/rules/*.mdc`:** Cursor's native format. Convert AGENTS.md sections to separate `.mdc` files if you want glob-scoped rules.

**MCP is automatic** — kachow registers `personal-context` in `~/.cursor/mcp.json` during `install-mcp`. Verify in Cursor Settings → MCP.

---

## Cline (VSCode extension)

**Manual MCP setup.** Cline doesn't have a CLI config file — open VSCode, Cline panel → MCP → Add:
```
Command: node
Args: ["/home/<you>/.ai-context/mcp/personal-context/server.js"]
```
Rules: no auto-link. Point Cline's system-prompt override to `~/.ai-context/AGENTS.md`.

---

## Continue.dev

**Files populated:**
```
~/.continue/config.yaml            → mcpServers block appended (if config exists)
```

**Verify:**
```bash
grep -A5 personal-context ~/.continue/config.yaml
```

Rules: Continue doesn't support AGENTS.md symlink. Copy the content or reference via `@docs ~/.ai-context/AGENTS.md`.

---

## Zed / Windsurf / Copilot Workspace

These tools natively read `AGENTS.md` at the project root. Link per project:

```bash
cd /path/to/project
ln -s ~/.ai-context/AGENTS.md AGENTS.md
```

**MCP:** configure per each tool's MCP panel using `node ~/.ai-context/mcp/personal-context/server.js`. None of them have a CLI config file kachow can patch automatically.

---

## Verify everything at once

```bash
bash ~/.ai-context/scripts/health-check.mjs
```

Should end with `═══ ALL CHECKS PASSED ═══`. Individual checks:
- canonical source at `~/.ai-context/AGENTS.md`
- all tool AGENTS.md / CLAUDE.md / GEMINI.md symlinks resolve
- memory symlinks
- recursive symlink audit (0 broken)
- settings.json files parse
- MCP server responds with ≥10 tools
- MCP registered in each installed client

## Uninstall

```bash
bash ~/.ai-context/scripts/uninstall.mjs           # dry-run
bash ~/.ai-context/scripts/uninstall.mjs --yes     # actually remove
```

Reads `~/.ai-context/.install-manifest`, removes every file/symlink created by kachow, sweeps dangling symlinks in common tool dirs. Your `~/.ai-context/memory/` and `~/.ai-context/AGENTS.md` (rules + memory) are untouched. Remove those manually:
```bash
rm -rf ~/.ai-context
```

---

## Tutorial Troubleshooting

**"canonical source missing"** — `~/.ai-context/AGENTS.md` doesn't exist. You skipped `git clone`. Re-run.

**"MCP server not responding"** — `node --version` returns < 20, or `ps` doesn't see the server after MCP probe. Update Node.

**Symlinks broken on Windows** — Developer Mode off. Settings → Privacy & security → For developers → enable Developer Mode, re-run `bootstrap.ps1`. Or accept copy-mode (less efficient but works).

**Settings.json has hooks but nothing fires** — Claude Code needs a restart after `settings.json` changes. Exit and reopen.

**"uncommitted changes — will auto-commit on next session end"** — normal on a fresh install. Kachow auto-commits + pushes at session end if you set `AI_CONTEXT_AUTOCOMMIT=1` / `AI_CONTEXT_AUTOPUSH=1`.

For anything else, see [TROUBLESHOOTING.md](./TROUBLESHOOTING.md).
