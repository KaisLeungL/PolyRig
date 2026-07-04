# Google Sign-In on Android — implementation decisions

Assumes the `stack/android` conventions (Compose-first, UDF, ViewModel as
screen state holder, repository boundary) and the provider-level decisions in
this pack's `overview.md`. Auth-core rules apply throughout.

## Integration surface

- Default posture: **the Credential Manager-based Google sign-in surface** —
  the app requests a Google credential through the platform credential
  manager and receives an ID-token-bearing credential. The legacy
  GoogleSignIn client is deprecated; treat any code sample using it as a
  migration source, not a template.
- **Verify the current artifacts via this pack's `deps.yaml` lookups before
  adding dependencies** (credential-manager runtime, its Play-services
  integration, and the Google ID credential library). Record the resolved
  set in `deps.resolved.md`. Add them through the version catalog per the
  stack pack's Gradle conventions.
- Authentication and authorization are separate surfaces in this era: the
  sign-in credential carries identity only. If a feature later needs Google
  API scopes, that is a separate authorization call and a separate design
  decision (overview §4) — do not bolt scope requests onto sign-in.

## Where sign-in lives architecturally

- **Credential retrieval belongs in a data-layer auth repository**, not in a
  composable and not in the ViewModel. The repository owns: building the
  credential request (with the web client ID as the server client ID and a
  fresh nonce), invoking the credential manager, parsing the returned
  credential into a domain-level result, and the backend token exchange.
- The credential-manager call requires an **Activity context** for its UI.
  Pass it as a method parameter at the call site; never store a Context in
  the ViewModel or repository (stack rule: state classes stay
  framework-free).
- The **ViewModel orchestrates**: it exposes a single immutable auth UI
  state (idle / in-progress / signed-in / error-with-kind) and dispatches the
  sign-in event to the repository. The UI observes state and renders; it
  never touches credential APIs directly.

## Debug vs release fingerprints — the top failure class

- Each build signing key has its own SHA-1/SHA-256 fingerprint, and the
  Google console must know **every fingerprint that will ever request a
  credential**: the debug keystore's, any local release keystore's, and —
  critically — with **Play App Signing, the release fingerprint is Google's
  app-signing key shown in the Play Console**, not your local upload
  keystore. A release build that signs in fine from a local install can
  still fail once distributed through Play if only the upload key was
  registered.
- Symptom of a missing/wrong fingerprint: sign-in fails with a generic
  "no credential available" or developer-error-class failure, with nothing
  useful in the app's own logs. Before debugging code, diff the installed
  APK's signing fingerprint against the console registration.
- Verification is per-fingerprint: the verify checklist requires proving
  sign-in on debug AND release signing, because they are different
  registrations that fail independently.

## Handling the token and the states

- **The Google ID token is transported, not stored.** Send it to the
  backend's sign-in endpoint over TLS immediately and discard it. The
  credential your app persists is the **backend-issued session**, stored per
  auth-core's mobile rules (keystore-class storage for refresh material).
  Never treat "I still hold a Google ID token" as "signed in".
- Credential-manager flows have **expected non-error outcomes** that must be
  modeled explicitly in UI state, not funneled into a generic failure toast:
  the user dismissing the one-tap sheet (cancellation) and the device having
  no eligible credential/account. Both should return the UI to a calm
  signed-out state with the manual sign-in affordance still available —
  never an error banner, never an automatic retry loop (repeated one-tap
  prompts get rate-limited/suppressed by the platform).

## Error-state map

| State | Likely cause | Diagnostic rule |
|---|---|---|
| Developer-error / no credential despite accounts existing | Fingerprint not registered for THIS build's signing key, or wrong/missing web client ID in the request | Compare installed-APK fingerprint with console registration; confirm the server client ID is the WEB client ID, not the Android one |
| Cancelled | User dismissed the sheet | Not an error: return to signed-out state, keep manual entry point, no retry loop |
| No Google account on device | Device/profile has no eligible account | Offer add-account guidance or an alternative sign-in method; do not present as app failure |
| Network failure | Offline or Google endpoint unreachable | Retryable error state with explicit retry action; distinguish from developer-error in state modeling |
| Backend rejects a token the app just obtained | Audience mismatch (backend expects a different client ID) or backend clock/JWKS issue | Fix configuration, never widen backend validation; see backend notes |

The first row is the one that burns days: it presents as a runtime failure
but is a **configuration** failure, invisible in code. Write the diagnostic
into the project docs so a fresh session checks configuration first.
