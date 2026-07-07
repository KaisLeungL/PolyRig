# PolyRig

**A universal protocol for aggregating, packaging, and injecting domain and
tech-stack experience.**

PolyRig captures hard-won stack and domain experience into reusable **packs**, then
**injects** the selected packs' knowledge into any-tech-stack project so an agent
works from it. It does **not** generate business code — no login modules, no network
layers, no UI templates — and it does **not** produce project specs, feature state
machines, or init scripts. What it injects is versionable, reviewable, and
**agent-neutral**: pack knowledge copied into `.polyrig/vault/`, a dated dependency
snapshot, an audit manifest, and pure **routing pointers** in AGENTS.md / CLAUDE.md.
It works both for **cold-starting a new project** and for **incrementally injecting
into an existing one** — both paths produce the same experience artifacts.

English | [简体中文](README.zh-CN.md)

## The problem: cold-start context loss

Engineers already using AI coding tools hit the same wall over and over:

- Every **new project** cold-starts with the AI knowing nothing about the stack,
  the domain, or the constraints.
- Every **new session** loses the engineering decisions made in the last one.
- Domain knowledge ends up living in **chat history** instead of the repository.

PolyRig fixes this by injecting the experience on disk, inside the repository, in
formats any agent can read on any machine.

## The core pitch: injected experience an agent actually applies

The acceptance test is a single end-to-end narrative:

1. Use `/polyrig` on a real small project: **Android + FastAPI + Google Sign-In**.
   A conversational injection flow picks stack packs and domain packs, resolves
   their dependencies, verifies versions online, then **injects** the selected
   packs' knowledge into `.polyrig/vault/` and writes routing pointers into
   AGENTS.md / CLAUDE.md.
2. Open a **fresh session with zero verbal context** — no chat history, no
   instructions beyond "look at the repo".
3. The AI, relying only on the on-disk experience (`AGENTS.md` routing pointers →
   pack knowledge under `.polyrig/vault/`, `.polyrig/deps.resolved.md`), does the
   work **correctly applying that experience**: it doesn't guess security logic,
   it holds the red lines the packs warn about, and it follows the injected
   decision trees.

If a zero-context session applies the injected experience correctly — not
re-deriving pitfalls the packs already document, not crossing a red line — the
injection worked. That is the whole point.

## Three-layer architecture

The layers must never blur into one "big prompt repository":

| Layer | Binding | Contents |
|---|---|---|
| 1. Execution (runtime) | Agent-platform adapter | `skill/polyrig/` — project initialization; `skill/polyrig-pack-author/` — pack creation and maintenance; `skill/polyrig-pack-install/` — install/update packs from a registry |
| 2. Protocol & assets | Agent-neutral | `packs/{stack,domain}/` + `schemas/` (JSON Schemas for pack and manifest) |
| 3. Injected artifacts | Agent-neutral, live in the target project | `.polyrig/vault/stacks/`, `.polyrig/vault/domains/` (copied pack knowledge), `.polyrig/deps.resolved.md`, `.polyrig/manifest.json`, plus routing-pointer managed blocks in AGENTS.md / CLAUDE.md |

The v1 execution entries are the PolyRig skills: `/polyrig` injects pack
experience into target projects, `polyrig-pack-author` creates and updates packs,
and `polyrig-pack-install` installs packs shared through a PolyRig registry. All
are installable into Claude Code, Codex, Cursor, Gemini CLI, and OpenCode. The
long-term value binds to the **Pack Protocol and the injected repository
experience**, not to any one agent runtime.

## Pack protocol overview

A pack is **data by default**, and MAY opt-in to carry skills (`skills/`, injected
as project-level symlinks) and example scripts (`scripts/`, copied as data, never
executed). Two types share one protocol:

- **stack packs** — framework conventions, project structure, build/verify commands,
  version pitfalls (e.g. `stack/android`, `stack/backend-fastapi`).
- **domain packs** — business domain knowledge (e.g. `domain/auth-core`,
  `domain/auth-google`), optionally with per-stack implementation notes.

Key rules:

- Pack prose holds **slow-changing knowledge only** (decision trees, pitfalls,
  security red lines). Volatile facts (versions, API details) live in `deps.yaml`
  as coordinates + lookup strategy, verified online at injection time and written to
  the target project's dated `.polyrig/deps.resolved.md`.
