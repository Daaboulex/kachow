# Tutorial — setting up kachow from scratch

This walks through a fresh install on Linux, macOS, and Windows, explains
how the symlink layer works, covers every supported AI tool individually,
and shows the upgrade and opt-out paths. Aim: zero guessing.

**Read time:** ~15 minutes. **Install time per machine:** ~2 minutes.

---

## Prerequisites (all platforms)

| Requirement | Why | How to check |
|---|---|---|
| Node ≥ 20 | every script + hook + MCP server is Node | `node --version` |
| git | cloning + per-session auto-commit hooks | `git --version` |
| one of: Claude Code, Gemini CLI, Codex CLI, OpenCode, Aider, Cursor | kachow installs adapters only for tools present | `claude --version`, `gemini --version`, etc. |

Optional but recommended:

- **bash** 3.2+ (macOS default) or 4+ (Linux default). Windows users without Git-Bash get the `.ps1` wrappers instead; everything still works.
- **PowerShell 7+** on Windows (`pwsh`). Windows PowerShell 5.1 also works but some scripts prefer pwsh.
- **chafa** (for `/preview`). `brew install chafa` on macOS, `apt install chafa` on Debian, `scoop install chafa` on Windows.

---

## How kachow is structured

Before you install, you should understand three directories and one file. That's the whole mental model.

```
~/.ai-context/          ← CANONICAL SOURCE
  AGENTS.md             ← the one rules file
  memory/               ← your memory system (auto-rotated)
  skills/               ← skills usable by every MCP-capable tool
  mcp/personal-context/ ← the 14-tool MCP server
  scripts/              ← install + maintenance (node canonical + .sh/.ps1 wrappers)

~/.claude/              ← Claude-specific: hooks, commands, settings.json
  CLAUDE.md             ← SYMLINK → ~/.ai-context/AGENTS.md

~/.gemini/              ← Gemini-specific: hooks, commands, settings.json
  GEMINI.md             ← SYMLINK → ~/.ai-context/AGENTS.md

~/.codex/AGENTS.md             ← SYMLINK → ~/.ai-context/AGENTS.md
~/.config/opencode/AGENTS.md   ← SYMLINK
~/.config/aider/AGENTS.md      ← SYMLINK
```

**The rule:** edit `~/.ai-context/AGENTS.md`. Every tool reads the same file on its next session start. You maintain one file, not five.

---

## Install — Linux / macOS

### Step 1. Clone

```bash
git clone https://github.com/Daaboulex/kachow ~/.ai-context
```

If you want to keep it in a non-default location:

```bash
export AI_CONTEXT="$HOME/Documents/ai-rules"
git clone https://github.com/Daaboulex/kachow "$AI_CONTEXT"
```

Every script honours `$AI_CONTEXT` and falls back to `$HOME/.ai-context`.

### Step 2. Customize (interactive, one-shot)

```bash
bash ~/.ai-context/scripts/customize.mjs
```

It asks seven things:

1. Your name (pre-filled from `git config user.name`).
2. Your git email (pre-filled from `git config user.email`).
3. A one-line "who you are" — becomes the `Identity` stamp in `AGENTS.md`.
4. Repo name for your fork (defaults to `kachow-fork`).
5. Which AI tools to wire — each is probed; installed tools default to "yes".
6. Optional add-ons (NixOS / embedded firmware / Python stack).
7. Whether to run `bootstrap.sh` now (yes is the right answer).

This is the only interactive step in the whole install. After this, every install step is non-interactive and re-runnable.

### Step 3. Bootstrap

`customize.sh` runs this for you unless you said no. If you said no, run it yourself:

```bash
bash ~/.ai-context/scripts/bootstrap.mjs
```

Bootstrap does six things in order. Each is idempotent:

