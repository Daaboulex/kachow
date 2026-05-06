#!/usr/bin/env node
// convert-commands.mjs
// Auto-converts Claude user commands to Codex skills and Gemini commands.
//
// Source:  ~/.ai-context/commands/*.md (canonical, symlinked to tool dirs)
// Codex:   ~/.codex/skills/cmd-{name}/SKILL.md  (cmd- prefix avoids collision with plugin skills)
// Gemini:  ~/.gemini/commands/{name}.md          (verbatim copy)
//
// Flags:
//   --dry-run     (default) show plan, no writes
//   --force       write files
//   --gemini-only skip Codex
//   --codex-only  skip Gemini

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';

const HOME = homedir();

const CLAUDE_COMMANDS_DIR = join(HOME, '.ai-context', 'commands');
const CODEX_SKILLS_DIR    = join(HOME, '.codex', 'skills');
const GEMINI_COMMANDS_DIR = join(HOME, '.gemini', 'commands');

// Protected: skip entirely (never overwrite)
const PROTECTED = new Set([]);

// Convert but prepend warning comment
const NEEDS_MANUAL_ADAPTATION = new Set([
  'review-improvements',
  'consolidate-memory',
  'reflect',
  'review-adversarial',
]);

const WARNING_COMMENT =
  '<!-- AUTO-CONVERTED from Claude command. Some features may not work in Codex. See ~/.ai-context/docs/COVERAGE.md -->\n\n';