- Every pack carries `references/sources.md` with an Evidence Matrix. Strong
  rules, red lines, recommended defaults, and dependency lookup entries must
  cite stable `[Evidence: E001]` ids so future agents can audit where guidance
  came from.
- Discovery roots — builtin `packs/`, user `~/.polyrig/packs/` (plus legacy
  `~/.claude/polyrig-packs/`), and project `.polyrig/packs/` — with
  most-specific-wins override precedence and an explicit trust model
  (project-level pack scripts never run by default).
- Selected pack knowledge is **physically copied** into the target project's
  `.polyrig/vault/` so it travels with the repo and enters git.

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

## Pack groups: bundling related packs

Some packs only make sense together — a shared base like `domain/auth-core` plus
the providers that build on it (`domain/auth-google`, `domain/auth-github`).
Sharing them one at a time loses the association and forces a publish order
(a provider can't be published before the core it requires). A **group** fixes
both.

A group is a **versioned, reference-style manifest** — `groups/<name>/group.yaml`
under the `group/<name>` namespace — that lists member packs by **exact pinned
version**. The packs stay atomic and independent on disk (a member like
`auth-core` is still single-installable and can be depended on from elsewhere);
the group is just a curated bundle that points at them:

```yaml
# groups/auth/group.yaml
id: group/auth
version: 0.1.0
last_reviewed: 2026-07-06
summary: OAuth/OIDC sign-in suite — shared auth-core plus Google and GitHub providers
members:
  - id: domain/auth-core
    version: 0.1.0
  - id: domain/auth-google
    version: 0.1.0
  - id: domain/auth-github
    version: 0.1.0
requires: []            # exact-pinned refs to packs OUTSIDE the group, if any
```

A group is **dependency-closed for its members** (every member's `requires`
resolves to a sibling member or a declared external `requires`), and its
`requires` graph must be acyclic — `validate-group.mjs` enforces these plus
version-match and no-duplicate rules. `/polyrig` presents compatible groups as
"suite" options in the interview, and selecting one pulls every member in
dependency order.

**Bundle for upload.** The group stays reference-style on disk, so publishing it
needs one archive that gathers `group.yaml` plus each member. The `polyrig`
CLI does this without copying files — it streams the scattered members into one
`.tar.gz` (validating the group first):

```sh
polyrig pack-group groups/auth
# -> tmp/auth-0.1.0.tar.gz   (transport only; delete after upload)
```

Then upload that archive at [polyrig.dev](https://polyrig.dev). The server
re-extracts it, **jointly validates the whole group** (intra-group `requires`
resolve within the batch, so there's no publish-order problem), and publishes
every member atomically. The `polyrig-pack-author` skill walks you through
creating a `group.yaml` and bundling it, so you rarely run the command by hand.

**Installing a group** is the mirror image: a group has its own canonical URL
(`/groups/<name>/versions/<version>`). Pasting it installs the whole suite in
dependency order; pasting a member pack URL soft-guides toward the group while
still allowing a single-pack install (which pulls that pack's `requires` closure
but not its group siblings).

## What's new in v0.2

v0.1 proved the core loop — a zero-context session correctly applying the
experience injected from packs. v0.2 turns that into something installable and
shareable:

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
- **Pack groups.** Bundle related packs into a versioned `group/<name>` and
  ship them as one install-and-publish unit; the auth trio is now `group/auth`.
  (See [Pack groups](#pack-groups-bundling-related-packs).)

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

The three auth packs are also bundled as the built-in **`group/auth`** suite
(`groups/auth/group.yaml`) — install the whole sign-in stack in one step, or a
single member on its own. See [Pack groups](#pack-groups-bundling-related-packs).

The golden path (Android + FastAPI + Google Sign-In) remains the end-to-end
acceptance demo: it proves the injected vault experience is consumed correctly by
a zero-context agent that holds the red lines. Secondary gates:
`scripts/validate-pack.mjs` passes on all builtin packs, and the injected
`.polyrig/manifest.json` validates against `schemas/` (checked by
`scripts/validate-artifacts.mjs`).

## Non-goals

- Generating business code skeletons.
- Competing with create-next-app / Nx / projen style scaffolders.
- A real TUI — interaction is a conversational interview.
- A publish CLI — uploading and submitting packs for review happens in the
  browser on [polyrig.dev](https://polyrig.dev); only install/update are
  local commands.

## License

[MIT](LICENSE) © 2026 kaisleung
