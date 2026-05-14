#!/usr/bin/env node
// export-session.mjs — Export AI session transcripts to HTML
// Captures ALL message types: user, assistant, hooks, system, tools, tasks, etc.
//
// Modes:
//   --file <path>              Export specific session file
//   --tool <name>              Export latest session for tool
//   --all                      Export all unexported sessions
//   --quiet                    No stdout output
//
// Called automatically by auto-push-global.js Stop hook.
// Uses append-mode: one HTML per session, updated on each Stop (not duplicated).

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'fs';
import { join, dirname, basename, resolve } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOME = homedir();
const ROOT = resolve(__dirname, '..');
const EXPORT_DIR = join(ROOT, 'runtime', 'session-exports');

const args = process.argv.slice(2);
const toolArg = args.includes('--tool') ? args[args.indexOf('--tool') + 1] : null;
const fileArg = args.includes('--file') ? args[args.indexOf('--file') + 1] : null;
const exportAll = args.includes('--all');
const quiet = args.includes('--quiet');

function log(msg) { if (!quiet) console.log(msg); }

mkdirSync(EXPORT_DIR, { recursive: true });

// ── Find latest session file per tool ────────────────────────────────────

function findLatestSession(tool) {
  if (tool === 'claude') {
    const projectsDir = join(HOME, '.claude', 'projects');
    if (!existsSync(projectsDir)) return null;
    const allSessions = [];
    for (const proj of readdirSync(projectsDir)) {
      const projDir = join(projectsDir, proj);
      try {
        if (!statSync(projDir).isDirectory()) continue;
        for (const f of readdirSync(projDir).filter(f => f.endsWith('.jsonl'))) {
          const fp = join(projDir, f);
          allSessions.push({ path: fp, mtime: statSync(fp).mtimeMs });
        }
      } catch {}
    }
    allSessions.sort((a, b) => b.mtime - a.mtime);
    return allSessions[0]?.path || null;
  }

  if (tool === 'gemini') {
    const tmpDir = join(HOME, '.gemini', 'tmp');
    if (!existsSync(tmpDir)) return null;
    const allSessions = [];
    for (const proj of readdirSync(tmpDir)) {
      const chatDir = join(tmpDir, proj, 'chats');
      if (!existsSync(chatDir)) continue;
      for (const f of readdirSync(chatDir).filter(f => f.endsWith('.json') || f.endsWith('.jsonl'))) {
        allSessions.push({ path: join(chatDir, f), mtime: statSync(join(chatDir, f)).mtimeMs });
      }
    }
    allSessions.sort((a, b) => b.mtime - a.mtime);
    return allSessions[0]?.path || null;
  }

  if (tool === 'codex') {
    const sessDir = join(HOME, '.codex', 'sessions');
    if (!existsSync(sessDir)) return null;
    const allSessions = [];
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(dir, e.name));
        else if (e.name.endsWith('.jsonl')) {
          allSessions.push({ path: join(dir, e.name), mtime: statSync(join(dir, e.name)).mtimeMs });
        }
      }
    };
    walk(sessDir);
    allSessions.sort((a, b) => b.mtime - a.mtime);
    return allSessions[0]?.path || null;
  }

  if (tool === 'pi') {
    const sessDir = join(HOME, '.pi', 'agent', 'sessions');
    if (!existsSync(sessDir)) return null;
    const allSessions = [];
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(dir, e.name));
        else if (e.name.endsWith('.jsonl')) {
          allSessions.push({ path: join(dir, e.name), mtime: statSync(join(dir, e.name)).mtimeMs });
        }
      }
    };
    walk(sessDir);
    allSessions.sort((a, b) => b.mtime - a.mtime);
    return allSessions[0]?.path || null;
  }

  return null;
}

