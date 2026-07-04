# Google Sign-In verification checklist

**This checklist EXTENDS the auth-core verification checklist — run that one
first and in full** (it ships with the auth-core pack and is copied into the
project alongside this file). Every auth-core item applies verbatim: happy
path, forged-token negative tests, refresh/rotation, revocation, and the
storage/leakage audit. The items below add only the Google-specific checks;
they replace nothing.

Legend: **[A]** automated (say what kind of test), **[M]** manual/documented
inspection. Record outcomes in the feature's `verification` notes before
setting it `verified`.

## 1. Backend rejection of bad Google tokens

Auth-core already requires expired/tampered/wrong-`alg`/wrong-issuer negative
tests; make the Google variants concrete:

- [ ] **[A]** Wrong-audience Google token rejected: automated tests prefer a
      verifier fixture or stub that exercises the `aud` mismatch path without
      handling live credentials. If an integration test needs a real Google ID
      token, mint it at test runtime only for a test-owned scratch client/account;
      never commit, log, or reuse the token. [Evidence: E002, E010] The sign-in endpoint returns 401
      and creates no session. This proves `aud` is checked against the web
      client ID, not merely that the token "is from Google".
- [ ] **[A]** Expired Google token rejected beyond the configured skew
      tolerance (fixture token or clock control), with 401 and no session.
- [ ] **[A]** Issuer variants handled: both documented Google issuer forms
      accepted; a near-miss issuer string rejected. (Extends auth-core's
      unknown-issuer test with the Google-specific accept list.)
- [ ] **[A]** The response for each rejection above uses the project's error
      envelope and does not echo the presented token.

## 2. The sign-in-endpoint-only boundary

- [ ] **[A]** A valid, verified Google ID token presented as the bearer
      credential to a regular protected endpoint (NOT the sign-in endpoint)
      is rejected with 401 — no fallback verification path exists.
      (Integration test; this is the "ID token as session" red line.) [Evidence: E002, E008]

## 3. Consent screen and account state

- [ ] **[M]** While the OAuth consent screen is in testing status: a listed
      test user can sign in AND a non-test-user Google account is refused by
      Google (confirming the restriction is understood, not mistaken for an
      app bug). Record the consent screen status and test-user list in the
      project notes; re-verify sign-in after any move to production status.
- [ ] **[M]** Revoked-account behavior: sign in, then revoke the app's access
      from the user's Google account settings. Confirm (a) the app's OWN
      session/refresh behavior after revocation matches the documented
      policy from the design (Google revocation does not automatically kill
      your session — state explicitly what should happen and verify it does),
      and (b) the next Google sign-in for that user goes through consent
      again and re-links to the SAME local user via (iss, sub) — no
      duplicate account.

## 4. Android signing fingerprints

- [ ] **[M]** Sign-in completes on a DEBUG-signed build on a real device or
      emulator with a Google account.
- [ ] **[M]** Sign-in completes on a RELEASE-signed build. If Play App
      Signing is used, this check is only conclusive on a Play-distributed
      build (internal testing track suffices) — the release fingerprint is
      the Play Console's app-signing key, not the local upload keystore.
      Record which fingerprints (debug / local release / Play app-signing)
      are registered and which build was tested.
- [ ] **[M]** Expected non-error states behave per the per-stack notes:
      dismissing the sign-in sheet and a device with no Google account both
      land in a calm signed-out state with a retry affordance — no error
      banner, no prompt loop.

## 5. Cross-check with configuration

- [ ] **[M]** The audience configured in the backend settings and the server
      client ID configured in the Android app are the SAME web client ID,
      sourced from settings/env on the backend (no hardcoded IDs, no
      defaults), with `.env.example` documenting the variable.
- [ ] **[A]** Backend refuses to start when the expected-audience setting is
      absent. (Startup/config test.)
