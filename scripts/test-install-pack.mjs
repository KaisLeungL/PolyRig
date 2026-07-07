#!/usr/bin/env node
// test-install-pack.mjs — end-to-end tests for install-pack.mjs against a
// local fake registry (HTTP server serving install-metadata + artifacts).
// Run: node scripts/test-install-pack.mjs

import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
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

const packs = new Map(); // "type/name/version" -> {status, artifact, sha256, requires:[], notes, orgSlug, groups}
const groups = new Map(); // "name/version" -> {id, version, status, members, requires, notes}
let nextArtifact = 1;
const PRIVATE_TOKEN = 'test-token';

function addPack(id, version, { status = 'published', requires = [], reqYaml = '[]', notes = 'test release', corruptSha = false, orgSlug = null, memberOf = [] } = {}) {
  const artifact = makeTarGz(fixtureFiles(id, version, reqYaml));
  const sha = createHash('sha256').update(artifact).digest('hex');
  packs.set(`${orgSlug ? `orgs/${orgSlug}/` : ''}${id}/${version}`, {
    id, version, status, artifact, orgSlug,
    sha256: `sha256:${corruptSha ? '0'.repeat(64) : sha}`,
    artifactId: `art_${nextArtifact++}`,
    requires, notes, groups: memberOf,
  });
}

function addGroup(name, version, { status = 'published', members = [], requires = [], notes = 'group release' } = {}) {
  groups.set(`${name}/${version}`, { id: `group/${name}`, name, version, status, members, requires, notes });
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
// Published pack used by the --check REMOVED case: installed while published,
// then flipped to removed in the registry to simulate a platform takedown.
addPack('domain/check-removed', '0.1.0');

// --- pack group fixture: the auth trio (core is depended on by the providers) ---
const authMembership = [{ id: 'group/auth', version: '0.1.0' }];
addPack('domain/auth-core', '0.1.0', { memberOf: authMembership });
addPack('domain/auth-google', '0.1.0', {
  requires: [{ id: 'domain/auth-core', version: '0.1.0' }],
  reqYaml: '[domain/auth-core]',
  memberOf: authMembership,
});
addPack('domain/auth-github', '0.1.0', {
  requires: [{ id: 'domain/auth-core', version: '0.1.0' }],
  reqYaml: '[domain/auth-core]',
  memberOf: authMembership,
});
addGroup('auth', '0.1.0', {
  members: [
    { id: 'domain/auth-core', version: '0.1.0' },
    { id: 'domain/auth-google', version: '0.1.0' },
    { id: 'domain/auth-github', version: '0.1.0' },
  ],
  requires: [],
  notes: 'OAuth/OIDC sign-in suite.',
});

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
    groups: entry.groups ?? [],
    ...(entry.status === 'deprecated' ? { warning: 'deprecated' } : {}),
  };
}