1. Verifies `~/.ai-context/AGENTS.md` exists (prints a useful error if not).
2. Normalizes `$HOME` in any `settings.json` that contains literal `$HOME` (Windows compatibility — harmless on POSIX).
3. Runs `install-adapters.mjs` — creates the five AGENTS.md symlinks.
4. Runs `install-mcp.mjs` — registers the `personal-context` MCP server in every installed tool's config.
5. Creates `memory/` + per-skill symlinks in `~/.claude/` and `~/.gemini/`.
6. Runs `health-check.mjs` — verifies everything resolves.

If the health check exits clean, you're done. Move on.

### Step 4. Verify

```bash
bash ~/.ai-context/scripts/health-check.mjs
```

You should see something like:

```
═══ AI-context health check ═══

── Canonical source ──
  ✓ AGENTS.md exists
  ✓ memory/ dir exists
  ✓ skills/ dir exists
  ✓ MCP server exists (mcp/personal-context/server.js)
  ✓ install-adapters script present
  ✓ install-mcp script present

── AGENTS.md symlinks ──
  ✓ .claude/CLAUDE.md → AGENTS.md
  ✓ .gemini/GEMINI.md → AGENTS.md
  ✓ .codex/AGENTS.md → AGENTS.md
  ✓ .config/opencode/AGENTS.md → AGENTS.md
  ✓ .config/aider/AGENTS.md → AGENTS.md

── Memory + skill symlinks ──
  ✓ .claude/memory → memory/
  ✓ .gemini/memory → memory/

── Recursive symlink audit ──
  ✓ 40 symlinks, 0 broken

── MCP server ──
  ✓ node available
  ✓ MCP server responds (14 tools)

── MCP registered in clients ──
  ✓ Claude Code
  ✓ Gemini CLI
  ✓ Codex CLI
  ✓ OpenCode

═══ ALL CHECKS PASSED ═══
```

If any line says `✗`, read the error message. Most failures come from a tool not being installed (expected and flagged yellow, not red) or a symlink the tool already had pointing somewhere else (bootstrap backs these up to `*.pre-ai-context-bak-<timestamp>` before replacing).

### Step 5. First session

Open Claude Code, Gemini CLI, or any configured tool. You should see your rules (`AGENTS.md` content) loaded automatically. Type `/memory` in Claude Code to confirm the memory-search command is available. If the MCP server registered, you can invoke `search_memory`, `read_debt`, `list_tasks`, etc. from any client.

---

## Install — Windows

### Step 1. Enable Developer Mode (one-time, strongly recommended)

Windows 10/11 requires either admin rights OR Developer Mode to create symlinks. Developer Mode is free and doesn't compromise security — it just lifts the symlink restriction.

1. Open **Settings** → **Privacy & security** → **For developers**.
2. Toggle **Developer Mode** to **On**.
3. Restart your shell (PowerShell has already cached the capability check).

If you don't enable Developer Mode, kachow falls back to **copy mode** — it duplicates `AGENTS.md` into each tool's directory instead of symlinking. Copy mode works fine but you must re-run `bootstrap.ps1` after every edit to `~/.ai-context/AGENTS.md` to propagate the change. The installer tells you when you're in copy mode so you don't forget.

### Step 2. Install PowerShell 7+

Windows PowerShell 5.1 (shipped) works for the wrappers, but pwsh 7+ has better Unicode handling and is what upstream tests against. Install via:

```powershell
winget install Microsoft.PowerShell
# OR
scoop install pwsh
```

### Step 3. Clone + customize + bootstrap

Open a pwsh prompt. Then:

```powershell
git clone https://github.com/Daaboulex/kachow "$HOME\.ai-context"
cd "$HOME\.ai-context"
pwsh .\scripts\customize.ps1
pwsh .\scripts\bootstrap.ps1
```

The customize wizard is the same seven questions as on POSIX.

### Step 4. Verify

```powershell
pwsh ~\.ai-context\scripts\health-check.ps1
```

Same output format as POSIX. On Windows without Developer Mode you'll see:

