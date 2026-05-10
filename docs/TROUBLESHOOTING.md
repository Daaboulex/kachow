# Troubleshooting

## Symlinks broken after sync

```
bash scripts/health-check.sh        # diagnoses
bash scripts/install-adapters.sh    # restores
```

## MCP not registering

Run with verbose:
```
bash -x scripts/install-mcp.sh
```

Common: `~/.claude.json` missing (run Claude Code at least once first).

## Hook not firing

1. `node -c ~/.claude/hooks/<hook>.js` — syntax?
2. `node scripts/validate-manifest.mjs` — is it registered?
3. `node hooks/lib/hook-selftest.js --hook=<hook.js>` — does its spec pass?

## Image preview (`/preview`) empty output

- `command -v chafa` — installed?
- Terminal supports sixel/kitty/iterm2/256-color? chafa will auto-degrade to ASCII otherwise
- `chafa --version` ≥ 1.14 recommended

## Symlink refused on Windows

Enable **Developer Mode** (Settings → Update & Security → For developers) so PowerShell can create symlinks without admin.
