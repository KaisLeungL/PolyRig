// validate.mjs — shared validation helpers for PolyRig tooling.
//
// Two responsibilities:
//   1. checkAgainstSchema(): targeted, schema-driven checks for the JSON
//      Schema subset actually used by the schemas/ files (type, required,
//      properties, additionalProperties, enum, pattern, minLength, minItems,
//      uniqueItems, items, local '#/...' $ref, format date/date-time). NOT a
//      general-purpose JSON Schema engine — deliberately small, but driven by
//      reading the schema file so schema edits flow through.
//   2. validatePackDir(): full pack validation = pack.yaml schema checks +
//      the structural rules from docs/pack-protocol.md + `requires` resolution
//      against discovery roots.
//
// All functions return violation lists; they never call process.exit().

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYamlFile, YamlError } from './miniyaml.mjs';

/** Absolute path to the PolyRig repository root (parent of scripts/). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Load and parse schemas/pack.schema.json. */
export function loadPackSchema() {
  const path = join(REPO_ROOT, 'schemas', 'pack.schema.json');
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`cannot load pack schema at ${path}: ${err.message}`);
  }
}

/** Load and parse schemas/group.schema.json. */
export function loadGroupSchema() {
  const path = join(REPO_ROOT, 'schemas', 'group.schema.json');
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`cannot load group schema at ${path}: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Schema-driven checks (subset validator)
// ---------------------------------------------------------------------------

function typeName(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v; // 'object', 'string', 'number', 'boolean'
}

function matchesType(v, schemaType) {
  const t = typeName(v);
  if (schemaType === 'integer') return t === 'number' && Number.isInteger(v);
  if (schemaType === 'number') return t === 'number';
  return t === schemaType;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** Resolve a local '#/a/b' JSON pointer against the root schema. */
function resolveRef(root, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return undefined;
  let node = root;
  for (const part of ref.slice(2).split('/')) {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (node === null || typeof node !== 'object') return undefined;
    node = node[key];
  }
  return node;
}

/**
 * Validate `value` against the JSON Schema subset in `schema`.
 * Returns an array of violation strings, each prefixed with a JSON-pointer-ish
 * location (e.g. "pack.yaml:/trust/level: ..."). `root` is the document the
 * schema's local $refs resolve against; callers never pass it explicitly.
 */
export function checkAgainstSchema(value, schema, where = '', root = schema) {
  const violations = [];
  const at = where === '' ? '(root)' : where;

  if (schema.$ref !== undefined) {
    const resolved = resolveRef(root, schema.$ref);
    if (resolved === undefined) {
      violations.push(`${at}: unresolvable $ref '${schema.$ref}'`);
      return violations;
    }
    return checkAgainstSchema(value, resolved, where, root);
  }

  if (schema.type !== undefined && !matchesType(value, schema.type)) {
    violations.push(`${at}: expected type '${schema.type}', got '${typeName(value)}'`);
    return violations; // deeper checks are meaningless on the wrong type
  }

  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    violations.push(`${at}: value ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
  }

  if (typeof value === 'string') {
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      violations.push(`${at}: value ${JSON.stringify(value)} does not match pattern ${schema.pattern}`);
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      violations.push(`${at}: string is shorter than minLength ${schema.minLength}`);
    }
    if (schema.format === 'date' && !DATE_RE.test(value)) {
      violations.push(`${at}: value ${JSON.stringify(value)} is not a YYYY-MM-DD date`);
    }
    if (schema.format === 'date-time' && !DATE_TIME_RE.test(value)) {
      violations.push(`${at}: value ${JSON.stringify(value)} is not an RFC 3339 date-time`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      violations.push(`${at}: array has fewer than minItems ${schema.minItems}`);
    }
    if (schema.uniqueItems === true) {
      const seen = new Set();
      for (const item of value) {
        const key = JSON.stringify(item);
        if (seen.has(key)) violations.push(`${at}: duplicate array item ${key}`);
        seen.add(key);
      }
    }
    if (schema.items !== undefined) {
      value.forEach((item, idx) => {
        violations.push(...checkAgainstSchema(item, schema.items, `${where}/${idx}`, root));
      });
    }
  }

  if (typeName(value) === 'object') {
    for (const req of schema.required ?? []) {
      if (!(req in value)) violations.push(`${at}: missing required field '${req}'`);
    }
    const props = schema.properties ?? {};
    for (const [key, sub] of Object.entries(value)) {
      if (key in props) {
        violations.push(...checkAgainstSchema(sub, props[key], `${where}/${key}`, root));
      } else if (schema.additionalProperties === false) {
        violations.push(`${at}: unknown field '${key}' (additionalProperties is false)`);
      }
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Discovery-root helpers
// ---------------------------------------------------------------------------

function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function isFile(p) {
  try { return statSync(p).isFile(); } catch { return false; }
}

/**
 * List candidate pack directories inside a discovery root
 * (<root>/<type>/<name>). Returns [] for a missing root.
 * Each entry: { dir, hasPackYaml }.
 */
export function listPackDirs(root) {
  const out = [];
  if (!isDir(root)) return out;
  for (const typeEntry of readdirSync(root, { withFileTypes: true })) {
    if (!typeEntry.isDirectory()) continue;
    const typeDir = join(root, typeEntry.name);
    for (const packEntry of readdirSync(typeDir, { withFileTypes: true })) {
      if (!packEntry.isDirectory()) continue;
      const dir = join(typeDir, packEntry.name);
      out.push({ dir, hasPackYaml: isFile(join(dir, 'pack.yaml')) });
    }
  }
  return out;
}

/** True if pack id (e.g. 'domain/auth-core') resolves in any discovery root. */
export function idResolvesInRoots(id, roots) {
  return roots.some((root) => isFile(join(root, id, 'pack.yaml')));
}

/**
 * List candidate group directories inside a discovery root
 * (<root>/groups/<name>). Returns [] for a missing root or missing groups/.
 * Each entry: { dir, name, hasGroupYaml }.
 */
export function listGroupDirs(root) {
  const out = [];
  const groupsRoot = join(root, 'groups');
  if (!isDir(groupsRoot)) return out;
  for (const entry of readdirSync(groupsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(groupsRoot, entry.name);
    out.push({ dir, name: entry.name, hasGroupYaml: isFile(join(dir, 'group.yaml')) });
  }
  return out;
}

/** Recursively collect .md files under a directory. */
function listMarkdownFiles(dir) {
  const out = [];
  if (!isDir(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listMarkdownFiles(p));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Evidence Matrix helpers
// ---------------------------------------------------------------------------

const EVIDENCE_COLUMNS = ['id', 'claim', 'status', 'source_type', 'urls', 'applies_to', 'volatility', 'notes'];
const EVIDENCE_STATUSES = new Set(['source-backed', 'user-provided', 'inferred', 'unverified']);
const EVIDENCE_VOLATILITY = new Set(['low', 'medium', 'high']);
const STRONG_RULE_PATTERNS = [
  /\bRED LINE\b/i,
  /\bmust\b/i,
  /\bnever\b/i,
  /\brequired\b/i,
  /\bdo not\b/i,
  /禁止/,
  /必须/,
  /绝不/,
];

function markdownTableCells(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return null;
  const withoutEdges = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  return withoutEdges.split('|').map((cell) => cell.trim());
}

function isMarkdownSeparator(line) {
  const cells = markdownTableCells(line);
  return cells !== null && cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function parseEvidenceMarkerIds(text) {
  const ids = [];
  for (const match of text.matchAll(/\[Evidence:\s*([^\]]+)\]/g)) {
    ids.push(...match[1].split(',').map((id) => id.trim()).filter(Boolean));
  }
  return ids;
}

function isStrongRuleLine(line) {
  return STRONG_RULE_PATTERNS.some((pattern) => pattern.test(line));
}

function relativePackPath(packDir, file) {
  return file.startsWith(`${packDir}/`) ? file.slice(packDir.length + 1) : file;
}

function validateEvidenceMatrix(packDir, violations) {
  const evidence = new Map();
  const sourcesPath = join(packDir, 'references', 'sources.md');
  if (!isFile(sourcesPath)) {
    violations.push('references/sources.md: missing (required)');
    return evidence;
  }

  const text = readFileSync(sourcesPath, 'utf8');
  if (text.trim() === '') {
    violations.push('references/sources.md: present but empty');
    return evidence;
  }

  const lines = text.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => /^##\s+Evidence Matrix\s*$/.test(line.trim()));
  if (headingIndex === -1) {
    violations.push('references/sources.md: missing ## Evidence Matrix');
    return evidence;
  }

  let headerIndex = -1;
  for (let i = headingIndex + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    if (markdownTableCells(lines[i]) !== null) headerIndex = i;
    break;
  }
  if (headerIndex === -1) {
    violations.push('references/sources.md: Evidence Matrix table missing header row');
    return evidence;
  }

  const header = markdownTableCells(lines[headerIndex]).map((cell) => cell.toLowerCase());
  for (const column of EVIDENCE_COLUMNS) {
    if (!header.includes(column)) {
      violations.push(`references/sources.md: Evidence Matrix missing column '${column}'`);
    }
  }
  if (!isMarkdownSeparator(lines[headerIndex + 1] ?? '')) {
    violations.push('references/sources.md: Evidence Matrix missing separator row');
    return evidence;
  }

  const columnIndex = new Map(header.map((column, idx) => [column, idx]));
  for (let i = headerIndex + 2; i < lines.length; i++) {
    const rawLine = lines[i];
    if (rawLine.trim() === '') break;
    const cells = markdownTableCells(rawLine);
    if (cells === null) break;

    const value = (column) => cells[columnIndex.get(column)]?.trim() ?? '';
    const id = value('id');
    const status = value('status');
    const volatility = value('volatility');
    const rowLabel = `references/sources.md:${i + 1}`;

    if (!/^E\d{3}$/.test(id)) {
      violations.push(`${rowLabel}: evidence id '${id}' must match E\\d{3}`);
      continue;
    }
    if (evidence.has(id)) {
      violations.push(`${rowLabel}: duplicate evidence id ${id}`);
    } else {
      evidence.set(id, { status, volatility });
    }
    if (!EVIDENCE_STATUSES.has(status)) {
      violations.push(`${rowLabel}: evidence ${id} has invalid status '${status}'`);
    }
    if (!EVIDENCE_VOLATILITY.has(volatility)) {
      violations.push(`${rowLabel}: evidence ${id} has invalid volatility '${volatility}'`);
    }
  }

  return evidence;
}

function validateEvidenceReferencesInMarkdown(packDir, files, evidence, violations) {
  for (const file of files) {
    const rel = relativePackPath(packDir, file);
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, idx) => {
      const label = `${rel}:${idx + 1}`;
      const refs = parseEvidenceMarkerIds(line);
      for (const id of refs) {
        if (!evidence.has(id)) violations.push(`${label}: unknown evidence id ${id}`);
      }
      if (!isStrongRuleLine(line)) return;
      if (refs.length === 0) {
        violations.push(`${label}: strong rule lacks evidence marker`);
        return;
      }
      const knownStatuses = refs.map((id) => evidence.get(id)?.status).filter(Boolean);
      for (const id of refs) {
        if (evidence.get(id)?.status === 'unverified') {
          violations.push(`${label}: strong rule references unverified evidence ${id}`);
        }
      }
      if (knownStatuses.length > 0 && knownStatuses.every((status) => status === 'inferred')) {
        violations.push(`${label}: strong rule must cite source-backed or user-provided evidence`);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// verify.md tool coverage
// ---------------------------------------------------------------------------

// A tool invoked through a package runner in verify.md is a dependency of the
// verification route. Assembly only resolves versions for deps.yaml entries,
// so an undeclared tool would never land in the target project's
// deps.resolved.md — the route would demand a tool nobody version-resolved.
const PACKAGE_RUNNERS = [
  { runner: 'uv run', re: /\buv run ([A-Za-z0-9_.-]+)/g },
  { runner: 'uvx', re: /\buvx ([A-Za-z0-9_.-]+)/g },
  { runner: 'poetry run', re: /\bpoetry run ([A-Za-z0-9_.-]+)/g },
  { runner: 'pipx run', re: /\bpipx run ([A-Za-z0-9_.-]+)/g },
  { runner: 'pdm run', re: /\bpdm run ([A-Za-z0-9_.-]+)/g },
  { runner: 'npx', re: /\bnpx (?:--?[A-Za-z-]+ )*([A-Za-z0-9@/_.-]+)/g },
  { runner: 'pnpm dlx', re: /\bpnpm dlx ([A-Za-z0-9@/_.-]+)/g },
  { runner: 'pnpm exec', re: /\bpnpm exec ([A-Za-z0-9@/_.-]+)/g },
  { runner: 'yarn dlx', re: /\byarn dlx ([A-Za-z0-9@/_.-]+)/g },
  { runner: 'bunx', re: /\bbunx ([A-Za-z0-9@/_.-]+)/g },
];

function normalizePackageName(name) {
  let n = name.trim();
  n = n.replace(/\[[^\]]*\]$/, ''); // pip extras: uvicorn[standard] -> uvicorn
  if (!n.startsWith('@')) n = n.replace(/@.+$/, ''); // npm pin: tool@1 -> tool
  return n.toLowerCase();
}

function declaredDependencyNames(deps) {
  const names = new Set();
  const entries = Array.isArray(deps?.dependencies) ? deps.dependencies : [];
  for (const entry of entries) {
    if (typeName(entry) !== 'object') continue;
    if (typeof entry.coordinate === 'string' && entry.coordinate.trim() !== '') {
      names.add(normalizePackageName(entry.coordinate.split(/\s+/)[0]));
    }
    const candidates = entry.lookup?.package_candidates;
    if (Array.isArray(candidates)) {
      for (const candidate of candidates) {
        if (typeof candidate === 'string') names.add(normalizePackageName(candidate));
      }
    }
  }
  return names;
}

function validateVerifyToolCoverage(verifyPath, hasDepsFile, deps, violations) {
  if (!isFile(verifyPath)) return;
  if (hasDepsFile && deps === null) return; // parse error already reported
  const declared = declaredDependencyNames(deps);
  const flagged = new Set();
  const lines = readFileSync(verifyPath, 'utf8').split(/\r?\n/);
  lines.forEach((line, idx) => {
    for (const { runner, re } of PACKAGE_RUNNERS) {
      re.lastIndex = 0;
      for (const match of line.matchAll(re)) {
        const tool = normalizePackageName(match[1]);
        if (declared.has(tool) || flagged.has(tool)) continue;
        flagged.add(tool);
        violations.push(hasDepsFile
          ? `verify.md:${idx + 1}: tool '${tool}' is invoked via '${runner}' but has no deps.yaml entry (assembly cannot resolve its version into deps.resolved.md)`
          : `verify.md:${idx + 1}: tool '${tool}' is invoked via '${runner}' but the pack has no deps.yaml`);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Full pack validation
// ---------------------------------------------------------------------------

/**
 * Validate one pack directory. Options:
 *   roots — discovery roots used to resolve `requires` (array of dirs).
 * Returns { ok, violations, meta } where meta is the parsed pack.yaml
 * (or null when it could not be parsed).
 */
export function validatePackDir(packDir, { roots = [join(REPO_ROOT, 'packs')] } = {}) {
  const violations = [];
  const dir = resolve(packDir);

  if (!isDir(dir)) {
    return { ok: false, violations: [`${dir}: pack directory does not exist`], meta: null };
  }

  // --- pack.yaml: present, parseable, schema-valid -------------------------
  const packYamlPath = join(dir, 'pack.yaml');
  let meta = null;
  if (!isFile(packYamlPath)) {
    violations.push('pack.yaml: missing (required)');
  } else {
    try {
      meta = parseYamlFile(packYamlPath);
    } catch (err) {
      if (err instanceof YamlError) violations.push(`pack.yaml: YAML parse error — ${err.message}`);
      else throw err;
    }
    if (meta !== null && typeName(meta) !== 'object') {
      violations.push(`pack.yaml: expected a mapping at top level, got ${typeName(meta)}`);
      meta = null;
    }
    if (meta !== null) {
      const schema = loadPackSchema();
      violations.push(...checkAgainstSchema(meta, schema, '').map((v) => `pack.yaml:${v}`));
    }
  }

  // --- directory naming must agree with id/type ----------------------------
  if (meta && typeof meta.id === 'string' && /^(stack|domain)\/[a-z0-9-]+$/.test(meta.id)) {
    const [idType, idName] = meta.id.split('/');
    if (basename(dir) !== idName) {
      violations.push(`structure: directory name '${basename(dir)}' does not match id short-name '${idName}' (id: ${meta.id})`);
    }
    if (basename(dirname(dir)) !== idType) {
      violations.push(`structure: parent directory '${basename(dirname(dir))}' does not match id type segment '${idType}' (id: ${meta.id})`);
    }
    if (typeof meta.type === 'string' && meta.type !== idType) {
      violations.push(`pack.yaml: type '${meta.type}' does not agree with id '${meta.id}'`);
    }
  }
  if (meta && ['stack', 'domain'].includes(meta.type) && basename(dirname(dir)) !== meta.type) {
    // Avoid duplicating the id-based parent-dir violation above.
    const alreadyFlagged = violations.some((v) => v.includes('does not match id type segment'));
    if (!alreadyFlagged) {
      violations.push(`structure: parent directory '${basename(dirname(dir))}' does not match type '${meta.type}'`);
    }
  }

  // --- verify.md: present and non-empty -------------------------------------
  const verifyPath = join(dir, 'verify.md');
  if (!isFile(verifyPath)) {
    violations.push('verify.md: missing (required)');
  } else if (readFileSync(verifyPath, 'utf8').trim() === '') {
    violations.push('verify.md: present but empty');
  }

  // --- knowledge/: present with at least one .md ----------------------------
  const knowledgeDir = join(dir, 'knowledge');
  if (!isDir(knowledgeDir)) {
    violations.push('knowledge/: missing (required, must be non-empty)');
  } else if (listMarkdownFiles(knowledgeDir).length === 0) {
    violations.push('knowledge/: contains no .md files (must be non-empty)');
  }

  // --- per-stack coverage for domain packs ----------------------------------
  if (meta && meta.type === 'domain' && Array.isArray(meta.stacks) && meta.stacks.length > 0) {
    const perStackDir = join(knowledgeDir, 'per-stack');
    if (isDir(perStackDir)) {
      for (const stack of meta.stacks) {
        if (typeof stack !== 'string') continue; // schema check already flags this
        if (!isFile(join(perStackDir, `${stack}.md`))) {
          violations.push(`knowledge/per-stack/: declared stack '${stack}' has no per-stack/${stack}.md`);
        }
      }
    }
  }

  // --- references/sources.md: Evidence Matrix and Markdown citations --------
  const evidence = validateEvidenceMatrix(dir, violations);
  const evidenceMarkdownFiles = [
    ...(isDir(knowledgeDir) ? listMarkdownFiles(knowledgeDir) : []),
    ...(isFile(verifyPath) ? [verifyPath] : []),
  ];
  validateEvidenceReferencesInMarkdown(dir, evidenceMarkdownFiles, evidence, violations);

  // --- deps.yaml: optional, but must parse and carry lookup strategies ------
  const depsPath = join(dir, 'deps.yaml');
  const hasDepsFile = isFile(depsPath);
  let deps = null;
  if (hasDepsFile) {
    try {
      deps = parseYamlFile(depsPath);
    } catch (err) {
      if (err instanceof YamlError) violations.push(`deps.yaml: YAML parse error — ${err.message}`);
      else throw err;
    }
    if (deps !== null) {
      if (typeName(deps) !== 'object') {
        violations.push(`deps.yaml: expected a mapping at top level, got ${typeName(deps)}`);
      } else if (deps.dependencies !== undefined) {
        if (!Array.isArray(deps.dependencies)) {
          violations.push("deps.yaml: 'dependencies' must be a list");
        } else {
          deps.dependencies.forEach((entry, idx) => {
            const label = `deps.yaml: dependencies[${idx}]` +
              (entry && typeof entry === 'object' && entry.coordinate ? ` (${entry.coordinate})` : '');
            if (typeName(entry) !== 'object') {
              violations.push(`${label}: expected a mapping, got ${typeName(entry)}`);
              return;
            }
            const lookup = entry.lookup;
            const hasLookup = typeName(lookup) === 'object' &&
              (typeof lookup.query === 'string' ||
                (Array.isArray(lookup.official_sources) && lookup.official_sources.length > 0));
            const hasSource = typeof entry.source === 'string' && entry.source.trim() !== '';
            if (!hasLookup && !hasSource) {
              violations.push(`${label}: must carry a lookup strategy (lookup.query / lookup.official_sources) or a source`);
            }
            if (!Array.isArray(entry.evidence) || entry.evidence.length === 0) {
              violations.push(`${label}: missing evidence array`);
            } else {
              entry.evidence.forEach((id, evidenceIdx) => {
                if (typeof id !== 'string') {
                  violations.push(`${label}: evidence[${evidenceIdx}] must be an evidence id string`);
                } else if (!evidence.has(id)) {
                  violations.push(`${label}: unknown evidence id ${id}`);
                }
              });
            }
          });
        }
      }
    }
  }

  // --- verify.md tools must be resolvable at assembly time ------------------
  validateVerifyToolCoverage(verifyPath, hasDepsFile, deps, violations);

  // --- requires resolution ---------------------------------------------------
  if (meta && Array.isArray(meta.requires)) {
    // A pack's own discovery root always counts (a user-level pack may require
    // a sibling in the same root).
    const ownRoot = dirname(dirname(dir));
    const effectiveRoots = [...new Set([...roots.map((r) => resolve(r)), ownRoot])];
    for (const req of meta.requires) {
      if (typeof req !== 'string' || !/^(stack|domain)\/[a-z0-9-]+$/.test(req)) continue; // schema flags it
      if (!idResolvesInRoots(req, effectiveRoots)) {
        violations.push(`requires: '${req}' does not resolve in any discovery root (${effectiveRoots.join(', ')})`);
      }
    }
  }

  return { ok: violations.length === 0, violations, meta };
}

// ---------------------------------------------------------------------------
// Topological sort (shared by group validation and install ordering)
// ---------------------------------------------------------------------------

/**
 * Kahn topological sort over a set of `nodes` and directed `edges`.
 *
 * An edge `[a, b]` means "a is a prerequisite of b" — a must appear BEFORE b in
 * the returned order (i.e. dependency-first ordering, exactly what install
 * closures want: install a before b when b depends on a). Ties are broken by
 * lexicographic node id so the order is deterministic.
 *
 * Pure function. Returns `{ order, cycle }`:
 *   - `order`: array of node ids in dependency-first order (complete iff acyclic).
 *   - `cycle`: null when acyclic, otherwise the sorted list of node ids that
 *     could not be ordered (the nodes involved in / downstream of a cycle).
 * Edges referencing nodes not present in `nodes` are ignored.
 */
export function topoSort(nodes, edges) {
  const nodeSet = new Set(nodes);
  const indegree = new Map([...nodeSet].map((n) => [n, 0]));
  const outgoing = new Map([...nodeSet].map((n) => [n, []]));
  for (const [a, b] of edges) {
    if (!nodeSet.has(a) || !nodeSet.has(b) || a === b) continue;
    outgoing.get(a).push(b);
    indegree.set(b, indegree.get(b) + 1);
  }
  const ready = [...nodeSet].filter((n) => indegree.get(n) === 0).sort();
  const order = [];
  while (ready.length > 0) {
    const n = ready.shift();
    order.push(n);
    let pushed = false;
    for (const m of outgoing.get(n)) {
      indegree.set(m, indegree.get(m) - 1);
      if (indegree.get(m) === 0) { ready.push(m); pushed = true; }
    }
    if (pushed) ready.sort();
  }
  if (order.length !== nodeSet.size) {
    const cycle = [...nodeSet].filter((n) => !order.includes(n)).sort();
    return { order, cycle };
  }
  return { order, cycle: null };
}

// ---------------------------------------------------------------------------
// Group validation
// ---------------------------------------------------------------------------

const GROUP_REF_ID_RE = /^(stack|domain)\/[a-z0-9-]+$/;

/** Resolve a pack id to its parsed pack.yaml across roots. Returns null when
 * it does not resolve or cannot be parsed as a mapping. */
function readPackYamlFromRoots(id, roots) {
  for (const root of roots) {
    const p = join(root, id, 'pack.yaml');
    if (!isFile(p)) continue;
    try {
      const parsed = parseYamlFile(p);
      return typeName(parsed) === 'object' ? { path: p, meta: parsed } : { path: p, meta: null };
    } catch {
      return { path: p, meta: null };
    }
  }
  return null;
}

/**
 * Validate one group.yaml file. Options:
 *   roots — discovery roots used to resolve member and requires pack ids.
 * Returns { ok, violations, meta } where meta is the parsed group.yaml (or null
 * when it could not be parsed). Enforces the 6 group invariants from
 * docs/plans/2026-07-06-polyrig-pack-group-spec.md. The logic is intentionally
 * self-contained so the registry can vendor it for joint validation.
 */
export function validateGroupFile(groupYamlPath, { roots = [join(REPO_ROOT, 'packs')] } = {}) {
  const violations = [];
  const path = resolve(groupYamlPath);
  const effectiveRoots = roots.map((r) => resolve(r));

  if (!isFile(path)) {
    return { ok: false, violations: [`${path}: group.yaml does not exist`], meta: null };
  }

  let meta = null;
  try {
    meta = parseYamlFile(path);
  } catch (err) {
    if (err instanceof YamlError) {
      return { ok: false, violations: [`group.yaml: YAML parse error — ${err.message}`], meta: null };
    }
    throw err;
  }
  if (typeName(meta) !== 'object') {
    return { ok: false, violations: [`group.yaml: expected a mapping at top level, got ${typeName(meta)}`], meta: null };
  }

  // --- schema shape (covers id/version/last_reviewed/summary/members shape) --
  const schema = loadGroupSchema();
  violations.push(...checkAgainstSchema(meta, schema, '').map((v) => `group.yaml:${v}`));

  // --- directory naming must agree with id -----------------------------------
  if (typeof meta.id === 'string' && /^group\/[a-z0-9-]+$/.test(meta.id)) {
    const name = meta.id.split('/')[1];
    if (basename(dirname(path)) !== name) {
      violations.push(`structure: directory name '${basename(dirname(path))}' does not match id short-name '${name}' (id: ${meta.id})`);
    }
  }

  // Defensive extraction: only well-formed refs feed the invariant checks;
  // malformed shapes are already reported by the schema pass above.
  const asRefs = (arr) => (Array.isArray(arr) ? arr : [])
    .filter((r) => typeName(r) === 'object' && typeof r.id === 'string');
  const members = asRefs(meta.members);
  const requires = asRefs(meta.requires);
  const memberIds = members.map((r) => r.id);
  const requireIds = requires.map((r) => r.id);
  const memberIdSet = new Set(memberIds);
  const requireIdSet = new Set(requireIds);

  // --- invariant 3: no duplicate member ids ----------------------------------
  const seenMember = new Set();
  for (const id of memberIds) {
    if (seenMember.has(id)) violations.push(`members: duplicate member id '${id}'`);
    seenMember.add(id);
  }
  const seenRequire = new Set();
  for (const id of requireIds) {
    if (seenRequire.has(id)) violations.push(`requires: duplicate requires id '${id}'`);
    seenRequire.add(id);
  }

  // --- invariant 4: members and group-level requires are disjoint ------------
  for (const id of requireIds) {
    if (memberIdSet.has(id)) {
      violations.push(`requires: '${id}' appears in both members and requires (a pack is either a member or an external dependency, not both)`);
    }
  }

  // --- invariant 2: every reference resolves and its version matches ---------
  // Cache parsed pack.yaml per id (used again by closure/conflict/cycle checks).
  const resolved = new Map(); // id -> { path, meta } | null
  const refFor = (id) => {
    if (!resolved.has(id)) resolved.set(id, readPackYamlFromRoots(id, effectiveRoots));
    return resolved.get(id);
  };
  const checkRefResolves = (ref, label) => {
    if (!GROUP_REF_ID_RE.test(ref.id)) return; // schema flags the bad id shape
    const found = refFor(ref.id);
    if (found === null) {
      violations.push(`${label}: '${ref.id}' does not resolve in any discovery root (${effectiveRoots.join(', ')})`);
      return;
    }
    if (found.meta === null) {
      violations.push(`${label}: '${ref.id}' pack.yaml at ${found.path} could not be parsed as a mapping`);
      return;
    }
    if (typeof ref.version === 'string' && found.meta.version !== ref.version) {
      violations.push(`${label}: '${ref.id}' version mismatch — group pins ${ref.version} but pack.yaml is ${found.meta.version}`);
    }
  };
  for (const ref of members) checkRefResolves(ref, 'members');
  for (const ref of requires) checkRefResolves(ref, 'requires');

  // --- invariant 1: dependency closure (one level) --------------------------
  for (const ref of members) {
    const found = refFor(ref.id);
    if (!found || found.meta === null) continue;
    const reqs = Array.isArray(found.meta.requires) ? found.meta.requires : [];
    for (const dep of reqs) {
      if (typeof dep !== 'string' || !GROUP_REF_ID_RE.test(dep)) continue;
      if (!memberIdSet.has(dep) && !requireIdSet.has(dep)) {
        violations.push(`closure: member '${ref.id}' requires '${dep}', which is neither a group member nor a group-level requires`);
      }
    }
  }

  // --- invariant 5: members must not conflict with sibling members ----------
  for (const ref of members) {
    const found = refFor(ref.id);
    if (!found || found.meta === null) continue;
    const conflicts = Array.isArray(found.meta.conflicts) ? found.meta.conflicts : [];
    for (const c of conflicts) {
      if (typeof c !== 'string') continue;
      if (c !== ref.id && memberIdSet.has(c)) {
        violations.push(`conflict: member '${ref.id}' declares conflicts with sibling member '${c}'`);
      }
    }
  }

  // --- invariant 6: the requires graph over (members + requires) is acyclic --
  const nodes = [...new Set([...memberIds, ...requireIds])];
  const nodeSet = new Set(nodes);
  const edges = [];
  for (const id of nodes) {
    const found = refFor(id);
    if (!found || found.meta === null) continue;
    const reqs = Array.isArray(found.meta.requires) ? found.meta.requires : [];
    for (const dep of reqs) {
      if (typeof dep !== 'string' || !nodeSet.has(dep)) continue;
      edges.push([dep, id]); // dep is a prerequisite of id
    }
  }
  const { order, cycle } = topoSort(nodes, edges);
  if (cycle) {
    violations.push(`cycle: requires graph is not acyclic; nodes involved in a cycle: ${cycle.join(', ')}`);
  }

  return {
    ok: violations.length === 0,
    violations,
    meta,
    topoOrder: cycle ? null : order,
  };
}
