// miniyaml.mjs — zero-dependency YAML-SUBSET parser for PolyRig tooling.
//
// SUPPORTED SUBSET (documented contract; anything else is a parse error):
//   - Nested maps by indentation. 2-space indentation is the convention used
//     by all PolyRig files; any consistent deeper indent per block is accepted.
//   - Block lists of scalars:
//         key:
//           - item
//   - Block lists of maps (needed for deps.yaml `dependencies` entries, see
//     docs/pack-protocol.md):
//         dependencies:
//           - coordinate: some-artifact
//             purpose: why it exists
//   - Inline arrays of scalars: [a, b, "c d"], []
//   - Scalars: unquoted string, single-/double-quoted string, integer, float,
//     boolean (true/false), null (null or ~). ISO dates (2026-07-04) stay
//     plain strings.
//   - Multi-line block scalars as map values or list items: literal (|) and
//     folded (>), with optional chomping indicators (+ keep, - strip).
//     Needed for the `notes: >` entries in builtin deps.yaml files.
//   - Comments: '#' at line start, or preceded by whitespace, outside quotes.
//
// DELIBERATELY NOT SUPPORTED (raises YamlError):
//   - anchors/aliases (& and *), flow maps ({...}), nested inline collections,
//     document markers (---), tabs in indentation, lists at the same indent
//     as their parent key, explicit-indent block-scalar headers (e.g. '|2').

import { readFileSync } from 'node:fs';

export class YamlError extends Error {
  constructor(message, file, line) {
    super(`${file}:${line}: ${message}`);
    this.name = 'YamlError';
    this.file = file;
    this.line = line;
  }
}

/** Parse YAML-subset text into plain JS values. */
export function parseYaml(text, file = '<yaml>') {
  const lines = [];
  const raw = String(text).split(/\r?\n/);
  for (let n = 0; n < raw.length; n++) {
    const noComment = stripComment(raw[n]);
    if (noComment.trim() === '') continue;
    const leading = /^[ \t]*/.exec(noComment)[0];
    if (leading.includes('\t')) {
      throw new YamlError('tab characters are not allowed in indentation', file, n + 1);
    }
    const trimmed = noComment.trim();
    if (trimmed === '---' || trimmed === '...') {
      throw new YamlError('YAML document markers are not supported by this subset', file, n + 1);
    }
    lines.push({ indent: leading.length, text: trimmed, line: n + 1 });
  }
  if (lines.length === 0) return null;
  const st = { lines, raw, file };
  const [value, next] = parseBlock(st, 0, 0);
  if (next < lines.length) {
    throw new YamlError(
      `unexpected content at indent ${lines[next].indent} (inconsistent indentation?)`,
      file, lines[next].line,
    );
  }
  return value;
}

/** Read a file and parse it as YAML subset. */
export function parseYamlFile(path) {
  return parseYaml(readFileSync(path, 'utf8'), path);
}

// ---------------------------------------------------------------------------

function stripComment(line) {
  let out = '';
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (quote === '"' && ch === '\\') { out += ch + (line[i + 1] ?? ''); i++; continue; }
      if (ch === quote) quote = null;
      out += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; out += ch; continue; }
    if (ch === '#' && (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t')) return out;
    out += ch;
  }
  return out;
}

function isListItem(text) {
  return text === '-' || text.startsWith('- ');
}

function parseBlock(st, i, minIndent) {
  if (i >= st.lines.length || st.lines[i].indent < minIndent) return [null, i];
  return isListItem(st.lines[i].text) ? parseList(st, i) : parseMap(st, i);
}