// ── HTML helpers ─────────────────────────────────────────────────────────

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const CSS = `
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 960px; margin: 0 auto; padding: 20px; background: #0d1117; color: #c9d1d9; }
h1 { color: #7c83ff; font-size: 1.3em; border-bottom: 1px solid #21262d; padding-bottom: 10px; }
.meta { color: #8b949e; font-size: 0.85em; margin-bottom: 20px; }
.msg { margin: 8px 0; padding: 10px 14px; border-radius: 6px; line-height: 1.5; font-size: 0.9em; }
.user { background: #161b22; border-left: 3px solid #7c83ff; }
.assistant { background: #0d1117; border-left: 3px solid #3fb950; }
.system { background: #1c1200; border-left: 3px solid #d29922; font-size: 0.85em; }
.hook { background: #0d1a12; border-left: 3px solid #238636; font-size: 0.8em; opacity: 0.85; }
.tool-use { background: #0d1117; border-left: 3px solid #1f6feb; font-size: 0.85em; }
.tool-result { background: #0d1117; border-left: 3px solid #388bfd; font-size: 0.8em; }
.task { background: #170f1e; border-left: 3px solid #a371f7; font-size: 0.8em; }
.meta-msg { background: #161b22; border-left: 3px solid #484f58; font-size: 0.8em; opacity: 0.7; }
.role { font-weight: 600; font-size: 0.75em; text-transform: uppercase; margin-bottom: 4px; letter-spacing: 0.5px; }
.role-user { color: #7c83ff; }
.role-assistant { color: #3fb950; }
.role-system { color: #d29922; }
.role-hook { color: #238636; }
.role-tool { color: #1f6feb; }
.role-task { color: #a371f7; }
.role-meta { color: #484f58; }
pre { background: #161b22; padding: 10px; border-radius: 4px; overflow-x: auto; font-size: 0.85em; white-space: pre-wrap; word-break: break-word; }
code { font-family: 'JetBrains Mono', 'Fira Code', monospace; }
.ts { color: #484f58; font-size: 0.7em; float: right; font-family: monospace; }
details { margin: 2px 0; }
details summary { cursor: pointer; color: #8b949e; font-size: 0.8em; }
details pre { margin-top: 4px; }
.stats { background: #161b22; padding: 12px; border-radius: 6px; margin: 12px 0; font-size: 0.85em; }
`;

// ── Claude JSONL → HTML (full fidelity) ──────────────────────────────────