function groupMetadataFor(g) {
  return {
    status: g.status,
    id: g.id,
    version: g.version,
    canonical_url: `${origin}/groups/${g.name}/versions/${g.version}`,
    publisher_slug: 'tester',
    release_notes: g.notes,
    members: g.members,
    requires: g.requires,
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
  m = url.pathname.match(/^\/api\/groups\/([a-z0-9-]+)\/versions\/([^/]+)\/install-metadata$/);
  if (m) {
    const g = groups.get(`${m[1]}/${m[2]}`);
    if (!g) { res.writeHead(404); return res.end('{}'); }
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(groupMetadataFor(g)));
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

function groupCanonical(name, version) {
  return `${origin}/groups/${name}/versions/${version}`;
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

  // --- pack group cases ----------------------------------------------------

  // 17. whole-group install: all members, dependency-first order.
  const gDest = join(work, 'packs-group');
  r = await run(['install', groupCanonical('auth', '0.1.0'), '--dest', gDest, '--yes']);
  check('group install exits 0', r.status === 0, r.stdout + r.stderr);
  check('group member auth-core installed', existsSync(join(gDest, 'domain/auth-core/pack.yaml')), r.stdout + r.stderr);
  check('group member auth-google installed', existsSync(join(gDest, 'domain/auth-google/pack.yaml')));
  check('group member auth-github installed', existsSync(join(gDest, 'domain/auth-github/pack.yaml')));
  const coreIdx = r.stdout.indexOf('OK installed domain/auth-core');
  const googleIdx = r.stdout.indexOf('OK installed domain/auth-google');
  const githubIdx = r.stdout.indexOf('OK installed domain/auth-github');
  check('auth-core installed before its dependants (topo order)',
    coreIdx !== -1 && googleIdx !== -1 && githubIdx !== -1 && coreIdx < googleIdx && coreIdx < githubIdx, r.stdout);
  check('group plan lists the group id/version', r.stdout.includes('PLAN group group/auth@0.1.0'), r.stdout);

  // 18. each member has an install record, and a group install record is written.
  check('member auth-core has .polyrig-install.json', existsSync(join(gDest, 'domain/auth-core/.polyrig-install.json')));
  const groupRecPath = join(gDest, '.polyrig-groups/auth.json');
  check('group install record written', existsSync(groupRecPath), groupRecPath);
  if (existsSync(groupRecPath)) {
    const grec = JSON.parse(readFileSync(groupRecPath, 'utf8'));
    check('group record fields', grec.group_id === 'group/auth'
      && grec.version === '0.1.0'
      && grec.source === 'remote'
      && Array.isArray(grec.members) && grec.members.length === 3
      && Array.isArray(grec.lock) && grec.lock.length === 3
      && grec.lock.every((l) => typeof l.id === 'string' && typeof l.version === 'string')
      && typeof grec.installed_at === 'string', JSON.stringify(grec));
    // lock must be in dependency-first order: auth-core first.
    check('group lock is dependency-first', grec.lock[0].id === 'domain/auth-core', JSON.stringify(grec.lock));
  }

  // 19. group install is idempotent: re-running is all NOOP.
  r = await run(['install', groupCanonical('auth', '0.1.0'), '--dest', gDest, '--yes']);
  check('group reinstall re-runs cleanly', r.status === 0, r.stdout + r.stderr);
  check('group reinstall members are no-ops', !r.stdout.includes('OK installed domain/auth-'), r.stdout);

  // 20. requesting a member pack URL soft-guides to the group (no install).
  const sgDest = join(work, 'packs-softguide');
  r = await run(['install', canonical('domain/auth-github', '0.1.0'), '--dest', sgDest, '--yes']);
  check('member URL soft-guides (blocks, non-zero)', r.status !== 0, r.stdout + r.stderr);
  check('soft-guide names the group', r.stdout.includes('member of group/auth'), r.stdout);
  check('soft-guide offers --group and --single', r.stdout.includes('--group') && r.stdout.includes('--single'), r.stdout);
  check('soft-guide installs nothing', !existsSync(join(sgDest, 'domain/auth-github')), r.stdout);

  // 21. --group on a member URL installs the whole group.
  const memGroupDest = join(work, 'packs-mem-group');
  r = await run(['install', canonical('domain/auth-github', '0.1.0'), '--dest', memGroupDest, '--yes', '--group']);
  check('--group on member URL installs whole group', r.status === 0
    && existsSync(join(memGroupDest, 'domain/auth-core/pack.yaml'))
    && existsSync(join(memGroupDest, 'domain/auth-google/pack.yaml'))
    && existsSync(join(memGroupDest, 'domain/auth-github/pack.yaml')), r.stdout + r.stderr);
  check('--group writes the group record', existsSync(join(memGroupDest, '.polyrig-groups/auth.json')));

  // 22. --single installs just the pack + requires closure (auth-core), NOT the
  //     sibling auth-google.
  const singleDest = join(work, 'packs-single');
  r = await run(['install', canonical('domain/auth-github', '0.1.0'), '--dest', singleDest, '--yes', '--single']);
  check('--single exits 0', r.status === 0, r.stdout + r.stderr);
  check('--single installs the target pack', existsSync(join(singleDest, 'domain/auth-github/pack.yaml')));
  check('--single pulls the requires closure (auth-core)', existsSync(join(singleDest, 'domain/auth-core/pack.yaml')));
  check('--single does NOT pull the sibling (auth-google)', !existsSync(join(singleDest, 'domain/auth-google')), r.stdout);
  check('--single writes no group record', !existsSync(join(singleDest, '.polyrig-groups/auth.json')));

  // --- update --check (read-only health report) ----------------------------

  // 23. UPSTREAM-NEWER: install 0.1.0 (registry has 0.2.0) then --all --check.
  const chkDest = join(work, 'packs-check');
  r = await run(['install', canonical('domain/hello-registry', '0.1.0'), '--dest', chkDest, '--yes']);
  check('check: setup 0.1.0 installed', r.status === 0, r.stdout + r.stderr);
  r = await run(['update', '--all', '--check', '--dest', chkDest]);
  check('check: --all --check exits 0', r.status === 0, r.stdout + r.stderr);
  check('check: reports UPSTREAM-NEWER with version arrow',
    r.stdout.includes('UPSTREAM-NEWER') && r.stdout.includes('0.1.0 -> 0.2.0'), r.stdout);
  check('check: prints CHECK summary line', r.stdout.includes('CHECK summary:'), r.stdout);

  // 24. UP-TO-DATE: update to latest, then --check reports up-to-date.
  r = await run(['update', 'domain/hello-registry', '--dest', chkDest, '--yes']);
  check('check: updated to 0.2.0', r.status === 0, r.stdout + r.stderr);
  r = await run(['update', 'domain/hello-registry', '--check', '--dest', chkDest]);
  check('check: reports UP-TO-DATE at latest', r.status === 0 && r.stdout.includes('UP-TO-DATE'), r.stdout + r.stderr);

  // 25. DEPRECATED not masked: updates endpoint 404s for a deprecated-only pack,
  //     but --check still reports DEPRECATED (proves it queries install-metadata).
  const depDest = join(work, 'packs-check-dep');
  r = await run(['install', canonical('domain/old-pack', '0.1.0'), '--dest', depDest, '--yes', '--allow-deprecated']);
  check('check: setup deprecated pack installed', r.status === 0, r.stdout + r.stderr);
  r = await run(['update', 'domain/old-pack', '--check', '--dest', depDest]);
  check('check: reports DEPRECATED despite updates 404',
    r.status === 0 && r.stdout.includes('DEPRECATED'), r.stdout + r.stderr);

  // 26. REMOVED: install while published, flip registry entry to removed, --check.
  const remDest = join(work, 'packs-check-removed');
  r = await run(['install', canonical('domain/check-removed', '0.1.0'), '--dest', remDest, '--yes']);
  check('check: setup check-removed installed', r.status === 0, r.stdout + r.stderr);
  packs.get('domain/check-removed/0.1.0').status = 'removed';
  r = await run(['update', 'domain/check-removed', '--check', '--dest', remDest]);
  check('check: reports REMOVED', r.status === 0 && r.stdout.includes('REMOVED'), r.stdout + r.stderr);
  packs.get('domain/check-removed/0.1.0').status = 'published'; // restore for isolation

  // 27. LOCAL-DRIFT: tamper the recorded sha256 in .polyrig-install.json.
  const driftDest = join(work, 'packs-check-drift');
  r = await run(['install', canonical('domain/hello-registry', '0.1.0'), '--dest', driftDest, '--yes']);
  check('check: setup drift pack installed', r.status === 0, r.stdout + r.stderr);
  const driftRec = join(driftDest, 'domain/hello-registry/.polyrig-install.json');
  const driftMeta = JSON.parse(readFileSync(driftRec, 'utf8'));
  driftMeta.sha256 = `sha256:${'1'.repeat(64)}`;
  writeFileSync(driftRec, `${JSON.stringify(driftMeta, null, 2)}\n`);
  r = await run(['update', 'domain/hello-registry', '--check', '--dest', driftDest]);
  check('check: reports LOCAL-DRIFT on tampered sha256',
    r.status === 0 && r.stdout.includes('LOCAL-DRIFT'), r.stdout + r.stderr);

  // 28. UNKNOWN non-fatal: point at a dead registry; pack reports UNKNOWN, exit 0.
  r = await run(['update', '--all', '--check', '--dest', chkDest, '--registry', 'http://127.0.0.1:1']);
  check('check: dead registry -> UNKNOWN, still exit 0',
    r.status === 0 && r.stdout.includes('UNKNOWN'), r.stdout + r.stderr);

  // 29. private pack: with token reports a state; without token -> UNKNOWN, exit 0.
  const chkPriv = join(work, 'packs-check-priv');
  r = await run(['install', privateCanonical('acme', 'domain/private-pack', '0.1.0'), '--dest', chkPriv, '--yes', '--token', 'test-token']);
  check('check: setup private pack installed', r.status === 0, r.stdout + r.stderr);
  r = await run(['update', 'domain/private-pack', '--check', '--dest', chkPriv, '--token', 'test-token']);
  check('check: private pack with token is checkable', r.status === 0 && r.stdout.includes('CHECK domain/private-pack'), r.stdout + r.stderr);
  r = await run(['update', 'domain/private-pack', '--check', '--dest', chkPriv]);
  check('check: private pack without token -> UNKNOWN, exit 0',
    r.status === 0 && r.stdout.includes('UNKNOWN'), r.stdout + r.stderr);

  // 30. read-only: --check does not modify the install record or pack dir.
  const roRec = join(chkDest, 'domain/hello-registry/.polyrig-install.json');
  const roBefore = readFileSync(roRec, 'utf8');
  const roMtimeBefore = statSync(roRec).mtimeMs;
  r = await run(['update', '--all', '--check', '--dest', chkDest]);
  check('check: install record unchanged after --check',
    readFileSync(roRec, 'utf8') === roBefore && statSync(roRec).mtimeMs === roMtimeBefore, r.stdout + r.stderr);

  // 31. single-target --check on a not-installed pack fails non-zero.
  r = await run(['update', 'domain/nonexistent', '--check', '--dest', chkDest]);
  check('check: not-installed single target fails non-zero', r.status !== 0, r.stdout + r.stderr);
} finally {
  server.close();
  rmSync(work, { recursive: true, force: true });
}

console.log(failures === 0 ? `PASS ${ran} checks` : `FAIL ${failures}/${ran} checks failed`);
process.exit(failures === 0 ? 0 : 1);
