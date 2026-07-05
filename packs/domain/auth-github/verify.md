# GitHub sign-in verification checklist

**This checklist EXTENDS the auth-core verification checklist — run that one
first and in full** (it ships with the auth-core pack and is copied into the
project alongside this file). Every auth-core item applies, with one adaptation:
GitHub OAuth Apps have **no ID token**, so auth-core's JWT-signature / `aud` /
`nonce` / JWKS negative tests are replaced by the GitHub identity-source and
token-custody tests below — they are not skipped, they change shape. The `state`
/CSRF, session, revocation, and storage/leakage items apply verbatim.

Legend: **[A]** automated (say what kind of test), **[M]** manual/documented
inspection. Record outcomes in the feature's `verification` notes before setting
it `verified`.

## 1. Callback CSRF and the identity source

- [ ] **[A]** Missing or mismatched `state` on the callback aborts with no
      session created and no token exchange attempted. (Integration test on the
      callback route; extends auth-core's `state` test with the assertion that
      no outbound GitHub call fires.) [Evidence: E002]
- [ ] **[A]** Identity is read from the backend's own `GET /user` call, not from
      the access token: with a stubbed GitHub API, the local user is keyed on the
      numeric `id` returned by `GET /user`. No code path decodes or "verifies"
      the access token as a JWT. (Integration test with a faked GitHub client.) [Evidence: E001, E003]
- [ ] **[A]** A failed/blank code exchange (GitHub returns an error or no token)
      results in 401 and no session — the callback does not proceed to identity
      read. (Integration test with a stubbed token endpoint.) [Evidence: E001]

## 2. Numeric-id identity, not login

- [ ] **[A]** Two sign-ins for the same numeric GitHub `id` but a **changed
      `login`** resolve to the SAME local user, and `login` is updated as a
      display attribute — no duplicate account, no re-key. (Integration test with
      stubbed `GET /user` responses differing only in `login`.) [Evidence: E006]
- [ ] **[A]** Database enforces uniqueness on the GitHub numeric id; concurrent
      first sign-ins for the same id yield exactly one user row. (Schema test or
      concurrent-provisioning integration test — extends auth-core's constraint
      test.) [Evidence: E006, E011]

## 3. Scopes and email handling

- [ ] **[M]** The authorize request uses the minimal scope: **no scope** for
      public-profile-only sign-in, or **`user:email`** when an email is needed —
      never `user` or any `repo` scope. Record the exact scope string requested. [Evidence: E004]
- [ ] **[A]** A `GET /user` response with `email == null` does not crash
      provisioning; when an email is needed, the backend reads
      `GET /user/emails`, selects a **verified** (preferably primary) address,
      and handles the no-verified-email case per the documented policy.
      (Integration test with stubbed email responses.) [Evidence: E005]

## 4. Token custody and the sign-in boundary

- [ ] **[A]** The GitHub access token and client secret are absent from every response body, URL, and log: exercise a full sign-in and a failed exchange, then scan captured logs/responses for token- and secret-shaped strings. (Extends auth-core's leakage scan.) [Evidence: E011, E012]
- [ ] **[A]** A GitHub access token presented as the bearer credential to a
      regular protected endpoint (NOT the callback) is rejected with 401 — the
      session dependency has no fallback that treats it as valid. (Integration
      test; this is the "provider token is not your session" red line.) [Evidence: E012]
- [ ] **[M]** Frontend audit: the GitHub token/secret are absent from the client
      bundle and from any `NEXT_PUBLIC_` variable; sign-in starts by navigating
      to the backend and the browser only ever holds the backend's httpOnly
      session cookie. (Code review + built-bundle grep.) [Evidence: E011, E012]

## 5. Publisher identity separation

- [ ] **[A]** Authorization for publish/ownership resolves through the locked
      `publisher_slug`, not the GitHub `login`: a user whose `login` changed
      retains the same `publisher_slug` and the same rights; the mutable handle
      is never the authorization key. (Integration test.) [Evidence: E006, E012]
- [ ] **[M]** First-login flow confirms/creates a `publisher_slug` as a separate
      record bound to the user, and it is locked thereafter. Record where the
      binding lives. [Evidence: E012]

## 6. Configuration and rollout constraints

- [ ] **[A]** Backend refuses to start when `GITHUB_CLIENT_SECRET` (or the
      expected callback config) is absent — no silent default. (Startup/config
      test.) [Evidence: E011, E012]
- [ ] **[M]** The `redirect_uri` used matches the OAuth App's registered callback
      under GitHub's host/port/subpath rule for each environment tested
      (dev/staging/prod, or a dedicated dev OAuth App). Record which callback is
      registered where; a redirect mismatch is a configuration failure, not an
      app bug. [Evidence: E009]

## 7. Revocation (adapts auth-core)

- [ ] **[A]** Logout invalidates the app's OWN session server-side (auth-core
      logout test). State explicitly whether logout also revokes the GitHub grant
      via `DELETE /applications/{client_id}/grant`; if it does, verify the grant
      is gone, and if it does not, document the residual GitHub authorization. [Evidence: E008]
- [ ] **[M]** No GitHub-token refresh logic exists for the OAuth App path (there
      is no refresh token); session lifetime is managed by the app's own
      session/refresh per auth-core. [Evidence: E007, E010]
