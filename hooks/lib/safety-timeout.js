#!/usr/bin/env node
// Global safety timeout — prevents runaway hooks from hanging sessions.
// Usage: require('./lib/safety-timeout.js') as first line of any hook.
// Inspired by ruflo hook-handler.cjs:82-85.
const _t = setTimeout(() => process.exit(0), 5000);
_t.unref();
module.exports = {};
