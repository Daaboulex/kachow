# Security Policy

## Supported Versions

Security patches ship on the latest minor release.

| Version | Supported |
|---------|-----------|
| latest  | yes |
| older   | best-effort |

## Reporting a Vulnerability

Open a **private** advisory via GitHub (`Security → Report a vulnerability`).
Do not open a public issue for a security flaw.

Please include:
- Which file or hook is affected (path + line range if known).
- What an attacker could do with it.
- A minimal reproduction (script, setting, prompt).

We aim for a first response within 72 hours.

## Scope

In-scope:
- Any `hooks/*.js` or `hooks/lib/*.js` path-traversal, command-injection, secret-leak flaw.
- MCP server (`mcp/personal-context/server.js`) request handling.
- `scripts/*.sh` / `*.ps1` arbitrary-execution paths.
- Settings templates that would leak secrets or escalate privilege.

Out of scope:
- Consuming AI tools (Claude Code, Gemini CLI) themselves — report upstream.
- User misconfiguration that disables sandbox controls.
