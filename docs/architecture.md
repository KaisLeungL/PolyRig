# PolyRig Architecture

PolyRig is built as **three separated layers**. The separation is not cosmetic —
it is the load-bearing design decision, and this document explains each layer,
how packs are discovered and trusted, and why the layers must never blur.

## The three layers

### Layer 1 — Execution (runtime): Claude-specific

Location: `skill/claude-code/polyrig/`

The only Claude Code–specific component in the system. It contains:

- `SKILL.md` — the `/polyrig` entry point: the seven-phase interview flow,
  context routing, decision trees, and artifact formats. **Only** flow, routing,
  decision trees, and formats — never knowledge prose.
- `templates/` — the artifact templates (SPEC.md, AGENTS.md, CLAUDE.md,
  feature_list.json, manifest.json, init.plan.md, init.sh, deps.resolved.md)
  the skill fills in during generation.

This layer is a thin adapter. When other runtimes (Codex, Cursor, Gemini CLI,
OpenCode) get their own adapters, they will sit as siblings under `skill/` and
consume exactly the same layers 2 and 3.

### Layer 2 — Protocol & assets: agent-neutral

Location: `packs/{stack,domain}/` and `schemas/`

- **Packs** are pure data directories: slow-changing knowledge (decision trees,
  pitfalls, security red lines, verification reasoning), dependency lookup
  strategies (`deps.yaml`), and verification checklists (`verify.md`). A pack is
  never a skill and occupies no skill-trigger budget.
- **Schemas** (`pack.schema.json`, `feature_list.schema.json`,
  `manifest.schema.json`) are the protocol itself, expressed as JSON Schema.
  Anything that claims to be a pack, a feature list, or a manifest must validate
  against them.

This is where PolyRig's long-term value binds. The protocol has no dependency on
any particular AI runtime.

### Layer 3 — Generated artifacts: agent-neutral, live in the target project

Produced by the interview into the **target** repository:

- `SPEC.md`, `AGENTS.md`, `CLAUDE.md` (thin pointer to AGENTS.md)
- `feature_list.json` — the persistent feature state machine
- `docs/stacks/<id>/`, `docs/domains/<id>/` — pack knowledge **physically
  copied** in, so it travels with the repo, enters git, and is readable by any
  agent on any machine with no PolyRig installation
- `docs/verify.md`, `deps.resolved.md`
- `.polyrig/manifest.json` — the audit chain
- `init.plan.md`, `init.sh`

Once generated, the target project is self-sufficient: a fresh session with zero
verbal context can implement features from the on-disk artifacts alone.

## Discovery roots and trust model

Packs are discovered from three roots; on id collision the most specific wins:

1. **builtin** — `packs/` in this repository
2. **user** — `~/.claude/polyrig-packs/`
3. **project** — `.polyrig/packs/` in the target project

Override precedence: **project > user > builtin**.

Trust rules (v1):

| Source | Read/copy | Run scripts |
|---|---|---|
| builtin | yes | safe scripts allowed |
| user | yes | only after explicit confirmation |
| project | yes | **never by default** |
| remote | unsupported in v1 | — |

The asymmetry is deliberate: a project-level pack may arrive with a cloned
repository from an untrusted source, so its knowledge may be read and copied
(it is reviewable text), but its scripts are never executed by default. When an
override is detected, assembly MUST announce it explicitly: the source path,
whether the pack carries scripts, and the required review action.

## Why the layers must not blur

The failure mode this architecture guards against is the **"big prompt
repository"** — one undifferentiated pile of instructions, knowledge, and
state that only one AI tool can consume. Concretely:

- **If knowledge prose leaks into SKILL.md** (layer 2 into layer 1), the
  knowledge becomes Claude-specific, invisible to other runtimes, unversioned as
  a pack, and subject to skill-size budgets. The thin-skill rule exists to stop
  this: SKILL.md carries flow, routing, decision trees, and formats — nothing
  else.
- **If runtime mechanics leak into packs** (layer 1 into layer 2), packs stop
  being agent-neutral data and the protocol loses portability.
- **If generated artifacts reference back into the PolyRig installation**
  (layer 3 depending on layers 1–2 at read time), target repositories stop being
  self-sufficient. Physical copying of pack knowledge — instead of linking — is
  what keeps a generated repo readable on a machine that has never heard of
  PolyRig.
- **If volatile facts get baked into pack prose**, packs rot silently. That is
  why versions and API details live in `deps.yaml` as lookup strategies, and
  online-verified results land in the target project's dated `deps.resolved.md`,
  never back in the pack.

Each layer has exactly one binding (Claude / protocol / target repo) and one
change cadence. Keeping those bindings separate is what makes the system
survive runtime churn.
