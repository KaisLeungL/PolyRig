---
name: polyrig
description: Inject reusable domain/tech-stack experience into a project. Use when the user types /polyrig, wants to cold-start a new project for AI coding, wants to add PolyRig knowledge to an existing project, asks to make a project "agent-ready", or mentions PolyRig or "harness pack". Discovers knowledge packs, interviews the user, copies the selected packs' knowledge into `.polyrig/vault/`, records a dated dependency snapshot and an audit manifest, and writes a pure-pointer PolyRig block into AGENTS.md/CLAUDE.md. Works for both new-project cold-start and existing-project incremental injection.
---

# PolyRig — /polyrig

PolyRig **gathers, packages, and injects** reusable domain/tech-stack experience.
It copies the selected packs' knowledge into the target project's
`.polyrig/vault/`, records a dated dependency snapshot (`.polyrig/deps.resolved.md`)
and an audit manifest (`.polyrig/manifest.json`), and writes a **pure-pointer**
PolyRig block into `AGENTS.md`/`CLAUDE.md` so agents know the experience is there
and how to use it. It does **NOT** scaffold business code, and it does **NOT**
produce a project spec, a feature state machine, or init scripts. Rationale and
full contracts: `SPEC.md` at the PolyRig repo root (resolved below as
`$POLYRIG_ROOT/SPEC.md` — this is PolyRig's own product spec, not a generated
artifact).

**Two injection modes, same artifacts:** cold-start (new/empty project) and
incremental injection (existing project, possibly with its own `.harness/`).
Both produce the **same** experience artifacts under `.polyrig/` and the **same**
managed block; the only difference is create-new vs. merge-into-existing.

**Language rule:** conduct the interview in the user's language. ALL injected
artifacts are written in English. Record both in the manifest's `language` field.

**Thin-skill rule:** this file carries flow, routing, and formats only. Every
piece of stack or domain knowledge comes from packs — never improvise knowledge;
if a pack does not cover something, say so and note it. **Never inline pack
knowledge (red lines, strong rules, decision trees) into AGENTS.md** — the
experience lives in `.polyrig/vault/`; AGENTS.md only routes to it.

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

## The injection flow — four phases

Fixed order P1–P4. Ask **1–3 questions per phase, one at a time**. Every question
must state a **recommended answer** and accept a **default** (an empty/“you decide”
reply takes the recommendation). Summarize what was recorded at the end of each phase.
PolyRig does not gather project specifications — it only decides **which experience
packs to inject** and then injects them.

### P1 — Project identity and injection mode

Goal: name, target directory, and cold-start vs. incremental. Ask:
1. Project name and one-line purpose? (purpose is used only to recommend packs —
   it is not recorded as a spec. No default for the name — required.)
2. Target directory? (recommend: for a new project, a new directory named after it
   under the current working directory; for injection, the existing project root)

Then **detect the injection mode** (do not ask — inspect the target dir):
- If the target dir is missing/empty → **cold-start**.
- If it already has code / an `AGENTS.md` / a `.harness/` → **incremental
  injection**. A non-empty target is **expected** here, not a blocker.

Both modes produce the same artifacts; the difference is only create-new vs.
merge-into-existing (see the managed-block rule in the assembly procedure). Do
**not** ask about repo layout or other project-spec questions — the new
positioning does not collect them.

Record: name, target dir, injection mode.

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

Record: selected stack pack ids and the user's rationale (for the manifest audit
trail only).

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
selection separately (see P4) in addition to its members.

Then resolve dependencies from each selected pack's metadata (both from single
picks and from group members):
- `requires`: auto-include the required packs and **tell the user** each one added
  and why (e.g. "domain/auth-google requires domain/auth-core — added"). A member
  whose `requires` are satisfied by group siblings needs no extra addition.
- `conflicts`: if two selected packs conflict, **block** the combination, explain
  which pair conflicts, and ask the user to drop one.

Record: the selected group suite(s) with their member composition, plus the final
domain pack set, including transitive additions marked "required by <pack>".

### P4 — Inject

Execute the assembly procedure below, then report. There is no constraints /
first-feature / merged-verification-route phase — those produced the removed
`SPEC.md` / `feature_list.json` / `docs/verify.md` artifacts. Verification
knowledge travels with each pack's `verify.md` into the vault, and AGENTS.md
routes to it.

## Pack discovery & trust (enforced at P2/P3 and P4)

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

## P4 assembly procedure

Work inside `<target>`; all injected content in English. PolyRig only ever writes
inside `<target>/.polyrig/` and the managed block of `<target>/AGENTS.md` /
`<target>/CLAUDE.md` — **never** any other root file, and **never** `.harness/`.

**a. Online dependency verification.** For each selected pack that has a
`deps.yaml`: execute each entry's `lookup` strategy (WebSearch with the given
query; WebFetch the `official_sources`). Record per dependency: resolved version,
resolved-at date, source URL actually consulted, confidence (high/medium/low with
justification), and a re-check action → written to `.polyrig/deps.resolved.md`. If
the user declines online verification, record `confidence: unverified` and say so.

