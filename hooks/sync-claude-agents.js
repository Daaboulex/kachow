#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// Sync Gemini agents -> Claude agents with frontmatter translation
// Triggered: AfterTool on write_file|replace matching *.gemini/agents/*.md

const fs = require('fs');
const path = require('path');
const { reverseToolMap, reverseModelMap, geminiOnlyFields, translateFrontmatter } = require('./lib/platform-map');

// Read hook input
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => input += d);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const filePath = data.tool_input?.file_path || data.tool_input?.path || '';

    // Only process .gemini/agents/*.md files
    if (!filePath.match(/\.gemini\/agents\/[^/]+\.md$/)) {
      process.stdout.write(JSON.stringify({ continue: true }));
      return;
    }

    // Determine the Claude target path
    const claudePath = filePath.replace(/\.gemini\/agents\//, '.claude/agents/');

    if (!fs.existsSync(filePath)) {
      process.stdout.write(JSON.stringify({ continue: true }));
      return;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const translated = translateFrontmatter(content, reverseToolMap, geminiOnlyFields, reverseModelMap);

    // Ensure target directory exists
    const targetDir = path.dirname(claudePath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    fs.writeFileSync(claudePath, translated, 'utf8');

    process.stdout.write(JSON.stringify({
      continue: true,
      systemMessage: `Auto-synced agent -> claude: ${path.basename(filePath, '.md')}`
    }));
  } catch (e) {
    process.stdout.write(JSON.stringify({ continue: true }));
  }
});
