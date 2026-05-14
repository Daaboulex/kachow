# Troubleshooting

## Symlinks broken after sync

```bash
node scripts/verify-symlinks.mjs     # diagnoses
node scripts/install-adapters.mjs    # restores
```

## Hook not firing

1. `node --check ~/.claude/hooks/<hook>.js` — syntax error?
2. `node scripts/test-hooks.mjs` — does it pass runtime test?
3. `node scripts/generate-settings.mjs --check` — is it registered in config?

For Codex: ensure `[features] codex_hooks = true` is in config.toml.

## Image preview (`/preview`) empty output

- `command -v chafa` — installed?
- Terminal supports sixel/kitty/iterm2/256-color? chafa auto-degrades to ASCII
- `chafa --version` >= 1.14 recommended

## Symlink refused on Windows

Enable **Developer Mode** (Settings > Privacy & security > For developers) so PowerShell can create symlinks without admin.

## Config out of sync after editing MANIFEST

```bash
node scripts/generate-settings.mjs --apply   # regenerate all configs
node scripts/verify.mjs                       # verify everything
```

## Syncthing conflicts

```bash
find ~/.ai-context -name "*.sync-conflict-*"  # find conflicts
```

Resolve manually, then delete the conflict file. The `.stignore` patterns prevent most conflicts by excluding per-machine volatile state.
