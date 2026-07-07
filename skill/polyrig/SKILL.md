---
name: polyrig
description: Initialize any-tech-stack project as an agent-ready repository through a seven-phase interview. Use when the user types /polyrig, wants to cold-start a new project for AI coding, asks to make a project "agent-ready", mentions PolyRig or "harness pack", or wants to assemble project context (spec, feature plan, stack/domain knowledge, verification routes) for AI coding agents. Discovers knowledge packs, interviews the user, and generates SPEC.md, AGENTS.md, feature_list.json, copied pack docs, and an audit manifest into the target project.
---

# PolyRig — /polyrig

PolyRig assembles the **context layer** an AI coding agent needs: requirements,
stack decisions with rationale, copied pack knowledge, dependency lookup results,
verification routes, and a persistent feature state machine. It does **NOT**
scaffold business code. Rationale and full contracts: `SPEC.md` at the PolyRig
repo root (resolved below as `$POLYRIG_ROOT/SPEC.md`).

**Language rule:** conduct the interview in the user's language. ALL generated
artifacts are written in English. Record both in the manifest's `language` field.

**Thin-skill rule:** this file carries flow, routing, and formats only. Every
piece of stack or domain knowledge comes from packs — never improvise knowledge;
if a pack does not cover something, say so and record it as a constraint or note.

## Step 0 — Resolve POLYRIG_ROOT (once, before P2)

This skill is installed as a symlink from an agent-specific location to the
PolyRig install root's `skill/polyrig`. The install root is `~/.polyrig/runtime`
(when installed via `npx polyrig install`) or a git checkout (developer mode).
Resolve it once and reuse it for every script call. Prefer `POLYRIG_ROOT` if the
user or launcher has set it; otherwise walk up from the native skill symlink:

```bash
if [ -z "${POLYRIG_ROOT:-}" ]; then
  for candidate in "$HOME/.codex/skills/polyrig" "$HOME/.claude/skills/polyrig"; do
    if [ -e "$candidate" ]; then
      POLYRIG_ROOT="$(cd "$(readlink -f "$candidate")/../.." && pwd)"
      break
    fi
  done
fi
# Fall back to the staged runtime dir if the walk above did not resolve.
if [ -z "${POLYRIG_ROOT:-}" ] && [ -d "$HOME/.polyrig/runtime/scripts" ]; then
  POLYRIG_ROOT="$HOME/.polyrig/runtime"
fi
```

Then verify `$POLYRIG_ROOT/scripts/build-pack-index.mjs` exists. If it does not,
tell the user to run `npx polyrig install` (which stages the runtime under
`~/.polyrig/runtime`); if they have a PolyRig git checkout instead, ask for its
path and use that as `POLYRIG_ROOT`.

## The interview — seven phases

Fixed order P1–P7. Ask **1–3 questions per phase, one at a time**. Every question
must state a **recommended answer** and accept a **default** (an empty/“you decide”
reply takes the recommendation). Summarize what was recorded at the end of each phase.

### P1 — Project identity

Goal: name, purpose, location, layout. Ask:
1. Project name and one-line purpose? (no default — required)
2. Target directory? (recommend: a new directory named after the project under the
   current working directory)
3. Repo layout — monorepo or single-purpose repo? Present both neutrally; this is
   the **user's call, never imposed**. (recommend based on how many stacks they
   described; default: single repo)

Record: name, purpose, target dir, layout choice + one-sentence why.

### P2 — Target stack

Run pack discovery (target dir must exist before `--target` is passed; omit
`--target` if it does not exist yet):

```bash
node "$POLYRIG_ROOT/scripts/build-pack-index.mjs" [--target <target-dir>]
```

Present the discovered **stack** packs (id, summary, version, source). Ask which
stack pack(s) apply (recommend the ones matching the stated purpose; multiple
allowed). If no stack pack matches the user's stack, say so plainly and offer to
proceed with domain packs only or stop.

Record: selected stack pack ids and the user's rationale.

### P3 — Domain packs and group suites

From the same index, present two kinds of option side by side:

1. **Single domain packs** — present only those **compatible** with the chosen
   stacks: a domain pack is compatible if its `stacks` list intersects the chosen
   stack short-names **or is empty** (empty = stack-agnostic).