// Path substitutions applied to body content for Codex only
const PATH_SUBS = [
  [/~\/\.claude\//g,        '~/.codex/'],
  [/\.claude\/hooks\//g,    '.codex/hooks/'],
  [/~\/\.claude\/\.reflect-enabled/g, '~/.codex/.reflect-enabled'],
];

// ── Flags ────────────────────────────────────────────────────────────────────

const DRY_RUN     = !process.argv.includes('--force');
const GEMINI_ONLY = process.argv.includes('--gemini-only');
const CODEX_ONLY  = process.argv.includes('--codex-only');

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Split frontmatter from body.
 * Returns { description, name, body } — all fields optional/empty string.
 */
function parseFrontmatter(raw) {
  const lines = raw.split('\n');
  if (lines[0].trim() !== '---') {
    return { description: '', name: '', body: raw };
  }
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { closeIdx = i; break; }
  }
  if (closeIdx === -1) {
    return { description: '', name: '', body: raw };
  }
  const fmLines = lines.slice(1, closeIdx);
  const body = lines.slice(closeIdx + 1).join('\n');

  let description = '';
  let fmName = '';
  let inFoldedDesc = false;
  for (let i = 0; i < fmLines.length; i++) {
    const line = fmLines[i];
    if (inFoldedDesc) {
      if (/^\s+\S/.test(line)) {
        description += ' ' + line.trim();
        continue;
      }
      inFoldedDesc = false;
    }
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (!m) continue;
    if (m[1] === 'description') {
      const val = m[2].trim();
      if (val === '>' || val === '|') {
        inFoldedDesc = true;
        description = '';
      } else {
        description = val;
      }
    }
    if (m[1] === 'name') fmName = m[2].trim();
  }
  description = description.trim();
  return { description, name: fmName, body };
}

function applyPathSubs(content) {
  let out = content;
  for (const [pattern, replacement] of PATH_SUBS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function buildCodexSkillContent(cmdName, description, body, needsWarning) {
  const safeDesc = description.replace(/"/g, '\\"');
  const fm = `---\nname: ${cmdName}\ndescription: "${safeDesc}"\n---\n\n`;
  const convertedBody = applyPathSubs(body);
  const prefix = needsWarning ? WARNING_COMMENT : '';
  return fm + prefix + convertedBody.trimStart();
}

function safeRead(filePath) {
  try { return readFileSync(filePath, 'utf8'); }
  catch { return null; }
}

function ensureDir(dirPath) {
  mkdirSync(dirPath, { recursive: true });
}

function writeFile(filePath, content) {
  ensureDir(join(filePath, '..'));
  writeFileSync(filePath, content, 'utf8');
}

// ── Main ─────────────────────────────────────────────────────────────────────

console.log('Claude commands → Codex skills + Gemini commands');
if (DRY_RUN) console.log('  (dry-run — use --force to write)\n');
else         console.log('  (--force — writing files)\n');

let mdFiles;
try {
  mdFiles = readdirSync(CLAUDE_COMMANDS_DIR)
    .filter(f => f.endsWith('.md'))
    .sort();
} catch (err) {
  console.error(`ERROR: Cannot read ${CLAUDE_COMMANDS_DIR}: ${err.message}`);
  process.exit(1);
}

let countConverted  = 0;
let countWarnings   = 0;
let countProtected  = 0;
let countUnchanged  = 0;

for (const file of mdFiles) {
  const cmdName = basename(file, '.md');
  const srcPath = join(CLAUDE_COMMANDS_DIR, file);
  const raw     = safeRead(srcPath);

  if (raw === null) {
    console.log(`  SKIP [unreadable]: ${file}`);
    continue;
  }

  // ── Protected ──
  if (PROTECTED.has(cmdName)) {
    console.log(`  CONVERT: ${file} → SKIP [protected]`);
    countProtected++;
    continue;
  }

  const { description, body } = parseFrontmatter(raw);
  const needsWarning = NEEDS_MANUAL_ADAPTATION.has(cmdName);

  // ── Codex ──
  if (!GEMINI_ONLY) {
    const codexSkillDir  = join(CODEX_SKILLS_DIR, `cmd-${cmdName}`);
    const codexSkillFile = join(codexSkillDir, 'SKILL.md');
    const codexContent   = buildCodexSkillContent(cmdName, description, body, needsWarning);

    const existing = safeRead(codexSkillFile);
    const codexUnchanged = existing !== null && existing === codexContent;

    if (!codexUnchanged) {
      if (!DRY_RUN) {
        ensureDir(codexSkillDir);
        writeFile(codexSkillFile, codexContent);
      }
    }

    // Gemini
    if (!CODEX_ONLY) {
      const geminiFile    = join(GEMINI_COMMANDS_DIR, file);
      const geminiContent = raw;
      const existingGemini = safeRead(geminiFile);
      const geminiUnchanged = existingGemini !== null && existingGemini === geminiContent;

      const bothUnchanged = codexUnchanged && geminiUnchanged;

      if (bothUnchanged) {
        console.log(`  CONVERT: ${file} → SKIP [unchanged]`);
        countUnchanged++;
      } else {
        const warnTag = needsWarning ? ' [WARNING: needs adaptation]' : '';
        console.log(
          `  CONVERT: ${file} → cmd-${cmdName}/SKILL.md${warnTag} + gemini/commands/${file}`
        );
        if (!DRY_RUN && !geminiUnchanged) {
          writeFile(geminiFile, geminiContent);
        }
        countConverted++;
        if (needsWarning) countWarnings++;
      }
    } else {
      // codex-only
      if (codexUnchanged) {
        console.log(`  CONVERT: ${file} → SKIP [unchanged]`);
        countUnchanged++;
      } else {
        const warnTag = needsWarning ? ' [WARNING: needs adaptation]' : '';
        console.log(`  CONVERT: ${file} → cmd-${cmdName}/SKILL.md${warnTag}`);
        countConverted++;
        if (needsWarning) countWarnings++;
      }
    }
  } else {
    // gemini-only
    const geminiFile     = join(GEMINI_COMMANDS_DIR, file);
    const geminiContent  = raw;
    const existingGemini = safeRead(geminiFile);
    const geminiUnchanged = existingGemini !== null && existingGemini === geminiContent;

    if (geminiUnchanged) {
      console.log(`  CONVERT: ${file} → SKIP [unchanged]`);
      countUnchanged++;
    } else {
      console.log(`  CONVERT: ${file} → gemini/commands/${file}`);
      if (!DRY_RUN) {
        writeFile(geminiFile, geminiContent);
      }
      countConverted++;
    }
  }
}

console.log(
  `\nSummary: ${countConverted} converted, ${countWarnings} with warnings, ` +
  `${countProtected} protected, ${countUnchanged} unchanged`
);
