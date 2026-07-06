#!/usr/bin/env node
// test-install-pack.mjs — end-to-end tests for install-pack.mjs against a
// local fake registry (HTTP server serving install-metadata + artifacts).
// Run: node scripts/test-install-pack.mjs

import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const INSTALLER = join(SCRIPT_DIR, 'install-pack.mjs');
const FIXTURE = join(SCRIPT_DIR, 'fixtures', 'registry-pack');

// --- minimal ustar writer -----------------------------------------------

function tarHeader(name, size, typeflag) {
  const buf = Buffer.alloc(512);
  buf.write(name, 0, 100, 'utf8');
  buf.write('0000644\0', 100, 8);
  buf.write('0000000\0', 108, 8);
  buf.write('0000000\0', 116, 8);
  buf.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 12);
  buf.write('00000000000\0', 136, 12);
  buf.write('        ', 148, 8);
  buf[156] = typeflag.charCodeAt(0);
  buf.write('ustar\0', 257, 6);
  buf.write('00', 263, 2);
  let sum = 0;
  for (const b of buf) sum += b;
  buf.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
  return buf;
}

function makeTarGz(files) {
  const chunks = [];
  for (const [name, content] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    chunks.push(tarHeader(name, data.length, '0'), data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) chunks.push(Buffer.alloc(pad));
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks));
}

// --- fixture packs --------------------------------------------------------

function packYaml(id, version, requires = '[]') {
  const [type] = id.split('/');
  return [
    `id: ${id}`, `type: ${type}`, `version: ${version}`,
    'last_reviewed: 2026-07-05',
    `summary: Registry install test pack ${id}.`,
    `requires: ${requires}`, 'conflicts: []',
    'provides: [hello-registry-demo]', 'stacks: []', '',
  ].join('\n');
}

function fixtureFiles(id, version, requires) {
  const files = {};
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(p, rel);
      else files[rel] = readFileSync(p);
    }
  };
  walk(FIXTURE, '');
  files['pack.yaml'] = Buffer.from(packYaml(id, version, requires));
  return files;
}

// --- fake registry --------------------------------------------------------

const packs = new Map(); // "type/name/version" -> {status, artifact, sha256, requires:[], notes, orgSlug}
let nextArtifact = 1;
const PRIVATE_TOKEN = 'test-token';

function addPack(id, version, { status = 'published', requires = [], reqYaml = '[]', notes = 'test release', corruptSha = false, orgSlug = null } = {}) {
  const artifact = makeTarGz(fixtureFiles(id, version, reqYaml));
  const sha = createHash('sha256').update(artifact).digest('hex');
  packs.set(`${orgSlug ? `orgs/${orgSlug}/` : ''}${id}/${version}`, {
    id, version, status, artifact, orgSlug,
    sha256: `sha256:${corruptSha ? '0'.repeat(64) : sha}`,
    artifactId: `art_${nextArtifact++}`,
    requires, notes,
  });
}

addPack('domain/hello-registry', '0.1.0');
addPack('domain/hello-registry', '0.2.0', {
  requires: [{ id: 'domain/hello-dep', version: '0.1.0' }],
  reqYaml: '[domain/hello-dep]',
  notes: 'Adds hello-dep dependency.',
});
addPack('domain/hello-dep', '0.1.0');
addPack('domain/old-pack', '0.1.0', { status: 'deprecated' });
addPack('domain/gone-pack', '0.1.0', { status: 'removed' });
addPack('domain/corrupt-pack', '0.1.0', { corruptSha: true });
// Private, org-scoped pack: only reachable with the org's bearer token.
addPack('domain/private-pack', '0.1.0', { orgSlug: 'acme', notes: 'private release' });

let origin = '';

function bearer(req) {
  const h = req.headers.authorization ?? '';
  const [scheme, value] = h.split(' ');
  return scheme?.toLowerCase() === 'bearer' ? (value ?? '').trim() : null;
}

