#!/usr/bin/env node
// One-time migration: convert real project memory dirs to centralized
// project-state with symlinks. Safe to re-run (idempotent).
// NEVER deletes memory files — only moves and symlinks.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOME = os.homedir();
const AI_CONTEXT = path.join(HOME, '.ai-context');
const PROJECT_STATE = path.join(AI_CONTEXT, 'project-state');

const stats = { migrated: 0, skipped_empty: 0, skipped_symlink: 0, merged: 0, errors: [] };

function deriveProjectName(sanitizedDir) {
  // -home-user-[project-dir]-repos-portmaster-nix → portmaster-nix
  // home-user-[project-dir] → [project]
  const parts = sanitizedDir.replace(/^-/, '').split('-');
  // Find the last meaningful segment (after Documents or known prefixes)
  const docsIdx = parts.indexOf('Documents');
  if (docsIdx >= 0 && docsIdx < parts.length - 1) {
    return parts.slice(docsIdx + 1).join('-');
  }
  // Fallback: last 2 segments
  return parts.slice(-2).join('-');
}

function migrateDir(memoryDir, toolName) {
  const projectSlug = path.basename(path.dirname(memoryDir));

  // Skip if already a symlink
  try {
    if (fs.lstatSync(memoryDir).isSymbolicLink()) {
      stats.skipped_symlink++;
      return;
    }
  } catch { return; }

  // Count real memory files (not MEMORY.md)
  let mdFiles;
  try {
    mdFiles = fs.readdirSync(memoryDir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md');
  } catch { return; }

  if (mdFiles.length === 0) {
    stats.skipped_empty++;
    return;
  }

  const projectName = deriveProjectName(projectSlug);
  const targetDir = path.join(PROJECT_STATE, projectName, 'memory');

  console.log(`  Migrating: ${toolName}/projects/${projectSlug}/memory/ (${mdFiles.length} files) → project-state/${projectName}/memory/`);

  try {
    fs.mkdirSync(targetDir, { recursive: true });

    // Move or merge files (handles subdirs like episodic/)
    let newFiles = 0;
    let dupes = 0;
    for (const file of fs.readdirSync(memoryDir)) {
      const src = path.join(memoryDir, file);
      const dst = path.join(targetDir, file);
      const srcStat = fs.statSync(src);

      if (srcStat.isDirectory()) {
        fs.cpSync(src, dst, { recursive: true, force: false, errorOnExist: false });
        newFiles++;
        continue;
      }

      if (fs.existsSync(dst)) {
        const srcSize = srcStat.size;
        const dstSize = fs.statSync(dst).size;
        if (srcSize > dstSize) {
          fs.copyFileSync(src, dst);
          console.log(`    Conflict: ${file} — kept larger (${srcSize} > ${dstSize})`);
        }
        dupes++;
      } else {
        fs.copyFileSync(src, dst);
        newFiles++;
      }
    }

    // Ensure MEMORY.md exists in target
    const targetMemoryMd = path.join(targetDir, 'MEMORY.md');
    if (!fs.existsSync(targetMemoryMd)) {
      const header = `# Memory Index — ${projectName}\n\n_Migrated from ${toolName}/projects/${projectSlug}_\n\n`;
      const entries = mdFiles.map(f => `- [${f}](${f})`).join('\n');
      fs.writeFileSync(targetMemoryMd, header + entries + '\n');
    }

    // Replace real dir with symlink
    // First verify target has all files
    const targetCount = fs.readdirSync(targetDir).filter(f => f.endsWith('.md')).length;
    const sourceCount = fs.readdirSync(memoryDir).filter(f => f.endsWith('.md')).length;

    if (targetCount >= sourceCount) {
      // Safe to replace
      fs.rmSync(memoryDir, { recursive: true });
      fs.symlinkSync(targetDir, memoryDir);
      stats.migrated++;
      if (dupes > 0) stats.merged++;
      console.log(`    → Symlinked (${newFiles} new, ${dupes} merged)`);
    } else {
      stats.errors.push(`${projectSlug}: target has fewer files (${targetCount} < ${sourceCount})`);
      console.log(`    ✗ ABORTED: target has fewer files`);
    }
  } catch (e) {
    stats.errors.push(`${projectSlug}: ${e.message}`);
    console.log(`    ✗ ERROR: ${e.message}`);
  }
}

console.log('=== Project Memory Migration ===\n');

// Scan Claude projects
console.log('Claude projects:');
const claudeProjects = path.join(HOME, '.claude', 'projects');
if (fs.existsSync(claudeProjects)) {
  for (const dir of fs.readdirSync(claudeProjects)) {
    const memDir = path.join(claudeProjects, dir, 'memory');
    if (fs.existsSync(memDir)) {
      migrateDir(memDir, 'claude');
    }
  }
}

// Scan Gemini projects
console.log('\nGemini projects:');
const geminiProjects = path.join(HOME, '.gemini', 'projects');
if (fs.existsSync(geminiProjects)) {
  for (const dir of fs.readdirSync(geminiProjects)) {
    const memDir = path.join(geminiProjects, dir, 'memory');
    if (fs.existsSync(memDir)) {
      migrateDir(memDir, 'gemini');
    }
  }
}

console.log(`\n=== Results ===`);
console.log(`Migrated: ${stats.migrated}`);
console.log(`Merged into existing: ${stats.merged}`);
console.log(`Skipped (empty): ${stats.skipped_empty}`);
console.log(`Skipped (already symlinked): ${stats.skipped_symlink}`);
if (stats.errors.length > 0) {
  console.log(`Errors: ${stats.errors.length}`);
  for (const e of stats.errors) console.log(`  ✗ ${e}`);
  process.exit(1);
}
console.log('Done.');
