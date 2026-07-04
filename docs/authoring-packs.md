# Authoring PolyRig Packs

How to hand-author a protocol-compliant pack. The protocol lives in
[`schemas/pack.schema.json`](../schemas/pack.schema.json) and
[`docs/pack-protocol.md`](pack-protocol.md); this guide walks one real
user-level domain pack from empty directory to a passing `validate-pack.mjs`
run, with `packs/domain/auth-google/` as the reference.

## 1. When to write a pack

The test: **would a competent AI, cold, reconstruct this reliably?**

- **Write a pack** for knowledge it cannot: your team's hard-won domain
  experience, non-obvious decision trees, production-discovered pitfalls,
  security red lines. If losing the chat history loses it, it needs a pack.
- **Skip the pack** for knowledge the AI already has: what OAuth is, how
  FastAPI routing works, general language idioms. Textbook material wastes
  context budget and rots.

Pack type: a **stack pack** carries framework/toolchain conventions (project
structure, build/verify commands, version pitfalls); a **domain pack** carries
business-domain knowledge, optionally with per-stack notes. If the knowledge
survives a stack swap, it is a domain pack.

## 2. Walkthrough: a user-level domain pack, by hand

Running example: a **voice input-method (voice IME)** domain pack — the
canonical case of private business-domain knowledge (recognition-mode
decision trees, latency budgets, IME lifecycle traps) no model reconstructs.

### 2.1 Create the directory

User-level packs live under `~/.claude/polyrig-packs/`, in a
`<type>/<short-name>` layout. **The directory path must agree with the pack
id** — the validator checks both segments. Run
`mkdir -p ~/.claude/polyrig-packs/domain/voice-ime/knowledge`, then build
toward this shape:

```
domain/voice-ime/
  pack.yaml               # REQUIRED
  knowledge/              # REQUIRED, at least one .md
    overview.md
    pitfalls.md
    per-stack/android.md  # one per declared stack
  deps.yaml               # optional
  verify.md               # REQUIRED, non-empty
```

### 2.2 pack.yaml, field by field

```yaml
id: domain/voice-ime
type: domain
version: 0.1.0
last_reviewed: 2026-07-04
summary: Voice IME domain knowledge (recognition mode selection, latency budgets, IME lifecycle)
requires: []
conflicts: []
provides: [voice-ime]
stacks: [android]
trust:
  level: user
  scripts_enabled_by_default: false
  requires_confirmation: true
```

- `id` — must match `^(stack|domain)/[a-z0-9-]+$` and agree with both the
  `type` field (`stack` or `domain`) and the directory path
  (`.../domain/voice-ime/`). Both required.
- `version` — strict semver (`0.1.0`; no `v` prefix, no `1.0`). Versions the
  pack **content**, not any library it mentions. Required.
- `last_reviewed` — `YYYY-MM-DD`, when a human last reviewed the content;
  drives the staleness warning (section 3). Required.
- `summary` — one non-empty line. Required.
- `requires` / `conflicts` — other pack ids (same pattern as `id`, unique).
  Every `requires` entry must resolve in a discovery root at validation time.
- `provides` — capability tags consumers can match on.
- `stacks` — stack short-names (`^[a-z0-9-]+$`) covered by per-stack notes;
  see 2.4.
- `trust` — declare `level: user` for a pack in your user root; keep
  `scripts_enabled_by_default: false`. Optional block, but declare it; the
  discovery-root rules (section 5) always beat this self-declaration.

The schema sets `additionalProperties: false` — any extra field is a
violation. YAML note: PolyRig parses a deliberate YAML subset (2-space indent,
inline scalar arrays, `|`/`>` block scalars, comments; no anchors, flow maps,
tabs, or `---`).

### 2.3 knowledge/overview.md and pitfalls.md

`overview.md` carries the decisions; `pitfalls.md` the traps and red lines.
One admission test for every sentence in both: **"would this sentence still be
true in 18 months?"** If not, move it to `deps.yaml` (2.5) or drop it.

Good voice-ime overview content: the streaming-vs-batch decision tree
(dictation needs streaming partials; command input can batch), the
on-device-vs-cloud tradeoff (privacy/offline/latency vs accuracy/model size),
IME lifecycle constraints (the OS creates and destroys an IME around focus
changes — recognition sessions must die cleanly with it). Good pitfalls
content: mic-permission and privacy red lines (recording indicators, never log
raw audio or transcripts), latency budgets, IME switching edge cases. Write
decisions and reasons, not tutorials: the AI knows how to call a speech API;
it does not know which mode your product requires or which trap bit you.

`pitfalls.md` is a strong convention, not validator-enforced (only a non-empty
`knowledge/` is required). Keep it anyway; consumers look for it.

### 2.4 per-stack/ files and the stacks field

Add `knowledge/per-stack/<stack>.md` when the domain has stack-specific
implementation decisions (where recognition lives architecturally on Android,
which platform surface to use). The `stacks` field couples to the files:
**every short-name listed in `stacks` must have a matching
`knowledge/per-stack/<stack>.md`** — the validator flags any declared stack
without its file. Use the same short-names as the stack packs so the interview
can filter domain packs by chosen stacks; a stack-agnostic pack declares
`stacks: []` with no `per-stack/`. Per-stack files assume the stack pack's
conventions — reference them, never restate them.

### 2.5 deps.yaml — volatile facts live here, never in prose

Every version-shaped or churn-prone fact goes into `deps.yaml` as a
**coordinate + lookup strategy + official sources**:

