# Contributing

## Before opening a PR

1. `node scripts/test-hooks.mjs` — all hooks must pass
2. `node scripts/verify-symlinks.mjs` — all symlinks valid
3. `node scripts/generate-settings.mjs --check` — critical hooks present
4. `node scripts/verify.mjs` — full verification pass
5. New hooks MUST be added to `modules/hooks/MANIFEST.yaml`
6. New memory files MUST use v2 frontmatter schema

## Adding a hook

See [docs/ADDING-A-HOOK.md](./docs/ADDING-A-HOOK.md).

## Scope

PRs that:
- Add a hook solving a real cross-tool problem → welcome
- Improve cross-platform portability → welcome
- Fix bugs in existing hooks → welcome

PRs that:
- Hard-code personal project structure → rejected
- Introduce external dependencies (zero-dep by design) → rejected
- Skip MANIFEST registration → rejected

## Licensing

MIT. By submitting, you agree your contribution ships under the same license.
