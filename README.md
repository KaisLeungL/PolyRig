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

The layers must never blur into one "big prompt repository"
(see [docs/architecture.md](docs/architecture.md)):

| Layer | Binding | Contents |
|---|---|---|
| 1. Execution (runtime) | Agent-platform adapter | `skill/polyrig/` — SKILL.md (flow, routing, decision tree, artifact formats only; no knowledge prose) + templates |
| 2. Protocol & assets | Agent-neutral | `packs/{stack,domain}/` + `schemas/` (JSON Schemas for pack, feature_list, manifest) |
| 3. Generated artifacts | Agent-neutral, live in the target project | SPEC.md, AGENTS.md, CLAUDE.md, feature_list.json, docs/stacks/, docs/domains/, docs/verify.md, deps.resolved.md, .polyrig/manifest.json, init.plan.md, init.sh |

The v1 execution entry is the PolyRig skill (`/polyrig`), installable into
Claude Code, Codex, Cursor, Gemini CLI, and OpenCode. The long-term value binds
to the **Pack Protocol and the generated repository context**, not to any one
agent runtime.

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
- Discovery roots — builtin `packs/`, user `~/.polyrig/packs/` (plus legacy
  `~/.claude/polyrig-packs/`), and project `.polyrig/packs/` — with
  most-specific-wins override precedence and an explicit trust model
  (project-level pack scripts never run by default).
- Selected pack knowledge is **physically copied** into the target project so it
  travels with the repo and enters git.

Full protocol with worked examples: [docs/pack-protocol.md](docs/pack-protocol.md).

## Install

```sh
node scripts/link-skill.mjs
```

Plain git repo, zero-dependency Node scripts, no workspace toolchain, no build step.
By default this installs `skill/polyrig/` for all supported local agent
platforms: Claude Code and Codex get native skill links; Cursor, Gemini CLI, and
OpenCode get managed pointer/context files. To install one target only, use
`--platform claude-code|codex|cursor|gemini-cli|opencode`.

## v0.1 scope — golden path

Depth over breadth: four built-in packs, one end-to-end demo.

- `stack/android`
- `stack/backend-fastapi`
- `domain/auth-core` — shared OAuth/OIDC architecture, token/session handling,
  CSRF/nonce/state, secure storage principles
- `domain/auth-google` — requires auth-core; per-stack notes for android +
  backend-fastapi

Secondary gates: `scripts/validate-pack.mjs` passes on all builtin packs, and
generated artifacts validate against `schemas/`.

## Roadmap

| Version | Scope |
|---|---|
| v0.2 | `stack/web-nextjs`, auth-google web notes |
| v0.3 | `stack/ios`, `domain/auth-apple` |
| v0.4 | `domain/auth-wechat` (CN-ecosystem specifics) |
| later | pack authoring wizard, `polyrig-update` upgrade command, remote packs |

## Non-goals

- Generating business code skeletons.
- Competing with create-next-app / Nx / projen style scaffolders.
- A real TUI — interaction is a conversational interview.
- Remote pack distribution and pack upgrade tooling (deferred; the manifest already
  records everything an upgrade command will need).

## License

[MIT](LICENSE) © 2026 kaisleung
