# Troubleshooting

## Symlinks broken after sync

```
node scripts/health-check.mjs        # diagnoses
node scripts/install-adapters.mjs    # restores
```

## MCP not registering

Run with verbose:
```
bash -x scripts/install-mcp.mjs
```

Common: `~/.claude.json` missing (run Claude Code at least once first).

## Hook not firing

1. `node -c hooks/<hook>.js` — syntax?
2. `node hooks/lib/hook-topology.js` — is it registered?
3. `node hooks/lib/hook-selftest.js --hook=<hook.js>` — does its spec pass?

## Image preview (`/preview`) empty output

- `command -v chafa` — installed?
- Terminal supports sixel/kitty/iterm2/256-color? chafa will auto-degrade to ASCII otherwise
- `chafa --version` ≥ 1.14 recommended

## Symlink refused on Windows

Enable **Developer Mode** (Settings → Update & Security → For developers) so PowerShell can create symlinks without admin.
