#!/usr/bin/env node
// personal-context MCP server — dependency-free, stdio JSON-RPC 2.0.
// Exposes personal AI context (memory, skills, debt, rules) to any MCP-capable client.
//
// Registered in: Claude Code (~/.mcp.json or ~/.claude.json), Gemini CLI (~/.gemini/settings.json mcpServers),
// Codex CLI, OpenCode, Cursor, Cline, Continue, Zed, VSCode Copilot, etc.
//
// Protocol: MCP 2025-11 revision. Stdio transport. JSON-RPC 2.0. stderr for logs only.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const AI_CONTEXT = process.env.AI_CONTEXT || path.join(os.homedir(), '.ai-context');
const MEMORY_DIRS = [
  path.join(AI_CONTEXT, 'memory'),
  path.join(os.homedir(), '.claude', 'projects'), // per-cwd auto memories
];
const SKILLS_DIR = path.join(AI_CONTEXT, 'skills');
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];
const SERVER_NAME = 'personal-context';
// Framework version: read from VERSION file (ships with every release). Falls
// back to dev marker if file missing (working copy between bumps).
function resolveVersion() {
  for (const candidate of [
    path.join(AI_CONTEXT, 'VERSION'),
    path.join(__dirname, '..', '..', 'VERSION'),
    path.join(__dirname, '..', 'VERSION'),
  ]) {
    try {
      const v = fs.readFileSync(candidate, 'utf8').trim();
      if (/^\d+\.\d+\.\d+/.test(v)) return v;
    } catch {}
  }
  return '0.0.0-dev';
}
const SERVER_VERSION = resolveVersion();

// ───── Helpers ─────

function log(...args) {
  process.stderr.write('[personal-context] ' + args.join(' ') + '\n');
}

function walkMarkdown(dir, out = []) {
  try {
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith('.')) continue;
      if (name === 'archive' || name === 'node_modules') continue;
      const full = path.join(dir, name);
      let st;
      try { st = fs.statSync(full); } catch { continue; }
      if (st.isDirectory()) walkMarkdown(full, out);
      else if (name.endsWith('.md')) out.push(full);
    }
  } catch {}
  return out;
}