**b. Copy the pack into the vault (physical copy — knowledge travels with the
repo, preserving the pack's own directory structure).**
- stack packs → `<target>/.polyrig/vault/stacks/<short-id>/` (short-id = id without
  the `stack/` prefix), domain packs → `<target>/.polyrig/vault/domains/<short-id>/`.
- **Mirror the pack's directory structure verbatim** — do NOT flatten or rename.
  Copy `knowledge/` (with its `per-stack/` subdirectory intact), `references/`
  (keep `references/sources.md` at `references/sources.md`), `verify.md`, and
  `deps.yaml` if present, each at the same relative path under the vault pack dir.
  Rationale: the vault copy is a faithful mirror of the pack, so paths, cross-file
  links, and provenance stay stable and the pack is recognisable/upgradable.
- **Omit only `pack.yaml`** — its metadata is recorded in `.polyrig/manifest.json`
  (`selected_packs[]`), so it is redundant inside the vault.
- **If the pack carries `skills/`** (opt-in, decision C): the mirror copy already
  brings `skills/` across at `.polyrig/vault/<stacks|domains>/<short-id>/skills/`.
  This is the skill source of truth; `polyrig skills inject` later symlinks from
  here into the project's agent trigger directories. Copying it here does **not**
  activate anything — injection is a separate, explicit step.
- **If the pack carries `scripts/`** (opt-in, decision D): the mirror copy brings
  `scripts/` across as **data** — it is example/reference material for the agent to
  read. PolyRig **never runs** a copied pack script and never symlinks it into a
  trigger directory; there is no `.polyrig/tools/`. (This supersedes the old "do
  not copy scripts" rule: scripts now travel as read-only data, still never executed.)

**c. Write `.polyrig/deps.resolved.md`** from the step-a results (one dated entry
per dependency), instantiating `$POLYRIG_ROOT/skill/polyrig/templates/deps.resolved.md`
and removing all `polyrig:` comments.

**d. Inject the AGENTS.md / CLAUDE.md managed block** (see "Managed-block
injection" below). The block is **pure routing only** — no red lines, no strong
rules, no decision-tree text. Instantiate from
`$POLYRIG_ROOT/skill/polyrig/templates/AGENTS.md` and `.../CLAUDE.md`, filling one
"MUST read" routing line per copied vault directory, plus deps.resolved and
manifest routing.

**e. Write `.polyrig/manifest.json`** conforming to
`$POLYRIG_ROOT/schemas/manifest.schema.json`. Delete the template's `$comment` key.
Field translation: the index script emits overrides as `winner_source`/`loser_source`
— the manifest schema requires **`winning_source`/`losing_source`**; translate when
writing (also fill `winning_path` and `carries_scripts` from the index). Set each
pack's `copied_to` to its `.polyrig/vault/...` path. Per selected pack compute one
checksum over its copied files, including copied `sources.md`, run from `<target>`:

```bash
find .polyrig/vault/<stacks|domains>/<short-id> -type f | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256 | cut -d" " -f1
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

**f. Report and hand off.** List: every file written, every override announced,
every staleness warning, every unverified dependency. Then instruct the user:

> Open a FRESH session in the target project and say: "read AGENTS.md". Before any
> task, read the routed `.polyrig/vault/` knowledge for that area and obey its red
> lines; check dependency versions in `.polyrig/deps.resolved.md`. The repo carries
> the experience — no verbal context required.

## Managed-block injection (AGENTS.md / CLAUDE.md)

Both files carry the **same** PolyRig managed block, delimited exactly as
`scripts/link-skill.mjs` does (keep the markers identical repo-wide):

```
<!-- BEGIN POLYRIG MANAGED BLOCK -->
...pure routing content...
<!-- END POLYRIG MANAGED BLOCK -->
```

**Block content = routing only** (never inline experience):
1. Injection declaration + pack list (id + version) and where each pack's knowledge
   lives under `.polyrig/vault/`.
2. Per pack, one **"MUST read"** routing line: before a task touching that area
   (e.g. "Android build / auth flow"), MUST read the matching
   `.polyrig/vault/<type>s/<short-id>/` (its `knowledge/*.md` and `verify.md`;
   `references/sources.md` for provenance) — this points at the entry to the red
   lines / strong rules / verification, it does **not** copy their content.
3. Dependency routing: check `.polyrig/deps.resolved.md` for versions/strategy;
   re-verify online before adding/upgrading a dependency if the snapshot is stale.
4. Audit routing: pack/version/checksum in `.polyrig/manifest.json`.

**Injection rules (incremental, idempotent, non-destructive)** — same semantics as
link-skill.mjs's `upsertManagedBlock`:
- Read the target `AGENTS.md` if it exists and locate `BEGIN`/`END`:
  - markers present → **replace only** the content between them; user content
    outside is untouched.
  - markers absent → **append** the whole block at end of file (blank-line separated).
  - file absent (cold-start) → **create** it with the block.
- **Idempotent:** re-injecting identical content is a no-op.
- **CLAUDE.md is the synonym entry:** write the **same** block content. Cold-start
  and incremental both write the identical block.
- **Non-destructive boundary:** only ever write the AGENTS.md/CLAUDE.md managed-block
  span and inside `.polyrig/`; never touch other root files, never touch `.harness/`.

## Failure & edge handling

- **Target dir not empty:** for **incremental injection** this is **expected** —
  do not block. Merge the AGENTS.md/CLAUDE.md managed block (preserving content
  outside the markers) and write only under `.polyrig/`. Never overwrite a user's
  non-managed content.
- **No compatible domain packs:** say so and proceed stack-only (skip domain copy).
- **User skips online verification:** proceed, mark every affected entry in
  `.polyrig/deps.resolved.md` as `confidence: unverified`, and state this in the report.

## Post-inject self-check (before declaring success)

Running `validate-pack.mjs` is NOT needed here — selected packs were already
validated. Instead validate the generated manifest against its schema:

```bash
node "$POLYRIG_ROOT/scripts/validate-artifacts.mjs" <target>
```

It checks `.polyrig/manifest.json` against `$POLYRIG_ROOT/schemas/` — including any
`selected_groups[]` you wrote (the manifest schema already covers the
`id`/`version`/`lock` shape). Fix any violation before reporting success. If the
script is unavailable (POLYRIG_ROOT could not be resolved), fall back to re-reading
the manifest against the schema's required fields by hand.
