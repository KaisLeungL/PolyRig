# Google ID-token verification on FastAPI — implementation decisions

Assumes the `stack/backend-fastapi` conventions (layered layout, Depends for
auth, settings via pydantic-settings, explicit response models). Auth-core
defines the verification red line, JWKS caching rules, session strategy, and [Evidence: E006]
the (iss, sub) identity model; this file adds only the Google specifics.

## Verification approach — pick one deliberately

Two sound implementations of "verify a Google ID token"; both must satisfy [Evidence: E002, E009]
auth-core's claim checks in full. Resolve the concrete packages via this
pack's `deps.yaml` lookups.

- **Google's own auth library** (the default): its ID-token verifier knows
  Google's certificate endpoints and issuer set out of the box, so there is
  less security-critical code to get wrong. Costs: its Google-cert fetch and
  caching behavior is the library's, not yours, and its transport is sync —
  per the stack's async rules, call it in a threadpool (or a `def`
  dependency), never bare inside `async def`. [Evidence: E009]
- **A generic JWT library + JWKS client** (PyJWT with its crypto backend, or
  an equivalent): choose this when the project already verifies other JWTs
  and you want ONE audited verification path, or when you need explicit
  control over JWKS caching per auth-core's rules (bounded TTL, refresh on
  unknown `kid`, reject on fetch failure). Costs: you own the claim checks —
  pin the algorithm, verify `iss`/`aud`/`exp` explicitly; a generic library
  verifies only what you tell it to.

Either way, verification is server-side and unconditional (auth-core red [Evidence: E002, E006]
line); "the app already checked it" is never an input to this decision. [Evidence: E002, E006]

## The sign-in boundary — one endpoint accepts Google tokens

- Expose **one** sign-in endpoint (e.g. `POST /api/v1/auth/google`) whose
  dependency takes the bearer Google ID token, verifies it, provisions the
  user, and returns the app's **own** session per auth-core.
- Every other protected endpoint depends on the app's standard
  current-user/session dependency from the stack conventions. **A Google ID
  token presented to a regular endpoint is rejected exactly like any invalid [Evidence: E008]
  credential** — the session dependency must not fall back to "try verifying [Evidence: E008]
  it as a Google token". Keep the two dependencies as separate functions so
  the type system and tests make the boundary obvious.
- This is auth-core's "provider token is an input, not your session" rule;
  the Google-specific temptation is that the ID token *looks like* a usable
  JWT bearer token. It is not one.

## Claim specifics

- **Audience = the WEB client ID** (see overview §2), even for tokens the
  Android app obtained. Compare exactly; a token whose `aud` is your Android
  client ID is misconfiguration on the client side — reject it, don't
  accommodate it.
- **Issuer: Google legitimately uses more than one issuer string** (with and
  without the URL scheme prefix). Per auth-core pitfall rules, accept via an
  exact-match allowlist containing precisely the documented Google issuer
  forms — never substring matching. [Evidence: E002]
- **Clock skew: small and bounded.** Use the verifier's skew parameter
  (seconds, not minutes) rather than hand-rolled time arithmetic; never widen [Evidence: E002, E009]
  tolerance to make a failing token pass. Verify `exp`; verify `nonce` when
  the client flow supplied one and mark it consumed.

## User provisioning

Per auth-core's identity model: the federated key is **(iss, sub)** — for
Google, normalize the issuer variants to one canonical stored form so the
same user never becomes two identities. `email` (only with [Evidence: E006]
`email_verified` true) is a display attribute, never the key. Provisioning [Evidence: E006]
runs inside one transaction as a **race-safe upsert** backed by the unique
constraint on (iss, sub); concurrent first sign-ins must yield one user row [Evidence: E006]
(auth-core pitfall: provisioning races). Repository owns the query; the
service owns the provision-then-issue-session orchestration.

## Configuration surface

- The expected audience (web client ID) — plus the Android client ID if any
  feature ever needs it — comes from the `Settings` class, sourced from
  environment variables, per the stack's settings rules. Never hardcoded, [Evidence: E010]
  never defaulted: a missing value must fail startup, because a backend that [Evidence: E010]
  silently skips audience checking is worse than one that is down.
- `.env.example` documents each variable with a placeholder (e.g.
  `GOOGLE_WEB_CLIENT_ID=your-web-client-id.apps.googleusercontent.com`).
  Client IDs are not secrets, but any Google client **secret** (server-side [Evidence: E003, E006]
  Google API access, overview §4) is — env-only, no default, gitignored.

## Error semantics

- **401** for every verification failure on the sign-in endpoint — expired,
  bad signature, wrong audience, unknown issuer, replayed nonce — and for
  missing/invalid session on regular endpoints. Do not leak WHICH check [Evidence: E011]
  failed to the caller; log the reason server-side (redacting the token per
  auth-core's leakage rules), return a uniform envelope.
- **403** only for an authenticated-but-disallowed case (e.g. a verified
  Google identity whose local account is disabled or not permitted).
- Responses use the project's single error envelope per the stack pack's
  conventions and never echo the presented token. Negative-path tests for [Evidence: E011]
  each rejection live in the verify checklist.