function exportClaude(sessionFile) {
  const lines = readFileSync(sessionFile, 'utf8').trim().split('\n');
  const messages = [];
  let sessionId = basename(sessionFile, '.jsonl');
  let stats = { user: 0, assistant: 0, hooks: 0, tools: 0, system: 0, other: 0 };

  for (const line of lines) {
    let d;
    try { d = JSON.parse(line); } catch { continue; }

    const ts = d.timestamp ? `<span class="ts">${new Date(d.timestamp).toLocaleTimeString()}</span>` : '';

    if (d.type === 'last-prompt' && d.sessionId) sessionId = d.sessionId;

    // User messages
    if (d.type === 'user' && d.message) {
      stats.user++;
      const content = typeof d.message === 'string' ? d.message :
        (d.message.content ? (typeof d.message.content === 'string' ? d.message.content :
          d.message.content.filter(b => b.type === 'text').map(b => b.text).join('\n')) : JSON.stringify(d.message));
      messages.push(`<div class="msg user"><div class="role role-user">User ${ts}</div>${escapeHtml(content)}</div>`);
    }

    // Assistant messages
    if (d.type === 'assistant' && d.message) {
      stats.assistant++;
      const content = d.message.content;
      let parts = [];
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text') parts.push(escapeHtml(block.text));
          else if (block.type === 'tool_use') {
            stats.tools++;
            const inputStr = JSON.stringify(block.input, null, 2);
            parts.push(`<div class="msg tool-use"><div class="role role-tool">Tool: ${escapeHtml(block.name)} ${ts}</div><details><summary>Input (${inputStr.length} chars)</summary><pre>${escapeHtml(inputStr.slice(0, 5000))}</pre></details></div>`);
          }
          else if (block.type === 'thinking') {
            parts.push(`<details class="msg meta-msg"><summary class="role role-meta">Thinking (${(block.text || '').length} chars)</summary><pre>${escapeHtml((block.text || '').slice(0, 3000))}</pre></details>`);
          }
        }
      } else if (typeof content === 'string') {
        parts.push(`<pre>${escapeHtml(content)}</pre>`);
      }
      if (parts.length > 0) {
        messages.push(`<div class="msg assistant"><div class="role role-assistant">Assistant ${ts}</div>${parts.join('\n')}</div>`);
      }
    }

    // Tool results
    if (d.type === 'tool_result') {
      const content = typeof d.content === 'string' ? d.content :
        (Array.isArray(d.content) ? d.content.map(c => c.text || JSON.stringify(c)).join('\n') : JSON.stringify(d.content));
      messages.push(`<details class="msg tool-result"><summary class="role role-tool">Tool Result (${content.length} chars)</summary><pre>${escapeHtml(content.slice(0, 5000))}</pre></details>`);
    }

    // Hook outputs
    if (d.type === 'attachment' && d.attachment) {
      const at = d.attachment;
      const atype = at.type || 'unknown';

      if (atype === 'hook_success') {
        stats.hooks++;
        const hookName = at.hookName || 'unknown';
        const output = at.output || at.additionalContext || at.systemMessage || '';
        if (output) {
          messages.push(`<details class="msg hook"><summary class="role role-hook">Hook: ${escapeHtml(hookName)} ${ts}</summary><pre>${escapeHtml(String(output).slice(0, 3000))}</pre></details>`);
        }
      }
      else if (atype === 'hook_additional_context') {
        stats.hooks++;
        const ctx = at.content || at.additionalContext || '';
        messages.push(`<details class="msg hook"><summary class="role role-hook">Hook Context Injection ${ts}</summary><pre>${escapeHtml(String(ctx).slice(0, 2000))}</pre></details>`);
      }
      else if (atype === 'hook_system_message') {
        stats.hooks++;
        const msg = at.content || at.systemMessage || '';
        messages.push(`<div class="msg hook"><div class="role role-hook">Hook System Message ${ts}</div>${escapeHtml(String(msg))}</div>`);
      }
      else if (atype === 'task_reminder') {
        stats.other++;
        messages.push(`<div class="msg task"><div class="role role-task">Task Reminder ${ts}</div><pre>${escapeHtml(String(at.content || '').slice(0, 1000))}</pre></div>`);
      }
      else if (atype === 'ultrathink_effort') {
        messages.push(`<div class="msg meta-msg"><div class="role role-meta">Ultrathink ${ts}</div></div>`);
      }
      else if (atype === 'edited_text_file') {
        stats.other++;
        messages.push(`<details class="msg tool-use"><summary class="role role-tool">File Edit: ${escapeHtml(at.filePath || '')} ${ts}</summary><pre>${escapeHtml(String(at.content || '').slice(0, 2000))}</pre></details>`);
      }
    }

    // System messages (with subtypes: api_error, compact_boundary, informational, etc.)
    if (d.type === 'system') {
      stats.system++;
      const subtype = d.subtype || 'message';
      const content = d.content || '';
      if (subtype === 'compact_boundary') {
        messages.push(`<div class="msg system"><div class="role role-system">Context Compacted ${ts}</div>${d.compactMetadata ? `Tokens before: ${d.compactMetadata.preCompactTokenCount || '?'}` : ''}</div>`);
      } else {
        messages.push(`<details class="msg system"><summary class="role role-system">${escapeHtml(subtype)} ${ts}</summary><pre>${escapeHtml(String(content).slice(0, 2000))}</pre></details>`);
      }
    }

    // PR links
    if (d.type === 'pr-link') {
      messages.push(`<div class="msg tool-use"><div class="role role-tool">PR Created ${ts}</div><a href="${escapeHtml(d.prUrl || '')}">#${d.prNumber || ''}</a> on ${escapeHtml(d.prRepository || '')}</div>`);
    }

    // Queue operations
    if (d.type === 'queue-operation') {
      messages.push(`<div class="msg meta-msg"><div class="role role-meta">Queue: ${escapeHtml(d.operation || '')} ${ts}</div>${escapeHtml(String(d.content || '').slice(0, 500))}</div>`);
    }

    // Progress events
    if (d.type === 'progress' && d.data) {
      const ptype = d.data.type || '';
      if (ptype === 'bash_progress' || ptype === 'agent_progress') {
        messages.push(`<div class="msg meta-msg"><div class="role role-meta">${escapeHtml(ptype)} ${ts}</div></div>`);
      }
    }

    // Compact summary (machine-generated user record — flag it)
    if (d.type === 'user' && d.isCompactSummary) {
      stats.system++;
      const content = typeof d.message === 'string' ? d.message :
        (d.message?.content ? d.message.content.filter(b => b.type === 'text').map(b => b.text).join('\n') : '');
      messages.push(`<details class="msg system"><summary class="role role-system">Compact Summary (AI-generated) ${ts}</summary><pre>${escapeHtml(content.slice(0, 3000))}</pre></details>`);
    }
  }

  const statsHtml = `<div class="stats">Messages: ${stats.user} user, ${stats.assistant} assistant, ${stats.tools} tools, ${stats.hooks} hooks, ${stats.system} system, ${stats.other} other — ${lines.length} total JSONL lines</div>`;

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Claude session — ${escapeHtml(sessionId)}</title><style>${CSS}</style></head><body>
<h1>Claude Code Session</h1>
<div class="meta">Session: ${escapeHtml(sessionId)}<br>File: ${escapeHtml(basename(sessionFile))}<br>Exported: ${new Date().toISOString()}<br>Lines: ${lines.length}</div>
${statsHtml}
${messages.join('\n')}
</body></html>`;
}

// ── Gemini JSON/JSONL → HTML ─────────────────────────────────────────────

function exportGemini(sessionFile) {
  let data;
  const raw = readFileSync(sessionFile, 'utf8');

  if (sessionFile.endsWith('.jsonl')) {
    const lines = raw.trim().split('\n');
    const entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const header = entries.find(e => e.sessionId) || {};
    data = { ...header, messages: entries.filter(e => e.type && e.type !== 'session') };
  } else {
    data = JSON.parse(raw);
  }

  const messages = [];
  const sessionId = data.sessionId || basename(sessionFile);

  for (const msg of (data.messages || [])) {
    const type = msg.type || msg.role || 'unknown';
    const content = typeof msg.content === 'string' ? msg.content :
      (msg.content?.text || msg.content?.parts?.map(p => p.text || JSON.stringify(p)).join('\n') || JSON.stringify(msg.content || ''));
    const ts = msg.timestamp ? `<span class="ts">${new Date(msg.timestamp).toLocaleTimeString()}</span>` : '';

    // Handle $rewindTo records
    if (msg.$rewindTo) {
      messages.push(`<div class="msg system"><div class="role role-system">Rewind ${ts}</div>Rewound to message: ${escapeHtml(msg.$rewindTo)}</div>`);
      continue;
    }

    if (type === 'user' || type === 'human') {
      const userContent = Array.isArray(msg.content) ?
        msg.content.map(p => typeof p === 'string' ? p : (p.text || JSON.stringify(p))).join('\n') : content;
      messages.push(`<div class="msg user"><div class="role role-user">User ${ts}</div>${escapeHtml(userContent)}</div>`);
    } else if (type === 'model' || type === 'assistant' || type === 'gemini') {
      let parts = [`<pre>${escapeHtml(content)}</pre>`];
      if (msg.thoughts && Array.isArray(msg.thoughts)) {
        const thoughtText = msg.thoughts.map(t =>
          typeof t === 'string' ? t : `[${t.subject || ''}] ${t.description || ''}`
        ).join('\n');
        parts.unshift(`<details class="msg meta-msg"><summary class="role role-meta">Thinking (${msg.thoughts.length} items)</summary><pre>${escapeHtml(thoughtText.slice(0, 3000))}</pre></details>`);
      } else if (msg.thoughts) {
        parts.unshift(`<details class="msg meta-msg"><summary class="role role-meta">Thinking</summary><pre>${escapeHtml(String(msg.thoughts).slice(0, 3000))}</pre></details>`);
      }
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        for (const tc of msg.toolCalls) {
          const tcArgs = JSON.stringify(tc.args || {}, null, 2);
          const tcResult = tc.result ? JSON.stringify(tc.result, null, 2) : '';
          const tcStatus = tc.status ? ` [${tc.status}]` : '';
          parts.push(`<details class="msg tool-use"><summary class="role role-tool">Tool: ${escapeHtml(tc.name || 'unknown')}${escapeHtml(tcStatus)}</summary><pre>Args: ${escapeHtml(tcArgs.slice(0, 1000))}</pre>${tcResult ? `<pre>Result: ${escapeHtml(tcResult.slice(0, 3000))}</pre>` : ''}</details>`);
        }
      }
      if (msg.tokens) {
        const t = msg.tokens;
        parts.push(`<div class="meta-msg" style="font-size:0.7em;color:#484f58">Tokens: in=${t.input||'?'} out=${t.output||'?'} cached=${t.cached||0} | Model: ${msg.model || 'unknown'}</div>`);
      }
      messages.push(`<div class="msg assistant"><div class="role role-assistant">Gemini ${ts}</div>${parts.join('\n')}</div>`);
    } else if (type === 'info' || type === 'system') {
      messages.push(`<details class="msg system"><summary class="role role-system">${escapeHtml(type)} ${ts}</summary><pre>${escapeHtml(String(content).slice(0, 2000))}</pre></details>`);
    } else if (type === 'error') {
      messages.push(`<div class="msg system" style="border-left-color:#f85149"><div class="role" style="color:#f85149">Error ${ts}</div><pre>${escapeHtml(String(content).slice(0, 2000))}</pre></div>`);
    } else if (type === 'warning') {
      messages.push(`<div class="msg system" style="border-left-color:#d29922"><div class="role" style="color:#d29922">Warning ${ts}</div><pre>${escapeHtml(String(content).slice(0, 2000))}</pre></div>`);
    } else {
      messages.push(`<details class="msg meta-msg"><summary class="role role-meta">${escapeHtml(type)} ${ts}</summary><pre>${escapeHtml(String(content).slice(0, 2000))}</pre></details>`);
    }
  }

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Gemini session — ${escapeHtml(sessionId)}</title><style>${CSS}</style></head><body>
<h1>Gemini CLI Session</h1>
<div class="meta">Session: ${escapeHtml(sessionId)}<br>Start: ${data.startTime || ''}<br>Exported: ${new Date().toISOString()}<br>Messages: ${(data.messages || []).length}</div>
${messages.join('\n')}
</body></html>`;
}

