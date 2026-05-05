#!/usr/bin/env node
// Global safety timeout — prevents runaway hooks from hanging sessions.
// Usage: require('./lib/safety-timeout.js') as first line of any hook.
// Heavy hooks (auto-push-global, mirror-kachow) get 30s; others get 5s.
// Inspired by ruflo hook-handler.cjs:82-85.
const HEAVY = /auto-push-global|mirror-kachow|meta-system-stop/;
const limit = HEAVY.test(process.argv[1] || '') ? 30000 : 5000;
const _t = setTimeout(() => process.exit(0), limit);
_t.unref();
module.exports = {};
