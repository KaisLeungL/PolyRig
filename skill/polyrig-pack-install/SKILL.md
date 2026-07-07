---
name: polyrig-pack-install
description: Install or update PolyRig packs from a PolyRig registry. Use when the user pastes a registry pack version URL, asks to install a shared pack, or wants to update installed packs. Downloads, verifies sha256, validates locally, and installs to ~/.polyrig/packs.
---

# PolyRig Pack Install

This skill installs and updates packs from a PolyRig registry. It is the
interaction contract on top of the deterministic helper
`$POLYRIG_ROOT/scripts/install-pack.mjs`; all downloading, checksum
verification, safe unpacking, local validation, and metadata writing happen
inside that script.

Keep the conversation in the user's language.

## Step 0 — Resolve POLYRIG_ROOT (once)

This skill is installed as a symlink from an agent-specific location to the
PolyRig install root's `skill/polyrig-pack-install`. The install root is
`~/.polyrig/runtime` (when installed via `npx polyrig install`) or a git
checkout (developer mode). Resolve it once and reuse it for every script call.
Prefer `POLYRIG_ROOT` if the user or launcher has set it; otherwise walk up from
the native skill symlink:

```bash
if [ -z "${POLYRIG_ROOT:-}" ]; then
  for candidate in "$HOME/.codex/skills/polyrig-pack-install" "$HOME/.claude/skills/polyrig-pack-install"; do
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

Then verify `$POLYRIG_ROOT/scripts/install-pack.mjs` exists. If it does not,
tell the user to run `npx polyrig install` (which stages the runtime under
`~/.polyrig/runtime`); if they have a PolyRig git checkout instead, ask for its
path and use that as `POLYRIG_ROOT`.

## Hard rules

- Only PolyRig registry canonical URLs are accepted. Two forms exist:
  - pack: `https://<registry>/packs/<type>/<name>/versions/<version>`
  - group: `https://<registry>/groups/<name>/versions/<version>`

  Refuse GitHub raw links, file-sharing links, arbitrary zip/tar URLs, and
  third-party registries — the helper enforces this too; never work around it.
- Never execute anything inside a downloaded pack. `scripts/` in a pack stays
  disabled; warn the user when metadata reports `has_scripts: true`.
- Never edit `.polyrig-install.json` (pack install record) or
  `.polyrig-groups/<name>.json` (group install record) by hand; the helper owns
  both.
- Do not pass `--yes` to the helper until the user has confirmed the plan in
  the conversation.
- `--group` and `--single` are mutually exclusive; never pass both.

## Commands

The registry base URL comes from `POLYRIG_REGISTRY_URL` (or `--registry`).

```bash
# Install from a canonical URL the user pasted (pack or group URL)
node "$POLYRIG_ROOT/scripts/install-pack.mjs" install <canonical-url> [--dest <dir>] [--replace] [--allow-deprecated] [--group|--single] --yes

# Update one pack, or everything installed from the registry
node "$POLYRIG_ROOT/scripts/install-pack.mjs" update <type>/<name> [--dest <dir>] --yes
node "$POLYRIG_ROOT/scripts/install-pack.mjs" update --all [--dest <dir>] --yes
```

Default install root is `~/.polyrig/packs/`. A project-level root
(`<project>/.polyrig/packs/` via `--dest`) is used only when the user
explicitly chooses it.

## Pack groups

A **group** is a versioned, reference-style bundle of member packs (each pinned
to an exact version) plus optional out-of-group dependencies. It is the install
unit; member packs remain atomic and each still gets its own
`.polyrig-install.json`.

**Group URL (whole-group install).** When the user pastes a group canonical URL
(`/groups/<name>/versions/<version>`), the helper builds the whole-group plan —
all members plus group-level external dependencies, expanded through their
requires-closure and ordered **dependency-first (topological)** — and installs it
after confirmation. In addition to each member's `.polyrig-install.json`, it
writes a **group install record** at `<dest>/.polyrig-groups/<name>.json`
recording the group id/version, `members`, `requires`, and the full `lock`
(members + transitive deps, dependency-first). A future `update` uses this record
to recognise the group as a unit.

**Member URL (soft-guide).** When the user pastes a **member** pack URL and the
pack's registry metadata advertises group membership, the helper does not silently
single-install. It prints `SOFT-GUIDE` lines, previews the whole-group plan, and
**exits non-zero**, forcing an explicit scope choice:
- `--group` — install the whole group (the default recommendation).
- `--single` — install just that pack plus its `requires` closure (parents), but
  **not** its group siblings.

Present both to the user, recommend the whole group, and re-run with the chosen
flag after they confirm. Single-install still writes each installed pack's
`.polyrig-install.json` but writes **no** group record.

**Group update (client-side).** Group upgrade is whole-group re-upload semantics
on the registry side; client-side you re-run install against the newer group
canonical URL (or a future group `update`). The helper downloads/validates/
replaces only the members whose content (sha256) changed and no-ops the rest,
then rewrites the group install record. Never hand-edit the record to fake an
update.

## Workflow

1. Parse intent: install (user pasted a pack or group canonical URL) or update
   (pack id or "update everything").
2. Run the helper **without** `--yes` first if you only need the failure
   modes, or fetch the plan by running it and reading the `PLAN` lines before
   the confirmation stop. Present the plan to the user: pack id, version,
   publisher, sha256, release notes, dependencies, and any warnings. For a group
   URL the plan is prefixed by a `PLAN group …` line and lists members +
   dependencies in dependency order.
3. Stop and ask for explicit confirmation at these points:
   - first install of any pack;
   - installing a whole group (group URL, or a member URL run with `--group`);
   - installing dependency packs pulled in via `resolved_requires`;
   - replacing an existing pack of the same id (`--replace`);
   - updating a pack;
   - installing a deprecated version (`--allow-deprecated`);
   - metadata reports `has_scripts: true`;
   - installing into a project-level `.polyrig/packs` root;
   - metadata `conflicts` hit locally installed packs.
4. **Soft-guide on a member URL.** If the helper exits non-zero with
   `SOFT-GUIDE` lines, the pasted pack belongs to a group. Present both options
   to the user — the whole group (`--group`, recommended) or this pack alone
   plus its requires closure (`--single`) — and only after they choose, re-run
   with the chosen flag. Do not default to `--single` silently.
5. After the user confirms, re-run the same command with `--yes` (plus
   `--group`/`--single` when resolving a soft-guide) and report the outcome
   (`OK installed …` / `OK installed group …` / `NOOP …`).
6. No confirmation is needed to: parse a URL, read metadata, check what is
   already installed, preview a group plan, or report a same-checksum no-op.

## Failure handling

Relay helper errors verbatim and do not retry with weakened flags:

- `sha256 mismatch` — the artifact does not match registry metadata; abort and
  tell the user to report the pack version page.
- `local validate-pack failed` — the pack violates the PolyRig protocol; do
  not install, show the violations.
- `refusing <origin>` — the URL is not the configured registry.
- `removed` — the version was removed by the platform; there is no override.
- `belongs to <group>; choose --group or --single` — the pasted member URL is
  a group member; resolve the soft-guide (step 4) rather than retrying blindly.
- `dependency cycle among …` — the group's frozen `requires` form a cycle;
  abort and tell the user to report the group version page (the registry's
  joint-validate should have caught it).
