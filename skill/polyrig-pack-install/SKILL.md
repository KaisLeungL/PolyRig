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

- Only PolyRig registry canonical URLs are accepted
  (`https://<registry>/packs/<type>/<name>/versions/<version>`). Refuse GitHub
  raw links, file-sharing links, arbitrary zip/tar URLs, and third-party
  registries — the helper enforces this too; never work around it.
- Never execute anything inside a downloaded pack. `scripts/` in a pack stays
  disabled; warn the user when metadata reports `has_scripts: true`.
- Never edit `.polyrig-install.json` by hand; the helper owns it.
- Do not pass `--yes` to the helper until the user has confirmed the plan in
  the conversation.

## Commands

The registry base URL comes from `POLYRIG_REGISTRY_URL` (or `--registry`).

```bash
# Install from a canonical URL the user pasted
node "$POLYRIG_ROOT/scripts/install-pack.mjs" install <canonical-url> [--dest <dir>] [--replace] [--allow-deprecated] --yes

# Update one pack, or everything installed from the registry
node "$POLYRIG_ROOT/scripts/install-pack.mjs" update <type>/<name> [--dest <dir>] --yes
node "$POLYRIG_ROOT/scripts/install-pack.mjs" update --all [--dest <dir>] --yes
```

Default install root is `~/.polyrig/packs/`. A project-level root
(`<project>/.polyrig/packs/` via `--dest`) is used only when the user
explicitly chooses it.

## Workflow

1. Parse intent: install (user pasted a canonical URL) or update (pack id or
   "update everything").
2. Run the helper **without** `--yes` first if you only need the failure
   modes, or fetch the plan by running it and reading the `PLAN` lines before
   the confirmation stop. Present the plan to the user: pack id, version,
   publisher, sha256, release notes, dependencies, and any warnings.
3. Stop and ask for explicit confirmation at these points:
   - first install of any pack;
   - installing dependency packs pulled in via `resolved_requires`;
   - replacing an existing pack of the same id (`--replace`);
   - updating a pack;
   - installing a deprecated version (`--allow-deprecated`);
   - metadata reports `has_scripts: true`;
   - installing into a project-level `.polyrig/packs` root;
   - metadata `conflicts` hit locally installed packs.
4. After the user confirms, re-run the same command with `--yes` and report
   the outcome (`OK installed …` / `NOOP …`).
5. No confirmation is needed to: parse a URL, read metadata, check what is
   already installed, or report a same-checksum no-op.

## Failure handling

Relay helper errors verbatim and do not retry with weakened flags:

- `sha256 mismatch` — the artifact does not match registry metadata; abort and
  tell the user to report the pack version page.
- `local validate-pack failed` — the pack violates the PolyRig protocol; do
  not install, show the violations.
- `refusing <origin>` — the URL is not the configured registry.
- `removed` — the version was removed by the platform; there is no override.
