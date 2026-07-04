# FastAPI backend — architecture decision guidance

Slow-changing decision guidance for building a FastAPI backend. Dependency
versions and churning API surfaces are NOT here; resolve them via `deps.yaml`
lookup strategies before writing code.

## Project layout

Default layout — a single importable app package, layered by responsibility: [Evidence: E001]

```
app/
  main.py          # app factory, router registration, lifespan — nothing else
  core/            # settings, security helpers, cross-cutting concerns
  routers/         # HTTP layer: one module per resource, thin handlers
  services/        # domain logic: orchestration, business rules
  repositories/    # data access: all DB queries live here
  models/          # ORM entities (persistence shapes)
  schemas/         # pydantic request/response models (wire shapes)
tests/
```

Rules that make this layout work:

- **Route handlers stay thin.** A handler parses input (via schema), calls one
  service function, shapes output (via response model). If a handler contains a
  loop, a transaction, or branching business logic, that logic belongs in
  `services/`. Thin handlers keep domain logic testable without HTTP and keep
  the HTTP layer swappable.
- **Domain logic lives in `services/`, queries in `repositories/`.** Services
  never build SQL; repositories never make business decisions. This is the [Evidence: E001, E005]
  seam where tests inject fakes.
- **`models/` and `schemas/` are different things and never merge.** ORM [Evidence: E007]
  entities are persistence shapes; pydantic schemas are API contracts. Sharing
  one class for both couples your public API to your table layout.

Single app vs multi-service decision: default to ONE app package. [Evidence: E001] Split into
multiple services only when you have a concrete forcing reason — independent
deploy cadence, hard isolation requirement, or divergent scaling profiles.
Multiple routers inside one app already give module boundaries; a premature
service split multiplies deployment, auth, and observability work with no
domain payoff.

## Dependency and environment management

- Use a **project-local virtual environment** managed by a lock-file-capable
  tool (the uv workflow is the convention; plain venv + pip is the acceptable
  floor). Never install into the system interpreter. [Evidence: E002]
- **`pyproject.toml` is the single source of truth** for dependencies, tool
  configuration (lint, format, type check, test), and project metadata. Do not [Evidence: E002]
  scatter `requirements.txt`, `setup.cfg`, and per-tool rc files alongside it.
- **Lock-file discipline:** the lockfile is committed; installs in CI and on
  other machines sync from the lockfile, not from loose version ranges. Adding
  a dependency means editing `pyproject.toml` through the tool (so the
  lockfile updates), never hand-editing an installed environment. [Evidence: E002]
- Resolve current package versions and the supported Python interpreter range
  via `deps.yaml` lookups at assembly time — never from memory. [Evidence: E101, E110]

## Settings management

- One `Settings` class (pydantic-settings pattern) in `core/config.py` is the
  only place environment configuration is read. Nothing else in the codebase
  calls `os.environ` directly.
- Layering, weakest to strongest: **code defaults < `.env` file < real
  environment variables**. `.env` is a local-development convenience and is
  gitignored; a committed `.env.example` documents every variable with safe
  placeholder values.
- **No import-time side effects.** Importing any module must not connect to a [Evidence: E003]
  database, read required env vars that may be absent, or start clients. [Evidence: E003]
  Provide settings through a cached accessor (e.g. `get_settings()` behind
  `lru_cache`) and construct engines/clients inside the app lifespan, not at
  module top level. Import-time effects break test collection, tooling, and
  any script that imports your code.

## Async model

- **Async-first posture:** default to `async def` handlers and an async
  driver stack end to end (DB driver, HTTP client). A single blocking call
  inside an async handler stalls the entire event loop for all requests.
- **The sync-in-async rule:** if you must call blocking code (a sync-only SDK, [Evidence: E004]
  CPU-bound work, file I/O), either declare the endpoint `def` (FastAPI runs
  it in the threadpool) or explicitly dispatch the blocking call to a
  threadpool/worker. Never call blocking I/O directly inside `async def`. [Evidence: E004]
- Sync endpoints are fine when the whole call chain is sync-only and traffic
  is modest — a `def` handler in the threadpool is correct, not a code smell.
  What is never fine is mixing: blocking work hidden inside `async def`. [Evidence: E004]

## Dependency injection

- Use FastAPI `Depends` for every request-scoped resource: DB session,
  current user, settings, pagination params. Do not reach for module-level [Evidence: E005]
  globals or a third-party container until `Depends` demonstrably falls short.
- **DB sessions are request-scoped:** a yielding dependency opens the session,
  yields it, and closes/rolls back in `finally`. One session per request, never [Evidence: E005, E006]
  shared across requests, never created at import time. [Evidence: E005, E006]
- **Override-for-tests is the payoff:** `app.dependency_overrides` swaps any
  dependency (session → test transaction, auth → fake user) without patching.
  Design dependencies so overriding one function replaces the whole resource;
  if a test needs `monkeypatch` to substitute a resource, the DI boundary is
  drawn wrong.

## Data layer

- Default: **SQLAlchemy in async mode + Alembic migrations**. Schema changes [Evidence: E006]
  ship as migration scripts in the same commit as the model change; the
  database schema is owned by the migration chain, never by `create_all` in [Evidence: E006]
  production code paths.
- Every migration must downgrade cleanly; an irreversible migration is an [Evidence: E006]
  explicit, documented decision, not an omission.
- A simpler store (SQLite file, key-value, or no DB) is justified when data is
  single-writer, low volume, and relational queries are absent — but keep the
  repository seam so the store can change without touching services.

## API versioning and schema discipline

- Mount everything under a version prefix from day one: `/api/v1`. Retrofitting
  a prefix later breaks every client; carrying one costs nothing.
- **Response models are contracts.** Every endpoint declares an explicit
  response schema. Never return ORM objects or raw dicts from handlers — the [Evidence: E007]
  schema is the firewall that stops accidental field leaks (password hashes,
  internal ids) and freezes the wire format independent of the table layout.
- Pick one **pagination convention** (limit/offset or cursor) and one **error
  envelope** shape project-wide before the second endpoint exists. Per-endpoint
  invention here is pure client pain.
- Breaking a response schema is a versioning event (`/api/v2` or a new field
  with deprecation), not a patch.

## Auth boundary

- **Token verification is a dependency**, e.g. `CurrentUser = Depends(get_current_user)`.
  Handlers declare the requirement; they never parse `Authorization` headers or [Evidence: E008]
  decode tokens inline. This centralizes the security-critical path and makes
  it overridable in tests.
- Separate **identity verification** (proving who the caller is — validating a
  credential from an external provider) from **session issuance** (what your
  API hands back for subsequent requests). The verification dependency should
  not care which provider minted the identity.
- Provider-specific mechanics (which endpoints, which claims, which SDK)
  belong to domain packs layered on top of this stack — keep this boundary
  provider-agnostic.