function parseMap(st, i) {
  const { lines, file } = st;
  const indent = lines[i].indent;
  const obj = {};
  while (i < lines.length && lines[i].indent >= indent) {
    const ln = lines[i];
    if (ln.indent > indent) {
      throw new YamlError(`bad indentation (expected ${indent} spaces)`, file, ln.line);
    }
    if (isListItem(ln.text)) {
      throw new YamlError('list item found where a map key was expected', file, ln.line);
    }
    const sep = findKeySep(ln.text);
    if (sep <= 0) {
      throw new YamlError(`expected 'key: value' or 'key:', got '${ln.text}'`, file, ln.line);
    }
    const key = ln.text.slice(0, sep).trim();
    if (/[\s"'[\]{}]/.test(key)) {
      throw new YamlError(`unsupported key '${key}' (quoted/complex keys are not supported)`, file, ln.line);
    }
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      throw new YamlError(`duplicate key '${key}'`, file, ln.line);
    }
    const rest = ln.text.slice(sep + 1).trim();
    let value;
    if (rest === '') {
      if (i + 1 < lines.length && lines[i + 1].indent > indent) {
        const [v, ni] = parseBlock(st, i + 1, indent + 1);
        value = v;
        i = ni;
      } else {
        value = null;
        i += 1;
      }
    } else if (isBlockScalarHeader(rest)) {
      const [v, ni] = parseBlockScalar(st, i, indent, rest);
      value = v;
      i = ni;
    } else {
      value = parseValue(rest, file, ln.line);
      i += 1;
    }
    Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
  }
  return [obj, i];
}

function parseList(st, i) {
  const { lines, file } = st;
  const indent = lines[i].indent;
  const arr = [];
  while (i < lines.length && lines[i].indent >= indent) {
    const ln = lines[i];
    if (ln.indent > indent) {
      throw new YamlError(`bad indentation in list (expected ${indent} spaces)`, file, ln.line);
    }
    if (!isListItem(ln.text)) break; // sibling handled (or rejected) by the caller
    const rest = ln.text === '-' ? '' : ln.text.slice(1).trim();
    if (rest === '') {
      const [v, ni] = parseBlock(st, i + 1, indent + 1);
      arr.push(v);
      i = ni;
    } else if (isBlockScalarHeader(rest)) {
      const [v, ni] = parseBlockScalar(st, i, indent, rest);
      arr.push(v);
      i = ni;
    } else if (rest[0] !== '"' && rest[0] !== "'" && rest[0] !== '[' && findKeySep(rest) > 0) {
      // '- key: value' — a list item that is a map. Its content column is
      // indent + 2 (the standard '- ' offset); continuation keys align there.
      const saved = lines[i];
      lines[i] = { indent: indent + 2, text: rest, line: ln.line };
      const [v, ni] = parseMap(st, i);
      lines[i] = saved;
      arr.push(v);
      i = ni;
    } else {
      arr.push(parseValue(rest, file, ln.line));
      i += 1;
    }
  }
  return [arr, i];
}

function isBlockScalarHeader(s) {
  return /^[|>][+-]?$/.test(s);
}

/**
 * Parse a literal (|) or folded (>) block scalar whose header sits on the
 * lexed line `i` (a 'key: >' value or a '- |' list item). Content is read from
 * the RAW lines (comment stripping and blank-line dropping must not apply
 * inside a block scalar). Returns [text, nextLexedIndex].
 * `parentIndent` is the indent of the line carrying the header; content lines
 * must be indented deeper than it.
 */