```yaml
version_policy: verify_latest_before_use
dependencies:
  - coordinate: android.speech.SpeechRecognizer (platform API)
    stack: android
    purpose: On-device speech recognition surface for the IME
    lookup:
      query: "android on-device speech recognition recommended API latest"
      official_sources:
        - https://developer.android.com/reference/android/speech/SpeechRecognizer
    notes: Confirm which recognition surface is currently recommended before use.
```

Each entry must carry a `lookup` block (a `query` string and/or non-empty
`official_sources`) or a `source` string — the validator rejects entries with
neither. Never write "use version X.Y" in prose or here: write *how to find
the current answer* and what to double-check.

### 2.6 verify.md — the domain's definition of done

`verify.md` is the checklist an agent runs before marking a feature built with
this pack `verified`. Required and non-empty. Make items concrete and
falsifiable; mark each **[A]** automated (say what kind of test) or **[M]**
manual/documented. For voice-ime: mic-permission denial path, recording
indicator while capturing, latency budgets measured, IME switch-mid-dictation
behavior, no transcript in logs. If your pack `requires` another pack, extend
that pack's checklist explicitly instead of duplicating it (auth-google shows
the pattern).

## 3. The freshness discipline

- **Slow-changing prose** — decision trees, principles, red lines,
  verification reasoning — lives in `knowledge/*.md` and `verify.md`.
- **Volatile lookups** — versions, package names, API surfaces — live in
  `deps.yaml` under `version_policy: verify_latest_before_use`.
- **At assembly time** the AI executes the lookups online and writes dated,
  sourced, confidence-rated results into the target project's
  `deps.resolved.md`. Resolved facts never flow back into pack prose.
- Bump `last_reviewed` whenever you re-review. Older than the threshold
  (default **180 days**) triggers an assembly staleness warning — an
  unreviewed pack is presumed rotting.

## 4. Discovery and precedence

Packs are discovered from three roots; on id collision the most specific wins
(**project > user > builtin**):

1. **builtin** — `packs/` in the PolyRig repository
2. **user** — `~/.claude/polyrig-packs/`
3. **project** — `<target>/.polyrig/packs/`

An override means the consumer gets **your** pack everywhere the id is used —
knowledge copied into `docs/domains/<id>/`, verify routes, deps lookups — and
the shadowed pack is not consulted at all. A user-root `domain/auth-google`
replaces the builtin for every project you initialize, so `/polyrig` announces
every override explicitly (winning source path, whether it carries `scripts/`,
required review action) and records it in the target's
`.polyrig/manifest.json` under `overrides`. Prefer a new id plus `requires`
over an override unless replacement is the point.

## 5. Trust implications for authors

| Source | Read/copy | Run scripts |
|---|---|---|
| builtin | yes | safe scripts allowed |
| user | yes | only after explicit confirmation |
| project | yes | **never by default** |
| remote | unsupported in v1 | — |

The root your pack is discovered in — not its `trust` block — decides script
execution. Therefore: **a pack must work without its `scripts/`.** Scripts are
optional deterministic conveniences (env checks, config gen); if the knowledge
is unusable unless a script runs, the pack breaks exactly where trust rules
block execution. Substance goes in prose and checklists; scripts save typing.

## 6. Validation

```bash
node scripts/validate-pack.mjs <pack-dir> [--roots <dir,dir,...>]
```

`--roots` semantics (they matter): a comma-separated list of discovery roots
used only to resolve `requires`; the default is the PolyRig repo's `packs/`
(builtin). **When given, the list REPLACES the default** — include builtin
`packs/` explicitly if your `requires` spans it. The pack's **own containing
root always counts in addition**, so a pack requiring a sibling in its own
root, or only builtin packs, needs no flag; requires spanning other roots need
`--roots` listing every root involved.

Violation classes:

- **pack.yaml** — missing, YAML parse error, or schema violation (bad id
  pattern, non-semver version, malformed date, unknown field, bad trust enum).
- **structure** — directory or parent-directory name disagrees with the id or
  `type`.
- **verify.md** — missing or empty; **knowledge/** — missing or without any
  `.md` file; **knowledge/per-stack/** — a declared stack lacks its
  `per-stack/<stack>.md`.
- **deps.yaml** — parse error, or a dependency entry with neither a lookup
  strategy nor a source.
- **requires** — a required id resolves in no discovery root.

Exit 0 prints `PASS <id>`; exit 1 lists every specific violation. **A pack
must pass before use** — `doctor.mjs` enforces this for builtins; enforce it
yourself for user and project packs.

## 7. Reference tour: packs/domain/auth-google/

- **`pack.yaml`** — `requires: [domain/auth-core]` with `stacks: [android,
  backend-fastapi]`: it layers on a foundation pack instead of duplicating it.
- **`knowledge/overview.md`** — the opening paragraph states the layering
  contract ("everything provider-agnostic ... is stated ONCE in auth-core");
  §1 is era-proof prose ("never hardcode an era ... determine that surface by
  executing the lookups in deps.yaml"); §2 (client-ID topology, the
  `aud`-is-the-web-client-ID trap) is the model of slow-changing, hard-won
  knowledge that passes the 18-month test.
- **`deps.yaml`** — every entry is coordinate + purpose + lookup + official
  Google sources + what to double-check; the header comment states the
  no-pinned-versions rule outright.
- **`knowledge/per-stack/android.md`, `backend-fastapi.md`** — one file per
  declared stack; each opens by assuming its stack pack's conventions rather
  than restating them.
- **`verify.md`** — opens "This checklist EXTENDS the auth-core verification
  checklist — run that one first and in full", then adds only Google-specific
  [A]/[M] items. Copy that `requires`-without-duplication pattern.
