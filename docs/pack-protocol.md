# The PolyRig Pack Protocol

A pack is a **pure data directory** — never a skill, never executable by itself,
occupying no skill-trigger budget. Two pack types share one protocol:

- **`stack` packs** — framework conventions, project structure, build/verify
  commands, version pitfalls. Examples: `stack/android`, `stack/backend-fastapi`.
- **`domain` packs** — business domain knowledge, optionally with per-stack
  implementation notes. Examples: `domain/auth-core`, `domain/auth-google`.

Assembly order: pick stack pack(s) first, then compatible domain packs (filtered
by the chosen stacks); resolve `requires`/`conflicts`.

The machine-checkable side of this protocol lives in
[`schemas/pack.schema.json`](../schemas/pack.schema.json) (pack metadata),
[`schemas/feature_list.schema.json`](../schemas/feature_list.schema.json), and
[`schemas/manifest.schema.json`](../schemas/manifest.schema.json). This document
is the prose side, with worked examples.

## Directory structure

```
packs/<type>/<id>/
  pack.yaml            # metadata — REQUIRED (governed by schemas/pack.schema.json)
  knowledge/           # REQUIRED, must be non-empty
    overview.md        # slow-changing: architecture decision trees, principles
    pitfalls.md        # known traps, security red lines
    per-stack/         # domain packs only: per-stack implementation notes
      android.md
      backend-fastapi.md
  references/          # REQUIRED source and evidence material
    sources.md         # REQUIRED Evidence Matrix
  deps.yaml            # OPTIONAL: dependency coordinates + lookup strategy
  verify.md            # REQUIRED: self-check list for features built with this pack
  scripts/             # OPTIONAL: deterministic helpers (env check, config gen)
```

Structural rules:

- `pack.yaml`, `verify.md`, a **non-empty** `knowledge/` directory, and
  `references/sources.md` are required. A pack missing any of these fails
  `scripts/validate-pack.mjs`.
- `deps.yaml` and `scripts/` are optional.
- A **domain pack that declares `stacks`** in its `pack.yaml` should provide a
  matching `knowledge/per-stack/<stack>.md` for each declared stack short-name.
- Knowledge is Markdown prose. Nothing in `knowledge/` is executed; it is copied
  verbatim into the target project's `docs/stacks/<id>/` or `docs/domains/<id>/`.
- `references/sources.md` is also copied into the target project as `sources.md`
  beside the knowledge files. It is evidence material for disputes, audits, and
  provenance tracing; it is not required reading for routine implementation.

## pack.yaml

Metadata, validated against `schemas/pack.schema.json` **after YAML parsing**
(the schema is JSON Schema; the on-disk format is YAML). Full worked example —
the builtin `domain/auth-google` pack:

```yaml
id: domain/auth-google
type: domain            # stack | domain
version: 0.1.0
last_reviewed: 2026-07-04
summary: Google Sign-In domain knowledge (OAuth/OIDC flows, token handling)
requires: [domain/auth-core]      # pack dependencies, resolved at assembly
conflicts: []
provides: [google-sign-in]
stacks: [android, backend-fastapi]   # stacks covered in knowledge/per-stack/
trust:
  level: builtin        # builtin | user | project | remote
  scripts_enabled_by_default: false
  requires_confirmation: true
```

Field notes:

- `id` must match `^(stack|domain)/[a-z0-9-]+$`, agree with the `type` field,
  and agree with the pack's directory path.
- `version` is a semver string for the pack **content**, independent of any
  library versions the pack talks about.
- `last_reviewed` (YYYY-MM-DD) drives the staleness check: older than the
  threshold (default 180 days) triggers a warning during assembly.
- `requires` / `conflicts` reference other pack ids and are resolved when the
  user selects packs in the interview.
- `trust` declares the intended trust posture; the discovery-root rules below
  always take precedence over what a pack claims about itself.

## Knowledge freshness rules

The single most important authoring rule:

- Pack prose (`knowledge/*.md`, `verify.md`) contains **slow-changing knowledge
  only**: architecture decision trees, principles, known traps, security red
  lines, verification reasoning. If a statement can rot in six months, it does
  not belong in prose.
- **Volatile facts** — SDK versions, exact package names that churn, API
  details — live in `deps.yaml` as coordinates plus a **lookup strategy**
  (what to search, where the official source is), never as pinned "latest"
  versions in prose.
- During assembly, the AI executes the lookup strategies online, verifies
  current versions and breaking changes, and writes the results into the target
  project's `deps.resolved.md` — dated, sourced, confidence-rated. Verified
  results are **never written back into pack prose** as eternal facts.

## Evidence Matrix

