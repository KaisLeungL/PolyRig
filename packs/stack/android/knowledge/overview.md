# stack/android — Overview (decision guidance)

Slow-changing architecture guidance for building Android apps. No version
numbers appear here by design: anything volatile (AGP/Kotlin/library versions,
SDK level consequences) is resolved via `deps.yaml` lookup strategies at
assembly time and recorded in the target project's `deps.resolved.md`.

## Project structure: single-module vs multi-module

Default to a **single `:app` module** for a new project. Multi-module is a cost
(build wiring, DI graph plumbing, navigation indirection) that must be earned. [Evidence: E001, E002]

Split into modules only when at least one of these is true:

- Two or more developers (or agents) routinely collide in the same source tree.
- A feature has a genuinely independent lifecycle (shipped behind a flag,
  reused across apps, or owned by a separate team).
- Build times hurt and the code has natural seams that would parallelize
  compilation.
- You need to enforce a dependency direction the compiler can check (e.g.
  feature code must not reach into another feature's internals). [Evidence: E001, E006]

When you do split, follow this layering — dependencies point downward only:

```
:app                      # thin shell: DI wiring, navigation graph, Application
:feature:<name>           # one module per user-facing feature (UI + ViewModel)
:core:<capability>        # shared: designsystem, network, database, common
```

Rules for the split:

- **Feature modules never depend on each other.** [Evidence: E001, E006] They communicate through
  navigation (routes/deep links) or shared `:core` abstractions. The moment
  `:feature:a` imports `:feature:b`, the layering is dead.
- **api/impl separation** is a second-order refinement: split a `:core` module
  into `:core:x:api` (interfaces, models) and `:core:x:impl` (bindings) only
  when you need swappable implementations (test doubles at module level,
  build-variant substitution) or compile-avoidance on a hot path. Do not start there. [Evidence: E001, E002]
- `:app` is allowed to see everything; nothing sees `:app`.

## Gradle configuration conventions

- **Gradle Kotlin DSL** (`.gradle.kts`) for all build scripts. Groovy scripts
  are legacy interop only.
- **Version catalog (`gradle/libs.versions.toml`) is the single source of truth
  for every dependency and plugin coordinate.** No hardcoded coordinates in
  module build files; no `ext`/`buildSrc` constant soup. When an agent adds a
  dependency, it adds it to the catalog first and references `libs.*`.
- Use **convention plugins** (in `build-logic/`) once three or more modules
  repeat the same block of android/kotlin configuration. Before that point,
  duplication is cheaper than the indirection.

## The Gradle / AGP / Kotlin / JDK compatibility principle

These four move in lockstep and this is the single most common way a fresh
Android build breaks:

- **Never bump one of Gradle, AGP, Kotlin, or the JDK in isolation.** [Evidence: E003] Each AGP
  release requires a minimum Gradle version and a minimum JDK; the Kotlin
  plugin and Compose compiler have their own compatibility bands with Kotlin
  and AGP.
- **Before choosing or changing any of them, run the compatibility lookup in
  `deps.yaml`** (AGP release notes + Kotlin compatibility docs) and record the
  verified combination in `deps.resolved.md`. Do not trust remembered versions — this pack deliberately states none. [Evidence: E003]
- Symptom pattern to recognize: "Unsupported class file major version",
  "requires Gradle X or newer", or Compose compiler/Kotlin mismatch errors at
  configuration time all mean the lockstep was violated. Fix the matrix, don't
  patch the symptom.

## Build variants and flavors

- **Debug/release build types are free and mandatory** — release must be minified and tested (see pitfalls). [Evidence: E004, E011]
- **Product flavors are not free.** Every flavor multiplies build variants,
  test matrices, and signing/config surface. Introduce a flavor dimension only
  for a real axis of distribution: different backends baked at build time
  (dev/staging/prod), white-label brands, or paid/free with divergent code.
- Prefer **runtime configuration over flavors** when the difference is data
  (endpoints, feature flags) rather than code. If the only difference is a
  base URL, a build-config field per build type usually suffices — do not add a dimension for it. [Evidence: E004]

## UI layer decision

- **Compose-first is the default posture for a new project.** New screens,
  new design systems, and new navigation graphs should be Compose unless a
  concrete blocker exists.
- XML/View interop is justified only when: embedding a mature View-based SDK
  (maps, ads, players, WebView-heavy screens), incrementally migrating an
  existing XML codebase, or a required widget has no viable Compose equivalent. [Evidence: E005] In those cases isolate interop behind `AndroidView`/
  `ComposeView` boundaries — do not let the two paradigms interleave freely in one screen. [Evidence: E005]
- Do not build a new screen in XML "because it's familiar." That decision compounds into a migration project later. [Evidence: E005]

## Architecture defaults

- **Unidirectional data flow (UDF)** is the non-negotiable baseline: state
  flows down, events flow up. UI observes a single immutable state object per
  screen; user actions are dispatched as events to the state holder.
- **ViewModel is the screen-level state holder.** It exposes one cold-start
  -safe observable state stream and survives configuration changes. Business
  logic lives below it; the ViewModel orchestrates, it does not compute.
- **Repository pattern is the boundary between the app and data sources.**
  UI/ViewModel layers never see network or database types directly; the [Evidence: E006]
  repository maps DTO/entity types to domain models and owns the
  single-source-of-truth decision (which source wins, when to refresh).
- Keep UI state classes free of framework types (no Context, no View
  references) so they are trivially unit-testable.
- **DI decision:** Hilt is the default for anything multi-module or with a
  nontrivial object graph — it standardizes scoping and survives team/agent
  turnover. Manual constructor injection (a hand-rolled AppContainer) is
  acceptable for a tiny single-module app with a handful of dependencies;
  switch to Hilt before the container grows conditional logic. Avoid service
  locators and reflection-based lookup in either case.

## minSdk / targetSdk decision procedure

State the *procedure*, not the numbers — the numbers rot:

1. **targetSdk: always the latest stable API level.** Play policy enforces a
   floor that moves yearly; run the `deps.yaml` lookup to confirm the current
   requirement. Raising targetSdk changes runtime behavior (permissions,
   background limits, storage), so re-run the full verification route after
   any bump.
2. **minSdk: driven by user-base data, not developer convenience.** Pull the
   current platform distribution (lookup in `deps.yaml`), decide the
   percentage of devices you can afford to exclude, and pick the lowest API
   level that satisfies it. For a brand-new product with no install base,
   bias toward a higher floor: each API level dropped from minSdk buys
   real users but costs compat branches and desugaring surface.
3. Record the chosen pair and its rationale in the target project's SPEC.md;
   treat any later change to minSdk as a reviewed decision, not a build tweak.
