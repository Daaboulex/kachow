#!/usr/bin/env node
// Combined PostToolUse sync hook for Write|Edit operations.
// Merges 4 hooks into 1 process: saves 3 Node spawns per Write/Edit (~30ms).
//
// Sync operations (all advisory — never block):
//   1. CLAUDE.md → GEMINI.md translation (27 surgical replacements)
//   2. .claude/commands|skills|rules → .gemini/ equivalents (with frontmatter translation)
//   3. .claude/agents/*.md → .gemini/agents/*.md (with frontmatter translation)
//   4. AI-tasks.json bidirectional sync

const TIMER_START = process.hrtime.bigint();
const fs = require('fs');
const path = require('path');

function emitTiming(errCount, syncMessage, toolDurationMs) {
  try {
    const total_ms = Number(process.hrtime.bigint() - TIMER_START) / 1e6;
    const meta = { total_ms: +total_ms.toFixed(3), error_count: errCount || 0, has_message: !!syncMessage };
    if (typeof toolDurationMs === 'number') meta.tool_duration_ms = +toolDurationMs.toFixed(3);
    require('./lib/observability-logger.js').logEvent(process.cwd(), {
      type: 'hook_timing',
      source: 'post-write-sync',
      meta,
    });
  } catch {}
}

let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }

