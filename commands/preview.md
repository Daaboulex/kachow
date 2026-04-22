---
description: Render an image in the terminal via chafa (NixOS/Linux/macOS). Opt-in manual invocation — run with `/preview <path>`.
---

# /preview — Terminal image preview via chafa

Render `<image_path>` in the current terminal using chafa. Supports sixel, kitty, iTerm2, or 256-color fallback depending on terminal capabilities.

## When to use

- User asks "show me <image.png>" or "can you preview this screenshot"
- User wants to verify an image exists / looks right without leaving the terminal
- Comparing before/after visuals in the same session

## Usage

Run the helper script with the absolute or `~`-relative path:

```bash
bash ~/.claude/scripts/preview-image.sh <path-to-image>
```

On Windows:
```powershell
pwsh ~/.claude/scripts/preview-image.ps1 <path-to-image>
```

Or, if `CLAUDE_AUTO_PREVIEW_IMAGES=1` is set in the environment, image reads from disk are auto-previewed. Default OFF to avoid noise.

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

If chafa is missing, script exits 1 with install hint — do not loop or auto-install.

## Agent behavior

- Only invoke when user explicitly requests a preview or uses `/preview <path>`.
- Do NOT auto-invoke on every image file read. Default is silent; respect `CLAUDE_AUTO_PREVIEW_IMAGES=1` opt-in.
- On failure: print the stderr directly, don't retry.
- Do not add preview to TodoWrite unless the preview itself is part of the task.
