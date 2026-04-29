---
description: Render image in terminal via chafa. TERMINAL-ONLY — output does NOT appear in Claude Code chat UI.
---

# /preview — Terminal image preview via chafa

**IMPORTANT:** The Claude Code chat window is a text UI and does NOT interpret sixel/kitty/iTerm2 graphics escape sequences. Running `/preview` emits escape codes into stdout — they render in a real terminal (iTerm2, Kitty, WezTerm, foot, xterm+sixel) but show as nothing (or garbage text) in Claude chat.

**Agent guidance:** do not run `/preview` expecting the user to see the image in this chat. Either:
- Tell the user to open the image in their file manager / IDE, OR
- Tell the user to run `bash ~/.claude/scripts/preview-image.mjs <path>` themselves in a real terminal.

## When the script is useful

- User runs it directly in their terminal emulator (outside Claude).
- Verifying an image exists on disk (exit=0 means file found + chafa succeeded).

## Usage (run from real terminal, not Claude chat)

```bash
bash ~/.claude/scripts/preview-image.mjs <path-to-image>
```

On Windows:
```powershell
pwsh ~/.claude/scripts/preview-image.ps1 <path-to-image>
```

## Supported formats

`.png` `.jpg` `.jpeg` `.gif` (static) `.webp` `.svg` `.bmp` `.tiff`

## Fallback behavior

| Platform | chafa present | Output |
|---|---|---|
| NixOS / Linux (user's default) | yes | full-color terminal render |
| macOS with `brew install chafa` | yes | full-color terminal render |
| Windows native | usually no | hint: `scoop install chafa` or WSL |
| Windows + WSL | yes in WSL | render via WSL passthrough |
| any terminal without color | fallback | ASCII-art render |
| Claude Code chat UI | N/A | **escape codes not rendered — appears blank/garbled** |

If chafa is missing, script exits 1 with install hint — do not loop or auto-install.

## Agent behavior

- Do not auto-invoke. User must explicitly run `/preview <path>` or the script.
- Do not interpret `/preview` output as successful display to the user. It only tells you exit=0 (file found, chafa succeeded, escape codes emitted).
- Do NOT add preview to TodoWrite unless the preview itself is the task.
- Respect `CLAUDE_AUTO_PREVIEW_IMAGES` opt-in (default OFF).
