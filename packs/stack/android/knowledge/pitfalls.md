# stack/android — Pitfalls and red lines

Known traps for agents implementing features on this stack. Format per item:
symptom, why it happens, the rule. Items marked **RED LINE** are security [Evidence: E009, E010]
rules that must never be violated regardless of convenience. [Evidence: E009, E010]

## RED LINE: keystore and signing hygiene [Evidence: E009]

Symptom: a release keystore, `key.properties`, or a `signingConfig` block with
plaintext passwords appears in version control. This happens because signing
setup tutorials show inline credentials and the debug flow "just works". A
leaked upload/signing key is unrevocable identity for the app. Rule: keystores
and their passwords never enter VCS. [Evidence: E009] Load them from environment variables or a
gitignored `gradle.properties`/`key.properties` file referenced by path; commit
only the *reading* logic. Add keystore file patterns to `.gitignore` in the
same change that introduces signing.

## RED LINE: secrets in BuildConfig, resources, or manifest [Evidence: E010]

Symptom: API keys, tokens, or backend secrets placed in `BuildConfig` fields,
`strings.xml`, or manifest metadata "so the app can use them". Anything
compiled into an APK is extractable in minutes; obfuscation does not change
this. Rule: an APK may only carry values you accept as public (e.g. a
rate-limited client ID designed for embedding). Real secrets stay server-side;
the app authenticates a *user or install*, and the server holds the secret.
Never commit even "public" keys with write scopes. [Evidence: E010]

## R8/ProGuard keep-rule traps

Symptom: release build crashes with `ClassNotFoundException`,
`NoSuchMethodException`, or silently-empty JSON models, while debug is fine.
Minification strips or renames anything reached only via reflection —
serializers, JNI, `Class.forName`, XML-referenced classes. Rule: every
reflection-dependent library needs its consumer keep rules verified;
every hand-written keep rule needs a comment saying *why*. [Evidence: E011] Never "fix" a
release crash with `-dontobfuscate`/`-dontshrink` blanket rules — find the
missing keep target. Broad `-keep class com.example.** { *; }` rules are debt.

## "Works in debug, breaks in release"

Symptom: the whole class of bugs that only appear minified: keep-rule gaps
(above), debug-only code paths (`if (BuildConfig.DEBUG)` guarding real logic),
resource shrinking removing dynamically-referenced resources, and different
network security config. Rule: the verification route includes building and
smoke-testing the **minified release variant** before a feature is called
done. A feature verified only on debug is not verified.

## Main-thread I/O and StrictMode

Symptom: jank, ANRs, or an app that feels fine on a flagship and freezes on a
mid-range device. Disk and network calls on the main thread often "work" in
development because dev hardware and emulators are fast. Rule: all I/O goes
through coroutines on an appropriate dispatcher (IO for blocking I/O); enable
StrictMode with death-on-violation in debug builds from day one so violations
surface during development, not in production ANR dashboards.

## Process death and state restoration

Symptom: crash or blank screen when returning to the app after backgrounding —
often unreproducible in normal testing. The OS kills backgrounded processes
freely; ViewModels do NOT survive process death; [Evidence: E013] only `SavedStateHandle` /
saved-instance-state and persistent storage do. Rule: any state needed to
reconstruct the current screen (IDs, form input, navigation arguments) must be in `SavedStateHandle` or persisted; [Evidence: E013]
never assume an in-memory singleton or ViewModel field is still populated on re-entry. [Evidence: E013]
Test with the developer
option "Don't keep activities" or by killing the process while backgrounded.

## Back stack and deep-link traps

Symptom: pressing back from a deep-linked screen exits the app or lands on a
wrong screen; duplicate screen instances stack up; predictive back behaves
inconsistently. Deep links synthesize a back stack that differs from organic
navigation, and ad-hoc launch flags fight the navigation library. Rule: define
one navigation graph as the single owner of back-stack behavior; declare deep
links in that graph rather than juggling intent flags; explicitly test the
back-press path from every deep-link entry point. Do not intercept back with legacy key handling — use the navigation library's supported back APIs so [Evidence: E014]
predictive back keeps working.

## Dependency bloat and transitive version conflicts

Symptom: duplicate-class build failures, runtime `NoSuchMethodError` from a
library resolving against a different transitive version than it was built
with, and APK size creep. Gradle picks the highest version in a conflict,
which can silently break a library's assumptions. Rule: use BOMs (platform
imports) wherever a library family publishes one, so the family stays
internally consistent; declare every directly-used dependency explicitly
instead of leaning on transitives; before adding a new library, check whether
an existing dependency already covers the need. Audit the dependency tree
when a resolution error appears — do not force versions blindly. [Evidence: E015]

## Emulator-vs-device behavioral gaps

Symptom: feature passes on the emulator and fails in the field. Emulators
differ from real devices in ways that matter: no real OEM background-killing
policies, different camera/sensor/GPU behavior, permissive network, no real
push-delivery constraints, and no manufacturer skin quirks. Rule: emulator
verification is necessary but not sufficient for features touching camera,
Bluetooth, background work, push, biometrics, or performance; run the
connected checks on at least one physical device before calling such features
verified, and say so explicitly in the feature's verification notes.

## Configuration-change amnesia

Symptom: rotating the device resets screen state, loses scroll position, or
re-fires one-shot effects (toasts, navigation) on every rotation. Activities
recreate on configuration change; code that treats `onCreate` as
"runs once" re-triggers work. Rule: screen state lives in the ViewModel or
saved state, never in Activity/Fragment fields; [Evidence: E013] one-shot events must be modeled as consumable (handled-once) rather than as sticky state; [Evidence: E013] rotation is
part of the manual smoke check for every new screen.
