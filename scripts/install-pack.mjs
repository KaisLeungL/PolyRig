#!/usr/bin/env node
// install-pack.mjs — download, verify, and install PolyRig packs from the
// PolyRig registry. Deterministic helper behind the polyrig-pack-install skill.
//
// Usage:
//   node scripts/install-pack.mjs install <canonical-url> [options]
//   node scripts/install-pack.mjs update <pack-id> [options]
//   node scripts/install-pack.mjs update --all [options]
//
// Options:
//   --dest <dir>          Install root (default ~/.polyrig/packs)
//   --registry <url>      Registry base URL (default $POLYRIG_REGISTRY_URL)
//   --token <token>       Bearer token for private packs (default $POLYRIG_REGISTRY_TOKEN)
//   --replace             Replace an existing install of the same pack id
//   --yes                 Non-interactive confirmation (the skill layer asks the user)
//   --allow-deprecated    Permit installing a deprecated version
//
// Security contract (registry spec):
//   - Only the registry's canonical HTTPS URLs are accepted; arbitrary
//     artifact URLs and third-party hosts are rejected.
//   - sha256 must match the registry metadata.
//   - Archives are unpacked safely (no absolute paths, no '..', no links).
//   - The pack is re-validated locally with PolyRig's own validate-pack.mjs.
//   - Pack scripts/ are never executed.

import { createHash } from 'node:crypto';
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const VALIDATOR = join(SCRIPT_DIR, 'validate-pack.mjs');
const INSTALL_META = '.polyrig-install.json';

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { _: [], replace: false, yes: false, allowDeprecated: false, all: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dest') args.dest = argv[++i];
    else if (a === '--registry') args.registry = argv[++i];
    else if (a === '--token') args.token = argv[++i];
    else if (a === '--replace') args.replace = true;
    else if (a === '--yes') args.yes = true;
    else if (a === '--allow-deprecated') args.allowDeprecated = true;
    else if (a === '--all') args.all = true;
    else if (a.startsWith('--')) fail(`unknown option '${a}'`);
    else args._.push(a);
  }
  return args;
}

function registryBase(args) {
  const base = args.registry ?? process.env.POLYRIG_REGISTRY_URL;
  if (!base) fail('registry URL not set; export POLYRIG_REGISTRY_URL or pass --registry');
  return new URL(base).origin;
}

function registryToken(args) {
  return args.token ?? process.env.POLYRIG_REGISTRY_TOKEN ?? null;
}

