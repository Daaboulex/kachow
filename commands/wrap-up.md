---
description: End-of-session orchestrator — reflect, verify sync, ensure nothing is lost. Run before ending any significant session. Proactively invoked by the Stop hook when meaningful work was done.
---

# Session Wrap-Up

Orchestrate the end-of-session flow. This ensures learnings are captured, sync is verified, and both repos are clean before the auto-push commits everything.

**When to run:** Before ending any session where you did meaningful work (code changes, skill edits, hook modifications, memory updates, CLAUDE.md changes). The Stop hook will remind you if you haven't run this.

## Step -1: Scenario Auto-Detection (added 2026-04-12)

**BEFORE running the full wrap-up, determine which scenario this session matches.** Don't burn tokens on rituals the session doesn't need. The scenarios map to different ritual depths — full wrap-up is for significant sessions only.

### Collect signals

```bash
# Signal 1: context pressure (if available from status line bridge)
CTX_REMAINING=$(cat /tmp/claude-ctx-*.json 2>/dev/null | node -e "
  let max = 100; let buf = '';
  process.stdin.on('data', c => buf += c);
  process.stdin.on('end', () => {
    try {
      for (const line of buf.split('\n').filter(Boolean)) {
        const j = JSON.parse(line);
        if (typeof j.remaining === 'number' && j.remaining < max) max = j.remaining;
      }
      console.log(max);
    } catch { console.log(100); }
  });
" 2>/dev/null || echo 100)

# Signal 2: commits this session across all known layers
COMMITS_GLOBAL=$(git -C ~/.claude log --oneline --since="12 hours ago" 2>/dev/null | wc -l)
COMMITS_GEMINI=$(git -C ~/.gemini log --oneline --since="12 hours ago" 2>/dev/null | wc -l)
COMMITS_CWD=$(git log --oneline --since="12 hours ago" 2>/dev/null | wc -l)
TOTAL_COMMITS=$((COMMITS_GLOBAL + COMMITS_GEMINI + COMMITS_CWD))

# Signal 3: uncommitted changes (dirty vs clean)
DIRTY_GLOBAL=$(git -C ~/.claude status --porcelain 2>/dev/null | wc -l)
DIRTY_CWD=$(git status --porcelain 2>/dev/null | wc -l)

# Signal 4: session touched skills/hooks/memories (risky categories)
RISKY_CHANGES=0
git -C ~/.claude log --since="12 hours ago" --name-only --pretty=format: 2>/dev/null | grep -qE "hooks/|skills/|commands/" && RISKY_CHANGES=1

# Signal 5: phase just completed (check for recent VERIFICATION.md or state transition)
PHASE_COMPLETED=$(find .planning/phases -name "*-VERIFICATION.md" -newer .planning/STATE.md 2>/dev/null | head -1)

# Signal 6: corrections/errors in recent episodic events
CORRECTION_EVENTS=$(find ~/.claude/projects/*/memory/episodic/*.jsonl 2>/dev/null -mtime -1 -exec grep -h "hook_errors\|correction" {} \; 2>/dev/null | wc -l)
```

### Route to scenario

| Scenario | Trigger | Route |
|----------|---------|-------|
| **A. Emergency handoff** | `CTX_REMAINING` ≤ 10% | Skip to `/handoff` only. Do NOT run reflect/verify-sync — no tokens to spare. |
| **B. Read-only session** | `TOTAL_COMMITS == 0` AND `DIRTY_GLOBAL == 0` AND `DIRTY_CWD == 0` | Skip wrap-up entirely. Report "Nothing to persist." |
| **C. Light session** | `TOTAL_COMMITS` 1-4 AND `RISKY_CHANGES == 0` | Mini wrap-up: Steps 1 + 2 (skip 3/verify-sync unless dirty global) |
| **D. Full session** | `TOTAL_COMMITS` ≥ 5 OR `RISKY_CHANGES == 1` OR `DIRTY_GLOBAL > 0` | Full wrap-up: Steps 0-4 including verify-sync |
| **E. Phase completion** | `PHASE_COMPLETED` is non-empty | Full wrap-up + milestone audit check: `/gsd:audit-uat` after Step 3 |
| **F. Correction-heavy** | `CORRECTION_EVENTS` ≥ 3 | Full wrap-up with priority on Step 2 (reflect) — prompt for each correction explicitly |

