#!/usr/bin/env node
// link-skill.mjs — install the /polyrig skill for supported agent platforms.
// Native skill platforms get a symlink (or copy) to skill/polyrig. Platforms
// without a native skill folder get a small managed pointer/context file.
//
// Usage:
//   node scripts/link-skill.mjs [--platform <name|all>] [--copy] [--force] [--home <dir>]
//
//   --platform  One of: all, claude-code, codex, cursor, gemini-cli, opencode.
//               May be repeated or comma-separated. Default: all.
//   --copy      Copy native skill directories instead of symlinking.
//   --force     Replace conflicting native destinations or dedicated pointer files.
//   --home      Home directory override (for tests). Default: os.homedir().
//
// Idempotent: re-running with an already-correct symlink exits 0.

import {
  existsSync, lstatSync, readlinkSync, realpathSync,
  symlinkSync, mkdirSync, rmSync, cpSync, readFileSync, writeFileSync, unlinkSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { REPO_ROOT } from './lib/validate.mjs';

const PLATFORM_NAMES = ['claude-code', 'codex', 'cursor', 'gemini-cli', 'opencode'];
const MANAGED_BEGIN = '<!-- BEGIN POLYRIG MANAGED BLOCK -->';
const MANAGED_END = '<!-- END POLYRIG MANAGED BLOCK -->';

function usage(msg) {
  if (msg) console.error(`error: ${msg}`);
  console.error('usage: node scripts/link-skill.mjs [--platform <name|all>] [--copy] [--force] [--home <dir>]');
  console.error(`platforms: all, ${PLATFORM_NAMES.join(', ')}`);
  process.exit(msg ? 1 : 0);
}

const args = process.argv.slice(2);
let copy = false;
let force = false;
let home = homedir();
let requestedPlatforms = [];

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--help' || a === '-h') usage();
  else if (a === '--copy') copy = true;
  else if (a === '--force') force = true;
  else if (a === '--platform') {
    const value = args[++i];
    if (!value) usage('--platform requires a value');
    requestedPlatforms.push(...value.split(',').map((v) => v.trim()).filter(Boolean));
  }
  else if (a === '--home') {
    home = args[++i];
    if (!home) usage('--home requires a directory');
  } else usage(`unknown argument '${a}'`);
}

if (requestedPlatforms.length === 0 || requestedPlatforms.includes('all')) {
  requestedPlatforms = PLATFORM_NAMES;
}

const unknownPlatforms = requestedPlatforms.filter((p) => !PLATFORM_NAMES.includes(p));
if (unknownPlatforms.length > 0) usage(`unknown platform(s): ${unknownPlatforms.join(', ')}`);

const platforms = [...new Set(requestedPlatforms)];
const homeDir = resolve(home);
const src = join(REPO_ROOT, 'skill', 'polyrig');
const skillMd = join(src, 'SKILL.md');
const legacyClaudeSrc = join(REPO_ROOT, 'skill', 'claude-code', 'polyrig');

if (!existsSync(src)) {
  console.error(`link-skill: skill source directory is missing: ${src}`);
  process.exit(1);
}

function destStatus(dest) {
  let st;
  try { st = lstatSync(dest); } catch { return 'absent'; }
  if (st.isSymbolicLink()) {
    try {
      if (realpathSync(dest) === realpathSync(src)) return 'correct-symlink';
    } catch { /* dangling symlink */ }
    try {
      if (resolve(dirname(dest), readlinkSync(dest)) === legacyClaudeSrc) return 'legacy-symlink';
    } catch { /* unreadable symlink */ }
    return 'other-symlink';
  }
  return st.isDirectory() ? 'directory' : 'file';
}

function removeDest(dest, status) {
  if (status === 'correct-symlink' || status === 'legacy-symlink' || status === 'other-symlink') {
    unlinkSync(dest);
  } else {
    rmSync(dest, { recursive: true, force: true });
  }
}

