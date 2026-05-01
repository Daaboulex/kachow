#!/usr/bin/env node
require(__dirname + "/lib/emit-simple-timing.js").start(__filename);
// SessionStart hook: sync memory files between .claude/memory/ and .gemini/memory/
// For projects without symlinks (copied between Windows/Linux), both directories
// must contain the same files. This merges newer files in both directions.
// Cross-platform (Linux, macOS, Windows)

const fs = require('fs');
const path = require('path');

const projectDir = process.cwd();
const claudeMemory = path.join(projectDir, '.claude', 'memory');
const geminiMemory = path.join(projectDir, '.gemini', 'memory');

function syncDirs(src, dest) {
  if (!fs.existsSync(src) || !fs.existsSync(dest)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcFile = path.join(src, entry.name);
    const destFile = path.join(dest, entry.name);
    try {
      if (entry.isDirectory()) {
        // Recurse into subdirectories
        fs.mkdirSync(destFile, { recursive: true });
        count += syncDirs(srcFile, destFile);
      } else if (entry.isFile()) {
        if (!fs.existsSync(destFile)) {
          fs.copyFileSync(srcFile, destFile);
          count++;
        } else {
          const srcMtime = fs.statSync(srcFile).mtimeMs;
          const destMtime = fs.statSync(destFile).mtimeMs;
          if (srcMtime > destMtime) {
            fs.copyFileSync(srcFile, destFile);
            count++;
          }
        }
      }
    } catch {}
  }
  return count;
}

try {
  if (!fs.existsSync(claudeMemory) || !fs.existsSync(geminiMemory)) {
    process.stdout.write('{"continue":true}');
    process.exit(0);
  }

  // Skip if both dirs resolve to same path (symlinks to same target = no-op)
  try {
    if (fs.realpathSync(claudeMemory) === fs.realpathSync(geminiMemory)) {
      process.stdout.write('{"continue":true}');
      process.exit(0);
    }
  } catch {}

  // Bidirectional sync — newer file wins
  const toGemini = syncDirs(claudeMemory, geminiMemory);
  const toClaude = syncDirs(geminiMemory, claudeMemory);

  if (toGemini > 0 || toClaude > 0) {
    process.stdout.write(JSON.stringify({
      systemMessage: `Memory sync: ${toGemini} files → .gemini/memory/, ${toClaude} files → .claude/memory/`,
      continue: true
    }));
  } else {
    process.stdout.write('{"continue":true}');
  }
} catch {
  process.stdout.write('{"continue":true}');
}
