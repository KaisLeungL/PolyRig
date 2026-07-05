# GitHub sign-in — architecture decisions (provider-level, stack-agnostic)

This pack layers GitHub specifics on top of `domain/auth-core`. The
provider-agnostic material — flow selection by client type, the `state`/CSRF
rule, session strategy, token roles, secure storage by platform class, the
separate-user-and-identity data model, provisioning-race safety — is stated
ONCE in auth-core and applies here. This file covers only what is specific to
GitHub, and it is explicit about the ONE place where GitHub departs from
auth-core's default federation shape.

## 0. The departure to internalize first

auth-core §2 describes the common federated shape: a client obtains a signed
**identity token** (an OIDC ID token) and sends it to your backend, which
verifies the signature and the `iss`/`aud`/`exp`/`nonce` claims. GitHub is
different:

**A GitHub OAuth App is not OpenID Connect and issues no ID token — there is no signed identity assertion to verify. [Evidence: E001, E003]**

- Your **backend is the OAuth client** (a confidential client, per auth-core §1). It receives the callback `code`, exchanges it for an opaque **access token**, and then learns *who the user is* by calling `GET /user` with that token. [Evidence: E001, E003]
- **Never derive identity by inspecting the access token itself — it is opaque; identity comes from your backend's own authenticated `GET /user` call over TLS, and the token is an API credential, not an identity assertion. [Evidence: E001, E003]**

What still applies verbatim from auth-core: the `state`/CSRF rule on the
callback, redirect-URI discipline, session strategy and storage, the "provider
token is an input, not your session" principle, and the separate-user/identity
data model. What does not apply here: JWT signature verification, `aud`/`nonce`
checks, and JWKS caching — there is no ID token to run them against.

**Do not import an OIDC verifier and point it at GitHub — that is a category error; secure this flow with `state` and TLS, not token verification. [Evidence: E001, E003]**

## 1. Which GitHub app type (a decision, not a given)

GitHub offers two integration types for "sign in with GitHub". Choose
deliberately and record the choice:

- **OAuth App** — authorized by the user; the token acts as the user and is scoped by coarse **OAuth scopes**. Its tokens stay active until revoked (no built-in expiry, no refresh token in the web flow). [Evidence: E007, E010]
- **GitHub App** — *installed* rather than authorized; uses **fine-grained permissions**, can act independently of any user, and its user access tokens expire and are renewed with a refresh token. [Evidence: E007, E010]

**Default for a pure login feature: the OAuth App.** It is the simpler surface
when all you need is "authenticate this person and read their public profile +
email". Reach for a GitHub App when the product needs fine-grained
repository/organization permissions, short-lived tokens with refresh, or an app
identity that can act without a user present.

**Do not hardcode "GitHub = OAuth App" as lore — if the requirement grows into scoped resource access, that is a migration decision resolved against the current official docs via this pack's `deps.yaml`. [Evidence: E007, E010]**

## 2. The golden-path flow (browser + your backend as the client)

1. The browser hits your backend's "start sign-in" route. The backend redirects to GitHub's **authorize** endpoint with `client_id`, `redirect_uri`, the minimal `scope` (§4), and a fresh, session-bound `state`. [Evidence: E001, E002]
2. The user authorizes on GitHub. GitHub redirects back to your registered callback with a short-lived `code` (expires in ~10 minutes) and the same `state`. [Evidence: E001]
3. The backend checks `state` against the value it bound to this browser session (constant-time, single-use); on any mismatch or absence it aborts with no session side effect (auth-core CSRF rule). [Evidence: E002]
4. The backend POSTs to GitHub's **access-token** endpoint with `client_id`, `client_secret`, `code`, and `redirect_uri`, sending `Accept: application/json` so the response is JSON rather than a URL-encoded query string. [Evidence: E001]
5. The backend calls `GET /user` (and `GET /user/emails` when it needs a verified email — §5) with the access token to obtain the identity. [Evidence: E001, E005]
6. The backend provisions/looks up the local user by GitHub's **numeric user id** (§3) and issues its own session per auth-core. GitHub's involvement ends once identity is read. [Evidence: E011]

**The frontend never participates in the token exchange and never sees the GitHub access token; in a Next.js + FastAPI split every step above lives in the FastAPI backend, and the browser only follows redirects and finally carries the backend's own session cookie. [Evidence: E011, E012]**

## 3. Identity key — the numeric user id, not the login

GitHub's stable identifier for an account is its **numeric `id`**. The `login`
(username) is mutable: a user can rename, and the old username is then released
for anyone else to claim. [Evidence: E006] Keying local users on `login`
therefore enables silent account confusion or takeover — exactly the failure
auth-core's identity model warns about with email.

