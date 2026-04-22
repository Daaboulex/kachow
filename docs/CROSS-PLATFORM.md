# Cross-platform notes

## Linux (NixOS / Ubuntu / Fedora / Arch)

Works out of the box. Optional: install `chafa` for `/preview`.

## macOS

- `brew install chafa` for image preview
- Symlinks work natively

## Windows

- PowerShell 7+ required
- **Developer Mode** on Windows 10/11 (Settings → Update & Security → For developers → Developer Mode) so `New-Item -ItemType SymbolicLink` works without admin
- `scoop install chafa` or `choco install chafa` for image preview
- WSL fallback: `preview-image.ps1` auto-detects WSL chafa

## Timeout units

Claude Code: **seconds**. Gemini CLI: **milliseconds**. The hook registration examples in `settings.template.json` use the right unit per tool.

## Event name translation

| Concept | Claude Code | Gemini CLI |
|---|---|---|
| Session start | `SessionStart` | `SessionStart` |
| Session end | `Stop` | `SessionEnd` |
| Before tool | `PreToolUse` | `BeforeTool` |
| After tool | `PostToolUse` | `AfterTool` |
| Subagent start | `SubagentStart` | `BeforeAgent` |
| Subagent end | `SubagentStop` | `AfterAgent` |
| Pre-compact | `PreCompact` | `PreCompress` |
| Write tool name | `Write` | `write_file` |
| Edit tool name | `Edit` | `replace` |
| Run shell | `Bash` | `run_shell_command` |
| Invoke skill | `Skill` | `activate_skill` |
