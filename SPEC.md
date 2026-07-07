# PolyRig — Specification (v0.2)

> Status: core spec locked 2026-07-04 after design grill session; v0.2 shipped
> npm install, pack authoring, and the registry loop (see §6 roadmap). Artifact
> relocation + repositioning to experience injection locked 2026-07-07 (Decision A;
> see §8).

## 1. Positioning

PolyRig is a **universal protocol for aggregating, packaging, and injecting domain
and tech-stack experience**. It captures hard-won stack and domain knowledge into
reusable **packs**, then **injects** the selected packs' knowledge into a target
project so any agent works from it.

It does **not** generate business code scaffolding, and it does **not** produce
project specs, feature state machines, or init scripts. What it injects is
versionable, reviewable, and **agent-neutral**: pack knowledge physically copied
into `.polyrig/vault/`, a dated dependency snapshot (`.polyrig/deps.resolved.md`),
an audit manifest (`.polyrig/manifest.json`), and pure **routing pointers** in
AGENTS.md / CLAUDE.md. Cold-starting a new project and incrementally injecting into
an existing one produce the **same** set of experience artifacts.

- **v1 execution entries**: `polyrig` for experience injection and
  `polyrig-pack-author` for pack creation/update, both installable into
  supported local agent platforms.
- **Long-term value binding**: the Pack Protocol + injected repository experience,
  NOT any one agent runtime.

### Non-goals

- Generating business code skeletons (login modules, network layers, UI templates).
- Producing project management / scaffolding artifacts: no `SPEC.md`,
  `feature_list.json`, `init.plan.md`, or `init.sh` in the target project.
- Inlining pack experience (red lines, strong rules, decision trees) into
  AGENTS.md / CLAUDE.md — those stay in the vault; the managed block only routes.
- Competing with create-next-app / Nx / projen style scaffolders.
- A real TUI. Interaction is conversational interview (one question at a time,
  recommended answers, defaults supported).
- Pack upgrade tooling (deferred; `.polyrig/manifest.json` records everything an
  upgrade command will need).

### Target user

Engineers already using AI coding tools. Pain point: every new project cold-starts
with the AI knowing nothing; every new session loses engineering decisions; domain
knowledge lives in chat history instead of the repository.

## 2. Architecture: three separated layers

The layers must never blur into one "big prompt repository":

| Layer | Binding | Contents |
|---|---|---|
| 1. Execution (runtime) | Agent-platform adapter | `skill/polyrig/` — experience injection; `skill/polyrig-pack-author/` — pack creation and maintenance |
| 2. Protocol & assets | Agent-neutral | `packs/{stack,domain}/` + `schemas/` (JSON Schemas for pack and manifest) |
| 3. Injected artifacts | Agent-neutral, live in the target project | `.polyrig/vault/stacks/<id>/`, `.polyrig/vault/domains/<id>/` (copied pack knowledge), `.polyrig/deps.resolved.md`, `.polyrig/manifest.json`, plus routing-pointer managed blocks in AGENTS.md / CLAUDE.md |

### Repository layout (this repo)

```
polyrig/
  README.md                 # English
  README.zh-CN.md           # Chinese
  LICENSE
  SPEC.md                   # this file
  package.json              # published to npm as `polyrig`; `files` bundles the runtime, `bin` runs link-skill.mjs

  skill/
    polyrig/
      SKILL.md
      agents/
        openai.yaml
      templates/
        AGENTS.md           # routing-pointer managed block
        CLAUDE.md           # same managed-block pointer content
        manifest.json
        deps.resolved.md
    polyrig-pack-author/
      SKILL.md
      agents/
        openai.yaml
      references/
        pack-authoring-contract.md
        review-prompts.md
      assets/
        pack-template/
    polyrig-pack-install/
      SKILL.md

  packs/
    stack/
      android/
      backend-fastapi/
      ios/
      nextjs/
    domain/
      auth-core/
      auth-google/
      auth-github/

  schemas/
    pack.schema.json
    manifest.schema.json

  scripts/                  # zero-dependency Node (.mjs); no workspace toolchain
    link-skill.mjs          # install PolyRig skills into supported agent platforms
    install-pack.mjs        # download/verify/install packs from a PolyRig registry
    validate-pack.mjs       # validate a pack dir against pack.schema.json
    validate-artifacts.mjs  # validate a target project's injected .polyrig/manifest.json
    build-pack-index.mjs    # scan pack roots, emit discovery index
    doctor.mjs              # env & install sanity check

  docs/                     # internal docs — gitignored, not published to npm
    architecture.md
    pack-protocol.md
    authoring-packs.md
    registry.md
    examples/
    plans/
```