function extractFrontmatter(content) {
  if (!content.startsWith('---')) return { meta: {}, body: content };
  const end = content.indexOf('---', 3);
  if (end < 0) return { meta: {}, body: content };
  const fm = content.slice(3, end).trim();
  const meta = {};
  for (const line of fm.split('\n')) {
    const m = line.match(/^(\w+):\s*(.+)$/);
    if (m) meta[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return { meta, body: content.slice(end + 3).trimStart() };
}

// SEC-2 (v0.2.0): caller-supplied cwd must canonicalize + fall inside
// approved roots. Prevents crafted cwd escaping to system paths via .. segments.
const APPROVED_CWD_ROOTS = [
  os.homedir(),
  AI_CONTEXT,
];

function canonicalizeCwd(cwd) {
  const input = cwd || process.cwd();
  let resolved;
  try { resolved = fs.realpathSync(input); }
  catch { try { resolved = path.resolve(input); } catch { return null; } }
  const ok = APPROVED_CWD_ROOTS.some(root => {
    try {
      const rroot = fs.realpathSync(root);
      return resolved === rroot || resolved.startsWith(rroot + path.sep);
    } catch { return false; }
  });
  return ok ? resolved : null;
}

function findRepoDebt(cwd) {
  let dir = canonicalizeCwd(cwd);
  if (!dir) return null;
  const root = path.parse(dir).root;
  while (dir && dir !== root) {
    const p = path.join(dir, 'DEBT.md');
    if (fs.existsSync(p)) return p;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function findCanonicalDir(cwd) {
  let dir = canonicalizeCwd(cwd);
  if (!dir) return null;
  const root = path.parse(dir).root;
  while (dir && dir !== root) {
    for (const candidate of ['.claude', '.ai-context']) {
      const p = path.join(dir, candidate);
      try { if (fs.statSync(p).isDirectory()) return p; } catch {}
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function slugifyName(name) {
  return String(name).toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// SEC-1 (v0.2.0): get_skill name must stay inside SKILLS_DIR.
function safeSkillName(name) {
  const slug = slugifyName(name);
  if (!slug) return null;
  const target = path.resolve(SKILLS_DIR, slug, 'SKILL.md');
  const root = path.resolve(SKILLS_DIR) + path.sep;
  if (!target.startsWith(root)) return null;
  return target;
}

// SEC-3 (v0.2.0): MCP write tools reject when any subagent marker <30min
// old exists. MCP server has no caller session_id, so marker-dir presence
// is proxy. Trade-off: while any subagent runs, parent writes blocked too.
const SUBAGENT_MARKER_DIR = path.join(os.homedir(), '.claude', 'cache', 'subagent-active');
const SUBAGENT_MARKER_TTL_MS = 30 * 60 * 1000;

function activeSubagentPresent() {
  try {
    const now = Date.now();
    for (const name of fs.readdirSync(SUBAGENT_MARKER_DIR)) {
      if (!name.endsWith('.json')) continue;
      try {
        const st = fs.statSync(path.join(SUBAGENT_MARKER_DIR, name));
        if ((now - st.mtimeMs) < SUBAGENT_MARKER_TTL_MS) return true;
      } catch {}
    }
  } catch {}
  return false;
}

// ───── MCP tools ─────

const TOOLS = {
  search_memory: {
    description: 'Search markdown memory files at ~/.ai-context/memory/ and per-cwd auto-memory for a substring query. Returns file paths, frontmatter descriptions, and matched line snippets.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Substring to search for (case-insensitive)' },
        limit: { type: 'integer', description: 'Max results (default 20)', default: 20 },
      },
      required: ['query'],
    },
    handler: ({ query, limit = 20 }) => {
      const q = String(query || '').toLowerCase();
      if (!q) return { content: [{ type: 'text', text: 'empty query' }] };
      const files = [];
      for (const d of MEMORY_DIRS) walkMarkdown(d, files);
      const hits = [];
      for (const f of files) {
        let c;
        try { c = fs.readFileSync(f, 'utf8'); } catch { continue; }
        const lc = c.toLowerCase();
        if (!lc.includes(q)) continue;
        const { meta } = extractFrontmatter(c);
        const lines = c.split('\n');
        const matches = [];
        lines.forEach((line, i) => {
          if (line.toLowerCase().includes(q) && matches.length < 3) {
            matches.push(`L${i + 1}: ${line.trim().slice(0, 160)}`);
          }
        });
        hits.push({
          file: f,
          name: meta.name || path.basename(f, '.md'),
          description: meta.description || '',
          type: meta.type || '',
          matches,
        });
        if (hits.length >= limit) break;
      }
      if (hits.length === 0) {
        return { content: [{ type: 'text', text: `No memory files matched "${q}". Searched ${files.length} files.` }] };
      }
      const out = hits.map(h =>
        `### ${h.name} (${h.type})\n${h.file}\n${h.description}\n${h.matches.join('\n')}`
      ).join('\n\n---\n\n');
      return { content: [{ type: 'text', text: out }] };
    },
  },

  read_memory: {
    description: 'Read the full content of a named memory file.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Memory name or basename (with or without .md)' } },
      required: ['name'],
    },
    handler: ({ name }) => {
      const base = String(name).replace(/\.md$/, '') + '.md';
      const files = [];
      for (const d of MEMORY_DIRS) walkMarkdown(d, files);
      const match = files.find(f => path.basename(f) === base);
      if (!match) return { content: [{ type: 'text', text: `memory "${base}" not found` }], isError: true };
      return { content: [{ type: 'text', text: fs.readFileSync(match, 'utf8') }] };
    },
  },

  list_memories: {
    description: 'List all memory files with name, type, and one-line description from frontmatter.',
    inputSchema: {
      type: 'object',
      properties: { type: { type: 'string', description: 'Optional filter: user|feedback|project|reference' } },
    },
    handler: ({ type } = {}) => {
      const files = [];
      for (const d of MEMORY_DIRS) walkMarkdown(d, files);
      const list = [];
      for (const f of files) {
        try {
          const { meta } = extractFrontmatter(fs.readFileSync(f, 'utf8'));
          if (type && meta.type !== type) continue;
          list.push(`- [${meta.type || '?'}] ${meta.name || path.basename(f, '.md')} — ${meta.description || '(no description)'}\n    ${f}`);
        } catch {}
      }
      return { content: [{ type: 'text', text: list.join('\n') || 'no memories found' }] };
    },
  },

  list_skills: {
    description: 'List all skills at ~/.ai-context/skills/ with descriptions.',
    inputSchema: { type: 'object', properties: {} },
    handler: () => {
      const out = [];
      try {
        for (const name of fs.readdirSync(SKILLS_DIR)) {
          const skillMd = path.join(SKILLS_DIR, name, 'SKILL.md');
          if (!fs.existsSync(skillMd)) continue;
          try {
            const { meta } = extractFrontmatter(fs.readFileSync(skillMd, 'utf8'));
            out.push(`- **${meta.name || name}** — ${meta.description || '(no description)'}`);
          } catch {}
        }
      } catch {}
      return { content: [{ type: 'text', text: out.join('\n') || 'no skills found' }] };
    },
  },

  get_skill: {
    description: 'Read a skill\'s SKILL.md content by name.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Skill directory name' } },
      required: ['name'],
    },
    handler: ({ name }) => {
      const skillMd = safeSkillName(name);
      if (!skillMd) return { content: [{ type: 'text', text: `invalid skill name` }], isError: true };
      if (!fs.existsSync(skillMd)) return { content: [{ type: 'text', text: `skill "${name}" not found` }], isError: true };
      return { content: [{ type: 'text', text: fs.readFileSync(skillMd, 'utf8') }] };
    },
  },

  read_debt: {
    description: 'Read DEBT.md from the given repo path (or walk up from cwd). Returns current technical debt entries.',
    inputSchema: {
      type: 'object',
      properties: { cwd: { type: 'string', description: 'Optional starting directory (default: server cwd)' } },
    },
    handler: ({ cwd } = {}) => {
      const p = findRepoDebt(cwd);
      if (!p) return { content: [{ type: 'text', text: 'no DEBT.md found walking up from ' + (cwd || process.cwd()) }] };
      return { content: [{ type: 'text', text: fs.readFileSync(p, 'utf8') }] };
    },
  },

  get_rule: {
    description: 'Read the canonical AGENTS.md (global rules file). Use when you want the full rule set fresh.',
    inputSchema: { type: 'object', properties: {} },
    handler: () => {
      const p = path.join(AI_CONTEXT, 'AGENTS.md');
      if (!fs.existsSync(p)) return { content: [{ type: 'text', text: 'AGENTS.md missing' }], isError: true };
      return { content: [{ type: 'text', text: fs.readFileSync(p, 'utf8') }] };
    },
  },

  read_handoff: {
    description: 'Read the latest session handoff document for a project (walks up from cwd to find .claude/ or .ai-context/, then reads .session-handoff.md).',
    inputSchema: {
      type: 'object',
      properties: { cwd: { type: 'string', description: 'Optional starting directory (default: server cwd)' } },
    },
    handler: ({ cwd } = {}) => {
      const canonical = findCanonicalDir(cwd);
      if (!canonical) return { content: [{ type: 'text', text: 'no .claude/ or .ai-context/ found walking up from ' + (cwd || process.cwd()) }] };
      const p = path.join(canonical, '.session-handoff.md');
      if (!fs.existsSync(p)) return { content: [{ type: 'text', text: `no handoff at ${p}` }] };
      return { content: [{ type: 'text', text: fs.readFileSync(p, 'utf8') }] };
    },
  },

  list_handoffs: {
    description: 'List all historical session handoff files (.session-handoff-*.md) for a project.',
    inputSchema: {
      type: 'object',
      properties: { cwd: { type: 'string', description: 'Optional starting directory' } },
    },
    handler: ({ cwd } = {}) => {
      const canonical = findCanonicalDir(cwd);
      if (!canonical) return { content: [{ type: 'text', text: 'no canonical dir found' }] };
      try {
        const files = fs.readdirSync(canonical)
          .filter(f => /^\.session-handoff.*\.md$/.test(f))
          .map(f => {
            const full = path.join(canonical, f);
            const stat = fs.statSync(full);
            return { file: f, mtime: stat.mtime.toISOString(), size: stat.size };
          })
          .sort((a, b) => b.mtime.localeCompare(a.mtime));
        if (files.length === 0) return { content: [{ type: 'text', text: 'no handoffs found' }] };
        const out = files.map(f => `- ${f.file} (${f.mtime}, ${f.size}B)`).join('\n');
        return { content: [{ type: 'text', text: out }] };
      } catch (e) {
        return { content: [{ type: 'text', text: 'error: ' + e.message }], isError: true };
      }
    },
  },

  list_tasks: {
    description: 'List open tasks (in_progress + blocked) from AI-tasks.json for a project. Shows verifiedBy status.',
    inputSchema: {
      type: 'object',
      properties: { cwd: { type: 'string', description: 'Optional starting directory' } },
    },
    handler: ({ cwd } = {}) => {
      const canonical = findCanonicalDir(cwd);
      if (!canonical) return { content: [{ type: 'text', text: 'no canonical dir found' }] };
      const p = path.join(canonical, 'AI-tasks.json');
      if (!fs.existsSync(p)) return { content: [{ type: 'text', text: 'no AI-tasks.json' }] };
      try {
        const d = JSON.parse(fs.readFileSync(p, 'utf8'));
        const tasks = d.tasks || [];
        if (tasks.length === 0) return { content: [{ type: 'text', text: 'no open tasks' }] };
        const out = tasks.map(t => `[${t.status}] ${t.subject || t.content || '(unnamed)'}\n  src=${t.source||'?'} verifiedBy=${t.verifiedBy||'not-verified'}`).join('\n');
        return { content: [{ type: 'text', text: out }] };
      } catch (e) {
        return { content: [{ type: 'text', text: 'error: ' + e.message }], isError: true };
      }
    },
  },

  read_progress: {
    description: 'Read the latest AI-progress.json entries (most recent sessions) for a project. Returns summary of recent work.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Optional starting directory' },
        limit: { type: 'integer', description: 'Max recent sessions (default 5)', default: 5 },
      },
    },
    handler: ({ cwd, limit = 5 } = {}) => {
      const canonical = findCanonicalDir(cwd);
      if (!canonical) return { content: [{ type: 'text', text: 'no canonical dir found' }] };
      const p = path.join(canonical, 'AI-progress.json');
      if (!fs.existsSync(p)) return { content: [{ type: 'text', text: 'no AI-progress.json' }] };
      try {
        const d = JSON.parse(fs.readFileSync(p, 'utf8'));
        const sessions = (d.sessions || []).slice(-limit).reverse();
        if (sessions.length === 0) return { content: [{ type: 'text', text: 'no session entries' }] };
        const out = sessions.map(s => `## ${s.timestamp || '?'} (${s.duration || '?'})\n${s.summary || ''}\nFiles: ${(s.files_changed || []).slice(0, 5).join(', ')}`).join('\n\n');
        return { content: [{ type: 'text', text: out }] };
      } catch (e) {
        return { content: [{ type: 'text', text: 'error: ' + e.message }], isError: true };
      }
    },
  },

  add_memory: {
    description: 'Append a new memory file to ~/.ai-context/memory/. Requires name, type (user|feedback|project|reference), description, and body content.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short name (used as filename after slugifying)' },
        type: { type: 'string', enum: ['user', 'feedback', 'project', 'reference'], description: 'Memory category' },
        description: { type: 'string', description: 'One-line description for MEMORY.md index' },
        body: { type: 'string', description: 'Full memory content (markdown)' },
      },
      required: ['name', 'type', 'description', 'body'],
    },
    handler: ({ name, type, description, body }) => {
      if (activeSubagentPresent()) {
        return { content: [{ type: 'text', text: 'mcp_write_blocked: active subagent session — parent-only writes permitted. Wait for subagent completion.' }], isError: true };
      }
      if (!name || !type || !description || !body) {
        return { content: [{ type: 'text', text: 'missing required field' }], isError: true };
      }
      const slug = slugifyName(name);
      const fileName = `${type}_${slug}.md`;
      const memoryDir = path.join(AI_CONTEXT, 'memory');
      try { fs.mkdirSync(memoryDir, { recursive: true }); } catch {}
      const full = path.join(memoryDir, fileName);
      if (fs.existsSync(full)) {
        return { content: [{ type: 'text', text: `memory already exists: ${fileName} — refuse to overwrite` }], isError: true };
      }
      const safeDesc = description.replace(/\n/g, ' ').slice(0, 300);
      const content = `---\nname: ${name}\ndescription: ${safeDesc}\ntype: ${type}\n---\n\n${body.trimEnd()}\n`;
      try {
        fs.writeFileSync(full, content);
        return { content: [{ type: 'text', text: `wrote ${full}` }] };
      } catch (e) {
        return { content: [{ type: 'text', text: 'write failed: ' + e.message }], isError: true };
      }
    },
  },

  add_debt: {
    description: 'Append a new entry to the nearest DEBT.md file. Walks up from cwd. Creates DEBT.md if missing.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Starting directory (walks up to find / create DEBT.md)' },
        title: { type: 'string', description: 'Short title for the debt entry' },
        symptom: { type: 'string', description: 'What is broken or observed' },
        fix_approach: { type: 'string', description: 'What a proper fix looks like' },
        severity: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'], description: 'P0 safety | P1 broken core | P2 degraded | P3 cosmetic' },
        workaround: { type: 'string', description: 'Current bandaid (optional)' },
      },
      required: ['title', 'symptom', 'severity'],
    },
    handler: ({ cwd, title, symptom, fix_approach, severity, workaround }) => {
      if (activeSubagentPresent()) {
        return { content: [{ type: 'text', text: 'mcp_write_blocked: active subagent session — parent-only writes permitted. Wait for subagent completion.' }], isError: true };
      }
      // Enforce schema-required fields explicitly — MCP arg validation varies by client.
      const missing = [];
      if (!title || typeof title !== 'string') missing.push('title');
      if (!symptom || typeof symptom !== 'string') missing.push('symptom');
      if (!severity || !['P0', 'P1', 'P2', 'P3'].includes(severity)) missing.push('severity (P0|P1|P2|P3)');
      if (missing.length > 0) {
        return {
          content: [{ type: 'text', text: `add_debt: missing required field(s): ${missing.join(', ')}` }],
          isError: true,
        };
      }
      let debtPath = findRepoDebt(cwd);
      if (!debtPath) {
        // Create at canonical dir or cwd
        const canonical = findCanonicalDir(cwd);
        const base = canonical ? path.dirname(canonical) : (cwd || process.cwd());
        debtPath = path.join(base, 'DEBT.md');
        try {
          fs.writeFileSync(debtPath, `# Technical Debt\n\n> Known issues not yet fixed. See \`~/.ai-context/skills/debt-tracker/SKILL.md\` for format.\n\n## Open\n\n## Resolved\n`);
        } catch (e) {
          return { content: [{ type: 'text', text: 'could not create DEBT.md: ' + e.message }], isError: true };
        }
      }
      try {
        const current = fs.readFileSync(debtPath, 'utf8');
        // Find next D-N
        const ids = [...current.matchAll(/\[D-(\d+)\]/g)].map(m => parseInt(m[1], 10));
        const nextId = (ids.length ? Math.max(...ids) : 0) + 1;
        const today = new Date().toISOString().slice(0, 10);
        const entry = `\n### [D-${nextId}] ${title}\n- **Discovered:** ${today}\n- **Symptom:** ${symptom}\n${workaround ? `- **Workaround:** ${workaround}\n` : ''}${fix_approach ? `- **Fix approach:** ${fix_approach}\n` : ''}- **Severity:** ${severity}\n- **Owner:** @[user]\n`;
        // Insert after "## Open"
        let updated;
        if (/^## Open\s*$/m.test(current)) {
          updated = current.replace(/(^## Open\s*$)/m, `$1\n${entry}`);
        } else {
          updated = current + `\n## Open\n${entry}`;
        }
        fs.writeFileSync(debtPath, updated);
        return { content: [{ type: 'text', text: `added [D-${nextId}] to ${debtPath}` }] };
      } catch (e) {
        return { content: [{ type: 'text', text: 'write failed: ' + e.message }], isError: true };
      }
    },
  },

  search_handoffs: {
    description: 'Grep across all session handoff files in the current project for a query.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Substring to search for' },
        cwd: { type: 'string', description: 'Optional starting directory' },
      },
      required: ['query'],
    },
    handler: ({ query, cwd }) => {
      const canonical = findCanonicalDir(cwd);
      if (!canonical) return { content: [{ type: 'text', text: 'no canonical dir found' }] };
      const q = String(query).toLowerCase();
      try {
        const files = fs.readdirSync(canonical).filter(f => /^\.session-handoff.*\.md$/.test(f));
        const hits = [];
        for (const f of files) {
          const full = path.join(canonical, f);
          const c = fs.readFileSync(full, 'utf8');
          if (!c.toLowerCase().includes(q)) continue;
          const lines = c.split('\n');
          const matches = lines.map((l, i) => ({ i, l })).filter(({ l }) => l.toLowerCase().includes(q)).slice(0, 3);
          hits.push(`### ${f}\n` + matches.map(({ i, l }) => `L${i + 1}: ${l.trim().slice(0, 160)}`).join('\n'));
        }
        return { content: [{ type: 'text', text: hits.join('\n\n') || `no matches for "${q}"` }] };
      } catch (e) {
        return { content: [{ type: 'text', text: 'error: ' + e.message }], isError: true };
      }
    },
  },
};

