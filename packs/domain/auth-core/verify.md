# Auth verification checklist (provider-agnostic)

Run after implementing **any** authentication feature built on this pack.
Provider packs extend this list rather than replacing it.

Legend: **[A]** automated (say what kind of test), **[M]** manual/documented
inspection. Every item must be checked; record outcomes in the feature's [Evidence: E011]
`verification` notes before setting it `verified`.

**Scope by chosen session strategy.** Sections 3 and 4 below include items that
are predicated on the design *having* refresh tokens and rotation/reuse
detection. A feature whose session strategy issues no refresh token (e.g. a
single opaque server-side session for an MVP) has nothing to test there:
mark each inapplicable item **N/A** in the notes with the one-line reason
(which strategy was chosen, per `knowledge/overview.md` §4–§5), rather than
skipping it silently. Every item is checked **or** explicitly marked N/A with [Evidence: E004, E005]
a reason; an inapplicable item is never quietly dropped from the list. [Evidence: E004, E005]

## 1. Happy path

- [ ] **[M]** Full sign-in completes end to end on a real client: provider flow
      → backend verification → backend-issued session/tokens returned.
      (Manual because it crosses a real provider UI; script what you can.)
- [ ] **[A]** A protected route returns 200 with the backend-issued session and
      401/403 without it. (Integration test against the running backend.)
- [ ] **[A]** First sign-in provisions exactly one local user linked to the
      (iss, sub) identity; second sign-in reuses it — no duplicate row.
      (Integration test with a stubbed verified token.)

## 2. Failure states (negative tests — all automated)

Use unit/integration tests with forged or fixture tokens against the backend's
verification path. Each case must be **rejected** and must not create a session: [Evidence: E002, E008]

- [ ] **[A]** Expired token (`exp` in the past, beyond skew tolerance).
- [ ] **[A]** Wrong-audience token (valid signature, `aud` = a different
      client id).
- [ ] **[A]** Tampered signature (modify one payload byte, keep the signature).
- [ ] **[A]** Wrong or unexpected `alg` header, including `alg: none`.
- [ ] **[A]** Unknown issuer string (near-miss variant of the real issuer).
- [ ] **[A]** Missing or mismatched `state` on the redirect callback aborts the
      flow with no session side effects. (Integration test on the callback
      endpoint.)
- [ ] **[A]** Replayed `nonce`: the same ID token / nonce presented twice —
      second attempt rejected. (Integration test.)
- [ ] **[A]** Rejection responses do not echo the presented token or secrets. [Evidence: E006]
      (Assert on response body in the tests above.)

## 3. Persistence and refresh

- [ ] **[M]** Session survives app restart / browser restart exactly as the
      chosen session strategy says it should (and does NOT survive where the
      design says it should not).
- [ ] **[A]** Refresh flow: a valid refresh token yields a new access
      credential that works on a protected route. (Integration test.)
- [ ] **[A]** If rotation is chosen: the refresh response includes a NEW
      refresh token and the old one no longer works. (Integration test.)
- [ ] **[A]** If reuse detection is chosen: presenting an already-rotated-out
      refresh token revokes the whole token family — the newest token stops
      working too. (Integration test.)
- [ ] **[A]** Expiry policy enforced: refresh past the absolute cap (or after
      the sliding window lapses) is rejected. (Integration test with clock
      control/fake time.)

## 4. Revocation

- [ ] **[A]** Logout invalidates exactly what the design says it invalidates:
      after logout, the session id / refresh token is rejected server-side —
      not merely deleted client-side. (Integration test: capture credential,
      log out, replay it.)
- [ ] **[M]** Any documented residual validity (e.g. short-lived stateless
      access tokens outliving logout) is stated in the feature's design notes
      with its time bound.
- [ ] **[A]** A revoked/disabled local account cannot refresh: refresh attempts
      for that user are rejected even with a previously valid refresh token.
      (Integration test.)

## 5. Storage and leakage audit

- [ ] **[A]** No tokens in logs: exercise sign-in, refresh, and a failed
      verification, then scan captured log output for token material
      (JWT-shaped strings, Authorization header values). (Scriptable grep over
      test-run logs.)
- [ ] **[A]** No tokens or client secrets in version control: scan the repo for
      secret-shaped strings (secret-scanning tool or grep in CI).
- [ ] **[M]** No tokens in URLs: inspect the network trace of a full sign-in +
      refresh — credentials travel only in headers, POST bodies, or cookies.
- [ ] **[M]** Storage location matches the platform-class rules in
      `knowledge/overview.md` §6: mobile refresh material in keystore-class
      storage; browser credentials in httpOnly+Secure+SameSite cookies (not
      localStorage); server secrets in a secrets manager/env. (Code review
      against the checklist; cite file paths in the notes.)
- [ ] **[A]** Database enforces the (iss, sub) unique constraint. (Schema/
      migration test, or concurrent-provisioning integration test.)
