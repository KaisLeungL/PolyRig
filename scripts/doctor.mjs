#!/usr/bin/env node
// doctor.mjs — environment and installation sanity check for PolyRig.
//
// Usage: node scripts/doctor.mjs
//
// Checks:
//   1. Node.js version >= 18.
//   2. Repository layout sanity: the three protocol schemas and the canonical
//      skill directory are present.
//   3. Native skill link status in ~/.claude/skills/polyrig and
//      ~/.codex/skills/polyrig (missing or wrong is a WARNING, not a failure —
//      installation is optional on CI machines).
//   4. Every pack under <repo>/packs/<type>/<name> passes validate-pack.
//      Directories without a pack.yaml (e.g. a .gitkeep placeholder) are
//      reported as "skipped (placeholder)" and do not fail.
//
// Exits non-zero if any hard check or any real pack validation fails.

import { existsSync, lstatSync, realpathSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { homedir } from 'node:os';
import { REPO_ROOT, listPackDirs, validatePackDir } from './lib/validate.mjs';

let failures = 0;
let warnings = 0;

function ok(msg) { console.log(`  ok    ${msg}`); }
function warn(msg) { warnings += 1; console.log(`  WARN  ${msg}`); }
function fail(msg) { failures += 1; console.log(`  FAIL  ${msg}`); }

// --- 1. Node version --------------------------------------------------------
console.log('node runtime');
const major = Number(process.versions.node.split('.')[0]);
if (Number.isInteger(major) && major >= 18) {
  ok(`node ${process.versions.node} (>= 18 required)`);
} else {
  fail(`node ${process.versions.node} — PolyRig tooling requires Node.js >= 18`);
}

// --- 2. Repository layout ---------------------------------------------------
console.log('repository layout');
for (const schema of ['pack.schema.json', 'feature_list.schema.json', 'manifest.schema.json']) {
  const p = join(REPO_ROOT, 'schemas', schema);
  if (existsSync(p)) ok(`schemas/${schema}`);
  else fail(`schemas/${schema} is missing`);
}
const skillDir = join(REPO_ROOT, 'skill', 'polyrig');
if (existsSync(skillDir) && statSync(skillDir).isDirectory()) {
  ok('skill/polyrig/ exists');
  if (!existsSync(join(skillDir, 'SKILL.md'))) {
    warn('skill/polyrig/SKILL.md not written yet (feature F009)');
  }
} else {
  fail('skill/polyrig/ is missing');
}

// --- 3. Skill link status ---------------------------------------------------
console.log('skill installation');
for (const linkDest of [
  join(homedir(), '.claude', 'skills', 'polyrig'),
  join(homedir(), '.codex', 'skills', 'polyrig'),
]) {
  let linkStat = null;
  try { linkStat = lstatSync(linkDest); } catch { /* absent */ }
  if (linkStat === null) {
    warn(`skill not installed at ${linkDest} — run: node scripts/link-skill.mjs --platform all`);
  } else if (linkStat.isSymbolicLink()) {
    let target = null;
    try { target = realpathSync(linkDest); } catch { /* dangling */ }
    if (target === realpathSync(skillDir)) {
      ok(`skill linked: ${linkDest} -> ${target}`);
    } else if (target === null) {
      warn(`skill link at ${linkDest} is dangling — re-run: node scripts/link-skill.mjs --platform all --force`);
    } else {
      warn(`skill link at ${linkDest} points elsewhere (${target})`);
    }
  } else if (linkStat.isDirectory()) {
    ok(`skill installed as a copied directory at ${linkDest} (re-copy after skill changes)`);
  } else {
    warn(`unexpected non-directory at ${linkDest}`);
  }
}

// --- 4. Validate all builtin packs ------------------------------------------
console.log('builtin packs');
const packsRoot = join(REPO_ROOT, 'packs');
const packDirs = listPackDirs(packsRoot);
if (packDirs.length === 0) {
  fail(`no pack directories found under ${packsRoot}`);
}
for (const { dir, hasPackYaml } of packDirs) {
  const rel = relative(REPO_ROOT, dir);
  if (!hasPackYaml) {
    console.log(`  skip  ${rel} — skipped (placeholder, no pack.yaml)`);
    continue;
  }
  const result = validatePackDir(dir, { roots: [packsRoot] });
  if (result.ok) {
    ok(`${rel} — PASS (${result.meta.id}@${result.meta.version})`);
  } else {
    fail(`${rel} — FAIL:`);
    for (const v of result.violations) console.log(`          - ${v}`);
  }
}

// --- summary -----------------------------------------------------------------
console.log('');
if (failures > 0) {
  console.log(`doctor: ${failures} failure(s), ${warnings} warning(s)`);
  process.exit(1);
}
console.log(`doctor: all checks passed${warnings > 0 ? ` (${warnings} warning(s))` : ''}`);