function parseBlockScalar(st, i, parentIndent, header) {
  const { lines, raw, file } = st;
  const ln = lines[i];
  const style = header[0];
  const chomp = header[1] ?? '';
  // Raw lines are 1-based via line numbers; content starts on the raw line
  // right after the header line, i.e. raw index ln.line.
  let r = ln.line;
  const collected = []; // content lines with block indent removed ('' for blank)
  let blockIndent = -1;
  let lastContent = -1; // index in `collected` of the last non-blank line
  while (r < raw.length) {
    const rawLine = raw[r];
    if (rawLine.trim() === '') {
      collected.push('');
      r += 1;
      continue;
    }
    const leading = /^[ \t]*/.exec(rawLine)[0];
    if (leading.includes('\t')) {
      throw new YamlError('tab characters are not allowed in indentation', file, r + 1);
    }
    if (leading.length <= parentIndent) break;
    if (blockIndent === -1) blockIndent = leading.length;
    if (leading.length < blockIndent) {
      throw new YamlError(
        `bad indentation in block scalar (expected at least ${blockIndent} spaces)`,
        file, r + 1,
      );
    }
    collected.push(rawLine.slice(blockIndent));
    lastContent = collected.length - 1;
    r += 1;
  }
  const trailingBlanks = collected.length - (lastContent + 1);
  const content = collected.slice(0, lastContent + 1);
  let text;
  if (style === '|') {
    text = content.join('\n');
  } else {
    // Folded: non-blank neighbours joined by a space, blank lines -> newlines.
    text = '';
    let prevWasContent = false;
    for (const part of content) {
      if (part === '') {
        text += '\n';
        prevWasContent = false;
      } else {
        if (prevWasContent) text += ' ';
        text += part;
        prevWasContent = true;
      }
    }
  }
  if (chomp === '+') {
    if (text !== '' || trailingBlanks > 0) text += '\n'.repeat(trailingBlanks + (content.length > 0 ? 1 : 0));
  } else if (chomp !== '-' && text !== '') {
    text += '\n'; // clip: exactly one trailing newline when there is content
  }
  // Skip any lexed lines that fell inside the consumed raw region
  // (raw indices ln.line .. r-1 are line numbers ln.line+1 .. r).
  let ni = i + 1;
  while (ni < lines.length && lines[ni].line <= r) ni += 1;
  return [text, ni];
}

/** Find the index of a ':' that separates key from value (':' followed by a space or end of text). */
function findKeySep(s) {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === ':' && (i + 1 === s.length || s[i + 1] === ' ')) return i;
  }
  return -1;
}

function parseValue(s, file, line) {
  if (s.startsWith('[')) return parseInlineArray(s, file, line);
  if (s.startsWith('{')) {
    throw new YamlError('flow maps ({...}) are not supported by this YAML subset', file, line);
  }
  if (s.startsWith('&') || s.startsWith('*')) {
    throw new YamlError('anchors/aliases are not supported by this YAML subset', file, line);
  }
  if (isBlockScalarHeader(s)) {
    // Handled by parseMap/parseList before reaching here; elsewhere (inline
    // arrays) block scalars are invalid.
    throw new YamlError('block scalar (| or >) is not valid in this position', file, line);
  }
  return parseScalar(s, file, line);
}

function parseScalar(s, file, line) {
  if (s[0] === '"' || s[0] === "'") return parseQuoted(s, file, line);
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  if (/^[+-]?\d+$/.test(s)) return parseInt(s, 10);
  if (/^[+-]?\d+\.\d+$/.test(s)) return parseFloat(s);
  return s; // plain string, including ISO dates like 2026-07-04
}

function parseQuoted(s, file, line) {
  const q = s[0];
  let out = '';
  let i = 1;
  while (i < s.length) {
    const ch = s[i];
    if (q === '"' && ch === '\\') {
      const map = { n: '\n', t: '\t', '\\': '\\', '"': '"' };
      const nxt = s[i + 1];
      if (!(nxt in map)) throw new YamlError(`unsupported escape sequence \\${nxt ?? ''}`, file, line);
      out += map[nxt];
      i += 2;
      continue;
    }
    if (ch === q) {
      if (q === "'" && s[i + 1] === "'") { out += "'"; i += 2; continue; } // '' -> '
      if (i !== s.length - 1) {
        throw new YamlError('unexpected content after closing quote', file, line);
      }
      return out;
    }
    out += ch;
    i += 1;
  }
  throw new YamlError('unterminated quoted string', file, line);
}

function parseInlineArray(s, file, line) {
  if (!s.endsWith(']')) throw new YamlError('unterminated inline array', file, line);
  const inner = s.slice(1, -1).trim();
  if (inner === '') return [];
  const parts = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote) {
      if (quote === '"' && ch === '\\') { cur += ch + (inner[i + 1] ?? ''); i++; continue; }
      if (ch === quote) quote = null;
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '[' || ch === '{') {
      throw new YamlError('nested inline collections are not supported by this YAML subset', file, line);
    }
    if (ch === ',') { parts.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  parts.push(cur.trim());
  return parts.map((p) => {
    if (p === '') throw new YamlError('empty element in inline array', file, line);
    return parseScalar(p, file, line);
  });
}
