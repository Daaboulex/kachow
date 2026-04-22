# Hook Interaction Map
Generated 2026-04-22T09:13:45.956Z
Source: `/home/user/.kachow-release/hooks`
Total: 36 hooks

## Registrations

### Notification|*
- notify-with-fallback t=5

### PostToolUse|Edit
- hook-doc-drift-detector t=5

### PostToolUse|Read
- memory-retrieval-logger (async) t=3

### PostToolUse|Skill
- skill-invocation-logger (async) t=3

### PostToolUse|TodoWrite
- todowrite-mirror (async) t=3

### PostToolUse|Write
- hook-doc-drift-detector t=5

### PostToolUse|Write|Edit
- dead-hook-detector t=5
- post-write-sync t=5
- research-lint t=3

### PostToolUse|Write|Edit|MultiEdit|Bash
- context-pressure-enforce t=3

### PostToolUse|Write|Edit|MultiEdit|Bash|Read|Grep|Glob|TodoWrite
- session-presence-track (async) t=3

### PreCompact|*
- reflect-precompact t=5

### PreToolUse|Bash
- autosave-before-destructive t=8
- block-subagent-writes t=3

### PreToolUse|Read
- doc-shard-resolver t=3

### PreToolUse|Skill
- halt-condition-validator t=3

### PreToolUse|TodoWrite
- verifiedby-gate t=3

### PreToolUse|Write
- prefer-editing-nudge t=3
- validate-settings-on-write t=3

### SessionStart|*
- auto-pull-global t=20
- plugin-update-checker (async) t=10
- session-presence-start t=3
- session-start-combined t=10
- skill-upstream-checker t=10
- validate-instructions-sync (async) t=5
- validate-symlinks t=3

### Stop|*
- auto-push-global (async) t=20
- dream-auto t=5
- memory-rotate (async) t=10
- meta-system-stop t=15
- reflect-stop t=5
- session-presence-end t=3
- stop-sleep-consolidator (async) t=5
- todowrite-persist t=5
- track-skill-usage (async) t=5

### SubagentStop|*
- task-verification-gate t=3

### statusLine|*
- enhanced-statusline

## Per-hook detail

### auto-pull-global (120 LOC)
**Registered:**
- `SessionStart` matcher=`*` timeout=20
**Reads:** <dyn: 0>, <dyn: cooldownFile>
**Writes:** <dyn: cooldownFile>
**Lib deps:** ./lib/git-global.js

### auto-push-global (171 LOC)
**Registered:**
- `Stop` matcher=`*` (async) timeout=20
**Reads:** <dyn: src>, <dyn: dst>, <dyn: 0>
**Writes:** <dyn: dst>, <dyn: lastPush>
**Lib deps:** ./lib/git-global.js, ./lib/observability-logger.js

### autosave-before-destructive (167 LOC)
**Registered:**
- `PreToolUse` matcher=`Bash` timeout=8
**Reads:** <dyn: 0>
**Writes:** <dyn: logFile>
**Shell:** git rev-parse --show-toplevel, git rev-parse --git-dir, git status --porcelain, git stash list, git stash push -u -m , git rev-parse stash@{0}, git stash pop --quiet

### block-subagent-writes (94 LOC)
**Registered:**
- `PreToolUse` matcher=`Bash` timeout=3
**Reads:** <dyn: 0>

### context-pressure-enforce (107 LOC)
**Registered:**
- `PostToolUse` matcher=`Write|Edit|MultiEdit|Bash` timeout=3
**Reads:** <dyn: 0>, <dyn: ctxFile>, <dyn: fireFile>
**Writes:** <dyn: fireFile>

