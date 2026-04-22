// hook-interaction-map.js
// Static-analyze every hook .js: declared event, matcher, file I/O, shell calls,
// network calls, lib deps, module exports. Output a machine-readable map.
//
// Answers: "what can happen when this hook fires?"
//
// Caveats:
//   - Purely static regex-based. Misses dynamic paths (e.g. path.join(home, someVar)).
//   - Resolves template literal variables naively — flags as "dynamic" rather than guess.
//   - Claude Code's internal state is opaque. We only map what the hook code *does*,
//     not what Claude Code does in response.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const RE = {
  // File I/O
  readFile: /fs\.(readFileSync|readFile|createReadStream)\s*\(\s*([^,)]+)/g,
  writeFile: /fs\.(writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream)\s*\(\s*([^,)]+)/g,
  unlink: /fs\.(unlinkSync|unlink|rmSync|rm)\s*\(\s*([^,)]+)/g,
  mkdir: /fs\.(mkdirSync|mkdir)\s*\(\s*([^,)]+)/g,
  rename: /fs\.(renameSync|rename|copyFileSync|copyFile)\s*\(\s*([^,)]+)/g,
  // Shell / process
  execSync: /execSync\s*\(\s*['"`]([^'"`]+)['"`]/g,
  exec: /(?:^|\W)exec\s*\(\s*['"`]([^'"`]+)['"`]/g,
  spawn: /(?:spawn|spawnSync)\s*\(\s*['"`]([^'"`]+)['"`]/g,
  // Requires (lib deps)
  require: /require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
  // Network
  fetch: /\bfetch\s*\(|https?\.(get|request)\s*\(/g,
  // stdin / stdout contract
  stdin: /(?:process\.stdin|fs\.readFileSync\s*\(\s*0)/,
  stdoutWrite: /process\.stdout\.write/,
  // Errors surfaced
  stderrWrite: /process\.stderr\.write/,
  // Exit codes
  exit: /process\.exit\s*\(\s*(\d+)/g,
};

function normalizeArg(arg) {
  if (!arg) return 'dynamic';
  const t = String(arg).trim();
  if (/^['"`][^'"`]*['"`]$/.test(t)) return t.slice(1, -1);
  // Common patterns we can name
  if (/\bpath\.join\(/.test(t)) return t.replace(/\s+/g, ' ');
  return `<dyn: ${t.slice(0, 80)}>`;
}

function collect(content, re) {
  const out = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(content))) {
    out.push(m[2] ? normalizeArg(m[2]) : m[1]);
  }
  return [...new Set(out)];
}

function analyzeHook(hookPath) {
  const name = path.basename(hookPath, '.js');
  const content = fs.readFileSync(hookPath, 'utf8');

  // Strip comments for cleaner regex matches
  const noComments = content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(?<=^|\s)\/\/.*$/gm, '');

  const requires = collect(noComments, RE.require);
  const libDeps = requires.filter(r => r.startsWith('./') || r.startsWith('../') || r.includes('lib/'));
  const nodeCore = requires.filter(r => !r.startsWith('./') && !r.startsWith('../') && !r.includes('lib/'));

  return {
    name,
    path: hookPath,
    loc: content.split('\n').length,
    reads: collect(noComments, RE.readFile),
    writes: collect(noComments, RE.writeFile),
    deletes: collect(noComments, RE.unlink),
    mkdirs: collect(noComments, RE.mkdir),
    renames: collect(noComments, RE.rename),
    execs: [...collect(noComments, RE.execSync), ...collect(noComments, RE.exec), ...collect(noComments, RE.spawn)],
    libDeps,
    nodeCore,
    usesStdin: RE.stdin.test(noComments),
    usesStdout: RE.stdoutWrite.test(noComments),
    usesStderr: RE.stderrWrite.test(noComments),
    usesNetwork: RE.fetch.test(noComments),
    exitCodes: [...new Set([...noComments.matchAll(RE.exit)].map(m => parseInt(m[1], 10)))],
  };
}

function findEventRegistrations(settingsJson) {
  try {
    const s = JSON.parse(settingsJson);
    const out = {};  // hookFilename -> [{event, matcher, timeout, async}]
    const events = s.hooks || {};
    for (const event of Object.keys(events)) {
      const entries = events[event];
      if (!Array.isArray(entries)) continue;
      for (const block of entries) {
        const matcher = block.matcher || '*';
        for (const h of (block.hooks || [])) {
          const cmd = h.command || '';
          const m = cmd.match(/hooks\/([a-zA-Z0-9_-]+)\.js/);
          if (!m) continue;
          const file = m[1] + '.js';
          out[file] = out[file] || [];
          out[file].push({ event, matcher, timeout: h.timeout, async: !!h.async, if: h.if });
        }
      }
    }
    // statusLine
    if (s.statusLine && s.statusLine.command) {
      const m = s.statusLine.command.match(/hooks\/([a-zA-Z0-9_-]+)\.js/);
      if (m) out[m[1] + '.js'] = [{ event: 'statusLine', matcher: '*' }];
    }
    return out;
  } catch { return {}; }
}

function buildMap(hooksDir, settingsPath) {
  const files = fs.readdirSync(hooksDir)
    .filter(f => f.endsWith('.js') && !f.includes('archive'))
    .map(f => path.join(hooksDir, f));
  const hooks = files.map(analyzeHook);
  const reg = fs.existsSync(settingsPath)
    ? findEventRegistrations(fs.readFileSync(settingsPath, 'utf8'))
    : {};

  for (const h of hooks) {
    h.registrations = reg[path.basename(h.path)] || [];
  }

  return {
    generated: new Date().toISOString(),
    hooksDir,
    count: hooks.length,
    hooks: hooks.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function sanitizePath(p) {
  // Replace absolute user paths with a placeholder so generated docs are safe
  // to commit to public repos.
  return String(p || '')
    .replace(/\/home\/[^/]+/, '~')
    .replace(/\/Users\/[^/]+/, '~')
    .replace(/[A-Z]:\\Users\\[^\\]+/i, '~');
}

function renderMarkdown(map, opts = {}) {
  const sanitize = opts.sanitize !== false; // default on
  const out = [];
  out.push(`# Hook Interaction Map`);
  out.push(`Generated ${map.generated}`);
  out.push(`Source: \`${sanitize ? sanitizePath(map.hooksDir) : map.hooksDir}\``);
  out.push(`Total: ${map.count} hooks\n`);

  // Summary: event → hooks
  const byEvent = {};
  for (const h of map.hooks) {
    for (const r of h.registrations) {
      const k = `${r.event}|${r.matcher || '*'}`;
      byEvent[k] = byEvent[k] || [];
      byEvent[k].push({ name: h.name, async: r.async, timeout: r.timeout });
    }
  }
  out.push(`## Registrations\n`);
  for (const k of Object.keys(byEvent).sort()) {
    const list = byEvent[k];
    out.push(`### ${k}`);
    for (const e of list) {
      out.push(`- ${e.name}${e.async ? ' (async)' : ''}${e.timeout ? ` t=${e.timeout}` : ''}`);
    }
    out.push('');
  }

  // Orphans (on disk, no registration)
  const orphans = map.hooks.filter(h => h.registrations.length === 0);
  if (orphans.length > 0) {
    out.push(`## Orphans (on disk, no registration)\n`);
    for (const h of orphans) out.push(`- ${h.name}.js (${h.loc} LOC)`);
    out.push('');
  }

  // Per-hook detail
  out.push(`## Per-hook detail\n`);
  for (const h of map.hooks) {
    out.push(`### ${h.name} (${h.loc} LOC)`);
    if (h.registrations.length > 0) {
      out.push(`**Registered:**`);
      for (const r of h.registrations) {
        out.push(`- \`${r.event}\` matcher=\`${r.matcher || '*'}\`${r.async ? ' (async)' : ''}${r.timeout ? ` timeout=${r.timeout}` : ''}${r.if ? ` if=\`${r.if}\`` : ''}`);
      }
    } else {
      out.push(`**Not registered** — likely standalone CLI or dead`);
    }
    if (h.reads.length > 0) out.push(`**Reads:** ${h.reads.slice(0, 8).join(', ')}${h.reads.length > 8 ? ` (+${h.reads.length - 8})` : ''}`);
    if (h.writes.length > 0) out.push(`**Writes:** ${h.writes.slice(0, 8).join(', ')}${h.writes.length > 8 ? ` (+${h.writes.length - 8})` : ''}`);
    if (h.execs.length > 0) out.push(`**Shell:** ${h.execs.slice(0, 8).join(', ')}${h.execs.length > 8 ? ` (+${h.execs.length - 8})` : ''}`);
    if (h.usesNetwork) out.push(`**Network:** yes`);
    if (h.libDeps.length > 0) out.push(`**Lib deps:** ${h.libDeps.join(', ')}`);
    out.push('');
  }

  return out.join('\n');
}

module.exports = { analyzeHook, findEventRegistrations, buildMap, renderMarkdown };

// CLI usage: node hook-interaction-map.js [hooksDir] [settingsPath] [--json | --md]
if (require.main === module) {
  const args = process.argv.slice(2);
  const fmt = args.includes('--json') ? 'json' : 'md';
  const positional = args.filter(a => !a.startsWith('--'));
  const hooksDir = positional[0] || path.join(os.homedir(), '.claude', 'hooks');
  const settingsPath = positional[1] || path.join(os.homedir(), '.claude', 'settings.json');
  const map = buildMap(hooksDir, settingsPath);
  if (fmt === 'json') {
    process.stdout.write(JSON.stringify(map, null, 2));
  } else {
    process.stdout.write(renderMarkdown(map));
  }
}