```
  ~ .claude/CLAUDE.md is a regular file (not symlinked)
```

for each tool. That's expected in copy mode — not a bug.

### Step 5. (Optional) chafa for `/preview`

```powershell
scoop install chafa
```

If you don't install chafa, `/preview` prints a "not available" message rather than rendering. No other command depends on chafa.

---

## Symlinks — how the layer actually works

kachow relies on filesystem symlinks for its "edit one file, every tool sees it" trick. Three things you should know.

### On Linux / macOS

Symlinks are native. Every `link` in kachow is a real `fs.symlinkSync` — no workaround. Run `ls -la ~/.claude/CLAUDE.md` to see the `->` arrow pointing at `~/.ai-context/AGENTS.md`.

Re-install after move: if you rename or move `~/.ai-context/`, re-run `bootstrap.sh` with the new `$AI_CONTEXT` env set. All symlinks are recreated.

### On Windows

Two symlink-capable configurations:

1. **Developer Mode on** (recommended). `fs.symlinkSync` succeeds in userspace. No admin elevation needed.
2. **Administrator elevation**. Run PowerShell as Administrator. `fs.symlinkSync` succeeds without Developer Mode. Less convenient because every install + edit needs elevation.

If neither applies, kachow uses **copy mode**. The installer detects this at startup via a probe in `%TEMP%` and warns loudly. Copy mode means:

- `~/.claude/CLAUDE.md` is a real file copy of `~/.ai-context/AGENTS.md`.
- After editing `AGENTS.md`, re-run `pwsh ~/.ai-context/scripts/bootstrap.ps1` to refresh every copy.

**How to tell which mode you're in:**

```powershell
Get-Item ~\.claude\CLAUDE.md | Select-Object LinkType, Target
```

`LinkType: SymbolicLink` = fine. Empty / `null` = copy mode.

### Recovering from a broken symlink

If `~/.ai-context/` is moved, deleted, or its network mount is unavailable, the tool-side symlink becomes dangling. You'll see:

```
  ~ .claude/CLAUDE.md → /old/path/.ai-context/AGENTS.md  (not canonical)
```

Fix:

```bash
bash ~/.ai-context/scripts/install-adapters.mjs
# OR on Windows
pwsh ~/.ai-context/scripts/install-adapters.ps1
```

`install-adapters` detects stale symlinks and replaces them in place. The old link is replaced, the new link points at the current `$AI_CONTEXT/AGENTS.md`.

---

## Per-AI setup — what each tool needs

kachow auto-wires whichever tools are installed. This section documents what kachow installed + where to verify + how to disable.

### Claude Code

**What bootstrap installed:**
- `~/.claude/CLAUDE.md` → symlinked to `~/.ai-context/AGENTS.md`.
- Hooks in `~/.claude/hooks/` (42 files + 21 library helpers — see [HOOKS.md](./HOOKS.md)).
- Slash commands in `~/.claude/commands/` (14 commands).
- `personal-context` MCP server in `~/.claude.json` → `mcpServers`.
- `~/.claude/settings.json` with the whole hook chain wired.

**Verify:** open Claude Code. Session-start banner should show memory entries, pending handoff progress (if any), open tasks. Type `/memory` — the command should autocomplete.

**Disable specific hooks:** edit `~/.claude/settings.json` and remove entries from `hooks.<event>`. The file stays on disk; nothing fires. No reinstall needed.

**Rollback:** `rm -rf ~/.claude/hooks` + restore from `~/.claude/hooks.bak-*` if the bootstrap backed one up.

### Gemini CLI

**What bootstrap installed:**
- `~/.gemini/GEMINI.md` → symlinked to `~/.ai-context/AGENTS.md`.
- Hooks in `~/.gemini/hooks/` mirrored from Claude (37 registered — no UserPromptSubmit since Gemini has no such event).
- Skills in `~/.gemini/skills/` adapted to Gemini's semantic-retrieval format (descriptions are the activation signal, so install rewrites terse descriptions).
- `personal-context` MCP server in `~/.gemini/settings.json` → `mcpServers`.

