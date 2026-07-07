#!/usr/bin/env node
// End-to-end tests for inject-pack-skills.mjs against a temp PolyRig project.
// Builds a project with .polyrig/vault/<type>/<short-id>/skills/<skill>/SKILL.md
// and a base .polyrig/manifest.json (as Track A would write), then drives the
// real CLI to inject/reclaim project-level symlinks and register linked_skills.

import { execFileSync } from 'node:child_process';
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync,
  rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO_ROOT } from './lib/validate.mjs';

const SCRIPT = join(REPO_ROOT, 'scripts', 'inject-pack-skills.mjs');
let failures = 0;
let ran = 0;
function check(label, cond, detail = '') {
  ran++;
  if (cond) console.log(`ok   ${label}`);
  else { failures++; console.error(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`); }
}

function run(argv) {
  try {
    return { status: 0, stdout: execFileSync('node', [SCRIPT, ...argv], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), stderr: '' };
  } catch (err) {
    return { status: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

// Materialize a project with a base manifest and vault skills.
// skills: [{ type:'stacks'|'domains', shortId, skill }]
function makeProject(root, name, skills, platforms = []) {
  const proj = join(root, name);
  mkdirSync(join(proj, '.polyrig'), { recursive: true });
  writeFileSync(join(proj, '.polyrig', 'manifest.json'), JSON.stringify({
    polyrig_version: '0.2.0',
    generated_at: '2026-07-07T00:00:00Z',
    language: { interaction: 'en', artifacts: 'en' },
    selected_packs: [],
    overrides: [],
  }, null, 2));
  for (const s of skills) {
    const d = join(proj, '.polyrig', 'vault', s.type, s.shortId, 'skills', s.skill);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'SKILL.md'), `---\nname: ${s.skill}\ndescription: A test skill.\n---\n# ${s.skill}\n`);
  }
  for (const p of platforms) mkdirSync(join(proj, ...p.split('/')), { recursive: true });
  return proj;
}

function manifestOf(proj) {
  return JSON.parse(readFileSync(join(proj, '.polyrig', 'manifest.json'), 'utf8'));
}

const root = mkdtempSync(join(tmpdir(), 'polyrig-inject-'));
try {
  // 1. detection: only .claude/skills present -> only claude-code linked.
  {
    const proj = makeProject(root, 'p1', [{ type: 'domains', shortId: 'foo', skill: 'bar' }], ['.claude/skills']);
    const r = run(['inject', '--project', proj, '--yes']);
    check('detect: exits 0', r.status === 0, r.stdout + r.stderr);
    const link = join(proj, '.claude/skills/bar');
    check('detect: claude-code symlink created', lstatSync(link).isSymbolicLink(), r.stdout);
    check('detect: symlink points at vault skill',
      realpathSync(link) === realpathSync(join(proj, '.polyrig/vault/domains/foo/skills/bar')));
    check('detect: codex NOT linked (dir absent)', !existsSync(join(proj, '.codex/skills/bar')));
    const m = manifestOf(proj);
    check('detect: linked_skills registered with 4 fields', m.linked_skills.length === 1
      && m.linked_skills[0].pack === 'domain/foo' && m.linked_skills[0].skill === 'bar'
      && m.linked_skills[0].linked_as === 'bar' && m.linked_skills[0].target === link, JSON.stringify(m.linked_skills));
    check('detect: Track A fields preserved', m.polyrig_version === '0.2.0');
  }

  // 2. two platforms present -> both linked.
  {
    const proj = makeProject(root, 'p2', [{ type: 'stacks', shortId: 'baz', skill: 'qux' }], ['.claude/skills', '.codex/skills']);
    const r = run(['inject', '--project', proj, '--yes']);
    check('two-platform: both symlinks created', r.status === 0
      && lstatSync(join(proj, '.claude/skills/qux')).isSymbolicLink()
      && lstatSync(join(proj, '.codex/skills/qux')).isSymbolicLink(), r.stdout + r.stderr);
    check('two-platform: two linked_skills entries', manifestOf(proj).linked_skills.length === 2);
  }

  // 3. idempotent.
  {
    const proj = makeProject(root, 'p3', [{ type: 'domains', shortId: 'foo', skill: 'bar' }], ['.claude/skills']);
    run(['inject', '--project', proj, '--yes']);
    const r = run(['inject', '--project', proj, '--yes']);
    check('idempotent: second run NOOP, exit 0', r.status === 0 && r.stdout.includes('NOOP') && r.stdout.includes('already linked'), r.stdout + r.stderr);
    check('idempotent: no duplicate linked_skills', manifestOf(proj).linked_skills.length === 1);
  }

  // 4. collision skip.
  {
    const proj = makeProject(root, 'p4', [{ type: 'domains', shortId: 'foo', skill: 'bar' }], ['.claude/skills']);
    mkdirSync(join(proj, '.claude/skills/bar'), { recursive: true }); // real dir, not a symlink
    writeFileSync(join(proj, '.claude/skills/bar/SKILL.md'), '# users own bar\n');
    const r = run(['inject', '--project', proj, '--yes', '--skip', 'bar']);
    check('skip: exits 0 and reports SKIP', r.status === 0 && r.stdout.includes('SKIP'), r.stdout + r.stderr);
    check('skip: user dir untouched (not a symlink)', !lstatSync(join(proj, '.claude/skills/bar')).isSymbolicLink());
    check('skip: nothing registered', manifestOf(proj).linked_skills.length === 0);
  }

  // 5. collision rename.
  {
    const proj = makeProject(root, 'p5', [{ type: 'domains', shortId: 'foo', skill: 'bar' }], ['.claude/skills']);
    mkdirSync(join(proj, '.claude/skills/bar'), { recursive: true });
    const r = run(['inject', '--project', proj, '--yes', '--rename', 'bar=foo-bar']);
    check('rename: exits 0, foo-bar symlink created', r.status === 0 && lstatSync(join(proj, '.claude/skills/foo-bar')).isSymbolicLink(), r.stdout + r.stderr);
    const m = manifestOf(proj);
    check('rename: manifest records skill=bar linked_as=foo-bar',
      m.linked_skills.length === 1 && m.linked_skills[0].skill === 'bar' && m.linked_skills[0].linked_as === 'foo-bar', JSON.stringify(m.linked_skills));
  }

  // 6. empty + --create.
  {
    const proj = makeProject(root, 'p6', [{ type: 'domains', shortId: 'foo', skill: 'bar' }], []); // no trigger dirs
    const r = run(['inject', '--project', proj, '--yes', '--create', 'claude-code']);
    check('create: exits 0 and makes .claude/skills + symlink', r.status === 0
      && lstatSync(join(proj, '.claude/skills/bar')).isSymbolicLink(), r.stdout + r.stderr);
  }

  // 7. empty, no --create, non-interactive -> fail.
  {
    const proj = makeProject(root, 'p7', [{ type: 'domains', shortId: 'foo', skill: 'bar' }], []);
    const r = run(['inject', '--project', proj, '--yes']);
    check('no-dir: fails non-zero with guidance', r.status !== 0 && r.stderr.includes('--create'), r.stdout + r.stderr);
  }

  // 8. same-batch same-name across two packs -> fail.
  {
    const proj = makeProject(root, 'p8', [
      { type: 'domains', shortId: 'foo', skill: 'dup' },
      { type: 'stacks', shortId: 'baz', skill: 'dup' },
    ], ['.claude/skills']);
    const r = run(['inject', '--project', proj, '--yes']);
    check('batch-clash: fails non-zero', r.status !== 0 && r.stderr.includes('more than one'), r.stdout + r.stderr);
  }

  // 9. platform scope: never writes cursor/gemini/opencode.
  {
    const proj = makeProject(root, 'p9', [{ type: 'domains', shortId: 'foo', skill: 'bar' }], ['.claude/skills', '.cursor', '.gemini']);
    run(['inject', '--project', proj, '--yes']);
    check('scope: .cursor not written', !existsSync(join(proj, '.cursor/bar')) && !existsSync(join(proj, '.cursor/skills')));
    check('scope: .gemini not written', !existsSync(join(proj, '.gemini/bar')));
  }

  // 10. reclaim: unlink + clear linked_skills, keep other fields, exit 0.
  {
    const proj = makeProject(root, 'p10', [{ type: 'domains', shortId: 'foo', skill: 'bar' }], ['.claude/skills']);
    run(['inject', '--project', proj, '--yes']);
    const r = run(['reclaim', '--project', proj, '--yes']);
    check('reclaim: exits 0', r.status === 0, r.stdout + r.stderr);
    check('reclaim: symlink removed', !existsSync(join(proj, '.claude/skills/bar')));
    const m = manifestOf(proj);
    check('reclaim: linked_skills emptied', m.linked_skills.length === 0);
    check('reclaim: base fields kept', m.polyrig_version === '0.2.0');
    // 11. idempotent reclaim.
    const r2 = run(['reclaim', '--project', proj, '--yes']);
    check('reclaim: idempotent NOOP', r2.status === 0 && r2.stdout.includes('NOOP'), r2.stdout + r2.stderr);
  }

  // 12. reclaim safety: a real dir masquerading as a linked_skill target is NOT deleted.
  {
    const proj = makeProject(root, 'p12', [{ type: 'domains', shortId: 'foo', skill: 'bar' }], ['.claude/skills']);
    const realDir = join(proj, '.claude/skills/realbar');
    mkdirSync(realDir, { recursive: true });
    writeFileSync(join(realDir, 'SKILL.md'), '# real\n');
    const m = manifestOf(proj);
    m.linked_skills = [{ pack: 'domain/foo', skill: 'realbar', linked_as: 'realbar', target: realDir }];
    writeFileSync(join(proj, '.polyrig', 'manifest.json'), JSON.stringify(m, null, 2));
    const r = run(['reclaim', '--project', proj, '--yes']);
    check('reclaim-safety: real dir NOT deleted', existsSync(realDir) && r.stdout.includes('not-a-managed-symlink'), r.stdout + r.stderr);
    check('reclaim-safety: entry retained in manifest', manifestOf(proj).linked_skills.length === 1);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(failures === 0 ? `PASS ${ran} checks` : `FAIL ${failures}/${ran} checks failed`);
process.exit(failures === 0 ? 0 : 1);
