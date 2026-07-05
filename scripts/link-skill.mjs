#!/usr/bin/env node
// link-skill.mjs — install PolyRig skills for supported agent platforms.
//
// Two install modes, auto-detected from where this script runs:
//
//   * git checkout (a `.git` is present next to the script's package root):
//     developer mode. Native skill platforms are symlinked straight to
//     `<repo>/skill/<name>` so `git pull` edits take effect live.
//
//   * npm / npx (no `.git`, e.g. `npx polyrig install`): the package tarball is
//     staged into a stable runtime dir (`~/.polyrig/runtime`) — immune to npx
//     cache eviction and separate from user packs in `~/.polyrig/packs` — and
//     native skills are symlinked to `~/.polyrig/runtime/skill/<name>`. The
//     skill resolves POLYRIG_ROOT to that runtime dir.
//
// Platforms without a native skill folder (Cursor, Gemini CLI, OpenCode) get a
// small managed pointer/context file referencing the resolved install root.
//
// Usage:
//   polyrig [install] [--platform <name|all>] [--copy] [--force] [--home <dir>]
//   node scripts/link-skill.mjs [install] [--platform ...] [--copy] [--force] [--home <dir>]
//
//   install     Optional leading verb; installing is the default action.
//   --platform  One of: all, claude-code, codex, cursor, gemini-cli, opencode.
//               May be repeated or comma-separated. Default: all.
//   --copy      Copy native skill directories instead of symlinking them.
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
// Resources the installed skills read at runtime via $POLYRIG_ROOT.
const RUNTIME_RESOURCES = ['scripts', 'packs', 'schemas', 'skill', 'docs', 'SPEC.md'];

function usage(msg) {
  if (msg) console.error(`error: ${msg}`);
  console.error('usage: polyrig [install] [--platform <name|all>] [--copy] [--force] [--home <dir>]');
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
  else if (a === 'install' || a === 'link') continue; // optional leading verb
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

// SOURCE_ROOT is where this script's package lives — a git checkout or an npx
// cache dir. INSTALL_ROOT is where the skills resolve POLYRIG_ROOT: the repo
// itself in dev mode, or the staged runtime dir in npm mode.
const SOURCE_ROOT = REPO_ROOT;
const isGitCheckout = existsSync(join(SOURCE_ROOT, '.git'));
const runtimeDir = join(homeDir, '.polyrig', 'runtime');
const INSTALL_ROOT = isGitCheckout ? SOURCE_ROOT : runtimeDir;

function stageRuntime() {
  for (const name of RUNTIME_RESOURCES) {
    const src = join(SOURCE_ROOT, name);
    if (!existsSync(src)) {
      console.error(`link-skill: cannot stage runtime — missing ${src}`);
      process.exit(1);
    }
  }
  mkdirSync(dirname(runtimeDir), { recursive: true });
  rmSync(runtimeDir, { recursive: true, force: true });
  mkdirSync(runtimeDir, { recursive: true });
  for (const name of RUNTIME_RESOURCES) {
    cpSync(join(SOURCE_ROOT, name), join(runtimeDir, name), { recursive: true });
  }
  console.log(`staged runtime: ${SOURCE_ROOT} -> ${runtimeDir}`);
}

if (!isGitCheckout) stageRuntime();

const SKILLS = [
  { name: 'polyrig', path: join(INSTALL_ROOT, 'skill', 'polyrig') },
  { name: 'polyrig-pack-author', path: join(INSTALL_ROOT, 'skill', 'polyrig-pack-author') },
];
const legacyClaudeSrc = join(INSTALL_ROOT, 'skill', 'claude-code', 'polyrig');

for (const skill of SKILLS) {
  if (!existsSync(skill.path)) {
    console.error(`link-skill: skill source directory is missing: ${skill.path}`);
    process.exit(1);
  }
}

function destStatus(dest, skill) {
  let st;
  try { st = lstatSync(dest); } catch { return 'absent'; }
  if (st.isSymbolicLink()) {
    try {
      if (realpathSync(dest) === realpathSync(skill.path)) return 'correct-symlink';
    } catch { /* dangling symlink */ }
    try {
      if (skill.name === 'polyrig' && resolve(dirname(dest), readlinkSync(dest)) === legacyClaudeSrc) return 'legacy-symlink';
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

function installNativeSkill(platform, skill, dest) {
  const status = destStatus(dest, skill);

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
    cpSync(skill.path, dest, { recursive: true });
    console.log(`${platform}: copied skill: ${skill.path} -> ${dest}`);
  } else {
    symlinkSync(skill.path, dest, 'dir');
    console.log(`${platform}: linked skill: ${dest} -> ${skill.path}`);
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
    `1. Read and follow the PolyRig skill at \`${join(SKILLS[0].path, 'SKILL.md')}\`.`,
    `2. Treat \`${INSTALL_ROOT}\` as POLYRIG_ROOT for all PolyRig script calls.`,
    '3. Do not improvise stack or domain knowledge; use the packs discovered by PolyRig.',
    '',
    'When the user wants to create, update, review, or validate a PolyRig pack:',
    `1. Read and follow the PolyRig pack authoring skill at \`${join(SKILLS[1].path, 'SKILL.md')}\`.`,
    '2. Keep pack authoring separate from `/polyrig` project initialization.',
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
    for (const skill of SKILLS) installNativeSkill(platform, skill, join(homeDir, '.claude', 'skills', skill.name));
  } else if (platform === 'codex') {
    for (const skill of SKILLS) installNativeSkill(platform, skill, join(homeDir, '.codex', 'skills', skill.name));
  } else if (platform === 'cursor') {
    writeDedicatedFile(platform, join(homeDir, '.cursor', 'rules', 'polyrig.mdc'), cursorRule());
  } else if (platform === 'gemini-cli') {
    upsertManagedBlock(platform, join(homeDir, '.gemini', 'GEMINI.md'), pointerText('Gemini CLI'));
  } else if (platform === 'opencode') {
    upsertManagedBlock(platform, join(homeDir, '.config', 'opencode', 'AGENTS.md'), pointerText('OpenCode'));
  }
}

console.log(`done. PolyRig skills are installed for: ${platforms.join(', ')}.`);
console.log(`POLYRIG_ROOT: ${INSTALL_ROOT}`);
