#!/usr/bin/env node
// build-pack-index.mjs — scan the PolyRig discovery roots and emit a pack
// index as JSON (stdout by default).
//
// Usage:
//   node scripts/build-pack-index.mjs [--target <project-dir>] [--out <file>] [--home <dir>]
//
//   --target  Target project directory; adds <target>/.polyrig/packs as the
//             project-level root. Without it only builtin + user roots scan.
//   --out     Write the index JSON to this file instead of stdout.
//   --home    Home directory override (for tests); the user-level root is
//             <home>/.claude/polyrig-packs. Default: os.homedir().
//
// Discovery roots (precedence on id collision: project > user > builtin):
//   builtin  <repo>/packs
//   user     <home>/.claude/polyrig-packs
//   project  <target>/.polyrig/packs
//
// Output shape: { generated_at, roots, packs, overrides }. Each pack carries
// id, type, version, summary, last_reviewed, requires, conflicts, provides,
// stacks, source, path (absolute), has_scripts. Override records are
// { id, winner_source, loser_source }.
//
// Packs whose pack.yaml is missing or unparseable are skipped with a warning
// on stderr (placeholder dirs, e.g. only a .gitkeep, are silently ignored).

import { readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { parseYamlFile, YamlError } from './lib/miniyaml.mjs';
import { REPO_ROOT, listPackDirs } from './lib/validate.mjs';

function usage(msg) {
  if (msg) console.error(`error: ${msg}`);
  console.error('usage: node scripts/build-pack-index.mjs [--target <project-dir>] [--out <file>] [--home <dir>]');
  process.exit(msg ? 1 : 0);
}

const args = process.argv.slice(2);
let target = null;
let out = null;
let home = homedir();

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--help' || a === '-h') usage();
  else if (a === '--target') { target = args[++i] ?? usage('--target requires a directory'); }
  else if (a === '--out') { out = args[++i] ?? usage('--out requires a file path'); }
  else if (a === '--home') { home = args[++i] ?? usage('--home requires a directory'); }
  else usage(`unknown argument '${a}'`);
}

function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function dirHasFiles(p) {
  try { return readdirSync(p).length > 0; } catch { return false; }
}

// Roots listed in ascending precedence so later scans override earlier ones.
const roots = [
  { source: 'builtin', path: resolve(join(REPO_ROOT, 'packs')) },
  { source: 'user', path: resolve(join(home, '.claude', 'polyrig-packs')) },
];
if (target !== null) {
  if (!isDir(target)) usage(`--target directory does not exist: ${resolve(target)}`);
  roots.push({ source: 'project', path: resolve(join(target, '.polyrig', 'packs')) });
}

const byId = new Map(); // id -> pack record (highest-precedence wins)
const overrides = [];

for (const root of roots) {
  root.exists = isDir(root.path);
  if (!root.exists) continue;
  for (const { dir, hasPackYaml } of listPackDirs(root.path)) {
    if (!hasPackYaml) continue; // placeholder (e.g. only .gitkeep)
    let meta;
    try {
      meta = parseYamlFile(join(dir, 'pack.yaml'));
    } catch (err) {
      if (err instanceof YamlError) {
        console.error(`warning: skipping ${dir}: ${err.message}`);
        continue;
      }
      throw err;
    }
    if (meta === null || typeof meta !== 'object' || typeof meta.id !== 'string') {
      console.error(`warning: skipping ${dir}: pack.yaml has no usable 'id'`);
      continue;
    }
    const record = {
      id: meta.id,
      type: meta.type ?? null,
      version: meta.version ?? null,
      summary: meta.summary ?? null,
      last_reviewed: meta.last_reviewed ?? null,
      requires: Array.isArray(meta.requires) ? meta.requires : [],
      conflicts: Array.isArray(meta.conflicts) ? meta.conflicts : [],
      provides: Array.isArray(meta.provides) ? meta.provides : [],
      stacks: Array.isArray(meta.stacks) ? meta.stacks : [],
      source: root.source,
      path: resolve(dir),
      has_scripts: isDir(join(dir, 'scripts')) && dirHasFiles(join(dir, 'scripts')),
    };
    const existing = byId.get(meta.id);
    if (existing) {
      // Roots are scanned in ascending precedence, so the new record wins.
      overrides.push({ id: meta.id, winner_source: root.source, loser_source: existing.source });
    }
    byId.set(meta.id, record);
  }
}

const index = {
  generated_at: new Date().toISOString(),
  roots: roots.map(({ source, path, exists }) => ({ source, path, exists: exists === true })),
  packs: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
  overrides,
};

const json = JSON.stringify(index, null, 2) + '\n';
if (out) {
  const outPath = resolve(out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, json);
  console.error(`wrote pack index (${index.packs.length} packs, ${overrides.length} overrides) to ${outPath}`);
} else {
  process.stdout.write(json);
}
