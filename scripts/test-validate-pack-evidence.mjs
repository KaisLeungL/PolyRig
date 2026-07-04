#!/usr/bin/env node
// Smoke tests for Evidence Matrix validation in pack validation.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO_ROOT } from './lib/validate.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function writePack(root, name, overrides = {}) {
  const dir = join(root, 'stack', name);
  mkdirSync(join(dir, 'knowledge'), { recursive: true });
  if (overrides.sources !== null) mkdirSync(join(dir, 'references'), { recursive: true });

  writeFileSync(join(dir, 'pack.yaml'), [
    `id: stack/${name}`,
    'type: stack',
    'version: 0.1.0',
    'last_reviewed: 2026-07-04',
    `summary: ${overrides.summary ?? 'Evidence test pack'}`,
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

  writeFileSync(
    join(dir, 'knowledge', 'overview.md'),
    overrides.overview ?? '# Overview\nTeams must record version lookup results before release. [Evidence: E001]\n',
  );
  writeFileSync(
    join(dir, 'verify.md'),
    overrides.verify ?? '# Verify\nRun configured checks before claiming ready. [Evidence: E001]\n',
  );
  writeFileSync(
    join(dir, 'deps.yaml'),
    overrides.deps ?? [
      'version_policy: verify_latest_before_use',
      'dependencies:',
      '  - coordinate: example-tool',
      '    purpose: Example tool used by this fixture',
      '    source: https://example.com/tool',
      '    evidence: [E001]',
      '',
    ].join('\n'),
  );

  if (overrides.sources !== null) {
    writeFileSync(
      join(dir, 'references', 'sources.md'),
      overrides.sources ?? [
        '# Sources',
        '',
        '## Evidence Matrix',
        '',
        '| id | claim | status | source_type | urls | applies_to | volatility | notes |',
        '|---|---|---|---|---|---|---|---|',
        '| E001 | Fixture packs should keep validation checks source-traceable. | source-backed | official | https://example.com/polyrig | knowledge/overview.md; verify.md; deps.yaml | low | Stable fixture claim. |',
        '',
      ].join('\n'),
    );
  }

  return dir;
}

function runValidate(packDir) {
  try {
    return {
      ok: true,
      output: execFileSync(process.execPath, ['scripts/validate-pack.mjs', packDir], {
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

function expectFailure(root, name, overrides, expectedSnippet) {
  const result = runValidate(writePack(root, name, overrides));
  assert(!result.ok, `${name}: validator unexpectedly passed\n${result.output}`);
  assert(
    result.output.includes(expectedSnippet),
    `${name}: expected output to include ${JSON.stringify(expectedSnippet)}\n${result.output}`,
  );
}

function expectPass(root, name, overrides = {}) {
  const result = runValidate(writePack(root, name, overrides));
  assert(result.ok, `${name}: validator unexpectedly failed\n${result.output}`);
}

const root = mkdtempSync(join(tmpdir(), 'polyrig-pack-evidence-'));
try {
  expectFailure(root, 'missing-sources', { sources: null }, 'references/sources.md: missing');
  expectFailure(
    root,
    'missing-matrix',
    { sources: '# Sources\n\nNo matrix yet.\n' },
    'references/sources.md: missing ## Evidence Matrix',
  );
  expectFailure(
    root,
    'duplicate-id',
    {
      sources: [
        '# Sources',
        '',
        '## Evidence Matrix',
        '',
        '| id | claim | status | source_type | urls | applies_to | volatility | notes |',
        '|---|---|---|---|---|---|---|---|',
        '| E001 | First claim. | source-backed | official | https://example.com/one | knowledge/overview.md | low | Stable. |',
        '| E001 | Second claim. | source-backed | official | https://example.com/two | verify.md | low | Duplicate. |',
        '',
      ].join('\n'),
    },
    'duplicate evidence id E001',
  );
  expectFailure(
    root,
    'strong-rule-missing-marker',
    { overview: '# Overview\nTeams must record version lookup results before release.\n' },
    'strong rule lacks evidence marker',
  );
  expectFailure(
    root,
    'strong-rule-unverified',
    {
      overview: '# Overview\nTeams must record version lookup results before release. [Evidence: E001]\n',
      sources: [
        '# Sources',
        '',
        '## Evidence Matrix',
        '',
        '| id | claim | status | source_type | urls | applies_to | volatility | notes |',
        '|---|---|---|---|---|---|---|---|',
        '| E001 | Fixture claim is not verified. | unverified | inference | local:interview | knowledge/overview.md | low | Deliberately weak. |',
        '',
      ].join('\n'),
    },
    'strong rule references unverified evidence E001',
  );
  expectFailure(
    root,
    'deps-missing-evidence',
    {
      deps: [
        'version_policy: verify_latest_before_use',
        'dependencies:',
        '  - coordinate: example-tool',
        '    purpose: Example tool used by this fixture',
        '    source: https://example.com/tool',
        '',
      ].join('\n'),
    },
    'missing evidence',
  );
  expectPass(root, 'complete-pack');
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('test-validate-pack-evidence: PASS');
