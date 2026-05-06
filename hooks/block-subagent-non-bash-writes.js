#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// PreToolUse hook: enforces subagent write boundaries OUTSIDE Bash.
// Pairs with block-subagent-writes.js (which handles Bash-only commands).
//
// F4.B: blocks MCP filesystem mutation tools for subagents
//   (mcp__filesystem__write_file, edit_file, move_file, create_directory, etc.).
// F4.C: path-restricts native Write/Edit/MultiEdit/NotebookEdit so subagents
//   cannot write outside cwd or /tmp/. Prevents writes to arbitrary absolute
//   paths (e.g. ~/.ssh/, /etc/, other project trees).
//
// Mechanism mirrors block-subagent-writes.js:
//   1. SubagentStart hook writes marker at ~/.claude/cache/subagent-active/<sid>.json
//   2. This hook checks marker; if absent → no-op (main conversation always allowed)
//   3. If present + tool matches policy → block with reason
//
// Source spec: 2026-04-25-architecture-audit-master.md (R-AUDIT-5).

const fs = require('fs');
const path = require('path');
const os = require('os');

function passthrough() {
  process.stdout.write('{"continue":true}');
  process.exit(0);
}

try {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { passthrough(); }
  const input = JSON.parse(raw || '{}');

  const sessionId = input.session_id || '';
  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};

  if (!sessionId || !toolName) passthrough();

  // Subagent context check
  const tp = require('./lib/tool-paths.js');
  const markerDir = tp.subagentMarkerDir;
  // Glob for sessionId-*.json (PID differs between inject hook and this hook process)
  let isSubagent = false;
  try {
    for (const f of fs.readdirSync(markerDir)) {
      if (f.startsWith(sessionId + '-') && f.endsWith('.json')) { isSubagent = true; break; }
    }
  } catch {}
  if (!isSubagent) passthrough();

  // ── F4.B: MCP filesystem mutation block ──
  // Pattern: mcp__<server>__<verb>. Match all known mutation verbs.
  // Generic pattern handles every server (filesystem, github, custom servers, etc.)
  const mcpMutationPatterns = [
    /^mcp__[^_]+__(?:write|edit|move|delete|remove|create|update|put|post|patch|add|insert|append|set|push|commit|increment|upsert|replace)(?:_|$)/,
  ];

  if (mcpMutationPatterns.some(re => re.test(toolName))) {
    process.stdout.write(JSON.stringify({
      continue: false,
      decision: 'block',
      reason: `Subagent cannot use MCP mutation tools.\n\n` +
              `Blocked tool: "${toolName}"\n\n` +
              `Rule: Subagents must not mutate state through MCP servers ` +
              `(filesystem writes, memory adds, debt records, etc.). MCP servers ` +
              `often have side effects beyond the local filesystem (network, ` +
              `external state) that the parent conversation must own.\n\n` +
              `Use Read/Glob/Grep equivalents to inspect state. Report findings ` +
              `via your return value; parent will perform any mutations.`
    }));
    process.exit(0);
  }

  // ── F4.C: path-restriction for native Write/Edit/MultiEdit/NotebookEdit ──
  // Tool names: Claude uses Write/Edit/MultiEdit/NotebookEdit;
  // Gemini uses write_file/replace; both supported.
  const isNativeWrite = /^(Write|Edit|MultiEdit|NotebookEdit|write_file|replace)$/.test(toolName);
  if (!isNativeWrite) passthrough();

  // Extract file_path. Different tools use different keys.
  let filePath = toolInput.file_path || toolInput.notebook_path || toolInput.path || '';
  if (!filePath) passthrough();

  // Normalize. If relative, resolve against cwd.
  const cwd = input.cwd || process.cwd();
  if (!path.isAbsolute(filePath)) {
    filePath = path.resolve(cwd, filePath);
  }
  // Resolve symlinks defensively (best-effort — file may not exist yet for Write)
  let resolved = filePath;
  try {
    if (fs.existsSync(filePath)) {
      resolved = fs.realpathSync(filePath);
    } else {
      // Walk up to find existing parent and resolve from there
      let parent = path.dirname(filePath);
      while (!fs.existsSync(parent) && parent !== path.dirname(parent)) {
        parent = path.dirname(parent);
      }
      try { resolved = path.join(fs.realpathSync(parent), path.relative(parent, filePath)); } catch {}
    }
  } catch {}

  // Allowed roots:
  //  - cwd itself
  //  - /tmp/ (any subdirectory)
  //  - /var/tmp/
  //  - $TMPDIR
  //  - resolve cwd via realpath in case cwd itself is a symlink
  let cwdResolved = cwd;
  try { cwdResolved = fs.realpathSync(cwd); } catch {}

  const allowedRoots = [
    cwd,
    cwdResolved,
    '/tmp',
    '/var/tmp',
    os.tmpdir(),
  ];

  function isUnder(file, root) {
    if (!root) return false;
    const rel = path.relative(root, file);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  }

  const inAllowed = allowedRoots.some(r => isUnder(resolved, r));
  if (inAllowed) passthrough();

  // Outside allowed roots — block.
  process.stdout.write(JSON.stringify({
    continue: false,
    decision: 'block',
    reason: `Subagent cannot write outside its assigned scope.\n\n` +
            `Blocked path: "${resolved}"\n` +
            `Allowed roots: cwd (${cwdResolved}), /tmp/, /var/tmp/, $TMPDIR\n\n` +
            `Rule: Subagents must contain writes to the working directory or ` +
            `temp paths. Writes to other absolute paths (~/.ssh/, /etc/, other ` +
            `project trees, ~/.claude/, ~/.gemini/, etc.) are reserved for the ` +
            `parent conversation.\n\n` +
            `If you genuinely need to mutate state outside cwd, return the ` +
            `intended change as a description; parent will perform it.`
  }));
  process.exit(0);
} catch (e) {
  try { process.stderr.write('block-subagent-non-bash-writes: ' + e.message + '\n'); } catch {}
  passthrough();
}
