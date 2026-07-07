#!/usr/bin/env node
// inject-pack-skills.mjs — inject (symlink) or reclaim pack-carried skills for a
// PolyRig-injected project. Skills live as data in the project's vault at
// <project>/.polyrig/vault/<stacks|domains>/<short-id>/skills/<skill>/; this tool
// symlinks them into the project's own agent trigger directories so the agent
// discovers them. Decision C: project-level symlink, detection-driven,
// original-name (collision → skip/rename), registered in manifest linked_skills.
//
// Usage:
//   node scripts/inject-pack-skills.mjs inject  [--project <dir>] [--pack <id>]...
//        [--platform <name>]... [--create <name>] [--rename <skill>=<new>]...
//        [--skip <skill>]... [--yes]
//   node scripts/inject-pack-skills.mjs reclaim [--project <dir>] [--yes]
//
// Trust (decision C2): injecting a symlink + committing it to git IS the gate
// (registry review + git merge). No activation concept, no local confirm ledger.
// Platform scope: only claude-code / codex have a skills directory. Claude Code
// scans .claude/skills/*/SKILL.md ONE level deep, so symlinks land flat.

import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync,
  symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// platform -> in-project trigger dir segments
const PLATFORM_DIRS = {
  'claude-code': ['.claude', 'skills'],
  codex: ['.codex', 'skills'],
};
const VAULT_REL = ['.polyrig', 'vault'];
const MANIFEST_REL = ['.polyrig', 'manifest.json'];
// vault type-dir -> pack-id type prefix
const TYPE_SINGULAR = { stacks: 'stack', domains: 'domain' };

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { _: [], packs: [], platforms: [], create: [], rename: new Map(), skip: new Set(), yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project') args.project = argv[++i];
    else if (a === '--pack') args.packs.push(argv[++i]);
    else if (a === '--platform') args.platforms.push(argv[++i]);
    else if (a === '--create') args.create.push(argv[++i]);
    else if (a === '--rename') { const [k, v] = String(argv[++i]).split('='); if (!k || !v) fail('--rename expects <skill>=<newname>'); args.rename.set(k, v); }
    else if (a === '--skip') args.skip.add(argv[++i]);
    else if (a === '--yes') args.yes = true;
    else if (a.startsWith('--')) fail(`unknown option '${a}'`);
    else args._.push(a);
  }
  for (const p of args.platforms) if (!PLATFORM_DIRS[p]) fail(`unknown platform '${p}' (known: ${Object.keys(PLATFORM_DIRS).join(', ')})`);
  for (const p of args.create) if (!PLATFORM_DIRS[p]) fail(`unknown platform '${p}' for --create`);
  return args;
}

function isDir(p) { try { return lstatSync(p).isDirectory(); } catch { return false; } }
function isFile(p) { try { return lstatSync(p).isFile(); } catch { return false; } }

function readManifest(projectRoot) {
  const p = join(projectRoot, ...MANIFEST_REL);
  if (!isFile(p)) fail(`no .polyrig/manifest.json at ${projectRoot}; run /polyrig first`);
  try { return { path: p, data: JSON.parse(readFileSync(p, 'utf8')) }; }
  catch (err) { fail(`cannot parse ${p}: ${err.message}`); }
}

