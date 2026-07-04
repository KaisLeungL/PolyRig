# stack/ios — Overview (decision guidance)

Slow-changing architecture guidance for building iOS apps. No Xcode, Swift, iOS
SDK, or package versions appear here by design: volatile facts are resolved via
`deps.yaml` lookup strategies at assembly time and recorded in the target
project's `deps.resolved.md`.

## Project shape: start with one app target

Default to one iOS app target plus its test targets for a new product. Extra
framework targets, local Swift packages, app extensions, widgets, or companion
targets are costs that need a product or build boundary to justify them.
[Evidence: E001, E008]

Add another target or local package when at least one of these is true:

- The code ships as a separate artifact, extension, widget, framework, or
  reusable module.
- A team or agent needs a compiler-enforced ownership boundary.
- Build times or test scope are painful and the split maps to a real feature or
  platform layer.
- The code has to be reused by another Apple-platform app.

For small apps, folder boundaries are enough:

```text
App/                 # app entry, scene setup, dependency composition
Features/<name>/     # screen flows: views, state holders, feature services
Core/<capability>/   # shared networking, persistence, design system, auth
Resources/           # assets, localized strings, privacy manifests
Tests/               # unit and integration tests
UITests/             # user-flow automation
```

Split only after the folder boundary becomes a real compile, ownership, or
distribution boundary.

## UI stack decision

SwiftUI is the default for new screens when the deployment target and product
requirements fit it. It gives the project a declarative UI model and native
state-driven rendering path. [Evidence: E002, E004]

UIKit is justified when the app is maintaining an existing UIKit flow, embedding
a UIKit-only SDK/control, doing highly specialized text/input/layout work, or
needs a mature API surface that SwiftUI cannot yet cover cleanly. Wrap that
choice behind a small boundary (`UIViewControllerRepresentable`,
`UIViewRepresentable`, or a UIKit coordinator), and keep one owner for each
screen's state. [Evidence: E002]

Avoid mixing SwiftUI and UIKit at arbitrary depths. Hybrid screens are
acceptable, but the bridge should be explicit and shallow so lifecycle, focus,
navigation, and state ownership stay reviewable. [Evidence: E002, E004]

## State, data flow, and model ownership

Choose one source of truth per screen or flow. SwiftUI views should own local,
ephemeral view state; shared or long-lived model state belongs in observable
model objects, services, actors, or persistence layers that outlive individual
view reinitialization. [Evidence: E002]

Keep UI state small and serializable where possible. A screen should be
reconstructable from route arguments, persisted model data, and explicit draft
state, not from incidental singleton memory. This makes scene restoration,
process restarts, previews, and tests tractable. [Evidence: E004, E010]

Side effects live outside view body construction. Network calls, persistence,
analytics, and navigation decisions should happen in task handlers, actions,
view models, services, or coordinators, not as a consequence of recomputing a
view body. [Evidence: E002, E003]

## Concurrency posture

Use Swift structured concurrency for asynchronous work. UI-facing state changes
should be isolated to the main actor, and cross-domain data should be safe to
send between concurrency domains. [Evidence: E003]

Prefer cancellation-aware tasks tied to the lifecycle of the feature. A request
started by a screen should cancel when the screen or task owner disappears
unless the product explicitly needs background continuation. Detached tasks and
unstructured callbacks need a documented ownership reason. [Evidence: E003,
E004]

## App lifecycle, permissions, and platform behavior

Treat foreground, background, inactive, and termination transitions as real user
paths. Persist drafts or route state before relying on in-memory state, and test
returning from background for any flow that edits data, uses camera/location,
or depends on network reachability. [Evidence: E004, E010]

Ask for permissions in context and only after the user intent is clear. Purpose
strings and privacy copy are product behavior, not boilerplate; they should
match the feature's actual data use and failure path. [Evidence: E005, E007,
E011]

## Dependencies and third-party SDKs

Prefer Swift Package Manager for source dependencies when the package is
compatible with the project and reviewable. Binary SDKs raise privacy, signing,
debuggability, and supply-chain costs; add them only when a source dependency or
first-party API cannot satisfy the feature. [Evidence: E008, E007]

Every added SDK should have an owner, a reason, a removal path, and a current
privacy-manifest / App Store compliance check. Dependency coordinates and
toolchain compatibility are resolved via `deps.yaml`, not by memory. [Evidence:
E007, E012]

## Signing, entitlements, and distribution

Use Xcode capabilities and the Apple Developer portal as the source of truth for
entitlements and provisioning. Entitlement files, App IDs, bundle IDs, app
groups, keychain access groups, and provisioning profiles have to agree; a
signing error is usually a mismatch among those surfaces, not a random build
problem. [Evidence: E009]

Development signing proves local/debug deployability. Release readiness requires
an archive or release-style build path, TestFlight/App Store preparation, and
review of privacy manifests, App Store metadata, and App Review constraints.
[Evidence: E006, E007, E011]