function authHeaders(token) {
  return {
    accept: 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

// Public canonical URL:  {origin}/packs/{type}/{name}/versions/{version}
// Private canonical URL: {origin}/orgs/{slug}/packs/{type}/{name}/versions/{version}
function parseCanonicalUrl(rawUrl, origin) {
  let url;
  try { url = new URL(rawUrl); } catch { fail(`not a valid URL: ${rawUrl}`); }
  if (url.origin !== origin) {
    fail(`only the PolyRig registry at ${origin} is allowed; refusing ${url.origin}`);
  }
  const m = url.pathname.match(
    /^(?:\/orgs\/([a-z0-9-]+))?\/packs\/(stack|domain)\/([a-z0-9-]+)\/versions\/([^/]+)\/?$/,
  );
  if (!m) fail(`not a canonical pack version URL: ${rawUrl}`);
  return { orgSlug: m[1] ?? null, type: m[2], name: m[3], version: m[4] };
}

// Metadata / updates paths differ for private (org-scoped) packs. The org slug
// is carried on each resolved dependency's canonical_url so deps resolve too.
function metadataPath(origin, orgSlug, type, name, version) {
  const base = orgSlug ? `${origin}/api/orgs/${orgSlug}/packs` : `${origin}/api/packs`;
  return `${base}/${type}/${name}/versions/${version}/install-metadata`;
}

function updatesPath(origin, orgSlug, type, name, currentVersion) {
  const base = orgSlug ? `${origin}/api/orgs/${orgSlug}/packs` : `${origin}/api/packs`;
  return `${base}/${type}/${name}/updates?current_version=${encodeURIComponent(currentVersion)}`;
}

function orgSlugFromMeta(meta, origin) {
  if (meta.organization_slug) return meta.organization_slug;
  try {
    const m = new URL(meta.canonical_url).pathname.match(/^\/orgs\/([a-z0-9-]+)\//);
    return m ? m[1] : null;
  } catch { return null; }
}

async function fetchJson(url, token) {
  const resp = await fetch(url, { headers: authHeaders(token) });
  if (!resp.ok) fail(`GET ${url} -> HTTP ${resp.status}`);
  return resp.json();
}

async function fetchMetadata(origin, orgSlug, type, name, version, token) {
  return fetchJson(metadataPath(origin, orgSlug, type, name, version), token);
}

async function downloadArtifact(origin, meta, token) {
  if (!meta.artifact_url) fail(`no artifact available for ${meta.id}@${meta.version} (status: ${meta.status})`);
  const artifactUrl = new URL(meta.artifact_url);
  if (artifactUrl.origin !== origin) {
    fail(`artifact URL ${artifactUrl.origin} is not the registry origin ${origin}; refusing`);
  }
  const resp = await fetch(artifactUrl, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!resp.ok) fail(`artifact download failed: HTTP ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  const digest = `sha256:${createHash('sha256').update(buf).digest('hex')}`;
  if (digest !== meta.sha256) {
    fail(`sha256 mismatch for ${meta.id}@${meta.version}: metadata ${meta.sha256}, downloaded ${digest}`);
  }
  return buf;
}

// --- minimal ustar reader (artifacts are the registry's normalized tar.gz) ---

function readStr(block, offset, length) {
  const slice = block.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return slice.toString('utf8', 0, end === -1 ? length : end);
}

function* tarEntries(tarBuf) {
  let off = 0;
  while (off + 512 <= tarBuf.length) {
    const block = tarBuf.subarray(off, off + 512);
    if (block.every((b) => b === 0)) return;
    const name = readStr(block, 0, 100);
    const prefix = readStr(block, 345, 155);
    const size = parseInt(readStr(block, 124, 12).trim() || '0', 8);
    const typeflag = String.fromCharCode(block[156]) || '0';
    off += 512;
    const data = tarBuf.subarray(off, off + size);
    off += Math.ceil(size / 512) * 512;
    yield { name: prefix ? `${prefix}/${name}` : name, typeflag, size, data };
  }
}

function safeExtractTarGz(buf, destDir) {
  const tarBuf = gunzipSync(buf);
  mkdirSync(destDir, { recursive: true });
  for (const entry of tarEntries(tarBuf)) {
    const parts = entry.name.split('/').filter(Boolean);
    if (entry.name.startsWith('/') || parts.includes('..')) {
      fail(`unsafe path in artifact: ${entry.name}`);
    }
    if (entry.typeflag === '2' || entry.typeflag === '1') {
      fail(`link entry in artifact: ${entry.name}`);
    }
    const target = join(destDir, ...parts);
    if (!resolve(target).startsWith(resolve(destDir))) fail(`unsafe path in artifact: ${entry.name}`);
    if (entry.typeflag === '5') {
      mkdirSync(target, { recursive: true });
    } else if (entry.typeflag === '0' || entry.typeflag === '\0') {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, entry.data);
    } else {
      fail(`unsupported entry type '${entry.typeflag}' in artifact: ${entry.name}`);
    }
  }
}

function validateLocally(packDir, installRoot) {
  if (!existsSync(VALIDATOR)) fail(`vendored validator not found at ${VALIDATOR}`);
  const stageRoot = dirname(dirname(packDir));
  const proc = spawnSync(
    'node',
    [VALIDATOR, packDir, '--roots', `${stageRoot},${installRoot}`],
    { encoding: 'utf8' },
  );
  if (proc.status !== 0) {
    fail(`local validate-pack failed for ${packDir}:\n${proc.stdout}${proc.stderr}`);
  }
}

function defaultDest() {
  return join(homedir(), '.polyrig', 'packs');
}

function installedMeta(destRoot, type, name) {
  const p = join(destRoot, type, name, INSTALL_META);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

async function confirm(question, args) {
  if (args.yes) return true;
  if (!process.stdin.isTTY) {
    fail(`confirmation required: ${question}\nre-run with --yes after the user has confirmed the plan`);
  }
  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
  rl.close();
  return answer === 'y' || answer === 'yes';
}

function printPlan(steps, destRoot) {
  console.log(`PLAN install root: ${destRoot}`);
  for (const s of steps) {
    const flags = [
      s.meta.status === 'deprecated' ? 'DEPRECATED' : null,
      s.meta.has_scripts ? 'HAS-SCRIPTS(disabled, never executed)' : null,
      s.reason,
    ].filter(Boolean).join(', ');
    console.log(`PLAN   ${s.meta.id}@${s.meta.version} sha256=${(s.meta.sha256 ?? '').slice(0, 19)}… publisher=${s.meta.publisher_slug}${flags ? ` [${flags}]` : ''}`);
    if (s.meta.release_notes) console.log(`PLAN     release_notes: ${s.meta.release_notes}`);
  }
}

async function collectPlan(origin, meta, destRoot, args, reason, token) {
  // Dependencies first, frozen at publish time (resolved_requires). A private
  // pack's deps live under the same org namespace as the pack itself.
  const orgSlug = orgSlugFromMeta(meta, origin);
  const steps = [];
  for (const req of meta.resolved_requires ?? []) {
    if (!req.version) fail(`dependency ${req.id} has no resolved published version`);
    const [type, name] = req.id.split('/');
    const installed = installedMeta(destRoot, type, name);
    if (installed && installed.version === req.version) continue;
    const depMeta = await fetchMetadata(origin, orgSlug, type, name, req.version, token);
    steps.push({ meta: depMeta, reason: `dependency of ${meta.id}` });
  }
  steps.push({ meta, reason });
  return steps;
}

// Fail before anything is written: a blocked step must not leave earlier
// steps (dependencies) half-installed.
function preflightConflicts(steps, destRoot, targetId, { replaceTarget }) {
  for (const step of steps) {
    const [type, name] = step.meta.id.split('/');
    const dir = join(destRoot, type, name);
    if (!existsSync(dir)) continue;
    const existing = installedMeta(destRoot, type, name);
    if (existing && existing.sha256 === step.meta.sha256) continue; // no-op later
    const isTarget = step.meta.id === targetId;
    if (!(isTarget && replaceTarget)) {
      const have = existing ? `version ${existing.version}` : 'unmanaged content';
      fail(`${step.meta.id} is already installed at ${dir} with ${have}; pass --replace to replace it`);
    }
  }
}

function checkStatusInstallable(meta, args) {
  if (meta.status === 'removed') {
    fail(`${meta.id}@${meta.version} has been removed from the registry and cannot be installed`);
  }
  if (meta.status === 'deprecated' && !args.allowDeprecated) {
    fail(`${meta.id}@${meta.version} is deprecated; re-run with --allow-deprecated to install anyway`);
  }
  if (meta.status !== 'published' && meta.status !== 'deprecated') {
    fail(`${meta.id}@${meta.version} is not installable (status: ${meta.status})`);
  }
}

async function installOne(origin, meta, destRoot, { replace }, token) {
  const [type, name] = meta.id.split('/');
  const finalDir = join(destRoot, type, name);
  const existing = installedMeta(destRoot, type, name);

  if (existing && existing.sha256 === meta.sha256) {
    console.log(`NOOP ${meta.id}@${meta.version} already installed (same sha256)`);
    return false;
  }
  if (existsSync(finalDir) && !replace) {
    const have = existing ? `${existing.version} (${existing.sha256?.slice(0, 19)}…)` : 'unmanaged content';
    fail(`${meta.id} is already installed at ${finalDir} with ${have}; pass --replace to replace it`);
  }

  const buf = await downloadArtifact(origin, meta, token);
  const tmp = mkdtempSync(join(tmpdir(), 'polyrig-install-'));
  try {
    const staged = join(tmp, 'stage', type, name);
    safeExtractTarGz(buf, staged);
    validateLocally(staged, destRoot);

    if (existsSync(finalDir)) rmSync(finalDir, { recursive: true });
    mkdirSync(dirname(finalDir), { recursive: true });
    cpSync(staged, finalDir, { recursive: true });

    const artifactId = meta.artifact_url.match(/\/api\/artifacts\/([^/]+)\/download/)?.[1] ?? null;
    writeFileSync(join(finalDir, INSTALL_META), `${JSON.stringify({
      source: 'remote',
      registry_url: origin,
      canonical_url: meta.canonical_url,
      artifact_id: artifactId,
      pack_id: meta.id,
      version: meta.version,
      sha256: meta.sha256,
      publisher_slug: meta.publisher_slug,
      installed_at: new Date().toISOString(),
    }, null, 2)}\n`);
    console.log(`OK installed ${meta.id}@${meta.version} -> ${finalDir}`);
    return true;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function cmdInstall(args) {
  const origin = registryBase(args);
  const token = registryToken(args);
  const destRoot = resolve(args.dest ?? defaultDest());
  const canonical = args._[0];
  if (!canonical) fail('usage: install <canonical-url>');
  const { orgSlug, type, name, version } = parseCanonicalUrl(canonical, origin);
  const meta = await fetchMetadata(origin, orgSlug, type, name, version, token);
  checkStatusInstallable(meta, args);

  const [mType, mName] = meta.id.split('/');
  const existing = installedMeta(destRoot, mType, mName);
  if (existing && existing.sha256 === meta.sha256) {
    console.log(`NOOP ${meta.id}@${meta.version} already installed (same sha256)`);
    return;
  }

  const steps = await collectPlan(origin, meta, destRoot, args, existing ? `replaces ${existing.version}` : 'new install', token);
  for (const step of steps) checkStatusInstallable(step.meta, args);
  preflightConflicts(steps, destRoot, meta.id, { replaceTarget: args.replace });
  printPlan(steps, destRoot);
  if (!(await confirm(`Install ${steps.length} pack(s) to ${destRoot}?`, args))) {
    fail('aborted by user');
  }
  for (const step of steps) {
    const isDep = step.meta.id !== meta.id;
    await installOne(origin, step.meta, destRoot, { replace: args.replace && !isDep }, token);
  }
}

function orgSlugFromInstalled(installed, origin) {
  if (!installed?.canonical_url) return null;
  try {
    const m = new URL(installed.canonical_url).pathname.match(/^\/orgs\/([a-z0-9-]+)\//);
    return m ? m[1] : null;
  } catch { return null; }
}

async function updateOne(origin, destRoot, packId, args, token) {
  const [type, name] = packId.split('/');
  const installed = installedMeta(destRoot, type, name);
  if (!installed) fail(`${packId} is not installed from the registry at ${destRoot}`);

  const orgSlug = orgSlugFromInstalled(installed, origin);
  const info = await fetchJson(
    updatesPath(origin, orgSlug, type, name, installed.version),
    token,
  );
  if (info.up_to_date) {
    console.log(`NOOP ${packId}@${installed.version} is already the latest published version`);
    return;
  }
  const meta = info.latest;
  checkStatusInstallable(meta, args);

  const oldReq = JSON.stringify(installed.resolved_requires ?? []);
  const steps = await collectPlan(origin, meta, destRoot, args, `update ${installed.version} -> ${meta.version}`, token);
  preflightConflicts(steps, destRoot, meta.id, { replaceTarget: true });
  printPlan(steps, destRoot);
  const newReq = JSON.stringify(meta.resolved_requires ?? []);
  if (oldReq !== newReq) {
    console.log(`PLAN   resolved_requires changed: ${oldReq} -> ${newReq}`);
  }
  if (!(await confirm(`Update ${packId} to ${meta.version}?`, args))) fail('aborted by user');
  for (const step of steps) {
    const isTarget = step.meta.id === meta.id;
    await installOne(origin, step.meta, destRoot, { replace: isTarget }, token);
  }
}

async function cmdUpdate(args) {
  const origin = registryBase(args);
  const token = registryToken(args);
  const destRoot = resolve(args.dest ?? defaultDest());
  if (args.all) {
    const ids = [];
    for (const type of ['stack', 'domain']) {
      const typeDir = join(destRoot, type);
      if (!existsSync(typeDir)) continue;
      for (const name of readdirSync(typeDir)) {
        if (installedMeta(destRoot, type, name)) ids.push(`${type}/${name}`);
      }
    }
    if (ids.length === 0) { console.log('NOOP no registry-installed packs found'); return; }
    for (const id of ids) await updateOne(origin, destRoot, id, args, token);
    return;
  }
  const packId = args._[0];
  if (!packId || !/^(stack|domain)\/[a-z0-9-]+$/.test(packId)) {
    fail('usage: update <stack|domain>/<name> | update --all');
  }
  await updateOne(origin, destRoot, packId, args, token);
}

const [command, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
if (command === 'install') await cmdInstall(args);
else if (command === 'update') await cmdUpdate(args);
else fail("usage: install-pack.mjs <install|update> ...  (see file header)");
