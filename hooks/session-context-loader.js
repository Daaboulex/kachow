#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// SessionStart hook: Auto-display AI-tasks + AI-progress + git status summary.
// Replaces LLM spending turns reading these files manually at session start.
// Outputs a systemMessage with the key state so the LLM has it immediately.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

try {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = '{}'; }
  const input = JSON.parse(raw);
  const cwd = input.cwd || process.cwd();

  // R-CTX idempotency guard: skip 2nd+ fire for same session_id (prevents
  // /resume + subagent-spawn re-injection. Marker in os.tmpdir() so survives
  // across hook processes within session but auto-clears on reboot.
  if (input.session_id) {
    const markerDir = path.join(os.tmpdir(), 'claude-session-ctx');
    const marker = path.join(markerDir, `${String(input.session_id).replace(/[^a-zA-Z0-9_-]/g, '_')}.flag`);
    try { fs.mkdirSync(markerDir, { recursive: true }); } catch {}
    if (fs.existsSync(marker)) {
      process.stdout.write('{"continue":true}');
      process.exit(0);
    }
    try { fs.writeFileSync(marker, String(Date.now())); } catch {}
    // Cleanup markers >24h old (best-effort, cap 50 to avoid pathological dirs)
    try {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      const entries = fs.readdirSync(markerDir).slice(0, 50);
      for (const f of entries) {
        const fp = path.join(markerDir, f);
        try { if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp); } catch {}
      }
    } catch {}
  }

  const parts = [];

  // Project identity (local-private vs github-ok) — announced up front so agent knows constraints
  try {
    const { detect } = require('./lib/project-identity.js');
    const identity = detect(cwd);
    if (identity) {
      const rules = [];
      if (identity.forbidCommands?.length) rules.push(`forbidden commands: ${identity.forbidCommands.join(', ')}`);
      if (identity.forbidRemoteHosts?.length) rules.push(`forbidden hosts: ${identity.forbidRemoteHosts.join(', ')}`);
      if (identity.allowedGitRemotes?.length) rules.push(`git push allowed only to: ${identity.allowedGitRemotes.join(', ')}`);
      parts.push(`Project identity: ${identity.statusBadge || identity.identity} (${identity.type})${rules.length ? ' — ' + rules.join('; ') : ''}`);
    }
  } catch {}

  // Behavioral rules summary (Layer C) — inject ALL feedback-type memory rule names.
  // Ensures every behavioral rule is visible every session regardless of FULL_N.
  try {
    const memDirs = [
      path.join(os.homedir(), '.ai-context', 'memory'),
      path.join(cwd, '.ai-context', 'memory'),
      path.join(cwd, '.claude', 'memory'),
    ];
    const sanitized = cwd.replace(/^\//, '').replace(/[/\\]/g, '-').replace(/^([A-Z]):/i, '$1');
    const globalMemDir = path.join(os.homedir(), '.claude', 'projects', sanitized, 'memory');
    memDirs.push(globalMemDir);

    for (const memDir of memDirs) {
      if (!fs.existsSync(memDir)) continue;
      const ruleNames = [];
      try {
        for (const f of fs.readdirSync(memDir)) {
          if (!f.startsWith('feedback_') || !f.endsWith('.md')) continue;
          const fp = path.join(memDir, f);
          try {
            const head = fs.readFileSync(fp, 'utf8').split('\n').slice(0, 8).join('\n');
            const nameMatch = head.match(/^name:\s*(.+)/im);
            if (nameMatch) {
              ruleNames.push(nameMatch[1].trim().slice(0, 40));
            }
          } catch {}
        }
      } catch {}
      if (ruleNames.length > 0) {
        parts.push(`Rules (${ruleNames.length}): ${ruleNames.join(' · ')}`);
        break;
      }
    }
  } catch {}

  // Self-improvement queue banner — fit into the AI "check if they can improve themselves" vision
  try {
    const queue = require('./lib/self-improvement/queue.js');
    const s = queue.summary();
    if (s.total > 0) {
      const tiers = [];
      if (s.BLOCKER) tiers.push(`${s.BLOCKER} BLOCKER`);
      if (s.SUGGEST) tiers.push(`${s.SUGGEST} SUGGEST`);
      if (s.OBSERVE) tiers.push(`${s.OBSERVE} OBSERVE`);
      parts.push(`⚙ System: ${tiers.join(', ')} pending self-improvement${s.total > 1 ? 's' : ''} — run /review-improvements`);
    }
  } catch {}

  // Check AI-tasks.json (search both .claude/ and .gemini/ for cross-platform)
  for (const tasksPath of [
    path.join(cwd, '.claude', 'AI-tasks.json'),
    path.join(cwd, '.gemini', 'AI-tasks.json'),
    path.join(cwd, 'AI-tasks.json'),
    path.join(cwd, '.ai-context', 'AI-tasks.json'),
  ]) {
    if (fs.existsSync(tasksPath)) {
      try {
        const tasks = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
        const active = (tasks.tasks || []).filter(t => t.status !== 'done');
        if (active.length > 0) {
          parts.push(`Active tasks (${active.length}): ${active.map(t => t.title || t.description || '?').join(', ')}`);
        }
      } catch {}
      break;
    }
  }

  // Check AI-progress.json (search both .claude/ and .gemini/ for cross-platform)
  for (const progPath of [
    path.join(cwd, '.claude', 'AI-progress.json'),
    path.join(cwd, '.gemini', 'AI-progress.json'),
    path.join(cwd, 'AI-progress.json'),
    path.join(cwd, '.ai-context', 'AI-progress.json'),
  ]) {
    if (fs.existsSync(progPath)) {
      try {
        const prog = JSON.parse(fs.readFileSync(progPath, 'utf8'));
        const sessions = prog.sessions || [];
        if (sessions.length > 0) {
          const last = sessions[sessions.length - 1];
          parts.push(`Last session (${last.agent || '?'}, ${last.timestamp || '?'}): ${last.summary || 'no summary'}`);
        }
        if (prog.inFlight && prog.inFlight.status) {
          parts.push(`In-flight: ${prog.inFlight.description || '?'} [${prog.inFlight.status}]`);
        }
      } catch {}
      break;
    }
  }

  // Handoff retention (updated 2026-04-16): prune BOTH per-session variants AND
  // stale unsuffixed pointers. Pointer gets archived if >14d old — fixes the
  // "stale handoff never cleared" bug where pointer files 9-16d old kept showing
  // up in session-context banners forever.
  //
  // (Prior bug: explicit "NEVER touch the unsuffixed pointer" rule caused nix
  // pointer to go 9d stale, linux-corecycler 16d stale. Users had to manually
  // clean. Fixed in Wave 2.1 of unified-tracking migration.)
  try {
    const retentionDirs = [cwd, path.join(cwd, '.ai-context'), path.join(cwd, '.claude')];
    const versionedAgeCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const pointerAgeCutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const KEEP_LAST = 3;
    const ARCHIVE_MAX = 20;

    for (const d of retentionDirs) {
      if (!fs.existsSync(d)) continue;
      const archiveDir = path.join(d, 'handoff-archive');

      // ── (A) Versioned variants: keep 3 newest, archive rest if >7d ──
      let versioned = [];
      try {
        for (const f of fs.readdirSync(d)) {
          if (!f.startsWith('.session-handoff-') || !f.endsWith('.md')) continue;
          const fp = path.join(d, f);
          try { versioned.push({ path: fp, name: f, mtime: fs.statSync(fp).mtimeMs }); } catch {}
        }
      } catch { continue; }
      versioned.sort((a, b) => b.mtime - a.mtime);
      if (versioned.length > KEEP_LAST) {
        const stale = versioned.slice(KEEP_LAST).filter(e => e.mtime < versionedAgeCutoff);
        if (stale.length > 0) {
          try { fs.mkdirSync(archiveDir, { recursive: true }); } catch {}
          for (const s of stale) {
            try { fs.renameSync(s.path, path.join(archiveDir, s.name)); } catch {}
          }
        }
      }

      // ── (B) Unsuffixed pointer: archive if >14d stale ──
      // The .session-handoff.md pointer represents the always-latest handoff.
      // If >14d with no refresh, it's stale — work was abandoned or superseded.
      const pointerPath = path.join(d, '.session-handoff.md');
      if (fs.existsSync(pointerPath)) {
        try {
          const pmtime = fs.statSync(pointerPath).mtimeMs;
          if (pmtime < pointerAgeCutoff) {
            try { fs.mkdirSync(archiveDir, { recursive: true }); } catch {}
            const ts = new Date(pmtime).toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const archiveName = `.session-handoff-stale-pointer-${ts}.md`;
            fs.renameSync(pointerPath, path.join(archiveDir, archiveName));
          }
        } catch {}
      }

      // ── (C) Archive size cap: keep newest 20, remove older ──
      if (fs.existsSync(archiveDir)) {
        try {
          const archived = fs.readdirSync(archiveDir)
            .filter(f => f.startsWith('.session-handoff') && f.endsWith('.md'))
            .map(f => ({ path: path.join(archiveDir, f), mtime: fs.statSync(path.join(archiveDir, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);
          for (const old of archived.slice(ARCHIVE_MAX)) {
            try { fs.unlinkSync(old.path); } catch {}
          }
        } catch {}
      }
    }
  } catch {}

  // Concurrent-session handoff support: scan ALL .session-handoff-*.md files in known
  // locations + the unsuffixed pointer. Show top 2 most recent (last 24h) so multiple
  // parallel /wrap-up sessions don't lose info. Per-session-id filenames prevent collision.
  try {
    const handoffDirs = [cwd, path.join(cwd, '.ai-context'), path.join(cwd, '.claude'), path.join(require('os').homedir(), '.claude')];
    const allHandoffs = [];
    const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;
    for (const d of handoffDirs) {
      if (!fs.existsSync(d)) continue;
      try {
        for (const f of fs.readdirSync(d)) {
          // Match .session-handoff.md, .session-handoff-<anything>.md
          if (!f.startsWith('.session-handoff') || !f.endsWith('.md')) continue;
          const fp = path.join(d, f);
          const st = fs.statSync(fp);
          if (st.mtimeMs < cutoff24h) continue;
          allHandoffs.push({ path: fp, name: f, mtime: st.mtimeMs });
        }
      } catch {}
    }
    allHandoffs.sort((a, b) => b.mtime - a.mtime);
    // Dedup by content fingerprint (first 200 chars) so timestamped + unsuffixed copies count once
    const seen = new Set();
    const unique = [];
    for (const h of allHandoffs) {
      try {
        const content = fs.readFileSync(h.path, 'utf8').slice(0, 200);
        if (seen.has(content)) continue;
        seen.add(content);
        unique.push(h);
      } catch {}
    }
    if (unique.length > 1) {
      parts.push(`⚡ ${unique.length} HANDOFFs in last 24h (concurrent sessions): ${unique.slice(0, 3).map(h => `${path.basename(h.path)} (${new Date(h.mtime).toISOString().slice(11, 16)})`).join(' • ')}. READ ALL via Glob '.session-handoff*.md'.`);
    }

    // Older-handoffs visibility (added 2026-04-17): count handoff-archive/ entries
    // so AI knows historical context exists without listing every file.
    try {
      const archiveDirs = [
        path.join(cwd, '.claude', 'handoff-archive'),
        path.join(cwd, '.ai-context', 'handoff-archive'),
      ];
      let archivedCount = 0;
      for (const ad of archiveDirs) {
        if (!fs.existsSync(ad)) continue;
        try { archivedCount += fs.readdirSync(ad).filter(f => f.endsWith('.md')).length; } catch {}
      }
      if (archivedCount > 0) {
        parts.push(`${archivedCount} older handoff(s) in handoff-archive/ — read if you need pre-${new Date(Date.now() - 7 * 86400 * 1000).toISOString().slice(0, 10)} context.`);
      }
    } catch {}
  } catch {}

  // === NEW: Project-index-based handoff discovery (Phase 3) ===
  // Reads from ~/.ai-context/handoffs/projects/<key>.json. Falls back to old
  // filesystem scan if index doesn't exist yet (parallel operation period).
  let handoffFound = false;
  try {
    const { deriveProjectKeyCached } = require('./lib/project-key.js');
    const { latestSessions } = require('./lib/project-index.js');
    const { HANDOFFS_ROOT } = require('./lib/handoff-state.js');
    const proj = deriveProjectKeyCached(cwd);
    const recent = latestSessions(proj.key, 3);
    if (recent.length > 0) {
      const latest = recent[recent.length - 1];
      const age = Math.floor((Date.now() - new Date(latest.ended_at || latest.at).getTime()) / 3600000);
      if (latest.has_prose) {
        const prosePath = path.join(HANDOFFS_ROOT, 'sessions', latest.session_id + '.md');
        parts.push(`⚡ HANDOFF from ${latest.tool} session (${age}h ago): ${latest.summary || 'no summary'}. Read ${prosePath}`);
      } else {
        parts.push(`⚡ Previous ${latest.tool} session (${age}h ago): ${latest.summary || 'no summary'}. ${latest.files_touched || 0} files changed.`);
      }
      if (recent.length > 1) {
        parts.push(`${recent.length} sessions touched this project recently.`);
      }
      handoffFound = true;
    }
  } catch {}
  // === END NEW — falls through to old scan if handoffFound is still false ===

  // Check for session handoff file (from /handoff or context-pressure save) — legacy read path
  if (!handoffFound) for (const handoffPath of [
    path.join(cwd, '.session-handoff.md'),
    path.join(cwd, '.ai-context', '.session-handoff.md'),
    path.join(cwd, '.claude', '.session-handoff.md'),
    path.join(require('os').homedir(), '.claude', '.session-handoff.md'),
  ]) {
    if (fs.existsSync(handoffPath)) {
      try {
        const content = fs.readFileSync(handoffPath, 'utf8');
        const handoffMtime = fs.statSync(handoffPath).mtimeMs;
        // Extract key sections for the summary
        const nextMatch = content.match(/## Next Session Should[^\n]*\n([\s\S]*?)(?=\n##|\n$)/);
        const learningsMatch = content.match(/## Session Learnings[^\n]*\n([\s\S]*?)(?=\n##|\n$)/);
        const testMatch = content.match(/## Needs Human Testing[^\n]*\n([\s\S]*?)(?=\n##|\n$)/);
        const inFlightMatch = content.match(/## In-Flight[^\n]*\n([\s\S]*?)(?=\n##|\n$)/);
        const summaryParts = [];
        if (nextMatch) summaryParts.push('Next: ' + nextMatch[1].trim().split('\n')[0]);
        if (testMatch && !testMatch[1].includes('None')) summaryParts.push('NEEDS TESTING');
        if (learningsMatch && !learningsMatch[1].includes('None')) summaryParts.push('Has unprocessed learnings');
        // Progress tracker: parse checkboxes + numbered pending items.
        // Surfaces a ⚠ badge when handoff has unchecked items, ✓ when complete.
        let progressBadge = null;
        try {
          const { parseHandoff, summaryBadge } = require('./lib/handoff-progress.js');
          const progress = parseHandoff(content);
          progressBadge = summaryBadge(progress);
        } catch {}

        if (summaryParts.length > 0 || progressBadge) {
          // If handoff is newer than AI-progress.json, remove stale in-flight from parts
          // (handoff has the real current state)
          const idx = parts.findIndex(p => p.startsWith('In-flight:'));
          if (idx !== -1) {
            // Replace stale AI-progress in-flight with handoff in-flight
            if (inFlightMatch) {
              parts[idx] = 'In-flight (from handoff): ' + inFlightMatch[1].trim().split('\n')[0];
            }
          }
          const badgePart = progressBadge ? ` ${progressBadge}` : '';
          parts.push(`⚡ HANDOFF from previous session${badgePart}: ${summaryParts.join(' | ')} — Read ${handoffPath} for full context`);
          handoffFound = true;
        }
      } catch {}
      break;
    }
  }

  // Memory summaries (inject relevant memories so agent has context immediately)
  try {
    const memoryPaths = [];
    // Walk up from cwd looking for repo-root MEMORY.md (works from any subdir)
    let walkDir = cwd;
    const root = path.parse(walkDir).root;
    while (walkDir && walkDir !== root) {
      memoryPaths.push(path.join(walkDir, '.ai-context', 'memory', 'MEMORY.md'));
      memoryPaths.push(path.join(walkDir, '.claude', 'memory', 'MEMORY.md'));
      const parent = path.dirname(walkDir);
      if (parent === walkDir) break;
      walkDir = parent;
    }
    // Also check global project memory (fallback for projects without local memory dir)
    const sanitized = cwd.replace(/^\//, '').replace(/[/\\]/g, '-').replace(/^([A-Z]):/i, '$1');
    const globalMemPath = path.join(require('os').homedir(), '.claude', 'projects', sanitized, 'memory', 'MEMORY.md');
    memoryPaths.push(globalMemPath);

    for (const memPath of memoryPaths) {
      if (fs.existsSync(memPath)) {
        try {
          const content = fs.readFileSync(memPath, 'utf8');
          // Extract memory entries (lines starting with "- [")
          let allEntries = content.split('\n')
            .filter(l => l.trim().startsWith('- ['))
            .map(l => l.trim().replace(/^- /, ''));

          // ── Temporal-frontmatter filter (v3 Phase A) ──
          // Drop memories marked `superseded_by:` or past `valid_until:` from top-5 pool.
          // They stay in MEMORY.md (audit trail) but are not injected as live context.
          // Reads frontmatter only (first 15 lines) for speed.
          try {
            const memDir = path.dirname(memPath);
            const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
            const suppressed = new Set();
            for (const e of allEntries) {
              const m = e.match(/\(([^)]+\.md)\)/);
              if (!m) continue;
              const fname = m[1];
              const fp = path.join(memDir, fname);
              if (!fs.existsSync(fp)) continue;
              try {
                const head = fs.readFileSync(fp, 'utf8').split('\n').slice(0, 15).join('\n');
                const supMatch = head.match(/^superseded_by:\s*(\S+)/im);
                const untilMatch = head.match(/^valid_until:\s*(\d{4}-\d{2}-\d{2})/im);
                if (supMatch) { suppressed.add(e); continue; }
                if (untilMatch && untilMatch[1] < today) { suppressed.add(e); }
              } catch {}
            }
            if (suppressed.size > 0) {
              allEntries = allEntries.filter(e => !suppressed.has(e));
            }
          } catch {}

          // Cwd-relevance ranking: token-set intersection between cwd path and memory entry text.
          // Tokens: lowercase alphanumeric chunks ≥3 chars, minus stoplist.
          // Score = |cwdTokens ∩ entryTokens|. Tie-broken alphabetically.
          const STOP = new Set([
            'users','desktop','documents','home','sdaaboul','src','dev','app','main','file',
            'the','and','for','with','from','this','that','use','one','two','dir','cwd',
            'lib','bin','obj','build','dist','node','modules','git','claude','gemini','code',
            'md','json','yaml','yml','txt'
          ]);
          const tokenize = s => new Set(
            (s || '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 3 && !STOP.has(t))
          );
          const cwdTokens = tokenize(cwd);
          // Type-priority boost: behavioral rules (feedback) always outrank project notes.
          // Reads frontmatter type: field from each memory file (first 10 lines).
          const TYPE_BOOST = { feedback: 5, reference: 2, user: 3, project: 0 };
          // observation_level boost: inductive knowledge (derived from patterns) > deductive > explicit.
          const OBS_LEVEL_BOOST = { inductive: 3, deductive: 1, explicit: 0 };
          const getTypeInfo = (entry) => {
            try {
              const m = entry.match(/\(([^)]+\.md)\)/);
              if (!m) return { boost: 0, memType: 'unknown' };
              const fp = path.join(path.dirname(memPath), m[1]);
              if (!fs.existsSync(fp)) return { boost: 0, memType: 'unknown' };
              const head = fs.readFileSync(fp, 'utf8').split('\n').slice(0, 10).join('\n');
              const typeMatch = head.match(/^type:\s*(\w+)/im);
              const memType = typeMatch ? typeMatch[1] : 'unknown';
              const typeBoost = TYPE_BOOST[memType] || 0;
              const obsMatch = head.match(/^observation_level:\s*(\w+)/im);
              const obsBoost = obsMatch ? (OBS_LEVEL_BOOST[obsMatch[1]] || 0) : 0;
              return { boost: typeBoost + obsBoost, memType };
            } catch { return { boost: 0, memType: 'unknown' }; }
          };
          const scored = allEntries.map(e => {
            const eTokens = tokenize(e);
            let score = 0;
            for (const t of cwdTokens) if (eTokens.has(t)) score++;
            const info = getTypeInfo(e);
            score += info.boost;
            return { entry: e, score, memType: info.memType };
          });
          scored.sort((a, b) => (b.score - a.score) || a.entry.localeCompare(b.entry));

          // ── Awareness-first model (Rule M-AWARE) ──
          // NEVER drop content silently. AI must know:
          //   1. Total memory inventory (counts per category)
          //   2. Top cwd-relevant titles (titles only, not full descriptions)
          //   3. How to query for more (commands, paths)
          // Full descriptions: only for top 5 most-relevant. Rest: title-only awareness.
          // AI can pull full content via `/memory <q>` or `Read <path>`.

          const totalCount = scored.length;
          const relevantCount = scored.filter(s => s.score > 0).length;

          // R-CTX: configurable counts (default 3 full + 10 titles, was 5+15).
          // Restore old behavior with: MEMORY_INJECTION_FULL_COUNT=5 MEMORY_INJECTION_TITLE_COUNT=15
          const FULL_N = parseInt(process.env.MEMORY_INJECTION_FULL_COUNT, 10) || 3;
          const TITLE_N = parseInt(process.env.MEMORY_INJECTION_TITLE_COUNT, 10) || 10;
          // 40/60 budget ratio: 40% of FULL_N slots go to synthesized memories (feedback/user),
          // 60% to recent/explicit memories (project/reference). Override: MEMORY_SUMMARY_RATIO=0.5
          const SUMMARY_RATIO = parseFloat(process.env.MEMORY_SUMMARY_RATIO) || 0.40;

          // Section 1: top N with full description — split by synthesized vs recent
          // 40/60 budget: allocate 40% of FULL_N slots to synthesized (feedback/user),
          // 60% to recent (project/reference). Ensures synthesized knowledge isn't crowded out.
          const synthSlots = Math.min(Math.max(1, Math.round(FULL_N * SUMMARY_RATIO)), FULL_N - 1 || 1);
          const recentSlots = FULL_N - synthSlots;
          const synthEntries = scored.filter(s => s.memType === 'feedback' || s.memType === 'user');
          const recentEntries = scored.filter(s => s.memType !== 'feedback' && s.memType !== 'user');
          const topFull = [
            ...synthEntries.slice(0, synthSlots).map(s => s.entry),
            ...recentEntries.slice(0, recentSlots).map(s => s.entry),
          ];

          // Section 2: titles-only for next N cwd-relevant
          const titleOnly = (e) => {
            const m = e.match(/^\[([^\]]+)\]\(([^)]+)\)/);
            return m ? `${m[1]} (${m[2]})` : e.split(' — ')[0];
          };
          const topFullSet = new Set(topFull);
          const nextTitles = scored
            .filter(s => !topFullSet.has(s.entry))
            .slice(0, TITLE_N)
            .map(s => titleOnly(s.entry));

          // Section 3: total inventory awareness (so AI knows what else exists)
          // Categorize by file prefix convention (feedback_/project_/standard_/reference_/etc.)
          const cats = {};
          for (const s of scored) {
            // Match the .md filename group specifically — earlier regex caught the
            // FIRST paren, which fails when titles contain parens like "(renamed
            // from foo)". Bug fixed 2026-04-29 — was producing categories like
            // "renamed from foo:1", "session start 27K tokens:1" etc.
            const m = s.entry.match(/\(([^()]+\.md)\)/);
            const fname = m ? m[1] : '';
            const prefix = fname.includes('_') ? fname.split('_')[0] : fname.split('-')[0].split('.')[0];
            cats[prefix] = (cats[prefix] || 0) + 1;
          }
          const catSummary = Object.entries(cats).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}:${v}`).join(', ');

          parts.push(
            `Memory awareness: ${totalCount} total entries (${catSummary})` +
            (relevantCount > 0 ? `, ${relevantCount} cwd-relevant` : '') +
            `. Run \`/memory <topic>\` to search, \`Read .claude/memory/<file>.md\` for full content.`
          );

          if (topFull.length > 0) {
            parts.push(`Memories — top ${topFull.length} (full): ${topFull.join(' | ')}`);
          }
          if (nextTitles.length > 0) {
            parts.push(`Memories — also available (titles): ${nextTitles.join(' • ')}`);
          }
        } catch {}
        break;
      }
    }
  } catch {}

  // Tier 3 semantic auto-load (Rule M4) — top 2 by mtime if recent (<14d)
  try {
    const semanticDirs = [
      path.join(cwd, '.ai-context', 'memory', 'semantic'),
      path.join(cwd, '.claude', 'memory', 'semantic'),
    ];
    let semDir = null;
    for (const d of semanticDirs) { if (fs.existsSync(d)) { semDir = d; break; } }
    if (semDir) {
      const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
      const files = fs.readdirSync(semDir)
        .filter(f => f.endsWith('.md'))
        .map(f => ({ name: f, mtime: fs.statSync(path.join(semDir, f)).mtimeMs }))
        .filter(f => f.mtime > cutoff)
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 2);
      if (files.length > 0) {
        const summaries = files.map(f => {
          // First non-blank, non-heading line of file
          try {
            const content = fs.readFileSync(path.join(semDir, f.name), 'utf8');
            const firstLine = content.split('\n')
              .find(l => l.trim() && !l.trim().startsWith('#') && !l.trim().startsWith('---'))
              || '(empty)';
            return `${f.name}: ${firstLine.trim().slice(0, 100)}`;
          } catch { return f.name; }
        });
        parts.push(`Tier 3 (${files.length} recent): ${summaries.join(' | ')}`);
      }
    }
  } catch {}

  // CE plugin artifact discovery (added 2026-04-16):
  // /ce:ideate writes docs/ideation/, /ce:brainstorm writes docs/requirements/,
  // /ce:plan writes docs/plans/, /ce:compound writes docs/solutions/.
  // Surface counts + most recent so agent knows artifacts exist and can read on demand.
  try {
    const ceDirs = {
      ideation: path.join(cwd, 'docs', 'ideation'),
      requirements: path.join(cwd, 'docs', 'requirements'),
      plans: path.join(cwd, 'docs', 'plans'),
      solutions: path.join(cwd, 'docs', 'solutions'),
    };
    const ceParts = [];
    for (const [type, dir] of Object.entries(ceDirs)) {
      if (!fs.existsSync(dir)) continue;
      try {
        // Recursive .md scan (solutions/ has best-practices/ subdir per CE convention)
        const collectMd = (d) => {
          let out = [];
          for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) out = out.concat(collectMd(p));
            else if (e.name.endsWith('.md')) {
              try { out.push({ path: p, name: e.name, mtime: fs.statSync(p).mtimeMs }); } catch {}
            }
          }
          return out;
        };
        const files = collectMd(dir).sort((a, b) => b.mtime - a.mtime);
        if (files.length === 0) continue;
        const newest = path.relative(cwd, files[0].path);
        ceParts.push(`${type}:${files.length} (latest: ${newest})`);
      } catch {}
    }
    if (ceParts.length > 0) {
      parts.push(`CE artifacts — ${ceParts.join(', ')}. Read on demand: \`docs/<type>/\`.`);
    }
  } catch {}

  // Repo-map pointer (v3 Phase E) — cwd-gated: only when [safety-project] firmware work visible
  // Don't inject full map (141KB). Inject pointer so model reads on demand.
  try {
    const repomapPath = path.join(cwd, '.ai-context', 'repomap.md');
    const dl2Dir = path.join(cwd, '[project-dir]');
    if (fs.existsSync(repomapPath) && fs.existsSync(dl2Dir)) {
      const st = fs.statSync(repomapPath);
      const sizeKb = Math.round(st.size / 1024);
      const ageHours = Math.round((Date.now() - st.mtimeMs) / (3600 * 1000));
      parts.push(`[safety-project] repo-map: .ai-context/repomap.md (${sizeKb}KB, age ${ageHours}h). Read when hunting a function/struct/enum by name — faster than grep+read.`);
    }
  } catch {}

  // Deferred work queue (added 2026-04-17): items user explicitly postponed.
  // Surfaces when trigger_after date passed or when cwd matches project.
  // File format: JSONL with {id, summary, trigger_after, trigger_cond, project, done}.
  try {
    const deferredFile = path.join(os.homedir(), '.claude', 'deferred-work.jsonl');
    if (fs.existsSync(deferredFile)) {
      const lines = fs.readFileSync(deferredFile, 'utf8').split('\n').filter(Boolean);
      const now = new Date();
      const cwdLower = cwd.toLowerCase();
      const relevant = [];
      for (const line of lines) {
        try {
          const item = JSON.parse(line);
          if (item.done) continue;
          // Surface if: (a) trigger date passed, OR (b) cwd matches project name
          let show = false;
          if (item.trigger_after) {
            if (new Date(item.trigger_after) <= now) show = true;
          } else if (item.project && cwdLower.includes(item.project.toLowerCase())) {
            show = true;
          }
          if (show) {
            const trig = item.trigger_after ? `(triggered ${item.trigger_after})` : `[${item.project}]`;
            relevant.push(`${item.id} ${trig}: ${item.summary.slice(0, 120)}`);
          }
        } catch {}
      }
      if (relevant.length > 0) {
        parts.push(`Deferred work (${relevant.length}): ${relevant.slice(0, 3).join(' || ')}${relevant.length > 3 ? ` (+${relevant.length - 3} more in ~/.claude/deferred-work.jsonl)` : ''}`);
      }
    }
  } catch {}

  // Superpowers artifacts (added 2026-04-17): specs + plans are cross-session state.
  // User keeps multiple in-flight — AI at t=0 has no idea. Show counts + newest 1-line summary.
  try {
    const spDirs = [
      path.join(cwd, '.superpowers'),
      path.join(cwd, '.ai-context', '.superpowers'),
      path.join(cwd, '.claude', '.superpowers'),
      path.join(os.homedir(), 'Documents', '.superpowers'),  // global fallback
    ];
    for (const spDir of spDirs) {
      if (!fs.existsSync(spDir)) continue;
      const spParts = [];
      for (const sub of ['specs', 'plans']) {
        const subDir = path.join(spDir, sub);
        if (!fs.existsSync(subDir)) continue;
        try {
          const files = fs.readdirSync(subDir)
            .filter(f => f.endsWith('.md'))
            .map(f => ({ f, mtime: fs.statSync(path.join(subDir, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);
          if (files.length > 0) {
            const newest = files[0].f.replace(/\.md$/, '');
            const ageDays = Math.round((Date.now() - files[0].mtime) / (86400 * 1000));
            spParts.push(`${sub}:${files.length} (newest: ${newest}, ${ageDays}d)`);
          }
        } catch {}
      }
      if (spParts.length > 0) {
        const relDir = path.relative(cwd, spDir) || spDir;
        parts.push(`Superpowers — ${spParts.join(', ')}. Read at ${relDir}/.`);
        break;  // Only use first matching dir
      }
    }
  } catch {}

  // GSD milestone status (added 2026-04-17): .planning/STATE.md has current milestone.
  // Surface one-liner so agent knows which milestone/phase is active.
  try {
    const stateFile = path.join(cwd, '.planning', 'STATE.md');
    if (fs.existsSync(stateFile)) {
      const content = fs.readFileSync(stateFile, 'utf8');
      const milestoneMatch = content.match(/(?:^|\n)#+\s*(?:Current|Active)[:\s]+(.+?)(?:\n|$)/i)
                          || content.match(/milestone[:\s]+([^\n]+)/i);
      const phaseMatch = content.match(/(?:^|\n)#+\s*Phase[:\s]+(.+?)(?:\n|$)/i)
                      || content.match(/current[_\s-]*phase[:\s]+([^\n]+)/i);
      const hints = [];
      if (milestoneMatch) hints.push(`milestone: ${milestoneMatch[1].trim().slice(0, 60)}`);
      if (phaseMatch) hints.push(`phase: ${phaseMatch[1].trim().slice(0, 60)}`);
      if (hints.length > 0) {
        parts.push(`GSD — ${hints.join(', ')}. Run /gsd:progress for details.`);
      }
    }
  } catch {}

  // Recent human commits (added 2026-04-17): show last 3 commits NOT from AI.
  // AI is blind to commits user made between sessions without this.
  try {
    const humanLog = execSync(
      'git log --no-merges --since="7 days ago" --pretty=format:"%h %an %s" -n 10 2>/dev/null',
      { cwd, timeout: 2000, encoding: 'utf8' }
    ).trim();
    if (humanLog) {
      const humanCommits = humanLog.split('\n')
        .filter(l => !/claude|gemini/i.test(l))  // filter AI authors
        .slice(0, 3);
      if (humanCommits.length > 0) {
        parts.push(`Recent human commits (7d): ${humanCommits.map(c => c.slice(0, 80)).join(' • ')}`);
      }
    }
  } catch {}

  // In-flight PR detection (added 2026-04-17): open PR on current branch.
  // Uses gh CLI if available + repo has github remote. Silent fail if no gh or no remote.
  try {
    // Fast check: does project-identity block gh? (local-private repos)
    const identityFile = path.join(cwd, '.claude', 'project-identity.json');
    let ghBlocked = false;
    try {
      const ident = JSON.parse(fs.readFileSync(identityFile, 'utf8'));
      if (Array.isArray(ident.forbidCommands) && ident.forbidCommands.some(c => c.includes('gh'))) ghBlocked = true;
    } catch {}
    if (!ghBlocked) {
      const prJson = execSync(
        'gh pr view --json number,title,state,isDraft,reviewDecision,mergeable 2>/dev/null',
        { cwd, timeout: 3000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }
      ).trim();
      if (prJson) {
        const pr = JSON.parse(prJson);
        const status = pr.isDraft ? 'DRAFT' : (pr.reviewDecision || pr.state);
        parts.push(`PR #${pr.number}: ${pr.title.slice(0, 60)} [${status}${pr.mergeable ? '' : ', conflicts'}]`);
      }
    }
  } catch {}

  // Cross-agent concurrent edit warning (added 2026-04-17): warn if peer agent active.
  // Checks active-sessions.jsonl for other agent heartbeat within last 5 min.
  try {
    const peerFile = path.join(os.homedir(), '.claude', 'cache', 'active-sessions-global.jsonl');
    if (fs.existsSync(peerFile)) {
      const lines = fs.readFileSync(peerFile, 'utf8').split('\n').filter(Boolean).slice(-50);
      const fiveMinAgo = Date.now() - 5 * 60 * 1000;
      const ourAgent = process.env.CLAUDE_AGENT || 'claude';
      const peers = new Set();
      for (const line of lines) {
        try {
          const evt = JSON.parse(line);
          const ts = new Date(evt.ts || evt.timestamp || 0).getTime();
          if (ts < fiveMinAgo) continue;
          if (evt.agent && evt.agent !== ourAgent) peers.add(evt.agent);
        } catch {}
      }
      if (peers.size > 0) {
        // Anti-skew rule 1: write to SIDE-CHANNEL, never to systemMessage.
        // PreToolUse hook (peer-conflict-check.js) reads this + surfaces via permission prompt.
        try {
          const peerDir = path.join(os.homedir(), '.ai-context', 'instances');
          fs.mkdirSync(peerDir, { recursive: true });
          fs.writeFileSync(path.join(peerDir, 'active-peers.json'), JSON.stringify({
            peers: [...peers],
            timestamp: new Date().toISOString(),
            session_id: input.session_id || 'unknown',
            cwd: cwd,
          }));
        } catch {}
      }
    }
  } catch {}

  // Skill awareness injection (jcode pattern: skills as memory entries)
  // Surface available skills so the model knows what tools exist without explicit /slash
  try {
    const commandsDir = path.join(os.homedir(), '.claude', 'commands');
    if (fs.existsSync(commandsDir)) {
      const skills = [];
      for (const f of fs.readdirSync(commandsDir)) {
        if (!f.endsWith('.md')) continue;
        const name = f.replace(/\.md$/, '');
        try {
          const content = fs.readFileSync(path.join(commandsDir, f), 'utf8');
          const descMatch = content.match(/description:\s*(.+)/i) || content.match(/^#\s*(.+)/m);
          const desc = descMatch ? descMatch[1].trim().slice(0, 80) : '';
          if (desc) skills.push(`/${name}: ${desc}`);
        } catch {}
      }
      if (skills.length > 0) {
        parts.push(`Custom skills (${skills.length}): ${skills.slice(0, 5).join(' | ')}${skills.length > 5 ? ` (+${skills.length - 5} more — /help for full list)` : ''}`);
      }
    }
  } catch {}

  // Stale memory warning (added 2026-04-17): if MEMORY.md hasn't been updated in 14+ days.
  try {
    for (const memDir of [path.join(cwd, '.claude', 'memory'), path.join(cwd, '.ai-context', 'memory')]) {
      const memIndex = path.join(memDir, 'MEMORY.md');
      if (!fs.existsSync(memIndex)) continue;
      const ageDays = Math.round((Date.now() - fs.statSync(memIndex).mtimeMs) / (86400 * 1000));
      if (ageDays >= 14) {
        parts.push(`⚠ MEMORY.md is ${ageDays}d stale — run /consolidate-memory to refresh`);
      }
      break;
    }
  } catch {}

  // Unread notifications (added 2026-04-17): fallback for SSH/headless sessions.
  // notify-send hook fails silently on headless; this surfaces queued notifications.
  try {
    const notifFile = path.join(os.homedir(), '.claude', '.notifications.jsonl');
    if (fs.existsSync(notifFile)) {
      const lines = fs.readFileSync(notifFile, 'utf8').split('\n').filter(Boolean);
      if (lines.length > 0) {
        const titles = lines.slice(-3).map(l => {
          try { return JSON.parse(l).title?.slice(0, 50) || ''; } catch { return ''; }
        }).filter(Boolean);
        parts.push(`${lines.length} unread notification(s)${titles.length ? ': ' + titles.join(' • ') : ''} — clear with \`truncate -s0 ~/.claude/.notifications.jsonl\``);
      }
    }
  } catch {}

  // Git branch + ahead/behind (added 2026-04-17): current branch awareness.
  // Prior: showed changed-file count but NOT which branch or ahead/behind main.
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd, timeout: 2000, encoding: 'utf8' }).trim();
    let ahead = '', behind = '';
    try {
      const counts = execSync('git rev-list --left-right --count HEAD...@{upstream} 2>/dev/null', { cwd, timeout: 2000, encoding: 'utf8' }).trim();
      const [a, b] = counts.split(/\s+/);
      if (a && a !== '0') ahead = ` +${a}`;
      if (b && b !== '0') behind = ` -${b}`;
    } catch {}
    if (branch && branch !== 'HEAD') {
      parts.push(`Branch: ${branch}${ahead}${behind}`);
    }
  } catch {}

  // Git status (brief)
  try {
    const fullStatus = execSync('git status --porcelain -u', {
      cwd,
      timeout: 3000,
      encoding: 'utf8',
    }).toString().trim();
    if (fullStatus) {
      const allLines = fullStatus.split('\n');
      const totalCount = allLines.length;
      parts.push(`Git: ${totalCount} changed file(s)${totalCount > 20 ? '+' : ''}`);
    } else {
      parts.push('Git: clean working tree');
    }
  } catch {}

  // Stale-process detection — LAST in output (low priority, truncated first)
  try {
    const { analyze, summaryBadge } = require('./lib/stale-process-detector.js');
    const report = analyze({ currentSid: input.session_id });
    const badge = summaryBadge(report);
    if (badge) parts.push(badge);
  } catch {}

  if (parts.length > 0) {
    // R-CTX hard byte cap: prevent runaway SessionStart token cost.
    // Default 1500B; override via SESSION_CTX_MAX_BYTES env var.
    const MAX_MSG_BYTES = parseInt(process.env.SESSION_CTX_MAX_BYTES, 10) || 1500;
    let msg = `[Session context] ${parts.join(' | ')}`;
    if (Buffer.byteLength(msg, 'utf8') > MAX_MSG_BYTES) {
      // UTF-8 safe truncation — slice on bytes then trim trailing partial char
      const buf = Buffer.from(msg, 'utf8');
      const room = MAX_MSG_BYTES - 60;
      let truncated = buf.slice(0, room).toString('utf8');
      // Buffer.toString may have trimmed trailing partial; safe.
      msg = truncated + ` ... [TRUNCATED ${parts.length} sections — /memory + Read for more]`;
    }
    // D2 instrumentation — Discovery 2026-04-28
    // Log per-session SessionStart byte size for per-prompt overhead measurement.
    // Failure of this block must NOT break the loader.
    try {
      const logDir = path.join(os.homedir(), '.ai-context', 'instances');
      fs.mkdirSync(logDir, { recursive: true });
      const logPath = path.join(logDir, 'per-prompt-overhead.jsonl');
      const entry = {
        timestamp: new Date().toISOString(),
        session_id: input.session_id || process.env.SESSION_ID || 'unknown',
        cwd: cwd,
        bytes: Buffer.byteLength(msg, 'utf8'),
        source: 'session-context-loader',
      };
      fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
    } catch { /* never break the loader */ }
    process.stdout.write(JSON.stringify({
      continue: true,
      systemMessage: msg
    }));
  } else {
    process.stdout.write('{"continue":true}');
  }
} catch (e) {
  process.stderr.write('session-context-loader: ' + e.message + '\n');
  process.stdout.write('{"continue":true}');
}