Plain git repo, directory-per-concern. No npm workspaces, no build step.
Published to the npm registry as `polyrig`; its `files` allowlist bundles the
runtime resources (`scripts/`, `packs/`, `schemas/`, `skill/`, `SPEC.md`) so the
installed skills are self-sufficient. `docs/` is neither tracked in git nor
published — the runtime does not read it. Install =
`npx polyrig install` (no clone; stages the runtime into `~/.polyrig/runtime`
and symlinks skills there) or `node scripts/link-skill.mjs` (from a local
clone; symlinks skills straight to the checkout for live editing).

## 3. Pack Protocol

A pack is a **pure data directory** (never a skill; occupies no skill-trigger
budget). Two types, one protocol: `stack` packs (framework conventions, project
structure, build/verify commands, version pitfalls) and `domain` packs (business
domain knowledge). Assembly order: pick stack(s) first, then compatible domains.

```
packs/<type>/<id>/
  pack.yaml            # metadata (see below)
  knowledge/
    overview.md        # slow-changing: architecture decision trees, principles
    pitfalls.md        # known traps, security red lines
    per-stack/         # domain packs only: per-stack implementation notes
      android.md
      backend-fastapi.md
  references/
    sources.md          # Evidence Matrix: source-backed/user-provided/inferred claims
  deps.yaml            # dependency COORDINATES + lookup strategy + official sources
                       # (never pinned "latest" versions in prose)
  verify.md            # self-check list for features built with this pack
  scripts/             # optional deterministic helpers (env check, config gen)
```

### pack.yaml (governed by schemas/pack.schema.json)

```yaml
id: domain/auth-google
type: domain            # stack | domain
version: 0.1.0
last_reviewed: 2026-07-04
summary: Google Sign-In domain knowledge (OAuth/OIDC flows, token handling)
requires: [domain/auth-core]      # pack dependencies (in v1 protocol)
conflicts: []
provides: [google-sign-in]
stacks: [android, backend-fastapi]   # stacks covered in per-stack/
trust:
  level: builtin        # builtin | user | project | remote
  scripts_enabled_by_default: false
  requires_confirmation: true
```

### Knowledge freshness

- Pack prose contains **slow-changing knowledge only** (decision trees, pitfalls,
  security red lines, verification reasoning).
- Every pack carries `references/sources.md` with an Evidence Matrix. Strong
  rules, red lines, recommended defaults, and dependency lookup entries cite
  stable `[Evidence: E001]` ids. Evidence statuses are `source-backed`,
  `user-provided`, `inferred`, or `unverified`; unverified evidence cannot
  support strong rules.
- Volatile facts (SDK versions, API details) live in `deps.yaml` as coordinates +
  `lookup` query strategy + official doc URLs + `version_policy: verify_latest_before_use`
  plus `evidence: [...]`.
- During injection the AI verifies current versions/breaking changes online and
  writes results into the target project's **`.polyrig/deps.resolved.md`** with
  resolved-at date, source, confidence, and re-check action. Verified results are
  never written back into pack prose as eternal facts.
- `last_reviewed` older than threshold (default 180 days) triggers a staleness
  warning during injection.

### Discovery & trust model

Three discovery roots, most specific wins on id collision:

1. builtin `packs/` (this repo)
2. user-level `~/.polyrig/packs/` (legacy `~/.claude/polyrig-packs/` is also scanned)
3. project-level `.polyrig/packs/`

Trust rules (v1):

| Source | Read/copy | Run scripts |
|---|---|---|
| builtin | yes | safe scripts allowed |
| user | yes | only after explicit confirmation |
| project | yes | **never by default** |
| remote | unsupported in v1 | — |

When an override is detected, injection MUST announce it explicitly:
source path, whether it carries scripts, and required review action.

## 4. The `/polyrig` injection flow (execution flow)

Conversational, **four phases**, 1–3 questions per phase, every question carries a
recommended answer and supports defaults. Interaction language follows the user
(zh-CN for this author); injected artifacts are English. The language switch point
is stated in SKILL.md. The flow no longer collects project specs, first features,
or verification routes — those were project-management inputs to the removed
artifacts.

1. **Project identity + injection mode** — name, one-line purpose; probe whether
   the target directory already has code / `AGENTS.md` / `.harness/` to decide
   **cold-start** vs **incremental** injection (both produce the same artifacts;
   the only difference is new-file vs merge-into-existing).
2. **Target stack** — select stack pack(s).
3. **Domain packs / groups** — select compatible domain packs (filtered by chosen
   stacks) and any compatible group suites; resolve `requires`/`conflicts`.
