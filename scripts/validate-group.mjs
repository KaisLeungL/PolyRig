#!/usr/bin/env node
// validate-group.mjs — validate a group.yaml against schemas/group.schema.json
// and the 6 group invariants from docs/plans/2026-07-06-polyrig-pack-group-spec.md.
//
// Usage:
//   node scripts/validate-group.mjs <group.yaml | group-dir> [--roots <dir,dir,...>]
//
//   --roots  Comma-separated discovery roots used to resolve member and
//            group-level `requires` pack ids. Default: this repository's packs/.
//            When given, the listed roots REPLACE the default.
//
// Exits 0 with a PASS line, or 1 listing every specific violation.

import { join, resolve } from 'node:path';
import { statSync } from 'node:fs';
import { REPO_ROOT, validateGroupFile } from './lib/validate.mjs';

function usage(msg) {
  if (msg) console.error(`error: ${msg}`);
  console.error('usage: node scripts/validate-group.mjs <group.yaml | group-dir> [--roots <dir,dir,...>]');
  process.exit(msg ? 1 : 0);
}

const args = process.argv.slice(2);
let groupArg = null;
let roots = [join(REPO_ROOT, 'packs')];

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--help' || a === '-h') usage();
  else if (a === '--roots') {
    const v = args[++i];
    if (!v) usage('--roots requires a comma-separated list of directories');
    roots = v.split(',').map((r) => resolve(r.trim())).filter(Boolean);
    if (roots.length === 0) usage('--roots was given but no roots were parsed');
  } else if (a.startsWith('--')) usage(`unknown option '${a}'`);
  else if (groupArg === null) groupArg = a;
  else usage(`unexpected extra argument '${a}'`);
}

if (!groupArg) usage('missing <group.yaml> argument');

// Accept either the group.yaml file directly or its containing directory.
let groupYamlPath = resolve(groupArg);
try {
  if (statSync(groupYamlPath).isDirectory()) groupYamlPath = join(groupYamlPath, 'group.yaml');
} catch { /* validateGroupFile reports a clear does-not-exist violation */ }

let result;
try {
  result = validateGroupFile(groupYamlPath, { roots });
} catch (err) {
  console.error(`validate-group: internal error validating ${groupYamlPath}: ${err.message}`);
  process.exit(1);
}

const shownId = result.meta?.id ?? groupYamlPath;
if (result.ok) {
  console.log(`PASS ${shownId} (${groupYamlPath})`);
  process.exit(0);
} else {
  console.error(`FAIL ${shownId} (${groupYamlPath}) — ${result.violations.length} violation(s):`);
  for (const v of result.violations) console.error(`  - ${v}`);
  process.exit(1);
}