function writeManifest(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

// Enumerate injectable skills from the project's vault. Returns
// [{ pack, skill, srcDir }] with pack in "<type>/<short-id>" (singular) form.
function collectVaultSkills(projectRoot, packFilter) {
  const vaultRoot = join(projectRoot, ...VAULT_REL);
  const out = [];
  for (const [typePlural, typeSingular] of Object.entries(TYPE_SINGULAR)) {
    const typeDir = join(vaultRoot, typePlural);
    if (!isDir(typeDir)) continue;
    for (const shortId of readdirSync(typeDir)) {
      const skillsDir = join(typeDir, shortId, 'skills');
      if (!isDir(skillsDir)) continue;
      const pack = `${typeSingular}/${shortId}`;
      if (packFilter.length && !packFilter.includes(pack)) continue;
      for (const skill of readdirSync(skillsDir)) {
        const srcDir = join(skillsDir, skill);
        if (isDir(srcDir) && isFile(join(srcDir, 'SKILL.md'))) out.push({ pack, skill, srcDir });
      }
    }
  }
  return out;
}

function detectPlatformDirs(projectRoot) {
  return Object.keys(PLATFORM_DIRS).filter((p) => isDir(join(projectRoot, ...PLATFORM_DIRS[p])));
}

async function confirm(question, yes) {
  if (yes) return true;
  if (!process.stdin.isTTY) {
    fail(`confirmation required: ${question}\nre-run with --yes after the user has confirmed the plan`);
  }
  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
  rl.close();
  return answer === 'y' || answer === 'yes';
}

// Classify a prospective symlink target already on disk.
function destStatus(target, srcDir) {
  let st;
  try { st = lstatSync(target); } catch { return 'absent'; }
  if (st.isSymbolicLink()) {
    try { if (realpathSync(target) === realpathSync(srcDir)) return 'correct-symlink'; } catch { /* dangling */ }
    return 'other-symlink';
  }
  return st.isDirectory() ? 'directory' : 'file';
}

async function cmdInject(projectRoot, args) {
  const skills = collectVaultSkills(projectRoot, args.packs);
  if (skills.length === 0) { console.log('NOOP no pack-carried skills found in .polyrig/vault'); return; }

  // Same-batch collision: the same skill name from >1 pack is ambiguous (decision C3).
  const byName = new Map();
  for (const s of skills) byName.set(s.skill, (byName.get(s.skill) ?? 0) + 1);
  const clashing = [...byName.entries()].filter(([, n]) => n > 1).map(([n]) => n);
  if (clashing.length) fail(`skill name(s) [${clashing.join(', ')}] are carried by more than one selected pack; disambiguate with --pack`);

  // Resolve target platforms.
  let platforms = args.platforms.length ? args.platforms : detectPlatformDirs(projectRoot);
  if (platforms.length === 0) {
    if (args.create.length) {
      platforms = args.create;
      for (const p of platforms) mkdirSync(join(projectRoot, ...PLATFORM_DIRS[p]), { recursive: true });
    } else if (process.stdin.isTTY) {
      const known = Object.keys(PLATFORM_DIRS).join(', ');
      if (!(await confirm(`no agent skill directory found; create .claude/skills and inject?`, false))) fail('aborted: no target platform');
      platforms = ['claude-code'];
      mkdirSync(join(projectRoot, ...PLATFORM_DIRS['claude-code']), { recursive: true });
      void known;
    } else {
      fail('no agent skill directory found; re-run with --create <claude-code|codex>');
    }
  } else {
    // Ensure any explicitly-requested --create platform dirs exist.
    for (const p of args.create) mkdirSync(join(projectRoot, ...PLATFORM_DIRS[p]), { recursive: true });
    platforms = [...new Set([...platforms, ...args.create])];
  }

  // Build plan.
  const plan = [];
  for (const s of skills) {
    const linkName = args.rename.get(s.skill) ?? s.skill;
    for (const platform of platforms) {
      const target = join(projectRoot, ...PLATFORM_DIRS[platform], linkName);
      plan.push({ ...s, platform, linkName, target });
    }
  }

  console.log(`PLAN inject ${skills.length} skill(s) into: ${platforms.join(', ')}`);
  for (const item of plan) {
    const status = destStatus(item.target, item.srcDir);
    const flag = status === 'correct-symlink' ? ' [already linked]'
      : (status === 'absent' ? '' : (args.skip.has(item.skill) ? ' [COLLISION: skip]' : (args.rename.has(item.skill) ? ' [renamed]' : ' [COLLISION]')));
    console.log(`PLAN   ${item.pack}/${item.skill} -> ${item.target}${flag}`);
  }
  if (!(await confirm(`Inject ${plan.length} symlink(s)?`, args.yes))) fail('aborted by user');

  const { path: manifestPath, data: manifest } = readManifest(projectRoot);
  if (!Array.isArray(manifest.linked_skills)) manifest.linked_skills = [];
  const linked = [];

  for (const item of plan) {
    const status = destStatus(item.target, item.srcDir);
    if (status === 'correct-symlink') { console.log(`NOOP ${item.pack}/${item.skill} already linked at ${item.target}`); linked.push(item); continue; }
    if (status !== 'absent') {
      if (args.skip.has(item.skill)) { console.log(`SKIP ${item.pack}/${item.skill} — ${status} exists at ${item.target}`); continue; }
      // rename already reflected in linkName/target; if still colliding, cannot resolve non-interactively.
      console.log(`SKIP ${item.pack}/${item.skill} — unresolved collision (${status}) at ${item.target}; pass --skip ${item.skill} or --rename ${item.skill}=<new>`);
      continue;
    }
    mkdirSync(dirname(item.target), { recursive: true });
    symlinkSync(item.srcDir, item.target, 'dir');
    console.log(`OK linked ${item.pack}/${item.skill} -> ${item.target}`);
    linked.push(item);
  }

  // Register (dedupe by target).
  let added = 0;
  for (const item of linked) {
    const record = { pack: item.pack, skill: item.skill, linked_as: item.linkName, target: item.target };
    if (!manifest.linked_skills.some((e) => e.target === record.target)) { manifest.linked_skills.push(record); added += 1; }
  }
  writeManifest(manifestPath, manifest);
  console.log(`OK linked_skills updated (+${added}, ${manifest.linked_skills.length} total)`);
}

function cmdReclaim(projectRoot, args) {
  const { path: manifestPath, data: manifest } = readManifest(projectRoot);
  const entries = Array.isArray(manifest.linked_skills) ? manifest.linked_skills : [];
  if (entries.length === 0) { console.log('NOOP no linked skills to reclaim'); return; }

  // Canonicalize the vault root so the symlink-target check survives macOS
  // /var -> /private/var realpath resolution.
  const vaultRootRaw = resolve(projectRoot, ...VAULT_REL);
  let vaultRoot = vaultRootRaw;
  try { vaultRoot = realpathSync(vaultRootRaw); } catch { /* vault may not exist */ }
  const kept = [];
  for (const e of entries) {
    const target = e.target;
    let st;
    try { st = lstatSync(target); } catch { console.log(`NOOP ${e.pack}/${e.skill} absent (${target})`); continue; }
    if (st.isSymbolicLink()) {
      let real = null;
      try { real = realpathSync(target); } catch { /* dangling */ }
      if (real && (real === vaultRoot || real.startsWith(`${vaultRoot}/`))) {
        unlinkSync(target);
        console.log(`OK unlinked ${e.pack}/${e.skill} (${target})`);
        continue;
      }
    }
    console.log(`SKIP ${e.pack}/${e.skill} not-a-managed-symlink (${target}); left in place and in manifest`);
    kept.push(e);
  }
  manifest.linked_skills = kept;
  writeManifest(manifestPath, manifest);
  console.log(`OK reclaim done (${kept.length} entr(y|ies) retained)`);
}

const [command, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
if (command === '--help' || command === '-h' || command === undefined) {
  console.log('usage: inject-pack-skills.mjs <inject|reclaim> [--project <dir>] [options] (see file header)');
  process.exit(command === undefined ? 1 : 0);
}
const projectRoot = resolve(args.project ?? process.cwd());
if (command === 'inject') await cmdInject(projectRoot, args);
else if (command === 'reclaim') cmdReclaim(projectRoot, args);
else fail(`unknown command '${command}' (expected inject | reclaim)`);
