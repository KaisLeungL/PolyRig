#!/usr/bin/env node
// pack-group.mjs — bundle a PolyRig group and its members into a single
// .tar.gz for upload to a PolyRig registry. Client-side upload preparation,
// the mirror of install-pack.mjs (download side).
//
// Usage:
//   node scripts/pack-group.mjs <group.yaml | group-dir> [--roots <dir,dir,...>] [--out <file>]
//
//   --roots  Comma-separated discovery roots used to resolve member and
//            group-level `requires` pack ids. Default: this repository's packs/.
//            When given, the listed roots REPLACE the default.
//   --out    Output archive path. Default: tmp/<name>-<version>.tar.gz
//            (tmp/ is gitignored; the bundle is transport only and may be
//            deleted after upload).
//
// The group stays reference-style on disk (members live in packs/<type>/<name>/,
// group.yaml lives in groups/<name>/). This script reads those scattered paths
// and streams them into ONE bundle laid out how the registry's find_group_layout
// expects:
//     <bundle>/group.yaml
//     <bundle>/packs/<type>/<name>/...   (one subtree per member)
// No member content is copied on disk; files are read straight into the archive.
//
// Before bundling, the group is validated locally with validate-group.mjs's
// own logic (schema + the 6 invariants). A group that does not validate is
// never bundled — the registry re-validates anyway, but failing early is
// cheaper and clearer.

import {
  createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT, validateGroupFile } from './lib/validate.mjs';

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function usage(msg) {
  if (msg) console.error(`error: ${msg}`);
  console.error('usage: node scripts/pack-group.mjs <group.yaml | group-dir> [--roots <dir,dir,...>] [--out <file>]');
  process.exit(msg ? 1 : 0);
}

function parseArgs(argv) {
  const args = { _: [], roots: [join(REPO_ROOT, 'packs')], out: null };
  let rootsGiven = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') usage();
    else if (a === '--roots') {
      const v = argv[++i];
      if (!v) usage('--roots requires a comma-separated list of directories');
      args.roots = v.split(',').map((r) => resolve(r.trim())).filter(Boolean);
      if (args.roots.length === 0) usage('--roots was given but no roots were parsed');
      rootsGiven = true;
    } else if (a === '--out') {
      args.out = argv[++i] ?? usage('--out requires a file path');
    } else if (a.startsWith('--')) usage(`unknown option '${a}'`);
    else args._.push(a);
  }
  args.rootsGiven = rootsGiven;
  return args;
}

// Resolve the group.yaml path from either the file itself or its directory.
function resolveGroupYaml(arg) {
  let p = resolve(arg);
  try {
    if (statSync(p).isDirectory()) p = join(p, 'group.yaml');
  } catch { /* validateGroupFile reports a clear does-not-exist violation */ }
  return p;
}

// Locate a member pack directory (<root>/<type>/<name>) across discovery roots,
// most-specific-wins (later roots override earlier). Mirrors the resolution
// order validate/build-pack-index use.
function resolvePackDir(id, roots) {
  let found = null;
  for (const root of roots) {
    const dir = join(root, id);
    if (existsSync(join(dir, 'pack.yaml'))) found = dir;
  }
  return found;
}

// --- deterministic ustar writer -------------------------------------------
// uid/gid 0, mtime 0, sorted entries. The registry re-normalizes each member
// server-side, so byte-determinism is not load-bearing here — it just keeps
// the bundle stable and the tests simple.

function tarHeader(name, size, typeflag, mode) {
  // ustar splits a >100-char path into name (<=100) + prefix (<=155).
  let prefix = '';
  let entryName = name;
  if (Buffer.byteLength(name) > 100) {
    const slash = name.lastIndexOf('/', name.length - 1);
    // Walk back to a split point that fits both fields.
    let cut = slash;
    while (cut > 0 && Buffer.byteLength(name.slice(cut + 1)) > 100) {
      cut = name.lastIndexOf('/', cut - 1);
    }
    if (cut <= 0 || Buffer.byteLength(name.slice(0, cut)) > 155
        || Buffer.byteLength(name.slice(cut + 1)) > 100) {
      fail(`path too long for tar (ustar) format: ${name}`);
    }
    prefix = name.slice(0, cut);
    entryName = name.slice(cut + 1);
  }
  const buf = Buffer.alloc(512);
  buf.write(entryName, 0, 100, 'utf8');
  buf.write(`${mode.toString(8).padStart(7, '0')}\0`, 100, 8);
  buf.write('0000000\0', 108, 8); // uid 0
  buf.write('0000000\0', 116, 8); // gid 0
  buf.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 12);
  buf.write('00000000000\0', 136, 12); // mtime 0
  buf.write('        ', 148, 8); // checksum placeholder (spaces)
  buf[156] = typeflag.charCodeAt(0);
  buf.write('ustar\0', 257, 6);
  buf.write('00', 263, 2);
  if (prefix) buf.write(prefix, 345, 155, 'utf8');
  let sum = 0;
  for (const b of buf) sum += b;
  buf.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
  return buf;
}

