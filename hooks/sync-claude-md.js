#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// BeforeTool hook: auto-sync CLAUDE.md when GEMINI.md is edited by Gemini CLI
// Reverse of Claude's sync-gemini-md.js — replaces agent-identity references
// MUST be kept at parity with sync-gemini-md.js — every forward pattern needs a reverse
// Cross-platform (Linux, macOS, Windows)

const fs = require('fs');
const path = require('path');

try {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }
  const input = JSON.parse(raw);

  // Check if a GEMINI.md was written (look in tool_input or llm_response)
  const toolInput = input.tool_input || {};
  const filePath = toolInput.file_path || '';

  if (!filePath.endsWith('GEMINI.md')) {
    process.stdout.write('{"continue":true}');
    process.exit(0);
  }

  // Don't sync the global ~/.gemini/GEMINI.md
  if (filePath.includes('.gemini/GEMINI.md') || filePath.includes('.gemini\\GEMINI.md')) {
    process.stdout.write('{"continue":true}');
    process.exit(0);
  }

  const geminiPath = filePath;
  const claudePath = filePath.replace(/GEMINI\.md$/, 'CLAUDE.md');

  if (!fs.existsSync(geminiPath) || !fs.existsSync(claudePath)) {
    process.stdout.write('{"continue":true}');
    process.exit(0);
  }

  const gemini = fs.readFileSync(geminiPath, 'utf8');

  // Process line by line to protect sync-direction descriptions in hook tables
  const claude = gemini.split('\n').map(line => {
    // Protect hook table rows containing sync arrows (→) with path descriptions
    const isSyncTableRow = line.includes('→') && line.includes('|') && (
      line.includes('sync-') || line.includes('commands/') || line.includes('skills/')
    );
    if (isSyncTableRow) {
      return line;
    }

    // Reverse surgical replacements — Gemini identity → Claude identity
    // MUST mirror every pattern in sync-gemini-md.js (reversed)
    // Guards prevent corruption on lines that list BOTH agents/dirs
    return line
      // Title
      .replace(/^# GEMINI\.md$/g, '# CLAUDE.md')
      // Agent field in JSON
      .replace(/"agent":\s*"gemini"/g, '"agent": "claude"')
      // Agent name in prose
      .replace(/as gemini\b/g, 'as claude')
      .replace(/as Gemini\b/g, 'as Claude')
      .replace(/commit as Gemini/g, 'commit as Claude')
      .replace(/Never commit as Gemini/g, 'Never commit as Claude')
      // Section headers — only replace if line describes Gemini's OWN config
      // NOT cross-reference lines (Gemini section in CLAUDE.md describes Gemini hooks)
      // Guard: if line contains ~/.gemini/ path, it's describing Gemini → keep as-is
      .replace(/\*\*Gemini CLI\*\*/g, (match, offset, str) => {
        if (str.includes('~/.gemini/')) return match; // Gemini section header
        return '**Claude Code**';
      })
      .replace(/Agent Skills/g, 'Slash Commands')
      // Symlink references
      .replace(/gemini-progress\.json/g, 'claude-progress.json')
      .replace(/gemini-tasks\.json/g, 'claude-tasks.json')
      // Directory references: .gemini/ → .claude/ (in backticks and prose)
      .replace(/`\.gemini\/skills`/g, '`.claude/commands`')
      .replace(/`\.gemini\/skills\/`/g, '`.claude/commands/`')
      .replace(/\.gemini\/skills\//g, '.claude/commands/')
      .replace(/`\.gemini\/rules\/`/g, '`.claude/rules/`')
      .replace(/`\.gemini\/rules`/g, '`.claude/rules`')
      .replace(/`\.gemini\/gemini-/g, '`.claude/claude-')
      // Guard: don't replace `.gemini/` if `.claude/` is also on this line
      .replace(/`\.gemini\/`/g, (match, offset, str) => {
        if (str.includes('`.claude/`')) return match;
        return '`.claude/`';
      })
      .replace(/in `\.gemini\/skills\/`/g, 'in `.claude/commands/`')
      .replace(/in `\.gemini\//g, (match, offset, str) => {
        if (str.includes('.claude/')) return match;
        return 'in `.claude/';
      })
      // Descriptive text with .gemini/ paths (not in backticks)
      .replace(/\.gemini\/gemini-progress/g, '.claude/claude-progress')
      .replace(/\.gemini\/gemini-tasks/g, '.claude/claude-tasks')
      // Bare .gemini/ in symlink descriptions and prose — guard for dual-listing
      .replace(/`\.gemini\/([\w-]+\.json)`/g, (match, p1, offset, str) => {
        if (str.includes('.claude/')) return match;
        return '`.claude/' + p1 + '`';
      })
      .replace(/at `\.gemini\//g, 'at `.claude/')
      .replace(/"~\/\.gemini\/projects/g, '"~/.claude/projects')
      .replace(/`~\/\.gemini\/projects/g, '`~/.claude/projects')
      // Package references — guard for lines listing both packages
      .replace(/gemini-cli/g, (match, offset, str) => {
        if (str.includes('claude-code')) return match; // Line lists both
        return 'claude-code';
      })
      // Settings path — guard: don't replace on lines describing the Gemini section
      .replace(/~\/\.gemini\/settings/g, (match, offset, str) => {
        if (str.includes('**Gemini CLI**')) return match;
        return '~/.claude/settings';
      })
      .replace(/`~\/\.gemini\/`/g, (match, offset, str) => {
        if (str.includes('**Claude Code**') || str.includes('**Gemini CLI**')) return match;
        return '`~/.claude/`';
      })
      // Agent field lowercase in prose
      .replace(/set `agent` field to `"gemini"`/g, 'set `agent` field to `"claude"`')
      .replace(/symlinked via `\.gemini\/`/g, 'symlinked via `.claude/`');
  }).join('\n');

  fs.writeFileSync(claudePath, claude, 'utf8');

  process.stdout.write(JSON.stringify({
    continue: true,
    systemMessage: `Auto-synced CLAUDE.md from GEMINI.md (${path.basename(path.dirname(geminiPath))})`
  }));
} catch (e) {
  process.stderr.write('sync-claude-md: ' + e.message + '\n');
  process.stdout.write('{"continue":true}');
}
