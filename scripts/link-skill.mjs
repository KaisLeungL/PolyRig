#!/usr/bin/env node
// link-skill.mjs — install the /polyrig Claude Code skill by symlinking (or
// copying) skill/claude-code/polyrig into <home>/.claude/skills/polyrig.
//
// Usage:
//   node scripts/link-skill.mjs [--copy] [--force] [--home <dir>]
//
//   --copy   Copy the skill directory recursively instead of symlinking.
//   --force  Replace whatever currently occupies the destination. Without it
//            the script never deletes anything: an existing correct symlink is
//            reported and left alone (exit 0); anything else is refused.
//   --home   Home directory override (for tests). Default: os.homedir().
//
// Idempotent: re-running with an already-correct symlink exits 0.

import {
  existsSync, lstatSync, readlinkSync, realpathSync,
  symlinkSync, mkdirSync, rmSync, cpSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { REPO_ROOT } from './lib/validate.mjs';

function usage(msg) {
  if (msg) console.error(`error: ${msg}`);
  console.error('usage: node scripts/link-skill.mjs [--copy] [--force] [--home <dir>]');
  process.exit(msg ? 1 : 0);
}

const args = process.argv.slice(2);
let copy = false;
let force = false;
let home = homedir();

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--help' || a === '-h') usage();
  else if (a === '--copy') copy = true;
  else if (a === '--force') force = true;
  else if (a === '--home') {
    home = args[++i];
    if (!home) usage('--home requires a directory');
  } else usage(`unknown argument '${a}'`);
}

const src = join(REPO_ROOT, 'skill', 'claude-code', 'polyrig');
const dest = join(resolve(home), '.claude', 'skills', 'polyrig');

if (!existsSync(src)) {
  console.error(`link-skill: skill source directory is missing: ${src}`);
  process.exit(1);
}

function destStatus() {
  let st;
  try { st = lstatSync(dest); } catch { return 'absent'; }
  if (st.isSymbolicLink()) {
    try {
      if (realpathSync(dest) === realpathSync(src)) return 'correct-symlink';
    } catch { /* dangling symlink */ }
    return 'other-symlink';
  }
  return st.isDirectory() ? 'directory' : 'file';
}

const status = destStatus();

if (status === 'correct-symlink' && !copy) {
  console.log(`already installed: ${dest} -> ${realpathSync(dest)} (nothing to do)`);
  process.exit(0);
}

if (status !== 'absent') {
  if (!force) {
    const detail = status === 'correct-symlink'
      ? 'a symlink to the skill (but --copy was requested)'
      : status === 'other-symlink'
        ? `a symlink to somewhere else (${(() => { try { return readlinkSync(dest); } catch { return '?'; } })()})`
        : `an existing ${status}`;
    console.error(`link-skill: destination ${dest} is ${detail}.`);
    console.error('link-skill: refusing to touch it; re-run with --force to replace it.');
    process.exit(1);
  }
  rmSync(dest, { recursive: true, force: true });
  console.log(`removed existing ${status} at ${dest} (--force)`);
}

mkdirSync(dirname(dest), { recursive: true });

if (copy) {
  cpSync(src, dest, { recursive: true });
  console.log(`copied skill: ${src} -> ${dest}`);
} else {
  symlinkSync(src, dest, 'dir');
  console.log(`linked skill: ${dest} -> ${src}`);
}
console.log('done. The /polyrig skill is installed.');
