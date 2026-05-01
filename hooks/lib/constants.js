// Shared constants for all Claude Code hooks.
// Centralizes magic numbers that were previously duplicated across files.
// Any change here must be propagated by copying to ~/.gemini/hooks/lib/constants.js
// (auto-push-global.js handles this sync).

// Consolidation (dream-auto.js, session-start-combined.js, /consolidate-memory)
const DREAM_COOLDOWN_MS = 24 * 60 * 60 * 1000;  // 24 hours between consolidations
const DREAM_MIN_SESSIONS = 5;                    // Minimum sessions to trigger consolidation
const DREAM_LOCK_STALE_MS = 30 * 60 * 1000;     // Lock considered stale after 30 minutes

// Research scheduler (meta-system-stop.js, session-start-combined.js)
const RESEARCH_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;  // 30 days between research refreshes
const RESEARCH_MIN_SESSIONS = 20;                         // Minimum sessions to trigger research

// Leader election (leader-election.js, for Tier 3 consolidation)
const LEADER_LOCK_STALE_MS = 30 * 60 * 1000;  // Same 30 min as DREAM_LOCK_STALE_MS

// Dead-code detector (dead-hook-detector.js)
const DEAD_CODE_COOLDOWN_MS = 24 * 60 * 60 * 1000;  // 24 hours between extended scans
const STALE_MEMORY_DAYS = 60;                        // Memory files unreferenced 60+ days
const UNUSED_SKILL_DAYS = 30;                        // Skills not invoked 30+ days
const INACTIVE_AGENT_DAYS = 14;                      // Agents not spawned 14+ days

// Reflect (reflect-stop.js)
const REFLECT_COOLDOWN_MS = 15 * 60 * 1000;  // 15 minutes between wrap-up nudges

// Auto-push (auto-push-global.js)
const PUSH_COOLDOWN_MS = 5 * 60 * 1000;  // 5 minutes between pushes

// Temp file cleanup (session-start-combined.js)
const TEMP_FILE_STALE_MS = 24 * 60 * 60 * 1000;  // /tmp files considered stale after 24 hours

// Tool-call p95 regression detector (meta-system-stop.js / detectors.js R18)
const TOOL_CALL_P95_CEILING_MS = 200;

// Skill regression detector (meta-system-stop.js)
const SKILL_REGRESSION_DROP_THRESHOLD = 0.5;  // 50% frequency drop flags regression
const SKILL_MIN_INVOCATIONS = 5;               // Skip skills with <5 total invocations
const MIN_SESSIONS_PER_WINDOW = 5;             // Skip analysis if either window has <5 sessions
const SKILL_REGRESSION_EXEMPT = new Set([
  'wrap-up', 'superpowers:brainstorming', 'handoff', 'reflect',
  'consolidate-memory', 'verify-sync'
]);

// Agent model selection policy (rule-enforcement-check.js + observability)
// Maps task categories to recommended models. Used by:
//   - rule-enforcement-check.js: warns when dispatch doesn't match policy
//   - observability-logger.js: tracks model usage per category for cost analysis
// Rationale from AGENTS.md § Agent Dispatch Rules + Hermes auxiliary-model pattern.
const MODEL_POLICY = {
  research:       'sonnet',   // WebFetch/WebSearch — haiku hallucinates ~20% web claims
  implementation: 'sonnet',   // Code generation
  review:         'haiku',    // File reads, grep, spot-checks — 5x cheaper
  architecture:   'opus',     // Planning, design decisions
  telemetry:      'haiku',    // Background logging, consolidation
  verification:   'sonnet',   // Blind verification agents
};

// Model cost multipliers (relative to haiku=1) for cost tracking
const MODEL_COST_MULTIPLIER = {
  haiku:  1,
  sonnet: 5,
  opus:   25,
};

// System overhead accounting (jcode pattern: reserve tokens for system prompt + tools)
// Estimated: ~8k system prompt + ~10k for tool definitions = ~18k tokens
// Used by context-pressure-enforce.js to account for overhead in threshold calculations
const SYSTEM_OVERHEAD_TOKENS = 18000;

module.exports = {
  DREAM_COOLDOWN_MS,
  DREAM_MIN_SESSIONS,
  DREAM_LOCK_STALE_MS,
  RESEARCH_COOLDOWN_MS,
  RESEARCH_MIN_SESSIONS,
  LEADER_LOCK_STALE_MS,
  DEAD_CODE_COOLDOWN_MS,
  STALE_MEMORY_DAYS,
  UNUSED_SKILL_DAYS,
  INACTIVE_AGENT_DAYS,
  REFLECT_COOLDOWN_MS,
  PUSH_COOLDOWN_MS,
  TEMP_FILE_STALE_MS,
  TOOL_CALL_P95_CEILING_MS,
  SKILL_REGRESSION_DROP_THRESHOLD,
  SKILL_MIN_INVOCATIONS,
  MIN_SESSIONS_PER_WINDOW,
  SKILL_REGRESSION_EXEMPT,
  MODEL_POLICY,
  MODEL_COST_MULTIPLIER,
  SYSTEM_OVERHEAD_TOKENS,
};
