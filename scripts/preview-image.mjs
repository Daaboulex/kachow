#!/usr/bin/env node
// preview-image.mjs — render image in terminal via chafa.
// Cross-platform: replaces preview-image.sh + preview-image.ps1 (single source of truth).
// Usage: node preview-image.mjs <path> [width] [height]
// Env: CLAUDE_PREVIEW_WIDTH, CLAUDE_PREVIEW_HEIGHT, COLUMNS

import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { platform } from 'node:os';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('usage: preview-image.mjs <image-path> [width] [height]');
  process.exit(2);
}

const imgPath = args[0];
const width = parseInt(args[1] ?? process.env.CLAUDE_PREVIEW_WIDTH ?? process.env.COLUMNS ?? '80', 10);
const height = parseInt(args[2] ?? process.env.CLAUDE_PREVIEW_HEIGHT ?? '24', 10);

if (!existsSync(imgPath) || !statSync(imgPath).isFile()) {
  console.error(`preview-image: file not found: ${imgPath}`);
  process.exit(1);
}

function tryRun(cmd, cmdArgs) {
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit' });
  return r.status;
}

function which(cmd) {
  const probeCmd = platform() === 'win32' ? 'where' : 'sh';
  const probeArgs = platform() === 'win32' ? [cmd] : ['-c', `command -v ${cmd}`];
  const r = spawnSync(probeCmd, probeArgs, { stdio: 'pipe' });
  return r.status === 0;
}

const chafaArgs = [`--size=${width}x${height}`, '--symbols=all', '--colors=full', resolve(imgPath)];

if (which('chafa')) {
  process.exit(tryRun('chafa', chafaArgs) ?? 1);
}

// Windows fallback: try WSL
if (platform() === 'win32' && which('wsl')) {
  const probe = spawnSync('wsl', ['--', 'command', '-v', 'chafa'], { stdio: 'pipe' });
  if (probe.status === 0) {
    const pathConv = spawnSync('wsl', ['wslpath', '-a', imgPath], { stdio: 'pipe' });
    if (pathConv.status === 0) {
      const wslPath = pathConv.stdout.toString().trim();
      const wslArgs = ['chafa', `--size=${width}x${height}`, '--symbols=all', '--colors=full', wslPath];
      process.exit(tryRun('wsl', wslArgs) ?? 1);
    }
  }
}

console.error(`chafa not installed. Install options:
  NixOS:        nix profile install nixpkgs#chafa
  Debian/Ubuntu: sudo apt install chafa
  Fedora:        sudo dnf install chafa
  Arch:          sudo pacman -S chafa
  macOS:         brew install chafa
  Windows:       scoop install chafa  (or use WSL)
  docs:          https://hpjansson.org/chafa/`);
process.exit(1);