// ───── JSON-RPC server ─────

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function handle(req) {
  const { id, method, params } = req;
  try {
    if (method === 'initialize') {
      const clientVer = params && params.protocolVersion;
      const negotiated = SUPPORTED_PROTOCOL_VERSIONS.includes(clientVer) ? clientVer : PROTOCOL_VERSION;
      return send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: negotiated,
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        },
      });
    }
    if (method === 'notifications/initialized') return; // no response for notifications
    if (method === 'tools/list') {
      return send({
        jsonrpc: '2.0',
        id,
        result: {
          tools: Object.entries(TOOLS).map(([name, t]) => ({
            name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        },
      });
    }
    if (method === 'tools/call') {
      const { name, arguments: args } = params || {};
      const tool = TOOLS[name];
      if (!tool) {
        return send({ jsonrpc: '2.0', id, error: { code: -32601, message: `unknown tool: ${name}` } });
      }
      const result = tool.handler(args || {});
      return send({ jsonrpc: '2.0', id, result });
    }
    if (method === 'ping') {
      return send({ jsonrpc: '2.0', id, result: {} });
    }
    // Empty-but-valid handlers for capabilities we don't implement (prevents client spam):
    if (method === 'resources/list') {
      return send({ jsonrpc: '2.0', id, result: { resources: [] } });
    }
    if (method === 'prompts/list') {
      return send({ jsonrpc: '2.0', id, result: { prompts: [] } });
    }
    return send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } });
  } catch (e) {
    log('error handling', method, e.message);
    return send({ jsonrpc: '2.0', id, error: { code: -32603, message: e.message } });
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let req;
    try { req = JSON.parse(line); } catch (e) { log('bad JSON:', e.message); continue; }
    if (Array.isArray(req)) req.forEach(handle);
    else handle(req);
  }
});

process.stdin.on('end', () => process.exit(0));

log(`personal-context MCP server ready (${Object.keys(TOOLS).length} tools)`);
