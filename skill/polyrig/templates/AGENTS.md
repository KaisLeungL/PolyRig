<!-- polyrig: Template for the target project's AGENTS.md — the primary agent instruction file. Keep it THIN: routing + hard rules only. Never add knowledge prose here; knowledge lives under docs/. Remove all `polyrig:` comments from the final artifact. -->

# {{PROJECT_NAME}} — Agent Instructions

This repository was initialized by PolyRig. Before doing any feature work, route
yourself through the files below.

## Routing index

| Need | Read |
|---|---|
| Requirements, stack decisions, constraints, red lines | `SPEC.md` |
| What to build next, feature state, acceptance criteria | `feature_list.json` |
| Stack daily implementation knowledge | `docs/stacks/{{STACK_SHORT_NAME}}/overview.md`, `docs/stacks/{{STACK_SHORT_NAME}}/pitfalls.md`, `docs/stacks/{{STACK_SHORT_NAME}}/verify.md` |
| Stack evidence and source trace | Read `docs/stacks/{{STACK_SHORT_NAME}}/sources.md` when handling strong-rule disputes, dependency updates, security/reliability audits, or provenance tracing |
| Domain daily implementation knowledge | `docs/domains/{{DOMAIN_SHORT_NAME}}/overview.md`, `docs/domains/{{DOMAIN_SHORT_NAME}}/pitfalls.md`, `docs/domains/{{DOMAIN_SHORT_NAME}}/verify.md` |
| Domain evidence and source trace | Read `docs/domains/{{DOMAIN_SHORT_NAME}}/sources.md` when handling strong-rule disputes, dependency updates, security/reliability audits, or provenance tracing |
| How to verify a feature | `docs/verify.md` |
| Resolved dependency versions (dated snapshots) | `deps.resolved.md` |
| Provenance: which packs, versions, checksums | `.polyrig/manifest.json` |

<!-- polyrig: Emit the daily implementation and evidence/source-trace rows above for every selected stack pack and every selected domain pack, replacing the placeholder rows. -->

## Hard rules

1. Work on **one feature at a time**, in `depends_on` order, from `feature_list.json`.
2. Update `feature_list.json` after **every** implementation attempt. Status
   transitions: `planned → in_progress → implemented → verified`, with
   `blocked` or `rejected` when applicable. Record blockers and deviations in
   the feature's `notes`.
3. **Never** set a feature's status to `verified` unless its
   `verification.automated` commands actually passed, or its
   `verification.manual` checks are explicitly documented in the feature's
   `notes`.
4. Before adding or upgrading a dependency, check `deps.resolved.md`. If the
   `Resolved-at` date is stale, or the recorded entry's re-check condition is
   met, re-verify the version online before using it.
5. Never write secrets, credentials, or tokens into version control.
