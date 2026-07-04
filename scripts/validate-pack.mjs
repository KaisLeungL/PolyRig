#!/usr/bin/env node
// validate-pack.mjs — validate a pack directory against schemas/pack.schema.json
// and the structural rules from docs/pack-protocol.md.
//
// Usage:
//   node scripts/validate-pack.mjs <pack-dir> [--roots <dir,dir,...>]
//
//   --roots  Comma-separated discovery roots used to resolve `requires`.
//            Default: this repository's packs/. When given, the listed roots
//            REPLACE the default (the pack's own containing root is always
//            considered in addition).
//
// Exits 0 with a PASS line, or 1 listing every specific violation.

import { join, resolve } from 'node:path';
import { REPO_ROOT, validatePackDir } from './lib/validate.mjs';

function usage(msg) {
  if (msg) console.error(`error: ${msg}`);
  console.error('usage: node scripts/validate-pack.mjs <pack-dir> [--roots <dir,dir,...>]');
  process.exit(msg ? 1 : 0);
}

const args = process.argv.slice(2);
let packDir = null;
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
  else if (packDir === null) packDir = a;
  else usage(`unexpected extra argument '${a}'`);
}

if (!packDir) usage('missing <pack-dir> argument');

let result;
try {
  result = validatePackDir(packDir, { roots });
} catch (err) {
  console.error(`validate-pack: internal error validating ${packDir}: ${err.message}`);
  process.exit(1);
}

const shownId = result.meta?.id ?? resolve(packDir);
if (result.ok) {
  console.log(`PASS ${shownId} (${resolve(packDir)})`);
  process.exit(0);
} else {
  console.error(`FAIL ${shownId} (${resolve(packDir)}) — ${result.violations.length} violation(s):`);
  for (const v of result.violations) console.error(`  - ${v}`);
  process.exit(1);
}
