# PolyRig

**A universal AI harness pack protocol and context assembly system.**

PolyRig initializes any-tech-stack projects into **agent-ready repositories**. It does
**not** generate business code — no login modules, no network layers, no UI templates.
It generates the context layer that AI coding needs: structured requirements, technical
decisions with rationale, context routing, dependency lookup strategy, verification
routes, and a persistent feature state machine — all versionable, reviewable, and
**agent-neutral**.

English | [简体中文](README.zh-CN.md)

## The problem: cold-start context loss

Engineers already using AI coding tools hit the same wall over and over:

- Every **new project** cold-starts with the AI knowing nothing about the stack,
  the domain, or the constraints.
- Every **new session** loses the engineering decisions made in the last one.
- Domain knowledge ends up living in **chat history** instead of the repository.

PolyRig fixes this by putting the context on disk, inside the repository, in formats
any agent can read on any machine.

## The core pitch: a real cold-start demo

The v0.1 acceptance test is a single end-to-end narrative:

1. Use `/polyrig` to initialize a real small project: **Android + FastAPI +
   Google Sign-In**. A conversational seven-phase interview picks stack packs and
   domain packs, records constraints, defines the first feature and its verification
   route, then generates all context artifacts.
2. Open a **fresh session with zero verbal context** — no chat history, no
   instructions beyond "look at the repo".
3. The AI, relying only on the on-disk artifacts (`SPEC.md`, `AGENTS.md`,
   `feature_list.json`, copied pack knowledge under `docs/`), implements the first
   feature through to **passing verification**, updating the feature state machine
   as it goes (`planned → in_progress → implemented → verified`).

If a zero-context session can carry a feature to verified, the repository is
agent-ready. That is the whole point.

## Three-layer architecture

The layers must never blur into one "big prompt repository":

| Layer | Binding | Contents |
|---|---|---|
| 1. Execution (runtime) | Agent-platform adapter | `skill/polyrig/` — project initialization; `skill/polyrig-pack-author/` — pack creation and maintenance; `skill/polyrig-pack-install/` — install/update packs from a registry |
| 2. Protocol & assets | Agent-neutral | `packs/{stack,domain}/` + `schemas/` (JSON Schemas for pack, feature_list, manifest) |
| 3. Generated artifacts | Agent-neutral, live in the target project | SPEC.md, AGENTS.md, CLAUDE.md, feature_list.json, docs/stacks/, docs/domains/, docs/verify.md, deps.resolved.md, .polyrig/manifest.json, init.plan.md, init.sh |

The v1 execution entries are the PolyRig skills: `/polyrig` initializes target
projects, `polyrig-pack-author` creates and updates packs, and
`polyrig-pack-install` installs packs shared through a PolyRig registry. All
are installable into Claude Code, Codex, Cursor, Gemini CLI, and OpenCode. The
long-term value binds to the **Pack Protocol and the generated repository
context**, not to any one agent runtime.

## Pack protocol overview

A pack is a **pure data directory** — never a skill, occupying no skill-trigger
budget. Two types share one protocol:

- **stack packs** — framework conventions, project structure, build/verify commands,
  version pitfalls (e.g. `stack/android`, `stack/backend-fastapi`).
- **domain packs** — business domain knowledge (e.g. `domain/auth-core`,
  `domain/auth-google`), optionally with per-stack implementation notes.

Key rules:

- Pack prose holds **slow-changing knowledge only** (decision trees, pitfalls,
  security red lines). Volatile facts (versions, API details) live in `deps.yaml`
  as coordinates + lookup strategy, verified online at assembly time and written to
  the target project's dated `deps.resolved.md`.
- Every pack carries `references/sources.md` with an Evidence Matrix. Strong
  rules, red lines, recommended defaults, and dependency lookup entries must
  cite stable `[Evidence: E001]` ids so future agents can audit where guidance
  came from.
- Discovery roots — builtin `packs/`, user `~/.polyrig/packs/` (plus legacy
  `~/.claude/polyrig-packs/`), and project `.polyrig/packs/` — with
  most-specific-wins override precedence and an explicit trust model
  (project-level pack scripts never run by default).
- Selected pack knowledge is **physically copied** into the target project so it
  travels with the repo and enters git.

## Authoring packs: `polyrig-pack-author`

`/polyrig` only **consumes** packs. `polyrig-pack-author` is the sibling skill
that **creates and updates** them — the workflow for teaching PolyRig a new
stack or business domain, instead of hand-writing `pack.yaml` and Markdown
against the schema.

Trigger it with `/polyrig-pack-author`, or just ask for it directly. Example
prompts:

- `/polyrig-pack-author create a stack pack for Next.js` — new stack pack,
  defaults to `~/.polyrig/packs/stack/nextjs/`.
- `/polyrig-pack-author create a domain pack for Stripe billing, compatible
  with backend-fastapi` — new domain pack with `stacks: [backend-fastapi]` and
  a `knowledge/per-stack/backend-fastapi.md`.
- `/polyrig-pack-author update packs/stack/android — bump last_reviewed and
  add a pitfall about predictive back` — update an existing pack in place.

It runs six phases (pack identity → use cases → boundaries → source plan →
knowledge extraction → review gate): slow-changing decisions go to
`knowledge/*.md`, volatile facts (versions, API surfaces) go to `deps.yaml` as
lookup strategies, and every strong rule or dependency lookup must cite a
stable `[Evidence: E001]`-style id in `references/sources.md`. Before
reporting a pack `ready`, it runs `scripts/validate-pack.mjs` in an
independent context plus two fixed reviewer passes (protocol/structure,
content/safety) — never a self-review in the authoring context.

