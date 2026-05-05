// queue.js — self-improvement queue
// Append-only JSONL. Dedup by id (sha1 of rule+target+evidence_key).
// Spec: [spec-ref] 2026-04-14-self-improvement-handoff.md

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const HOME = os.homedir();
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude');
// Per-machine filenames — prevents Syncthing conflicts between 2+ devices.
// Mirrors observability-logger.js pattern (hostname-keyed JSONL).
const HOST = os.hostname();
const PENDING = path.join(CLAUDE_DIR, `self-improvements-pending-${HOST}.jsonl`);
const RESOLVED = path.join(CLAUDE_DIR, `self-improvements-resolved-${HOST}.jsonl`);
const FEEDBACK = path.join(CLAUDE_DIR, 'memory', 'reference', 'self-improvement-feedback.md');

// Legacy paths (pre-2026-04-14) — read-through for backward compat during transition
const LEGACY_PENDING = path.join(CLAUDE_DIR, 'self-improvements-pending.jsonl');
const LEGACY_RESOLVED = path.join(CLAUDE_DIR, 'self-improvements-resolved.jsonl');

const MAX_PENDING = 200;

function _hashId(rule, target, evidenceKey) {
  return crypto.createHash('sha1').update(`${rule}|${target}|${evidenceKey || ''}`).digest('hex').slice(0, 12);
}

function _readJsonl(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

// Read ALL per-machine queue files (globbed by prefix) — merged view across machines
function _readAllJsonl(prefix) {
  const results = [];
  try {
    const dir = path.dirname(prefix);
    const baseName = path.basename(prefix);
    // Match both exact basename AND basename-<any>.jsonl
    const pattern = baseName.replace('.jsonl', '');
    for (const f of fs.readdirSync(dir)) {
      if (f === `${pattern}.jsonl` || f.startsWith(`${pattern}-`) && f.endsWith('.jsonl')) {
        results.push(...(_readJsonl(path.join(dir, f))));
      }
    }
  } catch {}
  return results;
}

function _appendJsonl(filePath, entry) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, JSON.stringify(entry) + '\n');
    return true;
  } catch { return false; }
}

function _rewriteJsonl(filePath, entries) {
  try {
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, entries.map(e => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''));
    fs.renameSync(tmp, filePath);  // atomic
    return true;
  } catch { return false; }
}

// Rejection-class suppression: check memory/reference/self-improvement-feedback.md
// For 3+ rejections in same fingerprint_class within 90d → suppress new findings of that class
function _isSuppressedClass(fingerprint_class) {
  if (!fingerprint_class) return false;
  try {
    const resolved = _readJsonl(RESOLVED);
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const rejects = resolved.filter(e =>
      (e.decision === 'reject' || e.resolution === 'reject') &&
      e.fingerprint_class === fingerprint_class &&
      new Date(e.decided_at || e.resolved_at || 0).getTime() > cutoff
    );
    return rejects.length >= 3;
  } catch { return false; }
}

/**
 * Enqueue a finding. Dedups by id. Idempotent: same id updates seen_count.
 * @param {object} finding
 * @returns {object} - The stored entry (with id populated)
 */
function enqueue(finding) {
  // Dedup by rule + target ONLY (not evidence). Evidence changes between detections
  // (e.g., sample_n varies) which previously caused duplicate entries for same issue.
  const id = _hashId(finding.rule, finding.target?.path || finding.target?.type || 'global', '');

  // Suppression check
  if (_isSuppressedClass(finding.fingerprint_class)) {
    return { suppressed: true, id, reason: `fingerprint_class '${finding.fingerprint_class}' suppressed (3+ rejections in 90d)` };
  }

  // Skip if already resolved on any machine (cross-hostname sync)
  try {
    const resolvedAll = _readAllJsonl(path.join(CLAUDE_DIR, 'self-improvements-resolved.jsonl'));
    if (fs.existsSync(LEGACY_RESOLVED)) resolvedAll.push(..._readJsonl(LEGACY_RESOLVED));
    if (resolvedAll.some(e => e.id === id)) return { suppressed: true, id, reason: 'resolved-cross-machine' };
  } catch {}

  const existing = _readJsonl(PENDING).find(e => e.id === id);
  if (existing) {
    existing.seen_count = (existing.seen_count || 1) + 1;
    existing.evidence = finding.evidence;  // refresh evidence
    const all = _readJsonl(PENDING).map(e => e.id === id ? existing : e);
    _rewriteJsonl(PENDING, all);
    return existing;
  }

  const entry = {
    id,
    detected_at: new Date().toISOString(),
    rule: finding.rule,
    tier: finding.tier || 'SUGGEST',
    target: finding.target,
    evidence: finding.evidence || {},
    proposal: finding.proposal || '',
    auto_applicable: finding.auto_applicable === true,
    diff_preview: finding.diff_preview || null,
    seen_count: 1,
    last_surfaced: null,
    fingerprint_class: finding.fingerprint_class || finding.rule
  };

  _appendJsonl(PENDING, entry);

  // Cap pending at MAX — evict oldest OBSERVE
  try {
    const all = _readJsonl(PENDING);
    if (all.length > MAX_PENDING) {
      const observe = all.filter(e => e.tier === 'OBSERVE').sort((a, b) =>
        (a.detected_at || '').localeCompare(b.detected_at || '')
      );
      const evict = observe.slice(0, all.length - MAX_PENDING);
      const evictIds = new Set(evict.map(e => e.id));
      const kept = all.filter(e => !evictIds.has(e.id));
      _rewriteJsonl(PENDING, kept);
    }
  } catch {}

  return entry;
}

