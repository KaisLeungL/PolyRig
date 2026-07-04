#!/usr/bin/env node
// Smoke tests for verify.md tool coverage: package-runner invocations in a
// pack's verify.md must resolve to a deps.yaml entry.

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
  mkdirSync(join(dir, 'references'), { recursive: true });

  writeFileSync(join(dir, 'pack.yaml'), [
    `id: stack/${name}`,
    'type: stack',
    'version: 0.1.0',
    'last_reviewed: 2026-07-04',
    'summary: Verify-tool coverage test pack',
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
    '# Overview\nTeams must record version lookup results before release. [Evidence: E001]\n',
  );
  writeFileSync(
    join(dir, 'verify.md'),
    overrides.verify ?? '# Verify\nRun `uv run pytest` before claiming ready. [Evidence: E001]\n',
  );
  if (overrides.deps !== null) {
    writeFileSync(
      join(dir, 'deps.yaml'),
      overrides.deps ?? [
        'version_policy: verify_latest_before_use',
        'dependencies:',
        '  - coordinate: pytest (PyPI)',
        '    purpose: Test runner used by the verification route',
        '    source: https://pypi.org/project/pytest/',
        '    evidence: [E001]',
        '',
      ].join('\n'),
    );
  }
  writeFileSync(
    join(dir, 'references', 'sources.md'),
    [
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

const root = mkdtempSync(join(tmpdir(), 'polyrig-pack-verify-tools-'));
try {
  // Declared tool passes.
  expectPass(root, 'declared-tool');

  // Undeclared tool via 'uv run' fails.
  expectFailure(
    root,
    'undeclared-tool',
    { verify: '# Verify\nRun `uv run pytest` then `uv run ruff check .` before claiming ready. [Evidence: E001]\n' },
    "tool 'ruff' is invoked via 'uv run' but has no deps.yaml entry",
  );

  // Runner invocation with no deps.yaml at all fails with the dedicated message.
  expectFailure(
    root,
    'no-deps-file',
    { deps: null },
    "tool 'pytest' is invoked via 'uv run' but the pack has no deps.yaml",
  );

  // Extras in package_candidates still count as declared (uvicorn[standard]).
  expectPass(root, 'extras-candidate', {
    verify: '# Verify\nBoot check: `uv run uvicorn app.main:app` must serve /health. [Evidence: E001]\n',
    deps: [
      'version_policy: verify_latest_before_use',
      'dependencies:',
      '  - coordinate: uvicorn (PyPI)',
      '    purpose: ASGI server used by the boot smoke route',
      '    source: https://pypi.org/project/uvicorn/',
      '    evidence: [E001]',
      '    lookup:',
      '      query: "uvicorn latest version"',
      '      official_sources:',
      '        - https://pypi.org/project/uvicorn/',
      '      package_candidates: ["uvicorn[standard]"]',
      '',
    ].join('\n'),
  });

  // Each missing tool is reported once even when invoked on multiple lines.
  {
    const dir = writePack(root, 'dedupe', {
      verify: [
        '# Verify',
        'Lint: `uv run ruff check .` must pass. [Evidence: E001]',
        'Format: `uv run ruff format --check .` must pass. [Evidence: E001]',
        '',
      ].join('\n'),
    });
    const result = runValidate(dir);
    assert(!result.ok, `dedupe: validator unexpectedly passed\n${result.output}`);
    const count = result.output.split("tool 'ruff'").length - 1;
    assert(count === 1, `dedupe: expected exactly one ruff violation, saw ${count}\n${result.output}`);
  }

  // System tools (gradlew, xcodebuild) are not package-runner invocations.
  expectPass(root, 'system-tools', {
    verify: '# Verify\nRun `./gradlew test` and `xcodebuild build` as required. [Evidence: E001]\n',
    deps: null,
  });
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('test-validate-pack-verify-tools: PASS');
