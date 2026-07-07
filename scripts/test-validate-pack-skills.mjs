#!/usr/bin/env node
// Smoke tests for pack skills/ structure validation: a pack MAY opt-in to carry
// skills/<name>/SKILL.md; validate-pack.mjs checks STRUCTURE only (each skill has
// a SKILL.md whose frontmatter name equals the directory name plus a non-empty
// description). It never inspects skill content or safety.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO_ROOT } from './lib/validate.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// Writes a minimal valid pack, then applies `skills` (a map of relative path ->
// file contents, or null to leave skills/ absent). A dir is materialized for any
// path ending in '/'.
function writePack(root, name, skills = null) {
  const dir = join(root, 'stack', name);
  mkdirSync(join(dir, 'knowledge'), { recursive: true });
  mkdirSync(join(dir, 'references'), { recursive: true });

  writeFileSync(join(dir, 'pack.yaml'), [
    `id: stack/${name}`,
    'type: stack',
    'version: 0.1.0',
    'last_reviewed: 2026-07-04',
    'summary: Skills structure test pack',
    'requires: []',
    'conflicts: []',
    'provides: []',
    'stacks: []',
    '',
  ].join('\n'));
  writeFileSync(join(dir, 'knowledge', 'overview.md'),
    '# Overview\nTeams record lookups before release. [Evidence: E001]\n');
  writeFileSync(join(dir, 'verify.md'),
    '# Verify\nRun the build before claiming ready. [Evidence: E001]\n');
  writeFileSync(join(dir, 'references', 'sources.md'), [
    '# Sources', '', '## Evidence Matrix', '',
    '| id | claim | status | source_type | urls | applies_to | volatility | notes |',
    '|---|---|---|---|---|---|---|---|',
    '| E001 | Fixture claim. | source-backed | official | https://example.com/x | knowledge/overview.md; verify.md | low | Stable. |',
    '',
  ].join('\n'));

  if (skills) {
    for (const [rel, content] of Object.entries(skills)) {
      if (rel.endsWith('/')) {
        mkdirSync(join(dir, rel), { recursive: true });
      } else {
        mkdirSync(join(dir, rel, '..'), { recursive: true });
        writeFileSync(join(dir, rel), content);
      }
    }
  }
  return dir;
}

function skillMd(name, description = 'A test skill.') {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`;
}

function runValidate(packDir) {
  try {
    return { ok: true, output: execFileSync(process.execPath, ['scripts/validate-pack.mjs', packDir], {
      cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }) };
  } catch (err) {
    return { ok: false, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

function expectPass(root, name, skills) {
  const result = runValidate(writePack(root, name, skills));
  assert(result.ok, `${name}: validator unexpectedly failed\n${result.output}`);
}

function expectFailure(root, name, skills, snippet) {
  const result = runValidate(writePack(root, name, skills));
  assert(!result.ok, `${name}: validator unexpectedly passed\n${result.output}`);
  assert(result.output.includes(snippet),
    `${name}: expected output to include ${JSON.stringify(snippet)}\n${result.output}`);
}

const root = mkdtempSync(join(tmpdir(), 'polyrig-pack-skills-'));
try {
  // 1. valid skill dir passes.
  expectPass(root, 'valid-skill', { 'skills/foo/SKILL.md': skillMd('foo') });

  // 8. regression: no skills/ at all still passes.
  expectPass(root, 'no-skills', null);

  // 2. skills/foo/ missing SKILL.md.
  expectFailure(root, 'missing-skillmd', { 'skills/foo/': null },
    'skills/foo/: missing SKILL.md');

  // 3. frontmatter missing name.
  expectFailure(root, 'no-name',
    { 'skills/foo/SKILL.md': '---\ndescription: no name here.\n---\n# foo\n' },
    'skills/foo/SKILL.md');

  // 4. frontmatter missing/empty description.
  expectFailure(root, 'no-desc',
    { 'skills/foo/SKILL.md': '---\nname: foo\n---\n# foo\n' },
    'skills/foo/SKILL.md');

  // 5. name does not match directory.
  expectFailure(root, 'name-mismatch',
    { 'skills/foo/SKILL.md': skillMd('bar') },
    "does not match directory 'foo'");

  // 6. skills/ present but empty (no subdir).
  expectFailure(root, 'empty-skills', { 'skills/': null },
    'skills/: present but contains no skill directory');

  // 7. skills/ contains a file (non-directory entry).
  expectFailure(root, 'file-in-skills', { 'skills/README.md': '# not a skill\n' },
    'skills/: contains non-directory entry');
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('test-validate-pack-skills: PASS');
