# stack/ios — Verification routes

**Rule: a feature is not done until the relevant route below passes.** Record
which routes ran, the selected scheme/destination, and the outcome in the
feature's verification notes. [Evidence: E010, E006]

## Automated routes

1. **Project discovery** — `xcodebuild -list -json -project <App>.xcodeproj` or
   `xcodebuild -list -json -workspace <App>.xcworkspace`
   Confirm the scheme and test targets before running build or test commands.
   [Evidence: E001, E010]

2. **Build** — `xcodebuild build -scheme <Scheme> -destination 'platform=iOS Simulator,name=<Device>'`
   The build should pass from a clean checkout with documented local
   prerequisites. If the feature changes signing, entitlements, resources,
   privacy manifests, or release behavior, also run an archive or release-style
   build route. [Evidence: E006, E007, E009]

3. **Unit tests** — `xcodebuild test -scheme <Scheme> -destination 'platform=iOS Simulator,name=<Device>'`
   New deterministic logic should have unit coverage. If the repository is a
   Swift package rather than an app target, use `swift test` for package logic
   and keep app integration checks separate. [Evidence: E008, E010]

4. **UI tests** — run the project's XCUITest target or test plan for changed
   user flows. UI automation is especially important for navigation, permission
   prompts, deep links, onboarding, purchase, auth, and destructive actions.
   [Evidence: E010]

5. **Static/project checks** — run the project's configured formatter, linter,
   analyzer, or CI script when present. This pack does not mandate a specific
   lint tool; use the tool already adopted by the repository. [Evidence: E013]

## Manual smoke checks

- [ ] Launch on the chosen simulator and exercise the changed flow end to end,
      including an error or empty state where applicable. [Evidence: E004, E010]
- [ ] If the feature touches camera, push notifications, biometrics, Bluetooth,
      sensors, background work, credentials, or performance, run the smoke check
      on at least one physical device. [Evidence: E004, E006]
- [ ] Background and foreground the app during the flow. Draft data, route
      state, task cancellation, and resumed UI should match the product
      decision. [Evidence: E004]
- [ ] If permissions are requested, verify the prompt timing, purpose string,
      denial path, Settings recovery path, and privacy copy. [Evidence: E005,
      E007]
- [ ] If the feature stores or transmits sensitive data, inspect storage,
      logs, crash/report attachments, screenshots, and network traces for leaks.
      [Evidence: E012]
- [ ] For release-facing changes, archive or create a release-style build and
      inspect signing, entitlements, privacy manifests, App Store metadata, and
      App Review-sensitive behavior. [Evidence: E006, E007, E009, E011]

## Environment failure vs feature failure

If a route fails because Xcode, simulator runtimes, signing assets, or developer
portal access are unavailable, fix or document the environment issue; do not [Evidence: E001, E006, E009]
weaken the route or claim the feature passed. [Evidence: E001, E006, E009]
