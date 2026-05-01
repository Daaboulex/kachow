#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// BeforeTool hook: auto-sync Gemini skills → Claude commands and rules
// Cross-platform (Linux, macOS, Windows)

const fs = require('fs');
const path = require('path');
const { reverseToolMap, reverseModelMap, geminiOnlyFields, translateFrontmatter } = require('./lib/platform-map');

try {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }
  const input = JSON.parse(raw);
  const filePath = (input.tool_input || {}).file_path || '';

  // Normalize path separators for Windows compatibility
  const normalized = filePath.replace(/\\/g, '/');

  // Sync skills → commands
  if (normalized.includes('.gemini/skills/') && normalized.endsWith('SKILL.md')) {
    const skillDir = path.dirname(filePath);
    const skillName = path.basename(skillDir);
    const projectRoot = skillDir.replace(/[/\\]\.ai-context[/\\]\.gemini[/\\]skills[/\\][^/\\]+$/, '')
                                .replace(/[/\\]\.gemini[/\\]skills[/\\][^/\\]+$/, '');

    const candidates = [
      path.join(projectRoot, '.claude', 'commands', skillName + '.md'),
      path.join(projectRoot, '.ai-context', '.claude', 'commands', skillName + '.md'),
    ];

    const content = fs.readFileSync(filePath, 'utf8');
    const translated = translateFrontmatter(content, reverseToolMap, geminiOnlyFields, reverseModelMap);

    for (const cmdFile of candidates) {
      if (fs.existsSync(path.dirname(cmdFile))) {
        fs.writeFileSync(cmdFile, translated, 'utf8');
        console.log(JSON.stringify({
          systemMessage: `Auto-synced skill → command: ${skillName}`
        }));
        process.exit(0);
      }
    }
  }

  // Sync rules
  if (normalized.includes('.gemini/rules/') && normalized.endsWith('.md')) {
    const ruleName = path.basename(filePath);
    const rulesDir = path.dirname(filePath);
    const claudeRulesDir = rulesDir.replace(/\.gemini[/\\]rules$/, path.join('.claude', 'rules'));

    if (fs.existsSync(claudeRulesDir)) {
      fs.copyFileSync(filePath, path.join(claudeRulesDir, ruleName));
      console.log(JSON.stringify({
        systemMessage: `Auto-synced rule → claude: ${ruleName}`
      }));
      process.exit(0);
    }
  }

  console.log('{}');
} catch (e) {
  console.error(e.message);
  console.log('{}');
}
