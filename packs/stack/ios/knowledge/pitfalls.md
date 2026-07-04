# stack/ios — Pitfalls and red lines

Known traps for agents implementing iOS features. Each item states the symptom,
why it happens, and the rule to apply.

## RED LINE: signing secrets and provisioning material [Evidence: E009, E012]

Symptom: a `.p12`, private key, provisioning profile, API token, App Store
Connect key, or CI signing password appears in version control. This usually
happens because local Xcode signing worked and someone copied the same material
into the repo or CI config. Rule: signing secrets and credentials stay in the
developer account, keychain, CI secret store, or other approved secret manager;
commit only the build settings and documentation needed to locate them.
[Evidence: E009, E012]

## RED LINE: privacy declarations after the feature is built [Evidence: E007, E011]

Symptom: upload or review fails late because the app or a third-party SDK uses
collected data, tracking domains, or required-reason APIs that were not declared [Evidence: E007, E011]
in the privacy manifest or App Store privacy answers. Rule: privacy manifests,
purpose strings, and data-use declarations are part of feature design and
release verification, not a final upload chore. [Evidence: E007, E011]

## RED LINE: storing sensitive data in ordinary app storage [Evidence: E012]

Symptom: tokens, session material, private user data, or cryptographic keys are
written to UserDefaults, logs, caches, documents, screenshots, or crash
attachments for convenience. Rule: sensitive data storage needs an explicit
storage decision, usually Keychain or encrypted storage with keys protected by
platform facilities; logs and crash reports should redact secrets before they
leave the process. [Evidence: E012]

## SwiftUI identity and state reset

Symptom: a screen loses draft input, repeats network requests, jumps scroll
position, or replays alerts when a parent view changes. The cause is often a
misunderstood view identity boundary or model object created at the wrong
lifetime. Rule: keep durable model state outside ephemeral view values, make
identity explicit in lists/navigation, and test re-rendering paths rather than
only the first happy render. [Evidence: E002]

## MainActor and callback confusion

Symptom: intermittent UI warnings, data races, or state updates arriving after a
screen has disappeared. Legacy callbacks, delegates, Combine pipelines, and
async tasks may resume on different executors. Rule: isolate UI-facing state to
the main actor, cross concurrency boundaries with safe values, and make
cancellation ownership explicit. [Evidence: E003]

## "Works in debug, fails in archive or TestFlight"

Symptom: the app runs from Xcode but fails after archiving, installing on a real
device, or uploading. Common causes are bundle ID / entitlement mismatches,
missing capabilities, resource packaging differences, App Store Connect
metadata gaps, privacy manifest issues, or release-only optimization behavior.
Rule: user-facing features need a release-style verification route before they
are called done. [Evidence: E006, E007, E009]

## Simulator-only confidence

Symptom: a feature passes on Simulator and fails on hardware. The Simulator does
not faithfully represent every camera, push notification, biometric, background
execution, sensor, Bluetooth, networking, performance, or App Store distribution
condition. Rule: features touching device capabilities, credentials, push,
background work, camera, sensors, or performance need at least one physical
device smoke check. [Evidence: E004, E006]

## App Review as a late-stage surprise

Symptom: a technically working feature is rejected because it violates review
guidelines, uses unclear permissions, presents misleading metadata, or ships
unfinished content. Rule: user-facing policy-sensitive features should check App
Review guidance before implementation and again before release notes are final.
[Evidence: E011]
