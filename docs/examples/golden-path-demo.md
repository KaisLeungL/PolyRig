# Golden-Path Cold-Start Demo (F010 Runbook)

> Status: **not yet executed** — this is the prepared runbook for the v0.1 release
> gate. When the demo passes, replace the "Results" section with the actual run
> write-up; this document then becomes the README's core narrative source.

The demo proves PolyRig's central claim: project knowledge moves from chat
context into repository context. A fresh AI session with **zero verbal context**
must implement the first feature relying only on on-disk artifacts.

## Scenario

A small real project: **Android app + FastAPI backend with Google Sign-In**
(packs: `stack/android`, `stack/backend-fastapi`, `domain/auth-core`,
`domain/auth-google`).

## Prerequisites (human setup, before the demo)

- [ ] PolyRig installed for the agent you will use: `npx polyrig install` (from a git clone, `node scripts/link-skill.mjs`; doctor passes: `node scripts/doctor.mjs`)
- [ ] Google Cloud project with OAuth consent screen (testing mode is fine; add your test account)
- [ ] OAuth client IDs created: one **Web** client (the backend audience), one **Android** client (debug SHA-1 registered)
- [ ] Android device or emulator with a signed-in Google account
- [ ] Python toolchain (uv or venv) and Android toolchain available

## Part 1 — Initialize (interactive session)

1. Create an empty project directory and open a fresh agent session there.
2. Run `/polyrig`. Answer the seven phases; suggested demo answers:
   - Identity: name `sigil-demo`, purpose "demo app with Google Sign-In", monorepo layout (`app/` + `server/`).
   - Stack: select `stack/android` and `stack/backend-fastapi`.
   - Domains: select `domain/auth-google` (auth-core auto-included via `requires`).
   - Constraints: no secrets in VCS; client IDs via env.
   - First feature: "User signs in with Google on Android; backend verifies the ID token and issues an app session; a protected `/me` endpoint returns the user."
   - Verification route: accept the merged route from the packs.
3. Confirm generation. Record what the skill reports (files written, overrides, staleness warnings).

**Gate 1 — artifact audit:** all SPEC §5 artifacts exist; `feature_list.json`
and `.polyrig/manifest.json` conform to `schemas/`; manifest lists all 4 packs
with checksums; `deps.resolved.md` has dated, sourced entries.

## Part 2 — Cold start (fresh session, zero verbal context)

1. Close the session. Open a **new** session in the target project.
2. Say exactly: **"Read AGENTS.md and implement the first feature."** Nothing else.
3. Do not answer knowledge questions verbally; if the agent asks something the
   artifacts should answer, note it as a context-layer gap (demo finding, fix the
   pack/template, not the session).
   Mechanical account-specific values (pasting the actual client IDs into `.env`)
   are allowed — they are credentials, not knowledge.

**Gate 2 — implementation:** the agent implements the feature using
docs/stacks/, docs/domains/, deps.resolved.md; runs the verification route
(backend tests incl. wrong-audience/expired-token rejection; Android build;
manual sign-in smoke test on device); and updates `feature_list.json` through
`planned → in_progress → implemented → verified` itself, with evidence.

## Pass criteria (all required)

1. Fresh session needed zero verbal knowledge context.
2. First feature's automated verification passed; manual checks documented.
3. Feature state transitions were made by the agent, honestly.
4. No secrets in VCS (`git log -p` spot check).

## Results

_To be filled after execution: date, transcript highlights, gaps found in packs
or templates, fixes applied, final verdict._
