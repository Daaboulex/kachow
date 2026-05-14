'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const LOG_DIR = path.join(os.homedir(), '.ai-context', 'runtime');
const LOG_FILE = path.join(LOG_DIR, 'hook-errors.log');
const MAX_SIZE = 512 * 1024;

function logError(hookName, error) {
  try {
    try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}
    try {
      if (fs.statSync(LOG_FILE).size > MAX_SIZE) {
        const rotated = LOG_FILE + '.1';
        try { fs.unlinkSync(rotated); } catch {}
        fs.renameSync(LOG_FILE, rotated);
      }
    } catch {}
    const msg = error instanceof Error ? error.message : String(error);
    const line = `${new Date().toISOString()} [${hookName}] ${msg}\n`;
    fs.appendFileSync(LOG_FILE, line);
  } catch {}
}

module.exports = { logError };
