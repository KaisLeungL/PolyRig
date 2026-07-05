# GitHub sign-in on Next.js — implementation decisions

Assumes the `stack/nextjs` conventions (App Router, server components by
default, secrets only in server code, same-origin `/api` → backend, session
consumed as an httpOnly cookie) and this pack's `overview.md`. Auth-core and the
backend-fastapi notes own the actual OAuth flow; this file covers only what the
Next.js frontend does and — more importantly — what it deliberately avoids.

## The frontend does not run the OAuth flow

In this platform's split, the FastAPI backend is the OAuth client and owns the
entire authorization-code flow (overview §2, backend notes). The Next.js app's
only responsibilities are:

- **Start sign-in by navigating to the backend** (e.g. a link/redirect to the same-origin `/api/auth/github/login`) — a plain navigation, not a `fetch`; the browser follows the redirect to GitHub and back to the backend callback. [Evidence: E011]
- **Consume the backend-issued httpOnly session cookie afterward; the cookie is minted by the backend at the end of the callback, and the frontend never reads it in client code and never sees any GitHub token. [Evidence: E011, E012]**

## RED LINE — the token and secret never touch the client [Evidence: E011, E012]

- **The GitHub access token and `client_secret` must never reach the browser: not in a client component, not in a `NEXT_PUBLIC_`-prefixed variable, not in a client-readable response body, not in a URL (stack secret rule + auth-core §6). [Evidence: E011, E012]**
- If GitHub-authenticated data must be shown, fetch it on the server — a server component or server action reads the session cookie and calls the backend, returning only the presentation-ready result to the client (stack BFF/server-fetch rule). [Evidence: E011]
- **Never proxy the raw GitHub token to the client to do that fetch. [Evidence: E011, E012]**

## `state`/CSRF ownership

The OAuth `state` that protects the redirect is generated and checked by the
**backend** (it owns the flow); the Next.js frontend adds nothing to that
handshake. [Evidence: E011]

- **Any cookie-authenticated mutation in the frontend (server actions / route handlers that change state using the session cookie) still needs the stack's own CSRF protection per the nextjs pitfalls — a distinct concern from the OAuth `state`, and not satisfied by it. [Evidence: E011]**

## Identity display vs authorization

- Showing "signed in as @handle" using the backend-provided profile is fine as provenance. [Evidence: E012]
- **Authorization and any publish/ownership UI must key on the locked `publisher_slug` surfaced by the backend, never on the mutable GitHub `login` (overview §3, §7) — a rename must not change who can act. [Evidence: E006, E012]**
- The publisher_slug confirm/create screen after first login is an authenticated server-rendered flow that posts to the backend; the frontend does not invent or lock the slug itself. [Evidence: E012]

## Route protection is enforced server-side

Gating the sign-in-only or publisher UI in middleware/layouts is UX only.

- **Every server action, route handler, and protected data fetch must independently re-check the session (and role) with the backend, because a direct request can bypass layout/middleware checks (stack enforcement rule). [Evidence: E011]**
- GitHub sign-in changes none of this — it only determines who the session belongs to.
