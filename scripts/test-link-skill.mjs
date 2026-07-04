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

const home = mkdtempSync(join(tmpdir(), 'polyrig-link-skill-'));
try {
  const legacyDest = join(home, '.claude', 'skills', 'polyrig');
  mkdirSync(join(home, '.claude', 'skills'), { recursive: true });
  symlinkSync(join(REPO_ROOT, 'skill', 'claude-code', 'polyrig'), legacyDest, 'dir');

  execFileSync(process.execPath, ['scripts/link-skill.mjs', '--platform', 'all', '--home', home], {
    cwd: REPO_ROOT,
    stdio: 'pipe',
  });

  const skillSrc = join(REPO_ROOT, 'skill', 'polyrig');
  assertSymlink(join(home, '.claude', 'skills', 'polyrig'), skillSrc);
  assertSymlink(join(home, '.codex', 'skills', 'polyrig'), skillSrc);

  const cursorRule = join(home, '.cursor', 'rules', 'polyrig.mdc');
  assert(existsSync(cursorRule), 'Cursor rule should be installed');
  assert(readFileSync(cursorRule, 'utf8').includes('skill/polyrig/SKILL.md'), 'Cursor rule should point at canonical skill');

  const geminiContext = join(home, '.gemini', 'GEMINI.md');
  assert(existsSync(geminiContext), 'Gemini context should be installed');
  assert(readFileSync(geminiContext, 'utf8').includes('BEGIN POLYRIG MANAGED BLOCK'), 'Gemini context should include managed block');

  const opencodeContext = join(home, '.config', 'opencode', 'AGENTS.md');
  assert(existsSync(opencodeContext), 'OpenCode context should be installed');
  assert(readFileSync(opencodeContext, 'utf8').includes('BEGIN POLYRIG MANAGED BLOCK'), 'OpenCode context should include managed block');

  execFileSync(process.execPath, ['scripts/link-skill.mjs', '--platform', 'all', '--home', home], {
    cwd: REPO_ROOT,
    stdio: 'pipe',
  });
} finally {
  rmSync(home, { recursive: true, force: true });
}

console.log('test-link-skill: PASS');
