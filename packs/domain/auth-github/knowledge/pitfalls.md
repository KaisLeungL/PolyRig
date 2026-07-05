# GitHub sign-in — pitfalls and red lines (provider-specific)

GitHub-specific traps only. Every auth-core pitfall (state/CSRF, redirect-URI
validation, token leakage, logout-that-revokes-nothing, provisioning races)
applies unchanged; the entries below add the GitHub variants. Each entry:
**symptom → why → the rule**.

## 1. Treating the OAuth App flow as OIDC / verifying a non-existent ID token

- **Symptom**: code imports a JWT/OIDC verifier, then fails or — worse — "succeeds" by verifying nothing, because a GitHub OAuth App response contains no ID token to verify.
- **Why**: the developer pattern-matched GitHub onto the auth-core OIDC shape (client presents signed token, server verifies it). GitHub OAuth Apps are not OpenID Connect; the access token is opaque and is not an identity assertion. [Evidence: E001, E003]
- **The rule: do not run signature/`aud`/`nonce`/JWKS checks against GitHub OAuth tokens — establish identity by the backend's own authenticated `GET /user` call over TLS, and secure the flow with `state` and TLS, not token verification. [Evidence: E001, E003]**

## 2. RED LINE — keying users on `login` instead of the numeric id [Evidence: E006]

- **Symptom**: after a user renames on GitHub (or a released username is claimed by someone else), sign-in links to the wrong local account, or a stranger inherits an old account.
- **Why**: `login` is mutable and, once released, claimable by another person; it is not an identity. [Evidence: E006]
- **The rule: the local identity key is GitHub's numeric `id`; `login` is a refreshed display attribute only, never a match key or an authorization input, and uniqueness is enforced on the numeric id at the database level. [Evidence: E006, E011]**

## 3. Assuming sign-in always yields a (verified) email

- **Symptom**: provisioning crashes on a `null` email, or a user is keyed/linked on an unverified or non-primary address.
- **Why**: `GET /user`'s `email` is `null` when no public email is set, and addresses from `GET /user/emails` carry independent `primary`/`verified` flags. [Evidence: E005]
- **The rule: treat email as optional and as a display attribute only; when an email is needed, request `user:email`, read `GET /user/emails`, and use only a verified address (prefer primary) — never make email the identity key and never trust an unverified address. [Evidence: E004, E005]**

## 4. Over-scoping the sign-in request

- **Symptom**: the consent screen asks for `repo` or full `user` write access "to be safe"; users balk, and the app now custodies far more authority than login needs.
- **Why**: scope was chosen for imagined future features, not for authentication — public profile needs no scope, and email needs only `user:email`. [Evidence: E004]
- **The rule: request the minimum scope for the current feature (no scope, or `user:email` for email) and add scopes incrementally only when a feature actually needs them — a broad scope on a login button is a review-blocking smell. [Evidence: E004, E010]**

## 5. RED LINE — leaking the access token or client secret to the frontend [Evidence: E011, E012]

- **Symptom**: the GitHub access token or `client_secret` appears in a browser bundle, a `NEXT_PUBLIC_`-prefixed variable, a client-readable API response, a URL, or a log line.
- **Why**: the confidential-client model keeps these server-side; a public client cannot hold a secret (auth-core §1, §6). [Evidence: E011, E012]
- **The rule: the token exchange and all GitHub API calls happen on the backend; the token and secret never cross to the frontend, never enter a URL, and are redacted at the logging layer, so the frontend only ever holds the backend's own httpOnly session cookie. [Evidence: E011, E012]**

## 6. Conflating GitHub login identity with the app's publishing identity

- **Symptom**: authorization, ownership, or display of published artifacts keys on the GitHub `login`; a rename or an impersonating handle then reassigns or spoofs authority.
- **Why**: the login identity (who authenticated) was treated as the publishing identity (who acts inside the product), collapsing two distinct concepts. [Evidence: E012]
- **The rule: authorization and publishing resolve through the locked, platform-owned `publisher_slug` and never the mutable GitHub handle; keep the GitHub identity and the `publisher_slug` as separate, linked records. [Evidence: E006, E012]**

## 7. Mis-registered callback URL diagnosed as an app bug

- **Symptom**: sign-in fails at the redirect with a GitHub error before your callback code runs; time is lost debugging application logic.
- **Why**: the `redirect_uri` did not satisfy GitHub's rule — host/port must match the registered callback exactly and the path must be that path or a subdirectory, and a dev host/port or a stray path breaks it. [Evidence: E009]
- **The rule: before debugging code, confirm the `redirect_uri` matches the app's registered callback under GitHub's host/port/subpath rule, register each environment (or use a dedicated dev OAuth App), and record which callback is registered where. [Evidence: E009]**

## 8. Expecting a refresh token that an OAuth App does not issue

- **Symptom**: dead code paths built to "refresh the GitHub token", or a returning-user experience designed around a GitHub token expiry that does not happen.
- **Why**: OAuth App tokens do not expire on their own and the web flow returns no refresh token (that is a GitHub App property). [Evidence: E007, E010]
- **The rule: manage session lifetime with your own session/refresh per auth-core and do not build GitHub-token refresh logic for an OAuth App; if you genuinely need short-lived provider tokens with refresh, that is the GitHub App decision (overview §1), not a workaround. [Evidence: E007, E010]**
