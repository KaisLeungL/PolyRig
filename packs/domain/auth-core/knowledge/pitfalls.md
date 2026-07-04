# Authentication core — pitfalls and red lines (provider-agnostic)

Cross-provider traps. Each entry: **symptom → why → the rule**. These apply to
every identity provider; provider packs add only provider-specific variants.

## 1. CSRF on the redirect callback (missing/unchecked `state`)

- **Symptom**: an attacker can complete an auth flow in the victim's browser,
  silently logging the victim into the attacker's account (login CSRF) — data
  the victim then saves lands in an account the attacker controls.
- **Why**: the callback endpoint accepts any authorization response without
  proving that *this browser session* initiated *this flow*.
- **The rule**: generate `state` as a fresh cryptographically random value per
  authorization request; bind it to the browser session (server-side or in a
  short-lived, scoped cookie); on callback, compare with constant-time
  equality, reject on any mismatch or absence, and make it single-use.

## 2. Nonce and ID-token replay

- **Symptom**: a captured ID token is presented later (or in another flow) and
  accepted as a fresh sign-in.
- **Why**: signature/expiry checks alone cannot tell a fresh authentication
  from a replayed one within the validity window.
- **The rule**: send a random `nonce` in the authorization request, verify the
  ID token echoes it, and mark it consumed. `state` protects the callback
  (CSRF); `nonce` protects the token (replay). They are not interchangeable —
  use both, generated independently.

## 3. PKCE verifier mishandling

- **Symptom**: PKCE is "enabled" but an intercepted authorization code still
  exchanges successfully.
- **Why**: the verifier was reused across flows, generated with weak
  randomness, stored where other apps/scripts can read it, or — worst — the
  plain method was used so the challenge *is* the verifier.
- **The rule**: fresh high-entropy verifier per flow, S256 challenge method,
  verifier kept in flow-local storage and discarded after the exchange.

## 4. Redirect URI validation

- **Symptom**: authorization codes or tokens delivered to an
  attacker-controlled destination; provider consent screen used as an
  open-redirect trampoline for phishing.
- **Why**: redirect URIs validated by prefix, substring, or wildcard — or the
  callback itself forwards to a `?next=` target taken verbatim from the
  request.
- **The rule**: register full redirect URIs and match **exactly** (scheme,
  host, port, path). Never validate by prefix or pattern. Any post-login
  `next`/`return_to` parameter is validated against an allowlist of your own
  paths — never a full URL taken from the request.

## 5. Token leakage vectors

- **Symptom**: valid tokens turn up in access logs, crash reports, analytics,
  browser history, or third-party `Referer` headers.
- **Why**: tokens were placed in URLs (query strings are logged everywhere and
  leak via referrer), or a "log the whole request object" / global error
  handler serialized headers, cookies, and bodies wholesale into logs and
  error messages.
- **The rule**: tokens travel in headers, POST bodies, or cookies — never in
  URLs. Redact `Authorization`, cookies, and token-shaped fields at the logging
  layer (structured logging with a denylist), not by per-call-site discipline.
  Error responses never echo the credential that failed.

## 6. Expiry, clock skew, and validity-window traps

- **Symptom**: intermittent "token expired / not yet valid" failures that
  correlate with which server handled the request; or, opposite, a generous
  hand-rolled grace period quietly accepts hours-old tokens.
- **Why**: issuer and verifier clocks drift; `exp`/`iat`/`nbf` compared with
  raw equality against local time, or "fixed" with an unbounded fudge factor.
- **The rule**: run NTP on verifiers, allow a small bounded skew tolerance
  (seconds to a very few minutes), and treat validation failure as failure —
  never widen the window to make an error go away.

## 7. Audience-check omission

- **Symptom**: a token legitimately minted for a *different* application (same
  provider) is accepted by your backend — any app's users can impersonate into
  yours with a token they obtained lawfully elsewhere.
- **Why**: signature and expiry pass (the token is genuine); only `aud` says
  who the token was minted *for*, and it was never checked.
- **The rule**: always verify `aud` equals your own client/application id
  exactly. This check is as mandatory as the signature.

## 8. Issuer-string variations

- **Symptom**: verification randomly rejects genuine tokens, so someone
  "fixes" it with `issuer.contains(...)` — which then accepts hostile issuers.
- **Why**: some providers emit more than one legitimate issuer form (e.g. with
  and without a scheme prefix), and substring matching is not validation.
- **The rule**: compare `iss` by exact match against an explicit allowlist of
  the issuer strings you accept. Never substring/regex-match the issuer.

## 9. Verifying the signature but not the claims — and `alg` confusion

- **Symptom**: "we verify the JWT" — but the verifier only checked that *some*
  key validated *some* signature; or a token with `alg: none` (or an HMAC alg
  keyed with the public key) sails through.
- **Why**: the token's own header was allowed to choose the verification
  algorithm, and claim checks (`iss`, `aud`, `exp`, `nonce`) were assumed to be
  part of "signature verification" when the library does not do them by
  default.
- **The rule**: pin the accepted algorithm(s) in verifier configuration; reject
  `none` unconditionally; never let the token header select the algorithm or
  key type. Then verify claims explicitly — signature proves *who signed*,
  claims prove *for whom, for what, and until when*.

## 10. Provider key-set (JWKS) caching

- **Symptom**: every request re-fetches the provider's keys (latency, rate
  limiting, hard downtime coupling) — or keys are cached forever and all
  verification breaks the day the provider rotates them.
- **Why**: providers rotate signing keys routinely; both "no cache" and
  "eternal cache" ignore that.
- **The rule**: cache the key set with a bounded TTL; on a token whose `kid`
  is not in cache, refresh once (rate-limited) and retry verification; if the
  key is still unknown, reject. Never accept an unverifiable token because the
  key fetch failed.

## 11. Logout that revokes nothing

- **Symptom**: user "logs out", the cookie disappears, but the stolen/copied
  session id or refresh token keeps working.
- **Why**: logout was implemented as client-side deletion only. Deleting the
  client's copy of a credential does not invalidate the credential.
- **The rule**: define logout as server-side invalidation — kill the session
  record and/or revoke the refresh-token family — then clear the client copy.
  Document what logout does and does not revoke (self-contained access tokens
  may remain valid until expiry: keep them short, and say so in the design).

## 12. Race conditions in account auto-provisioning

- **Symptom**: a user's very first sign-in fires twice concurrently (double
  tap, retry, two devices) and creates duplicate local users; later data
  splits across them.
- **Why**: provisioning was "SELECT by (iss, sub); if absent INSERT" without
  atomicity — both requests see absent and both insert.
- **The rule**: enforce a **unique constraint on (iss, sub)** at the database
  level and provision idempotently (upsert, or catch the unique violation and
  re-read). The constraint is the guarantee; application-level checks are only
  an optimization.
