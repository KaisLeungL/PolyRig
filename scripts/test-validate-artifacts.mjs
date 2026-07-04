#!/usr/bin/env node
// Smoke tests for validate-artifacts.mjs: generated feature_list.json and
// .polyrig/manifest.json must validate against schemas/ (including the
// $ref-based feature definition and format checks the subset validator covers).

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO_ROOT } from './lib/validate.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validFeatureList() {
  return {
    project: 'Fixture',
    version: '0.1.0',
    generated_at: '2026-07-04',
    features: [
      {
        id: 'F001',
        title: 'First feature',
        status: 'planned',
        priority: 'p0',
        depends_on: [],
        pack_refs: ['stack/android'],
        acceptance_criteria: ['One checkable criterion.'],
        verification: { manual: ['Check it.'], automated: ['./gradlew test'] },
        files_expected: [],
        notes: '',
      },
    ],
  };
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
        copied_to: ['docs/stacks/android/'],
        checksum: `sha256:${'a'.repeat(64)}`,
      },
    ],
    overrides: [],
  };
}

function writeTarget(root, name, featureList, manifest) {
  const dir = join(root, name);
  mkdirSync(join(dir, '.polyrig'), { recursive: true });
  writeFileSync(join(dir, 'feature_list.json'), JSON.stringify(featureList, null, 2));
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
  // Fully valid pair passes.
  {
    const result = runValidate(writeTarget(root, 'valid', validFeatureList(), validManifest()));
    assert(result.ok, `valid: unexpectedly failed\n${result.output}`);
  }

  // Bad feature status is caught through the $ref'd feature definition.
  {
    const fl = validFeatureList();
    fl.features[0].status = 'done';
    const result = runValidate(writeTarget(root, 'bad-status', fl, validManifest()));
    assert(!result.ok, `bad-status: unexpectedly passed\n${result.output}`);
    assert(result.output.includes('/features/0/status'), `bad-status: wrong violation\n${result.output}`);
  }

  // Unknown feature field is rejected (additionalProperties: false).
  {
    const fl = validFeatureList();
    fl.features[0].owner = 'me';
    const result = runValidate(writeTarget(root, 'extra-field', fl, validManifest()));
    assert(!result.ok, `extra-field: unexpectedly passed\n${result.output}`);
    assert(result.output.includes("unknown field 'owner'"), `extra-field: wrong violation\n${result.output}`);
  }

  // Malformed manifest checksum and date-time are caught.
  {
    const m = validManifest();
    m.selected_packs[0].checksum = 'sha256:short';
    m.generated_at = '2026-07-04 13:55';
    const result = runValidate(writeTarget(root, 'bad-manifest', validFeatureList(), m));
    assert(!result.ok, `bad-manifest: unexpectedly passed\n${result.output}`);
    assert(result.output.includes('/selected_packs/0/checksum'), `bad-manifest: checksum not flagged\n${result.output}`);
    assert(result.output.includes('date-time'), `bad-manifest: date-time not flagged\n${result.output}`);
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
