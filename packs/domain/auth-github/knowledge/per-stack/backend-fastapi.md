# GitHub sign-in on FastAPI — implementation decisions

Assumes the `stack/backend-fastapi` conventions (layered layout, `Depends` for
auth, `Settings` via pydantic-settings, async-first with the sync-in-async
rule, no import-time side effects) and this pack's `overview.md`. Auth-core
defines the session strategy, storage rules, and provisioning-race safety; this
file adds only the GitHub specifics for a FastAPI backend acting as the OAuth
**confidential client**.

## The backend is the OAuth client

The whole authorization-code flow lives in FastAPI — there is no client-side
token handling and no ID token to verify (overview §0). Two thin routes plus a
service:

- **`GET /api/auth/github/login`** — mints a fresh `state`, binds it to the browser session (short-lived signed cookie or server store), and redirects to GitHub's authorize endpoint with `client_id`, `redirect_uri`, and the minimal scope (overview §4). [Evidence: E002, E004]
- **`GET /api/auth/github/callback`** — checks `state` (constant-time, single-use; abort on mismatch), then delegates the code-for-token exchange, the `GET /user` identity read, provisioning, and session issuance to a service function. [Evidence: E002]
- **Business logic never lives in the handler — the handler stays thin per the stack layering rule. [Evidence: E011]**

Provisioning is a race-safe upsert on GitHub's numeric id inside one
transaction, backed by the unique constraint (auth-core provisioning-race
rule); the repository owns the query, the service owns
verify-identity-then-issue-session. [Evidence: E006, E011]

## HTTP calls are outbound async I/O — keep them off the event loop

The token exchange (`POST .../login/oauth/access_token`) and the identity read
(`GET /user`, `GET /user/emails`) are outbound HTTP calls.

- **Use the stack's async HTTP client (`httpx.AsyncClient`) so these calls never block the event loop; a sync-only client must be dispatched per the stack's sync-in-async rule (a `def` dependency or a threadpool), and blocking HTTP is never called inside an `async def` handler. [Evidence: E011, E013]**
- Send `Accept: application/json` on the token exchange so the response parses as JSON, not a URL-encoded query string (overview §2). [Evidence: E001]
- Set explicit connect/read timeouts, and treat GitHub 4xx/5xx as auth failures that produce a uniform 401 with no session, without leaking GitHub's raw error body to the caller.

## Identity read and email handling

- Read identity from `GET /user`; persist the numeric `id` as the immutable key and `login` as a refreshed display attribute only (overview §3). [Evidence: E006]
- **If the product needs an email, request `user:email`, read `GET /user/emails`, select a verified address (prefer `primary`), and handle the no-verified-email case explicitly rather than crashing (overview §5). [Evidence: E004, E005]**

## Configuration surface

- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and the registered callback URL come from the `Settings` class, sourced from environment variables per the stack's settings rules. [Evidence: E011]
- **The client secret is a real secret: env-only, no default, gitignored — and a missing secret must fail startup, because a backend that cannot authenticate its token exchange should not boot. [Evidence: E011, E012]**
- `.env.example` documents each variable with a placeholder (e.g. `GITHUB_CLIENT_ID=Iv1_your_client_id`, `GITHUB_CLIENT_SECRET=your-secret`, `GITHUB_OAUTH_CALLBACK_URL=https://.../api/auth/github/callback`). The client id is not a secret; the secret is. [Evidence: E011]
- **The callback URL in settings must match the OAuth App's registered callback under GitHub's host/port/subpath rule (overview §8). [Evidence: E009]**

## The sign-in boundary — separate dependency from session auth

- The GitHub flow terminates at the callback by issuing the app's own session (auth-core). Every other protected endpoint depends on the app's standard current-user/session dependency. [Evidence: E012]
- **A GitHub access token presented to a regular endpoint is rejected like any invalid credential — the session dependency must not fall back to "maybe this is a GitHub token". [Evidence: E012]**
- Keep the sign-in service and the session dependency as separate functions so the boundary is obvious to the type system and to tests.

## `publisher_slug` provisioning

After the first successful GitHub sign-in, the confirm/create-`publisher_slug`
step is its own service operation against a separate `publisher` record bound to
the user; it is not derived from the GitHub `login` (overview §7). [Evidence: E012]

- **Once locked, authorization for publish/ownership resolves through `publisher_slug`, never the GitHub handle. [Evidence: E006, E012]**

## Error semantics

- **401 for every sign-in failure (bad/absent `state`, code exchange failure, GitHub API failure, missing-required-email by policy) and for missing/invalid session on regular endpoints; do not leak which check failed, and log server-side with the token/secret redacted behind the project's uniform envelope. [Evidence: E011]**
- **403** only for an authenticated-but-disallowed case (e.g. a verified GitHub identity whose local account is disabled or lacks the role a route demands).
- Negative-path tests for each rejection live in the verify checklist.
