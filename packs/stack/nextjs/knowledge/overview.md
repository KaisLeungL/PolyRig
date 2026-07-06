# Next.js frontend — architecture decision guidance

Slow-changing decision guidance for building a Next.js App Router frontend.
Framework, React, and tooling versions plus churning API surfaces are NOT here;
resolve them via `deps.yaml` lookup strategies before writing code.

Driving use cases for this pack: a frontend that renders **public, indexable
pages** (a pack catalog and detail pages), an **authenticated upload flow** (a
form that selects a local directory), a **reviewer console** (role-gated queues
and actions), and a **user workbench** (per-user drafts and status). The
decisions below serve those shapes without prescribing a specific backend.

## Project layout

Default layout for an App Router project — routes are a file tree; shared,
non-route code lives outside it: [Evidence: E001]

```
app/
  layout.tsx           # root layout: html/body, providers, global chrome
  page.tsx             # home / catalog entry
  packs/[type]/[name]/versions/[version]/page.tsx   # public detail page
  (dashboard)/         # route group: authenticated workbench, not a URL segment
  review/              # role-gated reviewer console
  api/                 # route handlers when an HTTP endpoint is genuinely needed
lib/                   # framework-agnostic helpers: api client, formatters
components/            # reusable presentational + client components
```

Rules that make this layout work:

- **A route file is a thin composition point.** A `page.tsx` fetches the data it
  needs and composes components; reusable logic lives in `lib/`, not in the
  route file.
- **Route groups `(name)/` organize without adding URL segments.** Use them to
  give the workbench and reviewer console their own layouts (nav, auth shell)
  without changing the public URL shape.
- **Keep the client boundary shallow.** Server components are the default; a
  `page.tsx` stays a server component and delegates only the genuinely
  interactive leaves (forms, menus, the directory picker) to client components.

## Server/client component boundary

Components in the App Router are **React Server Components by default**; they run
only on the server, can be `async`, and can read server-only resources directly.
A component becomes a **Client Component** — shipped to the browser, able to use
state, effects, and event handlers — only when its module (or an ancestor
module) carries the `'use client'` directive. [Evidence: E001, E002]

- **Push `'use client'` to the leaves.** Mark the smallest interactive
  component, not a whole page, so the client bundle stays small and data
  fetching stays on the server.
- **Pass server data down as serializable props, not by importing server modules into client code.** A client module that imports server data-access code pulls that code into the browser bundle. [Evidence: E002]
- **Interleave via children, not imports.** To place a server component inside a
  client component, pass it as `children`/props from a server parent. [Evidence: E002]
- Applied to the use cases: the pack detail page is a server component that
  fetches metadata and renders a small `'use client'` copy-install-URL button;
  the upload page is a server shell wrapping a `'use client'` directory-picker
  form; the reviewer console renders server-fetched queue rows with client
  approve/reject controls.

## Data fetching and caching

Fetch data in **server components, close to where it is rendered**, rather than
lifting everything to the top and prop-drilling. Next.js layers a request/router
cache and a data cache over fetches, and the caching defaults have changed across
major versions — confirm the current defaults and opt-out APIs via a `deps.yaml`
lookup before relying on them. [Evidence: E003]

- **Know whether a route is static or dynamic.** Reading a dynamic request API
  (cookies, headers, search params) opts a route out of static rendering. Public
  catalog and detail pages should stay static/cacheable; per-user pages
  (workbench, reviewer console) are dynamic because they read the session cookie.
  [Evidence: E003]
- **A response that depends on the current user must never be stored in a shared cache.** [Evidence: E003, E020]
- Treat "is this response the same for every visitor?" as the question that
  decides caching, and re-verify the exact cache directives for the resolved
  Next.js version.
- **After a mutation, revalidate the affected paths or tags; a write is not visible to the next render until you do.** [Evidence: E003, E004]

## Mutations: server actions and route handlers

Next.js offers two server-side mutation surfaces; pick by caller. [Evidence: E004]