2. **Group suites** — from the index's `groups[]` array, present each **compatible**
   group as a curated "suite" option alongside the single packs. A group is
   compatible if **any** of its member domain packs is compatible with the chosen
   stacks (same intersection-or-empty rule). Show the group id, summary, version,
   source, and its member composition (e.g. "group/auth — domain/auth-core,
   domain/auth-google, domain/auth-github"), so the user sees a suite is one
   choice that pulls several packs.

Ask which apply (recommend those matching the stated purpose; default: none).
Single packs and suites may be mixed.

**Selecting a group suite** pulls in **all** its members. Resolve them in
**dependency-first / topological order** (a member's `requires` come before it —
e.g. `domain/auth-core` before `domain/auth-google`), and **tell the user** the
full member composition being added and why (e.g. "group/auth selected — adds
domain/auth-core, domain/auth-google, domain/auth-github"). Record the group
selection separately (see P7) in addition to its members.

Then resolve dependencies from each selected pack's metadata (both from single
picks and from group members):
- `requires`: auto-include the required packs and **tell the user** each one added
  and why (e.g. "domain/auth-google requires domain/auth-core — added"). A member
  whose `requires` are satisfied by group siblings needs no extra addition.
- `conflicts`: if two selected packs conflict, **block** the combination, explain
  which pair conflicts, and ask the user to drop one.

Record: the selected group suite(s) with their member composition, plus the final
domain pack set, including transitive additions marked "required by <pack>".

### P4 — Constraints

Goal: hard rules for SPEC.md sections 5–8. Ask (1–3, merge where natural):
1. Security red lines beyond the defaults? (recommend: adopt the red lines from the
   selected packs' pitfalls; default: pack red lines + "never commit secrets")
2. Offline/online policy and platform rules? (default: none beyond pack guidance)
3. Explicit out-of-scope items? (default: none)

Record: constraints, red lines, out-of-scope list.

### P5 — First feature

Goal: seed `feature_list.json` with **real entries, not placeholders**. Ask:
1. What is the concrete first feature? (recommend the smallest end-to-end slice of
   the stated purpose)
2. Acceptance criteria — at least one concrete, checkable criterion? (propose a
   draft for confirmation)

Steer the first feature toward a **runnable slice**: its automated verification
must exercise behavior (build, tests against running code, server boot) — not
restate documentation. A contract- or doc-only feature whose test merely
re-asserts its own content proves nothing; fold contract definition into the
feature that implements it instead.

When acceptance criteria name concrete artifacts a selected pack has a **strong
convention** about (route paths, error-envelope shape, storage location, naming),
write them consistent with that convention so the implementer is not forced to
reconcile a conflict. Example: if the backend pack mandates an `/api/v1` prefix,
write the criterion as `POST /api/v1/auth/google`, not `POST /auth/google`.
Prefer routing the detail to the pack ("the sign-in endpoint per
`docs/stacks/<id>/`") over hard-coding a value the pack will contradict.

If the feature spans multiple stacks or is too large for one pass, decompose it
into 2–4 features with `depends_on` ordering and confirm the split. Each feature
gets: id (F001…), title, status `planned`, priority, depends_on, pack_refs (the
selected packs it draws on), acceptance_criteria, verification (manual + automated),
files_expected.

### P6 — Verification route

Derive the route — do not invent it: read each selected pack's `verify.md` and the
stack packs' build/test commands, merge into a per-feature and project-level route
(automated commands + manual checks). Present the merged route and ask the user to
confirm or amend (default: as derived).

Record: confirmed route → feeds `docs/verify.md` and each feature's `verification`.

### P7 — Generate

Execute the assembly procedure below, then report.

## Pack discovery & trust (enforced at P2/P3 and P7)

The index scans three roots; on id collision the most specific wins
(**project > user > builtin**): builtin `$POLYRIG_ROOT/packs/`, user
`~/.polyrig/packs/` (plus legacy `~/.claude/polyrig-packs/`), project
`<target>/.polyrig/packs/`.

**Override announcement (MANDATORY).** When the index's `overrides` array is
non-empty, announce each entry to the user before selection, in this format:

> OVERRIDE: pack `<id>` — using <winning source> copy at `<path>`
> (shadows <losing source>). Carries scripts: <yes/no>. Review this pack's
> content before use.

**Trust rules** (root always beats what a pack claims about itself):

| Source | Read/copy knowledge | Run pack scripts |
|---|---|---|
| builtin | yes | safe scripts allowed |
| user | yes | only after explicit user confirmation |
| project | yes | **never by default** |
| remote | unsupported in v1 | — |

**Staleness rule:** if a selected pack's `last_reviewed` is older than **180 days**
(vs. today), warn the user before assembly and note that its knowledge may be stale.

## P7 assembly procedure

Work inside `<target>`; all generated content in English.

**a. Online dependency verification.** For each selected pack that has a
`deps.yaml`: execute each entry's `lookup` strategy (WebSearch with the given
query; WebFetch the `official_sources`). Record per dependency: resolved version,
resolved-at date, source URL actually consulted, confidence (high/medium/low with
justification), and a re-check action. If the user declines online verification,
record `confidence: unverified` and say so in the final report.

**b. Copy pack knowledge (physical copy — knowledge travels with the repo).**
- stack packs → `<target>/docs/stacks/<short-id>/` (short-id = id without the
  `stack/` prefix), domain packs → `<target>/docs/domains/<short-id>/`.
- Copy `knowledge/*.md` (preserve the `per-stack/` subdirectory when present,
  otherwise flatten) plus the pack's `verify.md`.
- Copy `references/sources.md` as `sources.md` in the same target doc directory:
  stack packs → `<target>/docs/stacks/<short-id>/sources.md`, domain packs →
  `<target>/docs/domains/<short-id>/sources.md`.
- Do **NOT** copy or run pack `scripts/` unless the trust table above permits it
  and (for user packs) the user explicitly confirmed.

**c. Instantiate templates** from `$POLYRIG_ROOT/skill/polyrig/templates/`,
filling every placeholder from interview answers and removing all `polyrig:` comments:
- `SPEC.md` — P1–P4 decisions **with rationale in the user's own terms**.
- `AGENTS.md` — routing rows for **every** copied doc directory + the hard rules
  from the template kept **verbatim**.
- `CLAUDE.md` — thin pointer to AGENTS.md, zero duplicated content.
- `feature_list.json` — the real P5 features; must validate against
  `$POLYRIG_ROOT/schemas/feature_list.schema.json`.
- `docs/verify.md` — the merged P6 route.
- `deps.resolved.md` — step-a results, one dated entry per dependency.
- `init.plan.md` first, then `init.sh` — init.sh stays within the template's safe
  operations (mkdir -p / touch / echo, plus the template's guarded `git init` when
  the target is not already inside a repository; no installs, no build-file edits,
  no remote fetches, no commits); everything non-trivial goes into init.plan.md as
  manual follow-ups — including the first commit, which stays manual.

**d. Write `.polyrig/manifest.json`** conforming to
`$POLYRIG_ROOT/schemas/manifest.schema.json`. Delete the template's `$comment` key.
Field translation: the index script emits overrides as `winner_source`/`loser_source`
— the manifest schema requires **`winning_source`/`losing_source`**; translate when
writing (also fill `winning_path` and `carries_scripts` from the index). Per selected
pack compute one checksum over its copied files, including copied `sources.md`,
run from `<target>`:

```bash
find docs/<stacks|domains>/<short-id> -type f | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256 | cut -d" " -f1
```

Record it as `"sha256:<that 64-hex digest>"`.

If the user selected any **group suite** in P3, also write `selected_groups[]`:
one entry per selected group, `{ "id": "group/<name>", "version": "<group
version from the index>", "lock": [ {"id": "<member/dep id>", "version": "<pinned
version>"}, … ] }`. The `lock` is the exact version snapshot of the group's
members and external `requires` — take it straight from the group's index entry
(`members` + `requires`), in dependency-first order. The members still appear
individually in `selected_packs[]` (unchanged); `selected_groups[]` records that
they arrived as a group so a future upgrade can treat them as a unit. Packs the
user picked singly (not via a group) do **not** appear in `selected_groups[]`.

**e. Report and hand off.** List: every file written, every override announced,
every staleness warning, every unverified dependency. Then instruct the user:

> Open a FRESH session in the target project and say: "read AGENTS.md and
> implement the first feature." The generated repo carries everything needed —
> no verbal context required.

## Failure & edge handling

- **Target dir not empty:** list what exists and ask before writing anything.
  Never overwrite without consent; if a file to generate already exists and the
  user does not consent to replacing it, write yours as `<name>.proposed` instead.
- **No compatible domain packs:** say so and proceed stack-only (skip domain copy).
- **User skips online verification:** proceed, mark every affected entry in
  `deps.resolved.md` as `confidence: unverified`, and state this in the report.

## Post-generate self-check (before declaring success)

Running `validate-pack.mjs` is NOT needed here — selected packs were already
validated. Instead validate the two generated JSON artifacts against their schemas:

```bash
node "$POLYRIG_ROOT/scripts/validate-artifacts.mjs" <target>
```

It checks `feature_list.json` and `.polyrig/manifest.json` against
`$POLYRIG_ROOT/schemas/` — including any `selected_groups[]` you wrote (the
manifest schema already covers the `id`/`version`/`lock` shape). Fix any
violation before reporting success. If the script is unavailable (POLYRIG_ROOT
could not be resolved), fall back to re-reading both files against the schemas'
required fields by hand.