function metadataFor(entry) {
  const downloadable = entry.status === 'published' || entry.status === 'deprecated';
  const canonical = entry.orgSlug
    ? `${origin}/orgs/${entry.orgSlug}/packs/${entry.id}/versions/${entry.version}`
    : `${origin}/packs/${entry.id}/versions/${entry.version}`;
  return {
    status: entry.status,
    id: entry.id,
    version: entry.version,
    canonical_url: canonical,
    artifact_url: downloadable ? `${origin}/api/artifacts/${entry.artifactId}/download` : null,
    sha256: downloadable ? entry.sha256 : null,
    signature: null,
    signature_algorithm: null,
    publisher_slug: 'tester',
    publisher_verified: false,
    visibility: entry.orgSlug ? 'private' : 'public',
    organization_slug: entry.orgSlug,
    has_scripts: false,
    release_notes: entry.notes,
    resolved_requires: entry.requires,
    ...(entry.status === 'deprecated' ? { warning: 'deprecated' } : {}),
  };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, origin);
  // Private, org-scoped metadata: requires the org's bearer token.
  let m = url.pathname.match(/^\/api\/orgs\/([a-z0-9-]+)\/packs\/(stack|domain)\/([a-z0-9-]+)\/versions\/([^/]+)\/install-metadata$/);
  if (m) {
    const entry = packs.get(`orgs/${m[1]}/${m[2]}/${m[3]}/${m[4]}`);
    if (!entry) { res.writeHead(404); return res.end('{}'); }
    if (bearer(req) !== PRIVATE_TOKEN) { res.writeHead(404); return res.end('{}'); }
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(metadataFor(entry)));
  }
  m = url.pathname.match(/^\/api\/orgs\/([a-z0-9-]+)\/packs\/(stack|domain)\/([a-z0-9-]+)\/updates$/);
  if (m) {
    const orgSlug = m[1];
    const id = `${m[2]}/${m[3]}`;
    if (bearer(req) !== PRIVATE_TOKEN) { res.writeHead(404); return res.end('{}'); }
    const published = [...packs.values()].filter((p) => p.id === id && p.orgSlug === orgSlug && p.status === 'published');
    if (published.length === 0) { res.writeHead(404); return res.end('{}'); }
    const latest = published.sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true })).at(-1);
    const current = url.searchParams.get('current_version') ?? '';
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({
      pack_id: id,
      current_version: current || null,
      up_to_date: current === latest.version,
      latest: metadataFor(latest),
    }));
  }
  m = url.pathname.match(/^\/api\/packs\/(stack|domain)\/([a-z0-9-]+)\/versions\/([^/]+)\/install-metadata$/);
  if (m) {
    const entry = packs.get(`${m[1]}/${m[2]}/${m[3]}`);
    if (!entry) { res.writeHead(404); return res.end('{}'); }
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(metadataFor(entry)));
  }
  m = url.pathname.match(/^\/api\/packs\/(stack|domain)\/([a-z0-9-]+)\/updates$/);
  if (m) {
    const id = `${m[1]}/${m[2]}`;
    const published = [...packs.values()].filter((p) => p.id === id && !p.orgSlug && p.status === 'published');
    if (published.length === 0) { res.writeHead(404); return res.end('{}'); }
    const latest = published.sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true })).at(-1);
    const current = url.searchParams.get('current_version') ?? '';
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({
      pack_id: id,
      current_version: current || null,
      up_to_date: current === latest.version,
      latest: metadataFor(latest),
    }));
  }
  m = url.pathname.match(/^\/api\/artifacts\/(art_\d+)\/download$/);
  if (m) {
    const entry = [...packs.values()].find((p) => p.artifactId === m[1]);
    if (!entry) { res.writeHead(404); return res.end(); }
    // Private artifacts require the org token; use 404 to avoid existence leak.
    if (entry.orgSlug && bearer(req) !== PRIVATE_TOKEN) { res.writeHead(404); return res.end(); }
    if (!(entry.status === 'published' || entry.status === 'deprecated')) { res.writeHead(410); return res.end(); }
    res.writeHead(200, { 'content-type': 'application/gzip' });
    return res.end(entry.artifact);
  }
  res.writeHead(404);
  res.end();
});

// --- test driver -----------------------------------------------------------

let failures = 0;
let ran = 0;

