#!/usr/bin/env node
// Smoke tests for group.yaml schema shape + the 6 group invariants, exercised
// through the real validate-group.mjs CLI against fixture packs in a temp root.
// Run: node scripts/test-validate-group.mjs
//
// NOTE on YAML shape: PolyRig's miniyaml subset does NOT support flow maps
// ({...}). Group member/requires refs use block-map list items:
//   members:
//     - id: domain/auth-core
//       version: 0.1.0

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO_ROOT } from './lib/validate.mjs';

// Build a group.yaml body from head lines + a list of { key: value } ref maps.
function groupBody(head, { members = null, requires = null } = {}) {
  const lines = [...head];
  const emit = (key, refs) => {
    if (refs === null) return;
    if (refs.length === 0) { lines.push(`${key}: []`); return; }
    lines.push(`${key}:`);
    for (const ref of refs) {
      const entries = Object.entries(ref);
      lines.push(`  - ${entries[0][0]}: ${entries[0][1]}`);
      for (const [k, v] of entries.slice(1)) lines.push(`    ${k}: ${v}`);
    }
  };
  emit('members', members);
  emit('requires', requires);
  lines.push('');
  return lines.join('\n');
}

// Minimal valid pack in <root>/<type>/<name>. requires/conflicts are inline
// arrays of pack ids (e.g. '[domain/auth-core]').
function writePack(root, id, { version = '0.1.0', requires = '[]', conflicts = '[]' } = {}) {
  const [, type, name] = id.match(/^(stack|domain)\/(.+)$/);
  const dir = join(root, type, name);
  mkdirSync(join(dir, 'knowledge'), { recursive: true });
  mkdirSync(join(dir, 'references'), { recursive: true });
  writeFileSync(join(dir, 'pack.yaml'), [
    `id: ${id}`,
    `type: ${type}`,
    `version: ${version}`,
    'last_reviewed: 2026-07-04',
    `summary: Group test pack ${id}.`,
    `requires: ${requires}`,
    `conflicts: ${conflicts}`,
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
  writeFileSync(join(dir, 'references', 'sources.md'), [
    '# Sources',
    '',
    '## Evidence Matrix',
    '',
    '| id | claim | status | source_type | urls | applies_to | volatility | notes |',
    '|---|---|---|---|---|---|---|---|',
    '| E001 | Fixture claim. | source-backed | official | https://example.com | knowledge/overview.md | low | Stable. |',
    '',
  ].join('\n'));
  return dir;
}

// Write group.yaml into a directory named after its group short-name (so the
// directory-name-agrees-with-id check is satisfied), under a unique parent.
function writeGroup(parent, body) {
  const m = body.match(/^id:\s*group\/([a-z0-9-]+)/m);
  const dir = join(parent, m ? m[1] : 'group');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'group.yaml');
  writeFileSync(path, body);
  return path;
}

function runValidateGroup(groupPath, root) {
  try {
    return {
      ok: true,
      output: execFileSync(
        process.execPath,
        ['scripts/validate-group.mjs', groupPath, '--roots', root],
        { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      ),
    };
  } catch (err) {
    return { ok: false, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

let failures = 0;
let ran = 0;

function expectPass(label, groupPath, root) {
  ran++;
  const result = runValidateGroup(groupPath, root);
  if (result.ok) console.log(`ok   ${label}`);
  else { failures++; console.error(`FAIL ${label}\n     ${result.output}`); }
}

function expectFail(label, groupPath, root, snippet) {
  ran++;
  const result = runValidateGroup(groupPath, root);
  if (!result.ok && result.output.includes(snippet)) {
    console.log(`ok   ${label}`);
  } else {
    failures++;
    console.error(`FAIL ${label} (expected FAIL containing ${JSON.stringify(snippet)})\n     ${result.output}`);
  }
}

const head = (id, summary) => [
  `id: ${id}`,
  'version: 0.1.0',
  'last_reviewed: 2026-07-06',
  `summary: ${summary}`,
];

const work = mkdtempSync(join(tmpdir(), 'polyrig-group-test-'));
try {
  // A shared discovery root holding the auth trio (the real migration target).
  const root = join(work, 'root');
  writePack(root, 'domain/auth-core');
  writePack(root, 'domain/auth-google', { requires: '[domain/auth-core]' });
  writePack(root, 'domain/auth-github', { requires: '[domain/auth-core]' });
  // An out-of-group ordinary pack a group may reference via group-level requires.
  writePack(root, 'domain/http-client', { version: '2.1.0' });

  // --- Task 1 shape cases ---------------------------------------------------

  // 1. valid group -> PASS
  expectPass('valid group passes', writeGroup(join(work, 'g-valid'),
    groupBody(head('group/auth', 'OAuth/OIDC sign-in suite.'), {
      members: [
        { id: 'domain/auth-core', version: '0.1.0' },
        { id: 'domain/auth-google', version: '0.1.0' },
        { id: 'domain/auth-github', version: '0.1.0' },
      ],
      requires: [],
    })), root);

  // 2. missing members -> FAIL (schema required)
  expectFail('missing members fails', writeGroup(join(work, 'g-no-members'),
    groupBody(head('group/auth', 'No members.'), { requires: [] })),
    root, "missing required field 'members'");

  // 3. member missing version -> FAIL (schema required in packRef)
  expectFail('member without version fails', writeGroup(join(work, 'g-no-ver'),
    groupBody(head('group/auth', 'Member has no version.'), {
      members: [{ id: 'domain/auth-core' }],
    })), root, "missing required field 'version'");

  // 4. id not matching group/<name> -> FAIL (schema pattern)
  expectFail('bad id pattern fails', writeGroup(join(work, 'g-bad-id'),
    groupBody(head('auth', 'Bad id.'), {
      members: [{ id: 'domain/auth-core', version: '0.1.0' }],
    })), root, 'does not match pattern');

  // 5. duplicate member ids -> FAIL (invariant 3)
  expectFail('duplicate member id fails', writeGroup(join(work, 'g-dup'),
    groupBody(head('group/auth', 'Duplicate members.'), {
      members: [
        { id: 'domain/auth-core', version: '0.1.0' },
        { id: 'domain/auth-core', version: '0.1.0' },
      ],
    })), root, 'duplicate');

  // 6. group requires id also in members -> FAIL (invariant 4)
  expectFail('member also in requires fails', writeGroup(join(work, 'g-overlap'),
    groupBody(head('group/auth', 'Overlap.'), {
      members: [
        { id: 'domain/auth-core', version: '0.1.0' },
        { id: 'domain/auth-google', version: '0.1.0' },
      ],
      requires: [{ id: 'domain/auth-core', version: '0.1.0' }],
    })), root, 'appears in both members and requires');

  // --- Task 2 invariant cases ----------------------------------------------

  // Invariant 1: dependency closure — a member requires something neither a
  // member nor a group-level requires.
  expectFail('member requires unlisted dep fails (closure)', writeGroup(join(work, 'g-closure'),
    groupBody(head('group/auth', 'Closure broken.'), {
      members: [{ id: 'domain/auth-google', version: '0.1.0' }],
      requires: [],
    })), root, 'domain/auth-core');

  // Invariant 1 satisfied via group-level requires -> PASS
  expectPass('closure satisfied via group requires passes', writeGroup(join(work, 'g-closure-ok'),
    groupBody(head('group/auth', 'Closure via requires.'), {
      members: [{ id: 'domain/auth-google', version: '0.1.0' }],
      requires: [{ id: 'domain/auth-core', version: '0.1.0' }],
    })), root);

  // Invariant 2: member version mismatch (pack.yaml is 0.1.0, group pins 9.9.9).
  expectFail('member version mismatch fails', writeGroup(join(work, 'g-ver-mismatch'),
    groupBody(head('group/auth', 'Version mismatch.'), {
      members: [{ id: 'domain/auth-core', version: '9.9.9' }],
    })), root, 'version');

  // Invariant 2: member does not resolve in any root.
  expectFail('unresolvable member fails', writeGroup(join(work, 'g-missing-pack'),
    groupBody(head('group/auth', 'Missing pack.'), {
      members: [{ id: 'domain/does-not-exist', version: '0.1.0' }],
    })), root, 'does not resolve');

  // Invariant 5: members conflict with each other.
  const root5 = join(work, 'root5');
  writePack(root5, 'domain/one', { conflicts: '[domain/two]' });
  writePack(root5, 'domain/two');
  expectFail('conflicting members fail', writeGroup(join(work, 'g-conflict'),
    groupBody(head('group/pair', 'Members conflict.'), {
      members: [
        { id: 'domain/one', version: '0.1.0' },
        { id: 'domain/two', version: '0.1.0' },
      ],
    })), root5, 'conflict');

  // Invariant 6: requires graph has a cycle.
  const root6 = join(work, 'root6');
  writePack(root6, 'domain/a', { requires: '[domain/b]' });
  writePack(root6, 'domain/b', { requires: '[domain/a]' });
  expectFail('cyclic requires graph fails', writeGroup(join(work, 'g-cycle'),
    groupBody(head('group/cyc', 'Cyclic.'), {
      members: [
        { id: 'domain/a', version: '0.1.0' },
        { id: 'domain/b', version: '0.1.0' },
      ],
    })), root6, 'cycle');
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(failures === 0 ? `PASS ${ran} checks` : `FAIL ${failures}/${ran} checks failed`);
process.exit(failures === 0 ? 0 : 1);
