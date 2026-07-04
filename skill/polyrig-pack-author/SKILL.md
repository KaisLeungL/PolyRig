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

Write the pack as a draft first. Run:

```bash
node scripts/validate-pack.mjs <pack-dir>
```

Then route two independent reviews using the fixed prompts. Prefer two
subagents or fresh independent sessions. If independent review is unavailable,
state that limitation, keep the result as `draft written`, and do not report
`ready`.

1. Protocol / structure reviewer: pack protocol, directory shape, Evidence
   Matrix, references, validation readiness.
2. Content / safety reviewer: stale facts, unsupported claims, safety/privacy
   red lines, misleading guidance.

Report `ready` only when validation passes and both reviews have no blocking
issues. Otherwise report `draft written`, list blocking issues, and keep the
draft in place.