### Announce the route

Report briefly: `[wrap-up] Scenario: {A-F} ({reason}). Running: {steps}.`

Examples:
- `[wrap-up] Scenario: B (read-only session, 0 commits, clean trees). Running: nothing.`
- `[wrap-up] Scenario: D (7 commits, risky changes to hooks). Running: full wrap-up.`
- `[wrap-up] Scenario: A (context 8% remaining). Running: handoff only.`

Then follow the corresponding route. If scenarios overlap, use the more thorough one (e.g., E takes precedence over D).

## Step 0: Detect Scope

Determine what level this session operated at and identify all project layers to check.

**0a. Identify CWD and walk up to find project boundaries:**

```
node -e "
const fs = require('fs'), path = require('path');
let dir = process.cwd();
const home = require('os').homedir();
const markers = ['.claude', '.gemini', '.ai-context', '.git'];
const results = [];
while (dir.length >= home.length) {
  const found = markers.filter(m => fs.existsSync(path.join(dir, m)));
  if (found.length) results.push({ dir, markers: found });
  dir = path.dirname(dir);
}
console.log(JSON.stringify(results, null, 2));
"
```

**0b. Classify project type from the markers found:**

| Type | Detection | Layers to check |
|------|-----------|-----------------|
| **NixOS config** | Has `.ai-context/` with symlinked `.claude/`/`.gemini/` inside | Project root + `.ai-context/` submodule + global |
| **Monorepo** | Has `.claude/` + multiple `Development-*/` dirs | Monorepo root + current sub-project + global |
| **Sub-repo** | CWD is inside a `repos/` dir of a parent project | Sub-repo + parent project root + global |
| **Standalone project** | Has `.claude/` or `.gemini/` but none of the above | Project root + global |
| **Global** | CWD is `~/Documents` or `~/` or no project markers found | Global only |

**0c. For sub-repos (NixOS repos/ or monorepo sub-projects), identify the parent:**

```
node -e "
const path = require('path'), fs = require('fs');
const cwd = process.cwd();
// Check if inside a repos/ directory (NixOS pattern)
const reposMatch = cwd.match(/^(.+)\/repos\/([^/]+)/);
if (reposMatch) {
  console.log('SUB-REPO: ' + reposMatch[2]);
  console.log('PARENT: ' + reposMatch[1]);
}
// Check if inside a Development-* or [tooling-dir] directory ([user] monorepo pattern)
const monoMatch = cwd.match(/^(.+)\/(Development-[^/]+|[tooling-dir])(\/.*)?\$/);
if (monoMatch) {
  console.log('SUB-PROJECT: ' + monoMatch[2]);
  console.log('PARENT: ' + monoMatch[1]);
}
// Neither — we are at root level or global
if (!reposMatch && !monoMatch) console.log('ROOT-LEVEL');
"
```

**0d. Report scope decision:**

Tell the user what will be checked, e.g.:
- "Scope: sub-repo `coolercontrol-nix` + parent NixOS config + global"
- "Scope: sub-project `[sub-project]` + [project] root + global"
- "Scope: standalone project + global"
- "Scope: global only"

## Step 1: Quick Session Assessment

Before doing anything, assess what happened this session:

```
What changed?
- [ ] Code files edited (project)
- [ ] Skills/commands modified (project or global)
- [ ] Hooks modified (global)
- [ ] CLAUDE.md or GEMINI.md edited (project or global)
- [ ] settings.json edited (global)
- [ ] Memory files created/updated (project)
- [ ] New rules created (project)
- [ ] Global repos (.claude/ or .gemini/) modified
- [ ] Sub-repo(s) modified (if in monorepo/NixOS config)
```

