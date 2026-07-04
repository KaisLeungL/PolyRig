#!/usr/bin/env node
// Smoke tests for user-level pack discovery roots.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO_ROOT } from './lib/validate.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function writeMinimalPack(root, id, summary) {
  const [, type, name] = id.match(/^(stack|domain)\/(.+)$/);
  const dir = join(root, type, name);
  mkdirSync(join(dir, 'knowledge'), { recursive: true });
  writeFileSync(join(dir, 'pack.yaml'), [
    `id: ${id}`,
    `type: ${type}`,
    'version: 0.1.0',
    'last_reviewed: 2026-07-04',
    `summary: ${summary}`,
    'requires: []',
    'conflicts: []',
    'provides: []',
    'stacks: []',
    'trust:',
    '  level: user',
    '  scripts_enabled_by_default: false',
    '  requires_confirmation: true',
    '',
  ].join('\n'));
  writeFileSync(join(dir, 'knowledge', 'overview.md'), '# Overview\n');
  writeFileSync(join(dir, 'verify.md'), '# Verify\n');
}

const home = mkdtempSync(join(tmpdir(), 'polyrig-pack-index-'));
try {
  writeMinimalPack(join(home, '.polyrig', 'packs'), 'domain/new-user-root', 'New user root pack');
  writeMinimalPack(join(home, '.claude', 'polyrig-packs'), 'domain/legacy-user-root', 'Legacy user root pack');

  const raw = execFileSync(process.execPath, ['scripts/build-pack-index.mjs', '--home', home], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  const index = JSON.parse(raw);
  const ids = new Set(index.packs.map((pack) => pack.id));
  assert(ids.has('domain/new-user-root'), 'new ~/.polyrig/packs root should be scanned');
  assert(ids.has('domain/legacy-user-root'), 'legacy ~/.claude/polyrig-packs root should still be scanned');
} finally {
  rmSync(home, { recursive: true, force: true });
}

console.log('test-build-pack-index: PASS');