function readPending() {
  // Merge local + legacy + all hostname-keyed files for cross-machine view
  const base = path.join(CLAUDE_DIR, 'self-improvements-pending.jsonl');
  const all = _readAllJsonl(base);
  // Also include legacy if present
  if (fs.existsSync(LEGACY_PENDING)) all.push(..._readJsonl(LEGACY_PENDING));
  // Dedup by id
  const seen = new Set();
  let result = all.filter(e => {
    if (!e.id || seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
  // Cross-hostname resolution: filter out entries already resolved on ANY machine
  try {
    const resolvedAll = _readAllJsonl(path.join(CLAUDE_DIR, 'self-improvements-resolved.jsonl'));
    if (fs.existsSync(LEGACY_RESOLVED)) resolvedAll.push(..._readJsonl(LEGACY_RESOLVED));
    const resolvedIds = new Set(resolvedAll.map(e => e.id));
    result = result.filter(e => !resolvedIds.has(e.id));
  } catch {}
  return result;
}

function count(tier) {
  const all = readPending();
  if (tier) return all.filter(e => e.tier === tier).length;
  return all.length;
}

function summary() {
  const all = readPending();
  return {
    total: all.length,
    BLOCKER: all.filter(e => e.tier === 'BLOCKER').length,
    SUGGEST: all.filter(e => e.tier === 'SUGGEST').length,
    OBSERVE: all.filter(e => e.tier === 'OBSERVE').length,
  };
}

/**
 * Resolve an entry — move from pending to resolved with decision.
 * @param {string} id
 * @param {'accept'|'reject'|'defer'} decision
 * @param {string} [note]
 * @returns {object|null} - The resolved entry
 */
function resolve(id, decision, note) {
  const pending = _readJsonl(PENDING);
  const entry = pending.find(e => e.id === id);
  if (!entry) return null;
  const resolved = {
    ...entry,
    decision,
    decided_at: new Date().toISOString(),
    user_note: note || null
  };
  _appendJsonl(RESOLVED, resolved);
  _rewriteJsonl(PENDING, pending.filter(e => e.id !== id));

  // Feedback learning: on reject, note class for future suppression
  if (decision === 'reject' && entry.fingerprint_class) {
    try {
      fs.mkdirSync(path.dirname(FEEDBACK), { recursive: true });
      const line = `- [${new Date().toISOString().slice(0, 10)}] Rejected ${entry.rule} for ${entry.target?.path || entry.target?.type || 'unknown'}${note ? ' — user: "' + note + '"' : ''}. Class: \`${entry.fingerprint_class}\`.\n`;
      if (!fs.existsSync(FEEDBACK)) {
        fs.writeFileSync(FEEDBACK, `---\nname: Self-Improvement Feedback\ndescription: Auto-maintained rejection log from /review-improvements; drives 90-day class suppression\ntype: reference\n---\n\n# Self-Improvement Rejection Log\n\nAuto-maintained. Read by queue.js to suppress fingerprint_class after 3+ rejections in 90d.\n\n## Rejections\n\n`);
      }
      fs.appendFileSync(FEEDBACK, line);
    } catch {}
  }

  return resolved;
}

/**
 * Mark entry as surfaced — update last_surfaced timestamp.
 * Call this when banner shows it so stale detection knows it was presented.
 */
function markSurfaced(id) {
  try {
    const all = _readJsonl(PENDING);
    const e = all.find(x => x.id === id);
    if (!e) return;
    e.last_surfaced = new Date().toISOString();
    _rewriteJsonl(PENDING, all);
  } catch {}
}

/**
 * Auto-resolve OBSERVE entries older than 14d where signal has disappeared.
 * Caller passes `stillActive(id)` → bool. If false, auto-resolve as 'defer' (signal gone).
 */
function autoResolveStaleObserve(stillActive) {
  try {
    const all = _readJsonl(PENDING);
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const stale = all.filter(e =>
      e.tier === 'OBSERVE' &&
      new Date(e.detected_at).getTime() < cutoff &&
      !stillActive(e.id)
    );
    for (const e of stale) {
      resolve(e.id, 'defer', 'auto-resolved: signal disappeared 14d');
    }
    return stale.length;
  } catch { return 0; }
}

module.exports = {
  enqueue,
  readPending,
  count,
  summary,
  resolve,
  markSurfaced,
  autoResolveStaleObserve,
  hashId: _hashId,
  PENDING_PATH: PENDING,
  RESOLVED_PATH: RESOLVED,
  FEEDBACK_PATH: FEEDBACK,
};