**1b. Check git status across all detected layers:**

For each layer identified in Step 0, check for uncommitted changes:

```
# Current project/sub-repo
git status --porcelain | head -10

# Parent project (if sub-repo/sub-project detected in Step 0)
# Replace PARENT_DIR with the path from Step 0c
git -C PARENT_DIR status --porcelain | head -10
```

For NixOS config, also scan for dirty sub-repos:

```
node -e "
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const reposDir = 'PARENT_DIR/repos';
if (fs.existsSync(reposDir)) {
  const repos = fs.readdirSync(reposDir).filter(d =>
    fs.statSync(path.join(reposDir, d)).isDirectory() &&
    fs.existsSync(path.join(reposDir, d, '.git'))
  );
  repos.forEach(r => {
    try {
      const out = execSync('git status --porcelain', { cwd: path.join(reposDir, r) }).toString().trim();
      if (out) console.log(r + ': ' + out.split('\n').length + ' uncommitted changes');
    } catch(e) {}
  });
}
"
```

For [user] monorepo, check main repo status when working in a sub-project:

```
git -C PARENT_DIR status --porcelain | head -10
```

If nothing meaningful changed (just reading, exploring, answering questions), skip to Step 4.

## Step 2: Reflect

Run the /reflect workflow inline (don't invoke the skill — execute its phases directly):

**2a. Signal scan** — Review the session for:
- Explicit corrections (user said "no", "don't", "wrong")
- Validated patterns (user said "yes exactly", "perfect", accepted approach)
- Skill/hook issues encountered (wrong output, silent failures, stale references)
- Agent findings worth persisting (research agents, review agents — their results are conversation-only and will be LOST)
- Architectural decisions made (design choices, approach selections, rejected alternatives)
- Tool quirks discovered (format requirements, CLI bugs, workarounds)

**2b. Quick staleness check** — For any memory/rule/skill touched or referenced this session, is it still accurate?

**2c. Propose changes** — List what should be persisted:
- New memories (feedback, project, user, reference)
- Memory updates (stale → current)
- Skill improvements (if a skill had issues)
- Rule changes
- CLAUDE.md updates

**2d. Save proposals** — Write to `.claude/.reflect-proposals.md` before asking approval.

**2e. Ask approval** — Present all proposals. Wait for user.

**2f. Apply + sync** — Read proposals back from file, write changes, sync to Gemini.

**2g. Cleanup** — Delete `.claude/.reflect-proposals.md`.

If no signals detected, say "No learnings to persist" and continue to Step 3.

## Step 3: Verify Sync

Run the critical /verify-sync checks inline. All commands use cross-platform patterns (Node.js for counting/JSON, git works everywhere).

**3a. Global content parity:**

```
node -e "
const fs = require('fs'), path = require('path'), glob = require('path');
const home = require('os').homedir();
function countFiles(pattern, dir) {
  try {
    return fs.readdirSync(dir).filter(f => f.match(pattern)).length;
  } catch(e) { return 0; }
}
function countSubdirFiles(dir, filePattern) {
  try {
    return fs.readdirSync(dir).filter(d => {
      const sub = path.join(dir, d);
      return fs.statSync(sub).isDirectory() && fs.existsSync(path.join(sub, filePattern));
    }).length;
  } catch(e) { return 0; }
}
const cc = countFiles(/\.md$/, path.join(home, '.claude/commands'));
const gs = countSubdirFiles(path.join(home, '.gemini/skills'), 'SKILL.md');
console.log('Claude commands: ' + cc);
console.log('Gemini skills: ' + gs);
if (cc !== gs) console.log('WARNING: count mismatch — check for missing skill sync');
"
```

**3b. Project-level content parity** (if project-level scope detected in Step 0):

```
node -e "
const fs = require('fs'), path = require('path');
function countMd(dir) {
  try { return fs.readdirSync(dir).filter(f => f.endsWith('.md')).length; }
  catch(e) { return 0; }
}
// Adjust PROJECT_ROOT to the project root from Step 0
const root = process.cwd();
const cr = path.join(root, '.claude/rules');
const gr = path.join(root, '.gemini/rules');
const cm = path.join(root, '.claude/memory');
const gm = path.join(root, '.gemini/memory');
const cs = path.join(root, '.claude/skills');
const gs = path.join(root, '.gemini/skills');
const crn = countMd(cr), grn = countMd(gr);
const cmn = countMd(cm), gmn = countMd(gm);
console.log('Project rules (Claude): ' + crn + ' | (Gemini): ' + grn + (crn !== grn ? ' WARNING: mismatch' : ''));
console.log('Project memory (Claude): ' + cmn + ' | (Gemini): ' + gmn + (cmn !== gmn ? ' WARNING: mismatch' : ''));
// Check skills directory if it exists
if (fs.existsSync(cs) || fs.existsSync(gs)) {
  const csn = fs.existsSync(cs) ? fs.readdirSync(cs).length : 0;
  const gsn = fs.existsSync(gs) ? fs.readdirSync(gs).length : 0;
  console.log('Project skills (Claude): ' + csn + ' | (Gemini): ' + gsn + (csn !== gsn ? ' WARNING: mismatch' : ''));
}
"
```

**3c. NixOS .ai-context symlink integrity** (only for NixOS config projects):

```
node -e "
const fs = require('fs'), path = require('path');
// Adjust AI_CTX to the .ai-context/ path from Step 0
const aiCtx = 'AI_CONTEXT_PATH';
const links = [
  ['.claude/claude-progress.json', '../AI-progress.json'],
  ['.claude/claude-tasks.json', '../AI-tasks.json'],
  ['.gemini/gemini-progress.json', '../AI-progress.json'],
  ['.gemini/gemini-tasks.json', '../AI-tasks.json'],
];
links.forEach(([rel, expected]) => {
  const full = path.join(aiCtx, rel);
  try {
    const target = fs.readlinkSync(full);
    if (target !== expected) console.log('BROKEN LINK: ' + rel + ' -> ' + target + ' (expected ' + expected + ')');
    else if (!fs.existsSync(full)) console.log('DANGLING: ' + rel + ' -> ' + target);
    else console.log('OK: ' + rel);
  } catch(e) { console.log('MISSING: ' + rel); }
});
"
```

**3d. Hook file parity** (if hooks were modified this session):

```
node -e "
const fs = require('fs'), path = require('path');
const home = require('os').homedir();
const claudeHooks = path.join(home, '.claude/hooks');
const geminiHooks = path.join(home, '.gemini/hooks');
const claudeOnly = new Set(['sync-gemini-md.js','sync-gemini-skills.js','reflect-stop.js','reflect-stop-failure.js','validate-instructions-sync.js','plugin-update-checker.js','enhanced-statusline.js','sync-hook-versions.js']);
const geminiOnly = new Set(['sync-claude-md.js','sync-claude-skills.js','reflect-session-end.js']);
const expectedDiff = new Set(['claude-gemini-json-sync.js']);
try {
  const files = fs.readdirSync(claudeHooks).filter(f => f.endsWith('.js'));
  files.forEach(f => {
    if (claudeOnly.has(f)) return;
    const gf = path.join(geminiHooks, f);
    if (!fs.existsSync(gf)) { console.log('MISSING in Gemini: ' + f); return; }
    const c = fs.readFileSync(path.join(claudeHooks, f));
    const g = fs.readFileSync(gf);
    if (!c.equals(g) && !expectedDiff.has(f)) console.log('DIFFERS: ' + f);
  });
} catch(e) { console.log('Could not read hooks: ' + e.message); }
"
```

Expected differences (direction-specific, NOT bugs):
- `claude-gemini-json-sync.js` — different pattern order + comment header per platform
- Claude-only: `sync-gemini-md.js`, `sync-gemini-skills.js`, `reflect-stop.js`, `reflect-stop-failure.js`, `validate-instructions-sync.js`, `plugin-update-checker.js`, `enhanced-statusline.js`, `sync-hook-versions.js`
- Gemini-only: `sync-claude-md.js`, `sync-claude-skills.js`, `reflect-session-end.js`

Any OTHER hook that differs is a bug — fix by copying the Claude version to Gemini.

**3e. Settings.json parity** (if hooks/settings were modified):

```
node -e "
const fs = require('fs'), path = require('path');
const home = require('os').homedir();
try {
  const gemini = JSON.parse(fs.readFileSync(path.join(home, '.gemini/settings.json'), 'utf8'));
  const bt = gemini.hooks && gemini.hooks.BeforeTool || [];
  bt.forEach(h => {
    const cmds = (h.hooks || []).map(x => x.command || '').join(' ');
    if (/sync/i.test(cmds)) console.log('BUG: sync hook under Gemini BeforeTool');
  });
} catch(e) {}
try {
  const claude = JSON.parse(fs.readFileSync(path.join(home, '.claude/settings.json'), 'utf8'));
  const ptu = claude.hooks && claude.hooks.PreToolUse || [];
  ptu.forEach(h => {
    const cmds = (h.hooks || []).map(x => x.command || '').join(' ');
    if (/sync/i.test(cmds)) console.log('BUG: sync hook under Claude PreToolUse');
  });
} catch(e) {}
console.log('Settings hook placement: checked');
"
```

**3f. Translation pattern parity** (if sync hooks were modified):

```
node -e "
const fs = require('fs'), path = require('path');
const home = require('os').homedir();
try {
  const fwd = fs.readFileSync(path.join(home, '.claude/hooks/sync-gemini-md.js'), 'utf8');
  const rev = fs.readFileSync(path.join(home, '.gemini/hooks/sync-claude-md.js'), 'utf8');
  const fwdCount = (fwd.match(/\.replace\(/g) || []).length;
  const revCount = (rev.match(/\.replace\(/g) || []).length;
  console.log('Forward: ' + fwdCount + ' patterns');
  console.log('Reverse: ' + revCount + ' patterns');
  if (fwdCount !== revCount) console.log('WARNING: pattern count mismatch');
} catch(e) { console.log('Sync hooks not found or not readable'); }
"
```

**3g. Uncommitted changes (global repos):**

```
git -C ~/.claude status --porcelain | head -5
git -C ~/.gemini status --porcelain | head -5
```

If issues found, fix them before the session ends.
If everything clean, report: "Sync: OK"

## Step 4: Report

```
## Wrap-Up Report

### Session Summary
[1-2 sentences: what was accomplished]

### Learnings Persisted
- [list of memories/rules/skills created or updated, or "None"]

### Sync Status
- Claude ↔ Gemini: [OK | issues found and fixed | DRIFT — details]

### Auto-Push Ready
- ~/.claude/: [N files changed, ready to commit]
- ~/.gemini/: [N files changed, ready to commit]
- auto-push-global.js will commit+push on session end (30-min cooldown)
```

## Important

- Do NOT skip Step 2 just because it takes time — lost learnings cost more in future sessions
- Do NOT auto-apply reflect proposals without user approval
- If the session only touched project files (not global config), Step 3 can be abbreviated
- The Stop hook auto-fires after this, handling commit + push

## Red Flags

If you catch yourself thinking any of these, STOP — you're rationalizing:

| Thought | Reality |
|---------|---------|
| "I'll just do a quick /handoff instead" | /wrap-up exists because /handoff alone misses verification. Do the full thing. |
| "Everything is committed, no need" | Committed != verified. wrap-up catches drift. |
| "Context is too low to wrap up" | That's EXACTLY when you need to save state. Run /handoff at minimum. |
| "The user will remember where we left off" | The user has 3 machines and multiple sessions. Write it down. |
| "I already ran /reflect" | /wrap-up orchestrates reflect + verify-sync + reporting. One step != all steps. |