4. **Inject** — online version verification, then copy pack knowledge into
   `.polyrig/vault/`, write `.polyrig/deps.resolved.md` + `.polyrig/manifest.json`,
   and upsert the routing managed block into AGENTS.md / CLAUDE.md; announce every
   file written and every pack override encountered.

## 5. Injected artifacts (in the target project)

| File | Role |
|---|---|
| `.polyrig/vault/stacks/<id>/`, `.polyrig/vault/domains/<id>/` | pack knowledge (`overview.md`, `pitfalls.md`, per-stack notes, `verify.md`) and `sources.md` **physically copied** in — the experience itself, traveling with the repo, entering git, readable by any agent on any machine |
| `AGENTS.md` | **routing-pointer managed block only**: which packs were injected + where their vault knowledge lives + a "MUST read the matching vault dir before doing X-type work" route per pack + deps/manifest routes. **Never** inlines red lines, strong rules, or decision trees — those stay in the vault. Merged incrementally via the `<!-- BEGIN POLYRIG MANAGED BLOCK -->` markers, preserving user content outside the block |
| `CLAUDE.md` | same managed-block pointer content as AGENTS.md (a synonymous entry) |
| `.polyrig/deps.resolved.md` | dated, sourced, confidence-rated online verification results |
| `.polyrig/manifest.json` | audit chain: polyrig_version, generated_at, language, selected_packs (id, version, source, last_reviewed, copied_to → `.polyrig/vault/...`, checksum), selected_groups, overrides |

Removed in Decision A (§8): the target project no longer receives `SPEC.md`,
`feature_list.json`, `docs/verify.md`, `init.plan.md`, or `init.sh`. Experience
that once lived in the generated `SPEC.md` came from packs and now lands in the
vault (single source); verification **knowledge** ships as each pack's `verify.md`
inside its vault dir, which AGENTS.md routes to. No experience is lost — only
relocated.

## 6. v0.1 scope — golden path

Built-in packs (5, depth over breadth):

- `stack/android`
- `stack/ios`
- `stack/backend-fastapi`
- `domain/auth-core` (shared OAuth/OIDC architecture, token/session handling, CSRF/nonce/state, secure storage principles)
- `domain/auth-google` (requires auth-core; per-stack notes for android + backend-fastapi)

Shipped since v0.1:

- v0.2 — `stack/nextjs` (App Router frontend), `domain/auth-github`; npm install
  (`npx polyrig install`), the `polyrig-pack-author` skill, and the registry
  loop (`polyrig-pack-install` + polyrig.dev) — remote packs are live.

Deferred by roadmap:

- v0.3 — `domain/auth-apple`
- v0.4 — `domain/auth-wechat` (CN-ecosystem specifics)
- later — `polyrig-update` in-place upgrade command

## 7. Acceptance

One real cold-start, full chain:

1. Use `/polyrig` on a real small project: **Android + FastAPI + Google Sign-In**;
   pack knowledge is injected into `.polyrig/vault/` with routing pointers in
   AGENTS.md.
2. Open a **fresh session with zero verbal context**.
3. The AI, relying only on the injected experience (AGENTS.md routes → vault
   knowledge, `.polyrig/deps.resolved.md`), does the work **correctly applying that
   experience**: it does not guess security logic, holds the red lines the packs
   warn about, and follows the injected decision trees. The KPI is *experience
   applied correctly* — not carrying a feature to a `verified` state.

Secondary gates: `validate-pack.mjs` passes on all builtin packs; the injected
`.polyrig/manifest.json` validates against `schemas/` (checked by
`validate-artifacts.mjs`).

This demo is the core narrative of the README.

## 8. Superseded decisions (kept to prevent relapse)

| Earlier decision | Replaced by |
|---|---|
| Standalone agent-agnostic CLI | PolyRig skill as v1 runtime adapter |
| "A Claude Code skills project" | Protocol-first positioning; skill is only the entry |
| npm-workspace monorepo for PolyRig itself | plain git repo, directory-per-concern, zero-dep scripts |
| One big `third-party-auth` domain pack | split: auth-core + per-provider packs (pulls `requires` into v1) |
| Coverage-first: 4 stacks + iOS, shallow | golden path: 4 deep packs, one end-to-end demo |
| Real TUI initialization | conversational injection interview |
| Context-assembly system + `feature_list.json` feature state machine (generated `SPEC.md` / `init.plan.md` / `init.sh`; KPI = carry a feature to `verified`) | experience injection into `.polyrig/vault/` + routing-pointer AGENTS.md/CLAUDE.md; those artifacts removed; KPI = injected experience applied correctly (Decision A, 2026-07-07) |