- Store GitHub's numeric `id` as the immutable federated key — the GitHub analog of auth-core's `(iss, sub)`, where the issuer is constant so the numeric id carries the identity. [Evidence: E006]
- **Persist `login` only as a display attribute, refresh it on each sign-in, and never match on it. [Evidence: E006]**
- Model local user and GitHub identity as separate rows as auth-core prescribes, with a uniqueness constraint on the GitHub numeric id so concurrent first sign-ins converge on one user (auth-core provisioning-race rule). [Evidence: E011]

## 4. Scopes — minimal, and incremental if more is ever needed

- Requesting no scope already returns read-only access to public profile information; for a login that only needs a public profile, request no scope at all, and to read email addresses request the narrow `user:email` scope and nothing broader. [Evidence: E004]
- **Do not request the `user` scope (it bundles write access and follow) or any `repo` scope for sign-in. [Evidence: E004]**
- Sign-in is authentication, not resource access. If a later feature needs repository or organization data, request that scope at the moment the feature needs it (incremental authorization) and design the feature to degrade when the grant is refused. [Evidence: E004, E010]
- **Never inflate the sign-in consent screen to pre-acquire scopes "just in case" — a growing scope list is a signal to re-evaluate OAuth App vs GitHub App (§1). [Evidence: E004, E010]**

## 5. Email is optional, private-able, and not the key

- `GET /user` returns an `email` that is `null` when the user has no public email set — a very common case. [Evidence: E005]
- **Do not assume sign-in yields an email. [Evidence: E005]**
- To reliably obtain an email, call `GET /user/emails` with the `user:email` scope; it returns each address with `primary` and `verified` flags. [Evidence: E004, E005]
- **Use only a `verified` address, prefer the `primary` one, and treat email as a display attribute and never the identity key (auth-core: email is re-assignable and unverifiable in general). [Evidence: E004, E005]**
- If the product needs an email and the account exposes none verified, that is a product decision (prompt the user, or proceed without) — not a reason to accept an unverified address as identity.

## 6. Token custody, expiry, and revocation

- The GitHub **access token is a server-side secret** in the confidential-client model, and so is the **client secret** used in the token exchange. [Evidence: E011, E012]
- **The access token and client secret never travel to the frontend, never land in a URL or log, and are stored — only if kept at all — under auth-core's server-secret rules. [Evidence: E011, E012]**
- **OAuth App tokens do not expire on their own and there is no refresh token in the web flow. [Evidence: E007]** Consequently, auth-core's refresh-rotation and reuse-detection guidance applies to your own session, not to any GitHub token — there is nothing to rotate on GitHub's side for an OAuth App.
- Revocation is explicit and server-driven: GitHub exposes app-token endpoints to revoke a single token (`DELETE /applications/{client_id}/token`) and to delete the whole grant (`DELETE /applications/{client_id}/grant`), the latter invalidating all of that user's tokens for the app. [Evidence: E008]
- A user can also revoke the app from their GitHub account settings. Design your logout as auth-core demands — kill your session server-side — and decide explicitly whether logout should also revoke the GitHub grant (usually not, but state it either way).

## 7. Login identity is not publishing identity (`publisher_slug`)

Every "sign in with a third-party provider" feature faces this, made concrete by
this platform's registry: the identity a user authenticates with is not
automatically the identity they act under inside your product. [Evidence: E012]

- GitHub sign-in establishes who is at the keyboard (a numeric GitHub id and a current `login`). The platform's publishing identity is a separate, platform-owned `publisher_slug` that the user confirms/creates after first login and that is then locked. [Evidence: E012]
- Keep the two mappings distinct: `user` rows carry the external GitHub identity, while a separate `publisher` row carries the locked `publisher_slug` bound to that user. [Evidence: E012]
- **Never render or key authorization on the GitHub `login` as if it were the publishing identity — the `login` can change (§3) while the `publisher_slug` must not. [Evidence: E006, E012]**
- **Displaying "signed in as GitHub @handle" is fine as provenance, but granting publish/ownership rights must resolve through the locked `publisher_slug`, not the mutable handle — this keeps impersonation and rename churn out of the authorization path. [Evidence: E012]**

## 8. Constraints that gate testing and rollout

- **Callback URL registration.** GitHub validates the `redirect_uri` against the app's registered callback URL. **Host (excluding sub-domains) and port must match exactly, and the path must be the registered path or a subdirectory of it. [Evidence: E009]** A build on a different host/port than the registered callback fails before your code runs — register each environment's callback (or use a dedicated dev OAuth App). This is stricter than pointing anywhere and looser than auth-core's exact full-URI-match default, so know the actual subdirectory rule to neither over-trust nor mis-diagnose.
- **One OAuth App per trust boundary.** The `client_id`/`client_secret` pair identifies your app. **The secret is environment-injected and never defaulted (auth-core server-secret rule), and a missing secret or expected-callback config must fail startup rather than silently degrade. [Evidence: E011, E012]**

Both constraints belong in the verification route — see this pack's `verify.md`,
which extends the auth-core checklist.
