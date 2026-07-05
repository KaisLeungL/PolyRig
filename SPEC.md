# PolyRig — Specification (v0.1)

> Status: locked 2026-07-04 after design grill session.
> Implementation plan lives in `feature_list.json` (plan-as-state; no separate PLAN.md).

## 1. Positioning

PolyRig is a **universal AI harness pack protocol and context assembly system** that
initializes any-tech-stack projects into **agent-ready repositories**.

It does **not** generate business code scaffolding. It generates the context layer
that AI coding needs: structured requirements, technical decisions with rationale,
context routing, dependency lookup strategy, validation routes, and a persistent
feature state machine — all versionable, reviewable, and **agent-neutral**.

- **v1 execution entries**: `polyrig` for project initialization and
  `polyrig-pack-author` for pack creation/update, both installable into
  supported local agent platforms.
- **Long-term value binding**: the Pack Protocol + generated repository context,
  NOT any one agent runtime.

### Non-goals

- Generating business code skeletons (login modules, network layers, UI templates).
- Competing with create-next-app / Nx / projen style scaffolders.
- A real TUI. Interaction is conversational interview (one question at a time,
  recommended answers, defaults supported).
- Remote pack distribution (deferred; the manifest reserves structure for it).
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
| 1. Execution (runtime) | Agent-platform adapter | `skill/polyrig/` — project initialization; `skill/polyrig-pack-author/` — pack creation and maintenance |
| 2. Protocol & assets | Agent-neutral | `packs/{stack,domain}/` + `schemas/` (JSON Schemas for pack, feature_list, manifest) |
| 3. Generated artifacts | Agent-neutral, live in the target project | SPEC.md, AGENTS.md, CLAUDE.md, feature_list.json, docs/stacks/, docs/domains/, docs/verify.md, deps.resolved.md, .polyrig/manifest.json, init.plan.md, init.sh |

### Repository layout (this repo)

```
polyrig/
  README.md                 # English
  README.zh-CN.md           # Chinese
  LICENSE
  SPEC.md                   # this file
  package.json              # published to npm as `polyrig`; `files` bundles the runtime, `bin` runs link-skill.mjs
  feature_list.json         # implementation plan & state for PolyRig itself

  skill/
    polyrig/
      SKILL.md
      agents/
        openai.yaml
      templates/
        SPEC.md
        AGENTS.md
        CLAUDE.md
        feature_list.json
        manifest.json
        init.plan.md
        init.sh
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

  packs/
    stack/
      android/
      backend-fastapi/
      ios/
    domain/
      auth-core/
      auth-google/

  schemas/
    pack.schema.json
    feature_list.schema.json
    manifest.schema.json

  scripts/                  # zero-dependency Node (.mjs); no workspace toolchain
    link-skill.mjs          # install PolyRig skills into supported agent platforms
    validate-pack.mjs       # validate a pack dir against pack.schema.json
    validate-artifacts.mjs  # validate a target project's generated JSON artifacts
    build-pack-index.mjs    # scan pack roots, emit discovery index
    doctor.mjs              # env & install sanity check

  docs/
    architecture.md
    pack-protocol.md
    authoring-packs.md
    examples/
```

Plain git repo, directory-per-concern. No npm workspaces, no build step.
Published to the npm registry as `polyrig`; its `files` allowlist bundles the
runtime resources (`scripts/`, `packs/`, `schemas/`, `skill/`, `docs/`,
`SPEC.md`) so the installed skills are self-sufficient. Install =
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
- During assembly the AI verifies current versions/breaking changes online and
  writes results into the target project's **`deps.resolved.md`** with resolved-at
  date, source, confidence, and re-check action. Verified results are never
  written back into pack prose as eternal facts.
- `last_reviewed` older than threshold (default 180 days) triggers a staleness
  warning during assembly.

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

When an override is detected, assembly MUST announce it explicitly:
source path, whether it carries scripts, and required review action.

## 4. The `/polyrig` interview (execution flow)

