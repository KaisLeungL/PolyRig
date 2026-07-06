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
  cpSync,
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
    { name: 'polyrig-pack-install', path: join(REPO_ROOT, 'skill', 'polyrig-pack-install') },
  ];
  for (const skill of skills) {
    assertSymlink(join(home, '.claude', 'skills', skill.name), skill.path);
    assertSymlink(join(home, '.codex', 'skills', skill.name), skill.path);
  }

  const cursorRule = join(home, '.cursor', 'rules', 'polyrig.mdc');
  assert(existsSync(cursorRule), 'Cursor rule should be installed');
  assertIncludes(cursorRule, 'skill/polyrig/SKILL.md', 'Cursor rule');
  assertIncludes(cursorRule, 'skill/polyrig-pack-author/SKILL.md', 'Cursor rule');
  assertIncludes(cursorRule, 'skill/polyrig-pack-install/SKILL.md', 'Cursor rule');

  const geminiContext = join(home, '.gemini', 'GEMINI.md');
  assert(existsSync(geminiContext), 'Gemini context should be installed');
  assertIncludes(geminiContext, 'BEGIN POLYRIG MANAGED BLOCK', 'Gemini context');
  assertIncludes(geminiContext, 'skill/polyrig/SKILL.md', 'Gemini context');
  assertIncludes(geminiContext, 'skill/polyrig-pack-author/SKILL.md', 'Gemini context');
  assertIncludes(geminiContext, 'skill/polyrig-pack-install/SKILL.md', 'Gemini context');

  const opencodeContext = join(home, '.config', 'opencode', 'AGENTS.md');
  assert(existsSync(opencodeContext), 'OpenCode context should be installed');
  assertIncludes(opencodeContext, 'BEGIN POLYRIG MANAGED BLOCK', 'OpenCode context');
  assertIncludes(opencodeContext, 'skill/polyrig/SKILL.md', 'OpenCode context');
  assertIncludes(opencodeContext, 'skill/polyrig-pack-author/SKILL.md', 'OpenCode context');
  assertIncludes(opencodeContext, 'skill/polyrig-pack-install/SKILL.md', 'OpenCode context');

  execFileSync(process.execPath, ['scripts/link-skill.mjs', '--platform', 'all', '--home', home], {
    cwd: REPO_ROOT,
    stdio: 'pipe',
  });
} finally {
  rmSync(home, { recursive: true, force: true });
}

// --- npm-tarball mode: no .git → stage runtime into ~/.polyrig/runtime -------
// Build a package dir that mirrors what `npm pack` ships (the files allowlist),
// with no .git, and confirm the installer stages a runtime dir and symlinks the
// native skills to it rather than to the source package.
{
  const home2 = mkdtempSync(join(tmpdir(), 'polyrig-npm-home-'));
  const pkg = mkdtempSync(join(tmpdir(), 'polyrig-npm-pkg-'));
  try {
    for (const res of ['scripts', 'packs', 'schemas', 'skill', 'docs', 'SPEC.md']) {
      cpSync(join(REPO_ROOT, res), join(pkg, res), { recursive: true });
    }
    assert(!existsSync(join(pkg, '.git')), 'staged package must not contain a .git');

    execFileSync(process.execPath, [join(pkg, 'scripts', 'link-skill.mjs'), 'install', '--platform', 'claude-code', '--home', home2], {
      cwd: pkg,
      stdio: 'pipe',
    });

    const runtime = join(home2, '.polyrig', 'runtime');
    assert(existsSync(join(runtime, 'scripts', 'build-pack-index.mjs')), 'runtime should contain scripts');
    assert(existsSync(join(runtime, 'packs')), 'runtime should contain packs');
    assert(existsSync(join(runtime, 'schemas')), 'runtime should contain schemas');

    for (const name of ['polyrig', 'polyrig-pack-author', 'polyrig-pack-install']) {
      const dest = join(home2, '.claude', 'skills', name);
      assertSymlink(dest, join(runtime, 'skill', name));
      // POLYRIG_ROOT walk (../..) from the symlink target must reach the runtime.
      const rootFromWalk = join(realpathSync(dest), '..', '..');
      assert(existsSync(join(rootFromWalk, 'scripts', 'build-pack-index.mjs')),
        `POLYRIG_ROOT walk from ${name} should reach runtime scripts`);
    }
  } finally {
    rmSync(home2, { recursive: true, force: true });
    rmSync(pkg, { recursive: true, force: true });
  }
}

console.log('test-link-skill: PASS');
