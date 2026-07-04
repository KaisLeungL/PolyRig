#!/usr/bin/env node
// validate-artifacts.mjs — validate the JSON artifacts PolyRig generated into
// a target project against this repository's schemas:
//
//   <target>/feature_list.json      vs schemas/feature_list.schema.json
//   <target>/.polyrig/manifest.json vs schemas/manifest.schema.json
//
// Usage:
//   node scripts/validate-artifacts.mjs <target-dir>
//
// This is the tooling behind the /polyrig post-generate self-check and the
// v0.1 acceptance gate "generated artifacts validate against schemas/".
// Exits 0 when both artifacts validate, 1 otherwise.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REPO_ROOT, checkAgainstSchema } from './lib/validate.mjs';

function usage(msg) {
  if (msg) console.error(`error: ${msg}`);
  console.error('usage: node scripts/validate-artifacts.mjs <target-dir>');
  process.exit(msg ? 1 : 0);
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) usage();
if (args.length !== 1) usage('expected exactly one <target-dir> argument');

const target = resolve(args[0]);
const artifacts = [
  { rel: 'feature_list.json', schema: 'feature_list.schema.json' },
  { rel: join('.polyrig', 'manifest.json'), schema: 'manifest.schema.json' },
];

let failed = false;
for (const { rel, schema } of artifacts) {
  let violations;
  try {
    const value = JSON.parse(readFileSync(join(target, rel), 'utf8'));
    const schemaValue = JSON.parse(readFileSync(join(REPO_ROOT, 'schemas', schema), 'utf8'));
    violations = checkAgainstSchema(value, schemaValue).map((v) => `${rel}:${v}`);
  } catch (err) {
    violations = [`${rel}: ${err.message}`];
  }
  if (violations.length === 0) {
    console.log(`PASS ${rel}`);
  } else {
    failed = true;
    console.error(`FAIL ${rel} — ${violations.length} violation(s):`);
    for (const v of violations) console.error(`  - ${v}`);
  }
}
process.exit(failed ? 1 : 0);