**Verify:** open Gemini CLI. If rules loaded, the session-start banner reflects your AGENTS.md content. From any Gemini session, invoke `activate_skill` with a description — if your skills appear as candidates, MCP + skill dir wiring is correct.

**Disable specific hooks:** edit `~/.gemini/settings.json` and remove entries from `hooks.<event>`. Gemini event names: `BeforeTool`, `AfterTool`, `SessionStart`, `SessionEnd`, `PreCompress`, `Notification` (no UserPromptSubmit, SubagentStart, SubagentStop, statusLine — those are Claude-only).

**Rollback:** `rm -rf ~/.gemini/hooks` + restore from `*.bak-*` if present.

**Gotcha:** Gemini doesn't invoke skills by slash command. It selects by matching `description:` frontmatter against user intent. If you write a skill with a terse description (`"Format dates"`), Gemini won't fire it. Rewrite: `"When the user asks for a date rendered as RFC 3339, UTC or localized, produce exactly this output format."`

### Codex CLI

**What bootstrap installed:**
- `~/.codex/AGENTS.md` → symlinked.
- `personal-context` MCP server in `~/.codex/config.toml` under `[mcp_servers.personal-context]`.

**Verify:** `grep '\[mcp_servers.personal-context\]' ~/.codex/config.toml` should print one line. Open Codex and query `search_memory` or `list_skills` via MCP — if they respond, wiring is correct.

**Disable:** Codex has no hook interface yet, so nothing to disable on that front. To remove the MCP integration, delete the `[mcp_servers.personal-context]` block from `~/.codex/config.toml`.

**Rollback:** `rm ~/.codex/AGENTS.md` (restores whatever was there before bootstrap via the `*.pre-ai-context-bak-*` file next to it).

### OpenCode

**What bootstrap installed:**
- `~/.config/opencode/AGENTS.md` → symlinked.
- `personal-context` MCP server in `~/.config/opencode/config.json` → `mcp.personal-context`.

**Verify:** `node -e "console.log(Object.keys(require('./.config/opencode/config.json').mcp||{}))"` from your home dir — should include `personal-context`. Launch OpenCode, check the MCP server appears in the active-servers list.

**Disable:** remove the `mcp.personal-context` key from `~/.config/opencode/config.json`. OpenCode doesn't support per-hook disable (there are no hooks on OpenCode).

**Rollback:** `rm ~/.config/opencode/AGENTS.md` + restore from backup if present.

### Aider

**What bootstrap installed:**
- `~/.config/aider/AGENTS.md` → symlinked.

**How to use:** Aider needs an explicit `--read` flag:

```bash
aider --read ~/.config/aider/AGENTS.md
```

Or permanently in `.aider.conf.yml`:

```yaml
read:
  - ~/.config/aider/AGENTS.md
```

**Verify:** `readlink ~/.config/aider/AGENTS.md` should resolve to `~/.ai-context/AGENTS.md`. Launch Aider with `--read` and check the first few lines of the system prompt (Aider echoes what it loaded at startup).