// The fake registry lives in this process, so the installer must run
// asynchronously (a sync spawn would block the server's event loop).
function run(argv, { env = {} } = {}) {
  return new Promise((resolveRun) => {
    const child = spawn('node', [INSTALLER, ...argv], {
      env: { ...process.env, POLYRIG_REGISTRY_URL: origin, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (status) => resolveRun({ status, stdout, stderr }));
  });
}

function check(label, cond, detail = '') {
  ran++;
  if (cond) {
    console.log(`ok   ${label}`);
  } else {
    failures++;
    console.error(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`);
  }
}

function canonical(id, version) {
  return `${origin}/packs/${id}/versions/${version}`;
}

function privateCanonical(orgSlug, id, version) {
  return `${origin}/orgs/${orgSlug}/packs/${id}/versions/${version}`;
}

await new Promise((resolveReady) => server.listen(0, '127.0.0.1', resolveReady));
origin = `http://127.0.0.1:${server.address().port}`;

const work = mkdtempSync(join(tmpdir(), 'polyrig-install-test-'));
const dest = join(work, 'packs');

try {
  // 1. install published pack
  let r = await run(['install', canonical('domain/hello-registry', '0.1.0'), '--dest', dest, '--yes']);
  check('install published pack exits 0', r.status === 0, r.stdout + r.stderr);
  check('pack files installed', existsSync(join(dest, 'domain/hello-registry/pack.yaml')));
  const metaPath = join(dest, 'domain/hello-registry/.polyrig-install.json');
  check('.polyrig-install.json written', existsSync(metaPath));
  const installMeta = JSON.parse(readFileSync(metaPath, 'utf8'));
  check('install metadata fields', installMeta.source === 'remote'
    && installMeta.pack_id === 'domain/hello-registry'
    && installMeta.version === '0.1.0'
    && installMeta.sha256?.startsWith('sha256:')
    && installMeta.registry_url === origin
    && installMeta.publisher_slug === 'tester'
    && typeof installMeta.artifact_id === 'string');

  // 2. same checksum -> no-op
  r = await run(['install', canonical('domain/hello-registry', '0.1.0'), '--dest', dest, '--yes']);
  check('reinstall same checksum is a no-op', r.status === 0 && r.stdout.includes('NOOP'), r.stdout + r.stderr);

  // 3. different version without --replace -> blocked
  r = await run(['install', canonical('domain/hello-registry', '0.2.0'), '--dest', dest, '--yes']);
  check('different version blocked without --replace', r.status !== 0 && (r.stderr.includes('--replace')), r.stdout + r.stderr);
  check('0.1.0 still in place after blocked install',
    JSON.parse(readFileSync(metaPath, 'utf8')).version === '0.1.0');
  check('blocked install leaves no dependency behind', !existsSync(join(dest, 'domain/hello-dep')));

  // 4. --replace installs 0.2.0 and its dependency first
  r = await run(['install', canonical('domain/hello-registry', '0.2.0'), '--dest', dest, '--yes', '--replace']);
  check('--replace succeeds', r.status === 0, r.stdout + r.stderr);
  check('dependency installed', existsSync(join(dest, 'domain/hello-dep/pack.yaml')));
  const depIdx = r.stdout.indexOf('OK installed domain/hello-dep');
  const mainIdx = r.stdout.indexOf('OK installed domain/hello-registry');
  check('dependency installed before main pack', depIdx !== -1 && mainIdx !== -1 && depIdx < mainIdx, r.stdout);
  check('replaced version recorded', JSON.parse(readFileSync(metaPath, 'utf8')).version === '0.2.0');

  // 5. sha256 mismatch fails and installs nothing
  r = await run(['install', canonical('domain/corrupt-pack', '0.1.0'), '--dest', dest, '--yes']);
  check('sha256 mismatch fails', r.status !== 0 && r.stderr.includes('sha256 mismatch'), r.stdout + r.stderr);
  check('corrupt pack not installed', !existsSync(join(dest, 'domain/corrupt-pack')));

  // 6. non-registry origin refused
  r = await run(['install', 'https://evil.example.com/packs/domain/hello-registry/versions/0.1.0', '--dest', dest, '--yes']);
  check('foreign origin refused', r.status !== 0 && r.stderr.includes('refusing'), r.stdout + r.stderr);

  // 7. update no-op at latest
  r = await run(['update', 'domain/hello-registry', '--dest', dest, '--yes']);
  check('update at latest is a no-op', r.status === 0 && r.stdout.includes('NOOP'), r.stdout + r.stderr);

  // 8. update from an older version installs latest + new deps
  const dest2 = join(work, 'packs2');
  r = await run(['install', canonical('domain/hello-registry', '0.1.0'), '--dest', dest2, '--yes']);
  check('setup: 0.1.0 in fresh root', r.status === 0, r.stdout + r.stderr);
  r = await run(['update', 'domain/hello-registry', '--dest', dest2, '--yes']);
  check('update shows plan with release notes', r.stdout.includes('Adds hello-dep dependency.'), r.stdout);
  check('update installs latest', r.status === 0
    && JSON.parse(readFileSync(join(dest2, 'domain/hello-registry/.polyrig-install.json'), 'utf8')).version === '0.2.0',
    r.stdout + r.stderr);
  check('update pulled dependency', existsSync(join(dest2, 'domain/hello-dep/pack.yaml')));
  r = await run(['update', '--all', '--dest', dest2, '--yes']);
  check('update --all is a no-op afterwards', r.status === 0 && !r.stdout.includes('OK installed'), r.stdout + r.stderr);

  // 9. deprecated requires explicit opt-in
  r = await run(['install', canonical('domain/old-pack', '0.1.0'), '--dest', dest, '--yes']);
  check('deprecated refused by default', r.status !== 0 && r.stderr.includes('deprecated'), r.stdout + r.stderr);
  r = await run(['install', canonical('domain/old-pack', '0.1.0'), '--dest', dest, '--yes', '--allow-deprecated']);
  check('deprecated installable with --allow-deprecated', r.status === 0, r.stdout + r.stderr);

  // 10. removed can never be installed
  r = await run(['install', canonical('domain/gone-pack', '0.1.0'), '--dest', dest, '--yes']);
  check('removed refused', r.status !== 0 && r.stderr.includes('removed'), r.stdout + r.stderr);

  // 11. non-interactive without --yes stops at the confirmation point
  r = await run(['install', canonical('domain/hello-dep', '0.1.0'), '--dest', join(work, 'packs3')]);
  check('confirmation required without --yes', r.status !== 0 && r.stderr.includes('confirmation required'), r.stdout + r.stderr);

  // 12. private install without a token fails (metadata is 404)
  const privDest = join(work, 'packs-private');
  r = await run(['install', privateCanonical('acme', 'domain/private-pack', '0.1.0'), '--dest', privDest, '--yes']);
  check('private install without token fails', r.status !== 0, r.stdout + r.stderr);
  check('private pack not installed without token', !existsSync(join(privDest, 'domain/private-pack')));

  // 13. private install with POLYRIG_REGISTRY_TOKEN succeeds
  r = await run(['install', privateCanonical('acme', 'domain/private-pack', '0.1.0'), '--dest', privDest, '--yes'],
    { env: { POLYRIG_REGISTRY_TOKEN: 'test-token' } });
  check('private install with env token succeeds', r.status === 0, r.stdout + r.stderr);
  check('private pack files installed', existsSync(join(privDest, 'domain/private-pack/pack.yaml')));

  // 14. private install with --token succeeds in a fresh root
  const privDest2 = join(work, 'packs-private2');
  r = await run(['install', privateCanonical('acme', 'domain/private-pack', '0.1.0'), '--dest', privDest2, '--yes', '--token', 'test-token']);
  check('private install with --token succeeds', r.status === 0, r.stdout + r.stderr);
  check('private pack files installed via flag', existsSync(join(privDest2, 'domain/private-pack/pack.yaml')));

  // 15. wrong token is rejected
  const privDest3 = join(work, 'packs-private3');
  r = await run(['install', privateCanonical('acme', 'domain/private-pack', '0.1.0'), '--dest', privDest3, '--yes', '--token', 'wrong']);
  check('wrong token rejected', r.status !== 0, r.stdout + r.stderr);

  // 16. public install still works without a token
  const pubDest = join(work, 'packs-public');
  r = await run(['install', canonical('domain/hello-registry', '0.1.0'), '--dest', pubDest, '--yes']);
  check('public install still works without token', r.status === 0 && existsSync(join(pubDest, 'domain/hello-registry/pack.yaml')), r.stdout + r.stderr);
} finally {
  server.close();
  rmSync(work, { recursive: true, force: true });
}

console.log(failures === 0 ? `PASS ${ran} checks` : `FAIL ${failures}/${ran} checks failed`);
process.exit(failures === 0 ? 0 : 1);