### dead-hook-detector (317 LOC)
**Registered:**
- `PostToolUse` matcher=`Write|Edit` timeout=5
**Reads:** <dyn: 0>, <dyn: settingsPath>, path.join(hooksDir, <dyn: recurringIssuesPath>
**Writes:** <dyn: deadCodeLastFile>

### doc-shard-resolver (55 LOC)
**Registered:**
- `PreToolUse` matcher=`Read` timeout=3
**Reads:** <dyn: 0>

### dream-auto (124 LOC)
**Registered:**
- `Stop` matcher=`*` timeout=5
**Writes:** <dyn: lockFile>, <dyn: lastFile>
**Lib deps:** ./lib/constants.js, ./lib/atomic-counter.js, ./lib/observability-logger.js

### enhanced-statusline (168 LOC)
**Registered:**
- `statusLine` matcher=`*`
**Reads:** path.join(todosDir, <dyn: cacheFile>
**Writes:** <dyn: bridgePath>
**Lib deps:** ./lib/statusline-renderer, ./lib/project-identity.js, ./lib/self-improvement/queue.js

### halt-condition-validator (69 LOC)
**Registered:**
- `PreToolUse` matcher=`Skill` timeout=3
**Reads:** <dyn: 0>, <dyn: cp>

### hook-doc-drift-detector (78 LOC)
**Registered:**
- `PostToolUse` matcher=`Write` timeout=5 if=`Write(*.claude/hooks/*.js)`
- `PostToolUse` matcher=`Edit` timeout=5 if=`Edit(*.claude/hooks/*.js)`
**Reads:** <dyn: 0>, <dyn: mdFile>

### memory-retrieval-logger (99 LOC)
**Registered:**
- `PostToolUse` matcher=`Read` (async) timeout=3
**Reads:** <dyn: 0>
**Writes:** <dyn: logFile>
**Lib deps:** ./lib/observability-logger.js

### memory-rotate (81 LOC)
**Registered:**
- `Stop` matcher=`*` (async) timeout=10
**Writes:** <dyn: MARKER>, <dyn: log>

### meta-system-stop (169 LOC)
**Registered:**
- `Stop` matcher=`*` timeout=15
**Reads:** <dyn: dreamCounter>

### notify-with-fallback (45 LOC)
**Registered:**
- `Notification` matcher=`*` timeout=5
**Writes:** <dyn: notifFile>
**Shell:** notify-send

### plugin-update-checker (94 LOC)
**Registered:**
- `SessionStart` matcher=`*` (async) timeout=10
**Reads:** <dyn: cacheFile>, <dyn: installedPath>
**Writes:** <dyn: cacheFile>
**Shell:** git fetch origin --quiet, git rev-parse origin/HEAD

### post-write-sync (283 LOC)
**Registered:**
- `PostToolUse` matcher=`Write|Edit` timeout=5 if=`Write(*.claude/*)|Write(*.gemini/*)|Write(*CLAUDE.md)|Write(*GEMINI.md)|Write(*.ai-context/*)|Edit(*.claude/*)|Edit(*.gemini/*)|Edit(*CLAUDE.md)|Edit(*GEMINI.md)|Edit(*.ai-context/*)`
**Reads:** <dyn: filePath>, <dyn: s>
**Writes:** <dyn: geminiPath>, <dyn: d>, path.join(skillDir
**Lib deps:** ./lib/platform-map, ./lib/observability-logger.js

### prefer-editing-nudge (83 LOC)
**Registered:**
- `PreToolUse` matcher=`Write` timeout=3
**Reads:** <dyn: 0>

### reflect-precompact (73 LOC)
**Registered:**
- `PreCompact` matcher=`*` timeout=5
**Writes:** <dyn: lastFile>
**Lib deps:** ./lib/observability-logger.js

### reflect-stop (97 LOC)
**Registered:**
- `Stop` matcher=`*` timeout=5
**Reads:** <dyn: progPath>
**Writes:** <dyn: enabledFile>, <dyn: lastFile>, <dyn: progPath>
**Shell:** git status --porcelain
**Lib deps:** ./lib/observability-logger.js

### research-lint (82 LOC)
**Registered:**
- `PostToolUse` matcher=`Write|Edit` timeout=3
**Reads:** <dyn: 0>

### session-presence-end (32 LOC)
**Registered:**
- `Stop` matcher=`*` timeout=3
**Reads:** <dyn: 0>
**Lib deps:** ./lib/presence.js

### session-presence-start (64 LOC)
**Registered:**
- `SessionStart` matcher=`*` timeout=3
**Reads:** <dyn: 0>
**Lib deps:** ./lib/presence.js

### session-presence-track (49 LOC)
**Registered:**
- `PostToolUse` matcher=`Write|Edit|MultiEdit|Bash|Read|Grep|Glob|TodoWrite` (async) timeout=3
**Reads:** <dyn: 0>
**Lib deps:** ./lib/presence.js

### session-start-combined (489 LOC)
**Registered:**
- `SessionStart` matcher=`*` timeout=10
**Reads:** <dyn: 0>, <dyn: tasksPath>, <dyn: versionFile>, <dyn: filePath>, <dyn: settingsPath>
**Writes:** <dyn: enabledFile>, <dyn: lockFile>, <dyn: tasksPath>, <dyn: filePath>, <dyn: catchupFile>, <dyn: memPath>, <dyn: versionFile>, <dyn: researchLastFile> (+1)
**Shell:** claude --version 2>/dev/null
**Lib deps:** ./lib/observability-logger.js, ./lib/constants.js, ./lib/atomic-counter.js, ./lib/release-notes-cache.js, ./lib/settings-schema.js, ./lib/symlink-audit.js

### skill-invocation-logger (52 LOC)
**Registered:**
- `PostToolUse` matcher=`Skill` (async) timeout=3
**Reads:** <dyn: 0>
**Writes:** <dyn: logFile>
**Lib deps:** ./lib/observability-logger.js

### skill-upstream-checker (127 LOC)
**Registered:**
- `SessionStart` matcher=`*` timeout=10
**Reads:** <dyn: sourcesFile>, <dyn: 0>
**Writes:** <dyn: sourcesFile>, <dyn: otherFile>
**Network:** yes

### stop-sleep-consolidator (126 LOC)
**Registered:**
- `Stop` matcher=`*` (async) timeout=5
**Writes:** <dyn: lockFile>, <dyn: logFile>
**Lib deps:** ./lib/constants.js, ./lib/atomic-counter.js, ./lib/observability-logger.js

### task-verification-gate (38 LOC)
**Registered:**
- `SubagentStop` matcher=`*` timeout=3
**Reads:** <dyn: 0>

### todowrite-mirror (55 LOC)
**Registered:**
- `PostToolUse` matcher=`TodoWrite` (async) timeout=3
**Reads:** <dyn: 0>
**Writes:** <dyn: cachePath>

### todowrite-persist (186 LOC)
**Registered:**
- `Stop` matcher=`*` timeout=5
**Reads:** <dyn: 0>, <dyn: cachePath>, <dyn: tasksPath>
**Writes:** <dyn: orphanPath>, <dyn: tasksPath>

### track-skill-usage (183 LOC)
**Registered:**
- `Stop` matcher=`*` (async) timeout=5
**Reads:** <dyn: 0>, <dyn: readFrom>, <dyn: lineagePath>, <dyn: USAGE_FILE>
**Writes:** <dyn: tmpPath>, <dyn: usageTmp>
**Lib deps:** ./lib/observability-logger.js

### validate-instructions-sync (120 LOC)
**Registered:**
- `SessionStart` matcher=`*` (async) timeout=5
**Reads:** <dyn: claudeMd>, <dyn: geminiMd>

### validate-settings-on-write (126 LOC)
**Registered:**
- `PreToolUse` matcher=`Write` timeout=3
**Reads:** <dyn: 0>

### validate-symlinks (90 LOC)
**Registered:**
- `SessionStart` matcher=`*` timeout=3
**Writes:** <dyn: NOTIF>
**Lib deps:** ./lib/symlink-audit.js

### verifiedby-gate (51 LOC)
**Registered:**
- `PreToolUse` matcher=`TodoWrite` timeout=3
**Reads:** <dyn: 0>
