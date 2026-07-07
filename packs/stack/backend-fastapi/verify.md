# FastAPI backend — verification routes

Standing rule: **a feature is not done until the relevant routes below pass.** [Evidence: E018]
Never treat a feature as done on the strength of [Evidence: E018]
"the code looks right". Command names below assume the uv workflow; substitute
the project's chosen tool invocations 1:1 if it differs.

## 1. Dependency sync

- `uv sync` (or the project's lockfile-sync equivalent) completes cleanly from
  a fresh checkout. Failure here means `pyproject.toml` and the lockfile have
  diverged — fix that before anything else.
- Red flag: any instruction anywhere that says to `pip install` a package
  ad hoc instead of adding it to `pyproject.toml`.

## 2. Lint and format

- `uv run ruff check .` — zero errors. Do not silence rules inline to pass; [Evidence: E016]
  rule changes go in `pyproject.toml` with a reason.
- `uv run ruff format --check .` — zero diffs.

## 3. Type check

Decision: mypy or pyright — pick ONE at project start and wire it into
`pyproject.toml`; the two disagree on edge cases and running both produces
noise. **Default: mypy** (`uv run mypy app`), pyright if the team is [Evidence: E017]
editor-first. Route: the chosen checker passes over `app/` with no errors on
new/changed files.

## 4. Tests

- `uv run pytest` — full suite green, including async tests (confirms the
  async test plugin is configured; a suite where async tests silently pass in
  microseconds without running is misconfigured).
- New endpoints get at least: one happy-path test and one validation/auth
  failure test, written against the app via the test client with dependency
  overrides (test DB session, fake auth) — not against live infrastructure.

## 5. App boot smoke test

Either route is acceptable; the point is catching import-time errors and
broken wiring:

- In-process: a test that instantiates the test client against the app and
  gets a 200 from a `/health` (or equivalent) endpoint.
- Process-level: `uv run uvicorn app.main:app` starts, serves the health
  endpoint, and shuts down cleanly on interrupt.

A failure here with green unit tests usually means import-time side effects
or lifespan wiring — see the overview's settings rules.

## 6. Migrations (when the feature touches the DB)

- Upgrade: `uv run alembic upgrade head` on a scratch database succeeds.
- Downgrade: `uv run alembic downgrade -1` then `upgrade head` again succeeds
  — proves the new migration is reversible.
- Drift check: after `upgrade head`, autogenerating a new migration produces
  an EMPTY diff. A non-empty diff means models and migrations have diverged.

## Manual smoke list

Run after the automated routes pass, against a locally running server:

- [ ] OpenAPI docs page (`/docs`) renders and lists the new/changed endpoints
      under the versioned prefix with correct request/response schemas.
- [ ] An auth-protected route returns an auth error (not 500, not 200) for an
      anonymous request, and succeeds with valid credentials.
- [ ] Error responses for a deliberately malformed request match the project's
      documented error envelope (status code and body shape).
- [ ] No secrets or stack traces appear in any response body or in logs at the
      default log level. [Evidence: E010]
