#!/usr/bin/env node
// Smoke tests for validate-artifacts.mjs: the generated .polyrig/manifest.json
// must validate against schemas/ (including the format checks and the
// selected_groups $def the subset validator covers).

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO_ROOT } from './lib/validate.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validManifest() {
  return {
    polyrig_version: '0.1.0',
    generated_at: '2026-07-04T13:55:32Z',
    language: { interaction: 'zh-CN', artifacts: 'en' },
    selected_packs: [
      {
        id: 'stack/android',
        version: '0.1.0',
        source: 'builtin',
        last_reviewed: '2026-07-04',
        copied_to: ['.polyrig/vault/stacks/android/'],
        checksum: `sha256:${'a'.repeat(64)}`,
      },
    ],
    overrides: [],
  };
}

function writeTarget(root, name, manifest) {
  const dir = join(root, name);
  mkdirSync(join(dir, '.polyrig'), { recursive: true });
  writeFileSync(join(dir, '.polyrig', 'manifest.json'), JSON.stringify(manifest, null, 2));
  return dir;
}

function runValidate(targetDir) {
  try {
    return {
      ok: true,
      output: execFileSync(process.execPath, ['scripts/validate-artifacts.mjs', targetDir], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    };
  } catch (err) {
    return {
      ok: false,
      output: `${err.stdout ?? ''}${err.stderr ?? ''}`,
    };
  }
}

const root = mkdtempSync(join(tmpdir(), 'polyrig-artifacts-'));
try {
  // A valid manifest passes.
  {
    const result = runValidate(writeTarget(root, 'valid', validManifest()));
    assert(result.ok, `valid: unexpectedly failed\n${result.output}`);
  }

  // Malformed manifest checksum and date-time are caught.
  {
    const m = validManifest();
    m.selected_packs[0].checksum = 'sha256:short';
    m.generated_at = '2026-07-04 13:55';
    const result = runValidate(writeTarget(root, 'bad-manifest', m));
    assert(!result.ok, `bad-manifest: unexpectedly passed\n${result.output}`);
    assert(result.output.includes('/selected_packs/0/checksum'), `bad-manifest: checksum not flagged\n${result.output}`);
    assert(result.output.includes('date-time'), `bad-manifest: date-time not flagged\n${result.output}`);
  }

  // A manifest recording a selected group (id/version/lock) validates.
  {
    const m = validManifest();
    m.selected_groups = [
      {
        id: 'group/auth',
        version: '0.1.0',
        lock: [
          { id: 'domain/auth-core', version: '0.1.0' },
          { id: 'domain/auth-google', version: '0.1.0' },
        ],
      },
    ];
    const result = runValidate(writeTarget(root, 'group-valid', m));
    assert(result.ok, `group-valid: unexpectedly failed\n${result.output}`);
  }

  // A selected group missing a required sub-field (version) is rejected.
  {
    const m = validManifest();
    m.selected_groups = [
      {
        id: 'group/auth',
        lock: [{ id: 'domain/auth-core', version: '0.1.0' }],
      },
    ];
    const result = runValidate(writeTarget(root, 'group-missing-version', m));
    assert(!result.ok, `group-missing-version: unexpectedly passed\n${result.output}`);
    assert(result.output.includes('/selected_groups/0'), `group-missing-version: wrong violation\n${result.output}`);
    assert(result.output.includes("required field 'version'"), `group-missing-version: version not flagged\n${result.output}`);
  }

  // A manifest recording linked_skills (four required fields) validates.
  {
    const m = validManifest();
    m.linked_skills = [
      { pack: 'domain/foo', skill: 'bar', linked_as: 'bar', target: '/abs/.claude/skills/bar' },
      { pack: 'stack/baz', skill: 'qux', linked_as: 'baz-qux', target: '/abs/.claude/skills/baz-qux' },
    ];
    const result = runValidate(writeTarget(root, 'linked-skills-valid', m));
    assert(result.ok, `linked-skills-valid: unexpectedly failed\n${result.output}`);
  }

  // A linked_skill missing a required field (target) is rejected.
  {
    const m = validManifest();
    m.linked_skills = [{ pack: 'domain/foo', skill: 'bar', linked_as: 'bar' }];
    const result = runValidate(writeTarget(root, 'linked-skills-missing-target', m));
    assert(!result.ok, `linked-skills-missing-target: unexpectedly passed\n${result.output}`);
    assert(result.output.includes('/linked_skills/0') && result.output.includes("required field 'target'"),
      `linked-skills-missing-target: wrong violation\n${result.output}`);
  }

  // A linked_skill with an unknown extra field is rejected (additionalProperties: false).
  {
    const m = validManifest();
    m.linked_skills = [{ pack: 'domain/foo', skill: 'bar', linked_as: 'bar', target: '/x', extra: 1 }];
    const result = runValidate(writeTarget(root, 'linked-skills-extra', m));
    assert(!result.ok, `linked-skills-extra: unexpectedly passed\n${result.output}`);
    assert(result.output.includes("unknown field 'extra'"), `linked-skills-extra: wrong violation\n${result.output}`);
  }

  // Missing artifact file fails instead of passing silently.
  {
    const dir = join(root, 'missing');
    mkdirSync(dir, { recursive: true });
    const result = runValidate(dir);
    assert(!result.ok, `missing: unexpectedly passed\n${result.output}`);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('test-validate-artifacts: PASS');
