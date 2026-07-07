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

// Write <layer>/groups/<name>/group.yaml from a member id list. `layer` is the
// directory that holds packs/ (groups/ sits parallel to packs/, per spec).
function writeGroup(layer, name, { version = '0.1.0', summary = 'Demo group', members = [], requires = [] } = {}) {
  const dir = join(layer, 'groups', name);
  mkdirSync(dir, { recursive: true });
  const lines = [
    `id: group/${name}`,
    `version: ${version}`,
    'last_reviewed: 2026-07-06',
    `summary: ${summary}`,
    'members:',
  ];
  for (const m of members) { lines.push(`  - id: ${m.id}`, `    version: ${m.version}`); }
  if (requires.length === 0) lines.push('requires: []');
  else {
    lines.push('requires:');
    for (const r of requires) { lines.push(`  - id: ${r.id}`, `    version: ${r.version}`); }
  }
  lines.push('');
  writeFileSync(join(dir, 'group.yaml'), lines.join('\n'));
}

const home = mkdtempSync(join(tmpdir(), 'polyrig-pack-index-'));
const projectDir = mkdtempSync(join(tmpdir(), 'polyrig-pack-index-proj-'));
try {
  writeMinimalPack(join(home, '.polyrig', 'packs'), 'domain/new-user-root', 'New user root pack');
  writeMinimalPack(join(home, '.claude', 'polyrig-packs'), 'domain/legacy-user-root', 'Legacy user root pack');

  // A group in the neutral user layer (groups/ sits parallel to packs/), plus a
  // same-id group in the project layer that must win under project > user.
  writeGroup(join(home, '.polyrig'), 'demo', {
    version: '0.1.0',
    summary: 'User-root demo group',
    members: [{ id: 'domain/new-user-root', version: '0.1.0' }],
  });
  writeGroup(join(projectDir, '.polyrig'), 'demo', {
    version: '0.2.0',
    summary: 'Project-root demo group (wins)',
    members: [{ id: 'domain/new-user-root', version: '0.1.0' }],
  });

  const raw = execFileSync(process.execPath, ['scripts/build-pack-index.mjs', '--home', home, '--target', projectDir], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  const index = JSON.parse(raw);
  const ids = new Set(index.packs.map((pack) => pack.id));
  assert(ids.has('domain/new-user-root'), 'new ~/.polyrig/packs root should be scanned');
  assert(ids.has('domain/legacy-user-root'), 'legacy ~/.claude/polyrig-packs root should still be scanned');

  assert(Array.isArray(index.groups), 'index must carry a groups array parallel to packs');
  const demo = index.groups.find((g) => g.id === 'group/demo');
  assert(demo, 'groups array should include the scanned group/demo');
  assert(demo.version === '0.2.0', 'project-root group must win over the user-root group (project > user)');
  assert(demo.source === 'project', `winning group source should be project, got ${demo.source}`);
  assert(demo.summary === 'Project-root demo group (wins)', 'winning group summary should be the project one');
  assert(typeof demo.last_reviewed === 'string', 'group entry carries last_reviewed');
  assert(Array.isArray(demo.members) && demo.members[0].id === 'domain/new-user-root', 'group entry carries members with id/version');
  assert(demo.members[0].version === '0.1.0', 'group member carries pinned version');
  assert(Array.isArray(demo.requires), 'group entry carries requires array');
  assert(typeof demo.path === 'string' && demo.path.endsWith('groups/demo/group.yaml'), 'group entry path points at group.yaml');
  const groupOverride = (index.overrides ?? []).find((o) => o.id === 'group/demo');
  assert(groupOverride && groupOverride.winner_source === 'project' && groupOverride.loser_source === 'user',
    'a project-over-user group override must be recorded');
} finally {
  rmSync(home, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
}

console.log('test-build-pack-index: PASS');