function installNativeSkill(platform, dest) {
  const status = destStatus(dest);

  if (status === 'correct-symlink' && !copy) {
    console.log(`${platform}: already installed: ${dest} -> ${realpathSync(dest)} (nothing to do)`);
    return;
  }

  if (status !== 'absent') {
    if (!force) {
      if (status === 'legacy-symlink') {
        removeDest(dest, status);
        console.log(`${platform}: removed legacy symlink at ${dest}`);
      } else {
        const detail = status === 'correct-symlink'
          ? 'a symlink to the skill (but --copy was requested)'
          : status === 'other-symlink'
            ? `a symlink to somewhere else (${(() => { try { return readlinkSync(dest); } catch { return '?'; } })()})`
            : `an existing ${status}`;
        console.error(`link-skill: ${platform} destination ${dest} is ${detail}.`);
        console.error('link-skill: refusing to touch it; re-run with --force to replace it.');
        process.exit(1);
      }
    } else {
      removeDest(dest, status);
      console.log(`${platform}: removed existing ${status} at ${dest} (--force)`);
    }
  }

  mkdirSync(dirname(dest), { recursive: true });

  if (copy) {
    cpSync(src, dest, { recursive: true });
    console.log(`${platform}: copied skill: ${src} -> ${dest}`);
  } else {
    symlinkSync(src, dest, 'dir');
    console.log(`${platform}: linked skill: ${dest} -> ${src}`);
  }
}

function writeDedicatedFile(platform, dest, content) {
  if (existsSync(dest)) {
    const existing = readFileSync(dest, 'utf8');
    if (existing === content) {
      console.log(`${platform}: already installed: ${dest} (nothing to do)`);
      return;
    }
    if (!force) {
      console.error(`link-skill: ${platform} destination ${dest} already exists.`);
      console.error('link-skill: refusing to replace it; re-run with --force to replace it.');
      process.exit(1);
    }
  }
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, content);
  console.log(`${platform}: wrote pointer: ${dest}`);
}

function upsertManagedBlock(platform, dest, block) {
  const wrapped = `${MANAGED_BEGIN}\n${block.trim()}\n${MANAGED_END}`;
  let next = wrapped;
  if (existsSync(dest)) {
    const existing = readFileSync(dest, 'utf8');
    const start = existing.indexOf(MANAGED_BEGIN);
    const end = existing.indexOf(MANAGED_END);
    if (start >= 0 && end >= start) {
      const afterEnd = end + MANAGED_END.length;
      next = `${existing.slice(0, start)}${wrapped}${existing.slice(afterEnd)}`;
    } else {
      const separator = existing.endsWith('\n') ? '\n' : '\n\n';
      next = `${existing}${separator}${wrapped}\n`;
    }
    if (next === existing) {
      console.log(`${platform}: already installed: ${dest} (nothing to do)`);
      return;
    }
  }
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, next);
  console.log(`${platform}: wrote managed context: ${dest}`);
}

function pointerText(platform) {
  return [
    `## PolyRig (${platform})`,
    '',
    'When the user types `/polyrig`, mentions PolyRig, wants to cold-start an agent-ready project, or asks to assemble project context for AI coding agents:',
    `1. Read and follow the PolyRig skill at \`${skillMd}\`.`,
    `2. Treat \`${REPO_ROOT}\` as POLYRIG_ROOT for all PolyRig script calls.`,
    '3. Do not improvise stack or domain knowledge; use the packs discovered by PolyRig.',
    '',
  ].join('\n');
}

function cursorRule() {
  return [
    '---',
    'description: Initialize an agent-ready repository with PolyRig',
    'alwaysApply: false',
    '---',
    '',
    pointerText('Cursor'),
  ].join('\n');
}

for (const platform of platforms) {
  if (platform === 'claude-code') {
    installNativeSkill(platform, join(homeDir, '.claude', 'skills', 'polyrig'));
  } else if (platform === 'codex') {
    installNativeSkill(platform, join(homeDir, '.codex', 'skills', 'polyrig'));
  } else if (platform === 'cursor') {
    writeDedicatedFile(platform, join(homeDir, '.cursor', 'rules', 'polyrig.mdc'), cursorRule());
  } else if (platform === 'gemini-cli') {
    upsertManagedBlock(platform, join(homeDir, '.gemini', 'GEMINI.md'), pointerText('Gemini CLI'));
  } else if (platform === 'opencode') {
    upsertManagedBlock(platform, join(homeDir, '.config', 'opencode', 'AGENTS.md'), pointerText('OpenCode'));
  }
}

console.log(`done. The /polyrig skill is installed for: ${platforms.join(', ')}.`);