Conversational, fixed **seven phases**, 1–3 questions per phase, every question
carries a recommended answer and supports defaults. Interaction language follows
the user (zh-CN for this author); generated artifacts are English. The language
switch point is stated in SKILL.md.

1. **Project identity** — name, one-line purpose, repo layout (monorepo or not is
   the user's choice, never imposed).
2. **Target stack** — select stack pack(s).
3. **Domain packs** — select compatible domain packs (filtered by chosen stacks);
   resolve `requires`/`conflicts`.
4. **Constraints** — security red lines, offline/online policy, platform rules.
5. **First feature** — the concrete first feature with acceptance criteria.
6. **Verification route** — commands and manual checks per feature.
7. **Generate** — online version verification, then write all artifacts; announce
   every file written and every pack override encountered.

## 5. Generated artifacts (in the target project)

| File | Role |
|---|---|
| `SPEC.md` | requirements, stack decisions + rationale, architecture constraints, domain boundaries |
| `AGENTS.md` | **primary agent instruction file**: routing index to all context + hard rules (update feature state after every attempt; never mark `verified` without passing verification) |
| `CLAUDE.md` | thin Claude Code entry that points to AGENTS.md; no duplicated content |
| `feature_list.json` | plan-as-state; schema below |
| `docs/stacks/<id>/`, `docs/domains/<id>/` | pack knowledge and `sources.md` **physically copied** in (knowledge and evidence travel with the repo, enter git, readable by any agent on any machine) |
| `docs/verify.md` | merged verification routes |
| `deps.resolved.md` | dated, sourced, confidence-rated online verification results |
| `.polyrig/manifest.json` | audit chain: polyrig_version, generated_at, language, selected_packs (id, version, source, last_reviewed, copied_to, checksum), overrides |
| `init.plan.md` | human-reviewable initialization plan (anything non-trivial goes here) |
| `init.sh` | minimal safe script: `set -euo pipefail`; creates context dirs/files, runs a guarded `git init` when the target is not already inside a repository, and seeds a minimal `.gitignore` (`.env`) if absent; never bulk-installs deps, never edits build files, never writes business code, never fetches remote scripts, never commits (the first commit is a manual follow-up in init.plan.md); header says "Review init.plan.md before running" |

### feature_list.json state machine

States: `planned → in_progress → (blocked) → implemented → verified`, plus
`rejected`. Each feature:

```json
{
  "id": "F001",
  "title": "Implement Google Sign-In",
  "status": "planned",
  "priority": "p0",
  "depends_on": [],
  "pack_refs": ["domain/auth-google", "stack/android"],
  "acceptance_criteria": ["..."],
  "verification": { "manual": ["..."], "automated": ["./gradlew test"] },
  "files_expected": [],
  "notes": ""
}
```

AGENTS.md hard rules: the agent must update `feature_list.json` after each
implementation attempt, and must not set `verified` unless verification commands
passed or manual verification is explicitly documented.

## 6. v0.1 scope — golden path

Built-in packs (5, depth over breadth):

- `stack/android`
- `stack/ios`
- `stack/backend-fastapi`
- `domain/auth-core` (shared OAuth/OIDC architecture, token/session handling, CSRF/nonce/state, secure storage principles)
- `domain/auth-google` (requires auth-core; per-stack notes for android + backend-fastapi)

Deferred by roadmap:

- v0.2 — `stack/web-nextjs`, auth-google web notes
- v0.3 — `domain/auth-apple`
- v0.4 — `domain/auth-wechat` (CN-ecosystem specifics)
- later — `polyrig-update` upgrade command, remote packs

## 7. v0.1 acceptance

One real cold-start, full chain:

1. Use `/polyrig` to initialize a real small project: **Android + FastAPI +
   Google Sign-In**.
2. Open a **fresh session with zero verbal context**.
3. The AI, relying only on the on-disk artifacts, implements the first feature
   through to **passing verification**.

Secondary gates: `validate-pack.mjs` passes on all builtin packs;
generated artifacts validate against `schemas/` (checked by
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
| Real TUI initialization | conversational seven-phase interview |