- **Server Actions** for form submissions and mutations driven from your own
  components (upload submit, submit-for-review, approve/reject). They integrate
  with forms and revalidation and avoid hand-writing a fetch + endpoint pair.
- **Route Handlers (`app/api/.../route.ts`)** when you need a real HTTP endpoint:
  a webhook target, a public JSON contract, or a client called by something
  other than your own React tree.
- **A server action and a route handler are both publicly reachable server endpoints, so every authorization and validation rule must live inside them, never in the calling UI.** [Evidence: E005]

## Session consumption and authorization

This stack **consumes** an existing session and enforces authorization at data
access; it is provider-agnostic. Identity/session issuance (which OAuth provider,
how the cookie is minted) belongs to a backend or a domain pack layered on top.

- **Verify the session close to the data.** A middleware redirect or a layout
  check improves UX but is not the security boundary.
- **Every server action, route handler, and data-access function that returns protected data must independently check session and role, because middleware and layouts can be bypassed by requesting a nested route or the endpoint directly.** [Evidence: E005, E007]
- **Authorization is a server decision; client-side gating (hiding a button) is presentation only and must never be the enforcement point.** [Evidence: E005]
- **Never copy a session token, session secret, or backend credential into a client component or a `NEXT_PUBLIC_` variable.** [Evidence: E006, E010]
- Use unprefixed environment variables for secrets, and the `server-only` guard
  to make an accidental client import fail at build time. [Evidence: E006]

## Talking to the backend API

When the frontend is a separate app from its API (the common case here — a
Next.js UI in front of a separate API service):

- **Prefer same-origin path routing in production** (e.g. `/` → Next.js,
  `/api` → backend) to avoid credentialed CORS and cross-site cookie complexity.
- **When the API must be on a different origin, a credentialed request must never use a wildcard allowed origin — list exact origins.** [Evidence: E014]
- **Do the authenticated fetch on the server:** read the session cookie in a
  server component or server action and call the backend from there, returning
  only shaped data so the token never reaches the browser. [Evidence: E006]
- **Centralize the API client in `lib/`.** One module builds request URLs,
  forwards the session, and shapes errors — routes call it rather than
  hand-rolling `fetch` with duplicated base-URL and header logic.

## Directory upload UI

For the "select a local pack directory and upload" flow: [Evidence: E011, E013]

- A directory picker uses an `<input type="file" webkitdirectory>`; selected
  files are read through the File API and packaged client-side purely for
  transport. `webkitdirectory` is widely supported but non-standard — confirm
  current browser support before depending on it. [Evidence: E013]
- **Client-side packaging and validation are UX only; the server must re-extract, re-validate, and normalize every upload and must never trust a client-built archive or client-side check.** [Evidence: E011]
- Say so in the UI copy, so users understand the server re-checks their upload.

## Public pages and metadata

Public catalog and detail pages are indexable, so they need real metadata and
should stay server-rendered. [Evidence: E008]

- Use the **Metadata API** (a static `metadata` export, or `generateMetadata`
  for dynamic per-pack titles/descriptions) to set title, description, and
  canonical/share tags on public pages. [Evidence: E008]
- Keep public pages as server components with no session dependency so they stay
  cacheable and fast; render pack-authored text as escaped content and set
  security headers (e.g. a Content-Security-Policy) at the app level. [Evidence: E018]

## TypeScript and tooling

- **TypeScript-first.** Next.js has built-in TypeScript support; enable it and
  keep type checking in the verification route. Resolve the TypeScript version
  via `deps.yaml`. [Evidence: E015]
- **Styling via Tailwind** is the default for this pack; its install and config
  steps differ across majors, so follow the version resolved in `deps.yaml`
  rather than a remembered setup. [Evidence: E016]
- **One package manager, one committed lockfile.** Pick npm, pnpm, or yarn at
  project start; installs sync from the lockfile. The specific tool and version
  are `deps.yaml` lookups. [Evidence: E108]