function pad512(size) {
  const rem = size % 512;
  return rem === 0 ? Buffer.alloc(0) : Buffer.alloc(512 - rem);
}

// Collect { arcname, absPath, isDir } entries for a directory subtree, sorted.
function walk(dir, arcPrefix, out) {
  const entries = readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    const abs = join(dir, e.name);
    const arcname = `${arcPrefix}/${e.name}`;
    if (e.isDirectory()) {
      out.push({ arcname: `${arcname}/`, absPath: abs, isDir: true });
      walk(abs, arcname, out);
    } else if (e.isFile()) {
      out.push({ arcname, absPath: abs, isDir: false });
    } else {
      fail(`refusing to bundle non-regular file: ${abs}`);
    }
  }
}

function buildTar(entries) {
  const chunks = [];
  for (const entry of entries) {
    if (entry.isDir) {
      chunks.push(tarHeader(entry.arcname, 0, '5', 0o755));
    } else {
      const data = entry.data ?? readFileSync(entry.absPath);
      chunks.push(tarHeader(entry.arcname, data.length, '0', 0o644));
      chunks.push(data);
      chunks.push(pad512(data.length));
    }
  }
  chunks.push(Buffer.alloc(1024)); // two zero blocks terminate the archive
  return Buffer.concat(chunks);
}

// --- main -------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));
const groupArg = args._[0];
if (!groupArg) usage('missing <group.yaml | group-dir> argument');
if (args._.length > 1) usage(`unexpected extra argument '${args._[1]}'`);

const groupYamlPath = resolveGroupYaml(groupArg);

// 1. Validate the group locally before bundling (fail early).
const result = validateGroupFile(groupYamlPath, { roots: args.roots });
if (!result.ok) {
  console.error(`FAIL ${result.meta?.id ?? groupYamlPath} — ${result.violations.length} violation(s):`);
  for (const v of result.violations) console.error(`  - ${v}`);
  fail('group did not validate; nothing bundled');
}

const meta = result.meta;
const groupName = meta.id.split('/')[1];
const members = Array.isArray(meta.members) ? meta.members : [];

// 2. Assemble bundle entries: group.yaml at root + each member under packs/.
const entries = [];
entries.push({
  arcname: 'group.yaml',
  data: readFileSync(groupYamlPath),
  isDir: false,
});

for (const m of members) {
  const packDir = resolvePackDir(m.id, args.roots);
  if (!packDir) {
    fail(`member '${m.id}' does not resolve in any discovery root (${args.roots.join(', ')})`);
  }
  // validateGroupFile already checked version match; this is defensive.
  entries.push({ arcname: `packs/${m.id}/`, absPath: packDir, isDir: true });
  walk(packDir, `packs/${m.id}`, entries);
}

// 3. Write the .tar.gz. Default under tmp/ (gitignored, transport only).
const version = meta.version ?? '0.0.0';
const outPath = resolve(args.out ?? join(REPO_ROOT, 'tmp', `${groupName}-${version}.tar.gz`));
mkdirSync(dirname(outPath), { recursive: true });
const gz = gzipSync(buildTar(entries), { level: 9 });
writeFileSync(outPath, gz);

const fileCount = entries.filter((e) => !e.isDir).length;
console.log(`OK bundled ${meta.id}@${version} (${members.length} member(s), ${fileCount} file(s)) -> ${outPath}`);
console.log('Upload this archive to your PolyRig registry (browser upload); it is transport only and can be deleted after.');