// ── Codex JSONL → HTML ───────────────────────────────────────────────────

function exportCodex(sessionFile) {
  const lines = readFileSync(sessionFile, 'utf8').trim().split('\n');
  const messages = [];
  const sessionId = basename(sessionFile, '.jsonl').replace('rollout-', '');
  let stats = { user: 0, assistant: 0, tools: 0, system: 0 };

  for (const line of lines) {
    let d;
    try { d = JSON.parse(line); } catch { continue; }

    const type = d.type;
    const payload = d.payload || d;
    const ts = d.timestamp ? `<span class="ts">${new Date(d.timestamp).toLocaleTimeString()}</span>` : '';

    if (type === 'session_meta') {
      const p = payload;
      messages.push(`<div class="msg system"><div class="role role-system">Session Meta ${ts}</div><pre>CWD: ${escapeHtml(p.cwd || '')}\nModel: ${escapeHtml(p.model || '')}\nCLI: ${escapeHtml(p.cli_version || '')}</pre></div>`);
      stats.system++;
    }
    else if (type === 'response_item') {
      const p = payload;
      if (p.role === 'user') {
        stats.user++;
        const content = (p.content || []).map(c => c.text || `[${c.type}]`).join('\n');
        if (content.length < 5000) {
          messages.push(`<div class="msg user"><div class="role role-user">User ${ts}</div>${escapeHtml(content)}</div>`);
        } else {
          messages.push(`<details class="msg user"><summary class="role role-user">User (${content.length} chars) ${ts}</summary><pre>${escapeHtml(content.slice(0, 5000))}</pre></details>`);
        }
      }
      else if (p.role === 'assistant') {
        stats.assistant++;
        const content = (p.content || []).map(c => c.text || `[${c.type}]`).join('\n');
        messages.push(`<div class="msg assistant"><div class="role role-assistant">Codex ${ts}</div><pre>${escapeHtml(content)}</pre></div>`);
      }
      else if (p.role === 'developer') {
        stats.system++;
        const content = (p.content || []).map(c => c.text || `[${c.type}]`).join('\n');
        messages.push(`<details class="msg system"><summary class="role role-system">Developer Instructions (${content.length} chars) ${ts}</summary><pre>${escapeHtml(content.slice(0, 3000))}</pre></details>`);
      }
      else if (p.type === 'function_call') {
        stats.tools++;
        messages.push(`<details class="msg tool-use"><summary class="role role-tool">Tool: ${escapeHtml(p.name || '')} ${ts}</summary><pre>${escapeHtml(String(p.arguments || '').slice(0, 3000))}</pre></details>`);
      }
      else if (p.type === 'function_call_output') {
        messages.push(`<details class="msg tool-result"><summary class="role role-tool">Tool Result ${ts}</summary><pre>${escapeHtml(String(p.output || '').slice(0, 5000))}</pre></details>`);
      }
      else if (p.type === 'reasoning') {
        const summary = (p.summary || []).map(s => s.text || JSON.stringify(s)).join('\n');
        messages.push(`<details class="msg meta-msg"><summary class="role role-meta">Reasoning ${ts}</summary><pre>${escapeHtml(summary.slice(0, 2000))}</pre></details>`);
      }
      else if (p.type === 'custom_tool_call') {
        stats.tools++;
        messages.push(`<details class="msg tool-use"><summary class="role role-tool">apply_patch [${escapeHtml(p.status || '')}] ${ts}</summary><pre>${escapeHtml(String(p.input || '').slice(0, 5000))}</pre></details>`);
      }
      else if (p.type === 'custom_tool_call_output') {
        messages.push(`<details class="msg tool-result"><summary class="role role-tool">apply_patch result ${ts}</summary><pre>${escapeHtml(String(p.output || '').slice(0, 3000))}</pre></details>`);
      }
      else if (p.type === 'web_search_call') {
        stats.tools++;
        const q = p.action?.query || p.action?.queries?.join(', ') || '';
        messages.push(`<div class="msg tool-use"><div class="role role-tool">Web Search: ${escapeHtml(q)} ${ts}</div></div>`);
      }
      else if (p.type === 'compaction' || p.type === 'context_compaction') {
        messages.push(`<div class="msg system"><div class="role role-system">Context Compacted ${ts}</div></div>`);
      }
    }
    else if (type === 'compacted') {
      stats.system++;
      messages.push(`<div class="msg system"><div class="role role-system">Context Compacted ${ts}</div>History replaced with ${(payload.replacement_history || []).length} condensed items</div>`);
    }
    else if (type === 'event_msg') {
      const p = payload;
      if (p.type === 'agent_message') {
        stats.assistant++;
        messages.push(`<div class="msg assistant"><div class="role role-assistant">Codex (${escapeHtml(p.phase || '')}) ${ts}</div><pre>${escapeHtml(p.message || '')}</pre></div>`);
      }
      else if (p.type === 'agent_reasoning' || p.type === 'agent_reasoning_raw_content') {
        messages.push(`<details class="msg meta-msg"><summary class="role role-meta">Reasoning ${ts}</summary><pre>${escapeHtml(String(p.text || '').slice(0, 2000))}</pre></details>`);
      }
      else if (p.type === 'exec_command_end') {
        stats.tools++;
        const cmd = Array.isArray(p.command) ? p.command.join(' ') : (p.parsed_cmd || '');
        const output = p.aggregated_output || p.stdout || '';
        messages.push(`<details class="msg tool-result"><summary class="role role-tool">exec: ${escapeHtml(cmd.slice(0, 100))} [exit ${p.exit_code}] ${ts}</summary><pre>${escapeHtml(String(output).slice(0, 5000))}</pre>${p.stderr ? `<pre style="color:#f85149">${escapeHtml(String(p.stderr).slice(0, 2000))}</pre>` : ''}</details>`);
      }
      else if (p.type === 'patch_apply_end') {
        stats.tools++;
        const changes = p.changes ? Object.entries(p.changes) : [];
        const diffText = changes.map(([path, c]) => `${c.type}: ${path}${c.unified_diff ? '\n' + c.unified_diff : ''}`).join('\n\n');
        messages.push(`<details class="msg tool-use"><summary class="role role-tool">Patch [${escapeHtml(p.status || '')}] — ${changes.length} file(s) ${ts}</summary><pre>${escapeHtml(diffText.slice(0, 5000))}</pre></details>`);
      }
      else if (p.type === 'mcp_tool_call_end') {
        stats.tools++;
        const inv = p.invocation || {};
        messages.push(`<details class="msg tool-result"><summary class="role role-tool">MCP: ${escapeHtml(inv.server || '')}/${escapeHtml(inv.tool || '')} ${ts}</summary><pre>${escapeHtml(JSON.stringify(p.result || {}, null, 2).slice(0, 3000))}</pre></details>`);
      }
      else if (p.type === 'turn_aborted') {
        messages.push(`<div class="msg system" style="border-left-color:#f85149"><div class="role" style="color:#f85149">Turn Aborted: ${escapeHtml(p.reason || '')} ${ts}</div></div>`);
      }
      else if (p.type === 'error') {
        stats.system++;
        messages.push(`<div class="msg system" style="border-left-color:#f85149"><div class="role" style="color:#f85149">Error ${ts}</div><pre>${escapeHtml(String(p.message || '').slice(0, 2000))}</pre></div>`);
      }
      else if (p.type === 'user_message') {
        // Already captured via response_item
      }
      else if (p.type === 'token_count') {
        const info = p.info;
        if (info?.total_token_usage) {
          const u = info.total_token_usage;
          messages.push(`<div class="msg meta-msg" style="font-size:0.7em"><div class="role role-meta">Tokens ${ts}</div>Input: ${u.input_tokens||0} | Output: ${u.output_tokens||0} | Cached: ${u.cached_input_tokens||0} | Reasoning: ${u.reasoning_output_tokens||0}</div>`);
        }
      }
      else if (p.type === 'task_started' || p.type === 'task_complete') {
        messages.push(`<div class="msg task"><div class="role role-task">${escapeHtml(p.type)} ${ts}</div></div>`);
      }
      else if (p.type === 'context_compacted') {
        messages.push(`<div class="msg system"><div class="role role-system">Context Compacted ${ts}</div></div>`);
      }
      else if (p.type === 'thread_name_updated') {
        messages.push(`<div class="msg meta-msg"><div class="role role-meta">Session renamed: ${escapeHtml(p.thread_name || '')} ${ts}</div></div>`);
      }
    }
  }

  const statsHtml = `<div class="stats">Messages: ${stats.user} user, ${stats.assistant} assistant, ${stats.tools} tools, ${stats.system} system — ${lines.length} JSONL lines</div>`;

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Codex session — ${escapeHtml(sessionId)}</title><style>${CSS}</style></head><body>
<h1>Codex CLI Session</h1>
<div class="meta">Session: ${escapeHtml(sessionId)}<br>Exported: ${new Date().toISOString()}<br>Lines: ${lines.length}</div>
${statsHtml}
${messages.join('\n')}
</body></html>`;
}

// ── Pi: delegate to native --export ──────────────────────────────────────

function exportPi(sessionFile, outputPath) {
  try {
    execSync(`pi --export "${sessionFile}" "${outputPath}"`, { stdio: 'pipe', timeout: 30000 });
    return null;
  } catch {
    return exportCodex(sessionFile); // fallback: generic JSONL parser
  }
}

// ── Main ─────────────────────────────────────────────────────────────────

function detectTool() {
  if (process.env.AI_TOOL) return process.env.AI_TOOL;
  if (process.env.CLAUDECODE !== undefined) return 'claude';
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) return 'gemini';
  if (process.env.CODEX_HOME) return 'codex';
  return 'claude';
}

function exportSession(tool, sessionFile) {
  // Append-mode: use session ID as filename (overwrites same session, not new file per Stop)
  const sessionName = basename(sessionFile, '.jsonl').replace('.json', '');
  const outputName = `${tool}-${sessionName}.html`;
  const outputPath = join(EXPORT_DIR, outputName);

  let html;
  if (tool === 'pi') {
    html = exportPi(sessionFile, outputPath);
    if (html === null) {
      log(`  ✓ ${tool}: ${outputPath} (via pi --export)`);
      return outputPath;
    }
  } else if (tool === 'claude') {
    html = exportClaude(sessionFile);
  } else if (tool === 'gemini') {
    html = exportGemini(sessionFile);
  } else if (tool === 'codex') {
    html = exportCodex(sessionFile);
  } else {
    log(`  ✗ Unknown tool: ${tool}`);
    return null;
  }

  writeFileSync(outputPath, html, 'utf8');
  log(`  ✓ ${tool}: ${outputPath} (${(html.length / 1024).toFixed(0)}KB)`);
  return outputPath;
}

if (fileArg) {
  const tool = toolArg || detectTool();
  exportSession(tool, fileArg);
} else {
  const tools = toolArg ? [toolArg] : ['claude', 'gemini', 'codex', 'pi'];
  log('Session Export\n');
  for (const tool of tools) {
    const latest = findLatestSession(tool);
    if (!latest) {
      log(`  - ${tool}: no sessions found`);
      continue;
    }
    exportSession(tool, latest);
  }
}
