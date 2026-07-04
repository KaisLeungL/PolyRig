// validate.mjs — shared validation helpers for PolyRig tooling.
//
// Two responsibilities:
//   1. checkAgainstSchema(): targeted, schema-driven checks for the JSON
//      Schema subset actually used by schemas/pack.schema.json (type, required,
//      properties, additionalProperties, enum, pattern, minLength, uniqueItems,
//      items). NOT a general-purpose JSON Schema engine — deliberately small,
//      but driven by reading the schema file so schema edits flow through.
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

/**
 * Validate `value` against the JSON Schema subset in `schema`.
 * Returns an array of violation strings, each prefixed with a JSON-pointer-ish
 * location (e.g. "pack.yaml:/trust/level: ...").
 */
export function checkAgainstSchema(value, schema, where = '') {
  const violations = [];
  const at = where === '' ? '(root)' : where;

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
        violations.push(...checkAgainstSchema(item, schema.items, `${where}/${idx}`));
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
        violations.push(...checkAgainstSchema(sub, props[key], `${where}/${key}`));
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

  // --- deps.yaml: optional, but must parse and carry lookup strategies ------
  const depsPath = join(dir, 'deps.yaml');
  if (isFile(depsPath)) {
    let deps = null;
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
          });
        }
      }
    }
  }

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