**Disable:** remove the `read:` entry from `.aider.conf.yml` (or don't pass `--read`). The symlink stays harmlessly.

**Rollback:** `rm ~/.config/aider/AGENTS.md`.

### Cursor

**Important difference:** Cursor has **no user-global `AGENTS.md`** concept. It reads `AGENTS.md` at the project root, and its `.cursor/rules/*.mdc` files are per-project.

**What bootstrap installed:**
- MCP server in `~/.cursor/mcp.json`.

**What you need to wire yourself:** for each project where you want kachow's rules to apply, either:

1. Symlink at the project root:
   ```bash
   ln -s ~/.ai-context/AGENTS.md ./AGENTS.md
   ```
2. Or add a per-project `.cursor/rules/kachow.mdc` that points at it:
   ```markdown
   ---
   description: Kachow global rules
   globs:
     - '**/*'
   alwaysApply: true
   ---
   @~/.ai-context/AGENTS.md
   ```

**Verify:** in Cursor, open any file in the project. The right-panel context section should show the rule loaded. `grep -A3 personal-context ~/.cursor/mcp.json` confirms MCP registration.

**Disable:** remove the per-project symlink OR the `.mdc` file. To remove MCP, drop the `personal-context` entry from `~/.cursor/mcp.json`.

**Rollback:** `rm ./AGENTS.md` (project-local) or `rm ./.cursor/rules/kachow.mdc`. Cursor has no cache to purge.

### Cline / Continue.dev / Zed / Windsurf / Copilot Workspace / any MCP-capable client

**What bootstrap installed:** the `personal-context` MCP server in each tool's config file — `~/.cline/config.json`, `~/.continue/config.yaml`, etc.

**Rules:** these tools natively read project-root `AGENTS.md` (Copilot + Cursor + newer Zed) or per-tool rule files (Cline / Continue.dev). Link project-level or copy the content.

---

## How maintenance works

### Day-to-day edits

You edit any file in `~/.ai-context/` — typically `AGENTS.md`. No reinstall needed. Tools pick up the change on their next session.

### Adding a new memory

```bash
cat > ~/.ai-context/memory/project_$(date +%Y-%m-%d)_my-work.md <<'EOF'
---
name: My work
description: What I'm doing this week
type: project
created: 2026-04-24
last_verified: 2026-04-24
last_accessed: 2026-04-24
ttl_days: 90
evidence: []
status: active
---

Body.
EOF
```

That's it. Every MCP-capable tool sees it on next session via `search_memory`.

### Adding a new skill

```bash
mkdir -p ~/.ai-context/skills/my-skill
cat > ~/.ai-context/skills/my-skill/SKILL.md <<'EOF'
---
name: my-skill
description: One concrete sentence about when to activate this skill for retrieval.
---

# My skill

## When to use

- Trigger condition 1
- Trigger condition 2

## Steps

1. Read X
2. Check Y
3. Write Z

## Anti-patterns

- Thing to avoid.
EOF

bash ~/.ai-context/scripts/bootstrap.mjs
```

Bootstrap re-runs the adapter installer, which symlinks the new skill into every tool's skill dir.

### Updating kachow itself

```bash
bash ~/.ai-context/scripts/self-update.mjs
```

What this does:

1. `git fetch origin --tags`, shows incoming commits.
2. Checks your working tree is clean (refuses to merge into dirty state).
3. Captures the `USER SECTION` block in `AGENTS.md` so your personal rules survive the merge.
4. Fast-forwards `main` (or `--rebase` if you passed that flag).
5. Re-injects `USER SECTION` if the merge changed `AGENTS.md`.
6. Re-runs `bootstrap.sh` so any new hooks / adapters / settings get picked up.
7. Prints the `CHANGELOG` diff.

Preview without applying: `bash ~/.ai-context/scripts/self-update.mjs --dry-run`.

### Publishing a release from your fork

Once you've made changes you want to tag:

```bash
bash ~/.ai-context/scripts/bump-version.mjs --dry-run
```

Review the proposed bump + changelog section. Then:

```bash
bash ~/.ai-context/scripts/bump-version.mjs
git add VERSION CHANGELOG.md
git commit -m "chore(release): v$(cat VERSION)"
git tag "v$(cat VERSION)"
bash ~/.ai-context/scripts/scrub-check.mjs
# If clean:
git push --follow-tags origin main
```

`scrub-check.sh` is the pre-push gate. Install it as `.git/hooks/pre-push`:

```bash
ln -s ../../scripts/scrub-check.mjs .git/hooks/pre-push
```

Now every push is scrubbed automatically.

---

## Second machine — replicate everything

The goal: your second machine picks up the same rules, memories, and tool wiring.

**Option A — git remote.** If you've pushed `~/.ai-context/` to a private git remote, on the second machine:

```bash
git clone <your-ai-context-remote> ~/.ai-context
bash ~/.ai-context/scripts/bootstrap.mjs
```

The `~/.claude/` and `~/.gemini/` repos have their own auto-push remotes (configured by `setup-private-remote.sh`). `auto-pull-global` (SessionStart hook) fetches them on every session, so they stay in sync automatically.

**Option B — Syncthing.** Point Syncthing at `~/.ai-context/`. The other machine picks up files as they land. Run `bootstrap.sh` once on the second machine to recreate its symlinks.

**Option C — portable snapshot.** If the second machine is offline / behind a firewall:

```bash
# Source machine
node ~/.ai-context/scripts/snapshot.mjs backup /media/usb

# Target machine (on first boot)
git clone https://github.com/Daaboulex/kachow ~/.ai-context  # get the framework itself
node /media/usb/ai-context-snapshot-<date>/snapshot.mjs merge
```

The merge operation unpacks the snapshot, creates symlinks, registers MCP servers. Idempotent.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `canonical source missing at ...` | You're running from outside `~/.ai-context/`. Either set `$AI_CONTEXT` or run from inside the dir. |
| Symlinks marked broken in `health-check` | `install-adapters.sh` detects + replaces stale links. |
| Windows: `EPERM: operation not permitted, symlink` | Enable Developer Mode (see Install — Windows). Or run elevated. Or accept copy mode. |
| Gemini ignores a skill entirely | Gemini selects by `description:` text. Rewrite to a specific retrieval signal ("When the user asks for X, do Y"). |
| `MCP server not responding` in health-check | Run `node ~/.ai-context/mcp/personal-context/server.js < /dev/null` directly. If it prints JSON-RPC, the server works — the client config is the issue. |
| Memory rotation archived something important | Files are moved to `memory/archive/`, never deleted. `mv archive/<file> ./<file>` and bump `last_verified` to today. |
| Session-start banner empty | Expected on fresh install — fills in as you accumulate handoffs, memory entries, self-improvement findings. |

More corner cases in [TROUBLESHOOTING.md](./TROUBLESHOOTING.md).

---

## Opt-out — removing kachow cleanly

```bash
# Remove symlinks
rm ~/.claude/CLAUDE.md ~/.gemini/GEMINI.md ~/.codex/AGENTS.md
rm ~/.config/opencode/AGENTS.md ~/.config/aider/AGENTS.md

# Remove hooks (copy any personal ones out first)
rm -rf ~/.claude/hooks ~/.gemini/hooks

# Remove MCP entries: edit each tool's config to drop "personal-context"
#  ~/.claude.json
#  ~/.gemini/settings.json
#  ~/.codex/config.toml
#  ~/.config/opencode/config.json

# Finally, remove the framework
rm -rf ~/.ai-context
```

No hidden state. Everything is files.

---

## Summary — what "easy, maintainable, scalable, updatable" means here

- **Easy:** three commands on Linux/macOS (`git clone`, `customize.sh`, `bootstrap.sh`). Four on Windows (plus enable Dev Mode). Every step is re-runnable.
- **Maintainable:** one `AGENTS.md` to edit. Hooks are pure-Node, stdlib-only, individually documented in `HOOKS.md`. 72 unit tests plus 8 regression fixtures guard against silent breakage.
- **Scalable:** per-host observability (per-machine JSONL shards), cross-machine memory merge via Syncthing or snapshot, per-project overrides via repo-local `AGENTS.md`. MCP server is stateless — add new clients without touching anything on the server side.
- **Updatable:** `self-update.sh` preserves your `USER SECTION` across upstream merges, re-runs bootstrap so new hooks / adapters land automatically, prints CHANGELOG diffs so you know what changed.
