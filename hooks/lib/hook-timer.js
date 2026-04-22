// hook-timer.js
// Lightweight timing helper for hook instrumentation. Wraps synchronous
// sections with hrtime, logs {section, duration_ms, ok} events via
// observability-logger so latency stats can be derived from episodic JSONL.
//
// Usage in a hook:
//   const { timed, summary } = require('./lib/hook-timer.js');
//   timed('section-name', () => { ... section body ... });
//   timed('another', () => { ... });
//   // At hook end:
//   summary(projectDir, 'session-start-combined');

'use strict';

const obs = (() => {
  try { return require('./observability-logger.js'); }
  catch { return null; }
})();

const timings = [];

function timed(sectionName, fn) {
  const start = process.hrtime.bigint();
  let ok = true;
  let err = null;
  try { fn(); }
  catch (e) { ok = false; err = e; }
  const end = process.hrtime.bigint();
  const duration_ms = Number(end - start) / 1e6;
  timings.push({ section: sectionName, duration_ms: +duration_ms.toFixed(3), ok });
  if (!ok) throw err;
}

function summary(projectDir, hookName) {
  if (timings.length === 0) return;
  const total_ms = timings.reduce((a, t) => a + t.duration_ms, 0);
  if (obs && typeof obs.logEvent === 'function') {
    try {
      obs.logEvent(projectDir, {
        type: 'hook_timing',
        source: hookName,
        meta: {
          total_ms: +total_ms.toFixed(3),
          section_count: timings.length,
          sections: timings,
          slowest: timings.slice().sort((a, b) => b.duration_ms - a.duration_ms).slice(0, 3),
        },
      });
    } catch {}
  }
}

function getTimings() { return timings.slice(); }
function reset() { timings.length = 0; }

module.exports = { timed, summary, getTimings, reset };