## Install

One command, no clone needed:

```sh
npx polyrig install
```

`npx` downloads the published package (which bundles the packs, scripts, and
schemas the skills need at runtime) and runs the installer. The installer
**stages the runtime** into `~/.polyrig/runtime` — a stable directory that
survives npx cache eviction — then symlinks the `/polyrig`,
`/polyrig-pack-author`, and `/polyrig-pack-install` skills for your local agent
platforms, pointing `POLYRIG_ROOT` at that runtime. Re-run the same command any
time to upgrade.

Prefer a local clone if you plan to track updates with `git pull` or want
symlinks that follow a single checkout — in a git checkout the installer skips
staging and symlinks the skills straight to the repo, so edits take effect live:

```sh
git clone https://github.com/KaisLeungL/PolyRig.git && cd PolyRig
node scripts/link-skill.mjs
```

Either way it's zero-dependency Node scripts, no workspace toolchain, no build
step. By default this installs the three skills for all supported local agent
platforms: Claude Code and Codex get native skill links (or copies, with
`--copy`); Cursor, Gemini CLI, and OpenCode get managed pointer/context files.
To install one target only, add
`--platform claude-code|codex|cursor|gemini-cli|opencode` to either command.

## Registry: sharing packs

Packs are shared through the PolyRig registry at
**[polyrig.dev](https://polyrig.dev)**. It closes the loop the skills open:
`polyrig-pack-author` **creates** a pack, the registry **publishes** it, and
`polyrig-pack-install` **installs** it for `/polyrig` to consume. The registry
is a separate application (FastAPI + Next.js) that only serves metadata and
artifacts — the install/update client ships with PolyRig itself, and it never
trusts anything it can't re-verify.

**Publish** (in the browser, no CLI): sign in with GitHub → confirm your locked
`publisher_slug` → upload the pack root (`pack.yaml`, `knowledge/`,
`references/`, `verify.md`) at `/dashboard/upload` → the server re-validates
with the **pinned** validator and re-packs a canonical, sha256-frozen
`.tar.gz` → submit the draft for review → a reviewer approves publish
eligibility → you get an immutable canonical version URL to share:

```text
https://polyrig.dev/packs/<type>/<name>/versions/<version>
```

**Install** (paste that URL, let the skill drive):

```sh
export POLYRIG_REGISTRY_URL=https://polyrig.dev
node "$POLYRIG_ROOT/scripts/install-pack.mjs" install \
  https://polyrig.dev/packs/domain/stripe-billing/versions/0.1.0 --yes
```

The installer verifies sha256, unpacks safely, re-runs `validate-pack` locally,
installs to `~/.polyrig/packs/<type>/<name>/`, and pulls publish-time-frozen
dependencies. `update <type>/<name>` or `update --all` upgrade explicitly —
there is no background auto-update. Published versions are immutable;
`deprecated` warns on download and `removed` blocks new downloads.

## What's new in v0.2

v0.1 proved the core loop — a zero-context session carrying a feature to
verified. v0.2 turns that into something installable and shareable:

- **One-command install.** Published to npm; `npx polyrig install` stages the
  runtime and links the skills — no clone, no build step. (See [Install](#install).)
- **Pack authoring.** The `polyrig-pack-author` skill creates and maintains
  packs against the schema, with Evidence Matrix enforcement and a two-pass
  review gate. (See [Authoring packs](#authoring-packs-polyrig-pack-author).)
- **Registry loop.** `polyrig-pack-install` plus [polyrig.dev](https://polyrig.dev)
  close the share loop: publish in the browser, install from a canonical URL,
  update explicitly. (See [Registry](#registry-sharing-packs).)
- **Two new built-in packs.** `stack/nextjs` (App Router frontend conventions)
  and `domain/auth-github` (GitHub sign-in) — bringing the built-in set to seven.

## Built-in packs

Depth over breadth: focused built-in packs, one end-to-end demo.

- `stack/android`
- `stack/ios`
- `stack/backend-fastapi`
- `stack/nextjs` — App Router frontend: server/client boundaries, data
  fetching/caching, session consumption, mutations via server actions/route
  handlers *(new in v0.2)*
- `domain/auth-core` — shared OAuth/OIDC architecture, token/session handling,
  CSRF/nonce/state, secure storage principles
- `domain/auth-google` — requires auth-core; per-stack notes for android +
  backend-fastapi
- `domain/auth-github` — requires auth-core; GitHub OAuth authorization-code
  flow; per-stack notes for backend-fastapi + nextjs *(new in v0.2)*

The v0.1 golden path (Android + FastAPI + Google Sign-In) remains the
end-to-end acceptance demo. Secondary gates: `scripts/validate-pack.mjs` passes
on all builtin packs, and generated artifacts validate against `schemas/`
(checked by `scripts/validate-artifacts.mjs`).

## Non-goals

- Generating business code skeletons.
- Competing with create-next-app / Nx / projen style scaffolders.
- A real TUI — interaction is a conversational interview.
- A publish CLI — uploading and submitting packs for review happens in the
  browser on [polyrig.dev](https://polyrig.dev); only install/update are
  local commands.

## License

[MIT](LICENSE) © 2026 kaisleung
