#!/usr/bin/env node
// Smoke tests for the PolyRig skill installer. Keep this zero-dependency so it
// can run anywhere the rest of the PolyRig tooling runs.

import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  realpathSync,
  readFileSync,
  lstatSync,
  rmSync,
  existsSync,
  mkdirSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO_ROOT } from './lib/validate.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertSymlink(dest, expectedTarget) {
  const st = lstatSync(dest);
  assert(st.isSymbolicLink(), `${dest} should be a symlink`);
  assert(realpathSync(dest) === realpathSync(expectedTarget), `${dest} should point to ${expectedTarget}`);
}

function assertIncludes(file, expected, label) {
  const content = readFileSync(file, 'utf8');
  assert(content.includes(expected), `${label} should mention ${expected}`);
}

const home = mkdtempSync(join(tmpdir(), 'polyrig-link-skill-'));
try {
  const legacyDest = join(home, '.claude', 'skills', 'polyrig');
  mkdirSync(join(home, '.claude', 'skills'), { recursive: true });
  symlinkSync(join(REPO_ROOT, 'skill', 'claude-code', 'polyrig'), legacyDest, 'dir');

  execFileSync(process.execPath, ['scripts/link-skill.mjs', '--platform', 'all', '--home', home], {
    cwd: REPO_ROOT,
    stdio: 'pipe',
  });

  const skills = [
    { name: 'polyrig', path: join(REPO_ROOT, 'skill', 'polyrig') },
    { name: 'polyrig-pack-author', path: join(REPO_ROOT, 'skill', 'polyrig-pack-author') },
  ];
  for (const skill of skills) {
    assertSymlink(join(home, '.claude', 'skills', skill.name), skill.path);
    assertSymlink(join(home, '.codex', 'skills', skill.name), skill.path);
  }

  const cursorRule = join(home, '.cursor', 'rules', 'polyrig.mdc');
  assert(existsSync(cursorRule), 'Cursor rule should be installed');
  assertIncludes(cursorRule, 'skill/polyrig/SKILL.md', 'Cursor rule');
  assertIncludes(cursorRule, 'skill/polyrig-pack-author/SKILL.md', 'Cursor rule');

  const geminiContext = join(home, '.gemini', 'GEMINI.md');
  assert(existsSync(geminiContext), 'Gemini context should be installed');
  assertIncludes(geminiContext, 'BEGIN POLYRIG MANAGED BLOCK', 'Gemini context');
  assertIncludes(geminiContext, 'skill/polyrig/SKILL.md', 'Gemini context');
  assertIncludes(geminiContext, 'skill/polyrig-pack-author/SKILL.md', 'Gemini context');

  const opencodeContext = join(home, '.config', 'opencode', 'AGENTS.md');
  assert(existsSync(opencodeContext), 'OpenCode context should be installed');
  assertIncludes(opencodeContext, 'BEGIN POLYRIG MANAGED BLOCK', 'OpenCode context');
  assertIncludes(opencodeContext, 'skill/polyrig/SKILL.md', 'OpenCode context');
  assertIncludes(opencodeContext, 'skill/polyrig-pack-author/SKILL.md', 'OpenCode context');

  execFileSync(process.execPath, ['scripts/link-skill.mjs', '--platform', 'all', '--home', home], {
    cwd: REPO_ROOT,
    stdio: 'pipe',
  });
} finally {
  rmSync(home, { recursive: true, force: true });
}

console.log('test-link-skill: PASS');