Every pack MUST include `references/sources.md` with a `## Evidence Matrix`
section. The matrix is a Markdown table that gives stable evidence ids for
source-backed, user-provided, inferred, or unverified claims.

Required columns:

```text
id, claim, status, source_type, urls, applies_to, volatility, notes
```

Rules:

- `id` uses `E001` format, is unique within the pack, and is referenced from
  pack prose as inline markers such as `[Evidence: E001, E002]`.
- Strong rules, security red lines, and must/never requirements in
  `knowledge/*.md` and `verify.md` cite evidence markers.
- Strong rules do not rely on `unverified` evidence, and do not rely only on
  `inferred` evidence.
- Each `deps.yaml` dependency entry cites the evidence ids that justify its
  lookup strategy.

During `/polyrig` generation, `references/sources.md` is copied to:

- stack pack: `<target>/docs/stacks/<short-id>/sources.md`
- domain pack: `<target>/docs/domains/<short-id>/sources.md`

The copied `sources.md` file is included in the selected pack checksum recorded
in `.polyrig/manifest.json`, so the manifest covers both daily knowledge and the
Evidence Matrix that supports it.

## deps.yaml

Dependency coordinates + lookup strategy + official sources. Worked example
(shape used by `domain/auth-google`):

```yaml
# packs/domain/auth-google/deps.yaml
version_policy: verify_latest_before_use
dependencies:
  - coordinate: com.google.android.libraries.identity.googleid:googleid
    stack: android
    purpose: Sign in with Google via Credential Manager
    lookup:
      query: "googleid library latest version Credential Manager Sign in with Google"
      official_sources:
        - https://developer.android.com/identity/sign-in/credential-manager-siwg
        - https://maven.google.com/
    notes: Verify whether the Credential Manager APIs have superseded older GoogleSignIn APIs before use.
  - coordinate: google-auth (PyPI)
    stack: backend-fastapi
    purpose: Verify Google ID tokens server-side
    lookup:
      query: "google-auth python verify_oauth2_token latest"
      official_sources:
        - https://googleapis.dev/python/google-auth/latest/
        - https://pypi.org/project/google-auth/
    notes: Check audience-validation API surface for breaking changes.
```

Rules:

- `version_policy: verify_latest_before_use` is the standing instruction: never
  trust a remembered version; verify online at assembly time.
- Each entry is a **coordinate** (stable identifier), a **purpose**, a `lookup`
  block with a search query and **official** doc/source URLs, and optional notes
  on what to double-check.

## deps.resolved.md (generated artifact convention)

Lives in the **target project**, not in packs. One dated entry per resolved
dependency:

```markdown
# Dependency resolution — resolved-at: 2026-07-04

## com.google.android.libraries.identity.googleid:googleid
- resolved version: <version found online>
- source: https://developer.android.com/identity/sign-in/credential-manager-siwg
- confidence: high (official docs, checked 2026-07-04)
- re-check action: re-run the deps.yaml lookup query if this entry is older
  than 90 days or the build fails resolving the artifact
```

Every entry carries: **resolved-at date**, **source** (URL actually consulted),
**confidence** rating, and a **re-check action** describing when and how to
re-verify.

## Discovery roots and override precedence

Packs are discovered from three logical roots. On id collision the **most
specific wins**: `project > user > builtin`.

1. **builtin** — `packs/` in the PolyRig repository
2. **user** — `~/.polyrig/packs/` (legacy `~/.claude/polyrig-packs/` is still scanned)
3. **project** — `.polyrig/packs/` in the target project

When an override is detected, assembly MUST announce it explicitly: the source
path of the winning pack, whether it carries `scripts/`, and the required review
action. Applied overrides are recorded in the target project's
`.polyrig/manifest.json` under `overrides`.

## Trust model (v1)

| Source | Read/copy | Run scripts |
|---|---|---|
| builtin | yes | safe scripts allowed |
| user | yes | only after explicit confirmation |
| project | yes | **never by default** |
| remote | unsupported in v1 | — |

Rationale: pack knowledge is reviewable text and safe to read and copy from any
root. Scripts are code; a project-level pack may arrive with an untrusted cloned
repository, so its scripts never run by default — regardless of what its
`trust.scripts_enabled_by_default` claims.

## Validation

- `node scripts/validate-pack.mjs <pack-dir>` validates `pack.yaml` against
  `schemas/pack.schema.json` and checks the structural rules above (required
  files, Evidence Matrix shape and references, per-stack coverage, resolvable
  `requires`).
- `node scripts/build-pack-index.mjs` scans the three discovery roots, applies
  override precedence, and emits an index including trust source and script
  presence per pack.

For a hands-on walkthrough of authoring your own pack, see
[`docs/authoring-packs.md`](authoring-packs.md).
