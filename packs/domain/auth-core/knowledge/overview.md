# Authentication core — architecture decisions (provider-agnostic)

Foundation knowledge for any OAuth2/OIDC-based sign-in feature. Provider packs
(`requires: [domain/auth-core]`) layer provider specifics on top; nothing here
depends on any particular identity provider.

## 1. Flow selection decision tree

Choose the OAuth2/OIDC flow by **client type**, never by convenience: [Evidence: E001]

- **Public client (mobile app, SPA, desktop app)** — cannot keep a secret; the
  binary/JS is inspectable. Use **authorization code flow + PKCE**. PKCE binds
  the authorization code to the client instance that started the flow, so an
  intercepted code is useless without the verifier. No client secret ships in
  the app — a "secret" embedded in a public client is not a secret.
- **Confidential client (server-side web app, backend service)** — can hold a
  secret in server config. Use the **authorization code flow with client
  authentication** (secret or private-key JWT). Add PKCE anyway; it is cheap
  defense in depth.
- **Machine-to-machine (no user present)** — **client credentials flow**. It
  yields an access token for the client itself, never a user identity. [Evidence: E001]
- **Input-constrained device (TV, console, CLI on a headless box)** — **device
  authorization flow**. The user completes sign-in on a second device. This is
  its only niche; do not use it to dodge redirect-URI handling on platforms [Evidence: E001, E003]
  that support it.

Dead flows — reject in review, no exceptions: [Evidence: E001]

- **Implicit flow**: returns tokens in the URL fragment — leakable via history,
  referrer, and browser extensions; no code-exchange step to bind the client.
  Superseded by code + PKCE everywhere.
- **Resource-owner password grant**: the app collects the user's provider
  password directly. Defeats the entire point of federation, breaks MFA and
  phishing resistance, and is removed from current OAuth guidance.

## 2. Federated sign-in architecture (the backbone)

The one shape that generalizes across every provider and every stack:

1. The client (mobile app, browser) runs the provider flow and obtains a
   **provider identity token** (an OIDC ID token or equivalent assertion).
2. The client sends that token to **your backend** over TLS.
3. The backend **verifies the token independently**: signature against the
   provider's published keys, `iss` (expected issuer), `aud` (YOUR client id),
   `exp`/`iat` (validity window), and `nonce` (if the flow carried one).
4. Only after verification does the backend look up / provision the local user
   and issue **its own session or tokens**. Downstream authorization uses your
   credentials, never the provider's. [Evidence: E002, E004]

**Red line: never trust a client-presented identity token without server-side verification.** [Evidence: E002] The client is attacker-controlled territory; any token it sends
is a claim, not a fact, until your server has checked signature, issuer,
audience, expiry, and nonce itself.

Corollaries:

- The provider's token is an **input** to your auth system, not your session.
  Do not store provider ID tokens as session state or accept them on ordinary [Evidence: E002, E004]
  API calls.
- Verification happens on **every** token the backend accepts as proof of
  identity, not just the first sign-in.

## 3. Token roles — what each is for, and misuse to avoid

| Token | Purpose | Misuse to avoid |
|---|---|---|
| **ID token** | Proves *who authenticated* to the client that requested it (audience = that client). Consumed once at sign-in to establish identity. | Call APIs with it as authorization; forward it as a session credential; accept one minted for a different audience. |
| **Access token** | Authorizes API calls against a specific resource, with specific scopes, for a short time. Opaque to the client. | Derive user identity from it client-side; store it long-term; treat it as proof of authentication. |
| **Refresh token** | Long-lived credential that obtains new access tokens without user interaction. | Send it to any party other than the token endpoint; store it anywhere a lesser secret would live; ship it to code that only needs an access token. |

Confusing ID and access tokens is the classic federation bug: an ID token is a
statement about authentication addressed to one client; it is not an API key.

## 4. Session strategy: stateful vs stateless

After the backend verifies identity it must maintain a session. Two poles: [Evidence: E002, E005]

| Concern | Stateful server session (opaque id + server store) | Stateless JWT (self-contained, signed) |
|---|---|---|
| Revocation | Immediate — delete the record | Hard — token valid until expiry unless you add a denylist (which reintroduces state) |
| Horizontal scaling | Needs a shared session store | Any node can verify with the key |
| Payload / bandwidth | Tiny opaque id | Grows with claims; sent on every request |
| Logout semantics | Real: server forgets the session | Cosmetic unless short-lived or denylisted |
| Sensitive claims | Stay server-side | Readable by anyone holding the token (signed ≠ encrypted) |

**Recommended default: the hybrid.** [Evidence: E005] Short-lived stateless access credential
(minutes, not days) + a server-tracked refresh token. You get stateless
verification on the hot path and real revocation with a bounded window: killing
the refresh token caps the blast radius at the access token's lifetime. Choose
a pure pole only when its trade-offs are explicitly acceptable and documented.

## 5. Refresh strategy

- **Rotation**: every refresh issues a new refresh token and invalidates the
  old one. Mandatory for public clients; strongly recommended everywhere. [Evidence: E005]
- **Reuse detection**: if a rotated-out (already-used) refresh token is
  presented again, treat it as evidence of theft — revoke the **entire token
  family/session**, not just the one token, and require re-authentication. [Evidence: E005]
- **Expiry policy**: pick deliberately. *Absolute* expiry (session dies N days
  after sign-in regardless of activity) bounds worst-case exposure. *Sliding*
  expiry (each use extends life) suits long-lived consumer sessions. The common
  compromise: sliding window inside an absolute cap.

## 6. Secure storage by platform class

Rules by platform **class**; concrete APIs belong to stack packs.

- **Mobile apps**: refresh material goes in hardware-backed secure
  enclave/keystore-class storage, never plain preferences, files, or anything [Evidence: E007]
  that lands in unencrypted backups. Access tokens may live in memory only —
  they are short-lived by design.
- **Browsers**: session/refresh credentials belong in `httpOnly` + `Secure` +
  `SameSite` cookies, not `localStorage`/`sessionStorage`. Anything script can
  read, XSS can exfiltrate; `httpOnly` removes that entire class. If a SPA must [Evidence: E006]
  hold an access token, keep it in memory and accept re-auth on reload (or use
  a backend-for-frontend that keeps tokens server-side).
- **Servers**: client secrets and signing keys live in a secrets manager or
  injected environment — **never in version control**, container images, or [Evidence: E006]
  client-reachable config endpoints. Plan for rotation from day one: two keys
  valid during rollover.

## 7. Identity model and account linking

- A federated identity is the pair **(issuer, subject)** — `(iss, sub)`. That
  pair is the **only** stable unique key for a provider identity. `sub` alone
  collides across providers; store both.
- Model **local user** and **provider identity** as separate entities: one user
  row, many linked `(iss, sub)` rows. This makes multi-provider sign-in and
  later linking/unlinking a data operation, not a migration.
- **Email is a display attribute, not a primary key.** Emails change, can be
  unverified, and at some providers are re-assignable to new owners. Keying
  users on email enables silent account takeover.
- Linking by matching email is only acceptable when the token asserts the email
  is verified **and** your policy explicitly accepts residual takeover risk;
  the safe default is to link only inside an already-authenticated session
  ("connect another provider" while signed in).
- Never unlink a user's last sign-in method without an alternative in place. [Evidence: E010]