try {
  const input = JSON.parse(raw);
  const toolDurationMs = typeof input.duration_ms === 'number' ? input.duration_ms : undefined;
  const filePath = input.tool_input?.file_path || input.tool_response?.filePath || '';
  if (!filePath) {
    process.stdout.write('{"continue":true}');
    process.exit(0);
  }
  const normalized = filePath.replace(/\\/g, '/');
  const errors = [];

  // ── 1. CLAUDE.md → GEMINI.md sync (critical) ──
  try {
    if (filePath.endsWith('CLAUDE.md') &&
        !normalized.includes('.claude/CLAUDE.md')) {
      const geminiPath = filePath.replace(/CLAUDE\.md$/, 'GEMINI.md');
      if (fs.existsSync(filePath) && fs.existsSync(geminiPath)) {
        const claude = fs.readFileSync(filePath, 'utf8');
        const gemini = claude.split('\n').map(line => {
          const isSyncTableRow = line.includes('\u2192') && line.includes('|') && (
            line.includes('sync-') || line.includes('commands/') || line.includes('skills/')
          );
          if (isSyncTableRow) return line;

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
            .replace(/`\.claude\/`/g, (match, offset, str) => {
              if (str.includes('`.gemini/`')) return match;
              return '`.gemini/`';
            })
            .replace(/in `\.claude\/commands\/`/g, 'in `.gemini/skills/`')
            .replace(/in `\.claude\//g, (match, offset, str) => {
              if (str.includes('.gemini/')) return match;
              return 'in `.gemini/';
            })
            .replace(/\.claude\/claude-progress/g, '.gemini/gemini-progress')
            .replace(/\.claude\/claude-tasks/g, '.gemini/gemini-tasks')
            .replace(/`\.claude\/([\w-]+\.json)`/g, (match, p1, offset, str) => {
              if (str.includes('.gemini/')) return match;
              return '`.gemini/' + p1 + '`';
            })
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
        }).join('\n');

        // UP-001: Validate GEMINI.md output before writing (prevent corruption from bad regex)
        // Basic structural checks: non-empty, has at least one heading, not drastically smaller than source
        const validationErrors = [];
        if (!gemini || gemini.length === 0) validationErrors.push('empty output');
        if (!/^#\s/m.test(gemini)) validationErrors.push('no markdown headings');
        if (gemini.length < claude.length * 0.5) validationErrors.push('output <50% of source size');
        // Check that critical structural markers survived the replacements
        const claudeHeadings = (claude.match(/^##\s/gm) || []).length;
        const geminiHeadings = (gemini.match(/^##\s/gm) || []).length;
        if (claudeHeadings > 0 && geminiHeadings < claudeHeadings * 0.8) {
          validationErrors.push(`heading count dropped ${claudeHeadings}->${geminiHeadings}`);
        }

        if (validationErrors.length > 0) {
          errors.push({
            section: 'sync-claude-md-validation',
            error: `Translation validation failed: ${validationErrors.join(', ')}. GEMINI.md NOT overwritten.`,
            critical: true
          });
        } else {
          fs.writeFileSync(geminiPath, gemini, 'utf8');
          process.stdout.write(JSON.stringify({
            continue: true,
            systemMessage: `Auto-synced GEMINI.md from CLAUDE.md (${path.basename(path.dirname(filePath))})`
          }));
          process.exit(0);
        }
      }
    }
  } catch (e) {
    errors.push({ section: 'sync-claude-md', error: e.message, stack: e.stack?.split('\n')[1]?.trim(), critical: true });
  }

  // ── 2. .claude/agents/*.md → .gemini/agents/ (non-critical) ──
  try {
    if (normalized.match(/\.claude\/agents\/[^/]+\.md$/)) {
      const { toolMap, modelMap, claudeOnlyFields, translateFrontmatter } = require('./lib/platform-map');
      const geminiPath = filePath.replace(/\.claude\/agents\//, '.gemini/agents/');
      if (fs.existsSync(filePath)) {
        // Skip if dest exists and is newer (avoids redundant translation on trivial edits)
        try {
          if (fs.existsSync(geminiPath) && fs.statSync(filePath).mtimeMs <= fs.statSync(geminiPath).mtimeMs) {
            process.stdout.write('{"continue":true}');
            process.exit(0);
          }
        } catch {}
        const content = fs.readFileSync(filePath, 'utf8');
        const translated = translateFrontmatter(content, toolMap, claudeOnlyFields, modelMap);
        const targetDir = path.dirname(geminiPath);
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
        fs.writeFileSync(geminiPath, translated, 'utf8');
        process.stdout.write(JSON.stringify({
          continue: true,
          systemMessage: `Auto-synced agent → gemini: ${path.basename(filePath, '.md')}`
        }));
        process.exit(0);
      }
    }
  } catch (e) {
    errors.push({ section: 'sync-agents', error: e.message, stack: e.stack?.split('\n')[1]?.trim() });
  }

  // ── 3. .claude/commands|skills|rules → .gemini/ (non-critical) ──
  try {
    const isCommand = (normalized.includes('.claude/commands/') || normalized.includes('.gemini/commands/') || normalized.includes('.ai-context/commands/')) && normalized.endsWith('.md');
    const isSkill = (normalized.includes('.claude/skills/') || normalized.includes('.gemini/skills/') || normalized.includes('.ai-context/skills/')) && normalized.endsWith('.md');
    const isRule = (normalized.includes('.claude/rules/') || normalized.includes('.gemini/rules/')) && normalized.endsWith('.md');

    if (isCommand || isSkill || isRule) {
      const { toolMap, modelMap, claudeOnlyFields, translateFrontmatter } = require('./lib/platform-map');

      function syncDir(src, dst) {
        fs.mkdirSync(dst, { recursive: true });
        for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
          const s = path.join(src, entry.name);
          const d = path.join(dst, entry.name);
          if (entry.isDirectory()) syncDir(s, d);
          else {
            // Skip unchanged files (mtime comparison avoids unnecessary reads/writes)
            try {
              if (fs.existsSync(d) && fs.statSync(s).mtimeMs <= fs.statSync(d).mtimeMs) continue;
            } catch {}
            if (entry.name.endsWith('.md')) {
              const content = fs.readFileSync(s, 'utf8');
              fs.writeFileSync(d, translateFrontmatter(content, toolMap, claudeOnlyFields, modelMap), 'utf8');
            } else {
              fs.copyFileSync(s, d);
            }
          }
        }
      }

      if (isCommand) {
        const cmdName = path.basename(filePath, '.md');
        // Canonical source is always ai-context/commands/ (may be reached via symlink)
        const canonicalCmd = path.join(os.homedir(), '.ai-context', 'commands', cmdName + '.md');
        const srcFile = fs.existsSync(canonicalCmd) ? canonicalCmd : filePath;
        const projectRoot = os.homedir();
        const synced = [];
        for (const skillDir of [
          path.join(projectRoot, '.gemini', 'skills', cmdName),
          path.join(projectRoot, '.ai-context', '.gemini', 'skills', cmdName),
        ]) {
          if (fs.existsSync(path.dirname(skillDir))) {
            fs.mkdirSync(skillDir, { recursive: true });
            const content = fs.readFileSync(srcFile, 'utf8');
            fs.writeFileSync(path.join(skillDir, 'SKILL.md'), translateFrontmatter(content, toolMap, claudeOnlyFields, modelMap), 'utf8');
            synced.push('gemini');
          }
        }
        const codexSkillDir = path.join(projectRoot, '.codex', 'skills', 'cmd-' + cmdName);
        if (fs.existsSync(path.join(projectRoot, '.codex', 'skills'))) {
          fs.mkdirSync(codexSkillDir, { recursive: true });
          const content = fs.readFileSync(srcFile, 'utf8');
          fs.writeFileSync(path.join(codexSkillDir, 'SKILL.md'), translateFrontmatter(content, toolMap, claudeOnlyFields, modelMap), 'utf8');
          synced.push('codex');
        }
        if (synced.length > 0) {
          process.stdout.write(JSON.stringify({ continue: true, systemMessage: `Auto-synced command → ${synced.join('+')} skill: ${cmdName}` }));
          process.exit(0);
        }
      }

      if (isSkill) {
        const match = normalized.match(/\.claude\/skills\/([^/]+)/);
        if (match) {
          const skillName = match[1];
          const idx = normalized.indexOf('.claude/skills/' + skillName);
          const srcSkillDir = filePath.substring(0, idx) + '.claude/skills/' + skillName;
          const projectRoot = filePath.substring(0, idx).replace(/[/\\]$/, '') || path.dirname(filePath.substring(0, idx + '.claude'.length));
          const cleanRoot = projectRoot.replace(/[/\\]\.ai-context$/, '');
          for (const dstDir of [
            path.join(cleanRoot, '.gemini', 'skills', skillName),
            path.join(cleanRoot, '.ai-context', '.gemini', 'skills', skillName),
          ]) {
            if (fs.existsSync(path.dirname(dstDir))) {
              syncDir(srcSkillDir, dstDir);
              process.stdout.write(JSON.stringify({ continue: true, systemMessage: `Auto-synced skill → gemini: ${skillName}` }));
              process.exit(0);
            }
          }
        }
      }

      if (isRule) {
        const ruleName = path.basename(filePath);
        const geminiRulesDir = path.dirname(filePath).replace(/\.claude[/\\]rules$/, path.join('.gemini', 'rules'));
        if (fs.existsSync(geminiRulesDir)) {
          fs.copyFileSync(filePath, path.join(geminiRulesDir, ruleName));
          process.stdout.write(JSON.stringify({ continue: true, systemMessage: `Auto-synced rule → gemini: ${ruleName}` }));
          process.exit(0);
        }
      }
    }
  } catch (e) {
    errors.push({ section: 'sync-skills-commands-rules', error: e.message, stack: e.stack?.split('\n')[1]?.trim() });
  }

  // ── 4. AI-tasks.json bidirectional sync (non-critical) ──
  // AI-progress.json removed — killed in v0.9.5 W4-FIX1
  try {
    const syncPairs = [
      { pattern: '.claude/AI-tasks.json', from: /\.claude[/\\]/, to: '.gemini/' },
      { pattern: '.gemini/AI-tasks.json', from: /\.gemini[/\\]/, to: '.claude/' },
    ];

    for (const pair of syncPairs) {
      if (normalized.includes(pair.pattern)) {
        const destPath = filePath.replace(pair.from, pair.to);
        if (fs.existsSync(path.dirname(destPath)) && fs.existsSync(filePath)) {
          fs.copyFileSync(filePath, destPath);
          const direction = pair.pattern.includes('.claude') ? '.claude/ \u2192 .gemini/' : '.gemini/ \u2192 .claude/';
          process.stdout.write(JSON.stringify({
            continue: true,
            systemMessage: `Auto-synced ${path.basename(filePath)} ${direction}`
          }));
          process.exit(0);
        }
      }
    }
  } catch (e) {
    errors.push({ section: 'sync-ai-files', error: e.message, stack: e.stack?.split('\n')[1]?.trim() });
  }

  // ── 5. GEMINI.md → CLAUDE.md reverse sync (merged from sync-claude-md.js, v0.9.5 W2-FIX3) ──
  try {
    if (filePath.endsWith('GEMINI.md') &&
        !normalized.includes('.gemini/GEMINI.md') && !normalized.includes('.gemini\\GEMINI.md')) {
      const geminiPath = filePath;
      const claudePath = filePath.replace(/GEMINI\.md$/, 'CLAUDE.md');
      if (fs.existsSync(geminiPath) && fs.existsSync(claudePath)) {
        const gemini = fs.readFileSync(geminiPath, 'utf8');
        const claude = gemini.split('\n').map(line => {
          const isSyncTableRow = line.includes('→') && line.includes('|') && (
            line.includes('sync-') || line.includes('commands/') || line.includes('skills/')
          );
          if (isSyncTableRow) return line;
          return line
            .replace(/^# GEMINI\.md$/g, '# CLAUDE.md')
            .replace(/"agent":\s*"gemini"/g, '"agent": "claude"')
            .replace(/as gemini\b/g, 'as claude')
            .replace(/as Gemini\b/g, 'as Claude')
            .replace(/commit as Gemini/g, 'commit as Claude')
            .replace(/Never commit as Gemini/g, 'Never commit as Claude')
            .replace(/\*\*Gemini CLI\*\*/g, (m, o, s) => s.includes('~/.gemini/') ? m : '**Claude Code**')
            .replace(/Agent Skills/g, 'Slash Commands')
            .replace(/gemini-progress\.json/g, 'claude-progress.json')
            .replace(/gemini-tasks\.json/g, 'claude-tasks.json')
            .replace(/`\.gemini\/skills`/g, '`.claude/commands`')
            .replace(/`\.gemini\/skills\/`/g, '`.claude/commands/`')
            .replace(/\.gemini\/skills\//g, '.claude/commands/')
            .replace(/`\.gemini\/rules\/`/g, '`.claude/rules/`')
            .replace(/`\.gemini\/rules`/g, '`.claude/rules`')
            .replace(/`\.gemini\/gemini-/g, '`.claude/claude-')
            .replace(/`\.gemini\/`/g, (m, o, s) => s.includes('`.claude/`') ? m : '`.claude/`')
            .replace(/in `\.gemini\/skills\/`/g, 'in `.claude/commands/`')
            .replace(/in `\.gemini\//g, (m, o, s) => s.includes('.claude/') ? m : 'in `.claude/')
            .replace(/\.gemini\/gemini-progress/g, '.claude/claude-progress')
            .replace(/\.gemini\/gemini-tasks/g, '.claude/claude-tasks')
            .replace(/`\.gemini\/([\w-]+\.json)`/g, (m, p1, o, s) => s.includes('.claude/') ? m : '`.claude/' + p1 + '`')
            .replace(/at `\.gemini\//g, 'at `.claude/')
            .replace(/"~\/\.gemini\/projects/g, '"~/.claude/projects')
            .replace(/`~\/\.gemini\/projects/g, '`~/.claude/projects')
            .replace(/gemini-cli/g, (m, o, s) => s.includes('claude-code') ? m : 'claude-code')
            .replace(/~\/\.gemini\/settings/g, (m, o, s) => s.includes('**Gemini CLI**') ? m : '~/.claude/settings')
            .replace(/`~\/\.gemini\/`/g, (m, o, s) => (s.includes('**Claude Code**') || s.includes('**Gemini CLI**')) ? m : '`~/.claude/`')
            .replace(/set `agent` field to `"gemini"`/g, 'set `agent` field to `"claude"`')
            .replace(/symlinked via `\.gemini\/`/g, 'symlinked via `.claude/`');
        }).join('\n');
        fs.writeFileSync(claudePath, claude, 'utf8');
        process.stdout.write(JSON.stringify({ continue: true, systemMessage: `Auto-synced CLAUDE.md from GEMINI.md (${path.basename(path.dirname(geminiPath))})` }));
        process.exit(0);
      }
    }
  } catch (e) {
    errors.push({ section: 'sync-gemini-to-claude-md', error: e.message, stack: e.stack?.split('\n')[1]?.trim() });
  }

  // ── 6. .gemini/skills|rules → .claude/ reverse sync (merged from sync-claude-skills.js, v0.9.5 W2-FIX3) ──
  try {
    if (normalized.includes('.gemini/skills/') && normalized.endsWith('SKILL.md')) {
      const { reverseToolMap, reverseModelMap, geminiOnlyFields, translateFrontmatter } = require('./lib/platform-map');
      const skillDir = path.dirname(filePath);
      const skillName = path.basename(skillDir);
      const projectRoot = skillDir.replace(/[/\\]\.ai-context[/\\]\.gemini[/\\]skills[/\\][^/\\]+$/, '').replace(/[/\\]\.gemini[/\\]skills[/\\][^/\\]+$/, '');
      const content = fs.readFileSync(filePath, 'utf8');
      const translated = translateFrontmatter(content, reverseToolMap, geminiOnlyFields, reverseModelMap);
      for (const cmdFile of [
        path.join(projectRoot, '.claude', 'commands', skillName + '.md'),
        path.join(projectRoot, '.ai-context', '.claude', 'commands', skillName + '.md'),
      ]) {
        if (fs.existsSync(path.dirname(cmdFile))) {
          fs.writeFileSync(cmdFile, translated, 'utf8');
          process.stdout.write(JSON.stringify({ continue: true, systemMessage: `Auto-synced skill → command: ${skillName}` }));
          process.exit(0);
        }
      }
    }
    if (normalized.includes('.gemini/rules/') && normalized.endsWith('.md')) {
      const ruleName = path.basename(filePath);
      const claudeRulesDir = path.dirname(filePath).replace(/\.gemini[/\\]rules$/, path.join('.claude', 'rules'));
      if (fs.existsSync(claudeRulesDir)) {
        fs.copyFileSync(filePath, path.join(claudeRulesDir, ruleName));
        process.stdout.write(JSON.stringify({ continue: true, systemMessage: `Auto-synced rule → claude: ${ruleName}` }));
        process.exit(0);
      }
    }
  } catch (e) {
    errors.push({ section: 'sync-gemini-to-claude-skills', error: e.message, stack: e.stack?.split('\n')[1]?.trim() });
  }

  // ── 7. .gemini/agents/*.md → .claude/agents/ reverse sync (merged from sync-claude-agents.js, v0.9.5 W2-FIX3) ──
  try {
    if (normalized.match(/\.gemini\/agents\/[^/]+\.md$/)) {
      const { reverseToolMap, reverseModelMap, geminiOnlyFields, translateFrontmatter } = require('./lib/platform-map');
      const claudePath2 = filePath.replace(/\.gemini\/agents\//, '.claude/agents/');
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        const translated = translateFrontmatter(content, reverseToolMap, geminiOnlyFields, reverseModelMap);
        const targetDir = path.dirname(claudePath2);
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
        fs.writeFileSync(claudePath2, translated, 'utf8');
        process.stdout.write(JSON.stringify({ continue: true, systemMessage: `Auto-synced agent → claude: ${path.basename(filePath, '.md')}` }));
        process.exit(0);
      }
    }
  } catch (e) {
    errors.push({ section: 'sync-gemini-to-claude-agents', error: e.message, stack: e.stack?.split('\n')[1]?.trim() });
  }

  // ── Error aggregation (SF-001: surface ANY error, not just 3+ or critical) ──
  if (errors.length > 0) {
    try {
      const obs = require('./lib/observability-logger.js');
      obs.logEvent(process.cwd(), { type: 'hook_errors', source: 'post-write-sync', errors, severity: errors.some(e => e.critical) ? 'critical' : (errors.length > 2 ? 'warning' : 'info') });
    } catch {}
    // Previously only surfaced if critical OR count > 2. Now always surface so silent failures become visible.
    emitTiming(errors.length, true, toolDurationMs);
    process.stdout.write(JSON.stringify({
      continue: true,
      systemMessage: `[hook-error-aggregation] ${errors.length} sub-function(s) failed in post-write-sync: ${errors.map(e => e.section).join(', ')}`
    }));
    process.exit(0);
  }

  emitTiming(errors.length, false, toolDurationMs);
  process.stdout.write('{"continue":true}');
} catch (e) {
  process.stderr.write('post-write-sync: ' + e.message + '\n');
  emitTiming(1, false);
  process.stdout.write('{"continue":true}');
}
