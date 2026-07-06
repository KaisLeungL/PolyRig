# Next.js frontend — pitfalls and red lines

Each entry: symptom → why it happens → the rule. Red lines are non-negotiable.

## Leaking secrets into the client bundle — RED LINE [Evidence: E006]

- **Symptom:** a backend token, API key, or session secret shows up in the
  browser — visible in devtools, the JS bundle, or network calls made from the
  client.
- **Why:** any value read into a Client Component, or any env var prefixed
  `NEXT_PUBLIC_`, is inlined into the browser bundle. A server value imported
  (even transitively) into a `'use client'` module crosses that boundary
  silently.
- **Rule:** secrets and tokens must live only in server code, read from unprefixed environment variables, and must never be passed to a client component or given a NEXT_PUBLIC_ prefix. [Evidence: E006, E010]
- Guard sensitive modules with the `server-only` package so an accidental client
  import fails the build instead of shipping. [Evidence: E006]

## Trusting the UI for authorization — RED LINE [Evidence: E005]

- **Symptom:** hiding a button or redirecting in a layout is treated as the
  access control; a direct request to the route handler, server action, or
  nested page returns protected data to an unauthorized caller.
- **Why:** middleware and layout checks are UX guardrails, not enforcement — a
  client can call the endpoint directly, and nested routes can render without a
  parent layout's check running as expected.
- **Rule:** every server action, route handler, and data-access function that returns protected data must re-check session and role itself; UI-level gating is never the enforcement point. [Evidence: E005, E007]
- Applied here: the reviewer approve/reject action re-verifies the reviewer role
  server-side even though the button is hidden for regular users. [Evidence: E005]

## Trusting client-side upload validation — RED LINE [Evidence: E011]

- **Symptom:** the server accepts whatever archive the browser built, or skips
  re-validation because "the client already checked it".
- **Why:** anything the browser produces is attacker-controllable; client-side
  packaging and checks exist for user feedback, not security.
- **Rule:** the server must re-extract, re-validate, and normalize every uploaded pack and must never trust a client-built archive, a client-side file check, or client-declared metadata. [Evidence: E011]
- Guard extraction against path traversal, absolute paths, and symlinks that
  escape the target directory. [Evidence: E011]

## CSRF on cookie-authenticated mutations — RED LINE [Evidence: E009]

- **Symptom:** a state-changing request (submit, approve, delete) succeeds when
  triggered cross-site because the session cookie rides along automatically.
- **Why:** cookies are attached to cross-site requests by default; a mutation
  that authorizes purely on cookie presence is forgeable from another origin.
- **Rule:** cookie-authenticated mutations must be protected against CSRF via SameSite cookie attributes and an anti-CSRF token or origin check, and must never authorize on cookie presence alone. [Evidence: E009]

## dangerouslySetInnerHTML XSS [Evidence: E012]

- **Symptom:** pack-authored text, release notes, or any user/remote string is
  rendered as raw HTML and executes injected script.
- **Why:** React escapes interpolated values by default, but
  `dangerouslySetInnerHTML` bypasses that escaping entirely.
- **Rule:** never pass untrusted or remote-authored content to dangerouslySetInnerHTML; render it as escaped text, and if HTML rendering is truly required, sanitize with a vetted sanitizer first. [Evidence: E012]
- Back this with an app-level Content-Security-Policy as defense in depth. [Evidence: E018]

## Caching user-specific data [Evidence: E003]

- **Symptom:** one user sees another user's workbench, or a stale "pending
  review" count; a per-user response was served from a shared cache.
- **Why:** Next.js caches aggressively by default, and the exact defaults have
  shifted across major versions; a fetch that depends on the session can be
  cached as if it were public unless explicitly opted out.
- **Rule:** a response that varies by user must never be stored in a shared cache — mark it dynamic/no-store, and re-verify the current caching directives for the resolved Next.js version. [Evidence: E003, E020]

## 'use client' boundary creep [Evidence: E002]

- **Symptom:** the client bundle balloons; data fetching that should be
  server-side runs in the browser; server-only utilities fail to build.
- **Why:** placing `'use client'` high in the tree (e.g. on a layout or page)
  makes everything it imports part of the client bundle, dragging server code
  and data access across the boundary.
- **Rule:** put `'use client'` on the smallest interactive leaf, and never mark a page or layout as a client component just to use one hook or handler. [Evidence: E002]
- Pass server-fetched data into client components as serializable props instead
  of importing server modules into them. [Evidence: E002]

## Import-time side effects and env access [Evidence: E006]

- **Symptom:** builds fail at collection time, or a module reads an env var that
  is absent during build; behavior differs between build and runtime.
- **Why:** module top-level code runs at import/build time; reading runtime
  config it needs, or connecting to services there, is fragile and can leak
  server assumptions into shared code.
- **Rule:** never read required runtime secrets or open connections at module top level; access configuration inside the request/render path so server-only values are never evaluated during a client build. [Evidence: E006]

## Same-origin vs cross-origin API calls [Evidence: E014]

- **Symptom:** credentialed fetches to the API fail with CORS errors, or a
  wide-open CORS config silently allows any site to make authenticated calls.
- **Why:** a credentialed cross-origin request cannot use a wildcard origin;
  when a server echoes the Origin back to make it "work", any site gains
  credentialed access.
- **Rule:** prefer same-origin path routing; when origins must differ, never wildcard the allowed origin for credentialed requests — list exact origins. [Evidence: E014]

## Client-side fetching of data that belongs on the server [Evidence: E006]

- **Symptom:** the browser calls the backend directly with the session token, or
  renders a loading spinner for data that could have been server-rendered.
- **Why:** moving an authenticated fetch to the client exposes the token and the
  backend URL, and defeats server rendering and caching.
- **Rule:** authenticated backend calls must run on the server (server component or server action) so the token never reaches the browser; the client receives only shaped data. [Evidence: E006]
