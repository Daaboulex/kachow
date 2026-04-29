// tool-detect.js — robust runtime detection of which AI tool invoked a hook.
//
// Works WITH symlinks: uses process.argv[1] (the as-invoked path) rather than
// __dirname (the resolved-symlink path). When ~/.claude/hooks/foo.js is a
// symlink to ~/.ai-context/hooks/foo.js, __dirname becomes the canonical
// path — losing tool context. argv[1] preserves the invoking path.
//
// Detection order:
//   1. AI_TOOL env var (explicit override; settings.json/config.toml can set it)
//   2. argv[1] path inspection (covers symlinked deployment)
//   3. Tool-specific env var hints (CLAUDECODE / GEMINI_API_KEY / CODEX_HOME)
//   4. Default to 'claude' (most common parent)
//
// Tools: 'claude' | 'gemini' | 'codex'

'use strict';

function detectTool() {
  // 1. Explicit env override
  if (process.env.AI_TOOL) {
    const t = process.env.AI_TOOL.toLowerCase();
    if (t === 'claude' || t === 'gemini' || t === 'codex') return t;
  }

  // 2. argv[1] path (preserves symlink path)
  const inv = process.argv[1] || '';
  if (inv.includes('/.gemini/')) return 'gemini';
  if (inv.includes('/.codex/'))  return 'codex';
  if (inv.includes('/.claude/')) return 'claude';

  // 3. Env var hints
  if (process.env.CODEX_HOME) return 'codex';
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) return 'gemini';
  if (process.env.CLAUDECODE !== undefined || process.env.CLAUDE_CODE_FORK_SUBAGENT !== undefined) return 'claude';

  // 4. Default
  return 'claude';
}

// Tool-specific event names (Claude/Codex use Claude names; Gemini uses different)
const EVENT_NAMES = {
  claude: { preTool: 'PreToolUse', postTool: 'PostToolUse', preCompact: 'PreCompact', sessionEnd: 'SessionEnd' },
  gemini: { preTool: 'BeforeTool', postTool: 'AfterTool',   preCompact: 'PreCompress', sessionEnd: 'SessionEnd' },
  codex:  { preTool: 'PreToolUse', postTool: 'PostToolUse', preCompact: null, sessionEnd: null },
};

// Tool-specific path components (used by hooks that read tool-local files)
const TOOL_DIRS = {
  claude: { home: '.claude', settings: '.claude/settings.json' },
  gemini: { home: '.gemini', settings: '.gemini/settings.json' },
  codex:  { home: '.codex',  settings: '.codex/config.toml'    },
};

module.exports = { detectTool, EVENT_NAMES, TOOL_DIRS };
