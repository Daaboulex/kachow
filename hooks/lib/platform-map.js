// Platform translation map — single source of truth for Claude <-> Gemini mappings
// Used by all sync hooks to translate between platforms

const toolMap = {
  // Claude -> Gemini
  'Read': 'read_file',
  'Edit': 'replace',
  'Write': 'write_file',
  'Bash': 'run_shell_command',
  'Glob': 'glob',
  'Grep': 'search_file_content',
  'Agent': 'spawn_agent',
  'Skill': 'activate_skill',
  'WebFetch': 'web_fetch',
  'WebSearch': 'google_web_search',
  'TodoWrite': 'todo_write',
  'TodoRead': 'todo_read',
};

const reverseToolMap = Object.fromEntries(
  Object.entries(toolMap).map(([k, v]) => [v, k])
);

const modelMap = {
  // Claude -> Gemini
  'opus': 'gemini-2.5-pro',
  'sonnet': 'gemini-2.5-flash',
  'haiku': 'gemini-2.0-flash',
};

const reverseModelMap = Object.fromEntries(
  Object.entries(modelMap).map(([k, v]) => [v, k])
);

const eventMap = {
  // Claude -> Gemini
  'PreToolUse': 'BeforeTool',
  'PostToolUse': 'AfterTool',
  'Stop': 'SessionEnd',
  'SubagentStart': 'BeforeAgent',
  'SubagentStop': 'AfterAgent',
  'PreCompact': 'PreCompress',
};

const reverseEventMap = Object.fromEntries(
  Object.entries(eventMap).map(([k, v]) => [v, k])
);

// Claude-only frontmatter fields to strip when syncing to Gemini
const claudeOnlyFields = ['permissionMode', 'color'];
// Gemini-only frontmatter fields to strip when syncing to Claude
const geminiOnlyFields = [];

/**
 * Translate YAML frontmatter tools list from one platform to another
 * @param {string} content - full file content
 * @param {Object} map - tool name mapping (e.g., toolMap or reverseToolMap)
 * @param {string[]} stripFields - frontmatter fields to remove
 * @param {Object} mMap - model name mapping
 * @returns {string} translated content
 */
function translateFrontmatter(content, map, stripFields, mMap) {
  // Split frontmatter from body
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return content;

  let frontmatter = match[1];
  const body = content.slice(match[0].length);

  // Direction detection: toolMap has 'Read' key (Claude→Gemini), reverseToolMap has 'read_file' (Gemini→Claude).
  // This determines the required tools-field SHAPE for the target platform.
  //   - Claude accepts both `tools: X, Y` and `tools:\n  - X\n  - Y` forms
  //   - Gemini 0.39+ REQUIRES array form; inline-string fails schema validation
  // So Claude→Gemini must convert inline-string → array; Gemini→Claude keeps either.
  const isToGemini = map.Read !== undefined;

  // Translate tool names in YAML list format (- ToolName)
  frontmatter = frontmatter.replace(/^(\s*-\s+)(\S+)\s*\r?$/gm, (line, prefix, toolName) => {
    return prefix + (map[toolName] || toolName);
  });

  // Translate tool names in inline comma-separated format (tools: Read, Write, Bash)
  frontmatter = frontmatter.replace(/^(tools:\s*)(.+?)\s*\r?$/m, (line, prefix, toolList) => {
    // Skip if it's just a blank (YAML list follows on next lines)
    if (!toolList.trim()) return line;
    const names = toolList.split(/,\s*/).map(t => map[t.trim()] || t.trim());
    if (isToGemini) {
      // Gemini schema requires array form — convert inline string to YAML list
      return `tools:\n  - ${names.join('\n  - ')}`;
    }
    return prefix + names.join(', ');
  });

  // Translate model: field
  frontmatter = frontmatter.replace(/^(model:\s*)(\S+)\s*\r?$/m, (line, prefix, modelName) => {
    return prefix + (mMap[modelName] || modelName);
  });

  // Strip platform-specific fields
  for (const field of stripFields) {
    frontmatter = frontmatter.replace(new RegExp(`^${field}:.*\\r?$\\n?`, 'm'), '');
  }

  // Strip trailing whitespace/newlines left by field stripping or tools-shape conversion,
  // so the closing --- doesn't get a phantom blank line in front of it.
  frontmatter = frontmatter.replace(/\s+$/, '');

  return `---\n${frontmatter}\n---${body}`;
}

module.exports = {
  toolMap,
  reverseToolMap,
  modelMap,
  reverseModelMap,
  eventMap,
  reverseEventMap,
  claudeOnlyFields,
  geminiOnlyFields,
  translateFrontmatter,
};
