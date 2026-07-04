# Google Sign-In — architecture decisions (provider-level, stack-agnostic)

This pack layers Google specifics on top of `domain/auth-core`. Everything
provider-agnostic — flow selection, token roles, session strategy, the
server-side verification red line, state/nonce rules, (iss, sub) identity
modeling — is stated ONCE in the auth-core knowledge and applies here
unchanged. This file covers only what is specific to Google as a provider.

## 1. Which Google integration surface (a decision, not a given)

Google has repeatedly replaced its sign-in client APIs. The landscape splits
into two eras:

- **Legacy GoogleSignIn-style APIs** (Play-services sign-in client): an
  app-driven "launch the Google account picker" call that historically mixed
  authentication (who is this user) and authorization (grant my app scopes)
  in one API. Google has deprecated this surface and has announced removal
  from the Play services auth SDK.
- **The Google Identity Services / credential-manager era**: sign-in is
  mediated by the platform's credential-manager layer. The app asks the
  platform for a Google credential; the platform renders one-tap-style UI
  (bottom-sheet account choice, returning-user auto sign-in) and hands back
  an ID-token-bearing credential. Authentication and authorization are
  **separate API surfaces**: sign-in yields identity only; Google-API scope
  grants go through a distinct authorization call.

**The rule: never hardcode an era in a design doc or in code review lore.
Use whatever surface Google currently recommends, and determine that surface
by executing the lookups in this pack's `deps.yaml` at assembly time** —
official Android identity docs first. If a codebase or tutorial you are
imitating uses a deprecated surface, that is a migration flag, not a pattern
to copy. The conceptual shift to internalize: sign-in is a *credential
request to the platform*, not a Google-SDK-owned activity flow, and
"sign in" no longer implies "granted scopes".

## 2. OAuth client ID topology — the classic confusion

A Google Cloud Console project holds **multiple OAuth 2.0 client IDs of
different types**, all representing the same logical app:

- **Web client ID** ("web application" type). Not just for websites: it
  identifies your **backend** as an OAuth client.
- **Android client ID**: bound to a package name **plus a signing-certificate
  fingerprint**. It exists so Google can verify which APK is asking; your
  code mostly never handles this ID directly.
- **iOS client ID**: bound to a bundle ID (out of scope for this pack's
  stacks, listed for the topology).

The trap that breaks most first integrations: **the audience (`aud`) of the
ID token your backend verifies is the WEB client ID — even when the token was
obtained on Android.** The Android client requests a token *addressed to your
backend*, so it passes the web client ID as the "server client ID" parameter
in the credential request; the Android client ID (with its fingerprint
binding) is how Google authenticates the requesting APK, and it may appear in
other claims but is not the audience your server checks. Backend config
therefore needs the web client ID; the Android app also needs the web client
ID (to request tokens for the backend); nobody needs the Android client ID in
code — it must merely exist and be correctly configured in the console.

All client IDs live in one Google Cloud Console project, alongside the OAuth
consent screen configuration that governs them all. Client IDs are
identifiers, not secrets — but the web client's **secret** (if one exists) is
a real secret under auth-core's storage rules.

## 3. The golden-path flow (Android app + your backend)

1. The Android app requests a Google credential via the current
   platform-recommended surface and obtains a **Google ID token** whose
   audience is your web client ID (nonce included in the request when the
   surface supports it).
2. The app POSTs that token to your backend's sign-in endpoint over TLS.
3. The backend verifies it exactly as auth-core §2 demands — signature
   against **Google's published JWKS**, plus `iss`, `aud` (= web client ID),
   `exp`, and `nonce` — using Google's key endpoint with bounded caching
   (auth-core JWKS rules apply verbatim).
4. On success the backend provisions/looks up the local user by (iss, sub)
   and issues **its own session**. Session mechanics — stateful vs stateless,
   refresh, rotation, storage — are entirely auth-core territory; Google's
   involvement ends once the ID token is verified and consumed.

The Google ID token is proof of authentication, consumed once at sign-in.
Per auth-core's red line it is never a session credential, never accepted on
ordinary endpoints, and never trusted without server-side verification.

## 4. Consent, scopes, and incremental authorization

- **Sign-in needs identity only.** Requesting Google-API scopes (Drive,
  Calendar, contacts) at sign-in inflates the consent screen and tanks
  conversion. Ask for a scope at the moment the feature needs it
  (incremental authorization), and design every such feature to degrade
  gracefully when the grant is refused — users can approve scopes
  individually.
- **Server-side access to Google APIs is a separate decision from sign-in.**
  If your backend must call Google APIs while the user is offline, that
  requires an authorization-code flow producing a **Google refresh token
  held by your server** — a distinct grant, a distinct API surface, and a
  distinct threat model (you now custody long-lived Google credentials).
  Do not smuggle it into the sign-in design; if the product needs it, spec
  it as its own feature with its own verification route.

## 5. Constraints that gate testing and rollout

Two Google-side registrations silently decide who can sign in at all:

- **Signing-certificate fingerprints (Android).** Each Android client ID is
  bound to SHA-1/SHA-256 fingerprints of the APK's signing certificate.
  Debug builds, local release builds, and Play-distributed builds are
  typically signed with **different** keys, so each needs its fingerprint
  registered. This is the root cause of the "works in debug, fails in
  release" sign-in failure class (stack details in the per-stack notes).
- **OAuth consent screen publishing status.** While the consent screen is in
  *testing* status, only explicitly listed test users can complete sign-in
  — everyone else fails in ways that look like an app bug. Moving to
  *production* status may require Google verification (especially with
  sensitive scopes) and lifts the restriction. Check the status before
  debugging "user X cannot sign in", and record the status plus the test-user
  list in the project's docs while in testing.

Both constraints must be reflected in the verification route: see this
pack's `verify.md`, which extends the auth-core checklist.
