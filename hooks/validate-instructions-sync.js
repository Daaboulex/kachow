#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// InstructionsLoaded hook: validate CLAUDE.md ↔ GEMINI.md sync
// Fires when CLAUDE.md or .claude/rules/*.md are loaded into context.
// Catches drift from manual edits, git operations, submodule updates,
// or external tools modifying files outside of hook-managed workflows.
// Uses the same substitution patterns as sync-gemini-md.js for accuracy.
// Cross-platform (Linux, macOS, Windows)

const fs = require('fs');
const path = require('path');

// Must match sync-gemini-md.js substitutions exactly (Claude → Gemini direction)
function normalize(line) {
  return line
    .replace(/^# CLAUDE\.md$/g, '# GEMINI.md')
    .replace(/"agent":\s*"claude"/g, '"agent": "gemini"')
    .replace(/as claude\b/g, 'as gemini')
    .replace(/as Claude\b/g, 'as Gemini')
    .replace(/commit as Claude/g, 'commit as Gemini')
    .replace(/Never commit as Claude/g, 'Never commit as Gemini')
    .replace(/\*\*Claude Code\*\*/g, (match, offset, str) => {
      if (str.includes('~/.claude/')) return match;
      return '**Gemini CLI**';
    })
    .replace(/Slash Commands/g, 'Agent Skills')
    .replace(/claude-progress\.json/g, 'gemini-progress.json')
    .replace(/claude-tasks\.json/g, 'gemini-tasks.json')
    .replace(/`\.claude\/commands`/g, '`.gemini/skills`')
    .replace(/`\.claude\/commands\/`/g, '`.gemini/skills/`')
    .replace(/\.claude\/commands\//g, '.gemini/skills/')
    .replace(/`\.claude\/rules\/`/g, '`.gemini/rules/`')
    .replace(/`\.claude\/rules`/g, '`.gemini/rules`')
    .replace(/`\.claude\/claude-/g, '`.gemini/gemini-')
    .replace(/`\.claude\/`/g, '`.gemini/`')
    .replace(/in `\.claude\/commands\/`/g, 'in `.gemini/skills/`')
    .replace(/in `\.claude\//g, 'in `.gemini/')
    .replace(/\.claude\/claude-progress/g, '.gemini/gemini-progress')
    .replace(/\.claude\/claude-tasks/g, '.gemini/gemini-tasks')
    .replace(/`\.claude\/([\w-]+\.json)`/g, '`.gemini/$1`')
    .replace(/at `\.claude\//g, 'at `.gemini/')
    .replace(/"~\/\.claude\/projects/g, '"~/.gemini/projects')
    .replace(/`~\/\.claude\/projects/g, '`~/.gemini/projects')
    .replace(/claude-code(?!, gemini-cli)/g, 'gemini-cli')
    .replace(/~\/\.claude\/settings/g, (match, offset, str) => {
      if (str.includes('**Claude Code**')) return match;
      return '~/.gemini/settings';
    })
    .replace(/`~\/\.claude\/`/g, (match, offset, str) => {
      if (str.includes('**Claude Code**') || str.includes('**Gemini CLI**')) return match;
      return '`~/.gemini/`';
    })
    .replace(/set `agent` field to `"claude"`/g, 'set `agent` field to `"gemini"`')
    .replace(/symlinked via `\.claude\/`/g, 'symlinked via `.gemini/`');
}

// Match sync-gemini-md.js table-row protection logic exactly
function isSyncTableRow(line) {
  return line.includes('→') && line.includes('|') && (
    line.includes('sync-') || line.includes('commands/') || line.includes('skills/')
  );
}

try {
  const projectDir = process.cwd();

  // Find CLAUDE.md and GEMINI.md
  let claudeMd = null;
  let geminiMd = null;

  for (const candidate of [
    path.join(projectDir, 'CLAUDE.md'),
    path.join(projectDir, '.ai-context', 'CLAUDE.md'),
  ]) {
    if (fs.existsSync(candidate)) { claudeMd = candidate; break; }
  }

  for (const candidate of [
    path.join(projectDir, 'GEMINI.md'),
    path.join(projectDir, '.ai-context', 'GEMINI.md'),
  ]) {
    if (fs.existsSync(candidate)) { geminiMd = candidate; break; }
  }

  if (!claudeMd || !geminiMd) {
    process.stdout.write('{"continue":true}');
    process.exit(0);
  }

  const claudeContent = fs.readFileSync(claudeMd, 'utf-8').replace(/^\uFEFF/, '');
  const geminiContent = fs.readFileSync(geminiMd, 'utf-8').replace(/^\uFEFF/, '');

  const claudeLines = claudeContent.split('\n');
  const geminiLines = geminiContent.split('\n');

  let driftLines = 0;
  const maxCheck = Math.max(claudeLines.length, geminiLines.length);
  for (let i = 0; i < maxCheck; i++) {
    const rawCl = claudeLines[i] || '';
    const gl = (geminiLines[i] || '').trim();

    // Skip sync table rows (same logic as sync-gemini-md.js)
    if (isSyncTableRow(rawCl) || isSyncTableRow(geminiLines[i] || '')) continue;

    // Normalize Claude line to expected Gemini equivalent
    const cl = normalize(rawCl).trim();
    if (cl !== gl) driftLines++;
  }

  if (driftLines > 2) {
    process.stdout.write(JSON.stringify({
      systemMessage: `[sync-check] CLAUDE.md ↔ GEMINI.md drift detected (${driftLines} lines differ). Run sync hooks or check for manual edits.`,
      continue: true
    }));
  } else {
    process.stdout.write('{"continue":true}');
  }
} catch {
  process.stdout.write('{"continue":true}');
}
