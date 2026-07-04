# stack/android — Verification routes

**Rule: a feature is not done until the relevant route below passes.** Never [Evidence: E017, E004, E011]
set a feature to `verified` in `feature_list.json` on the strength of "it
compiles" or a debug-only run. Record which routes ran and their outcomes in
the feature's verification notes.

## Automated routes (run from the project root)

1. **Full build** — `./gradlew build`
   Compiles all variants and runs lint + unit tests as configured. On large
   projects, `./gradlew assembleDebug assembleRelease` is an acceptable
   faster substitute for compile verification, but `build` is the default.
   The release variant must compile with minification enabled — a feature [Evidence: E004, E011]
   that only builds on debug fails this route (see pitfalls: R8 keep rules).

2. **Lint** — `./gradlew lint`
   Zero new errors. Do not suppress a lint error to pass; either fix it or [Evidence: E021]
   document a reviewed baseline entry with justification.

3. **Unit tests** — `./gradlew test`
   All local JVM tests pass. New logic in ViewModels, repositories, and
   mappers must arrive with unit tests; a feature whose logic is untestable [Evidence: E017, E006]
   without a device is a design smell (see overview: architecture defaults).

4. **Instrumented tests** — `./gradlew connectedCheck`
   Requires a connected device or running emulator; verify one is available
   first (`adb devices` shows a `device`-state entry) — otherwise the task
   fails for environmental reasons, which is not a feature failure.
   When it is REQUIRED (not optional) for a feature: [Evidence: E017]
   - the feature touches UI navigation, permissions, or lifecycle behavior;
   - the feature depends on device capabilities (storage, camera, biometrics,
     notifications, background work);
   - the feature has Compose UI tests or Espresso tests attached to its
     acceptance criteria.
   For pure logic changes fully covered by unit tests, connectedCheck may be
   skipped — state that decision explicitly in the feature notes.

## Manual smoke check (after automated routes pass)

Run on a device or emulator, using the **release/minified variant** when the
feature is user-facing:

- [ ] Install cleanly (`./gradlew installDebug` or install the release APK)
      and cold-launch the app — no crash, no blank first frame.
- [ ] Exercise the feature's core flow end to end as a user would, including
      the failure path (no network, denied permission) where applicable.
- [ ] Rotate the device on every new/changed screen — state, scroll position,
      and in-progress input survive; no duplicated one-shot effects.
- [ ] Process-death spot check: background the app, kill the process (via
      "Don't keep activities" or `adb shell am kill <package>`), return —
      the screen restores instead of crashing or blanking.
- [ ] If the feature adds a deep link or notification entry: enter through
      it and verify the back-press path lands somewhere sensible.

## Environment failure vs feature failure

If a route fails because of missing SDK components, an unavailable emulator,
or a Gradle/AGP/Kotlin/JDK mismatch, fix the environment (see deps.yaml
lookups for the compatibility matrix) — do not weaken the route, and do not [Evidence: E017, E003]
mark the feature verified with a note that "tests couldn't run".
