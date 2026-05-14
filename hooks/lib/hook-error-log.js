// Hook error logger - call early in any hook to capture full error to log file.
// Usage at top of hook: require('./lib/hook-error-log.js').install('hook-name');
const fs = require('fs');
const path = require('path');
const os = require('os');

const LOG_DIR = path.join(os.homedir(), '.ai-context', 'runtime', 'hook-errors');
const ENABLED = process.env.HOOK_DEBUG === '1' || fs.existsSync(path.join(os.homedir(), '.ai-context', 'runtime', '.hook-debug'));

function install(hookName) {
  if (!ENABLED) return;
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}

  const logFile = path.join(LOG_DIR, `${hookName}-${Date.now()}.log`);
  const origErr = process.stderr.write.bind(process.stderr);
  let buf = '';

  process.stderr.write = (chunk, ...rest) => {
    buf += chunk;
    return origErr(chunk, ...rest);
  };

  process.on('uncaughtException', err => {
    try {
      fs.writeFileSync(logFile, [
        `Hook: ${hookName}`,
        `Time: ${new Date().toISOString()}`,
        `Argv: ${JSON.stringify(process.argv)}`,
        `Cwd: ${process.cwd()}`,
        `Error: ${err.stack || err.message}`,
        `Stderr: ${buf}`,
      ].join('\n'));
    } catch {}
    throw err;
  });

  process.on('exit', code => {
    if (code !== 0 && buf) {
      try { fs.writeFileSync(logFile, `Hook: ${hookName}\nExit: ${code}\nStderr: ${buf}\n`); } catch {}
    }
  });
}

module.exports = { install, ENABLED };
