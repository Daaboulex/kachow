# Contributing

Thanks for considering a contribution.

## Before opening a PR

1. Run `bash scripts/health-check.sh` — must pass.
2. Run `node hooks/lib/hook-selftest.js` — must pass.
3. Run `node scripts/validate-manifest.mjs` — no new collisions introduced.
4. New hooks MUST add a `SPECS` entry in `hooks/lib/hook-selftest.js`.
5. New memory files MUST use the v2 frontmatter schema (see `memory/example.md`).

## Scope

This framework is opinionated. PRs that:
- Add a new hook solving a real class of problem → welcome
- Improve cross-platform portability → welcome
- Extend MCP server with a new tool that's useful across projects → welcome

PRs that:
- Hard-code personal project structure → rejected
- Introduce heavy deps (we are dependency-free by design) → rejected
- Break the `bootstrap.sh` one-command flow → rejected

## Licensing

MIT. By submitting, you agree your contribution ships under the same license.
