---
name: polyrig-pack-author
description: Create or update PolyRig packs; generate stack/domain packs; add Evidence Matrix coverage; author user, project, or builtin packs; search official docs; validate draft packs before reporting ready.
---

# PolyRig Pack Author

Use this skill to produce or maintain PolyRig packs. It authors packs; `/polyrig`
consumes packs.

Keep the interview in the user's language. Pack artifacts default to English
unless the user explicitly asks for another language.

Load the detailed contract before writing: `references/pack-authoring-contract.md`.
Use the fixed reviewer prompts in `references/review-prompts.md` at the review
gate.

## Defaults

- Default write root: `~/.polyrig/packs/`.
- Project write root: `<target>/.polyrig/packs/`, only after explicit choice.
- Builtin write root: `<POLYRIG_ROOT>/packs/`, only after explicit choice.
- Template root: `assets/pack-template/`.
- Do not generate `scripts/` by default.

## Workflow

Run these six phases in order. Ask 1-3 focused questions at a time; state the
recommended answer and accept a default when safe.

### 1. Pack identity

Decide whether this is create or update. Confirm pack type (`stack` or `domain`),
pack id (`stack/<short-name>` or `domain/<short-name>`), target root, and whether
an existing pack should be read before editing.

### 2. Use cases

Capture what future agents should decide with this pack, which tasks should
trigger it, and which outcomes have to be verified.

### 3. Boundaries

Define covered and out-of-scope material. For domain packs, confirm compatible
stack short-names. Confirm `requires`, `conflicts`, and `provides`.

### 4. Source plan

State the search/read scope before gathering sources. Prefer official docs,
standards, security/privacy/reliability docs, and vendor docs. User-provided local
files or pasted material are allowed. Forums, marketing blogs, and social media
may inform questions but are not authoritative sources.

### 5. Knowledge extraction

Write slow-changing decisions into `knowledge/overview.md`, traps and red lines
into `knowledge/pitfalls.md`, volatile lookup strategy into `deps.yaml`, concrete
completion checks into `verify.md`, and all evidence into
`references/sources.md`.

Every strong rule or red line needs an inline marker such as
`[Evidence: E001]`. Every dependency entry needs `evidence: [E001]`.

### 6. Review gate

Write the pack as a draft first. Then start the independent verification gate.
Do not validate your own pack in the same implementation context when subagents
or fresh independent sessions are available.

Assign an independent verification context to run:

```bash
node scripts/validate-pack.mjs <pack-dir>
```

Then automatically route two independent reviews using the fixed prompts. This
is part of the skill flow, not a manual follow-up for the user. If subagents or
fresh independent sessions are available, start them yourself after independent
validation passes. Only defer when independent validation/review is genuinely
unavailable or the user explicitly asks to stop; state that limitation, keep the
result as `draft written`, and do not report `ready`.

1. Protocol / structure reviewer: pack protocol, directory shape, Evidence
   Matrix, references, validation readiness.
2. Content / safety reviewer: stale facts, unsupported claims, safety/privacy
   red lines, misleading guidance.

Report `ready` only when validation was run by an independent context, validation
passes, and both reviews have no blocking issues. Otherwise report
`draft written`, list blocking issues or the missing independent capability, and
keep the draft in place.

## Authoring a pack group (`groups/<name>/group.yaml`)

A **group** is a versioned, reference-style manifest that bundles member packs by
id + pinned version. It is the install and publish unit; the member packs stay
atomic and unchanged. Use this subflow when the user wants to bundle related
packs (e.g. a shared `auth-core` plus provider packs) into one installable suite.
Full field rules live in `references/pack-authoring-contract.md`; group.yaml is
validated against `$POLYRIG_ROOT/schemas/group.schema.json`.

Run these phases in order, structurally like the six-phase pack flow (ask 1-3
questions at a time, state a recommendation, accept a safe default):

1. **Group identity.** Decide create or update. Confirm group id
   (`group/<name>`), summary, and target root (`<POLYRIG_ROOT>/groups/<name>/`
   for builtin; groups otherwise follow the same root choice as packs). The
   directory path must agree with the id.
2. **Members.** Choose the member packs (each `<stack|domain>/<name>`). For each,
   **auto-read its current `pack.yaml` version** and pin that exact version in
   `members[].version` — this generates the lock; never ask the user to type a
   version they'd only guess. Members must be unique.
3. **External dependencies (`requires`).** Declare any **out-of-group** packs the
   group depends on, each pinned to an exact version. An id here must never also
   appear in `members`. Leave `requires: []` when the group is self-contained
   (every member's own `requires` are satisfied by sibling members). Run the
   dependency pre-scan (below) on each entry before recording it.
4. **Validation gate (pre-publish).** Run the group validator in an independent
   context — it enforces the closure and acyclic invariants (member `requires`
   resolve to a sibling or a declared external `requires`; members exist at the
   pinned version; no duplicate/mutually-conflicting members; the `requires`
   graph is acyclic):

   ```bash
   node scripts/validate-group.mjs <path-to-group.yaml>
   ```

   This is the local pre-publish gate. Report `ready` only when it exits 0;
   otherwise report `draft written` with the violations. Write group.yaml in
   block YAML style (see the caveat in the contract) — never flow maps.

5. **Bundle for upload.** Once the group is `ready`, produce the single archive
   the registry expects (`group.yaml` at the root plus each member laid out
   under `packs/<type>/<name>/`). The group stays reference-style on disk;
   `pack-group.mjs` streams the scattered members into one bundle (it re-runs
   the validator first and refuses to bundle an invalid group):

   ```bash
   node "$POLYRIG_ROOT/scripts/pack-group.mjs" groups/<name>
   # honors --roots (default: builtin packs/) and --out (default: tmp/<name>-<version>.tar.gz)
   ```

   Report the archive path and tell the user to upload it at
   [polyrig.dev](https://polyrig.dev) (browser upload — there is no publish
   CLI). The bundle is transport only and can be deleted after upload; the
   server re-extracts, joint-validates the whole group, and re-normalizes each
   member. Single packs do not need this step — upload their directory directly.

## Scan the registry before introducing a dependency

This applies to **both** a pack's `requires` and a group's `requires`. Before you
record a dependency on another pack id, verify the referenced id actually
resolves, in this fallback order:

1. **Local discovery roots** — check whether the id is present in the index
   (`node scripts/build-pack-index.mjs`; builtin/user/project roots). If found,
   the dependency is verified.
2. **Registry** — if not local and `$POLYRIG_REGISTRY_URL` is set and reachable,
   check whether the registry publishes that pack id. If found, verified.
3. **Neither resolves** — WARN the user with the exact text
   `疑似无效引入，请确认`, record the dependency as **unverified**, but do **NOT**
   block authoring.

This author-side scan is only an **EARLY HINT** to catch typos and dangling
references sooner. It is not the final gate: the authoritative check is the
registry's joint-validate at publish time, which validates every member and
external reference together in one staging area.
