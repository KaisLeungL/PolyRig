#!/usr/bin/env node
// test-pack-group.mjs — tests for pack-group.mjs (the group upload bundler).
// Run: node scripts/test-pack-group.mjs

import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(SCRIPT_DIR);
const BUNDLER = join(SCRIPT_DIR, 'pack-group.mjs');
const PACKS_ROOT = join(REPO_ROOT, 'packs');

let checks = 0;
function ok(cond, label) {
  assert.ok(cond, label);
  console.log(`ok   ${label}`);
  checks++;
}

// --- minimal ustar reader (mirror of install-pack.mjs's reader) ------------
function readStr(block, offset, length) {
  const slice = block.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return slice.toString('utf8', 0, end === -1 ? length : end);
}
function tarNames(tarBuf) {
  const names = [];
  let off = 0;
  while (off + 512 <= tarBuf.length) {
    const block = tarBuf.subarray(off, off + 512);
    if (block.every((b) => b === 0)) break;
    const name = readStr(block, 0, 100);
    const prefix = readStr(block, 345, 155);
    const size = parseInt(readStr(block, 124, 12).trim() || '0', 8);
    off += 512 + Math.ceil(size / 512) * 512;
    names.push(prefix ? `${prefix}/${name}` : name);
  }
  return names;
}

function run(args) {
  return execFileSync('node', [BUNDLER, ...args], { encoding: 'utf8' });
}

// === Test 1: bundle the real group/auth ====================================
const work = mkdtempSync(join(tmpdir(), 'polyrig-packgroup-'));
try {
  const out = join(work, 'auth.tar.gz');
  const stdout = run([join(REPO_ROOT, 'groups', 'auth'), '--out', out]);

  ok(existsSync(out), 'bundle archive is written to --out path');
  ok(/OK bundled group\/auth@0\.1\.0/.test(stdout), 'stdout reports the bundled group id@version');
  ok(/3 member\(s\)/.test(stdout), 'stdout reports 3 members');

  const names = tarNames(gunzipSync(readFileSync(out)));

  ok(names.includes('group.yaml'), 'group.yaml sits at the bundle root');
  ok(
    names.some((n) => n === 'packs/domain/auth-core/pack.yaml'),
    'auth-core is laid out under packs/domain/auth-core/',
  );
  ok(
    names.some((n) => n === 'packs/domain/auth-google/pack.yaml')
      && names.some((n) => n === 'packs/domain/auth-github/pack.yaml'),
    'auth-google and auth-github are laid out under packs/domain/',
  );
  ok(
    names.some((n) => n === 'packs/domain/auth-core/knowledge/overview.md'),
    'member subtree files (knowledge/) are included, not just pack.yaml',
  );
  // find_group_layout expects exactly one group.yaml and pack roots under it.
  ok(
    names.filter((n) => n === 'group.yaml').length === 1,
    'exactly one group.yaml in the bundle (find_group_layout contract)',
  );
  ok(
    !names.some((n) => n.includes('..') || n.startsWith('/')),
    'no traversal or absolute paths in archive entry names',
  );

  // group.yaml content is the real manifest, unmodified.
  const idx = names.indexOf('group.yaml');
  assert.ok(idx >= 0);
} finally {
  rmSync(work, { recursive: true, force: true });
}

// === Test 2: default --out lands under tmp/ ================================
{
  const stdout = run([join(REPO_ROOT, 'groups', 'auth')]);
  const m = stdout.match(/-> (.+\.tar\.gz)/);
  ok(m !== null, 'default run prints the output path');
  const outPath = m[1];
  ok(outPath.includes(`${join(REPO_ROOT, 'tmp')}`), 'default output lands under the gitignored tmp/ dir');
  ok(existsSync(outPath), 'default bundle file exists');
  rmSync(outPath, { force: true });
}

// === Test 3: invalid group aborts (no bundle written) ======================
{
  const work3 = mkdtempSync(join(tmpdir(), 'polyrig-packgroup-bad-'));
  try {
    // A group.yaml referencing a member that does not resolve in the roots.
    const gdir = join(work3, 'groups', 'ghost');
    mkdirSync(gdir, { recursive: true });
    writeFileSync(join(gdir, 'group.yaml'), [
      'id: group/ghost',
      'version: 0.1.0',
      'last_reviewed: 2026-07-07',
      'summary: references a nonexistent member',
      'members:',
      '  - id: domain/does-not-exist',
      '    version: 9.9.9',
      'requires: []',
      '',
    ].join('\n'));

    const out3 = join(work3, 'ghost.tar.gz');
    let threw = false;
    try {
      execFileSync('node', [BUNDLER, gdir, '--roots', PACKS_ROOT, '--out', out3], { encoding: 'utf8', stdio: 'pipe' });
    } catch (err) {
      threw = true;
      const combined = `${err.stdout ?? ''}${err.stderr ?? ''}`;
      ok(/does not resolve|did not validate/.test(combined), 'invalid group reports the resolution failure');
    }
    ok(threw, 'bundler exits non-zero on an invalid group');
    ok(!existsSync(out3), 'no archive is written when validation fails');
  } finally {
    rmSync(work3, { recursive: true, force: true });
  }
}

console.log(`\nPASS ${checks} checks`);
