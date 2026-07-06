# Next.js frontend — verification routes

Standing rule: a feature is not done until the relevant routes below pass; never mark a feature `verified` in `feature_list.json` on the strength of "the code looks right". [Evidence: E019]
Commands below use `pnpm` as the example package manager and Next.js script
names; substitute the project's resolved package manager and scripts 1:1 if they
differ (see `deps.yaml`). [Evidence: E108]

## 1. Dependency install

- `pnpm install` completes cleanly from a fresh checkout against the committed
  lockfile. Failure here means `package.json` and the lockfile diverged — fix
  that before anything else.
- Red flag: any instruction to install a package ad hoc instead of adding it to
  `package.json` and updating the lockfile.

## 2. Lint

- Run the project's lint script (e.g. `pnpm lint`) — zero errors. [Evidence: E105]
- Do not silence rules inline to make the route pass; rule changes go in the ESLint config with a reason. [Evidence: E105]

## 3. Type check

- Run the project's type-check script (e.g. `pnpm typecheck`, wired to the
  TypeScript compiler in no-emit mode) — zero errors on new/changed files. [Evidence: E015, E103]
- A green production build is not a substitute for a type check unless the build
  is configured to fail on type errors.

## 4. Tests

- Run the project's test script (e.g. `pnpm test`) — the suite is green. [Evidence: E017]
- New interactive components get at least one behavior test; new server actions
  and route handlers get at least one happy-path test and one
  unauthorized/invalid-input test that asserts the server rejects the request. [Evidence: E005]
- End-to-end coverage (e.g. a Playwright run) exercises each driving flow —
  browse a public page, upload, submit for review, approve — where the project
  has an e2e suite. [Evidence: E106]

## 5. Production build

- `pnpm build` succeeds. This catches server/client boundary violations,
  import-time failures, and type/lint errors when the build is configured to
  enforce them. [Evidence: E101]
- A build failure citing a client component importing server-only code confirms
  a boundary leak — fix the import, do not relax the `server-only` guard. [Evidence: E006]

## 6. Boot smoke test

- Start the built app (e.g. `pnpm start`) and load a public page and one
  authenticated page; both render without server errors and the authenticated
  page redirects or 401s when the session cookie is absent. [Evidence: E005]

## Manual smoke list

Run after the automated routes pass, against a locally running app:

- [ ] View source / network on a public detail page: no session token, backend
      credential, or unprefixed secret appears in the HTML, the JS bundle, or any
      client-initiated request. [Evidence: E006]
- [ ] A protected server action or route handler returns an auth error (not 500,
      not success) when called without a valid session, and rejects a valid
      session that lacks the required role. [Evidence: E005]
- [ ] A public, indexable page has a real title and description via the Metadata
      API. [Evidence: E008]
- [ ] Pack-authored text (summary, release notes) renders as escaped text, not
      raw HTML; nothing untrusted reaches `dangerouslySetInnerHTML`. [Evidence: E012]
- [ ] The upload UI states that the server re-validates; confirm the client
      never gates the final accept decision. [Evidence: E011]
- [ ] A per-user page (workbench, reviewer queue) is not served from a shared
      cache — two different sessions see their own data. [Evidence: E003]
