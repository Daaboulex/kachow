# File locations

## Why `~/.ai-context`?

`~/.ai-context/` is the default canonical source directory. It was chosen because:

1. **Tool-neutral.** It doesn't bake in a specific AI tool's name (`~/.claude/`, `~/.gemini/`, `~/.codex/` each exist already and belong to their respective tools). A shared home needed a name that didn't imply loyalty.
2. **Hidden by default.** A dotfile-style directory stays out of the way in shell `ls` and finder views.
3. **Short.** Hook commands reference it hundreds of times per session. `~/.ai-context/hooks/foo.js` is lighter on settings files than `~/.config/ai-agents/hooks/foo.js`.
4. **Not a requirement.** Every script reads the `AI_CONTEXT` env var first.

## Custom location

Override with the `AI_CONTEXT` env var before bootstrap:

```bash
# Linux / macOS
export AI_CONTEXT="$HOME/Documents/ai-rules"
git clone https://github.com/Daaboulex/kachow "$AI_CONTEXT"
"$AI_CONTEXT/scripts/bootstrap.mjs"
```

```powershell
# Windows
$env:AI_CONTEXT = "$HOME\Documents\ai-rules"
git clone https://github.com/Daaboulex/kachow $env:AI_CONTEXT
& "$env:AI_CONTEXT\scripts\bootstrap.ps1"
```

To make the override persistent, add the `export` / `$env:AI_CONTEXT` line to your shell rc file (`~/.zshrc`, `~/.bashrc`, `$PROFILE`). The framework's scripts, MCP server, and hooks all resolve `AI_CONTEXT` at runtime, so a persistent env var works without re-bootstrapping.

## XDG Base Directory spec (Linux)

If you follow the [XDG Base Directory Specification](https://specifications.freedesktop.org/basedir-spec/basedir-spec-latest.html) strictly:

```bash
export AI_CONTEXT="${XDG_CONFIG_HOME:-$HOME/.config}/ai-context"
git clone https://github.com/Daaboulex/kachow "$AI_CONTEXT"
```

## Three canonical directories (per machine)

| Dir | Default path | Owner | Configurable via |
|---|---|---|---|
| kachow canonical | `~/.ai-context/` | you (the framework author) | `AI_CONTEXT` env var |
| Claude Code private | `~/.claude/` | Claude Code CLI | not configurable (Claude's convention) |
| Gemini CLI private | `~/.gemini/` | Gemini CLI | not configurable (Gemini's convention) |

Hooks, commands, and settings for Claude and Gemini MUST live where their CLIs expect them — these paths are fixed by the respective tools. Only the kachow canonical source is relocatable.

## Per-OS install destinations

| OS | Typical default | How to target elsewhere |
|---|---|---|
| macOS / Linux | `~/.ai-context` | `export AI_CONTEXT=...` before clone |
| Windows PowerShell | `$HOME\.ai-context` | `$env:AI_CONTEXT = "..."` before clone |
| WSL | `$HOME/.ai-context` (per distro) | treat as Linux |
| Git-Bash on Windows | `$HOME/.ai-context` (maps to `%USERPROFILE%\.ai-context`) | same as PowerShell |

## Cross-machine sync strategies

You decide how `~/.ai-context/` syncs between machines. The framework doesn't assume. Common options — `scripts/setup-private-remote.mjs` walks you through each:

1. **Syncthing** — peer-to-peer file sync, offline-capable, no server.
2. **Private GitHub repo** — `gh repo create ai-context-private --private --source=.`.
3. **Self-hosted Gitea / Forgejo** — `git remote add origin <url>`.
4. **Bare git repo on USB / SSD / NAS** — for airgapped backup.
5. **Nothing** — only maintain it on one machine; others get the public framework via `git clone Daaboulex/kachow` and keep personal edits inside the `USER SECTION`.

Claude/Gemini dirs have their own sync (auto-push-global hook → your private `claude-global` + `gemini-global` repos). See [MAINTENANCE.md](./MAINTENANCE.md) for the full trigger matrix.
