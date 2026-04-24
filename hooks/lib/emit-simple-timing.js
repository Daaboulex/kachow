// emit-simple-timing.js
// One-line hook instrumentation — add at the top of any hook:
//
//   require('./lib/emit-simple-timing.js').start(__filename);
//
// It auto-registers a `process.on('exit')` handler that emits a
// `hook_timing` observability event with total_ms measured from the
// start() call until process exit. No per-exit-site boilerplate needed.
//
// Design choice: process-exit hook over try/finally because hooks have
// many exit paths (process.exit(0) in success branches, implicit end
// on thrown/caught errors, detached spawns leaving parent to fall
// through). Registering once at the top covers all of them.
//
// Idempotent: calling start() twice on the same process is a no-op
// (first caller wins). Prevents double-logging if a hook accidentally
// calls start() from nested requires.

'use strict';

const path = require('path');

// Module-scoped guard — one emit per process, regardless of re-require.
let _registered = false;

function start(hookFilePath) {
  if (_registered) return;
  _registered = true;

  const startHr = process.hrtime.bigint();
  const source = path.basename(hookFilePath || 'unknown', '.js');

  process.on('exit', (code) => {
    try {
      const total_ms = Number(process.hrtime.bigint() - startHr) / 1e6;
      const obs = require('./observability-logger.js');
      obs.logEvent(process.cwd(), {
        type: 'hook_timing',
        source,
        meta: {
          total_ms: +total_ms.toFixed(3),
          exit_code: code,
          error_count: code === 0 ? 0 : 1,
          instrumented_by: 'emit-simple-timing',
        },
      });
    } catch {}
  });
}

module.exports = { start };
